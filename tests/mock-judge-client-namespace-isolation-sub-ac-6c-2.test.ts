/**
 * tests/mock-judge-client-namespace-isolation-sub-ac-6c-2.test.ts
 *
 * Sub-AC 6c-2: MockJudgeClient constructor and internal cache store —
 * separate namespace from MockEmbedClient.
 *
 * Spec:
 *   - Instantiate MockJudgeClient and MockEmbedClient independently.
 *   - Assert each holds its own isolated cache map.
 *   - Same raw key inserted into one does NOT appear in the other.
 *   - MockJudgeClient constructor stores entries under its own private map.
 *   - MockEmbedClient constructor stores entries under its own private map.
 *   - The two maps are entirely independent (different instances, different types).
 *
 * Constraints:
 *   - 외부 API 절대 미호출 — 네트워크·API 키 불필요.
 *   - MockJudgeClient / MockEmbedClient 만 사용 (실 클라이언트 미사용).
 *   - SPEC §1 표준 e: cacheKey = sha256(payload)+':'+modelId
 */

import {
  MockJudgeClient,
  type MockJudgeCacheEntry,
  type JudgeVerdict,
} from '../src/api/judge-client.js'

import {
  MockEmbedClient,
  EmbedClientError,
  type MockEmbedEntry,
} from '../src/api/embed-client.js'

// ─── 공통 픽스처 ──────────────────────────────────────────────────────────────

const JUDGE_MODEL = 'claude-3-5-haiku-20241022'
const EMBED_DIM = 4

/** 두 클라이언트에 동일하게 사용할 원시 캐시 키 (namespace isolation 검증용) */
const RAW_KEY = 'shared-raw-cache-key-for-isolation-test'

const SAMPLE_VERDICT: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'repeat_error',
  confidence: 0.88,
  reason: '동일 에러가 반복되었습니다.',
  rawSamples: ['sample-1', 'sample-2'],
}

const SAMPLE_VERDICT_B: JudgeVerdict = {
  kind: 'false_success',
  subtype: 'unverified_completion',
  confidence: 0.91,
  reason: '완료선언 직전 검증이 없습니다.',
  rawSamples: ['sample-3'],
}

const SAMPLE_VECTOR: readonly number[] = [0.1, 0.2, 0.3, 0.4]

// ─── 1. MockJudgeClient 생성자 기본 동작 ─────────────────────────────────────

describe('MockJudgeClient — constructor and internal cache store', () => {
  it('빈 항목으로 생성 시 캐시가 비어있다 (캐시 미스 에러를 던진다)', async () => {
    const client = new MockJudgeClient([])
    const req = {
      kind: 'false_success' as const,
      cacheableBlock: 'rubric',
      volatileBlock: 'context',
      modelId: JUDGE_MODEL,
      _cacheKey: RAW_KEY,
    }
    await expect(client.judge(req)).rejects.toThrow('캐시 미스')
  })

  it('항목을 주입하여 생성 시 해당 키를 히트한다', async () => {
    const entry: MockJudgeCacheEntry = { cacheKey: RAW_KEY, verdict: SAMPLE_VERDICT }
    const client = new MockJudgeClient([entry])

    const req = {
      kind: 'false_success' as const,
      cacheableBlock: 'rubric',
      volatileBlock: 'context',
      modelId: JUDGE_MODEL,
      _cacheKey: RAW_KEY,
    }
    const result = await client.judge(req)
    expect(result).toEqual(SAMPLE_VERDICT)
  })

  it('여러 항목 주입 후 각각 올바른 verdict를 반환한다', async () => {
    const keyA = 'key-alpha'
    const keyB = 'key-beta'
    const entries: MockJudgeCacheEntry[] = [
      { cacheKey: keyA, verdict: SAMPLE_VERDICT },
      { cacheKey: keyB, verdict: SAMPLE_VERDICT_B },
    ]
    const client = new MockJudgeClient(entries)

    const reqA = {
      kind: 'thrashing' as const,
      cacheableBlock: '',
      volatileBlock: '',
      modelId: JUDGE_MODEL,
      _cacheKey: keyA,
    }
    const reqB = {
      kind: 'false_success' as const,
      cacheableBlock: '',
      volatileBlock: '',
      modelId: JUDGE_MODEL,
      _cacheKey: keyB,
    }

    const rA = await client.judge(reqA)
    const rB = await client.judge(reqB)

    expect(rA.kind).toBe('thrashing')
    expect(rB.kind).toBe('false_success')
  })

  it('register() 불변성: 원본 인스턴스는 변경되지 않는다', async () => {
    const original = new MockJudgeClient([])
    const extended = original.register({ cacheKey: RAW_KEY, verdict: SAMPLE_VERDICT })

    const req = {
      kind: 'thrashing' as const,
      cacheableBlock: '',
      volatileBlock: '',
      modelId: JUDGE_MODEL,
      _cacheKey: RAW_KEY,
    }

    // 원본은 여전히 캐시 미스
    await expect(original.judge(req)).rejects.toThrow('캐시 미스')

    // 확장본은 히트
    const result = await extended.judge(req)
    expect(result.kind).toBe('thrashing')
  })
})

// ─── 2. 네임스페이스 격리: MockJudgeClient vs MockEmbedClient ────────────────

describe('MockJudgeClient vs MockEmbedClient — 캐시 네임스페이스 격리 (Sub-AC 6c-2)', () => {
  it('MockJudgeClient와 MockEmbedClient는 독립적으로 인스턴스화된다', () => {
    const judgeClient = new MockJudgeClient([
      { cacheKey: RAW_KEY, verdict: SAMPLE_VERDICT },
    ])
    const embedEntries: MockEmbedEntry[] = [
      { text: 'hello', vector: [0.1, 0.2, 0.3, 0.4] },
    ]
    const embedClient = new MockEmbedClient(embedEntries, EMBED_DIM)

    // 독립 인스턴스: 같은 객체가 아님
    expect(Object.is(judgeClient, embedClient)).toBe(false)
    // 서로 다른 생성자
    expect(judgeClient.constructor).not.toBe(embedClient.constructor)
  })

  it('MockJudgeClient에 등록한 RAW_KEY가 MockEmbedClient에서는 캐시 미스다', async () => {
    // judge 클라이언트에 RAW_KEY 등록
    const judgeClient = new MockJudgeClient([
      { cacheKey: RAW_KEY, verdict: SAMPLE_VERDICT },
    ])

    // 같은 RAW_KEY 문자열을 text로 갖는 embed 클라이언트 — 등록 안 함
    const embedClient = new MockEmbedClient([], EMBED_DIM)

    // judge 클라이언트는 히트
    const req = {
      kind: 'thrashing' as const,
      cacheableBlock: '',
      volatileBlock: '',
      modelId: JUDGE_MODEL,
      _cacheKey: RAW_KEY,
    }
    const verdict = await judgeClient.judge(req)
    expect(verdict.kind).toBe('thrashing')

    // embed 클라이언트는 같은 키를 text로 등록하지 않았으므로 캐시 미스
    await expect(embedClient.embed([RAW_KEY])).rejects.toThrow(EmbedClientError)
  })

  it('MockEmbedClient에 등록한 text key가 MockJudgeClient에서는 캐시 미스다', async () => {
    const textKey = 'embed-registered-text'
    const embedEntries: MockEmbedEntry[] = [
      { text: textKey, vector: SAMPLE_VECTOR as number[] },
    ]
    const embedClient = new MockEmbedClient(embedEntries, EMBED_DIM)

    // judge 클라이언트는 같은 키 문자열을 등록하지 않음
    const judgeClient = new MockJudgeClient([])

    // embed 클라이언트는 히트
    const vecs = await embedClient.embed([textKey])
    expect(vecs[0]).toEqual([...SAMPLE_VECTOR])

    // judge 클라이언트는 같은 raw 키로 조회해도 캐시 미스
    const req = {
      kind: 'false_success' as const,
      cacheableBlock: '',
      volatileBlock: '',
      modelId: JUDGE_MODEL,
      _cacheKey: textKey,
    }
    await expect(judgeClient.judge(req)).rejects.toThrow('캐시 미스')
  })

  it('동일 raw key를 두 클라이언트에 각각 등록해도 서로 영향을 주지 않는다', async () => {
    // 같은 문자열 키를 두 클라이언트 모두에 등록
    const judgeClient = new MockJudgeClient([
      { cacheKey: RAW_KEY, verdict: SAMPLE_VERDICT },
    ])
    const embedEntries: MockEmbedEntry[] = [
      { text: RAW_KEY, vector: SAMPLE_VECTOR as number[] },
    ]
    const embedClient = new MockEmbedClient(embedEntries, EMBED_DIM)

    // judge 클라이언트: 히트 → SAMPLE_VERDICT 반환
    const req = {
      kind: 'thrashing' as const,
      cacheableBlock: '',
      volatileBlock: '',
      modelId: JUDGE_MODEL,
      _cacheKey: RAW_KEY,
    }
    const verdict = await judgeClient.judge(req)
    expect(verdict).toEqual(SAMPLE_VERDICT)

    // embed 클라이언트: 히트 → SAMPLE_VECTOR 반환
    const vecs = await embedClient.embed([RAW_KEY])
    expect(vecs[0]).toEqual([...SAMPLE_VECTOR])

    // 두 결과는 완전히 다른 타입 (서로 독립된 캐시 맵에서 각각 반환됨)
    expect(typeof verdict).toBe('object')
    expect(Array.isArray(vecs[0])).toBe(true)
    expect(verdict).not.toEqual(vecs[0])
  })

  it('한 클라이언트에 항목을 추가(register)해도 다른 클라이언트 캐시는 변경되지 않는다', async () => {
    const judgeClient = new MockJudgeClient([])
    const embedClient = new MockEmbedClient([], EMBED_DIM)

    // judge 클라이언트에 항목 추가
    const extendedJudge = judgeClient.register({
      cacheKey: RAW_KEY,
      verdict: SAMPLE_VERDICT,
    })

    // embed 클라이언트는 여전히 캐시 미스 (judge 등록이 embed에 영향 없음)
    await expect(embedClient.embed([RAW_KEY])).rejects.toThrow(EmbedClientError)

    // 확장된 judge 클라이언트는 히트
    const req = {
      kind: 'thrashing' as const,
      cacheableBlock: '',
      volatileBlock: '',
      modelId: JUDGE_MODEL,
      _cacheKey: RAW_KEY,
    }
    const result = await extendedJudge.judge(req)
    expect(result.kind).toBe('thrashing')
  })

  it('embed 클라이언트에 항목을 추가(register)해도 judge 클라이언트 캐시는 변경되지 않는다', async () => {
    const judgeClient = new MockJudgeClient([])
    const embedClient = new MockEmbedClient([], EMBED_DIM)

    // embed 클라이언트에 항목 추가
    const extendedEmbed = embedClient.register({
      text: RAW_KEY,
      vector: [...SAMPLE_VECTOR],
    })

    // judge 클라이언트는 여전히 캐시 미스 (embed 등록이 judge에 영향 없음)
    const req = {
      kind: 'false_success' as const,
      cacheableBlock: '',
      volatileBlock: '',
      modelId: JUDGE_MODEL,
      _cacheKey: RAW_KEY,
    }
    await expect(judgeClient.judge(req)).rejects.toThrow('캐시 미스')

    // 확장된 embed 클라이언트는 히트
    const vecs = await extendedEmbed.embed([RAW_KEY])
    expect(vecs[0]).toEqual([...SAMPLE_VECTOR])
  })

  it('각 클라이언트의 캐시 맵은 서로 다른 인스턴스(Object.is === false)임을 내부 동작으로 확인한다', async () => {
    // judge 맵에 키 A 등록
    const keyA = 'key-only-in-judge'
    // embed 맵에 키 B 등록 (keyA와 다른 키)
    const keyB = 'key-only-in-embed'

    const judgeClient = new MockJudgeClient([
      { cacheKey: keyA, verdict: SAMPLE_VERDICT },
    ])
    const embedClient = new MockEmbedClient(
      [{ text: keyB, vector: SAMPLE_VECTOR as number[] }],
      EMBED_DIM,
    )

    // judge 맵에서 keyA 히트
    const reqA = {
      kind: 'thrashing' as const,
      cacheableBlock: '',
      volatileBlock: '',
      modelId: JUDGE_MODEL,
      _cacheKey: keyA,
    }
    const verdictA = await judgeClient.judge(reqA)
    expect(verdictA.kind).toBe('thrashing')

    // judge 맵에서 keyB 미스 (embed 전용 키)
    const reqB = {
      kind: 'false_success' as const,
      cacheableBlock: '',
      volatileBlock: '',
      modelId: JUDGE_MODEL,
      _cacheKey: keyB,
    }
    await expect(judgeClient.judge(reqB)).rejects.toThrow('캐시 미스')

    // embed 맵에서 keyB 히트
    const vecs = await embedClient.embed([keyB])
    expect(vecs[0]).toEqual([...SAMPLE_VECTOR])

    // embed 맵에서 keyA 미스 (judge 전용 키)
    await expect(embedClient.embed([keyA])).rejects.toThrow(EmbedClientError)
  })
})
