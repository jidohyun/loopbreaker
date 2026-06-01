/**
 * tests/build-position-swapped-pairs-sub-ac-5b.test.ts
 *
 * Sub-AC 5b: `buildPositionSwappedPairs(candidate, judgeClient, ctx)`
 *   - gate-passed 후보 1건에 대해 judgeClient를 A/B 원본·swap 순서로 각 1회 호출
 *   - 두 응답을 PositionSwappedPair { original, swapped }로 반환
 *   - gate_passed=false이면 JudgeGateNotPassedError throw
 *   - 두 호출의 volatileBlock이 서로 다름 (A/B 위치 교환 검증)
 *
 * SPEC §5: position swap — 편향완화(position bias mitigation).
 * 외부 API 절대 미호출 — 모든 테스트는 MockJudgeClient (stubbed judgeClient)로만 동작.
 */

import {
  buildPositionSwappedPairs,
  JudgeGateNotPassedError,
  type PositionSwapContext,
} from '../src/detect/build-position-swapped-pairs.js'
import type { GateCandidate } from '../src/detect/filter-gate-passed.js'
import type { JudgeClient, JudgeRequest } from '../src/api/judge-client.js'
import type { JudgeVerdict } from '../src/contracts.js'

// ── 픽스처 ────────────────────────────────────────────────────────────────────

const THRASHING_VERDICT: JudgeVerdict = Object.freeze({
  kind: 'thrashing' as const,
  subtype: 'stuck_error_loop',
  confidence: 0.9,
  reason: '동일 에러 루프 감지.',
  rawSamples: [],
})

const FALSE_SUCCESS_VERDICT: JudgeVerdict = Object.freeze({
  kind: 'false_success' as const,
  subtype: 'unverified_completion',
  confidence: 0.85,
  reason: '완료선언이 있으나 검증 없음.',
  rawSamples: [],
})

/** gate_passed=true인 더미 GateCandidate */
function makePassedCandidate(triggerUuid = 'uuid-001'): GateCandidate {
  return {
    gate: null,
    gate_passed: true,
    triggerUuid,
    ts: 1000,
  }
}

/** gate_passed=false인 더미 GateCandidate */
function makeFailedCandidate(triggerUuid = 'uuid-fail'): GateCandidate {
  return {
    gate: null,
    gate_passed: false,
    triggerUuid,
    ts: 2000,
  }
}

/** 기본 PositionSwapContext */
const BASE_CTX: PositionSwapContext = {
  positionA: 'utterance-A text',
  positionB: 'utterance-B text',
  cacheableBlock: 'rubric: detect thrashing',
  modelId: 'claude-3-5-sonnet-20241022',
  kind: 'thrashing',
  temperature: 0.4,
}

// ── 스텁 judgeClient 헬퍼 ────────────────────────────────────────────────────

/**
 * 호출 기록을 남기는 stubbed JudgeClient.
 * 첫 번째 호출 → firstVerdict, 두 번째 호출 → secondVerdict 반환.
 */
function makeStubJudgeClient(
  firstVerdict: JudgeVerdict,
  secondVerdict: JudgeVerdict,
): { client: JudgeClient; calls: JudgeRequest[] } {
  const calls: JudgeRequest[] = []
  const client: JudgeClient = {
    async judge(req: JudgeRequest): Promise<JudgeVerdict> {
      calls.push(req)
      return calls.length === 1 ? firstVerdict : secondVerdict
    },
  }
  return { client, calls }
}

/**
 * 항상 동일한 verdict를 반환하는 단순 stub.
 */
function makeConstantJudgeClient(
  verdict: JudgeVerdict,
): { client: JudgeClient; calls: JudgeRequest[] } {
  return makeStubJudgeClient(verdict, verdict)
}

// ── 1. 기본 동작: 두 응답 반환 ────────────────────────────────────────────────

describe('buildPositionSwappedPairs — 기본 동작', () => {
  test('gate_passed=true 후보에 대해 { original, swapped } 쌍을 반환한다', async () => {
    const { client } = makeStubJudgeClient(THRASHING_VERDICT, FALSE_SUCCESS_VERDICT)
    const candidate = makePassedCandidate()

    const result = await buildPositionSwappedPairs(candidate, client, BASE_CTX)

    expect(result).toHaveProperty('original')
    expect(result).toHaveProperty('swapped')
  })

  test('original은 첫 번째 호출 응답이다', async () => {
    const { client } = makeStubJudgeClient(THRASHING_VERDICT, FALSE_SUCCESS_VERDICT)
    const candidate = makePassedCandidate()

    const result = await buildPositionSwappedPairs(candidate, client, BASE_CTX)

    expect(result.original).toBe(THRASHING_VERDICT)
  })

  test('swapped는 두 번째 호출 응답이다', async () => {
    const { client } = makeStubJudgeClient(THRASHING_VERDICT, FALSE_SUCCESS_VERDICT)
    const candidate = makePassedCandidate()

    const result = await buildPositionSwappedPairs(candidate, client, BASE_CTX)

    expect(result.swapped).toBe(FALSE_SUCCESS_VERDICT)
  })

  test('judgeClient가 정확히 2회 호출된다', async () => {
    const { client, calls } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makePassedCandidate()

    await buildPositionSwappedPairs(candidate, client, BASE_CTX)

    expect(calls).toHaveLength(2)
  })
})

// ── 2. 호출 순서: 원본 먼저, swap 나중 ────────────────────────────────────────

describe('buildPositionSwappedPairs — 호출 순서 보장', () => {
  test('첫 번째 호출은 원본 A/B 순서(positionA=[A], positionB=[B])다', async () => {
    const { client, calls } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makePassedCandidate()

    await buildPositionSwappedPairs(candidate, client, BASE_CTX)

    // 첫 번째 호출의 volatileBlock에 A가 [A]:로, B가 [B]:로 나타나야 한다
    const firstCall = calls[0]!
    expect(firstCall.volatileBlock).toContain('[A]: utterance-A text')
    expect(firstCall.volatileBlock).toContain('[B]: utterance-B text')
  })

  test('두 번째 호출은 swap A/B 순서(positionB=[A], positionA=[B])다', async () => {
    const { client, calls } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makePassedCandidate()

    await buildPositionSwappedPairs(candidate, client, BASE_CTX)

    // 두 번째 호출의 volatileBlock에 B가 [A]:로, A가 [B]:로 나타나야 한다 (swap)
    const secondCall = calls[1]!
    expect(secondCall.volatileBlock).toContain('[A]: utterance-B text')
    expect(secondCall.volatileBlock).toContain('[B]: utterance-A text')
  })

  test('두 호출의 volatileBlock이 서로 다르다 (A/B 교환 검증)', async () => {
    const { client, calls } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makePassedCandidate()

    await buildPositionSwappedPairs(candidate, client, BASE_CTX)

    expect(calls[0]!.volatileBlock).not.toBe(calls[1]!.volatileBlock)
  })
})

// ── 3. 두 호출의 cacheableBlock·modelId·kind 공유 ────────────────────────────

describe('buildPositionSwappedPairs — 공통 필드 전달', () => {
  test('원본·swap 호출 모두 동일한 cacheableBlock을 사용한다', async () => {
    const { client, calls } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makePassedCandidate()

    await buildPositionSwappedPairs(candidate, client, BASE_CTX)

    expect(calls[0]!.cacheableBlock).toBe(BASE_CTX.cacheableBlock)
    expect(calls[1]!.cacheableBlock).toBe(BASE_CTX.cacheableBlock)
  })

  test('원본·swap 호출 모두 동일한 modelId를 사용한다', async () => {
    const { client, calls } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makePassedCandidate()

    await buildPositionSwappedPairs(candidate, client, BASE_CTX)

    expect(calls[0]!.modelId).toBe(BASE_CTX.modelId)
    expect(calls[1]!.modelId).toBe(BASE_CTX.modelId)
  })

  test('원본·swap 호출 모두 동일한 kind를 사용한다', async () => {
    const { client, calls } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makePassedCandidate()

    await buildPositionSwappedPairs(candidate, client, BASE_CTX)

    expect(calls[0]!.kind).toBe(BASE_CTX.kind)
    expect(calls[1]!.kind).toBe(BASE_CTX.kind)
  })

  test('temperature가 두 호출 모두에 전달된다', async () => {
    const { client, calls } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makePassedCandidate()
    const ctx: PositionSwapContext = { ...BASE_CTX, temperature: 0.7 }

    await buildPositionSwappedPairs(candidate, client, ctx)

    expect(calls[0]!.temperature).toBe(0.7)
    expect(calls[1]!.temperature).toBe(0.7)
  })
})

// ── 4. gate_passed=false → JudgeGateNotPassedError ───────────────────────────

describe('buildPositionSwappedPairs — gate_passed=false 보호', () => {
  test('gate_passed=false 후보에 호출하면 JudgeGateNotPassedError를 throw한다', async () => {
    const { client } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makeFailedCandidate('uuid-blocked')

    await expect(
      buildPositionSwappedPairs(candidate, client, BASE_CTX),
    ).rejects.toThrow(JudgeGateNotPassedError)
  })

  test('JudgeGateNotPassedError는 triggerUuid를 보존한다', async () => {
    const { client } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makeFailedCandidate('uuid-blocked-123')

    await expect(
      buildPositionSwappedPairs(candidate, client, BASE_CTX),
    ).rejects.toMatchObject({ triggerUuid: 'uuid-blocked-123' })
  })

  test('gate_passed=false일 때 judgeClient는 호출되지 않는다', async () => {
    const { client, calls } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makeFailedCandidate()

    await buildPositionSwappedPairs(candidate, client, BASE_CTX).catch(() => {
      /* expected throw */
    })

    expect(calls).toHaveLength(0)
  })
})

// ── 5. 불변성: 입력 candidate·ctx 변경 없음 ─────────────────────────────────

describe('buildPositionSwappedPairs — 불변성', () => {
  test('호출 후 원본 ctx.positionA가 변경되지 않는다', async () => {
    const { client } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makePassedCandidate()
    const ctx: PositionSwapContext = { ...BASE_CTX }
    const originalA = ctx.positionA

    await buildPositionSwappedPairs(candidate, client, ctx)

    expect(ctx.positionA).toBe(originalA)
  })

  test('호출 후 원본 ctx.positionB가 변경되지 않는다', async () => {
    const { client } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makePassedCandidate()
    const ctx: PositionSwapContext = { ...BASE_CTX }
    const originalB = ctx.positionB

    await buildPositionSwappedPairs(candidate, client, ctx)

    expect(ctx.positionB).toBe(originalB)
  })

  test('Object.freeze된 ctx에서도 정상 동작한다', async () => {
    const { client } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makePassedCandidate()
    const frozenCtx = Object.freeze<PositionSwapContext>({ ...BASE_CTX })

    const result = await buildPositionSwappedPairs(candidate, client, frozenCtx)

    expect(result).toHaveProperty('original')
    expect(result).toHaveProperty('swapped')
  })
})

// ── 6. fail-closed: judgeClient 실패 시 예외 전파 ────────────────────────────

describe('buildPositionSwappedPairs — fail-closed', () => {
  test('원본 호출 실패 시 예외를 그대로 throw한다', async () => {
    const error = new Error('API 실패 (원본 호출)')
    const failClient: JudgeClient = {
      async judge(): Promise<JudgeVerdict> {
        throw error
      },
    }
    const candidate = makePassedCandidate()

    await expect(
      buildPositionSwappedPairs(candidate, failClient, BASE_CTX),
    ).rejects.toThrow('API 실패 (원본 호출)')
  })

  test('swap 호출 실패 시 예외를 그대로 throw한다', async () => {
    let callCount = 0
    const partialFailClient: JudgeClient = {
      async judge(): Promise<JudgeVerdict> {
        callCount++
        if (callCount === 2) {
          throw new Error('API 실패 (swap 호출)')
        }
        return THRASHING_VERDICT
      },
    }
    const candidate = makePassedCandidate()

    await expect(
      buildPositionSwappedPairs(candidate, partialFailClient, BASE_CTX),
    ).rejects.toThrow('API 실패 (swap 호출)')
  })
})

// ── 7. 대칭성: positionA===positionB일 때도 두 호출이 발생 ────────────────────

describe('buildPositionSwappedPairs — 동일 텍스트 A/B', () => {
  test('positionA===positionB일 때도 judgeClient를 2회 호출한다', async () => {
    const { client, calls } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makePassedCandidate()
    const ctx: PositionSwapContext = {
      ...BASE_CTX,
      positionA: 'same-text',
      positionB: 'same-text',
    }

    await buildPositionSwappedPairs(candidate, client, ctx)

    expect(calls).toHaveLength(2)
  })

  test('positionA===positionB일 때 두 volatileBlock이 동일하다 (swap이 의미 없지만 허용)', async () => {
    const { client, calls } = makeConstantJudgeClient(THRASHING_VERDICT)
    const candidate = makePassedCandidate()
    const ctx: PositionSwapContext = {
      ...BASE_CTX,
      positionA: 'identical',
      positionB: 'identical',
    }

    await buildPositionSwappedPairs(candidate, client, ctx)

    // 동일한 텍스트이므로 swap 후에도 volatileBlock이 같다
    expect(calls[0]!.volatileBlock).toBe(calls[1]!.volatileBlock)
  })
})
