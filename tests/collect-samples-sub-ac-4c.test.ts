/**
 * tests/collect-samples-sub-ac-4c.test.ts
 *
 * Sub-AC 4c: `collectSamples(client: JudgeClient, ctx: JudgeCallContext, n: number): Promise<RawSample[]>`
 *   - JudgeClient를 N회 호출하고 N개의 RawSample 배열을 반환한다
 *
 * SPEC §5: self-consistency — temperature>0로 N회 샘플링, rawSamples에 보존(감사용).
 * 외부 API 절대 미호출 — MockJudgeClient 기반, 네트워크·API 키 불필요.
 * BLOCKER C1: kind는 'false_success'/'thrashing'/'none'.
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본.
 */

import {
  collectSamples,
  type JudgeCallContext,
  type RawSample,
} from '../src/detect/semantic-stage.js'
import { MockJudgeClient, type JudgeVerdict } from '../src/api/judge-client.js'

// ── 테스트 픽스처 ──────────────────────────────────────────────────────────────

const MODEL_ID = 'claude-3-5-sonnet-20241022'

const VERDICT_THRASHING: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'stuck_error_loop',
  confidence: 0.85,
  topicDivergence: 0.3,
  circularReference: false,
  reason: '동일 에러가 5회 반복되었습니다.',
  rawSamples: ['에러 A', '에러 A', '에러 A'],
}

const VERDICT_FALSE_SUCCESS: JudgeVerdict = {
  kind: 'false_success',
  subtype: 'unverified_completion',
  confidence: 0.92,
  topicDivergence: 0.1,
  circularReference: true,
  reason: '완료선언 직전 검증 tool_result가 없습니다.',
  rawSamples: ['완료했습니다.'],
}

const VERDICT_NONE: JudgeVerdict = {
  kind: 'none',
  subtype: '',
  confidence: 0.05,
  reason: '정상입니다.',
  rawSamples: [],
}

/** MockJudgeClient는 _cacheKey 또는 kind:modelId 키로 조회한다. */
function makeCtx(
  kind: 'thrashing' | 'false_success' = 'thrashing',
  modelId = MODEL_ID,
): JudgeCallContext {
  return {
    kind,
    cacheableBlock: '루브릭 텍스트',
    volatileBlock: '컨텍스트 텍스트',
    modelId,
    temperature: 0.4,
  }
}

/** MockJudgeClient 기본 키 = `${kind}:${modelId}` */
function makeMockKey(kind: string, modelId = MODEL_ID): string {
  return `${kind}:${modelId}`
}

// ── N회 호출 → N개 반환 ────────────────────────────────────────────────────────

describe('collectSamples — N회 호출 → N개 RawSample 반환', () => {
  test('n=1이면 client를 1회 호출하여 1개 배열을 반환한다', async () => {
    const client = new MockJudgeClient([
      { cacheKey: makeMockKey('thrashing'), verdict: VERDICT_THRASHING },
    ])
    const ctx = makeCtx('thrashing')
    const samples = await collectSamples(client, ctx, 1)

    expect(samples).toHaveLength(1)
    expect(samples[0]).toEqual(VERDICT_THRASHING)
  })

  test('n=3이면 client를 3회 호출하여 3개 배열을 반환한다', async () => {
    const client = new MockJudgeClient([
      { cacheKey: makeMockKey('thrashing'), verdict: VERDICT_THRASHING },
    ])
    const ctx = makeCtx('thrashing')
    const samples = await collectSamples(client, ctx, 3)

    expect(samples).toHaveLength(3)
    for (const s of samples) {
      expect(s).toEqual(VERDICT_THRASHING)
    }
  })

  test('n=5이면 5개 배열을 반환한다', async () => {
    const client = new MockJudgeClient([
      { cacheKey: makeMockKey('false_success'), verdict: VERDICT_FALSE_SUCCESS },
    ])
    const ctx = makeCtx('false_success')
    const samples = await collectSamples(client, ctx, 5)

    expect(samples).toHaveLength(5)
    for (const s of samples) {
      expect(s.kind).toBe('false_success')
    }
  })
})

// ── n < 1이면 즉시 빈 배열 반환 ──────────────────────────────────────────────

describe('collectSamples — n < 1이면 client 미호출, 빈 배열 반환', () => {
  test('n=0이면 빈 배열을 반환한다 (client 미호출)', async () => {
    // 빈 MockJudgeClient: 호출 시 에러 → 호출하지 않아야 테스트 통과
    const client = new MockJudgeClient([])
    const ctx = makeCtx('thrashing')
    const samples = await collectSamples(client, ctx, 0)

    expect(samples).toHaveLength(0)
    expect(samples).toEqual([])
  })

  test('n=-1이면 빈 배열을 반환한다 (client 미호출)', async () => {
    const client = new MockJudgeClient([])
    const ctx = makeCtx('thrashing')
    const samples = await collectSamples(client, ctx, -1)

    expect(samples).toHaveLength(0)
    expect(samples).toEqual([])
  })
})

// ── 호출 횟수 검증 (call counter mock) ───────────────────────────────────────

describe('collectSamples — client 호출 횟수 정확성', () => {
  test('n=N이면 client.judge가 정확히 N번 호출된다', async () => {
    let callCount = 0
    const countingClient = {
      async judge(): Promise<JudgeVerdict> {
        callCount++
        return VERDICT_NONE
      },
    }

    const ctx = makeCtx('thrashing')
    await collectSamples(countingClient, ctx, 4)

    expect(callCount).toBe(4)
  })

  test('n=1이면 정확히 1번 호출된다', async () => {
    let callCount = 0
    const countingClient = {
      async judge(): Promise<JudgeVerdict> {
        callCount++
        return VERDICT_THRASHING
      },
    }
    const ctx = makeCtx('thrashing')
    await collectSamples(countingClient, ctx, 1)

    expect(callCount).toBe(1)
  })

  test('n=0이면 한 번도 호출되지 않는다', async () => {
    let callCount = 0
    const countingClient = {
      async judge(): Promise<JudgeVerdict> {
        callCount++
        return VERDICT_NONE
      },
    }
    const ctx = makeCtx('thrashing')
    await collectSamples(countingClient, ctx, 0)

    expect(callCount).toBe(0)
  })
})

// ── 호출 순서 보존 ─────────────────────────────────────────────────────────────

describe('collectSamples — 결과 배열이 호출 순서를 보존한다', () => {
  test('각 호출의 결과가 순서대로 배열에 담긴다', async () => {
    let idx = 0
    const verdicts: JudgeVerdict[] = [
      { kind: 'thrashing', subtype: 'a', confidence: 0.9, reason: 'r1', rawSamples: ['s1'] },
      { kind: 'none',      subtype: 'b', confidence: 0.1, reason: 'r2', rawSamples: ['s2'] },
      { kind: 'false_success', subtype: 'c', confidence: 0.8, reason: 'r3', rawSamples: ['s3'] },
    ]
    const orderedClient = {
      async judge(): Promise<JudgeVerdict> {
        return verdicts[idx++]!
      },
    }
    const ctx = makeCtx('thrashing')
    const samples = await collectSamples(orderedClient, ctx, 3)

    expect(samples).toHaveLength(3)
    expect(samples[0]!.subtype).toBe('a')
    expect(samples[1]!.subtype).toBe('b')
    expect(samples[2]!.subtype).toBe('c')
  })
})

// ── RawSample 타입 계약 준수 (BLOCKER C1/C2) ──────────────────────────────────

describe('collectSamples — RawSample이 JudgeVerdict 계약을 준수한다 (BLOCKER C1/C2)', () => {
  test('각 RawSample은 contracts.ts JudgeVerdict 필드를 모두 포함한다', async () => {
    const client = new MockJudgeClient([
      { cacheKey: makeMockKey('false_success'), verdict: VERDICT_FALSE_SUCCESS },
    ])
    const ctx = makeCtx('false_success')
    const samples = await collectSamples(client, ctx, 2)

    for (const s of samples) {
      expect(typeof s.kind).toBe('string')
      expect(['thrashing', 'false_success', 'none']).toContain(s.kind)
      expect(typeof s.subtype).toBe('string')
      expect(typeof s.confidence).toBe('number')
      expect(s.confidence).toBeGreaterThanOrEqual(0)
      expect(s.confidence).toBeLessThanOrEqual(1)
      expect(typeof s.reason).toBe('string')
      expect(Array.isArray(s.rawSamples)).toBe(true)
    }
  })

  test("RawSample.kind에 'fake_success'나 'fakeSuccess'가 나오지 않는다 (BLOCKER C1)", async () => {
    const client = new MockJudgeClient([
      { cacheKey: makeMockKey('false_success'), verdict: VERDICT_FALSE_SUCCESS },
    ])
    const ctx = makeCtx('false_success')
    const samples = await collectSamples(client, ctx, 3)

    for (const s of samples) {
      expect(s.kind).not.toBe('fake_success')
      expect(s.kind).not.toBe('fakeSuccess')
    }
  })
})

// ── 불변성: 입력 ctx를 변경하지 않는다 ──────────────────────────────────────

describe('collectSamples — 입력 ctx 불변성', () => {
  test('collectSamples 호출 후 ctx 객체가 변경되지 않는다', async () => {
    const client = new MockJudgeClient([
      { cacheKey: makeMockKey('thrashing'), verdict: VERDICT_THRASHING },
    ])
    const ctx = Object.freeze(makeCtx('thrashing'))
    // Object.freeze된 객체에서도 에러 없이 동작해야 한다
    const samples = await collectSamples(client, ctx, 2)

    expect(samples).toHaveLength(2)
    expect(ctx.kind).toBe('thrashing')
    expect(ctx.modelId).toBe(MODEL_ID)
  })
})

// ── client 실패 시 예외 전파 ───────────────────────────────────────────────────

describe('collectSamples — client 실패 시 예외를 throw한다 (fail-closed)', () => {
  test('캐시 미스(MockJudgeClient)가 있으면 예외가 throw된다', async () => {
    const client = new MockJudgeClient([]) // 등록 없음 → 캐시 미스
    const ctx = makeCtx('thrashing')

    await expect(collectSamples(client, ctx, 1)).rejects.toThrow()
  })

  test('2번째 호출에서 실패해도 예외가 전파된다', async () => {
    let callCount = 0
    const failOnSecond = {
      async judge(): Promise<JudgeVerdict> {
        callCount++
        if (callCount === 2) throw new Error('2번째 호출 실패')
        return VERDICT_NONE
      },
    }
    const ctx = makeCtx('thrashing')

    await expect(collectSamples(failOnSecond, ctx, 3)).rejects.toThrow('2번째 호출 실패')
  })
})

// ── self-consistency 통합 시나리오 ────────────────────────────────────────────

describe('collectSamples — self-consistency 시나리오 (SPEC §5)', () => {
  test('N개 samples를 rawSamples로 JudgeVerdict에 담을 수 있다', async () => {
    // SPEC §5: collectSamples로 N개를 모아 JudgeVerdict.rawSamples에 보존
    const client = new MockJudgeClient([
      { cacheKey: makeMockKey('thrashing'), verdict: VERDICT_THRASHING },
    ])
    const ctx = makeCtx('thrashing')
    const samples: RawSample[] = await collectSamples(client, ctx, 3)

    // 감사용 통합 — 3개 samples를 flatMap해 rawSamples 보존 시나리오
    const combinedRawSamples = samples.flatMap(s => s.rawSamples)
    expect(combinedRawSamples).toHaveLength(9) // 3회 × 각 3개
  })

  test('kind=false_success 컨텍스트에서도 N개 samples를 정상 수집한다', async () => {
    const client = new MockJudgeClient([
      { cacheKey: makeMockKey('false_success'), verdict: VERDICT_FALSE_SUCCESS },
    ])
    const ctx = makeCtx('false_success')
    const samples = await collectSamples(client, ctx, 3)

    expect(samples).toHaveLength(3)
    expect(samples.every(s => s.kind === 'false_success')).toBe(true)
  })
})
