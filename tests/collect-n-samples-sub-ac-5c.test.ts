/**
 * tests/collect-n-samples-sub-ac-5c.test.ts
 *
 * Sub-AC 5c: `collectNSamples(candidate, judgeClient, ctx, n)`
 *   - buildPositionSwappedPairs를 n회 호출
 *   - 호출 횟수 stub으로 검증
 *   - 반환 배열 길이 === n × 2
 *
 * SPEC §5: position swap + self-consistency N 표본 누적.
 * 외부 API 절대 미호출 — 모든 테스트는 호출 횟수 카운팅 stub으로만 동작.
 * 네트워크·API 키 일절 불필요.
 */

import { collectNSamples } from '../src/detect/collect-n-samples.js'
import type { GateCandidate } from '../src/detect/filter-gate-passed.js'
import type { JudgeClient, JudgeRequest } from '../src/api/judge-client.js'
import type { JudgeVerdict } from '../src/contracts.js'
import type { PositionSwapContext } from '../src/detect/build-position-swapped-pairs.js'

// ── 픽스처 ────────────────────────────────────────────────────────────────────

const ORIGINAL_VERDICT: JudgeVerdict = Object.freeze({
  kind: 'thrashing' as const,
  subtype: 'stuck_error_loop',
  confidence: 0.9,
  reason: '동일 에러 루프 감지.',
  rawSamples: [],
})

const SWAPPED_VERDICT: JudgeVerdict = Object.freeze({
  kind: 'thrashing' as const,
  subtype: 'stuck_error_loop_swapped',
  confidence: 0.85,
  reason: '스왑 순서 동일 에러 루프.',
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

// ── Stub judgeClient 헬퍼 ─────────────────────────────────────────────────────

/**
 * 호출 횟수를 카운팅하는 stubbed JudgeClient.
 * 홀수 호출(1, 3, 5...) → ORIGINAL_VERDICT, 짝수 호출(2, 4, 6...) → SWAPPED_VERDICT
 * buildPositionSwappedPairs가 원본·swap 순서로 2회 호출하므로
 * 이를 통해 각 쌍의 original/swapped를 구별할 수 있다.
 */
function makeCountingJudgeClient(): {
  client: JudgeClient
  callCount: () => number
  calls: JudgeRequest[]
} {
  let count = 0
  const calls: JudgeRequest[] = []

  const client: JudgeClient = {
    async judge(req: JudgeRequest): Promise<JudgeVerdict> {
      count++
      calls.push(req)
      // 홀수 번째 → ORIGINAL_VERDICT, 짝수 번째 → SWAPPED_VERDICT
      return count % 2 === 1 ? ORIGINAL_VERDICT : SWAPPED_VERDICT
    },
  }

  return { client, callCount: () => count, calls }
}

/**
 * 항상 동일 verdict를 반환하는 단순 stub.
 */
function makeConstantJudgeClient(verdict: JudgeVerdict = ORIGINAL_VERDICT): {
  client: JudgeClient
  callCount: () => number
} {
  let count = 0
  const client: JudgeClient = {
    async judge(): Promise<JudgeVerdict> {
      count++
      return verdict
    },
  }
  return { client, callCount: () => count }
}

// ── 1. 기본 동작: n회 호출 → n×2개 배열 ──────────────────────────────────────

describe('collectNSamples — 기본 동작', () => {
  test('n=1이면 buildPositionSwappedPairs를 1회 호출하여 2개 샘플을 반환한다', async () => {
    const { client } = makeCountingJudgeClient()
    const candidate = makePassedCandidate()

    const samples = await collectNSamples(candidate, client, BASE_CTX, 1)

    expect(samples).toHaveLength(2) // 1 × 2
  })

  test('n=2이면 buildPositionSwappedPairs를 2회 호출하여 4개 샘플을 반환한다', async () => {
    const { client } = makeCountingJudgeClient()
    const candidate = makePassedCandidate()

    const samples = await collectNSamples(candidate, client, BASE_CTX, 2)

    expect(samples).toHaveLength(4) // 2 × 2
  })

  test('n=3이면 buildPositionSwappedPairs를 3회 호출하여 6개 샘플을 반환한다', async () => {
    const { client } = makeCountingJudgeClient()
    const candidate = makePassedCandidate()

    const samples = await collectNSamples(candidate, client, BASE_CTX, 3)

    expect(samples).toHaveLength(6) // 3 × 2
  })

  test('n=5이면 10개 샘플을 반환한다', async () => {
    const { client } = makeCountingJudgeClient()
    const candidate = makePassedCandidate()

    const samples = await collectNSamples(candidate, client, BASE_CTX, 5)

    expect(samples).toHaveLength(10) // 5 × 2
  })

  test('샘플 배열 길이는 항상 n × 2이다', async () => {
    for (const n of [1, 3, 5, 7]) {
      const { client } = makeCountingJudgeClient()
      const candidate = makePassedCandidate()
      const samples = await collectNSamples(candidate, client, BASE_CTX, n)
      expect(samples).toHaveLength(n * 2)
    }
  })
})

// ── 2. 호출 횟수 검증 (stub counting) ────────────────────────────────────────

describe('collectNSamples — judgeClient 호출 횟수 검증', () => {
  test('n=1이면 judgeClient.judge가 정확히 2회 호출된다 (buildPositionSwappedPairs 1회 × 2)', async () => {
    const { client, callCount } = makeCountingJudgeClient()
    const candidate = makePassedCandidate()

    await collectNSamples(candidate, client, BASE_CTX, 1)

    expect(callCount()).toBe(2)
  })

  test('n=3이면 judgeClient.judge가 정확히 6회 호출된다 (buildPositionSwappedPairs 3회 × 2)', async () => {
    const { client, callCount } = makeCountingJudgeClient()
    const candidate = makePassedCandidate()

    await collectNSamples(candidate, client, BASE_CTX, 3)

    expect(callCount()).toBe(6)
  })

  test('n=N이면 judgeClient.judge가 정확히 N×2회 호출된다', async () => {
    for (const n of [1, 2, 3, 5]) {
      const { client, callCount } = makeConstantJudgeClient()
      const candidate = makePassedCandidate()
      await collectNSamples(candidate, client, BASE_CTX, n)
      expect(callCount()).toBe(n * 2)
    }
  })
})

// ── 3. n < 1이면 즉시 빈 배열 반환 (client 미호출) ──────────────────────────

describe('collectNSamples — n < 1이면 client 미호출, 빈 배열 반환', () => {
  test('n=0이면 빈 배열을 반환한다 (client 미호출)', async () => {
    const { client, callCount } = makeConstantJudgeClient()
    const candidate = makePassedCandidate()

    const samples = await collectNSamples(candidate, client, BASE_CTX, 0)

    expect(samples).toHaveLength(0)
    expect(samples).toEqual([])
    expect(callCount()).toBe(0)
  })

  test('n=-1이면 빈 배열을 반환한다 (client 미호출)', async () => {
    const { client, callCount } = makeConstantJudgeClient()
    const candidate = makePassedCandidate()

    const samples = await collectNSamples(candidate, client, BASE_CTX, -1)

    expect(samples).toHaveLength(0)
    expect(callCount()).toBe(0)
  })
})

// ── 4. 결과 배열이 [original, swapped, original, swapped, ...] 순서 ──────────

describe('collectNSamples — 호출 순서 보존', () => {
  test('결과 배열이 [pair0.original, pair0.swapped, pair1.original, pair1.swapped, ...] 순서이다', async () => {
    const { client } = makeCountingJudgeClient()
    const candidate = makePassedCandidate()

    const samples = await collectNSamples(candidate, client, BASE_CTX, 2)

    // makeCountingJudgeClient: 홀수번 호출 → ORIGINAL_VERDICT, 짝수번 → SWAPPED_VERDICT
    expect(samples[0]).toBe(ORIGINAL_VERDICT) // pair0.original (1번째 judge 호출)
    expect(samples[1]).toBe(SWAPPED_VERDICT)  // pair0.swapped  (2번째 judge 호출)
    expect(samples[2]).toBe(ORIGINAL_VERDICT) // pair1.original (3번째 judge 호출)
    expect(samples[3]).toBe(SWAPPED_VERDICT)  // pair1.swapped  (4번째 judge 호출)
  })
})

// ── 5. gate_passed=false → 에러 전파 ──────────────────────────────────────────

describe('collectNSamples — gate_passed=false 보호', () => {
  test('gate_passed=false 후보에 호출하면 JudgeGateNotPassedError를 throw한다', async () => {
    const { client } = makeConstantJudgeClient()
    const candidate = makeFailedCandidate('uuid-blocked')

    await expect(
      collectNSamples(candidate, client, BASE_CTX, 1),
    ).rejects.toThrow('gate_passed=false')
  })

  test('gate_passed=false일 때 judgeClient는 호출되지 않는다', async () => {
    const { client, callCount } = makeConstantJudgeClient()
    const candidate = makeFailedCandidate()

    await collectNSamples(candidate, client, BASE_CTX, 1).catch(() => { /* expected */ })

    expect(callCount()).toBe(0)
  })
})

// ── 6. fail-closed: buildPositionSwappedPairs 실패 시 예외 전파 ───────────────

describe('collectNSamples — fail-closed', () => {
  test('첫 번째 쌍 호출 실패 시 예외를 그대로 throw한다', async () => {
    const error = new Error('API 실패')
    const failClient: JudgeClient = {
      async judge(): Promise<JudgeVerdict> {
        throw error
      },
    }
    const candidate = makePassedCandidate()

    await expect(
      collectNSamples(candidate, failClient, BASE_CTX, 1),
    ).rejects.toThrow('API 실패')
  })

  test('두 번째 쌍 호출 실패 시(n=2) 예외가 전파된다', async () => {
    let pairCount = 0
    const failOnSecondPair: JudgeClient = {
      async judge(): Promise<JudgeVerdict> {
        // buildPositionSwappedPairs는 2회 judge를 호출하므로
        // 3번째 judge 호출(2번째 쌍의 첫 호출)에서 실패
        pairCount++
        if (pairCount === 3) throw new Error('2번째 쌍 실패')
        return ORIGINAL_VERDICT
      },
    }
    const candidate = makePassedCandidate()

    await expect(
      collectNSamples(candidate, failOnSecondPair, BASE_CTX, 2),
    ).rejects.toThrow('2번째 쌍 실패')
  })
})

// ── 7. 불변성: 입력 candidate·ctx 변경 없음 ─────────────────────────────────

describe('collectNSamples — 불변성', () => {
  test('호출 후 원본 ctx가 변경되지 않는다', async () => {
    const { client } = makeConstantJudgeClient()
    const candidate = makePassedCandidate()
    const ctx: PositionSwapContext = { ...BASE_CTX }
    const originalA = ctx.positionA
    const originalB = ctx.positionB

    await collectNSamples(candidate, client, ctx, 2)

    expect(ctx.positionA).toBe(originalA)
    expect(ctx.positionB).toBe(originalB)
  })

  test('Object.freeze된 ctx에서도 정상 동작한다', async () => {
    const { client } = makeConstantJudgeClient()
    const candidate = makePassedCandidate()
    const frozenCtx = Object.freeze<PositionSwapContext>({ ...BASE_CTX })

    const samples = await collectNSamples(candidate, client, frozenCtx, 1)

    expect(samples).toHaveLength(2)
  })
})

// ── 8. RawSample 타입 계약 준수 (BLOCKER C1/C2) ──────────────────────────────

describe('collectNSamples — RawSample이 JudgeVerdict 계약을 준수한다 (BLOCKER C1/C2)', () => {
  test('각 RawSample은 JudgeVerdict 필수 필드를 모두 포함한다', async () => {
    const { client } = makeConstantJudgeClient()
    const candidate = makePassedCandidate()

    const samples = await collectNSamples(candidate, client, BASE_CTX, 2)

    for (const s of samples) {
      expect(['thrashing', 'false_success', 'none']).toContain(s.kind)
      expect(typeof s.subtype).toBe('string')
      expect(typeof s.confidence).toBe('number')
      expect(typeof s.reason).toBe('string')
      expect(Array.isArray(s.rawSamples)).toBe(true)
    }
  })

  test("RawSample.kind에 금지된 리터럴('fake_success')이 나오지 않는다 (BLOCKER C1)", async () => {
    const { client } = makeConstantJudgeClient()
    const candidate = makePassedCandidate()

    const samples = await collectNSamples(candidate, client, BASE_CTX, 3)

    for (const s of samples) {
      expect(s.kind).not.toBe('fake_success')
      expect(s.kind).not.toBe('fakeSuccess')
    }
  })
})
