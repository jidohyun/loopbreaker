/**
 * tests/webhook-notify-sink-sub-ac-3c.test.ts
 *
 * Sub-AC 3c: WebhookNotifySink.send() 실패 처리 단위 테스트.
 *
 * 검증 항목:
 *   1. fetch가 네트워크 에러로 throw할 때 send()가 success=false를 반환한다
 *   2. 에러 메시지가 NotifyResult.error에 포함된다
 *   3. non-2xx 상태 코드(4xx) 응답 시 success=false 반환
 *   4. non-2xx 상태 코드(5xx) 응답 시 success=false 반환
 *   5. 에러 응답의 HTTP 상태 정보가 error 필드에 포함된다
 *   6. throw된 에러가 Error 인스턴스가 아닌 경우에도 올바르게 처리된다
 *   7. 실패 시에도 channel='webhook'이 반환된다
 *   8. send()가 실패해도 예외를 re-throw하지 않는다 (격리 보장)
 *   9. 다양한 4xx 코드별 에러 메시지 검증
 *  10. 다양한 5xx 코드별 에러 메시지 검증
 *
 * 부수효과 없음: 실제 네트워크 요청 없음 (mock fetch 어댑터 주입).
 */

import { WebhookNotifySink, type FetchFn } from '../src/notify/sinks/webhook-notify-sink.js'
import type { NotificationPayload } from '../src/contracts.js'

// ── 헬퍼: 성공 mock fetch ──────────────────────────────────────────────────

function makeMockFetch(ok = true, status = 200, statusText = 'OK'): {
  fn: FetchFn
  calls: Array<{ url: string; init: Parameters<FetchFn>[1] }>
} {
  const calls: Array<{ url: string; init: Parameters<FetchFn>[1] }> = []
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init })
    return { ok, status, statusText }
  }
  return { fn, calls }
}

/** fetch가 Error를 throw하는 mock */
function makeThrowingFetch(error: Error): FetchFn {
  return async () => {
    throw error
  }
}

/** fetch가 비-Error 값을 throw하는 mock */
function makeThrowingFetchRaw(value: unknown): FetchFn {
  return async () => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    throw value
  }
}

// ── 공통 테스트 payload 팩토리 ─────────────────────────────────────────────

function makePayload(overrides?: Partial<NotificationPayload>): NotificationPayload {
  return {
    sessionId: 'sess-err-01',
    kind: 'thrashing',
    subtype: 'edit_thrashing',
    confidence: 0.9,
    reason: '반복 편집 패턴 감지',
    evidence: [{ uuid: 'ev-1', ts: 1700000000000, note: '증거' }],
    ts: 1700000001000,
    severity: 'warning',
    dedupeKey: 'sess-err-01\x1fthrashing',
    ...overrides,
  }
}

// ── 테스트 ─────────────────────────────────────────────────────────────────

describe('WebhookNotifySink.send() — 실패 처리 (Sub-AC 3c)', () => {
  const WEBHOOK_URL = 'https://hooks.example.com/loopbreaker-notify'

  // ── 네트워크 에러 (fetch throws) ──────────────────────────────────────────

  describe('네트워크 에러 처리', () => {
    it('fetch가 네트워크 에러로 throw하면 success=false를 반환한다', async () => {
      const networkError = new Error('fetch failed: connection refused')
      const sink = new WebhookNotifySink(WEBHOOK_URL, makeThrowingFetch(networkError))

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
    })

    it('네트워크 에러 시 channel="webhook"이 반환된다', async () => {
      const networkError = new Error('Network request failed')
      const sink = new WebhookNotifySink(WEBHOOK_URL, makeThrowingFetch(networkError))

      const result = await sink.send(makePayload())

      expect(result.channel).toBe('webhook')
    })

    it('에러 메시지가 NotifyResult.error 필드에 포함된다', async () => {
      const errorMsg = 'fetch failed: ECONNREFUSED 127.0.0.1:9999'
      const networkError = new Error(errorMsg)
      const sink = new WebhookNotifySink(WEBHOOK_URL, makeThrowingFetch(networkError))

      const result = await sink.send(makePayload())

      expect(result.error).toBe(errorMsg)
    })

    it('send()가 네트워크 에러 시에도 예외를 re-throw하지 않는다', async () => {
      const sink = new WebhookNotifySink(
        WEBHOOK_URL,
        makeThrowingFetch(new Error('timeout')),
      )

      // send()는 throw하지 않고 결과를 반환해야 함
      await expect(sink.send(makePayload())).resolves.toBeDefined()
    })

    it('timeout 에러도 올바르게 처리된다', async () => {
      const timeoutError = new Error('The operation was aborted due to timeout')
      const sink = new WebhookNotifySink(WEBHOOK_URL, makeThrowingFetch(timeoutError))

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
      expect(result.channel).toBe('webhook')
      expect(result.error).toContain('timeout')
    })

    it('DNS 조회 실패 에러도 올바르게 처리된다', async () => {
      const dnsError = new Error('getaddrinfo ENOTFOUND hooks.example.com')
      const sink = new WebhookNotifySink(WEBHOOK_URL, makeThrowingFetch(dnsError))

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
      expect(result.error).toContain('ENOTFOUND')
    })

    it('throw된 값이 Error 인스턴스가 아닌 문자열이어도 처리된다', async () => {
      const sink = new WebhookNotifySink(
        WEBHOOK_URL,
        makeThrowingFetchRaw('string error value'),
      )

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
      expect(result.channel).toBe('webhook')
      expect(result.error).toBe('string error value')
    })

    it('throw된 값이 숫자여도 처리된다', async () => {
      const sink = new WebhookNotifySink(WEBHOOK_URL, makeThrowingFetchRaw(42))

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
      expect(result.error).toBe('42')
    })

    it('throw된 값이 null이어도 처리된다', async () => {
      const sink = new WebhookNotifySink(WEBHOOK_URL, makeThrowingFetchRaw(null))

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
      // String(null) = 'null'
      expect(result.error).toBe('null')
    })
  })

  // ── non-2xx HTTP 상태 처리 ────────────────────────────────────────────────

  describe('non-2xx HTTP 상태 코드 처리', () => {
    it('400 Bad Request 시 success=false를 반환한다', async () => {
      const { fn } = makeMockFetch(false, 400, 'Bad Request')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
    })

    it('400 응답 시 channel="webhook"이 반환된다', async () => {
      const { fn } = makeMockFetch(false, 400, 'Bad Request')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(result.channel).toBe('webhook')
    })

    it('400 응답 시 error 필드에 HTTP 상태 코드가 포함된다', async () => {
      const { fn } = makeMockFetch(false, 400, 'Bad Request')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(result.error).toContain('400')
    })

    it('400 응답 시 error 필드에 statusText가 포함된다', async () => {
      const { fn } = makeMockFetch(false, 400, 'Bad Request')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(result.error).toContain('Bad Request')
    })

    it('401 Unauthorized 시 success=false와 에러 정보를 반환한다', async () => {
      const { fn } = makeMockFetch(false, 401, 'Unauthorized')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
      expect(result.channel).toBe('webhook')
      expect(result.error).toContain('401')
      expect(result.error).toContain('Unauthorized')
    })

    it('403 Forbidden 시 success=false와 에러 정보를 반환한다', async () => {
      const { fn } = makeMockFetch(false, 403, 'Forbidden')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
      expect(result.error).toContain('403')
      expect(result.error).toContain('Forbidden')
    })

    it('404 Not Found 시 success=false와 에러 정보를 반환한다', async () => {
      const { fn } = makeMockFetch(false, 404, 'Not Found')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
      expect(result.error).toContain('404')
    })

    it('429 Too Many Requests 시 success=false와 에러 정보를 반환한다', async () => {
      const { fn } = makeMockFetch(false, 429, 'Too Many Requests')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
      expect(result.error).toContain('429')
      expect(result.error).toContain('Too Many Requests')
    })

    it('500 Internal Server Error 시 success=false와 에러 정보를 반환한다', async () => {
      const { fn } = makeMockFetch(false, 500, 'Internal Server Error')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
      expect(result.channel).toBe('webhook')
      expect(result.error).toContain('500')
      expect(result.error).toContain('Internal Server Error')
    })

    it('502 Bad Gateway 시 success=false와 에러 정보를 반환한다', async () => {
      const { fn } = makeMockFetch(false, 502, 'Bad Gateway')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
      expect(result.error).toContain('502')
      expect(result.error).toContain('Bad Gateway')
    })

    it('503 Service Unavailable 시 success=false와 에러 정보를 반환한다', async () => {
      const { fn } = makeMockFetch(false, 503, 'Service Unavailable')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(result.success).toBe(false)
      expect(result.error).toContain('503')
      expect(result.error).toContain('Service Unavailable')
    })

    it('non-2xx 응답 시에도 send()는 예외를 re-throw하지 않는다', async () => {
      const { fn } = makeMockFetch(false, 503, 'Service Unavailable')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      await expect(sink.send(makePayload())).resolves.toBeDefined()
    })

    it('에러 필드 형식: "HTTP {status}: {statusText}" 패턴을 따른다', async () => {
      const { fn } = makeMockFetch(false, 422, 'Unprocessable Entity')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(result.error).toBe('HTTP 422: Unprocessable Entity')
    })
  })

  // ── 결과 타입 정합성 검증 ─────────────────────────────────────────────────

  describe('실패 결과 타입 정합성', () => {
    it('네트워크 에러 결과는 { success: false, channel: "webhook", error: string } 구조다', async () => {
      const sink = new WebhookNotifySink(
        WEBHOOK_URL,
        makeThrowingFetch(new Error('network down')),
      )

      const result = await sink.send(makePayload())

      expect(typeof result.success).toBe('boolean')
      expect(result.success).toBe(false)
      expect(result.channel).toBe('webhook')
      expect(typeof result.error).toBe('string')
      expect(result.error!.length).toBeGreaterThan(0)
    })

    it('non-2xx 결과는 { success: false, channel: "webhook", error: string } 구조다', async () => {
      const { fn } = makeMockFetch(false, 500, 'Internal Server Error')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(typeof result.success).toBe('boolean')
      expect(result.success).toBe(false)
      expect(result.channel).toBe('webhook')
      expect(typeof result.error).toBe('string')
      expect(result.error!.length).toBeGreaterThan(0)
    })

    it('성공 결과는 error 필드가 없다 (실패와 구분)', async () => {
      const { fn } = makeMockFetch(true, 200, 'OK')
      const sink = new WebhookNotifySink(WEBHOOK_URL, fn)

      const result = await sink.send(makePayload())

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })
  })

  // ── 채널 격리 검증 ────────────────────────────────────────────────────────

  describe('채널 격리 (한 채널 실패가 다른 채널을 막지 않음)', () => {
    it('첫 번째 send 실패 후 두 번째 send도 독립적으로 동작한다', async () => {
      let callCount = 0
      const intermittentFetch: FetchFn = async (_url, _init) => {
        callCount++
        if (callCount === 1) {
          throw new Error('transient error')
        }
        return { ok: true, status: 200, statusText: 'OK' }
      }

      const sink = new WebhookNotifySink(WEBHOOK_URL, intermittentFetch)

      const result1 = await sink.send(makePayload({ sessionId: 'sess-fail' }))
      const result2 = await sink.send(makePayload({ sessionId: 'sess-ok' }))

      expect(result1.success).toBe(false)
      expect(result2.success).toBe(true)
    })

    it('여러 연속 실패도 각각 독립적인 NotifyResult를 반환한다', async () => {
      const alwaysFailFetch: FetchFn = async (_url, _init) => {
        throw new Error('permanent failure')
      }
      const sink = new WebhookNotifySink(WEBHOOK_URL, alwaysFailFetch)

      const results = await Promise.all([
        sink.send(makePayload({ sessionId: 'sess-1' })),
        sink.send(makePayload({ sessionId: 'sess-2' })),
        sink.send(makePayload({ sessionId: 'sess-3' })),
      ])

      for (const result of results) {
        expect(result.success).toBe(false)
        expect(result.channel).toBe('webhook')
        expect(result.error).toBe('permanent failure')
      }
    })
  })
})
