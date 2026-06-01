/**
 * tests/mock-judge-client-cache-hit-sub-ac-6c-3.test.ts
 *
 * Sub-AC 6c-3: MockJudgeClient.judge(payload, modelId) cache-hit path
 *
 * Spec:
 *   - Compute key via buildCacheKey(cacheableBlock + volatileBlock, modelId).
 *   - Pre-populate MockJudgeClientWithHashKey cache with a known verdict at that key.
 *   - Call judge() with matching cacheableBlock + volatileBlock + modelId.
 *   - Assert returned verdict equals the pre-populated value (cache hit).
 *
 * Also verifies:
 *   - Different payload (different cacheableBlock/volatileBlock) → cache miss (error).
 *   - Different modelId for same payload → cache miss (model namespace isolation).
 *   - Position-swap (A/B reversed) produces a distinct cache key (separate entry).
 *
 * Constraints:
 *   - 외부 API 절대 미호출 — MockJudgeClientWithHashKey만 사용.
 *   - SPEC §1 표준 e: cacheKey = sha256(cacheableBlock + volatileBlock) + ':' + modelId
 *   - BLOCKER C1: kind ∈ {'thrashing','false_success','none'}
 *   - BLOCKER C2: JudgeVerdict는 contracts.ts 정본 타입
 */

import {
  MockJudgeClientWithHashKey,
  sha256Prompt,
  type JudgeVerdict,
  type JudgeRequest,
  type MockJudgeHashEntry,
} from '../src/api/judge-client.js'
import { buildCacheKey } from '../src/api/cache-key.js'

// ── 픽스처 ────────────────────────────────────────────────────────────────────

const MODEL_ID = 'claude-3-5-sonnet-20241022'

const VERDICT_FALSE_SUCCESS: JudgeVerdict = {
  kind: 'false_success',
  subtype: 'unverified_completion',
  confidence: 0.92,
  reason: '완료선언 직전 검증 tool_result가 없습니다.',
  rawSamples: ['완료했습니다.'],
}

const VERDICT_THRASHING: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'stuck_error_loop',
  confidence: 0.87,
  reason: '동일 에러가 반복되었습니다.',
  rawSamples: ['에러 A', '에러 A'],
}

const VERDICT_NONE: JudgeVerdict = {
  kind: 'none',
  subtype: '',
  confidence: 0.05,
  reason: '정상입니다.',
  rawSamples: [],
}

/** JudgeRequest 생성 헬퍼 */
function makeReq(
  cacheableBlock: string,
  volatileBlock: string,
  modelId = MODEL_ID,
  kind: 'thrashing' | 'false_success' = 'false_success',
): JudgeRequest {
  return { kind, cacheableBlock, volatileBlock, modelId }
}

/**
 * SPEC §1 표준 e: cacheKey = sha256(cacheableBlock + volatileBlock) + ':' + modelId
 */
function makeCacheKey(
  cacheableBlock: string,
  volatileBlock: string,
  modelId: string,
): string {
  return buildCacheKey(cacheableBlock + volatileBlock, modelId)
}

// ── 1. 캐시 히트 — 등록한 verdct가 그대로 반환된다 ──────────────────────────────

describe('MockJudgeClientWithHashKey — cache-hit path (Sub-AC 6c-3)', () => {
  const CACHEABLE = '루브릭: false_success 판정 기준\n---'
  const VOLATILE = '최근 이벤트: Bash 완료선언 3회'

  const key = makeCacheKey(CACHEABLE, VOLATILE, MODEL_ID)
  const entry: MockJudgeHashEntry = { cacheKey: key, verdict: VERDICT_FALSE_SUCCESS }
  const client = new MockJudgeClientWithHashKey([entry])

  it('pre-populated 키로 judge()를 호출하면 등록된 verdict를 반환한다', async () => {
    const req = makeReq(CACHEABLE, VOLATILE, MODEL_ID)
    const result = await client.judge(req)
    expect(result).toEqual(VERDICT_FALSE_SUCCESS)
  })

  it('반환 verdict의 kind가 false_success이다', async () => {
    const req = makeReq(CACHEABLE, VOLATILE, MODEL_ID)
    const result = await client.judge(req)
    expect(result.kind).toBe('false_success')
  })

  it('반환 verdict의 모든 필드가 등록된 값과 일치한다', async () => {
    const req = makeReq(CACHEABLE, VOLATILE, MODEL_ID)
    const result = await client.judge(req)
    expect(result.subtype).toBe('unverified_completion')
    expect(result.confidence).toBe(0.92)
    expect(result.reason).toBe('완료선언 직전 검증 tool_result가 없습니다.')
    expect(result.rawSamples).toEqual(['완료했습니다.'])
  })

  it('동일 입력으로 두 번 호출해도 동일 verdict를 반환한다 (결정론)', async () => {
    const req = makeReq(CACHEABLE, VOLATILE, MODEL_ID)
    const r1 = await client.judge(req)
    const r2 = await client.judge(req)
    expect(r1).toEqual(r2)
    expect(r1.kind).toBe('false_success')
  })
})

// ── 2. 캐시 키 계산: buildCacheKey 연동 ──────────────────────────────────────

describe('MockJudgeClientWithHashKey — buildCacheKey 연동 (SPEC §1 표준 e)', () => {
  it('buildCacheKey(prompt, modelId)로 등록하고 같은 prompt+modelId로 조회 → 히트', async () => {
    const cacheableBlock = '시스템 루브릭'
    const volatileBlock = '동적 컨텍스트'
    const prompt = cacheableBlock + volatileBlock

    const key = buildCacheKey(prompt, MODEL_ID)
    const client = new MockJudgeClientWithHashKey([{ cacheKey: key, verdict: VERDICT_THRASHING }])

    const result = await client.judge(makeReq(cacheableBlock, volatileBlock, MODEL_ID, 'thrashing'))
    expect(result).toEqual(VERDICT_THRASHING)
  })

  it('sha256Prompt(prompt) + ":" + modelId 형식의 키가 buildCacheKey와 일치한다', () => {
    const prompt = 'any prompt text here'
    const fromSha256 = sha256Prompt(prompt) + ':' + MODEL_ID
    const fromBuild = buildCacheKey(prompt, MODEL_ID)
    expect(fromSha256).toBe(fromBuild)
  })

  it('캐시 키는 sha256 hex(64자) + ":" + modelId 형식이다', () => {
    const key = buildCacheKey('test payload', MODEL_ID)
    expect(key).toMatch(/^[0-9a-f]{64}:claude-3-5-sonnet-20241022$/)
  })
})

// ── 3. 캐시 미스: 다른 payload → 에러 ───────────────────────────────────────

describe('MockJudgeClientWithHashKey — 캐시 미스 (다른 payload)', () => {
  const CACHEABLE = '루브릭 텍스트'
  const VOLATILE = '변동 컨텍스트'
  const key = makeCacheKey(CACHEABLE, VOLATILE, MODEL_ID)
  const client = new MockJudgeClientWithHashKey([
    { cacheKey: key, verdict: VERDICT_NONE },
  ])

  it('cacheableBlock이 다르면 캐시 미스 에러를 던진다', async () => {
    const req = makeReq('다른 루브릭', VOLATILE, MODEL_ID)
    await expect(client.judge(req)).rejects.toThrow()
  })

  it('volatileBlock이 다르면 캐시 미스 에러를 던진다', async () => {
    const req = makeReq(CACHEABLE, '다른 컨텍스트', MODEL_ID)
    await expect(client.judge(req)).rejects.toThrow()
  })

  it('에러 메시지에 "캐시 미스" 텍스트가 포함된다', async () => {
    const req = makeReq('전혀 다른', '내용', MODEL_ID)
    await expect(client.judge(req)).rejects.toThrow('캐시 미스')
  })
})

// ── 4. 모델 네임스페이스 격리: 다른 modelId → 캐시 미스 ───────────────────────

describe('MockJudgeClientWithHashKey — 모델 네임스페이스 격리', () => {
  const CACHEABLE = '루브릭'
  const VOLATILE = '컨텍스트'
  const ALT_MODEL = 'claude-3-5-haiku-20241022'

  it('같은 payload라도 modelId가 다르면 캐시 미스 에러를 던진다', async () => {
    const key = makeCacheKey(CACHEABLE, VOLATILE, MODEL_ID)
    const client = new MockJudgeClientWithHashKey([
      { cacheKey: key, verdict: VERDICT_THRASHING },
    ])

    // 다른 modelId로 조회 → 미스
    const req = makeReq(CACHEABLE, VOLATILE, ALT_MODEL, 'thrashing')
    await expect(client.judge(req)).rejects.toThrow()
  })

  it('두 modelId 각각 등록하면 각각 독립적으로 히트한다', async () => {
    const keyA = makeCacheKey(CACHEABLE, VOLATILE, MODEL_ID)
    const keyB = makeCacheKey(CACHEABLE, VOLATILE, ALT_MODEL)

    const client = new MockJudgeClientWithHashKey([
      { cacheKey: keyA, verdict: VERDICT_THRASHING },
      { cacheKey: keyB, verdict: VERDICT_FALSE_SUCCESS },
    ])

    const rA = await client.judge(makeReq(CACHEABLE, VOLATILE, MODEL_ID, 'thrashing'))
    const rB = await client.judge(makeReq(CACHEABLE, VOLATILE, ALT_MODEL))

    expect(rA.kind).toBe('thrashing')
    expect(rB.kind).toBe('false_success')
  })
})

// ── 5. Position swap: A/B 순서 역전 시 별도 캐시 엔트리 ─────────────────────

describe('MockJudgeClientWithHashKey — position swap은 별도 캐시 키를 생성한다', () => {
  const TEXT_A = '이전 응답: 작업 완료했습니다.'
  const TEXT_B = '현재 응답: 모든 단계가 끝났습니다.'

  // 원본 순서: A → B (cacheableBlock + A+B)
  const CACHEABLE = '루브릭'
  const VOLATILE_NORMAL = TEXT_A + '\n' + TEXT_B
  const VOLATILE_SWAPPED = TEXT_B + '\n' + TEXT_A

  it('원본 순서와 swap 순서의 캐시 키가 다르다', () => {
    const keyNormal = makeCacheKey(CACHEABLE, VOLATILE_NORMAL, MODEL_ID)
    const keySwapped = makeCacheKey(CACHEABLE, VOLATILE_SWAPPED, MODEL_ID)
    expect(keyNormal).not.toBe(keySwapped)
  })

  it('원본 키로 등록 시, swap 순서 요청은 캐시 미스를 발생시킨다', async () => {
    const keyNormal = makeCacheKey(CACHEABLE, VOLATILE_NORMAL, MODEL_ID)
    const client = new MockJudgeClientWithHashKey([
      { cacheKey: keyNormal, verdict: VERDICT_THRASHING },
    ])

    const swappedReq = makeReq(CACHEABLE, VOLATILE_SWAPPED, MODEL_ID, 'thrashing')
    await expect(client.judge(swappedReq)).rejects.toThrow()
  })

  it('원본 + swap 둘 다 등록하면 각각 히트하고 서로 다른 verdict를 반환할 수 있다', async () => {
    const keyNormal = makeCacheKey(CACHEABLE, VOLATILE_NORMAL, MODEL_ID)
    const keySwapped = makeCacheKey(CACHEABLE, VOLATILE_SWAPPED, MODEL_ID)

    const client = new MockJudgeClientWithHashKey([
      { cacheKey: keyNormal, verdict: VERDICT_THRASHING },
      { cacheKey: keySwapped, verdict: VERDICT_NONE },
    ])

    const rNormal = await client.judge(makeReq(CACHEABLE, VOLATILE_NORMAL, MODEL_ID, 'thrashing'))
    const rSwapped = await client.judge(makeReq(CACHEABLE, VOLATILE_SWAPPED, MODEL_ID))

    expect(rNormal.kind).toBe('thrashing')
    expect(rSwapped.kind).toBe('none')
    expect(rNormal).not.toEqual(rSwapped)
  })
})

// ── 6. register() 불변성: 원본 클라이언트는 변경되지 않는다 ──────────────────

describe('MockJudgeClientWithHashKey — register() 불변성', () => {
  const CACHEABLE = '루브릭'
  const VOLATILE = '컨텍스트'
  const key = makeCacheKey(CACHEABLE, VOLATILE, MODEL_ID)

  it('register()는 새 인스턴스를 반환하고 원본은 변경되지 않는다', async () => {
    const original = new MockJudgeClientWithHashKey([])
    const extended = original.register({ cacheKey: key, verdict: VERDICT_NONE })

    // 원본: 미스
    const req = makeReq(CACHEABLE, VOLATILE, MODEL_ID)
    await expect(original.judge(req)).rejects.toThrow('캐시 미스')

    // 확장: 히트
    const result = await extended.judge(req)
    expect(result.kind).toBe('none')
  })

  it('register() 반환값은 원본과 다른 인스턴스이다', () => {
    const original = new MockJudgeClientWithHashKey([])
    const extended = original.register({ cacheKey: key, verdict: VERDICT_NONE })
    expect(Object.is(original, extended)).toBe(false)
  })
})

// ── 7. 복수 항목 등록 — 각각 독립적으로 히트한다 ────────────────────────────

describe('MockJudgeClientWithHashKey — 복수 항목 등록', () => {
  it('세 가지 판정을 각자의 payload로 등록하면 각각 정확히 반환된다', async () => {
    const entries: MockJudgeHashEntry[] = [
      {
        cacheKey: makeCacheKey('rubric-1', 'context-1', MODEL_ID),
        verdict: VERDICT_THRASHING,
      },
      {
        cacheKey: makeCacheKey('rubric-2', 'context-2', MODEL_ID),
        verdict: VERDICT_FALSE_SUCCESS,
      },
      {
        cacheKey: makeCacheKey('rubric-3', 'context-3', MODEL_ID),
        verdict: VERDICT_NONE,
      },
    ]
    const client = new MockJudgeClientWithHashKey(entries)

    const r1 = await client.judge(makeReq('rubric-1', 'context-1', MODEL_ID, 'thrashing'))
    const r2 = await client.judge(makeReq('rubric-2', 'context-2', MODEL_ID))
    const r3 = await client.judge(makeReq('rubric-3', 'context-3', MODEL_ID))

    expect(r1.kind).toBe('thrashing')
    expect(r2.kind).toBe('false_success')
    expect(r3.kind).toBe('none')
  })
})
