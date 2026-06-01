/**
 * tests/build-low-confidence-payload-sub-ac-6a.test.ts
 *
 * AC 6a: buildLowConfidencePayload + isJudgeErrorOrDeferred 단위 테스트.
 *
 * 검증 범주:
 *   1. lowConfidenceNotify=false → null 반환 (기본값 동작)
 *   2. lowConfidenceNotify=true, judgeError=true → payload 반환 (severity='low_confidence')
 *   3. lowConfidenceNotify=true, deferred=true → payload 반환 (severity='low_confidence')
 *   4. lowConfidenceNotify=true, 둘 다 false/undefined → 여전히 payload 반환(함수는 플래그만 참조)
 *   5. 반환 payload 필드 검증 (§7-2 #7 정본 필드 모두 포함)
 *   6. dedupeKey = sessionId + '\x1f' + kind
 *   7. isJudgeErrorOrDeferred 케이스 분기
 *   8. zod 스키마 검증 통과 확인
 *   9. 부수효과 없음 — record 원본 불변
 */

import { describe, it, expect } from '@jest/globals'
import {
  buildLowConfidencePayload,
  isJudgeErrorOrDeferred,
} from '../src/notify/build-low-confidence-payload.js'
import type { DetectionRecord } from '../src/contracts.js'
import { NotificationPayloadSchema } from '../src/contracts.js'

// ──────────────────────────────────────────────
// 테스트용 픽스처
// ──────────────────────────────────────────────

const SESSION_ID = 'session-abc-123'
const NOW_MS = 1_700_000_000_000

/** 기본 DetectionRecord 픽스처 (judgeError/deferred=true) */
function makeRecord(overrides: Partial<DetectionRecord> = {}): Pick<
  DetectionRecord,
  'final' | 'judgeError' | 'deferred'
> {
  return {
    final: {
      kind: 'thrashing',
      subtype: 'repeated_tool_call',
      confidence: 0.4,
      signals: { temporalProximityMs: 1200 },
      evidence: [{ uuid: 'ev-001', ts: 1_700_000_000_000, note: 'loop detected' }],
      reason: 'judge API failed; result deferred',
    },
    judgeError: true,
    deferred: true,
    ...overrides,
  }
}

const META = { sessionId: SESSION_ID, nowMs: NOW_MS }

// ──────────────────────────────────────────────
// buildLowConfidencePayload
// ──────────────────────────────────────────────

describe('buildLowConfidencePayload', () => {
  // ---- null 반환 케이스 ----

  describe('lowConfidenceNotify=false (기본값)', () => {
    it('judgeError=true이라도 null을 반환한다', () => {
      const record = makeRecord({ judgeError: true, deferred: true })
      const result = buildLowConfidencePayload(record, META, false)
      expect(result).toBeNull()
    })

    it('deferred=true이라도 null을 반환한다', () => {
      const record = makeRecord({ judgeError: false, deferred: true })
      const result = buildLowConfidencePayload(record, META, false)
      expect(result).toBeNull()
    })

    it('둘 다 false이면 null을 반환한다', () => {
      const record = makeRecord({ judgeError: false, deferred: false })
      const result = buildLowConfidencePayload(record, META, false)
      expect(result).toBeNull()
    })

    it('undefined(미설정)인 경우에도 null을 반환한다', () => {
      const record = makeRecord({ judgeError: undefined, deferred: undefined })
      const result = buildLowConfidencePayload(record, META, false)
      expect(result).toBeNull()
    })
  })

  // ---- payload 반환 케이스 ----

  describe('lowConfidenceNotify=true, judgeError=true', () => {
    it('NotificationPayload를 반환한다', () => {
      const record = makeRecord({ judgeError: true, deferred: true })
      const result = buildLowConfidencePayload(record, META, true)
      expect(result).not.toBeNull()
    })

    it('severity=low_confidence를 설정한다', () => {
      const record = makeRecord({ judgeError: true, deferred: true })
      const result = buildLowConfidencePayload(record, META, true)!
      expect(result.severity).toBe('low_confidence')
    })

    it('고신뢰도이더라도 severity=low_confidence를 유지한다', () => {
      const record = makeRecord({
        judgeError: true,
        deferred: true,
        final: {
          ...makeRecord().final,
          confidence: 0.95, // 고신뢰도지만 judgeError이므로 low_confidence
        },
      })
      const result = buildLowConfidencePayload(record, META, true)!
      expect(result.severity).toBe('low_confidence')
    })
  })

  describe('lowConfidenceNotify=true, deferred=true (judgeError=false)', () => {
    it('NotificationPayload를 반환한다', () => {
      const record = makeRecord({ judgeError: false, deferred: true })
      const result = buildLowConfidencePayload(record, META, true)
      expect(result).not.toBeNull()
      expect(result!.severity).toBe('low_confidence')
    })
  })

  describe('lowConfidenceNotify=true, judgeError/deferred 모두 미설정', () => {
    it('함수는 플래그(lowConfidenceNotify)만 참조하므로 payload를 반환한다', () => {
      // 함수는 judgeError/deferred 여부를 체크하지 않고 lowConfidenceNotify만 본다.
      // 가드(isJudgeErrorOrDeferred)는 호출자가 사용.
      const record = makeRecord({ judgeError: undefined, deferred: undefined })
      const result = buildLowConfidencePayload(record, META, true)
      expect(result).not.toBeNull()
      expect(result!.severity).toBe('low_confidence')
    })
  })

  // ---- 페이로드 필드 완전성 (§7-2 #7 정본) ----

  describe('반환 payload 필드 검증', () => {
    it('sessionId가 주입된 세션 ID와 일치한다', () => {
      const record = makeRecord()
      const result = buildLowConfidencePayload(record, META, true)!
      expect(result.sessionId).toBe(SESSION_ID)
    })

    it('kind가 verdict.kind와 일치한다', () => {
      const record = makeRecord()
      const result = buildLowConfidencePayload(record, META, true)!
      expect(result.kind).toBe(record.final.kind)
    })

    it('subtype이 verdict.subtype과 일치한다', () => {
      const record = makeRecord()
      const result = buildLowConfidencePayload(record, META, true)!
      expect(result.subtype).toBe(record.final.subtype)
    })

    it('confidence가 verdict.confidence와 일치한다', () => {
      const record = makeRecord()
      const result = buildLowConfidencePayload(record, META, true)!
      expect(result.confidence).toBe(record.final.confidence)
    })

    it('reason이 verdict.reason과 일치한다', () => {
      const record = makeRecord()
      const result = buildLowConfidencePayload(record, META, true)!
      expect(result.reason).toBe(record.final.reason)
    })

    it('evidence가 verdict.evidence와 동일하다 (사람 호출용 근거)', () => {
      const record = makeRecord()
      const result = buildLowConfidencePayload(record, META, true)!
      expect(result.evidence).toEqual(record.final.evidence)
    })

    it('ts가 nowMs와 일치한다', () => {
      const record = makeRecord()
      const result = buildLowConfidencePayload(record, META, true)!
      expect(result.ts).toBe(NOW_MS)
    })

    it('dedupeKey = sessionId + 0x1f + kind (SPEC §2.2(6))', () => {
      const record = makeRecord()
      const result = buildLowConfidencePayload(record, META, true)!
      const expectedKey = `${SESSION_ID}\x1f${record.final.kind}`
      expect(result.dedupeKey).toBe(expectedKey)
    })

    it('false_success kind에 대한 dedupeKey가 올바르다', () => {
      const record = makeRecord({
        final: {
          kind: 'false_success',
          subtype: 'self_approval',
          confidence: 0.3,
          signals: {},
          evidence: [],
          reason: 'deferred',
        },
      })
      const result = buildLowConfidencePayload(record, META, true)!
      expect(result.dedupeKey).toBe(`${SESSION_ID}\x1ffalse_success`)
    })
  })

  // ---- zod 스키마 검증 ----

  describe('zod 스키마 검증', () => {
    it('반환 payload가 NotificationPayloadSchema를 통과한다', () => {
      const record = makeRecord()
      const result = buildLowConfidencePayload(record, META, true)!
      expect(() => NotificationPayloadSchema.parse(result)).not.toThrow()
    })

    it('null 반환 케이스에서 스키마 검증이 호출되지 않는다 (부수효과 없음)', () => {
      const record = makeRecord()
      const result = buildLowConfidencePayload(record, META, false)
      // null이므로 스키마 parse 자체가 호출되지 않음
      expect(result).toBeNull()
    })
  })

  // ---- 불변성: record 원본 변경 없음 ----

  describe('불변성', () => {
    it('record 원본을 변경하지 않는다', () => {
      const record = makeRecord()
      const originalFinal = { ...record.final }
      const originalEvidence = [...record.final.evidence]

      buildLowConfidencePayload(record, META, true)

      expect(record.final).toEqual(originalFinal)
      expect(record.final.evidence).toEqual(originalEvidence)
      expect(record.judgeError).toBe(true)
      expect(record.deferred).toBe(true)
    })

    it('반환 payload의 evidence를 변경해도 record 원본에 영향 없다', () => {
      const record = makeRecord()
      const result = buildLowConfidencePayload(record, META, true)!

      // payload evidence를 직접 변경 시도
      ;(result.evidence as Array<{ uuid: string; ts: number; note: string }>).push({
        uuid: 'injected',
        ts: 0,
        note: 'injected',
      })

      // record 원본은 영향받지 않아야 함
      expect(record.final.evidence).toHaveLength(1)
    })
  })
})

// ──────────────────────────────────────────────
// isJudgeErrorOrDeferred
// ──────────────────────────────────────────────

describe('isJudgeErrorOrDeferred', () => {
  it('judgeError=true → true', () => {
    expect(isJudgeErrorOrDeferred({ judgeError: true, deferred: false })).toBe(true)
  })

  it('deferred=true → true', () => {
    expect(isJudgeErrorOrDeferred({ judgeError: false, deferred: true })).toBe(true)
  })

  it('둘 다 true → true', () => {
    expect(isJudgeErrorOrDeferred({ judgeError: true, deferred: true })).toBe(true)
  })

  it('둘 다 false → false', () => {
    expect(isJudgeErrorOrDeferred({ judgeError: false, deferred: false })).toBe(false)
  })

  it('둘 다 undefined → false', () => {
    expect(isJudgeErrorOrDeferred({ judgeError: undefined, deferred: undefined })).toBe(false)
  })

  it('judgeError=undefined, deferred=true → true', () => {
    expect(isJudgeErrorOrDeferred({ judgeError: undefined, deferred: true })).toBe(true)
  })

  it('judgeError=true, deferred=undefined → true', () => {
    expect(isJudgeErrorOrDeferred({ judgeError: true, deferred: undefined })).toBe(true)
  })

  it('통합: isJudgeErrorOrDeferred 가드 + buildLowConfidencePayload 조합', () => {
    const record = makeRecord({ judgeError: true, deferred: true })
    const isLowConf = isJudgeErrorOrDeferred(record)
    // 가드 통과: payload 생성
    const payload = buildLowConfidencePayload(record, META, isLowConf)
    // isLowConf=true이므로 payload 반환
    expect(payload).not.toBeNull()
    expect(payload!.severity).toBe('low_confidence')
  })

  it('통합: isJudgeErrorOrDeferred=false면 buildLowConfidencePayload(_, _, false) → null', () => {
    const record = makeRecord({ judgeError: false, deferred: false })
    const isLowConf = isJudgeErrorOrDeferred(record)
    // 가드 미통과: payload 없음
    const payload = buildLowConfidencePayload(record, META, isLowConf)
    expect(payload).toBeNull()
  })
})
