/**
 * tests/debias-judge-call-sub-ac-5d-2.test.ts
 *
 * Sub-AC 5d-2: debiasJudgeCall — conflicting verdicts에서 tie-breaking 및
 * majority-selection 로직 검증.
 *
 * AC 요구사항:
 *   "Unit test debias_judge_call with a mock judge that returns conflicting verdicts
 *    across calls (e.g., 1 false_success vs 1 non-false_success for n_samples=2,
 *    and 2 vs 1 split for n_samples=3) to verify tie-breaking and majority-selection
 *    logic produces the correct final JudgeVerdict."
 *
 * 검증 항목:
 *
 *   1. Tie-breaking (n_samples=2, 1:1 동수)
 *      T1. false_success vs none → false_success (우선순위: false_success > none)
 *      T2. thrashing vs false_success → thrashing (우선순위: thrashing > false_success)
 *      T3. thrashing vs none → thrashing (우선순위: thrashing > none)
 *      T4. false_success vs thrashing (역순 입력) → thrashing (순서 무관, 우선순위 적용)
 *      T5. none vs thrashing (역순 입력) → thrashing (순서 무관, 우선순위 적용)
 *
 *   2. Majority-selection (n_samples=3, 2:1 split)
 *      M1. false_success×2 vs none×1 → false_success (2:1 다수결)
 *      M2. thrashing×2 vs false_success×1 → thrashing (2:1 다수결)
 *      M3. none×2 vs false_success×1 → none (2:1 다수결)
 *      M4. false_success×2 vs thrashing×1 → false_success (2:1 다수결)
 *      M5. thrashing×1 vs false_success×2 → false_success (2:1 다수결, 역순 입력)
 *
 *   3. Majority-selection confidence 검증 (2:1 split)
 *      C1. winning samples의 confidence 평균만 사용 (패배 sample 제외)
 *      C2. n_samples=2 동수 시 tie-winner의 confidence만 사용
 *
 *   4. rawSamples 보존 검증
 *      R1. n_samples=2 충돌 시 rawSamples.length=2 (전체 보존)
 *      R2. n_samples=3 충돌 시 rawSamples.length=3 (전체 보존, 패배 sample도 포함)
 *      R3. rawSamples 순서는 호출 순서와 동일
 *
 *   5. subtype/reason은 winning sample 대표값(첫 번째) 반영
 *      S1. n_samples=3, false_success 2:1 — subtype/reason이 첫 번째 winning sample 값
 *      S2. n_samples=2, tie → thrashing — subtype/reason이 thrashing sample 값
 *
 * 외부 API 절대 미호출 — 모든 테스트는 Mock judge_fn으로만 동작.
 */

import { debiasJudgeCall, type JudgeFn } from '../src/detect/debias-judge.js'
import { buildFalseSuccessRubric } from '../src/detect/false-success-rubric.js'
import { MockJudgeClient, type MockJudgeCacheEntry } from '../src/api/judge-client.js'
import type { JudgeVerdict } from '../src/contracts.js'

// ── 픽스처 ────────────────────────────────────────────────────────────────────

const DEFAULT_RUBRIC = buildFalseSuccessRubric()
const SAMPLE_TEXT = '작업이 완료되었습니다.'

/** false_success 판정 샘플 A (첫 번째 winning sample용) */
const FALSE_SUCCESS_A: JudgeVerdict = Object.freeze({
  kind: 'false_success' as const,
  subtype: 'unverified_completion',
  confidence: 0.85,
  reason: '완료선언이 있으나 검증 없음 (샘플 A).',
  rawSamples: [],
})

/** false_success 판정 샘플 B (두 번째 winning sample용) */
const FALSE_SUCCESS_B: JudgeVerdict = Object.freeze({
  kind: 'false_success' as const,
  subtype: 'unverified_completion',
  confidence: 0.75,
  reason: '완료선언이 있으나 검증 없음 (샘플 B).',
  rawSamples: [],
})

/** thrashing 판정 샘플 A */
const THRASHING_A: JudgeVerdict = Object.freeze({
  kind: 'thrashing' as const,
  subtype: 'stuck_error_loop',
  confidence: 0.90,
  reason: '동일 에러 루프 감지 (샘플 A).',
  rawSamples: [],
})

/** thrashing 판정 샘플 B */
const THRASHING_B: JudgeVerdict = Object.freeze({
  kind: 'thrashing' as const,
  subtype: 'stuck_error_loop',
  confidence: 0.80,
  reason: '동일 에러 루프 감지 (샘플 B).',
  rawSamples: [],
})

/** none 판정 샘플 */
const NONE_A: JudgeVerdict = Object.freeze({
  kind: 'none' as const,
  subtype: '',
  confidence: 0.15,
  reason: '판정 근거 불충분.',
  rawSamples: [],
})

/**
 * 순서대로 verdict를 반환하는 Mock judge_fn 생성.
 * verdicts 배열 순서대로 반환하며, 초과 시 마지막 verdict 반복.
 */
function makeSequentialJudgeFn(verdicts: readonly JudgeVerdict[]): JudgeFn {
  let idx = 0
  return async (_text, _rubric, _llmClient) => {
    const verdict = verdicts[idx] ?? verdicts[verdicts.length - 1]!
    idx++
    return verdict
  }
}

/** 더미 MockJudgeClient (judge_fn에 전달되지만 위 mock fn에서 직접 사용 안 함) */
const DUMMY_CLIENT = new MockJudgeClient([
  {
    cacheKey: 'dummy:claude-3-5-sonnet-20241022',
    verdict: FALSE_SUCCESS_A,
  } satisfies MockJudgeCacheEntry,
])

// ── 1. Tie-breaking (n_samples=2, 1:1 동수) ──────────────────────────────────

describe('debiasJudgeCall — tie-breaking (n_samples=2, 1:1 동수)', () => {
  test('T1. false_success vs none (1:1) → false_success 선택 (우선순위: false_success > none)', async () => {
    const fn = makeSequentialJudgeFn([FALSE_SUCCESS_A, NONE_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('false_success')
  })

  test('T2. thrashing vs false_success (1:1) → thrashing 선택 (우선순위: thrashing > false_success)', async () => {
    const fn = makeSequentialJudgeFn([THRASHING_A, FALSE_SUCCESS_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('thrashing')
  })

  test('T3. thrashing vs none (1:1) → thrashing 선택 (우선순위: thrashing > none)', async () => {
    const fn = makeSequentialJudgeFn([THRASHING_A, NONE_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('thrashing')
  })

  test('T4. false_success vs thrashing (역순 입력, 1:1) → 여전히 thrashing 선택 (입력 순서 무관)', async () => {
    // T2와 역순: false_success 먼저, thrashing 나중
    const fn = makeSequentialJudgeFn([FALSE_SUCCESS_A, THRASHING_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    // 순서가 바뀌어도 우선순위는 thrashing > false_success
    expect(result.kind).toBe('thrashing')
  })

  test('T5. none vs thrashing (역순 입력, 1:1) → 여전히 thrashing 선택 (입력 순서 무관)', async () => {
    const fn = makeSequentialJudgeFn([NONE_A, THRASHING_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('thrashing')
  })
})

// ── 2. Majority-selection (n_samples=3, 2:1 split) ───────────────────────────

describe('debiasJudgeCall — majority-selection (n_samples=3, 2:1 split)', () => {
  test('M1. false_success×2 vs none×1 → false_success (2:1 다수결)', async () => {
    const fn = makeSequentialJudgeFn([FALSE_SUCCESS_A, FALSE_SUCCESS_B, NONE_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.kind).toBe('false_success')
  })

  test('M2. thrashing×2 vs false_success×1 → thrashing (2:1 다수결)', async () => {
    const fn = makeSequentialJudgeFn([THRASHING_A, THRASHING_B, FALSE_SUCCESS_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.kind).toBe('thrashing')
  })

  test('M3. none×2 vs false_success×1 → none (2:1 다수결, none이 다수)', async () => {
    const none2: JudgeVerdict = { ...NONE_A }
    const fn = makeSequentialJudgeFn([NONE_A, none2, FALSE_SUCCESS_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.kind).toBe('none')
  })

  test('M4. false_success×2 vs thrashing×1 → false_success (2:1 다수결)', async () => {
    const fn = makeSequentialJudgeFn([FALSE_SUCCESS_A, FALSE_SUCCESS_B, THRASHING_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.kind).toBe('false_success')
  })

  test('M5. thrashing×1 먼저, false_success×2 나중 → false_success (2:1 다수결, 역순 입력)', async () => {
    const fn = makeSequentialJudgeFn([THRASHING_A, FALSE_SUCCESS_A, FALSE_SUCCESS_B])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    // 호출 순서와 무관하게 다수(false_success 2개)가 선택된다
    expect(result.kind).toBe('false_success')
  })
})

// ── 3. Majority-selection confidence 검증 ────────────────────────────────────

describe('debiasJudgeCall — confidence 계산 검증 (winning samples만)', () => {
  test('C1. n_samples=3, false_success×2(conf 0.85, 0.75) vs none×1(conf 0.15) → confidence=(0.85+0.75)/2=0.80', async () => {
    const fn = makeSequentialJudgeFn([FALSE_SUCCESS_A, FALSE_SUCCESS_B, NONE_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.kind).toBe('false_success')
    // winning: false_success×2, conf avg = (0.85 + 0.75) / 2 = 0.80
    expect(result.confidence).toBeCloseTo(0.80, 5)
  })

  test('C2. n_samples=2, thrashing(conf 0.90) vs false_success(conf 0.85) 동수 → thrashing 선택, confidence=0.90 (thrashing 단독)', async () => {
    const fn = makeSequentialJudgeFn([THRASHING_A, FALSE_SUCCESS_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('thrashing')
    // tie-breaking으로 thrashing이 선택됨 → winning sample = THRASHING_A만
    expect(result.confidence).toBeCloseTo(THRASHING_A.confidence, 5)
  })

  test('C3. n_samples=3, thrashing×2(conf 0.90, 0.80) vs none×1 → confidence=(0.90+0.80)/2=0.85', async () => {
    const fn = makeSequentialJudgeFn([THRASHING_A, THRASHING_B, NONE_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.kind).toBe('thrashing')
    // winning: thrashing×2, conf avg = (0.90 + 0.80) / 2 = 0.85
    expect(result.confidence).toBeCloseTo(0.85, 5)
  })
})

// ── 4. rawSamples 보존 검증 ───────────────────────────────────────────────────

describe('debiasJudgeCall — rawSamples 전체 보존 (충돌 verdicts 포함)', () => {
  test('R1. n_samples=2 충돌(false_success, none) → rawSamples.length=2 (전체 보존)', async () => {
    const fn = makeSequentialJudgeFn([FALSE_SUCCESS_A, NONE_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.rawSamples).toHaveLength(2)
  })

  test('R2. n_samples=3 충돌(false_success×2, none×1) → rawSamples.length=3 (패배 sample도 보존)', async () => {
    const fn = makeSequentialJudgeFn([FALSE_SUCCESS_A, FALSE_SUCCESS_B, NONE_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    // rawSamples에는 패배한 none 샘플도 포함되어야 함 (감사용)
    expect(result.rawSamples).toHaveLength(3)
  })

  test('R3. rawSamples 순서는 호출 순서와 동일 (첫 번째=false_success, 두 번째=thrashing, 세 번째=none)', async () => {
    const fn = makeSequentialJudgeFn([FALSE_SUCCESS_A, THRASHING_A, NONE_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.rawSamples).toHaveLength(3)
    expect((result.rawSamples[0] as JudgeVerdict).kind).toBe('false_success')
    expect((result.rawSamples[1] as JudgeVerdict).kind).toBe('thrashing')
    expect((result.rawSamples[2] as JudgeVerdict).kind).toBe('none')
  })

  test('R4. n_samples=2 tie(thrashing, false_success) → rawSamples 양쪽 모두 포함', async () => {
    const fn = makeSequentialJudgeFn([THRASHING_A, FALSE_SUCCESS_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.rawSamples).toHaveLength(2)
    const kinds = result.rawSamples.map(s => (s as JudgeVerdict).kind)
    expect(kinds).toContain('thrashing')
    expect(kinds).toContain('false_success')
  })
})

// ── 5. subtype/reason 대표값 검증 ────────────────────────────────────────────

describe('debiasJudgeCall — subtype/reason은 첫 번째 winning sample 반영', () => {
  test('S1. n_samples=3, false_success(A) → false_success(B) → none: subtype/reason=A(첫 번째 winning)', async () => {
    const fn = makeSequentialJudgeFn([FALSE_SUCCESS_A, FALSE_SUCCESS_B, NONE_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.kind).toBe('false_success')
    // 첫 번째 winning sample = FALSE_SUCCESS_A
    expect(result.subtype).toBe(FALSE_SUCCESS_A.subtype)
    expect(result.reason).toBe(FALSE_SUCCESS_A.reason)
  })

  test('S2. n_samples=2, tie(thrashing vs false_success) → thrashing: subtype/reason=THRASHING_A', async () => {
    const fn = makeSequentialJudgeFn([THRASHING_A, FALSE_SUCCESS_A])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('thrashing')
    expect(result.subtype).toBe(THRASHING_A.subtype)
    expect(result.reason).toBe(THRASHING_A.reason)
  })

  test('S3. n_samples=3, thrashing(A) → none → thrashing(B): subtype/reason=THRASHING_A(첫 번째 winning)', async () => {
    const fn = makeSequentialJudgeFn([THRASHING_A, NONE_A, THRASHING_B])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.kind).toBe('thrashing')
    // 첫 번째 winning sample = THRASHING_A (호출 순서 첫 번째)
    expect(result.subtype).toBe(THRASHING_A.subtype)
    expect(result.reason).toBe(THRASHING_A.reason)
  })
})
