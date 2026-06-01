/**
 * tests/judge-stage-sub-ac-4e-2.test.ts
 *
 * Sub-AC 4e-2: `judgeStage` calls `collectSamples(n)` and `swapPositions`
 *   for gate-passed input — verifies they are invoked with correct arguments
 *   when `GateResult.pass === true`.
 *
 * 전략: ESM 환경에서 같은 모듈 내부 함수를 spyOn으로 가로채는 것은 불가능
 * (ESM live binding은 내부 직접 참조를 intercept하지 못함).
 * 따라서 observable effect 검증 전략을 사용한다:
 *
 *   1. collectSamples(n) 호출 여부 → 추적 가능한 MockJudgeClient로 judge 호출 횟수 검증.
 *      selfConsistencyN=N일 때 원본+swap 두 컨텍스트 각각 N번씩 → 총 2*N회 judge 호출.
 *
 *   2. swapPositions 호출 여부 → 두 번째 collectSamples가 받는 ctx의
 *      cacheableBlock/volatileBlock이 원본 ctx와 교환되었는지 검증.
 *      (judge 호출 시 req.cacheableBlock/volatileBlock으로 관측 가능)
 *
 * SPEC §4: gate 통과분에만 judge 호출.
 * SPEC §5: position swap + self-consistency N 표본 수집 편향완화.
 * 외부 API 절대 미호출 — 추적 가능한 Mock 클라이언트, 네트워크·API 키 불필요.
 * BLOCKER C1: kind는 'thrashing' | 'false_success' | 'none'.
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본.
 */

import { judgeStage } from '../src/detect/semantic-stage.js'
import type {
  GateResult,
  JudgeCallContext,
  JudgeStageInput,
} from '../src/detect/semantic-stage.js'
import type { JudgeClient, JudgeRequest, JudgeVerdict } from '../src/api/judge-client.js'

// ── 추적 가능한 Mock JudgeClient ───────────────────────────────────────────────

/**
 * judge 호출 기록을 남기는 추적 가능한 Mock JudgeClient.
 * 외부 API 절대 미호출 — 결정론 반환값을 사용한다.
 */
class TrackingJudgeClient implements JudgeClient {
  readonly calls: JudgeRequest[] = []
  readonly #verdict: JudgeVerdict

  constructor(verdict: JudgeVerdict) {
    this.#verdict = verdict
  }

  async judge(req: JudgeRequest): Promise<JudgeVerdict> {
    // 불변성: req를 복사하여 저장 (req 객체가 나중에 바뀔 경우 방어)
    this.calls.push({ ...req })
    return { ...this.#verdict }
  }

  get callCount(): number {
    return this.calls.length
  }

  /** 특정 인덱스 호출에 쓰인 req를 반환 */
  callAt(index: number): JudgeRequest {
    const call = this.calls[index]
    if (call === undefined) {
      throw new Error(`callAt(${index}): only ${this.calls.length} calls recorded`)
    }
    return call
  }
}

// ── 테스트 픽스처 ──────────────────────────────────────────────────────────────

const MODEL_ID = 'claude-3-5-sonnet-20241022'

const VERDICT_THRASHING: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'stuck_error_loop',
  confidence: 0.85,
  reason: '동일 에러가 5회 반복되었습니다.',
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

// ── collectSamples(n) 호출 검증: judge 총 호출 횟수 ──────────────────────────

describe('judgeStage — gate.pass=true 시 collectSamples(n) 호출 검증 (Sub-AC 4e-2)', () => {
  test('selfConsistencyN=1이면 judge 클라이언트가 총 2회 호출된다(원본+swap 각 1회)', async () => {
    // SPEC §5: collectSamples(client, ctx, N) + collectSamples(client, swappedCtx, N)
    // selfConsistencyN=1 → 원본 1회 + swap 1회 = 2회
    const client = new TrackingJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 1,
    }

    await judgeStage(input)

    expect(client.callCount).toBe(2)
  })

  test('selfConsistencyN=3이면 judge 클라이언트가 총 6회 호출된다(원본+swap 각 3회)', async () => {
    // selfConsistencyN=3 → 원본 3회 + swap 3회 = 6회
    const client = new TrackingJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 3,
    }

    await judgeStage(input)

    expect(client.callCount).toBe(6)
  })

  test('selfConsistencyN=5이면 judge 클라이언트가 총 10회 호출된다', async () => {
    const client = new TrackingJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 5,
    }

    await judgeStage(input)

    expect(client.callCount).toBe(10)
  })

  test('selfConsistencyN=0이면 judge 클라이언트가 0회 호출된다', async () => {
    // n < 1이면 collectSamples는 즉시 빈 배열 반환 (client 미호출)
    const client = new TrackingJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 0,
    }

    await judgeStage(input)

    expect(client.callCount).toBe(0)
  })

  test('judge 호출 횟수는 selfConsistencyN의 정확히 2배이다', async () => {
    for (const n of [1, 2, 4]) {
      const client = new TrackingJudgeClient(VERDICT_THRASHING)
      const input: JudgeStageInput = {
        gate: makePassedGate(),
        ctx: makeCtx(),
        client,
        selfConsistencyN: n,
      }

      await judgeStage(input)

      expect(client.callCount).toBe(n * 2)
    }
  })
})

// ── swapPositions 호출 검증: 교환된 cacheableBlock/volatileBlock ──────────────

describe('judgeStage — gate.pass=true 시 swapPositions 효과 검증 (Sub-AC 4e-2)', () => {
  test('두 번째 collectSamples는 cacheableBlock/volatileBlock이 교환된 ctx로 호출된다', async () => {
    // swapPositions 효과:
    //   원본 ctx.cacheableBlock = A, ctx.volatileBlock = B
    //   swapped ctx.cacheableBlock = B (= 원래 volatileBlock)
    //   swapped ctx.volatileBlock = A (= 원래 cacheableBlock)
    const cacheableBlock = 'CACHEABLE_RUBRIC_BLOCK'
    const volatileBlock = 'VOLATILE_CONTEXT_BLOCK'

    const client = new TrackingJudgeClient(VERDICT_THRASHING)
    const ctx = makeCtx(cacheableBlock, volatileBlock)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx,
      client,
      selfConsistencyN: 1,
    }

    await judgeStage(input)

    // selfConsistencyN=1 → 총 2회 호출
    expect(client.callCount).toBe(2)

    // 첫 번째 호출: 원본 ctx (cacheableBlock=A, volatileBlock=B)
    const firstReq = client.callAt(0)
    expect(firstReq.cacheableBlock).toBe(cacheableBlock)
    expect(firstReq.volatileBlock).toBe(volatileBlock)

    // 두 번째 호출: swapped ctx (cacheableBlock=B, volatileBlock=A)
    const secondReq = client.callAt(1)
    expect(secondReq.cacheableBlock).toBe(volatileBlock)   // A↔B 교환
    expect(secondReq.volatileBlock).toBe(cacheableBlock)   // A↔B 교환
  })

  test('원본과 swap ctx의 modelId/kind는 동일하게 유지된다', async () => {
    const client = new TrackingJudgeClient(VERDICT_THRASHING)
    const ctx = makeCtx('루브릭', '컨텍스트', 'false_success')
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx,
      client,
      selfConsistencyN: 1,
    }

    await judgeStage(input)

    const firstReq = client.callAt(0)
    const secondReq = client.callAt(1)

    // kind와 modelId는 swap으로 바뀌지 않아야 한다
    expect(firstReq.kind).toBe('false_success')
    expect(secondReq.kind).toBe('false_success')
    expect(firstReq.modelId).toBe(MODEL_ID)
    expect(secondReq.modelId).toBe(MODEL_ID)
  })

  test('원본 ctx가 먼저 호출되고 swap ctx가 나중에 호출된다', async () => {
    // 호출 순서: collectSamples(client, ctx, N) → collectSamples(client, swappedCtx, N)
    const cacheableBlock = 'ORIGINAL_CACHEABLE'
    const volatileBlock = 'ORIGINAL_VOLATILE'

    const client = new TrackingJudgeClient(VERDICT_THRASHING)
    const ctx = makeCtx(cacheableBlock, volatileBlock)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx,
      client,
      selfConsistencyN: 1,
    }

    await judgeStage(input)

    // 첫 번째(인덱스 0): 원본
    expect(client.callAt(0).cacheableBlock).toBe(cacheableBlock)
    // 두 번째(인덱스 1): swap
    expect(client.callAt(1).cacheableBlock).toBe(volatileBlock)
  })

  test('selfConsistencyN=2이면 원본 2회 + swap 2회 순서로 호출된다', async () => {
    const cacheableBlock = 'RUBRIC'
    const volatileBlock = 'CONTEXT'

    const client = new TrackingJudgeClient(VERDICT_THRASHING)
    const ctx = makeCtx(cacheableBlock, volatileBlock)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx,
      client,
      selfConsistencyN: 2,
    }

    await judgeStage(input)

    expect(client.callCount).toBe(4)

    // 인덱스 0,1: 원본 ctx 2회
    expect(client.callAt(0).cacheableBlock).toBe(cacheableBlock)
    expect(client.callAt(1).cacheableBlock).toBe(cacheableBlock)

    // 인덱스 2,3: swap ctx 2회
    expect(client.callAt(2).cacheableBlock).toBe(volatileBlock)
    expect(client.callAt(3).cacheableBlock).toBe(volatileBlock)
  })
})

// ── judgeStage 반환값 검증 ────────────────────────────────────────────────────

describe('judgeStage — gate.pass=true 시 JudgeVerdict 반환 (Sub-AC 4e-2)', () => {
  test('gate.pass=true이면 null이 아닌 JudgeVerdict를 반환한다', async () => {
    const client = new TrackingJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 1,
    }

    const result = await judgeStage(input)

    expect(result).not.toBeNull()
    expect(result).toMatchObject({
      kind: expect.stringMatching(/^(thrashing|false_success|none)$/),
      subtype: expect.any(String),
      confidence: expect.any(Number),
      reason: expect.any(String),
    })
  })

  test('selfConsistencyN=1이면 반환된 JudgeVerdict는 majorityVote 결과다', async () => {
    // selfConsistencyN=1 → 원본 1개 + swap 1개 = 2개 샘플 → majorityVote
    // 모든 샘플이 동일한 verdict이므로 kind='thrashing', confidence=0.85
    const client = new TrackingJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN: 1,
    }

    const result = await judgeStage(input)

    expect(result).not.toBeNull()
    expect(result!.kind).toBe('thrashing')
    expect(result!.confidence).toBeCloseTo(0.85, 5)
  })

  test('반환된 JudgeVerdict의 rawSamples는 2*selfConsistencyN개이다', async () => {
    const selfConsistencyN = 2
    const client = new TrackingJudgeClient(VERDICT_THRASHING)
    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx: makeCtx(),
      client,
      selfConsistencyN,
    }

    const result = await judgeStage(input)

    // rawSamples는 allSamples(원본N + swapN = 2*N) 전체를 보존 (SPEC §5 감사용)
    expect(result).not.toBeNull()
    expect(result!.rawSamples).toHaveLength(selfConsistencyN * 2)
  })
})

// ── 불변성: gate.pass=true 호출 후 원본 ctx가 변경되지 않는다 ────────────────

describe('judgeStage — gate.pass=true 시 입력 불변성 (Sub-AC 4e-2)', () => {
  test('gate.pass=true 호출 후 원본 ctx 객체가 변경되지 않는다', async () => {
    const client = new TrackingJudgeClient(VERDICT_THRASHING)
    const originalCacheable = '루브릭 텍스트'
    const originalVolatile = '컨텍스트 텍스트'
    const ctx = Object.freeze(makeCtx(originalCacheable, originalVolatile, 'thrashing'))

    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx,
      client,
      selfConsistencyN: 2,
    }

    await judgeStage(input)

    // ctx가 freeze되어 있으므로 수정 시도 시 에러 — 불변성 확인
    expect(ctx.kind).toBe('thrashing')
    expect(ctx.modelId).toBe(MODEL_ID)
    expect(ctx.cacheableBlock).toBe(originalCacheable)
    expect(ctx.volatileBlock).toBe(originalVolatile)
  })

  test('두 번째 collectSamples에 전달된 swapped ctx는 원본 ctx와 다른 새 객체이다', async () => {
    const client = new TrackingJudgeClient(VERDICT_THRASHING)
    const ctx = makeCtx('CACHEABLE', 'VOLATILE')

    const input: JudgeStageInput = {
      gate: makePassedGate(),
      ctx,
      client,
      selfConsistencyN: 1,
    }

    await judgeStage(input)

    // 첫 번째 호출(원본)의 cacheableBlock과 두 번째 호출(swap)의 cacheableBlock이 다름
    expect(client.callAt(0).cacheableBlock).toBe('CACHEABLE')
    expect(client.callAt(1).cacheableBlock).toBe('VOLATILE') // swapped
    // 원본 ctx 자체는 변경되지 않음
    expect(ctx.cacheableBlock).toBe('CACHEABLE')
    expect(ctx.volatileBlock).toBe('VOLATILE')
  })
})
