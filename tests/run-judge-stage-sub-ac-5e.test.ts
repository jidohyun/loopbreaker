/**
 * tests/run-judge-stage-sub-ac-5e.test.ts
 *
 * Sub-AC 5e: `runJudgeStage(candidate, judgeClient, ctx, n)` — integration of 5a–5d.
 *
 * 검증 항목:
 *   1. gate_passed=false 후보 → skipped=true, verdict=undefined, judge 미호출.
 *   2. gate_passed=true 후보 → verdict 존재, rawSamples.length === n×2, 다수결 kind.
 *   3. 반환된 verdict 구조가 JudgeVerdict 정본(BLOCKER C1/C2)을 준수.
 *   4. candidate 참조가 반환값에 보존됨.
 *   5. n=1 → rawSamples.length===2 (원본 + swap 1쌍).
 *   6. n=3 → rawSamples.length===6 (3쌍×2).
 *   7. judgeClient 실패 시 예외 throw (fail-closed).
 *
 * 외부 API 절대 미호출 — 완전 결정론 Mock JudgeClient, 네트워크·API 키 불필요.
 * BLOCKER C1: kind는 'thrashing' | 'false_success' | 'none'.
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본.
 */

import { runJudgeStage, type JudgeStageResult } from '../src/detect/run-judge-stage.js'
import type { GateCandidate } from '../src/detect/filter-gate-passed.js'
import type { PositionSwapContext } from '../src/detect/build-position-swapped-pairs.js'
import type { JudgeClient, JudgeRequest } from '../src/api/judge-client.js'
import type { JudgeVerdict } from '../src/contracts.js'

// ── 결정론 Mock JudgeClient ───────────────────────────────────────────────────

/**
 * 항상 동일한 verdict를 반환하는 완전 결정론 Mock.
 * 외부 API 절대 미호출: JudgeClient 인터페이스만 구현.
 */
class FixedJudgeClient implements JudgeClient {
  readonly #verdict: JudgeVerdict
  #callCount = 0

  constructor(verdict: JudgeVerdict) {
    this.#verdict = verdict
  }

  async judge(_req: JudgeRequest): Promise<JudgeVerdict> {
    this.#callCount++
    return { ...this.#verdict, rawSamples: [] }
  }

  get callCount(): number {
    return this.#callCount
  }
}

/**
 * 항상 에러를 throw하는 Mock — fail-closed 테스트용.
 */
class FailingJudgeClient implements JudgeClient {
  async judge(_req: JudgeRequest): Promise<JudgeVerdict> {
    throw new Error('JudgeClient: simulated failure')
  }
}

/**
 * 호출 순서별로 서로 다른 verdict를 반환하는 순차 Mock.
 * 다수결 판정 테스트용.
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
    return { ...verdict, rawSamples: [] }
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
  reason: '동일 에러 반복.',
  rawSamples: [],
}

const VERDICT_FALSE_SUCCESS: JudgeVerdict = {
  kind: 'false_success',
  subtype: 'wrong_conclusion',
  confidence: 0.75,
  reason: '잘못된 성공 판정.',
  rawSamples: [],
}

const VERDICT_NONE: JudgeVerdict = {
  kind: 'none',
  subtype: '',
  confidence: 0.1,
  reason: '이상 없음.',
  rawSamples: [],
}

function makePassedCandidate(): GateCandidate {
  return {
    gate: null,
    gate_passed: true,
    triggerUuid: 'uuid-passed-001',
    ts: 1000,
  }
}

function makeFailedCandidate(): GateCandidate {
  return {
    gate: null,
    gate_passed: false,
    triggerUuid: 'uuid-failed-001',
    ts: 2000,
  }
}

function makeCtx(
  positionA = '발화 A 텍스트',
  positionB = '발화 B 텍스트',
  kind: 'thrashing' | 'false_success' = 'thrashing',
): PositionSwapContext {
  return {
    positionA,
    positionB,
    cacheableBlock: '루브릭+few-shot 정적 블록',
    modelId: MODEL_ID,
    kind,
    temperature: 0.4,
  }
}

// ── 테스트 스위트 ──────────────────────────────────────────────────────────────

describe('runJudgeStage — Sub-AC 5e: integration of 5a–5d', () => {
  // ── 1. 게이트 미통과 → 건너뜀 ─────────────────────────────────────────────

  describe('gate_passed=false 후보', () => {
    test('skipped=true를 반환하며 judgeClient를 호출하지 않는다', async () => {
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makeFailedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 3)

      expect(result.skipped).toBe(true)
      expect(result.verdict).toBeUndefined()
      expect(client.callCount).toBe(0)
    })

    test('candidate 참조가 반환값에 보존된다', async () => {
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makeFailedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 1)

      expect(result.candidate).toBe(candidate)
    })
  })

  // ── 2. 게이트 통과 → verdict 반환 ────────────────────────────────────────

  describe('gate_passed=true 후보', () => {
    test('skipped=false이고 verdict가 존재한다', async () => {
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 1)

      expect(result.skipped).toBe(false)
      expect(result.verdict).toBeDefined()
    })

    test('candidate 참조가 반환값에 보존된다', async () => {
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 1)

      expect(result.candidate).toBe(candidate)
    })

    test('n=1이면 rawSamples.length === 2 (원본 + swap 1쌍)', async () => {
      // position swap: 1회 반복 → { original, swapped } = 2 호출
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 1)

      expect(result.verdict).toBeDefined()
      expect(result.verdict!.rawSamples).toHaveLength(2)
      expect(client.callCount).toBe(2)
    })

    test('n=3이면 rawSamples.length === 6 (3쌍 × 2)', async () => {
      // 3회 반복 × 2(원본+swap) = 6 호출
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 3)

      expect(result.verdict).toBeDefined()
      expect(result.verdict!.rawSamples).toHaveLength(6)
      expect(client.callCount).toBe(6)
    })

    test('n=0이면 rawSamples.length === 0, kind=none (빈 다수결)', async () => {
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 0)

      expect(result.skipped).toBe(false)
      expect(result.verdict).toBeDefined()
      expect(result.verdict!.kind).toBe('none')
      expect(result.verdict!.rawSamples).toHaveLength(0)
      expect(client.callCount).toBe(0)
    })

    test('모든 샘플이 thrashing이면 kind=thrashing 반환', async () => {
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 3)

      expect(result.verdict!.kind).toBe('thrashing')
    })

    test('모든 샘플이 false_success이면 kind=false_success 반환', async () => {
      const client = new FixedJudgeClient(VERDICT_FALSE_SUCCESS)
      const candidate = makePassedCandidate()
      const ctx = makeCtx('A', 'B', 'false_success')

      const result = await runJudgeStage(candidate, client, ctx, 1)

      expect(result.verdict!.kind).toBe('false_success')
      expect(result.verdict!.subtype).toBe(VERDICT_FALSE_SUCCESS.subtype)
    })

    test('다수결: thrashing이 다수면 kind=thrashing', async () => {
      // n=1 → 2호출: [thrashing, thrashing]
      // thrashing 2 > none 0 → thrashing
      const client = new SequentialJudgeClient([
        VERDICT_THRASHING,
        VERDICT_THRASHING,
      ])
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 1)

      expect(result.verdict!.kind).toBe('thrashing')
    })

    test('동수 시 우선순위: thrashing > false_success > none', async () => {
      // n=1 → 2호출: [thrashing, false_success] → 동수 → thrashing 우선
      const client = new SequentialJudgeClient([
        VERDICT_THRASHING,
        VERDICT_FALSE_SUCCESS,
      ])
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 1)

      // majorityVote 동수 우선순위: thrashing > false_success > none
      expect(result.verdict!.kind).toBe('thrashing')
    })

    test('confidence는 다수결 종류 샘플들의 평균이다', async () => {
      // 모든 샘플 thrashing, confidence=0.9 × 4개 → 평균 0.9
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 2)

      expect(result.verdict!.confidence).toBeCloseTo(0.9, 5)
    })

    test('none이 다수이면 kind=none 반환', async () => {
      // n=2 → 4호출: [none, none, none, thrashing]
      const client = new SequentialJudgeClient([
        VERDICT_NONE,
        VERDICT_NONE,
        VERDICT_NONE,
        VERDICT_THRASHING,
      ])
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 2)

      expect(result.verdict!.kind).toBe('none')
    })
  })

  // ── 3. JudgeVerdict 정본 계약 (BLOCKER C1/C2) ──────────────────────────────

  describe('JudgeVerdict 정본 계약 검증 (BLOCKER C1/C2)', () => {
    test('kind는 thrashing | false_success | none 중 하나', async () => {
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 1)

      expect(['thrashing', 'false_success', 'none']).toContain(result.verdict!.kind)
    })

    test('필수 필드(subtype, confidence, reason, rawSamples)가 모두 존재한다', async () => {
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 1)
      const v = result.verdict!

      expect(typeof v.subtype).toBe('string')
      expect(typeof v.confidence).toBe('number')
      expect(v.confidence).toBeGreaterThanOrEqual(0)
      expect(v.confidence).toBeLessThanOrEqual(1)
      expect(typeof v.reason).toBe('string')
      expect(Array.isArray(v.rawSamples)).toBe(true)
    })

    test('rawSamples에 수집된 모든 샘플이 보존된다', async () => {
      // n=2 → 4샘플 수집 → rawSamples.length === 4
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      const result = await runJudgeStage(candidate, client, ctx, 2)

      expect(result.verdict!.rawSamples).toHaveLength(4)
    })
  })

  // ── 4. fail-closed ────────────────────────────────────────────────────────

  describe('fail-closed: judgeClient 실패 시 예외 throw', () => {
    test('judgeClient가 throw하면 runJudgeStage도 예외를 전파한다', async () => {
      const client = new FailingJudgeClient()
      const candidate = makePassedCandidate()
      const ctx = makeCtx()

      await expect(runJudgeStage(candidate, client, ctx, 1)).rejects.toThrow(
        'JudgeClient: simulated failure',
      )
    })

    test('게이트 미통과는 failingClient여도 예외가 발생하지 않는다', async () => {
      const client = new FailingJudgeClient()
      const candidate = makeFailedCandidate()
      const ctx = makeCtx()

      // gate_passed=false → 즉시 건너뜀, judgeClient 미호출 → 예외 없음
      const result = await runJudgeStage(candidate, client, ctx, 1)

      expect(result.skipped).toBe(true)
    })
  })

  // ── 5. 완전 통합: JudgeStageResult 구조 검증 ─────────────────────────────

  describe('JudgeStageResult 완전 통합 검증', () => {
    test('게이트 통과분: { skipped:false, verdict:{...}, candidate } 구조 전체 검증', async () => {
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makePassedCandidate()
      const ctx = makeCtx('발화A', '발화B', 'thrashing')

      const result: JudgeStageResult = await runJudgeStage(candidate, client, ctx, 1)

      // skipped 플래그
      expect(result.skipped).toBe(false)
      // candidate 참조
      expect(result.candidate).toBe(candidate)
      expect(result.candidate.triggerUuid).toBe('uuid-passed-001')
      // verdict 존재
      expect(result.verdict).toBeDefined()
      // verdict 구조
      expect(result.verdict!.kind).toBe('thrashing')
      expect(result.verdict!.subtype).toBe(VERDICT_THRASHING.subtype)
      expect(result.verdict!.confidence).toBeCloseTo(VERDICT_THRASHING.confidence, 5)
      expect(result.verdict!.reason).toBe(VERDICT_THRASHING.reason)
      // rawSamples: n=1 → 2개
      expect(result.verdict!.rawSamples).toHaveLength(2)
    })

    test('게이트 미통과분: { skipped:true, verdict:undefined, candidate } 구조 전체 검증', async () => {
      const client = new FixedJudgeClient(VERDICT_THRASHING)
      const candidate = makeFailedCandidate()
      const ctx = makeCtx()

      const result: JudgeStageResult = await runJudgeStage(candidate, client, ctx, 3)

      expect(result.skipped).toBe(true)
      expect(result.verdict).toBeUndefined()
      expect(result.candidate).toBe(candidate)
      expect(result.candidate.triggerUuid).toBe('uuid-failed-001')
    })

    test('false_success 분류 end-to-end: gate 통과 → verdict.kind=false_success', async () => {
      // AC 핵심: false_success 분류 통합 동작 검증
      const client = new FixedJudgeClient(VERDICT_FALSE_SUCCESS)
      const candidate = makePassedCandidate()
      const ctx = makeCtx('작업완료선언A', '작업완료선언B', 'false_success')

      const result = await runJudgeStage(candidate, client, ctx, 3)

      expect(result.skipped).toBe(false)
      expect(result.verdict!.kind).toBe('false_success')
      expect(result.verdict!.subtype).toBe('wrong_conclusion')
      // n=3 → 6샘플
      expect(result.verdict!.rawSamples).toHaveLength(6)
    })
  })
})
