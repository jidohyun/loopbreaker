/**
 * tests/debias-judge-call-sub-ac-5d-1.test.ts
 *
 * Sub-AC 5d-1: debiasJudgeCall(judge_fn, text, rubric, llm_client, n_samples=2)
 *   → JudgeVerdict
 *
 * 검증 항목:
 *
 *   A. 만장일치(unanimous agreement) 경로 — mock judge가 항상 동일 verdict 반환
 *      A1. judge_fn이 정확히 n_samples회 호출된다
 *      A2. 만장일치 시 kind가 그대로 반환된다
 *      A3. 만장일치 시 confidence가 평균(=단일값)으로 반환된다
 *      A4. rawSamples 길이 = n_samples
 *      A5. rawSamples에 각 호출 결과가 호출 순서대로 보존된다
 *      A6. 기본 n_samples=2이면 judge_fn이 정확히 2회 호출된다
 *
 *   B. 다수결(majority vote) 경로 — 서로 다른 verdict 반환
 *      B1. 2:1 다수결 — 다수 kind가 선택된다
 *      B2. confidence는 winning samples의 평균을 반환한다
 *      B3. rawSamples에 모든 N개 응답이 보존된다
 *
 *   C. 동수(tie) 우선순위 규칙
 *      C1. thrashing과 false_success 동수 → thrashing 선택
 *      C2. false_success와 none 동수 → false_success 선택
 *
 *   D. 엣지 케이스
 *      D1. n_samples=0이면 judge_fn 미호출, kind=none, confidence=0 반환
 *      D2. n_samples=1이면 judge_fn 1회 호출, 해당 verdict 반환
 *      D3. n_samples=5이면 judge_fn 5회 호출
 *      D4. n_samples=-1이면 judge_fn 미호출, kind=none 반환
 *
 *   E. 실패·fail-closed
 *      E1. judge_fn이 예외를 throw하면 debiasJudgeCall도 예외를 그대로 throw한다
 *      E2. 3번째 호출에서 실패해도 예외가 전파된다 (fail-closed)
 *
 *   F. 불변성·순수성
 *      F1. 호출 후 text 인수가 변경되지 않는다
 *      F2. 호출 후 rubric 인수가 변경되지 않는다
 *      F3. 동일 입력·동일 mock → 동일 kind 반환 (결정론)
 *
 *   G. BLOCKER C1/C2 계약 준수
 *      G1. kind는 'thrashing' | 'false_success' | 'none' 중 하나이다 (C1)
 *      G2. 반환값은 JudgeVerdict 필수 필드를 모두 포함한다 (C2)
 *      G3. rawSamples는 배열이다 (C2)
 *
 * 외부 API 절대 미호출 — 모든 테스트는 Mock judge_fn으로만 동작.
 */

import { debiasJudgeCall, type JudgeFn } from '../src/detect/debias-judge.js'
import { buildFalseSuccessRubric, type Rubric } from '../src/detect/false-success-rubric.js'
import { MockJudgeClient, type MockJudgeCacheEntry } from '../src/api/judge-client.js'
import type { JudgeVerdict } from '../src/contracts.js'

// ── 픽스처 ────────────────────────────────────────────────────────────────────

const DEFAULT_RUBRIC: Rubric = buildFalseSuccessRubric()
const SAMPLE_TEXT = '작업이 완료되었습니다. 모든 테스트가 통과했습니다.'
const MODEL_ID = 'claude-3-5-sonnet-20241022'

/** false_success 판정 샘플 */
const FALSE_SUCCESS_VERDICT: JudgeVerdict = Object.freeze({
  kind: 'false_success' as const,
  subtype: 'unverified_completion',
  confidence: 0.87,
  reason: '완료선언이 있으나 검증 tool_result가 없습니다.',
  rawSamples: [],
})

/** thrashing 판정 샘플 */
const THRASHING_VERDICT: JudgeVerdict = Object.freeze({
  kind: 'thrashing' as const,
  subtype: 'stuck_error_loop',
  confidence: 0.82,
  reason: '동일 에러 루프 감지.',
  rawSamples: [],
})

/** none 판정 샘플 */
const NONE_VERDICT: JudgeVerdict = Object.freeze({
  kind: 'none' as const,
  subtype: '',
  confidence: 0.12,
  reason: '판정 근거 불충분.',
  rawSamples: [],
})

/**
 * 항상 동일한 verdict를 반환하는 Mock judge_fn 생성.
 * 호출 횟수를 카운트한다.
 */
function makeAlwaysSameJudgeFn(
  verdict: JudgeVerdict,
): { fn: JudgeFn; callCount: () => number } {
  let count = 0
  const fn: JudgeFn = async (_text, _rubric, _llmClient) => {
    count++
    return verdict
  }
  return { fn, callCount: () => count }
}

/**
 * 순서대로 verdict를 반환하는 Mock judge_fn 생성.
 * verdicts 배열 순서대로 반환하며, 초과 시 마지막 verdict 반복.
 */
function makeSequentialJudgeFn(verdicts: JudgeVerdict[]): JudgeFn {
  let idx = 0
  return async (_text, _rubric, _llmClient) => {
    const verdict = verdicts[idx] ?? verdicts[verdicts.length - 1]!
    idx++
    return verdict
  }
}

/** 더미 MockJudgeClient (judge_fn에 전달되지만 위 mock fn에서 사용 안 함) */
const DUMMY_CLIENT = new MockJudgeClient([
  {
    cacheKey: `false_success:${MODEL_ID}`,
    verdict: FALSE_SUCCESS_VERDICT,
  } satisfies MockJudgeCacheEntry,
])

// ── A. 만장일치 경로 ──────────────────────────────────────────────────────────

describe('debiasJudgeCall — 만장일치(unanimous agreement) 경로', () => {
  test('A1. judge_fn이 정확히 n_samples회 호출된다', async () => {
    const { fn, callCount } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)

    await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(callCount()).toBe(3)
  })

  test('A2. 만장일치 시 kind가 그대로 반환된다', async () => {
    const { fn } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('false_success')
  })

  test('A3. 만장일치 시 confidence가 평균(=단일값)으로 반환된다', async () => {
    const { fn } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    // 동일 confidence 2개 평균 = 원래 값
    expect(result.confidence).toBeCloseTo(FALSE_SUCCESS_VERDICT.confidence)
  })

  test('A4. rawSamples 길이 = n_samples', async () => {
    const { fn } = makeAlwaysSameJudgeFn(THRASHING_VERDICT)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 4)

    expect(result.rawSamples).toHaveLength(4)
  })

  test('A5. rawSamples에 각 호출 결과가 호출 순서대로 보존된다', async () => {
    const { fn } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.rawSamples).toHaveLength(2)
    // 각 sample이 JudgeVerdict 구조를 가짐
    for (const sample of result.rawSamples) {
      expect((sample as JudgeVerdict).kind).toBe('false_success')
    }
  })

  test('A6. 기본 n_samples=2이면 judge_fn이 정확히 2회 호출된다', async () => {
    const { fn, callCount } = makeAlwaysSameJudgeFn(THRASHING_VERDICT)

    await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT)

    expect(callCount()).toBe(2)
  })

  test('A7. 만장일치 thrashing — kind=thrashing, subtype/reason 보존', async () => {
    const { fn } = makeAlwaysSameJudgeFn(THRASHING_VERDICT)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('thrashing')
    expect(result.subtype).toBe(THRASHING_VERDICT.subtype)
    expect(result.reason).toBe(THRASHING_VERDICT.reason)
  })
})

// ── B. 다수결 경로 ────────────────────────────────────────────────────────────

describe('debiasJudgeCall — 다수결(majority vote) 경로', () => {
  test('B1. 2:1 다수결 — 다수 kind가 선택된다 (false_success 2, none 1)', async () => {
    const fn = makeSequentialJudgeFn([
      FALSE_SUCCESS_VERDICT,
      FALSE_SUCCESS_VERDICT,
      NONE_VERDICT,
    ])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.kind).toBe('false_success')
  })

  test('B2. confidence는 winning samples의 평균을 반환한다', async () => {
    // false_success: confidence 0.9, 0.8 → winning avg = 0.85
    const v1: JudgeVerdict = { ...FALSE_SUCCESS_VERDICT, confidence: 0.9 }
    const v2: JudgeVerdict = { ...FALSE_SUCCESS_VERDICT, confidence: 0.8 }
    const fn = makeSequentialJudgeFn([v1, v2, NONE_VERDICT])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.kind).toBe('false_success')
    expect(result.confidence).toBeCloseTo(0.85) // (0.9 + 0.8) / 2
  })

  test('B3. rawSamples에 모든 N개 응답이 보존된다', async () => {
    const fn = makeSequentialJudgeFn([
      FALSE_SUCCESS_VERDICT,
      THRASHING_VERDICT,
      NONE_VERDICT,
    ])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.rawSamples).toHaveLength(3)
  })

  test('B4. 3:0 다수결 — 단일 kind 압도적 다수', async () => {
    const fn = makeSequentialJudgeFn([
      THRASHING_VERDICT,
      THRASHING_VERDICT,
      THRASHING_VERDICT,
    ])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    expect(result.kind).toBe('thrashing')
    expect(result.rawSamples).toHaveLength(3)
  })
})

// ── C. 동수 우선순위 ──────────────────────────────────────────────────────────

describe('debiasJudgeCall — 동수(tie) 우선순위 규칙', () => {
  test('C1. thrashing과 false_success 동수 → thrashing 선택 (보수적 우선)', async () => {
    const fn = makeSequentialJudgeFn([THRASHING_VERDICT, FALSE_SUCCESS_VERDICT])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('thrashing')
  })

  test('C2. false_success와 none 동수 → false_success 선택', async () => {
    const fn = makeSequentialJudgeFn([FALSE_SUCCESS_VERDICT, NONE_VERDICT])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('false_success')
  })

  test('C3. thrashing과 none 동수 → thrashing 선택', async () => {
    const fn = makeSequentialJudgeFn([THRASHING_VERDICT, NONE_VERDICT])

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result.kind).toBe('thrashing')
  })
})

// ── D. 엣지 케이스 ────────────────────────────────────────────────────────────

describe('debiasJudgeCall — 엣지 케이스', () => {
  test('D1. n_samples=0이면 judge_fn 미호출, kind=none, confidence=0 반환', async () => {
    const { fn, callCount } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 0)

    expect(callCount()).toBe(0)
    expect(result.kind).toBe('none')
    expect(result.confidence).toBe(0)
    expect(result.rawSamples).toHaveLength(0)
  })

  test('D2. n_samples=1이면 judge_fn 1회 호출, 해당 verdict 반환', async () => {
    const { fn, callCount } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 1)

    expect(callCount()).toBe(1)
    expect(result.kind).toBe('false_success')
    expect(result.rawSamples).toHaveLength(1)
  })

  test('D3. n_samples=5이면 judge_fn 5회 호출', async () => {
    const { fn, callCount } = makeAlwaysSameJudgeFn(NONE_VERDICT)

    await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 5)

    expect(callCount()).toBe(5)
  })

  test('D4. n_samples=-1이면 judge_fn 미호출, kind=none 반환', async () => {
    const { fn, callCount } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, -1)

    expect(callCount()).toBe(0)
    expect(result.kind).toBe('none')
  })

  test('D5. n_samples=2 기본값 사용 시 rawSamples.length=2', async () => {
    const { fn } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT)

    expect(result.rawSamples).toHaveLength(2)
  })
})

// ── E. 실패·fail-closed ────────────────────────────────────────────────────────

describe('debiasJudgeCall — 실패·fail-closed', () => {
  test('E1. judge_fn이 예외를 throw하면 debiasJudgeCall도 예외를 그대로 throw한다', async () => {
    const failFn: JudgeFn = async () => {
      throw new Error('judge API 실패 — 테스트 에러')
    }

    await expect(
      debiasJudgeCall(failFn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2),
    ).rejects.toThrow('judge API 실패 — 테스트 에러')
  })

  test('E2. 3번째 호출에서 실패해도 예외가 전파된다 (fail-closed)', async () => {
    let callCount = 0
    const failOnThirdFn: JudgeFn = async () => {
      callCount++
      if (callCount === 3) {
        throw new Error('3번째 호출 실패')
      }
      return FALSE_SUCCESS_VERDICT
    }

    await expect(
      debiasJudgeCall(failOnThirdFn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 5),
    ).rejects.toThrow('3번째 호출 실패')

    // 3번째에서 멈췄는지 확인 (4, 5번째 미호출)
    expect(callCount).toBe(3)
  })
})

// ── F. 불변성·순수성 ──────────────────────────────────────────────────────────

describe('debiasJudgeCall — 불변성·순수성', () => {
  test('F1. 호출 후 text 인수가 변경되지 않는다', async () => {
    const text = '원본 텍스트입니다.'
    const originalText = text
    const { fn } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)

    await debiasJudgeCall(fn, text, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(text).toBe(originalText)
  })

  test('F2. 호출 후 rubric 인수가 변경되지 않는다', async () => {
    const rubric = buildFalseSuccessRubric()
    const originalCriteriaLength = rubric.criteria.length
    const originalKind = rubric.kind
    const { fn } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)

    await debiasJudgeCall(fn, SAMPLE_TEXT, rubric, DUMMY_CLIENT, 2)

    expect(rubric.criteria.length).toBe(originalCriteriaLength)
    expect(rubric.kind).toBe(originalKind)
  })

  test('F3. 동일 입력·동일 mock → 동일 kind 반환 (결정론)', async () => {
    const { fn: fn1 } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)
    const { fn: fn2 } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)

    const r1 = await debiasJudgeCall(fn1, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)
    const r2 = await debiasJudgeCall(fn2, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(r1.kind).toBe(r2.kind)
    expect(r1.confidence).toBeCloseTo(r2.confidence)
  })

  test('F4. judge_fn에 동일 (text, rubric, llm_client) 인수가 전달된다', async () => {
    const capturedArgs: { text: string; rubric: Rubric }[] = []
    const capturingFn: JudgeFn = async (text, rubric, _llmClient) => {
      capturedArgs.push({ text, rubric })
      return FALSE_SUCCESS_VERDICT
    }

    await debiasJudgeCall(capturingFn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 3)

    // 3회 모두 동일 text/rubric 전달
    expect(capturedArgs).toHaveLength(3)
    for (const args of capturedArgs) {
      expect(args.text).toBe(SAMPLE_TEXT)
      expect(args.rubric).toBe(DEFAULT_RUBRIC)
    }
  })
})

// ── G. BLOCKER C1/C2 계약 준수 ───────────────────────────────────────────────

describe('debiasJudgeCall — BLOCKER C1/C2 계약 준수', () => {
  test('G1. kind는 "thrashing" | "false_success" | "none" 중 하나이다 (BLOCKER C1)', async () => {
    const { fn } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(['thrashing', 'false_success', 'none']).toContain(result.kind)
    expect(result.kind).not.toBe('fake_success')
    expect(result.kind).not.toBe('fakeSuccess')
  })

  test('G2. 반환값은 JudgeVerdict 필수 필드를 모두 포함한다 (BLOCKER C2)', async () => {
    const { fn } = makeAlwaysSameJudgeFn(THRASHING_VERDICT)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(result).toHaveProperty('kind')
    expect(result).toHaveProperty('subtype')
    expect(result).toHaveProperty('confidence')
    expect(result).toHaveProperty('reason')
    expect(result).toHaveProperty('rawSamples')
    expect(typeof result.confidence).toBe('number')
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })

  test('G3. rawSamples는 배열이다 (BLOCKER C2)', async () => {
    const { fn } = makeAlwaysSameJudgeFn(NONE_VERDICT)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 2)

    expect(Array.isArray(result.rawSamples)).toBe(true)
  })

  test('G4. n_samples=0(빈 배열) 반환도 JudgeVerdict 계약 준수', async () => {
    const { fn } = makeAlwaysSameJudgeFn(FALSE_SUCCESS_VERDICT)

    const result = await debiasJudgeCall(fn, SAMPLE_TEXT, DEFAULT_RUBRIC, DUMMY_CLIENT, 0)

    expect(['thrashing', 'false_success', 'none']).toContain(result.kind)
    expect(Array.isArray(result.rawSamples)).toBe(true)
    expect(typeof result.confidence).toBe('number')
  })
})
