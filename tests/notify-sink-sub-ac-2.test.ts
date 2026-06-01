// tests/notify-sink-sub-ac-2.test.ts
// Sub-AC 2: NotifySink 인터페이스 + NotifyResult 타입 검증
//
// 목적:
//   - contracts.ts에 NotifySink 인터페이스(send(payload): Promise<NotifyResult>)가 존재
//   - NotifyResult 타입이 올바른 구조를 가짐
//   - NotifySink를 구현하는 stub(MockNotifySink)이 컴파일되고 send() 반환값 타입을 만족
//   - 테스트 부수효과 절대 없음 (OS 알림·네트워크 없음)

import {
  type NotifySink,
  type NotifyResult,
  type NotificationPayload,
} from '../src/contracts.js'

// ---- MockNotifySink: 테스트용 stub (부수효과 없음) ----

class MockNotifySink implements NotifySink {
  readonly sent: NotificationPayload[] = []

  async send(payload: NotificationPayload): Promise<NotifyResult> {
    this.sent.push(payload)
    return {
      success: true,
      channel: 'mock',
    }
  }
}

// ---- 실패 케이스 stub ----

class FailingMockNotifySink implements NotifySink {
  async send(_payload: NotificationPayload): Promise<NotifyResult> {
    return {
      success: false,
      channel: 'mock',
      error: 'simulated failure',
    }
  }
}

// ---- 헬퍼: 최소 NotificationPayload 생성 ----

function makePayload(overrides?: Partial<NotificationPayload>): NotificationPayload {
  return {
    sessionId: 'sess-test-001',
    kind: 'thrashing',
    subtype: 'micro_variant_loop',
    confidence: 0.85,
    reason: 'repeated identical edits',
    evidence: [{ uuid: 'uuid-1', ts: 1000, note: 'edit repeated 12 times' }],
    ts: Date.now(),
    severity: 'critical',
    dedupeKey: 'sess-test-001\x1fthrashing',
    ...overrides,
  }
}

// ---- 테스트 스위트 ----

describe('Sub-AC 2 — NotifyResult 타입 구조', () => {
  test('NotifyResult는 success(boolean) 필드를 가진다', () => {
    const result: NotifyResult = { success: true, channel: 'mock' }
    expect(typeof result.success).toBe('boolean')
  })

  test('NotifyResult는 channel 필드를 가진다', () => {
    const result: NotifyResult = { success: true, channel: 'desktop' }
    expect(result.channel).toBe('desktop')
  })

  test('NotifyResult.channel은 허용된 리터럴 값만 받는다', () => {
    const channels: NotifyResult['channel'][] = ['desktop', 'webhook', 'cli', 'mock']
    for (const ch of channels) {
      const r: NotifyResult = { success: true, channel: ch }
      expect(r.channel).toBe(ch)
    }
  })

  test('NotifyResult.error는 선택적(optional)이며 string 타입이다', () => {
    const withError: NotifyResult = { success: false, channel: 'mock', error: 'test error' }
    const withoutError: NotifyResult = { success: true, channel: 'cli' }
    expect(typeof withError.error).toBe('string')
    expect(withoutError.error).toBeUndefined()
  })

  test('성공 NotifyResult는 error 없이 생성 가능하다', () => {
    const result: NotifyResult = { success: true, channel: 'mock' }
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  test('실패 NotifyResult는 error 메시지를 포함한다', () => {
    const result: NotifyResult = { success: false, channel: 'webhook', error: 'HTTP 500' }
    expect(result.success).toBe(false)
    expect(result.error).toBe('HTTP 500')
  })
})

describe('Sub-AC 2 — NotifySink 인터페이스 + MockNotifySink stub 컴파일', () => {
  let sink: MockNotifySink

  beforeEach(() => {
    sink = new MockNotifySink()
  })

  test('MockNotifySink는 NotifySink 인터페이스를 구현한다 (컴파일 검증)', () => {
    // 타입 호환성 검증: NotifySink 타입 변수에 할당 가능해야 함
    const notifySink: NotifySink = sink
    expect(typeof notifySink.send).toBe('function')
  })

  test('send() 는 Promise<NotifyResult>를 반환한다', async () => {
    const payload = makePayload()
    const result = await sink.send(payload)

    // NotifyResult 구조 검증
    expect(typeof result.success).toBe('boolean')
    expect(typeof result.channel).toBe('string')
  })

  test('send() 성공 시 success=true를 반환한다', async () => {
    const payload = makePayload()
    const result = await sink.send(payload)
    expect(result.success).toBe(true)
  })

  test('send() 가 payload를 인메모리에 수집한다 (부수효과 없음)', async () => {
    const payload = makePayload()
    await sink.send(payload)
    expect(sink.sent).toHaveLength(1)
    expect(sink.sent[0]).toBe(payload)
  })

  test('send() 여러 번 호출 시 모두 수집된다', async () => {
    const p1 = makePayload({ sessionId: 'sess-a' })
    const p2 = makePayload({ sessionId: 'sess-b', kind: 'false_success' })
    await sink.send(p1)
    await sink.send(p2)
    expect(sink.sent).toHaveLength(2)
    expect(sink.sent[0].sessionId).toBe('sess-a')
    expect(sink.sent[1].sessionId).toBe('sess-b')
  })

  test('send() 는 NotificationPayload의 evidence를 그대로 수신한다', async () => {
    const payload = makePayload({
      evidence: [
        { uuid: 'uuid-ev-1', ts: 2000, note: 'evidence note 1' },
        { uuid: 'uuid-ev-2', ts: 3000, note: 'evidence note 2' },
      ],
    })
    await sink.send(payload)
    const received = sink.sent[0]
    expect(received.evidence).toHaveLength(2)
    expect(received.evidence[0].uuid).toBe('uuid-ev-1')
    expect(received.evidence[1].note).toBe('evidence note 2')
  })
})

describe('Sub-AC 2 — FailingMockNotifySink: 실패 경로 타입 검증', () => {
  test('실패 sink도 NotifySink 인터페이스를 구현한다', () => {
    const sink: NotifySink = new FailingMockNotifySink()
    expect(typeof sink.send).toBe('function')
  })

  test('실패 sink의 send()는 success=false + error를 반환한다', async () => {
    const sink = new FailingMockNotifySink()
    const result = await sink.send(makePayload())
    expect(result.success).toBe(false)
    expect(typeof result.error).toBe('string')
  })

  test('실패 sink는 throw 없이 결과를 반환한다 (채널 실패 격리 원칙)', async () => {
    const sink = new FailingMockNotifySink()
    // throw 없이 정상 반환해야 함
    await expect(sink.send(makePayload())).resolves.toBeDefined()
  })
})

describe('Sub-AC 2 — NotifySink 다형성: 여러 구현체가 동일 인터페이스를 만족', () => {
  test('NotifySink 배열에 MockNotifySink와 FailingMockNotifySink를 혼합할 수 있다', async () => {
    const sinks: NotifySink[] = [
      new MockNotifySink(),
      new FailingMockNotifySink(),
    ]
    const payload = makePayload()
    const results = await Promise.all(sinks.map(s => s.send(payload)))
    expect(results).toHaveLength(2)
    expect(results[0].success).toBe(true)
    expect(results[1].success).toBe(false)
  })

  test('각 send() 결과는 독립적이다 (한 채널 실패가 다른 채널에 영향 없음)', async () => {
    const successSink = new MockNotifySink()
    const failSink = new FailingMockNotifySink()
    const payload = makePayload()

    const [r1, r2] = await Promise.all([
      successSink.send(payload),
      failSink.send(payload),
    ])

    expect(r1.success).toBe(true)
    expect(r2.success).toBe(false)
    // 성공 sink는 여전히 payload를 수집했음
    expect(successSink.sent).toHaveLength(1)
  })
})
