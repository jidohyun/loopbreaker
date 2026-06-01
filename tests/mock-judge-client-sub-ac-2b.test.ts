/**
 * tests/mock-judge-client-sub-ac-2b.test.ts
 *
 * Sub-AC 2b: MockJudgeClient — sha256 입력 해시 기반 결정론 단위 테스트.
 *
 * 검증 사항:
 *   1. 동일 입력(prompt + modelId) → 항상 동일 verdict 반환
 *   2. 다른 입력 → 다른 verdict 반환
 *   3. 캐시 미스 시 명시적 에러 throw (조용한 폴백 금지)
 *   4. register() 불변성 — 원본 인스턴스 불변
 *   5. sha256Prompt 유틸리티 결정론성
 *
 * 제약: 외부 API 절대 미호출 — MockJudgeClientWithHashKey + sha256Prompt만 사용.
 * SPEC §1 표준 e: cacheKey = sha256(cacheableBlock + volatileBlock) + ':' + modelId
 * BLOCKER C1: kind는 'false_success' 단일 ('fakeSuccess'/'fake_success' 금지)
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본
 */

import { createHash } from 'node:crypto'
import {
  MockJudgeClientWithHashKey,
  sha256Prompt,
  type JudgeVerdict,
  type JudgeRequest,
  type MockJudgeHashEntry,
} from '../src/api/judge-client.js'

// ── 테스트 픽스처 ─────────────────────────────────────────────────────────────

const MODEL_ID = 'claude-3-5-sonnet-20241022'

const VERDICT_FALSE_SUCCESS: JudgeVerdict = {
  kind: 'false_success',
  subtype: 'unverified_completion',
  confidence: 0.92,
  topicDivergence: 0.1,
  circularReference: true,
  reason: '완료선언 직전 검증 tool_result가 없습니다.',
  rawSamples: ['완료했습니다.', { step: 3, tool: 'Bash' }],
}

const VERDICT_THRASHING: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'stuck_error_loop',
  confidence: 0.85,
  topicDivergence: 0.3,
  circularReference: false,
  reason: '동일 에러가 5회 반복되었습니다.',
  rawSamples: ['에러 A', '에러 A', '에러 A'],
}

const VERDICT_NONE: JudgeVerdict = {
  kind: 'none',
  subtype: '',
  confidence: 0.05,
  reason: '정상입니다.',
  rawSamples: [],
}

// ── 헬퍼: 캐시 키 계산 (SPEC §1 표준 e) ────────────────────────────────────────

function makeCacheKey(cacheableBlock: string, volatileBlock: string, modelId: string): string {
  const prompt = cacheableBlock + volatileBlock
  return `${sha256Prompt(prompt)}:${modelId}`
}

function makeReq(
  cacheableBlock: string,
  volatileBlock: string,
  modelId = MODEL_ID,
): JudgeRequest {
  return {
    kind: 'false_success',
    cacheableBlock,
    volatileBlock,
    modelId,
  }
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('sha256Prompt — 유틸리티 결정론성', () => {
  it('동일 문자열에 대해 항상 동일 hex를 반환한다', () => {
    const text = '루브릭 텍스트 + 변동 블록'
    const h1 = sha256Prompt(text)
    const h2 = sha256Prompt(text)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/) // sha256 hex = 64자
  })

  it('다른 문자열에 대해 다른 hex를 반환한다', () => {
    const h1 = sha256Prompt('input A')
    const h2 = sha256Prompt('input B')
    expect(h1).not.toBe(h2)
  })

  it('빈 문자열도 결정론적으로 처리한다', () => {
    const expected = createHash('sha256').update('', 'utf8').digest('hex')
    expect(sha256Prompt('')).toBe(expected)
  })

  it('한국어 포함 UTF-8 문자열도 결정론적으로 처리한다', () => {
    const text = '에이전트가 동일 작업을 반복하고 있습니다.'
    const h1 = sha256Prompt(text)
    const h2 = sha256Prompt(text)
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(64)
  })
})

describe('MockJudgeClientWithHashKey — 동일 입력 → 동일 verdict (결정론)', () => {
  const cacheableBlock = '루브릭: false_success 판정 기준...'
  const volatileBlock = '판정 대상 컨텍스트: step 1~10'
  const key = makeCacheKey(cacheableBlock, volatileBlock, MODEL_ID)

  const entry: MockJudgeHashEntry = { cacheKey: key, verdict: VERDICT_FALSE_SUCCESS }
  const client = new MockJudgeClientWithHashKey([entry])

  it('동일 입력으로 첫 번째 호출 시 올바른 verdict를 반환한다', async () => {
    const req = makeReq(cacheableBlock, volatileBlock)
    const result = await client.judge(req)
    expect(result.kind).toBe('false_success')
    expect(result.confidence).toBe(0.92)
    expect(result.circularReference).toBe(true)
  })

  it('동일 입력으로 두 번째 호출 시에도 동일한 verdict를 반환한다 (결정론)', async () => {
    const req = makeReq(cacheableBlock, volatileBlock)
    const r1 = await client.judge(req)
    const r2 = await client.judge(req)
    expect(r1).toEqual(r2)
  })

  it('동일 입력을 N번 반복해도 항상 동일한 verdict를 반환한다', async () => {
    const req = makeReq(cacheableBlock, volatileBlock)
    const results = await Promise.all(
      Array.from({ length: 5 }, () => client.judge(req))
    )
    for (const r of results) {
      expect(r).toEqual(VERDICT_FALSE_SUCCESS)
    }
  })
})

describe('MockJudgeClientWithHashKey — 다른 입력 → 다른 verdict', () => {
  const cacheableBlockA = '루브릭 A: thrashing 판정 기준...'
  const volatileBlockA = '컨텍스트 A: 에러 루프 5회'

  const cacheableBlockB = '루브릭 B: false_success 판정 기준...'
  const volatileBlockB = '컨텍스트 B: 완료선언 무검증'

  const keyA = makeCacheKey(cacheableBlockA, volatileBlockA, MODEL_ID)
  const keyB = makeCacheKey(cacheableBlockB, volatileBlockB, MODEL_ID)

  const client = new MockJudgeClientWithHashKey([
    { cacheKey: keyA, verdict: VERDICT_THRASHING },
    { cacheKey: keyB, verdict: VERDICT_FALSE_SUCCESS },
  ])

  it('입력 A는 thrashing verdict를 반환한다', async () => {
    const result = await client.judge(makeReq(cacheableBlockA, volatileBlockA))
    expect(result.kind).toBe('thrashing')
    expect(result.confidence).toBe(0.85)
  })

  it('입력 B는 false_success verdict를 반환한다', async () => {
    const result = await client.judge(makeReq(cacheableBlockB, volatileBlockB))
    expect(result.kind).toBe('false_success')
    expect(result.confidence).toBe(0.92)
  })

  it('입력 A와 B가 서로 다른 verdict를 반환한다 (다른 입력 → 다른 결과)', async () => {
    const rA = await client.judge(makeReq(cacheableBlockA, volatileBlockA))
    const rB = await client.judge(makeReq(cacheableBlockB, volatileBlockB))
    expect(rA.kind).not.toBe(rB.kind)
    expect(rA).not.toEqual(rB)
  })

  it('cacheableBlock만 달라도 다른 verdict를 반환한다', async () => {
    const sameVolatile = '공통 컨텍스트'
    const block1 = '루브릭 버전 1'
    const block2 = '루브릭 버전 2'
    const key1 = makeCacheKey(block1, sameVolatile, MODEL_ID)
    const key2 = makeCacheKey(block2, sameVolatile, MODEL_ID)

    const localClient = new MockJudgeClientWithHashKey([
      { cacheKey: key1, verdict: VERDICT_THRASHING },
      { cacheKey: key2, verdict: VERDICT_NONE },
    ])

    const r1 = await localClient.judge(makeReq(block1, sameVolatile))
    const r2 = await localClient.judge(makeReq(block2, sameVolatile))
    expect(r1.kind).toBe('thrashing')
    expect(r2.kind).toBe('none')
    expect(r1).not.toEqual(r2)
  })

  it('volatileBlock만 달라도 다른 verdict를 반환한다', async () => {
    const sameBlock = '동일 루브릭'
    const volatile1 = '컨텍스트 버전 1'
    const volatile2 = '컨텍스트 버전 2'
    const key1 = makeCacheKey(sameBlock, volatile1, MODEL_ID)
    const key2 = makeCacheKey(sameBlock, volatile2, MODEL_ID)

    const localClient = new MockJudgeClientWithHashKey([
      { cacheKey: key1, verdict: VERDICT_THRASHING },
      { cacheKey: key2, verdict: VERDICT_FALSE_SUCCESS },
    ])

    const r1 = await localClient.judge(makeReq(sameBlock, volatile1))
    const r2 = await localClient.judge(makeReq(sameBlock, volatile2))
    expect(r1.kind).toBe('thrashing')
    expect(r2.kind).toBe('false_success')
  })

  it('modelId만 달라도 다른 캐시 키로 조회한다', async () => {
    const block = '공통 루브릭'
    const volatile = '공통 컨텍스트'
    const modelA = 'claude-3-5-sonnet-20241022'
    const modelB = 'claude-3-opus-20240229'
    const keyA2 = makeCacheKey(block, volatile, modelA)
    const keyB2 = makeCacheKey(block, volatile, modelB)

    // 두 키가 달라야 한다
    expect(keyA2).not.toBe(keyB2)

    const localClient = new MockJudgeClientWithHashKey([
      { cacheKey: keyA2, verdict: VERDICT_THRASHING },
      { cacheKey: keyB2, verdict: VERDICT_NONE },
    ])

    const rA = await localClient.judge({ ...makeReq(block, volatile), modelId: modelA })
    const rB = await localClient.judge({ ...makeReq(block, volatile), modelId: modelB })
    expect(rA.kind).toBe('thrashing')
    expect(rB.kind).toBe('none')
  })
})

describe('MockJudgeClientWithHashKey — 캐시 미스 시 에러 throw (조용한 폴백 금지)', () => {
  const client = new MockJudgeClientWithHashKey([])

  it('등록되지 않은 키로 호출 시 에러를 throw한다', async () => {
    const req = makeReq('미등록 루브릭', '미등록 컨텍스트')
    await expect(client.judge(req)).rejects.toThrow('캐시 미스')
  })

  it('에러 메시지에 캐시 키 정보가 포함된다', async () => {
    const req = makeReq('루브릭', '컨텍스트')
    const expectedKey = makeCacheKey('루브릭', '컨텍스트', MODEL_ID)
    await expect(client.judge(req)).rejects.toThrow(expectedKey)
  })

  it('항목을 등록한 후에도 미등록 키는 에러를 throw한다', async () => {
    const registered = '등록된 루브릭'
    const registeredVolatile = '등록된 컨텍스트'
    const key = makeCacheKey(registered, registeredVolatile, MODEL_ID)
    const localClient = new MockJudgeClientWithHashKey([
      { cacheKey: key, verdict: VERDICT_NONE },
    ])

    // 등록된 키는 성공
    const result = await localClient.judge(makeReq(registered, registeredVolatile))
    expect(result.kind).toBe('none')

    // 미등록 키는 실패
    await expect(localClient.judge(makeReq('미등록', '미등록'))).rejects.toThrow('캐시 미스')
  })
})

describe('MockJudgeClientWithHashKey — register() 불변성', () => {
  it('register()는 새 인스턴스를 반환한다 (원본 불변)', async () => {
    const original = new MockJudgeClientWithHashKey([])
    const block = '루브릭'
    const volatile = '컨텍스트'
    const key = makeCacheKey(block, volatile, MODEL_ID)

    const extended = original.register({ cacheKey: key, verdict: VERDICT_THRASHING })

    // 원본은 변경되지 않아야 함
    await expect(original.judge(makeReq(block, volatile))).rejects.toThrow('캐시 미스')

    // 확장된 인스턴스는 정상 동작
    const result = await extended.judge(makeReq(block, volatile))
    expect(result.kind).toBe('thrashing')
  })

  it('register()를 연쇄 호출해도 각 단계별로 불변 인스턴스가 유지된다', async () => {
    const b1 = '루브릭1'; const v1 = '컨텍스트1'
    const b2 = '루브릭2'; const v2 = '컨텍스트2'
    const k1 = makeCacheKey(b1, v1, MODEL_ID)
    const k2 = makeCacheKey(b2, v2, MODEL_ID)

    const c0 = new MockJudgeClientWithHashKey([])
    const c1 = c0.register({ cacheKey: k1, verdict: VERDICT_THRASHING })
    const c2 = c1.register({ cacheKey: k2, verdict: VERDICT_FALSE_SUCCESS })

    // c0: 둘 다 미등록
    await expect(c0.judge(makeReq(b1, v1))).rejects.toThrow('캐시 미스')
    await expect(c0.judge(makeReq(b2, v2))).rejects.toThrow('캐시 미스')

    // c1: k1만 등록
    const r1 = await c1.judge(makeReq(b1, v1))
    expect(r1.kind).toBe('thrashing')
    await expect(c1.judge(makeReq(b2, v2))).rejects.toThrow('캐시 미스')

    // c2: k1, k2 모두 등록
    const rc1 = await c2.judge(makeReq(b1, v1))
    const rc2 = await c2.judge(makeReq(b2, v2))
    expect(rc1.kind).toBe('thrashing')
    expect(rc2.kind).toBe('false_success')
  })
})

describe('MockJudgeClientWithHashKey — JudgeVerdict 계약 준수 (BLOCKER C1/C2)', () => {
  it('반환된 verdict의 kind는 허용된 리터럴만 포함한다 (C1)', async () => {
    const allowedKinds = new Set(['thrashing', 'false_success', 'none'])
    const verdicts = [VERDICT_FALSE_SUCCESS, VERDICT_THRASHING, VERDICT_NONE]

    for (const v of verdicts) {
      const block = `루브릭-${v.kind}`
      const volatile = `컨텍스트-${v.kind}`
      const key = makeCacheKey(block, volatile, MODEL_ID)
      const client = new MockJudgeClientWithHashKey([{ cacheKey: key, verdict: v }])
      const result = await client.judge(makeReq(block, volatile))
      expect(allowedKinds.has(result.kind)).toBe(true)
    }
  })

  it('반환된 verdict는 contracts.ts 정본 필드를 모두 포함한다 (C2)', async () => {
    const block = '루브릭'
    const volatile = '컨텍스트'
    const key = makeCacheKey(block, volatile, MODEL_ID)
    const client = new MockJudgeClientWithHashKey([
      { cacheKey: key, verdict: VERDICT_FALSE_SUCCESS },
    ])
    const result = await client.judge(makeReq(block, volatile))

    // contracts.ts §1 JudgeVerdict 필수 필드 검증
    expect(typeof result.kind).toBe('string')
    expect(typeof result.subtype).toBe('string')
    expect(typeof result.confidence).toBe('number')
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(typeof result.reason).toBe('string')
    expect(Array.isArray(result.rawSamples)).toBe(true)
  })

  it('rawSamples에 N개 응답이 보존된다 (감사용, SPEC §5)', async () => {
    const block = '루브릭'
    const volatile = '컨텍스트'
    const key = makeCacheKey(block, volatile, MODEL_ID)
    const verdictWithSamples: JudgeVerdict = {
      kind: 'thrashing',
      subtype: 'revert_oscillation',
      confidence: 0.8,
      reason: '되돌리기 반복.',
      rawSamples: ['sample1', 'sample2', 'sample3'], // N=3 self-consistency 표본
    }
    const client = new MockJudgeClientWithHashKey([
      { cacheKey: key, verdict: verdictWithSamples },
    ])
    const result = await client.judge(makeReq(block, volatile))
    expect(result.rawSamples).toHaveLength(3)
    expect(result.rawSamples[0]).toBe('sample1')
  })
})
