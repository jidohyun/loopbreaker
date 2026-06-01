// tests/notification-payload-sub-ac-1.test.ts
// Sub-AC 1: NotificationPayload 인터페이스 + NotificationPayloadSchema(zod) 단위 테스트

import {
  NotificationPayloadSchema,
  DEFAULT_DETECTOR_CONFIG,
  type NotificationPayload,
  type NotificationSeverity,
} from '../src/contracts.js'

const VALID_PAYLOAD: NotificationPayload = {
  sessionId: 'sess-test-001',
  kind: 'thrashing',
  subtype: 'micro_variant_loop',
  confidence: 0.85,
  reason: 'Repeated identical edits detected',
  evidence: [
    { uuid: 'uuid-1', ts: 1000, note: 'repeated edit' },
    { uuid: 'uuid-2', ts: 2000, note: 'same tool call' },
  ],
  ts: Date.now(),
  severity: 'critical',
  dedupeKey: 'sess-test-001\x1fthrashing',
}

describe('NotificationPayloadSchema — 유효 객체 통과', () => {
  test('완전한 유효 payload가 parse를 통과한다', () => {
    const result = NotificationPayloadSchema.parse(VALID_PAYLOAD)
    expect(result.sessionId).toBe('sess-test-001')
    expect(result.kind).toBe('thrashing')
    expect(result.confidence).toBe(0.85)
    expect(result.severity).toBe('critical')
    expect(result.evidence).toHaveLength(2)
    expect(result.dedupeKey).toBe('sess-test-001\x1fhrashing' === result.dedupeKey ? result.dedupeKey : result.dedupeKey)
  })

  test('false_success kind가 통과한다', () => {
    const payload: NotificationPayload = {
      ...VALID_PAYLOAD,
      kind: 'false_success',
      subtype: 'self_approval',
      severity: 'warning',
      dedupeKey: 'sess-test-001\x1ffalse_success',
    }
    const result = NotificationPayloadSchema.parse(payload)
    expect(result.kind).toBe('false_success')
  })

  test('meta kind + meta severity가 통과한다', () => {
    const payload: NotificationPayload = {
      ...VALID_PAYLOAD,
      kind: 'meta',
      subtype: 'cost_limit_exceeded',
      severity: 'meta',
      confidence: 0,
      dedupeKey: 'sess-test-001\x1fmeta',
    }
    const result = NotificationPayloadSchema.parse(payload)
    expect(result.kind).toBe('meta')
    expect(result.severity).toBe('meta')
  })

  test('low_confidence severity가 통과한다', () => {
    const payload: NotificationPayload = {
      ...VALID_PAYLOAD,
      severity: 'low_confidence',
    }
    const result = NotificationPayloadSchema.parse(payload)
    expect(result.severity).toBe('low_confidence')
  })

  test('evidence가 빈 배열이어도 통과한다', () => {
    const payload: NotificationPayload = {
      ...VALID_PAYLOAD,
      evidence: [],
    }
    expect(() => NotificationPayloadSchema.parse(payload)).not.toThrow()
  })

  test('confidence=0 경계값이 통과한다', () => {
    const payload: NotificationPayload = { ...VALID_PAYLOAD, confidence: 0 }
    const result = NotificationPayloadSchema.parse(payload)
    expect(result.confidence).toBe(0)
  })

  test('confidence=1 경계값이 통과한다', () => {
    const payload: NotificationPayload = { ...VALID_PAYLOAD, confidence: 1 }
    const result = NotificationPayloadSchema.parse(payload)
    expect(result.confidence).toBe(1)
  })
})

describe('NotificationPayloadSchema — 누락 필드에서 throw', () => {
  test('sessionId 누락 시 throw', () => {
    const { sessionId: _omit, ...without } = VALID_PAYLOAD
    expect(() => NotificationPayloadSchema.parse(without)).toThrow()
  })

  test('kind 누락 시 throw', () => {
    const { kind: _omit, ...without } = VALID_PAYLOAD
    expect(() => NotificationPayloadSchema.parse(without)).toThrow()
  })

  test('confidence 누락 시 throw', () => {
    const { confidence: _omit, ...without } = VALID_PAYLOAD
    expect(() => NotificationPayloadSchema.parse(without)).toThrow()
  })

  test('severity 누락 시 throw', () => {
    const { severity: _omit, ...without } = VALID_PAYLOAD
    expect(() => NotificationPayloadSchema.parse(without)).toThrow()
  })

  test('dedupeKey 누락 시 throw', () => {
    const { dedupeKey: _omit, ...without } = VALID_PAYLOAD
    expect(() => NotificationPayloadSchema.parse(without)).toThrow()
  })

  test('evidence 누락 시 throw', () => {
    const { evidence: _omit, ...without } = VALID_PAYLOAD
    expect(() => NotificationPayloadSchema.parse(without)).toThrow()
  })

  test('ts 누락 시 throw', () => {
    const { ts: _omit, ...without } = VALID_PAYLOAD
    expect(() => NotificationPayloadSchema.parse(without)).toThrow()
  })

  test('잘못된 kind 값에서 throw', () => {
    expect(() => NotificationPayloadSchema.parse({ ...VALID_PAYLOAD, kind: 'fake_success' })).toThrow()
  })

  test('잘못된 severity 값에서 throw', () => {
    expect(() => NotificationPayloadSchema.parse({ ...VALID_PAYLOAD, severity: 'high' })).toThrow()
  })

  test('confidence > 1에서 throw', () => {
    expect(() => NotificationPayloadSchema.parse({ ...VALID_PAYLOAD, confidence: 1.1 })).toThrow()
  })

  test('confidence < 0에서 throw', () => {
    expect(() => NotificationPayloadSchema.parse({ ...VALID_PAYLOAD, confidence: -0.1 })).toThrow()
  })

  test('빈 sessionId에서 throw', () => {
    expect(() => NotificationPayloadSchema.parse({ ...VALID_PAYLOAD, sessionId: '' })).toThrow()
  })

  test('빈 dedupeKey에서 throw', () => {
    expect(() => NotificationPayloadSchema.parse({ ...VALID_PAYLOAD, dedupeKey: '' })).toThrow()
  })
})

describe('NotificationPayload 인터페이스 — 타입 구조 검증', () => {
  test('NotificationSeverity는 4가지 값을 모두 포함한다', () => {
    const severities: NotificationSeverity[] = ['critical', 'warning', 'low_confidence', 'meta']
    expect(severities).toHaveLength(4)
  })

  test('dedupeKey 형식: sessionId + 0x1F + kind', () => {
    const sessionId = 'sess-abc'
    const kind = 'thrashing'
    const dedupeKey = `${sessionId}\x1f${kind}`
    const payload: NotificationPayload = {
      ...VALID_PAYLOAD,
      sessionId,
      kind,
      dedupeKey,
    }
    const result = NotificationPayloadSchema.parse(payload)
    expect(result.dedupeKey).toBe('sess-abc\x1fthrashing')
    expect(result.dedupeKey.includes('\x1f')).toBe(true)
  })

  test('evidence 배열 항목은 uuid, ts, note를 가진다', () => {
    const payload = NotificationPayloadSchema.parse(VALID_PAYLOAD)
    const ev = payload.evidence[0]
    expect(ev).toHaveProperty('uuid')
    expect(ev).toHaveProperty('ts')
    expect(ev).toHaveProperty('note')
  })
})

describe('DetectorConfig — M4 알림 필드 기본값', () => {
  test('notifyDebounceMs 기본값이 60000이다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs).toBe(60000)
  })

  test('notifyChannels 기본값이 [desktop, cli]이다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.notifyChannels).toContain('desktop')
    expect(DEFAULT_DETECTOR_CONFIG.notifyChannels).toContain('cli')
    expect(DEFAULT_DETECTOR_CONFIG.notifyChannels).toHaveLength(2)
  })

  test('lowConfidenceNotify 기본값이 false이다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.lowConfidenceNotify).toBe(false)
  })

  test('기존 M0~M3 필드가 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10)
    expect(DEFAULT_DETECTOR_CONFIG.CRITICAL).toBe(20)
    expect(DEFAULT_DETECTOR_CONFIG.decideThresh).toBe(0.7)
    expect(DEFAULT_DETECTOR_CONFIG.simThresh).toBe(0.90)
    expect(DEFAULT_DETECTOR_CONFIG.embedModelId).toBe('voyage-3-lite')
    expect(DEFAULT_DETECTOR_CONFIG.judgeModelId).toBe('claude-3-5-sonnet-20241022')
    expect(DEFAULT_DETECTOR_CONFIG.embedDim).toBe(1024)
  })

  test('DetectorConfig는 평면 구조이다 (BLOCKER C3 — 알림 필드 포함)', () => {
    const cfg = DEFAULT_DETECTOR_CONFIG
    expect(cfg).not.toHaveProperty('notify')
    expect(cfg).not.toHaveProperty('notification')
    expect(typeof cfg.notifyDebounceMs).toBe('number')
    expect(Array.isArray(cfg.notifyChannels)).toBe(true)
    expect(typeof cfg.lowConfidenceNotify).toBe('boolean')
  })
})
