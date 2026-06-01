/**
 * tests/webhook-notify-sink-sub-ac-3b.test.ts
 *
 * Sub-AC 3b: WebhookNotifySink.send() 성공 경로 단위 테스트.
 *
 * 검증 항목:
 *   1. send(payload) 호출 시 주입된 fetch 어댑터가 올바른 URL로 호출됨
 *   2. HTTP method가 'POST'임
 *   3. headers에 'Content-Type: application/json'이 포함됨
 *   4. body가 payload의 JSON.stringify 결과와 정확히 일치함
 *   5. NotifyResult.success = true, channel = 'webhook' 반환
 *   6. evidence 배열이 body payload에 포함됨 (사람 호출용 근거)
 *   7. X-LoopBreaker-Severity, X-LoopBreaker-Kind 헤더도 전송됨
 *
 * 부수효과 없음: 실제 네트워크 요청 없음 (mock fetch 어댑터 주입).
 */

import { WebhookNotifySink, type FetchFn } from '../src/notify/sinks/webhook-notify-sink.js'
import type { NotificationPayload } from '../src/contracts.js'

// ── 헬퍼: mock fetch 팩토리 ────────────────────────────────────────────────

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

// ── 공통 테스트 payload 팩토리 ─────────────────────────────────────────────

function makePayload(overrides?: Partial<NotificationPayload>): NotificationPayload {
  return {
    sessionId: 'sess-abc',
    kind: 'thrashing',
    subtype: 'edit_thrashing',
    confidence: 0.92,
    reason: '반복 편집 패턴 감지',
    evidence: [
      { uuid: 'ev-001', ts: 1700000000000, note: '첫 번째 편집 증거' },
      { uuid: 'ev-002', ts: 1700000001000, note: '두 번째 편집 증거' },
    ],
    ts: 1700000002000,
    severity: 'warning',
    dedupeKey: 'sess-abc\x1fthrashing',
    ...overrides,
  }
}

// ── 테스트 ─────────────────────────────────────────────────────────────────

describe('WebhookNotifySink.send() — 성공 경로 (Sub-AC 3b)', () => {
  const WEBHOOK_URL = 'https://hooks.example.com/loopbreaker-notify'

  it('올바른 URL로 fetch가 호출된다', async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload()

    await sink.send(payload)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(WEBHOOK_URL)
  })

  it("HTTP method가 'POST'이다", async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload()

    await sink.send(payload)

    expect(calls[0].init.method).toBe('POST')
  })

  it("headers에 'Content-Type: application/json'이 포함된다", async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload()

    await sink.send(payload)

    expect(calls[0].init.headers['Content-Type']).toBe('application/json')
  })

  it('body가 payload를 JSON.stringify한 결과와 정확히 일치한다', async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload()

    await sink.send(payload)

    const sentBody = calls[0].init.body
    expect(sentBody).toBe(JSON.stringify(payload))
  })

  it('body를 JSON.parse 하면 원본 payload 필드가 모두 복원된다', async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload()

    await sink.send(payload)

    const parsed = JSON.parse(calls[0].init.body) as NotificationPayload
    expect(parsed.sessionId).toBe(payload.sessionId)
    expect(parsed.kind).toBe(payload.kind)
    expect(parsed.subtype).toBe(payload.subtype)
    expect(parsed.confidence).toBe(payload.confidence)
    expect(parsed.reason).toBe(payload.reason)
    expect(parsed.ts).toBe(payload.ts)
    expect(parsed.severity).toBe(payload.severity)
    expect(parsed.dedupeKey).toBe(payload.dedupeKey)
  })

  it('evidence 배열이 body payload에 포함된다 (사람 호출용 근거 동반)', async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload()

    await sink.send(payload)

    const parsed = JSON.parse(calls[0].init.body) as NotificationPayload
    expect(Array.isArray(parsed.evidence)).toBe(true)
    expect(parsed.evidence).toHaveLength(2)
    expect(parsed.evidence[0].uuid).toBe('ev-001')
    expect(parsed.evidence[0].ts).toBe(1700000000000)
    expect(parsed.evidence[0].note).toBe('첫 번째 편집 증거')
    expect(parsed.evidence[1].uuid).toBe('ev-002')
  })

  it("X-LoopBreaker-Severity 헤더가 payload.severity 값과 일치한다", async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload({ severity: 'critical' })

    await sink.send(payload)

    expect(calls[0].init.headers['X-LoopBreaker-Severity']).toBe('critical')
  })

  it("X-LoopBreaker-Kind 헤더가 payload.kind 값과 일치한다", async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload({ kind: 'false_success' })

    await sink.send(payload)

    expect(calls[0].init.headers['X-LoopBreaker-Kind']).toBe('false_success')
  })

  it('성공 응답 시 NotifyResult.success=true, channel="webhook"을 반환한다', async () => {
    const { fn } = makeMockFetch(true, 200, 'OK')
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload()

    const result = await sink.send(payload)

    expect(result.success).toBe(true)
    expect(result.channel).toBe('webhook')
    expect(result.error).toBeUndefined()
  })

  it('false_success kind payload도 동일한 성공 경로를 따른다', async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload({
      sessionId: 'sess-xyz',
      kind: 'false_success',
      subtype: 'unsubstantiated_claim',
      confidence: 0.88,
      reason: '가짜 성공 선언 감지',
      severity: 'critical',
      dedupeKey: 'sess-xyz\x1ffalse_success',
    })

    const result = await sink.send(payload)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(WEBHOOK_URL)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(calls[0].init.body) as NotificationPayload
    expect(body.kind).toBe('false_success')
    expect(body.severity).toBe('critical')
    expect(result.success).toBe(true)
    expect(result.channel).toBe('webhook')
  })

  it('severity=low_confidence payload도 올바르게 전송된다', async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload({
      severity: 'low_confidence',
      confidence: 0.45,
    })

    await sink.send(payload)

    expect(calls[0].init.headers['X-LoopBreaker-Severity']).toBe('low_confidence')
    const body = JSON.parse(calls[0].init.body) as NotificationPayload
    expect(body.severity).toBe('low_confidence')
    expect(body.confidence).toBe(0.45)
  })

  it('severity=meta payload도 올바르게 전송된다 (메타 알림)', async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload({
      severity: 'meta',
      kind: 'none',
      reason: '비용 상한 초과',
    })

    await sink.send(payload)

    expect(calls[0].init.headers['X-LoopBreaker-Severity']).toBe('meta')
    const body = JSON.parse(calls[0].init.body) as NotificationPayload
    expect(body.severity).toBe('meta')
    expect(body.kind).toBe('none')
  })

  it('fetch가 정확히 1회만 호출된다 (중복 호출 없음)', async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload()

    await sink.send(payload)

    expect(calls).toHaveLength(1)
  })

  it('evidence가 빈 배열이어도 올바르게 직렬화된다', async () => {
    const { fn, calls } = makeMockFetch()
    const sink = new WebhookNotifySink(WEBHOOK_URL, fn)
    const payload = makePayload({ evidence: [] })

    await sink.send(payload)

    const body = JSON.parse(calls[0].init.body) as NotificationPayload
    expect(Array.isArray(body.evidence)).toBe(true)
    expect(body.evidence).toHaveLength(0)
  })
})
