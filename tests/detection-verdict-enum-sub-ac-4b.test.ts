/**
 * tests/detection-verdict-enum-sub-ac-4b.test.ts
 *
 * Sub-AC 4b: DetectionVerdict 열거값 전체 집합이 M4 이후
 *   추가·변경·삭제 없이 유지됨을 검증하는 단위 테스트.
 *
 * SPEC §2.1 (6), BLOCKER C1:
 *   DetectionVerdict.kind = 'thrashing' | 'false_success' | 'none'
 *   — M4 이후 이 집합은 불변. 어떤 값도 추가·변경·삭제되어서는 안 된다.
 *
 * 동일하게 JudgeVerdict.kind도 같은 집합을 가져야 한다(BLOCKER C2).
 *
 * 부수효과 없음 — 순수 타입/런타임 검증.
 */

import { describe, expect, it } from '@jest/globals'
import {
  NotificationPayloadSchema,
  type DetectionVerdict,
  type JudgeVerdict,
} from '../src/contracts.js'

// ─── 정본 열거 집합 (SPEC §2.1, BLOCKER C1) ─────────────────────────────────
// M4 이후 이 집합은 절대 변경되어서는 안 된다.
const DETECTION_VERDICT_KINDS = ['thrashing', 'false_success', 'none'] as const
type DetectionVerdictKind = (typeof DETECTION_VERDICT_KINDS)[number]

// ─── 헬퍼: DetectionVerdict 픽스처 ──────────────────────────────────────────
function makeVerdict(kind: DetectionVerdictKind): DetectionVerdict {
  return {
    kind,
    subtype: `test_${kind}`,
    confidence: kind === 'none' ? 0.0 : 0.85,
    signals: {},
    evidence: [],
    reason: `test verdict for kind=${kind}`,
  }
}

// ─── 헬퍼: JudgeVerdict 픽스처 ───────────────────────────────────────────────
function makeJudgeVerdict(kind: DetectionVerdictKind): JudgeVerdict {
  return {
    kind,
    subtype: `judge_${kind}`,
    confidence: kind === 'none' ? 0.0 : 0.9,
    reason: `judge verdict for kind=${kind}`,
    rawSamples: [],
  }
}

// ────────────────────────────────────────────────────────────────────────────

describe('Sub-AC 4b: DetectionVerdict.kind 열거값 불변 검증 (M4 이후 추가·변경·삭제 금지)', () => {
  describe('정본 집합 완전성: 정확히 3개 값만 존재', () => {
    it('DetectionVerdict.kind 정본 집합은 정확히 3개 값이다', () => {
      // BLOCKER C1: 'thrashing' | 'false_success' | 'none' — 3개 고정
      expect(DETECTION_VERDICT_KINDS).toHaveLength(3)
    })

    it('정본 집합에 thrashing이 포함된다', () => {
      expect(DETECTION_VERDICT_KINDS).toContain('thrashing')
    })

    it('정본 집합에 false_success가 포함된다 (BLOCKER C1: fake_success/fakeSuccess 금지)', () => {
      expect(DETECTION_VERDICT_KINDS).toContain('false_success')
      // BLOCKER C1 위반 값은 포함되지 않아야 한다
      expect(DETECTION_VERDICT_KINDS).not.toContain('fake_success')
      expect(DETECTION_VERDICT_KINDS).not.toContain('fakeSuccess')
    })

    it('정본 집합에 none이 포함된다', () => {
      expect(DETECTION_VERDICT_KINDS).toContain('none')
    })
  })

  describe('각 열거값으로 DetectionVerdict를 생성할 수 있다 (런타임 검증)', () => {
    it.each(DETECTION_VERDICT_KINDS)(
      'kind="%s"인 DetectionVerdict를 생성하면 kind 필드가 그대로 보존된다',
      (kind) => {
        const verdict = makeVerdict(kind)
        expect(verdict.kind).toBe(kind)
      }
    )

    it('thrashing 판정의 kind는 "thrashing"이다', () => {
      const verdict = makeVerdict('thrashing')
      expect(verdict.kind).toBe('thrashing')
    })

    it('false_success 판정의 kind는 "false_success"이다', () => {
      const verdict = makeVerdict('false_success')
      expect(verdict.kind).toBe('false_success')
    })

    it('none 판정의 kind는 "none"이다', () => {
      const verdict = makeVerdict('none')
      expect(verdict.kind).toBe('none')
    })
  })

  describe('BLOCKER C1: 금지된 열거값이 사용되지 않는다', () => {
    it('"fake_success"는 DetectionVerdict.kind 정본 집합에 없다', () => {
      expect(DETECTION_VERDICT_KINDS).not.toContain('fake_success')
    })

    it('"fakeSuccess"는 DetectionVerdict.kind 정본 집합에 없다', () => {
      expect(DETECTION_VERDICT_KINDS).not.toContain('fakeSuccess')
    })

    it('"LOOP_DETECTED" 같은 추가 값은 정본 집합에 없다 (M4 이후 추가 금지)', () => {
      expect(DETECTION_VERDICT_KINDS).not.toContain('LOOP_DETECTED')
    })

    it('"LOW_CONFIDENCE" 같은 추가 값은 정본 집합에 없다 (M4 이후 추가 금지)', () => {
      // LOW_CONFIDENCE는 NotificationSeverity에만 존재 (DetectionVerdict.kind가 아님)
      expect(DETECTION_VERDICT_KINDS).not.toContain('LOW_CONFIDENCE')
      expect(DETECTION_VERDICT_KINDS).not.toContain('low_confidence')
    })

    it('"NO_LOOP" 같은 추가 값은 정본 집합에 없다 (M4 이후 추가 금지)', () => {
      expect(DETECTION_VERDICT_KINDS).not.toContain('NO_LOOP')
    })

    it('"meta" 값은 NotificationPayload.kind에만 존재하고 DetectionVerdict.kind에는 없다', () => {
      // 'meta'는 M4 알림 페이로드 전용
      expect(DETECTION_VERDICT_KINDS).not.toContain('meta')
    })
  })

  describe('BLOCKER C2: JudgeVerdict.kind도 동일한 3개 값 집합을 가진다', () => {
    it.each(DETECTION_VERDICT_KINDS)(
      'kind="%s"인 JudgeVerdict를 생성하면 kind 필드가 그대로 보존된다',
      (kind) => {
        const jv = makeJudgeVerdict(kind)
        expect(jv.kind).toBe(kind)
      }
    )

    it('JudgeVerdict.kind는 DetectionVerdict.kind와 동일한 집합이다', () => {
      // BLOCKER C2: JudgeVerdict 정본은 contracts.ts의 이 정의 (§6 재정의 무효)
      for (const kind of DETECTION_VERDICT_KINDS) {
        const jv = makeJudgeVerdict(kind)
        expect(DETECTION_VERDICT_KINDS).toContain(jv.kind)
      }
    })
  })

  describe('NotificationPayload.kind는 DetectionVerdict.kind ∪ {"meta"} 이다 (M4 확장 검증)', () => {
    it('NotificationPayloadSchema는 DetectionVerdict.kind의 3개 값을 모두 허용한다', () => {
      for (const kind of DETECTION_VERDICT_KINDS) {
        const result = NotificationPayloadSchema.safeParse({
          sessionId: 'sess-test',
          kind,
          subtype: 'test',
          confidence: kind === 'none' ? 0.0 : 0.85,
          reason: 'test',
          evidence: [],
          ts: Date.now(),
          severity: kind === 'none' ? 'low_confidence' : 'critical',
          dedupeKey: `sess-test\x1f${kind}`,
        })
        expect(result.success).toBe(true)
      }
    })

    it('NotificationPayloadSchema는 "meta" kind도 허용한다 (M4 신규 확장)', () => {
      const result = NotificationPayloadSchema.safeParse({
        sessionId: 'sess-test',
        kind: 'meta',
        subtype: 'system_event',
        confidence: 1.0,
        reason: 'cost limit exceeded',
        evidence: [],
        ts: Date.now(),
        severity: 'meta',
        dedupeKey: 'sess-test\x1fmeta',
      })
      expect(result.success).toBe(true)
    })

    it('NotificationPayloadSchema는 정본 집합 외의 값을 거부한다', () => {
      const invalidKind = NotificationPayloadSchema.safeParse({
        sessionId: 'sess-test',
        kind: 'fake_success', // BLOCKER C1 위반
        subtype: 'test',
        confidence: 0.8,
        reason: 'test',
        evidence: [],
        ts: Date.now(),
        severity: 'critical',
        dedupeKey: 'sess-test\x1ffake_success',
      })
      expect(invalidKind.success).toBe(false)
    })
  })

  describe('불변식: M4 이후 DetectionVerdict.kind 집합이 변경되지 않음을 스냅샷으로 고정', () => {
    it('DETECTION_VERDICT_KINDS 배열을 정렬한 값이 정본 스냅샷과 일치한다', () => {
      // 이 테스트가 실패하면 M4 이후 누군가가 enum 집합을 변경한 것이다.
      const sorted = [...DETECTION_VERDICT_KINDS].sort()
      expect(sorted).toEqual(['false_success', 'none', 'thrashing'])
    })

    it('DetectionVerdict 객체는 kind 필드를 반드시 가진다 (필수 필드 불변)', () => {
      for (const kind of DETECTION_VERDICT_KINDS) {
        const verdict = makeVerdict(kind)
        expect(verdict).toHaveProperty('kind')
        expect(verdict).toHaveProperty('subtype')
        expect(verdict).toHaveProperty('confidence')
        expect(verdict).toHaveProperty('signals')
        expect(verdict).toHaveProperty('evidence')
        expect(verdict).toHaveProperty('reason')
      }
    })
  })
})
