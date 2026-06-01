/**
 * tests/judge-stage-sub-ac-4e-1.test.ts
 *
 * Sub-AC 4e-1: `judgeStage` returns `null` for gate-rejected input.
 *   - GateResult.pass === false 일 때 judgeStage는 null을 반환한다.
 *   - swapPositions, collectSamples, majorityVote를 호출하지 않는다.
 *
 * SPEC §4: "게이트 미통과 이벤트는 judge에 도달하지 않는다" (비용 게이트 핵심)
 * 외부 API 절대 미호출 — MockJudgeClient 기반, 네트워크·API 키 불필요.
 * BLOCKER C1: kind는 'thrashing' | 'false_success' | 'none'.
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본.
 */

import {
  judgeStage,
  type GateResult,
  type JudgeCallContext,
  type JudgeStageInput,
} from '../src/detect/semantic-stage.js'
import { MockJudgeClient, type JudgeVerdict } from '../src/api/judge-client.js'

// ── 테스트 픽스처 ──────────────────────────────────────────────────────────────

const MODEL_ID = 'claude-3-5-sonnet-20241022'

const VERDICT_THRASHING: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'stuck_error_loop',
  confidence: 0.85,
  reason: '동일 에러가 5회 반복되었습니다.',
  rawSamples: [],
}

function makeCtx(kind: 'thrashing' | 'false_success' = 'thrashing'): JudgeCallContext {
  return {
    kind,
    cacheableBlock: '루브릭 텍스트',
    volatileBlock: '컨텍스트 텍스트',
    modelId: MODEL_ID,
    temperature: 0.4,
  }
}

// ── gate.pass=false → null 반환, judge 미호출 ─────────────────────────────────

describe('judgeStage — gate.pass=false이면 null 반환 (Sub-AC 4e-1)', () => {
  test('gate.pass=false이면 null을 반환한다', async () => {
    const gate: GateResult = { pass: false }
    const client = new MockJudgeClient([]) // 빈 클라이언트 — 호출되면 에러
    const input: JudgeStageInput = {
      gate,
      ctx: makeCtx('thrashing'),
      client,
      selfConsistencyN: 3,
    }

    const result = await judgeStage(input)
    expect(result).toBeNull()
  })

  test('gate.pass=false이면 client.judge를 한 번도 호출하지 않는다', async () => {
    let callCount = 0
    const trackingClient = {
      async judge(): Promise<JudgeVerdict> {
        callCount++
        return VERDICT_THRASHING
      },
    }

    const gate: GateResult = { pass: false }
    const input: JudgeStageInput = {
      gate,
      ctx: makeCtx('thrashing'),
      client: trackingClient,
      selfConsistencyN: 5,
    }

    const result = await judgeStage(input)
    expect(result).toBeNull()
    expect(callCount).toBe(0)
  })

  test('gate.pass=false이면 swapPositions 효과가 적용되지 않는다 (swap 미호출 검증)', async () => {
    // swapPositions 호출 여부를 직접 추적할 수 없으므로,
    // judge 미호출(callCount=0)로 swap→collectSamples 파이프라인 전체가 건너뛰어짐을 검증한다.
    let callCount = 0
    const trackingClient = {
      async judge(): Promise<JudgeVerdict> {
        callCount++
        return VERDICT_THRASHING
      },
    }

    const gate: GateResult = { pass: false }
    const input: JudgeStageInput = {
      gate,
      ctx: makeCtx('false_success'),
      client: trackingClient,
      selfConsistencyN: 1,
    }

    const result = await judgeStage(input)
    expect(result).toBeNull()
    expect(callCount).toBe(0)
  })

  test('selfConsistencyN 값에 관계없이 gate.pass=false이면 null을 반환한다', async () => {
    const client = new MockJudgeClient([]) // 호출 시 에러 → 호출하지 않아야 통과

    for (const n of [0, 1, 3, 10]) {
      const gate: GateResult = { pass: false }
      const input: JudgeStageInput = {
        gate,
        ctx: makeCtx('thrashing'),
        client,
        selfConsistencyN: n,
      }

      const result = await judgeStage(input)
      expect(result).toBeNull()
    }
  })

  test('gate.pass=false이면 majorityVote가 호출되지 않는다 (결과가 null)', async () => {
    // majorityVote가 호출됐다면 JudgeVerdict를 반환했을 것이다.
    // null 반환 = majorityVote 미호출 증거.
    const client = new MockJudgeClient([])
    const gate: GateResult = { pass: false }
    const input: JudgeStageInput = {
      gate,
      ctx: makeCtx('thrashing'),
      client,
      selfConsistencyN: 3,
    }

    const result = await judgeStage(input)
    // null이므로 JudgeVerdict 구조가 아님 (majorityVote 미호출 증거)
    expect(result).toBeNull()
    expect(result === null).toBe(true)
  })
})

// ── 불변성: gate.pass=false이어도 입력 ctx가 변경되지 않는다 ──────────────────

describe('judgeStage — gate.pass=false 시 입력 불변성', () => {
  test('gate.pass=false 호출 후 ctx 객체가 변경되지 않는다', async () => {
    const client = new MockJudgeClient([])
    const ctx = Object.freeze(makeCtx('thrashing'))
    const gate: GateResult = { pass: false }
    const input: JudgeStageInput = {
      gate,
      ctx,
      client,
      selfConsistencyN: 3,
    }

    const result = await judgeStage(input)
    expect(result).toBeNull()
    expect(ctx.kind).toBe('thrashing')
    expect(ctx.modelId).toBe(MODEL_ID)
    expect(ctx.cacheableBlock).toBe('루브릭 텍스트')
    expect(ctx.volatileBlock).toBe('컨텍스트 텍스트')
  })

  test('gate.pass=false 호출 후 gate 객체가 변경되지 않는다', async () => {
    const client = new MockJudgeClient([])
    const gate: GateResult = Object.freeze({ pass: false })
    const input: JudgeStageInput = {
      gate,
      ctx: makeCtx(),
      client,
      selfConsistencyN: 2,
    }

    const result = await judgeStage(input)
    expect(result).toBeNull()
    expect(gate.pass).toBe(false)
  })
})
