/**
 * tests/webhook-notify-sink-sub-ac-3a.test.ts
 *
 * Sub-AC 3a: WebhookNotifySink 클래스 골격 및 생성자 DI 단위 테스트.
 *
 * 검증 항목:
 *   1. mock fetch 어댑터 주입 시 인스턴스 정상 생성
 *   2. webhookUrl 필드가 올바르게 저장됨
 *   3. fetchFn 필드가 올바르게 저장됨 (주입된 mock이 실제 호출됨)
 *   4. fetchFn 미전달 시 globalThis.fetch 폴백 (기본 생성자)
 *   5. NotifySink 인터페이스 준수 (send 메서드 존재)
 *
 * 부수효과 없음: 실제 네트워크 요청 없음 (mock fetch 사용).
 */

import { WebhookNotifySink, type FetchFn } from '../src/notify/sinks/webhook-notify-sink.js'
import type { NotifySink } from '../src/contracts.js'

// ── 헬퍼: mock fetch 팩토리 ────────────────────────────────────────────────

function makeMockFetch(ok = true, status = 200): {
  fn: FetchFn
  calls: Array<{ url: string; init: Parameters<FetchFn>[1] }>
} {
  const calls: Array<{ url: string; init: Parameters<FetchFn>[1] }> = []
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init })
    return { ok, status, statusText: ok ? 'OK' : 'Bad Request' }
  }
  return { fn, calls }
}

// ── 테스트 ─────────────────────────────────────────────────────────────────

describe('WebhookNotifySink — 생성자 DI (Sub-AC 3a)', () => {
  const TEST_URL = 'https://hooks.example.com/notify'

  it('mock fetch 어댑터 주입 시 인스턴스가 정상 생성된다', () => {
    const { fn } = makeMockFetch()
    const sink = new WebhookNotifySink(TEST_URL, fn)
    expect(sink).toBeInstanceOf(WebhookNotifySink)
  })

  it('NotifySink 인터페이스를 준수한다 (send 메서드 존재)', () => {
    const { fn } = makeMockFetch()
    const sink: NotifySink = new WebhookNotifySink(TEST_URL, fn)
    expect(typeof sink.send).toBe('function')
  })

  it('주입된 fetchFn이 send() 호출 시 실제로 사용된다', async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(TEST_URL, fn)

    const payload = {
      sessionId: 'sess-001',
      kind: 'thrashing' as const,
      subtype: 'edit_thrashing',
      confidence: 0.9,
      reason: '반복 편집 감지',
      evidence: [{ uuid: 'ev-1', ts: Date.now(), note: '증거 노트' }],
      ts: Date.now(),
      severity: 'warning' as const,
      dedupeKey: 'sess-001\x1fthrashing',
    }

    const result = await sink.send(payload)

    // fetchFn이 호출되었는지 확인
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(TEST_URL)
    expect(calls[0].init.method).toBe('POST')
    expect(result.success).toBe(true)
    expect(result.channel).toBe('webhook')
  })

  it('webhookUrl이 올바르게 저장되어 fetch 호출 시 전달된다', async () => {
    const CUSTOM_URL = 'https://custom.webhook.io/endpoint'
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(CUSTOM_URL, fn)

    const payload = {
      sessionId: 'sess-002',
      kind: 'false_success' as const,
      subtype: 'unsubstantiated_claim',
      confidence: 0.85,
      reason: '가짜 성공 감지',
      evidence: [],
      ts: Date.now(),
      severity: 'critical' as const,
      dedupeKey: 'sess-002\x1ffalse_success',
    }

    await sink.send(payload)

    // 저장된 webhookUrl이 올바르게 사용됨
    expect(calls[0].url).toBe(CUSTOM_URL)
  })

  it('fetchFn 미전달 시 기본 생성자로 인스턴스가 생성된다', () => {
    // fetchFn 없이 생성 — globalThis.fetch 폴백
    // 단, 실제 네트워크 호출은 하지 않으므로 생성만 검증
    expect(() => new WebhookNotifySink(TEST_URL)).not.toThrow()
  })

  it('서로 다른 URL로 여러 인스턴스 생성 시 각각 독립된 필드를 가진다', async () => {
    const URL_A = 'https://sink-a.example.com'
    const URL_B = 'https://sink-b.example.com'
    const { fn: fnA, calls: callsA } = makeMockFetch()
    const { fn: fnB, calls: callsB } = makeMockFetch()

    const sinkA = new WebhookNotifySink(URL_A, fnA)
    const sinkB = new WebhookNotifySink(URL_B, fnB)

    const payload = {
      sessionId: 'sess-003',
      kind: 'thrashing' as const,
      subtype: 'edit_thrashing',
      confidence: 0.8,
      reason: '테스트',
      evidence: [],
      ts: Date.now(),
      severity: 'warning' as const,
      dedupeKey: 'sess-003\x1fthrashing',
    }

    await sinkA.send(payload)
    await sinkB.send(payload)

    // 각 인스턴스가 독립된 URL로 호출됨
    expect(callsA[0].url).toBe(URL_A)
    expect(callsB[0].url).toBe(URL_B)
    // 서로 격리됨
    expect(callsA).toHaveLength(1)
    expect(callsB).toHaveLength(1)
  })
})
