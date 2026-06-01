/**
 * tests/build-notification-payload-sub-ac-2-4c.test.ts
 *
 * Sub-AC 2.4c: buildNotificationPayload 순수함수 단위 테스트.
 *
 * 검증 항목:
 *   - §7-2 #7 정본 필드 전체 존재 및 타입
 *   - evidence 근거 동반 (사람 호출용)
 *   - dedupeKey = sessionId + '\x1f' + kind
 *   - severity 도출 (confidence 기반)
 *   - DetectionRecord 불변 (원본 수정 없음)
 *   - zod 검증 통과 보장 (parse-throw)
 *   - 잘못된 입력 시 throw
 */

import { buildNotificationPayload } from '../src/notify/build-notification-payload.js'
import { NotificationPayloadSchema } from '../src/contracts.js'
import type { DetectionRecord } from '../src/contracts.js'

// ---- 헬퍼 ----

function makeThrashingRecord(overrides: Partial<DetectionRecord['final']> = {}): DetectionRecord {
  return {
    gate: {
      type: 'thrashing',
      subtype: 'repeated_tool_call',
      severity: 'critical',
      sessionId: 'sess-001',
      agentScope: 'root',
      windowRefs: ['uuid-1', 'uuid-2'],
      metrics: { repeatCount: 25 },
    },
    final: {
      kind: 'thrashing',
      subtype: 'repeated_tool_call',
      confidence: 0.92,
      signals: { structuralRepeatCount: 25 },
      evidence: [
        { uuid: 'uuid-1', ts: 1700000001000, note: '동일 tool_call 반복 #1' },
        { uuid: 'uuid-2', ts: 1700000002000, note: '동일 tool_call 반복 #2' },
      ],
      reason: '동일 argKey 25회 반복 탐지',
      ...overrides,
    },
  }
}

function makeFalseSuccessRecord(): DetectionRecord {
  return {
    gate: {
      type: 'false_success',
      subtype: 'self_approval',
      severity: 'warning',
      sessionId: 'sess-002',
      agentScope: 'root',
      windowRefs: ['uuid-3'],
      metrics: { deltaMs: 500 },
    },
    final: {
      kind: 'false_success',
      subtype: 'self_approval',
      confidence: 0.72,
      signals: { sameAuthorContext: true, temporalProximityMs: 500 },
      evidence: [{ uuid: 'uuid-3', ts: 1700000003000, note: '자기승인 탐지' }],
      reason: '자기승인 패턴: 동일 컨텍스트 내 빠른 완료선언',
    },
  }
}

// ---- 테스트 ----

describe('buildNotificationPayload — Sub-AC 2.4c', () => {
  const SESSION_ID = 'sess-001'
  const NOW_MS = 1700000010000

  describe('§7-2 #7 정본 필드 전체 존재 및 타입', () => {
    it('thrashing record → 모든 필수 필드 포함', () => {
      const record = makeThrashingRecord()
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })

      // 필드 존재 확인
      expect(payload).toHaveProperty('sessionId')
      expect(payload).toHaveProperty('kind')
      expect(payload).toHaveProperty('subtype')
      expect(payload).toHaveProperty('confidence')
      expect(payload).toHaveProperty('reason')
      expect(payload).toHaveProperty('evidence')
      expect(payload).toHaveProperty('ts')
      expect(payload).toHaveProperty('severity')
      expect(payload).toHaveProperty('dedupeKey')
    })

    it('필드 타입 및 값 검증', () => {
      const record = makeThrashingRecord()
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })

      expect(typeof payload.sessionId).toBe('string')
      expect(['thrashing', 'false_success', 'none', 'meta']).toContain(payload.kind)
      expect(typeof payload.subtype).toBe('string')
      expect(typeof payload.confidence).toBe('number')
      expect(payload.confidence).toBeGreaterThanOrEqual(0)
      expect(payload.confidence).toBeLessThanOrEqual(1)
      expect(typeof payload.reason).toBe('string')
      expect(Array.isArray(payload.evidence)).toBe(true)
      expect(typeof payload.ts).toBe('number')
      expect(['critical', 'warning', 'low_confidence', 'meta']).toContain(payload.severity)
      expect(typeof payload.dedupeKey).toBe('string')
    })

    it('zod NotificationPayloadSchema.parse를 통과한다', () => {
      const record = makeThrashingRecord()
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })

      expect(() => NotificationPayloadSchema.parse(payload)).not.toThrow()
    })
  })

  describe('DetectionVerdict 필드 → NotificationPayload 매핑', () => {
    it('sessionId는 meta.sessionId에서 설정된다', () => {
      const record = makeThrashingRecord()
      const payload = buildNotificationPayload(record, { sessionId: 'custom-session', nowMs: NOW_MS })
      expect(payload.sessionId).toBe('custom-session')
    })

    it('kind는 verdict.kind에서 복사된다', () => {
      const record = makeThrashingRecord()
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })
      expect(payload.kind).toBe('thrashing')
    })

    it('subtype은 verdict.subtype에서 복사된다', () => {
      const record = makeThrashingRecord()
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })
      expect(payload.subtype).toBe('repeated_tool_call')
    })

    it('confidence는 verdict.confidence에서 복사된다', () => {
      const record = makeThrashingRecord()
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })
      expect(payload.confidence).toBe(0.92)
    })

    it('reason은 verdict.reason에서 복사된다', () => {
      const record = makeThrashingRecord()
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })
      expect(payload.reason).toBe('동일 argKey 25회 반복 탐지')
    })

    it('ts는 meta.nowMs에서 설정된다', () => {
      const record = makeThrashingRecord()
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })
      expect(payload.ts).toBe(NOW_MS)
    })
  })

  describe('evidence 근거 동반 (사람 호출용)', () => {
    it('evidence 배열이 verdict.evidence 그대로 포함된다', () => {
      const record = makeThrashingRecord()
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })

      expect(payload.evidence).toHaveLength(2)
      expect(payload.evidence[0]).toEqual({ uuid: 'uuid-1', ts: 1700000001000, note: '동일 tool_call 반복 #1' })
      expect(payload.evidence[1]).toEqual({ uuid: 'uuid-2', ts: 1700000002000, note: '동일 tool_call 반복 #2' })
    })

    it('evidence 각 항목은 uuid·ts·note 필드를 갖는다', () => {
      const record = makeFalseSuccessRecord()
      const payload = buildNotificationPayload(record, { sessionId: 'sess-002', nowMs: NOW_MS })

      for (const item of payload.evidence) {
        expect(typeof item.uuid).toBe('string')
        expect(typeof item.ts).toBe('number')
        expect(typeof item.note).toBe('string')
      }
    })

    it('evidence가 빈 배열인 경우도 정상 처리', () => {
      const record = makeThrashingRecord({ evidence: [] })
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })
      expect(payload.evidence).toEqual([])
    })
  })

  describe('dedupeKey = sessionId + 0x1F + kind (SPEC §2.2(6))', () => {
    it('thrashing 케이스 dedupeKey 정확', () => {
      const record = makeThrashingRecord()
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })
      expect(payload.dedupeKey).toBe(`${SESSION_ID}\x1fthrashing`)
    })

    it('false_success 케이스 dedupeKey 정확', () => {
      const record = makeFalseSuccessRecord()
      const payload = buildNotificationPayload(record, { sessionId: 'sess-002', nowMs: NOW_MS })
      expect(payload.dedupeKey).toBe('sess-002\x1ffalse_success')
    })

    it('dedupeKey 구분자는 U+001F (INFORMATION SEPARATOR ONE)', () => {
      const record = makeThrashingRecord()
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })
      const parts = payload.dedupeKey.split('\x1f')
      expect(parts).toHaveLength(2)
      expect(parts[0]).toBe(SESSION_ID)
      expect(parts[1]).toBe('thrashing')
    })
  })

  describe('severity 도출 — confidence 기반', () => {
    it('confidence >= 0.85 → severity = critical', () => {
      const record = makeThrashingRecord({ confidence: 0.92 })
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })
      expect(payload.severity).toBe('critical')
    })

    it('confidence = 0.85 (경계값) → severity = critical', () => {
      const record = makeThrashingRecord({ confidence: 0.85 })
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })
      expect(payload.severity).toBe('critical')
    })

    it('confidence = 0.72 (0.5 이상 0.85 미만) → severity = warning', () => {
      const record = makeFalseSuccessRecord()
      const payload = buildNotificationPayload(record, { sessionId: 'sess-002', nowMs: NOW_MS })
      expect(payload.severity).toBe('warning')
    })

    it('confidence = 0.50 (경계값) → severity = warning', () => {
      const record = makeThrashingRecord({ confidence: 0.5 })
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })
      expect(payload.severity).toBe('warning')
    })

    it('confidence = 0.49 (0.5 미만) → severity = low_confidence', () => {
      const record = makeThrashingRecord({ confidence: 0.49 })
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })
      expect(payload.severity).toBe('low_confidence')
    })

    it('confidence = 0 → severity = low_confidence', () => {
      const record = makeThrashingRecord({ confidence: 0 })
      const payload = buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })
      expect(payload.severity).toBe('low_confidence')
    })
  })

  describe('DetectionRecord 불변 (원본 수정 없음)', () => {
    it('buildNotificationPayload 호출 후 record.final은 변경되지 않는다', () => {
      const record = makeThrashingRecord()
      const originalFinal = { ...record.final }
      const originalEvidence = record.final.evidence.map(e => ({ ...e }))

      buildNotificationPayload(record, { sessionId: SESSION_ID, nowMs: NOW_MS })

      expect(record.final).toEqual(originalFinal)
      expect(record.final.evidence).toEqual(originalEvidence)
    })
  })

  describe('false_success 케이스 통합', () => {
    it('false_success record → 전체 필드 정확 반환', () => {
      const record = makeFalseSuccessRecord()
      const payload = buildNotificationPayload(record, { sessionId: 'sess-002', nowMs: NOW_MS })

      expect(payload.sessionId).toBe('sess-002')
      expect(payload.kind).toBe('false_success')
      expect(payload.subtype).toBe('self_approval')
      expect(payload.confidence).toBe(0.72)
      expect(payload.reason).toBe('자기승인 패턴: 동일 컨텍스트 내 빠른 완료선언')
      expect(payload.evidence).toHaveLength(1)
      expect(payload.ts).toBe(NOW_MS)
      expect(payload.severity).toBe('warning')
      expect(payload.dedupeKey).toBe('sess-002\x1ffalse_success')

      // zod 통과
      expect(() => NotificationPayloadSchema.parse(payload)).not.toThrow()
    })
  })
})
