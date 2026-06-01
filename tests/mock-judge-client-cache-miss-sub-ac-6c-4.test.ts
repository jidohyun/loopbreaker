/**
 * tests/mock-judge-client-cache-miss-sub-ac-6c-4.test.ts
 *
 * Sub-AC 6c-4: MockJudgeClient.judge(payload, modelId) cache-miss path.
 *
 * Spec (exact AC text):
 *   Implement MockJudgeClient.judge(payload, modelId) cache-miss path: throw
 *   CacheMissError when computed key is absent.
 *   Test 1: call judge on empty cache → assert CacheMissError is thrown.
 *   Test 2: call with a key that exists under MockEmbedClient but not
 *   MockJudgeClient → assert CacheMissError is still thrown
 *   (cross-contamination guard).
 *
 * Design:
 *   - MockJudgeClient uses its own independent Map<string, JudgeVerdict>.
 *   - MockEmbedClientCacheKey uses an independent Map<string, vectors>.
 *   - A key registered in MockEmbedClientCacheKey MUST NOT leak into
 *     MockJudgeClient's namespace — they are entirely separate caches.
 *   - Both clients throw CacheMissError on miss (same error class).
 *
 * Constraints:
 *   - 외부 API 절대 미호출 — MockJudgeClient / MockEmbedClientCacheKey만 사용.
 *   - 네트워크/API 키 불필요.
 */

import {
  MockJudgeClient,
  MockJudgeClientWithHashKey,
  type JudgeRequest,
  type JudgeVerdict,
  type MockJudgeCacheEntry,
  sha256Prompt,
} from '../src/api/judge-client.js'
import {
  MockEmbedClientCacheKey,
  makeMockEmbedEntry,
} from '../src/api/embed-client.js'
import { CacheMissError } from '../src/api/embedding-cache.js'
import { buildCacheKey } from '../src/api/cache-key.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JUDGE_MODEL = 'claude-3-5-sonnet-20241022'
const EMBED_MODEL = 'voyage-3-lite'

const SAMPLE_VERDICT: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'repeat_action',
  confidence: 0.9,
  reason: '동일 도구 호출이 반복되었습니다.',
  rawSamples: [],
}

function makeJudgeReq(
  kind: 'thrashing' | 'false_success' = 'false_success',
  modelId = JUDGE_MODEL,
): JudgeRequest {
  return {
    kind,
    cacheableBlock: '루브릭 블록',
    volatileBlock: '변동 컨텍스트',
    modelId,
  }
}

// ── Test group 1: Empty MockJudgeClient → CacheMissError ─────────────────────

describe('MockJudgeClient — empty cache throws CacheMissError (Sub-AC 6c-4)', () => {
  const client = new MockJudgeClient([])

  it('throws CacheMissError on empty cache', async () => {
    const req = makeJudgeReq()
    await expect(client.judge(req)).rejects.toBeInstanceOf(CacheMissError)
  })

  it('thrown error is CacheMissError (not generic Error subclass only)', async () => {
    const req = makeJudgeReq()
    let caught: unknown = null
    try {
      await client.judge(req)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CacheMissError)
    // Also an Error for compatibility
    expect(caught).toBeInstanceOf(Error)
  })

  it('CacheMissError.cacheKey contains the attempted key', async () => {
    const req = makeJudgeReq('false_success', JUDGE_MODEL)
    const expectedKey = `false_success:${JUDGE_MODEL}`
    let caught: unknown = null
    try {
      await client.judge(req)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CacheMissError)
    expect((caught as CacheMissError).cacheKey).toBe(expectedKey)
  })

  it('throws CacheMissError for kind=thrashing on empty cache', async () => {
    const req = makeJudgeReq('thrashing', JUDGE_MODEL)
    await expect(client.judge(req)).rejects.toBeInstanceOf(CacheMissError)
  })

  it('throws CacheMissError for different modelId on empty cache', async () => {
    const req = makeJudgeReq('false_success', 'claude-3-opus-20240229')
    await expect(client.judge(req)).rejects.toBeInstanceOf(CacheMissError)
  })
})

// ── Test group 2: Cross-contamination guard ───────────────────────────────────
//
// A cache key registered in MockEmbedClientCacheKey must NOT be visible to
// MockJudgeClient. The two caches are completely independent namespaces.

describe('MockJudgeClient — cross-contamination guard (Sub-AC 6c-4)', () => {
  // Build a shared cache key string that we register ONLY in the embed client
  const embedTexts = ['npm run build', 'npm run test']
  const embedVectors: readonly (readonly number[])[] = [
    [0.1, 0.2, 0.3, 0.4],
    [0.5, 0.6, 0.7, 0.8],
  ]
  const embedEntry = makeMockEmbedEntry(embedTexts, embedVectors, EMBED_MODEL)
  // embedEntry.cacheKey = buildCacheKey(texts.join('\0'), EMBED_MODEL)

  // Create embed client with the key registered
  const embedClient = new MockEmbedClientCacheKey([embedEntry], EMBED_MODEL)

  // Create judge client with EMPTY cache (the embed key is NOT registered here)
  const judgeClient = new MockJudgeClient([])

  it('embed client returns vectors for the registered key (sanity)', async () => {
    const vectors = await embedClient.embed(embedTexts)
    expect(vectors).toHaveLength(2)
    expect(vectors[0]).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(vectors[1]).toEqual([0.5, 0.6, 0.7, 0.8])
  })

  it('judge client throws CacheMissError for any key — embed cache does not bleed in', async () => {
    const req = makeJudgeReq('false_success', JUDGE_MODEL)
    await expect(judgeClient.judge(req)).rejects.toBeInstanceOf(CacheMissError)
  })

  it('using the embed cacheKey string as _cacheKey in judge request still throws CacheMissError', async () => {
    // The embed cache key (sha256(texts.join('\0')) + ':' + EMBED_MODEL) is only in embedClient.
    // Passing it as _cacheKey to judgeClient must still throw CacheMissError.
    const req = {
      ...makeJudgeReq('false_success', JUDGE_MODEL),
      _cacheKey: embedEntry.cacheKey,
    } as JudgeRequest & { _cacheKey: string }

    await expect(judgeClient.judge(req)).rejects.toBeInstanceOf(CacheMissError)
  })

  it('CacheMissError.cacheKey matches the embed cacheKey (confirms different namespace)', async () => {
    const req = {
      ...makeJudgeReq('false_success', JUDGE_MODEL),
      _cacheKey: embedEntry.cacheKey,
    } as JudgeRequest & { _cacheKey: string }

    let caught: unknown = null
    try {
      await judgeClient.judge(req)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CacheMissError)
    // The cacheKey in the error should be the embed key we tried
    expect((caught as CacheMissError).cacheKey).toBe(embedEntry.cacheKey)
  })

  it('registering in embed client does not affect judge client after the fact', async () => {
    // Even if we add more entries to the embed client, judge client remains independent.
    const extendedEmbedClient = embedClient.register(
      makeMockEmbedEntry(['extra text'], [[0.9, 0.8, 0.7, 0.6]], EMBED_MODEL),
    )

    // extendedEmbedClient can embed 'extra text'
    const vecs = await extendedEmbedClient.embed(['extra text'])
    expect(vecs[0]).toEqual([0.9, 0.8, 0.7, 0.6])

    // judgeClient still throws CacheMissError
    const req = makeJudgeReq('false_success', JUDGE_MODEL)
    await expect(judgeClient.judge(req)).rejects.toBeInstanceOf(CacheMissError)
  })
})

// ── Test group 3: MockJudgeClient partial registration — miss still throws ────

describe('MockJudgeClient — partial registration: unregistered key still throws CacheMissError', () => {
  const registeredKey = `false_success:${JUDGE_MODEL}`
  const entry: MockJudgeCacheEntry = {
    cacheKey: registeredKey,
    verdict: SAMPLE_VERDICT,
  }
  const client = new MockJudgeClient([entry])

  it('registered key returns verdict successfully', async () => {
    const req = makeJudgeReq('false_success', JUDGE_MODEL)
    const result = await client.judge(req)
    expect(result).toEqual(SAMPLE_VERDICT)
  })

  it('unregistered key (different kind) throws CacheMissError', async () => {
    const req = makeJudgeReq('thrashing', JUDGE_MODEL)
    await expect(client.judge(req)).rejects.toBeInstanceOf(CacheMissError)
  })

  it('unregistered key (different modelId) throws CacheMissError', async () => {
    const req = makeJudgeReq('false_success', 'claude-3-opus-20240229')
    await expect(client.judge(req)).rejects.toBeInstanceOf(CacheMissError)
  })

  it('CacheMissError thrown for unregistered kind has correct cacheKey', async () => {
    const req = makeJudgeReq('thrashing', JUDGE_MODEL)
    let caught: unknown = null
    try {
      await client.judge(req)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CacheMissError)
    expect((caught as CacheMissError).cacheKey).toBe(`thrashing:${JUDGE_MODEL}`)
  })
})

// ── Test group 4: MockJudgeClientWithHashKey empty cache → CacheMissError ─────

describe('MockJudgeClientWithHashKey — empty cache throws CacheMissError (Sub-AC 6c-4)', () => {
  const client = new MockJudgeClientWithHashKey([])

  it('throws CacheMissError on empty cache', async () => {
    const req = makeJudgeReq()
    await expect(client.judge(req)).rejects.toBeInstanceOf(CacheMissError)
  })

  it('CacheMissError.cacheKey is sha256(prompt)+:+modelId', async () => {
    const req = makeJudgeReq('false_success', JUDGE_MODEL)
    const expectedKey = `${sha256Prompt(req.cacheableBlock + req.volatileBlock)}:${JUDGE_MODEL}`
    let caught: unknown = null
    try {
      await client.judge(req)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CacheMissError)
    expect((caught as CacheMissError).cacheKey).toBe(expectedKey)
  })
})

// ── Test group 5: Cross-contamination with MockJudgeClientWithHashKey ─────────

describe('MockJudgeClientWithHashKey — cross-contamination guard (Sub-AC 6c-4)', () => {
  // Register a key in embed client only
  const embedTexts = ['tool_use: Bash(npm test)', 'tool_use: Bash(npm build)']
  const embedVectors: readonly (readonly number[])[] = [
    [0.2, 0.4, 0.6, 0.8],
    [0.1, 0.3, 0.5, 0.7],
  ]
  const embedEntry = makeMockEmbedEntry(embedTexts, embedVectors, EMBED_MODEL)
  const embedClient = new MockEmbedClientCacheKey([embedEntry], EMBED_MODEL)

  // Judge client is empty
  const judgeClient = new MockJudgeClientWithHashKey([])

  it('embed client works for registered key (sanity check)', async () => {
    const vecs = await embedClient.embed(embedTexts)
    expect(vecs).toHaveLength(2)
  })

  it('judge client throws CacheMissError regardless of embed cache state', async () => {
    const req = makeJudgeReq('false_success', JUDGE_MODEL)
    await expect(judgeClient.judge(req)).rejects.toBeInstanceOf(CacheMissError)
  })

  it('embed cacheKey format differs from judge cacheKey format (namespace isolation)', () => {
    // Embed key: sha256(texts.join('\0')) + ':' + embedModelId
    const embedKey = buildCacheKey(embedTexts.join('\0'), EMBED_MODEL)
    // Judge key: sha256(cacheableBlock + volatileBlock) + ':' + judgeModelId
    const req = makeJudgeReq('false_success', JUDGE_MODEL)
    const judgeKey = `${sha256Prompt(req.cacheableBlock + req.volatileBlock)}:${JUDGE_MODEL}`

    // Keys must be different (different payload + different modelId namespace)
    expect(embedKey).not.toBe(judgeKey)
  })
})
