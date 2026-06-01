/**
 * tests/debias-judge-call-sub-ac-5d-3.test.ts
 *
 * Sub-AC 5d-3: debiasJudgeCall — call-counting mock으로 judge_fn 호출 횟수가
 * 정확히 n_samples회인지, 그리고 반환된 JudgeVerdict의 confidence가 올바르게
 * 집계(aggregation)되는지 검증한다.
 *
 * 핵심 검증:
 *   1. judge_fn은 정확히 n_samples회 호출된다 (초과도, 미달도 없다)
 *   2. 반환 JudgeVerdict.confidence는 winning samples의 평균이다
 *
 * 테스트 구조:
 *
 *   CALL_COUNT_* — judge_fn 호출 횟수 정확성 (call-counting mock 사용)
 *     CC1. n_samples=1 → judge_fn 정확히 1회 호출
 *     CC2. n_samples=2 → judge_fn 정확히 2회 호출
 *     CC3. n_samples=3 → judge_fn 정확히 3회 호출
 *     CC4. n_samples=5 → judge_fn 정확히 5회 호출
 *     CC5. n_samples=10 → judge_fn 정확히 10회 호출
 *     CC6. n_samples=0 → judge_fn 0회 호출 (미호출)
 *     CC7. n_samples=-1 → judge_fn 0회 호출 (미호출)
 *     CC8. 기본값 n_samples=2 → judge_fn 정확히 2회 호출
 *     CC9. 조기 실패 시 실패 시점까지만 호출 (fail-closed)
 *
 *   CONFIDENCE_* — confidence 집계 정확성 (aggregated confidence/score)
 *     CF1. n_samples=1, 단일 verdict → confidence = 그 verdict의 confidence
 *     CF2. n_samples=2, 동종 unanimous → confidence = 두 값의 산술 평균
 *     CF3. n_samples=3, 2:1 다수결 → confidence = winning 2개의 평균 (패배 제외)
 *     CF4. n_samples=4, unanimous → confidence = 4개 모두의 평균
 *     CF5. n_samples=3, 1:1:1 3-way tie → tie-breaking 종류의 confidence 반환
 *     CF6. n_samples=5, 3:2 split → confidence = winning 3개의 평균
 *     CF7. n_samples=2, 동수(tie) → tie-winner 1개의 confidence 반환
 *     CF8. n_samples=0 → confidence = 0 (majorityVote([]) 계약)
 *
 *   INVARIANTS_* — 불변 계약 검증
 *     INV1. 반환 rawSamples.length === n_samples (모든 표본 보존)
 *     INV2. 반환 kind는 'thrashing' | 'false_success' | 'none' 중 하나 (BLOCKER C1)
 *     INV3. 반환 confidence ∈ [0, 1] 범위
 *     INV4. 동일 입력 반복 호출 → 동일 호출 횟수 (결정론)
 *
 * 외부 API 절대 미호출 — 모든 테스트는 call-counting Mock judge_fn으로만 동작.
 */

import { debiasJudgeCall, type JudgeFn } from '../src/detect/debias-judge.js'
import { buildFalseSuccessRubric } from '../src/detect/false-success-rubric.js'
import { MockJudgeClient, type MockJudgeCacheEntry } from '../src/api/judge-client.js'
import type { JudgeVerdict } from '../src/contracts.js'

// ── 픽스처 ────────────────────────────────────────────────────────────────────

const DEFAULT_RUBRIC = buildFalseSuccessRubric()
const SAMPLE_TEXT = '작업이 완료되었습니다. 모든 테스트가 통과했습니다.'

// 픽스처 verdicts — 다양한 confidence로 집계 검증에 사용
const FALSE_SUCCESS_90: JudgeVerdict = Object.freeze({
  kind: 'false_success' as const,
  subtype: 'unverified_completion',
  confidence: 0.90,
  reason: '완료선언이 있으나 검증 없음.',
  rawSamples: [],
})

const FALSE_SUCCESS_80: JudgeVerdict = Object.freeze({
  kind: 'false_success' as const,
  subtype: 'unverified_completion',
  confidence: 0.80,
  reason: '완료선언이 있으나 검증 없음 (B).',
  rawSamples: [],
})

const FALSE_SUCCESS_70: JudgeVerdict = Object.freeze({
  kind: 'false_success' as const,
  subtype: 'unverified_completion',
  confidence: 0.70,
  reason: '완료선언이 있으나 검증 없음 (C).',
  rawSamples: [],
})

const THRASHING_85: JudgeVerdict = Object.freeze({
  kind: 'thrashing' as const,
  subtype: 'stuck_error_loop',
  confidence: 0.85,
  reason: '동일 에러 루프 감지.',
  rawSamples: [],
})

const THRASHING_75: JudgeVerdict = Object.freeze({
  kind: 'thrashing' as const,
  subtype: 'stuck_error_loop',
  confidence: 0.75,
  reason: '동일 에러 루프 감지 (B).',
  rawSamples: [],
})

const NONE_20: JudgeVerdict = Object.freeze({
  kind: 'none' as const,
  subtype: '',
  confidence: 0.20,
  reason: '판정 근거 불충분.',
  rawSamples: [],
})

const NONE_10: JudgeVerdict = Object.freeze({
  kind: 'none' as const,
  subtype: '',
  confidence: 0.10,
  reason: '판정 근거 불충분 (B).',
  rawSamples: [],
})

/** 더미 MockJudgeClient — judge_fn이 직접 사용하지 않지만 타입 계약상 필요 */
const DUMMY_CLIENT = new MockJudgeClient([
  {
    cacheKey: 'dummy:claude-3-5-sonnet-20241022',
    verdict: FALSE_SUCCESS_90,
  } satisfies MockJudgeCacheEntry,
])

// ── call-counting mock 팩토리 ──────────────────────────────────────────────────

/**
 * 호출 횟수를 카운트하며 항상 동일 verdict를 반환하는 mock judge_fn.
 *
 * @returns { fn, callCount } — fn: JudgeFn, callCount: () => number
 */
function makeCountingJudgeFn(verdict: JudgeVerdict): {
  fn: JudgeFn
  callCount: () => number
} {
  let count = 0
  const fn: JudgeFn = async (_text, _rubric, _llmClient) => {
    count++
    return verdict
  }
  return { fn, callCount: () => count }
}

/**
 * 호출 횟수를 카운트하며 순서대로 verdict를 반환하는 mock judge_fn.
 * 초과 호출 시 마지막 verdict를 반복한다.
 */
function makeCountingSequentialFn(verdicts: readonly JudgeVerdict[]): {
  fn: JudgeFn
  callCount: () => number
} {
  let count = 0
  const fn: JudgeFn = async (_text, _rubric, _llmClient) => {
    const verdict = verdicts[count] ?? verdicts[verdicts.length - 1]!
    count++
    return verdict
  }
  return { fn, callCount: () => count }
}

/**
 * 지정 호출 번호에서 실패하는 카운팅 mock judge_fn.
 * failOnCall=N이면 N번째(1-based) 호출에서 throw.
 */
function makeFailingCountingFn(
  verdict: JudgeVerdict,
  failOnCall: number,
): {
  fn: JudgeFn
  callCount: () => number
} {
  let count = 0
  const fn: JudgeFn = async (_text, _rubric, _llmClient) => {
    count++
    if (count === failOnCall) {
      throw new Error(`judge_fn 호출 ${count}번째에서 강제 실패`)
    }
    return verdict
  }
  return { fn, callCount: () => count }
}

// ── CALL_COUNT_* — judge_fn 호출 횟수 정확성 ─────────────────────────────────

describe('debiasJudgeCall — call-counting: judge_fn 호출 횟수 정확성', () => {
  test('CC1. n_samples=1 → judge_fn 정확히 1회 호출', async () => {
    const { fn, callCount } = makeCountingJudgeFn(FALSE_SUCCESS_90)

    await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 1)

    expect(callCount()).toBe(1)
  })

  test('CC2. n_samples=2 → judge_fn 정확히 2회 호출', async () => {
    const { fn, callCount } = makeCountingJudgeFn(THRASHING_85)

    await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(callCount()).toBe(2)
  })

  test('CC3. n_samples=3 → judge_fn 정확히 3회 호출', async () => {
    const { fn, callCount } = makeCountingJudgeFn(FALSE_SUCCESS_80)

    await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(callCount()).toBe(3)
  })

  test('CC4. n_samples=5 → judge_fn 정확히 5회 호출', async () => {
    const { fn, callCount } = makeCountingJudgeFn(NONE_20)

    await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 5)

    expect(callCount()).toBe(5)
  })

  test('CC5. n_samples=10 → judge_fn 정확히 10회 호출', async () => {
    const { fn, callCount } = makeCountingJudgeFn(THRASHING_75)

    await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 10)

    expect(callCount()).toBe(10)
  })

  test('CC6. n_samples=0 → judge_fn 0회 호출 (미호출 보장)', async () => {
    const { fn, callCount } = makeCountingJudgeFn(FALSE_SUCCESS_90)

    await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 0)

    expect(callCount()).toBe(0)
  })

  test('CC7. n_samples=-1 → judge_fn 0회 호출 (미호출 보장)', async () => {
    const { fn, callCount } = makeCountingJudgeFn(FALSE_SUCCESS_90)

    await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, -1)

    expect(callCount()).toBe(0)
  })

  test('CC8. 기본값 n_samples=2 → judge_fn 정확히 2회 호출', async () => {
    const { fn, callCount } = makeCountingJudgeFn(THRASHING_85)

    // n_samples 인수 없이 호출 (기본값 2 사용)
    await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT)

    expect(callCount()).toBe(2)
  })

  test('CC9. 2번째 호출에서 실패 → 정확히 2회 호출 후 throw (fail-closed)', async () => {
    const { fn, callCount } = makeFailingCountingFn(FALSE_SUCCESS_90, 2)

    await expect(
      debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 5),
    ).rejects.toThrow('judge_fn 호출 2번째에서 강제 실패')

    // 2번째에서 멈춤 — 3·4·5번째 미호출
    expect(callCount()).toBe(2)
  })

  test('CC10. 1번째 호출에서 즉시 실패 → 정확히 1회 호출 후 throw', async () => {
    const { fn, callCount } = makeFailingCountingFn(THRASHING_85, 1)

    await expect(
      debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3),
    ).rejects.toThrow('judge_fn 호출 1번째에서 강제 실패')

    expect(callCount()).toBe(1)
  })
})

// ── CONFIDENCE_* — confidence 집계 정확성 ────────────────────────────────────

describe('debiasJudgeCall — confidence 집계: winning samples의 산술 평균', () => {
  test('CF1. n_samples=1, 단일 verdict → confidence = 해당 verdict.confidence', async () => {
    const { fn } = makeCountingJudgeFn(FALSE_SUCCESS_90)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 1)

    expect(result.kind).toBe('false_success')
    expect(result.confidence).toBeCloseTo(0.90, 10)
  })

  test('CF2. n_samples=2, unanimous false_success(0.90, 0.80) → confidence = (0.90+0.80)/2 = 0.85', async () => {
    const { fn } = makeCountingSequentialFn([FALSE_SUCCESS_90, FALSE_SUCCESS_80])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('false_success')
    expect(result.confidence).toBeCloseTo(0.85, 10)
  })

  test('CF3. n_samples=3, false_success(0.90, 0.80) vs none(0.20) → confidence = (0.90+0.80)/2 = 0.85', async () => {
    const { fn } = makeCountingSequentialFn([FALSE_SUCCESS_90, FALSE_SUCCESS_80, NONE_20])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.kind).toBe('false_success')
    // winning: false_success×2, conf avg = (0.90 + 0.80) / 2 = 0.85
    expect(result.confidence).toBeCloseTo(0.85, 10)
  })

  test('CF4. n_samples=4, unanimous thrashing(0.85, 0.75, 0.85, 0.75) → confidence 4개 평균', async () => {
    const { fn } = makeCountingSequentialFn([
      THRASHING_85,
      THRASHING_75,
      THRASHING_85,
      THRASHING_75,
    ])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 4)

    expect(result.kind).toBe('thrashing')
    // avg = (0.85 + 0.75 + 0.85 + 0.75) / 4 = 3.20 / 4 = 0.80
    expect(result.confidence).toBeCloseTo(0.80, 10)
  })

  test('CF5. n_samples=5, false_success×3(0.90,0.80,0.70) vs none×2 → winning 3개 평균', async () => {
    const { fn } = makeCountingSequentialFn([
      FALSE_SUCCESS_90,
      FALSE_SUCCESS_80,
      FALSE_SUCCESS_70,
      NONE_20,
      NONE_10,
    ])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 5)

    expect(result.kind).toBe('false_success')
    // winning: false_success×3, conf avg = (0.90 + 0.80 + 0.70) / 3 = 0.80
    expect(result.confidence).toBeCloseTo(0.80, 10)
  })

  test('CF6. n_samples=2, 동수(tie) thrashing(0.85) vs false_success(0.80) → thrashing 선택, confidence=0.85', async () => {
    const { fn } = makeCountingSequentialFn([THRASHING_85, FALSE_SUCCESS_80])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('thrashing')
    // tie-breaking → thrashing 선택, 해당 sample 1개의 confidence
    expect(result.confidence).toBeCloseTo(0.85, 10)
  })

  test('CF7. n_samples=2, 동수(tie) false_success(0.90) vs none(0.20) → false_success 선택, confidence=0.90', async () => {
    const { fn } = makeCountingSequentialFn([FALSE_SUCCESS_90, NONE_20])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('false_success')
    // tie-breaking → false_success 선택, confidence=0.90
    expect(result.confidence).toBeCloseTo(0.90, 10)
  })

  test('CF8. n_samples=0 → confidence = 0 (majorityVote([]) 계약)', async () => {
    const { fn } = makeCountingJudgeFn(FALSE_SUCCESS_90)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 0)

    expect(result.kind).toBe('none')
    expect(result.confidence).toBe(0)
  })

  test('CF9. n_samples=3, thrashing(0.85,0.75) vs false_success(0.90) → thrashing 2:1, confidence=(0.85+0.75)/2=0.80', async () => {
    const { fn } = makeCountingSequentialFn([THRASHING_85, THRASHING_75, FALSE_SUCCESS_90])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.kind).toBe('thrashing')
    // winning: thrashing×2, conf avg = (0.85 + 0.75) / 2 = 0.80
    expect(result.confidence).toBeCloseTo(0.80, 10)
  })
})

// ── INVARIANTS_* — 불변 계약 검증 ────────────────────────────────────────────

describe('debiasJudgeCall — 불변 계약 (call-counting mock)', () => {
  test('INV1. 반환 rawSamples.length === n_samples (모든 표본 보존)', async () => {
    for (const n of [1, 2, 3, 5]) {
      const { fn } = makeCountingJudgeFn(FALSE_SUCCESS_90)

      const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, n)

      expect(result.rawSamples).toHaveLength(n)
    }
  })

  test('INV2. 반환 kind는 BLOCKER C1 리터럴 집합에 속한다', async () => {
    const validKinds: ReadonlySet<string> = new Set(['thrashing', 'false_success', 'none'])
    const { fn } = makeCountingJudgeFn(THRASHING_85)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(validKinds.has(result.kind)).toBe(true)
  })

  test('INV3. 반환 confidence ∈ [0, 1] 범위', async () => {
    const { fn } = makeCountingSequentialFn([FALSE_SUCCESS_90, FALSE_SUCCESS_80, NONE_20])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })

  test('INV4. 동일 입력, 동일 mock → 동일 호출 횟수 (결정론)', async () => {
    const { fn: fn1, callCount: cc1 } = makeCountingJudgeFn(FALSE_SUCCESS_90)
    const { fn: fn2, callCount: cc2 } = makeCountingJudgeFn(FALSE_SUCCESS_90)

    await debiasJudgeCall(fn1, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 4)
    await debiasJudgeCall(fn2, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 4)

    expect(cc1()).toBe(cc2())
    expect(cc1()).toBe(4)
  })

  test('INV5. n_samples 호출 횟수는 verdict 내용과 무관 (항상 n_samples회)', async () => {
    // 모든 verdict가 none이어도 n_samples회 정확히 호출
    const { fn, callCount } = makeCountingJudgeFn(NONE_20)

    await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 7)

    expect(callCount()).toBe(7)
  })
})
