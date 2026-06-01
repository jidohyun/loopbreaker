/**
 * tests/judge-stage-sub-ac-4e-3.test.ts
 *
 * Sub-AC 4e-3: `judgeStage` calls `majorityVote` with all collected sample verdicts
 *   and returns the resulting `JudgeVerdict`.
 *
 * 전략: ESM 환경에서 같은 모듈 내부 함수를 spyOn으로 가로채는 것은 불가능
 * (ESM live binding은 내부 직접 참조를 intercept하지 못함).
 * 따라서 observable effect 검증 전략을 사용한다:
 *
 *   - collectSamples를 "stub"하는 방식: 결정론 클라이언트로
 *     selfConsistencyN 개수만큼 고정 verdict를 반환하게 하면,
 *     judgeStage는 원본 N개 + swap N개 = 총 2*N개 샘플을 수집한다.
 *
 *   - majorityVote 호출 결과 검증: majorityVote를 직접 import하여
 *     동일한 샘플 목록에 적용했을 때의 결과와 judgeStage 반환값을 비교한다.
 *     (judgeStage 내부에서 majorityVote를 사용하지 않았다면 결과가 달라짐)
 *
 * SPEC §5: position swap + self-consistency N 표본 다수결 편향완화.
 * 외부 API 절대 미호출 — 결정론 Mock 클라이언트, 네트워크·API 키 불필요.
 * BLOCKER C1: kind는 'thrashing' | 'false_success' | 'none'.
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본.
 */

import {
  judgeStage,
  majorityVote,
  type GateResult,
  type JudgeCallContext,
  type JudgeStageInput,
  type RawSample,
} from '../src/detect/semantic-stage.js'
import type { JudgeClient, JudgeRequest, JudgeVerdict } from '../src/api/judge-client.js'

// ── 결정론 Mock JudgeClient ───────────────────────────────────────────────────

/**
 * 항상 동일한 verdict를 반환하는 결정론 Mock.
 * collectSamples 스텁 역할: 모든 호출에 고정 verdict 반환.
 */
class FixedJudgeClient implements JudgeClient {
  readonly #verdict: JudgeVerdict

  constructor(verdict: JudgeVerdict) {
    this.#verdict = verdict
  }

  async judge(_req: JudgeRequest): Promise<JudgeVerdict> {
    return { ...this.#verdict }
  }
}

/**
 * 호출 순서에 따라 서로 다른 verdict를 반환하는 순차 Mock.
 * 서로 다른 샘플이 필요한 다수결 테스트에 사용.
 */
class SequentialJudgeClient implements JudgeClient {
  readonly #verdicts: JudgeVerdict[]
  #callIndex = 0

  constructor(verdicts: JudgeVerdict[]) {
    this.#verdicts = verdicts
  }

  async judge(_req: JudgeRequest): Promise<JudgeVerdict> {
    const verdict = this.#verdicts[this.#callIndex % this.#verdicts.length]!
    this.#callIndex++
    return { ...verdict }
  }

  get callCount(): number {
    return this.#callIndex
  }
}

// ── 테스트 픽스처 ──────────────────────────────────────────────────────────────

const MODEL_ID = 'claude-3-5-sonnet-20241022'

const VERDICT_THRASHING: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'stuck_error_loop',
  confidence: 0.9,
  reason: '동일 에러가 반복되었습니다.',
  rawSamples: [],
}

const VERDICT_FALSE_SUCCESS: JudgeVerdict = {
  kind: 'false_success',
  subtype: 'wrong_conclusion',
  confidence: 0.7,
  reason: '잘못된 성공 판정입니다.',
  rawSamples: [],
}

const VERDICT_NONE: JudgeVerdict = {
  kind: 'none',
  subtype: '',
  confidence: 0.3,
  reason: '이상 없음.',
  rawSamples: [],
}

function makeCtx(
  cacheableBlock = '루브릭 텍스트',
  volatileBlock = '컨텍스트 텍스트',
  kind: 'thrashing' | 'false_success' = 'thrashing',
): JudgeCallContext {
  return {
    kind,
    cacheableBlock,
    volatileBlock,
    modelId: MODEL_ID,
    temperature: 0.4,
  }
}

function makePassedGate(): GateResult {
  return { pass: true }
}

// ── 핵심: judgeStage 반환값 = majorityVote(allSamples) ──────────────────────

describe('judgeStage — majorityVote 호출 및 결과 검증 (Sub-AC 4e-3)', () => {
  test('모든 샘플이 동일한 verdict일 때 judgeStage는 해당 kind를 반환한다', async () => {
    // collectSamples 스텁: FixedJudgeClient → 모든 호출에 VERDICT_THRASHING 반환
    // selfConsistencyN=2 → 원본 2개 + swap 2개 = 총 4샘플
    // majorityVote([thrashing, thrashing, thrashing, thrashing]) → kind='thrashing'
    const client = new FixedJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 2,
    }

    const result = await judgeStage(input)

    expect(result).not.toBeNull()
    expect(result!.kind).toBe('thrashing')
  })

  test('judgeStage 반환값이 동일 샘플로 직접 호출한 majorityVote 결과와 일치한다', async () => {
    // 전략: judgeStage(input)의 반환값과
    //   majorityVote(allSamples)의 반환값을 비교한다.
    //
    // allSamples = [원본N개, swapN개] = 2*selfConsistencyN개의 고정 verdict
    // FixedJudgeClient → 모든 호출에 동일 verdict 반환
    // → allSamples = [VERDICT_THRASHING × 2*N]
    const selfConsistencyN = 2
    const client = new FixedJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN,
    }

    const result = await judgeStage(input)

    // allSamples = 2*N개 동일 verdict
    const expectedSamples: RawSample[] = Array.from(
      { length: selfConsistencyN * 2 },
      () => ({ ...VERDICT_THRASHING }),
    )
    const expected = majorityVote(expectedSamples)

    expect(result).not.toBeNull()
    expect(result!.kind).toBe(expected.kind)
    expect(result!.confidence).toBeCloseTo(expected.confidence, 5)
    expect(result!.subtype).toBe(expected.subtype)
    expect(result!.reason).toBe(expected.reason)
  })

  test('rawSamples는 collectSamples가 수집한 전체 샘플을 보존한다(감사용)', async () => {
    // SPEC §5: rawSamples에 N개 응답 보존 (감사용)
    // selfConsistencyN=3 → 원본 3개 + swap 3개 = 6개 샘플 → rawSamples.length=6
    const selfConsistencyN = 3
    const client = new FixedJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN,
    }

    const result = await judgeStage(input)

    expect(result).not.toBeNull()
    expect(result!.rawSamples).toHaveLength(selfConsistencyN * 2)
  })

  test('다수결: thrashing 3개 vs false_success 1개 → kind=thrashing', async () => {
    // 순서: [thrashing, thrashing, false_success, thrashing]
    // (원본 2개 + swap 2개, 순차 클라이언트로 제어)
    // majorityVote → thrashing 3개 > false_success 1개 → kind='thrashing'
    const verdicts = [
      VERDICT_THRASHING,     // 원본 1번째
      VERDICT_THRASHING,     // 원본 2번째
      VERDICT_FALSE_SUCCESS, // swap 1번째
      VERDICT_THRASHING,     // swap 2번째
    ]
    const client = new SequentialJudgeClient(verdicts)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 2,
    }

    const result = await judgeStage(input)

    expect(result).not.toBeNull()
    expect(result!.kind).toBe('thrashing')
  })

  test('다수결 동수 시 우선순위: thrashing > false_success > none', async () => {
    // thrashing 1개 vs false_success 1개 → 동수 → thrashing 우선
    const verdicts = [
      VERDICT_THRASHING,     // 원본 1번째
      VERDICT_FALSE_SUCCESS, // swap 1번째
    ]
    const client = new SequentialJudgeClient(verdicts)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 1,
    }

    const result = await judgeStage(input)

    // majorityVote 동수 우선순위: thrashing > false_success > none
    const expectedSamples: RawSample[] = [
      { ...VERDICT_THRASHING },
      { ...VERDICT_FALSE_SUCCESS },
    ]
    const expected = majorityVote(expectedSamples)

    expect(result).not.toBeNull()
    expect(result!.kind).toBe(expected.kind) // 'thrashing'
  })

  test('selfConsistencyN=1이면 2개 샘플로 majorityVote 호출 → 결과 반환', async () => {
    // N=1 → 원본 1 + swap 1 = 2개 샘플
    // majorityVote([thrashing, thrashing]) → kind='thrashing', confidence=0.9
    const client = new FixedJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 1,
    }

    const result = await judgeStage(input)

    expect(result).not.toBeNull()
    expect(result!.kind).toBe('thrashing')
    expect(result!.confidence).toBeCloseTo(0.9, 5)
    expect(result!.rawSamples).toHaveLength(2)
  })

  test('selfConsistencyN=0이면 빈 샘플 → majorityVote([]) → kind=none 반환', async () => {
    // n=0 → collectSamples 미호출 → allSamples=[] → majorityVote([]) → kind='none'
    const client = new FixedJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 0,
    }

    const result = await judgeStage(input)

    expect(result).not.toBeNull()
    expect(result!.kind).toBe('none')
    expect(result!.rawSamples).toHaveLength(0)
  })

  test('false_success verdict가 다수일 때 kind=false_success 반환', async () => {
    // 모든 샘플이 false_success → majorityVote → kind='false_success'
    const client = new FixedJudgeClient(VERDICT_FALSE_SUCCESS)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx('루브릭', '컨텍스트', 'false_success'),
      client,
      selfConsistencyN: 2,
    }

    const result = await judgeStage(input)

    expect(result).not.toBeNull()
    expect(result!.kind).toBe('false_success')
    expect(result!.subtype).toBe(VERDICT_FALSE_SUCCESS.subtype)
    expect(result!.confidence).toBeCloseTo(VERDICT_FALSE_SUCCESS.confidence, 5)
  })

  test('judgeStage 반환값 구조가 JudgeVerdict 정본 계약을 준수한다(BLOCKER C1/C2)', async () => {
    const client = new FixedJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 1,
    }

    const result = await judgeStage(input)

    expect(result).not.toBeNull()
    // BLOCKER C1: kind는 'thrashing' | 'false_success' | 'none'
    expect(['thrashing', 'false_success', 'none']).toContain(result!.kind)
    // BLOCKER C2: 필수 필드 확인
    expect(typeof result!.subtype).toBe('string')
    expect(typeof result!.confidence).toBe('number')
    expect(result!.confidence).toBeGreaterThanOrEqual(0)
    expect(result!.confidence).toBeLessThanOrEqual(1)
    expect(typeof result!.reason).toBe('string')
    expect(Array.isArray(result!.rawSamples)).toBe(true)
  })
})

// ── 다수결 confidence 평균 검증 ───────────────────────────────────────────────

describe('judgeStage — majorityVote confidence 평균 검증 (Sub-AC 4e-3)', () => {
  test('동일 kind 샘플들의 confidence 평균이 결과 confidence와 일치한다', async () => {
    // VERDICT_THRASHING.confidence = 0.9
    // 4개 샘플 모두 동일 → 평균 = 0.9
    const selfConsistencyN = 2
    const client = new FixedJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN,
    }

    const result = await judgeStage(input)

    expect(result).not.toBeNull()
    expect(result!.confidence).toBeCloseTo(0.9, 5)
  })

  test('서로 다른 confidence의 동일 kind 샘플들 → confidence 평균 검증', async () => {
    // thrashing confidence 0.8, 1.0 교대 → 원본 2개 + swap 2개 = 4개
    // 패턴: 0.8, 1.0, 0.8, 1.0 → 평균 = (0.8+1.0+0.8+1.0)/4 = 0.9
    const verdict08: JudgeVerdict = {
      kind: 'thrashing',
      subtype: 'loop',
      confidence: 0.8,
      reason: '샘플 A',
      rawSamples: [],
    }
    const verdict10: JudgeVerdict = {
      kind: 'thrashing',
      subtype: 'loop',
      confidence: 1.0,
      reason: '샘플 B',
      rawSamples: [],
    }

    const client = new SequentialJudgeClient([verdict08, verdict10])
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 2,
    }

    const result = await judgeStage(input)

    // 수집된 4개 샘플: [0.8, 1.0, 0.8, 1.0] → 평균 = 0.9
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('thrashing')
    expect(result!.confidence).toBeCloseTo(0.9, 5)
    // rawSamples = 4개
    expect(result!.rawSamples).toHaveLength(4)
  })
})

// ── none verdict 다수결 검증 ─────────────────────────────────────────────────

describe('judgeStage — none verdict 다수결 (Sub-AC 4e-3)', () => {
  test('none이 다수이면 kind=none 반환', async () => {
    // [none, none, thrashing] — selfConsistencyN=2, swap 포함 4개
    // SequentialJudgeClient: [none, none, none, thrashing]
    const verdicts = [
      VERDICT_NONE,
      VERDICT_NONE,
      VERDICT_NONE,
      VERDICT_THRASHING,
    ]
    const client = new SequentialJudgeClient(verdicts)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 2,
    }

    const result = await judgeStage(input)

    expect(result).not.toBeNull()
    expect(result!.kind).toBe('none')
  })
})
