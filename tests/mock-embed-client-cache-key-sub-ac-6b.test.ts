/**
 * tests/mock-embed-client-cache-key-sub-ac-6b.test.ts
 *
 * Sub-AC 6b: MockEmbedClientCacheKey cache lookup
 *
 * 검증 항목:
 *   1. embed(texts) 호출 시 buildCacheKey(texts.join('\0'), modelId)로 캐시 키 계산
 *   2. 캐시 히트 → 등록된 vectors를 결정론으로 반환한다
 *   3. 캐시 미스 → CacheMissError를 던진다 (조용한 폴백 절대 금지)
 *   4. CacheMissError.cacheKey 필드에 실패한 키가 기록된다
 *   5. 반환 벡터는 불변 복사본이다 (변조가 내부 상태에 영향 없음)
 *   6. makeMockEmbedEntry 헬퍼가 올바른 cacheKey를 계산한다
 *   7. register() 불변 헬퍼가 원본을 변이하지 않고 새 인스턴스를 반환한다
 *   8. 생성자 검증 (modelId 비어있으면 TypeError)
 *
 * 외부 API 절대 미호출 — 네트워크·API 키 불필요.
 * SPEC §1 표준 e: cacheKey = sha256(payload)+':'+embedModelId
 */

import {
  MockEmbedClientCacheKey,
  makeMockEmbedEntry,
  type MockEmbedCacheEntry,
} from '../src/api/embed-client.js'
import { CacheMissError } from '../src/api/embedding-cache.js'
import { buildCacheKey } from '../src/api/cache-key.js'

// ── 공통 픽스처 ───────────────────────────────────────────────────────────────

const MODEL_ID = 'voyage-3-lite'
const TEXTS_AB = ['hello', 'world']
const VECTORS_AB = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]] as const
const KEY_AB = buildCacheKey(TEXTS_AB.join('\0'), MODEL_ID)

// ── 1. 캐시 키 계산: buildCacheKey(texts.join('\0'), modelId) ─────────────────

describe('MockEmbedClientCacheKey — 캐시 키 계산 (Sub-AC 6b)', () => {
  test('buildCacheKey(texts.join("\\0"), modelId) 형식으로 캐시 키가 생성된다', () => {
    const texts = ['alpha', 'beta']
    const expected = buildCacheKey(texts.join('\0'), MODEL_ID)

    // 캐시 키는 sha256 hex (64자) + ':' + modelId 형식
    expect(expected).toMatch(/^[0-9a-f]{64}:voyage-3-lite$/)
  })

  test('텍스트 순서가 다르면 서로 다른 캐시 키가 생성된다', () => {
    const keyAB = buildCacheKey(['a', 'b'].join('\0'), MODEL_ID)
    const keyBA = buildCacheKey(['b', 'a'].join('\0'), MODEL_ID)
    expect(keyAB).not.toBe(keyBA)
  })

  test('동일 텍스트 배열이면 항상 동일 캐시 키가 생성된다 (결정론)', () => {
    const key1 = buildCacheKey(['x', 'y', 'z'].join('\0'), MODEL_ID)
    const key2 = buildCacheKey(['x', 'y', 'z'].join('\0'), MODEL_ID)
    expect(key1).toBe(key2)
  })

  test('단일 텍스트도 캐시 키가 올바르게 생성된다', () => {
    const key = buildCacheKey(['single'].join('\0'), MODEL_ID)
    expect(key).toMatch(/^[0-9a-f]{64}:voyage-3-lite$/)
  })
})

// ── 2. 캐시 히트 → 등록된 vectors 반환 ─────────────────────────────────────────

describe('MockEmbedClientCacheKey — 캐시 히트 (Sub-AC 6b)', () => {
  const entry: MockEmbedCacheEntry = { cacheKey: KEY_AB, vectors: VECTORS_AB }
  const client = new MockEmbedClientCacheKey([entry], MODEL_ID)

  test('pre-populated cache hit returns correct embedding vectors', async () => {
    const result = await client.embed(TEXTS_AB)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([0.1, 0.2, 0.3])
    expect(result[1]).toEqual([0.4, 0.5, 0.6])
  })

  test('동일 입력 반복 호출 → 항상 동일 벡터 (결정론)', async () => {
    const r1 = await client.embed(TEXTS_AB)
    const r2 = await client.embed(TEXTS_AB)
    expect(r1).toEqual(r2)
  })

  test('단일 텍스트 히트 → 벡터 1개 반환', async () => {
    const texts = ['only']
    const key = buildCacheKey(texts.join('\0'), MODEL_ID)
    const c = new MockEmbedClientCacheKey(
      [{ cacheKey: key, vectors: [[1.0, 0.0]] }],
      MODEL_ID,
    )
    const result = await c.embed(texts)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual([1.0, 0.0])
  })

  test('여러 항목 등록 시 각 키가 독립적으로 조회된다', async () => {
    const textsCD = ['cat', 'dog']
    const keyCD = buildCacheKey(textsCD.join('\0'), MODEL_ID)

    const c = new MockEmbedClientCacheKey(
      [
        { cacheKey: KEY_AB, vectors: VECTORS_AB },
        { cacheKey: keyCD, vectors: [[0.7, 0.8, 0.9], [1.0, 0.0, 0.0]] },
      ],
      MODEL_ID,
    )

    const resAB = await c.embed(TEXTS_AB)
    const resCD = await c.embed(textsCD)

    expect(resAB[0]).toEqual([0.1, 0.2, 0.3])
    expect(resCD[0]).toEqual([0.7, 0.8, 0.9])
  })
})

// ── 3. 캐시 미스 → CacheMissError (조용한 폴백 절대 금지) ───────────────────────

describe('MockEmbedClientCacheKey — 캐시 미스 CacheMissError (Sub-AC 6b)', () => {
  const client = new MockEmbedClientCacheKey([], MODEL_ID)

  test('assert miss throws CacheMissError', async () => {
    await expect(client.embed(['not-registered'])).rejects.toThrow(CacheMissError)
  })

  test('assert no fallback value is returned on miss (실제 throw 검증)', async () => {
    let thrown = false
    try {
      await client.embed(['missing'])
    } catch {
      thrown = true
    }
    expect(thrown).toBe(true)
  })

  test('CacheMissError는 Error 서브클래스이다', async () => {
    await expect(client.embed(['unknown'])).rejects.toBeInstanceOf(Error)
  })

  test('CacheMissError.name이 "CacheMissError"이다', async () => {
    let caught: unknown
    try {
      await client.embed(['miss-text'])
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CacheMissError)
    expect((caught as CacheMissError).name).toBe('CacheMissError')
  })

  test('등록된 texts와 다른 texts 조합은 CacheMissError를 던진다', async () => {
    const entry: MockEmbedCacheEntry = { cacheKey: KEY_AB, vectors: VECTORS_AB }
    const c = new MockEmbedClientCacheKey([entry], MODEL_ID)

    // 순서가 다르면 다른 키 → 미스
    await expect(c.embed(['world', 'hello'])).rejects.toThrow(CacheMissError)
  })

  test('텍스트 내용이 일부만 다른 경우도 CacheMissError를 던진다', async () => {
    const entry: MockEmbedCacheEntry = { cacheKey: KEY_AB, vectors: VECTORS_AB }
    const c = new MockEmbedClientCacheKey([entry], MODEL_ID)

    await expect(c.embed(['hello', 'WORLD'])).rejects.toThrow(CacheMissError)
  })
})

// ── 4. CacheMissError.cacheKey 필드 검증 ────────────────────────────────────────

describe('MockEmbedClientCacheKey — CacheMissError.cacheKey 필드 (Sub-AC 6b)', () => {
  test('CacheMissError.cacheKey에 buildCacheKey로 계산된 실패한 키가 기록된다', async () => {
    const client = new MockEmbedClientCacheKey([], MODEL_ID)
    const missTexts = ['missing-text-a', 'missing-text-b']
    const expectedKey = buildCacheKey(missTexts.join('\0'), MODEL_ID)

    let caught: unknown
    try {
      await client.embed(missTexts)
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(CacheMissError)
    expect((caught as CacheMissError).cacheKey).toBe(expectedKey)
  })

  test('CacheMissError.message에 실패한 키 정보가 포함된다', async () => {
    const client = new MockEmbedClientCacheKey([], MODEL_ID)
    const missTexts = ['abc']
    const expectedKey = buildCacheKey(missTexts.join('\0'), MODEL_ID)

    let caught: unknown
    try {
      await client.embed(missTexts)
    } catch (err) {
      caught = err
    }

    expect((caught as CacheMissError).message).toContain(expectedKey)
  })
})

// ── 5. 불변 복사본 반환 ────────────────────────────────────────────────────────

describe('MockEmbedClientCacheKey — 불변 복사본 반환 (Sub-AC 6b)', () => {
  const entry: MockEmbedCacheEntry = { cacheKey: KEY_AB, vectors: VECTORS_AB }
  const client = new MockEmbedClientCacheKey([entry], MODEL_ID)

  test('반환된 벡터 변조가 내부 캐시에 영향을 주지 않는다', async () => {
    const [vec] = await client.embed(TEXTS_AB)
    vec[0] = 9999

    const [fresh] = await client.embed(TEXTS_AB)
    expect(fresh[0]).toBeCloseTo(0.1)
  })

  test('반환된 배열은 원본 참조와 다른 객체이다', async () => {
    const result1 = await client.embed(TEXTS_AB)
    const result2 = await client.embed(TEXTS_AB)
    expect(result1).toEqual(result2)
    expect(result1[0]).not.toBe(result2[0]) // 별도 복사본
  })
})

// ── 6. makeMockEmbedEntry 헬퍼 검증 ──────────────────────────────────────────

describe('makeMockEmbedEntry — 캐시 키 자동 계산 헬퍼 (Sub-AC 6b)', () => {
  test('makeMockEmbedEntry가 buildCacheKey와 동일한 cacheKey를 생성한다', () => {
    const texts = ['foo', 'bar']
    const vectors = [[1.0, 0.0], [0.0, 1.0]] as const
    const entry = makeMockEmbedEntry(texts, vectors, MODEL_ID)

    const expectedKey = buildCacheKey(texts.join('\0'), MODEL_ID)
    expect(entry.cacheKey).toBe(expectedKey)
  })

  test('makeMockEmbedEntry로 생성한 항목으로 MockEmbedClientCacheKey 조회가 성공한다', async () => {
    const texts = ['query', 'context']
    const vectors = [[0.5, 0.5], [0.2, 0.8]] as const
    const entry = makeMockEmbedEntry(texts, vectors, MODEL_ID)

    const client = new MockEmbedClientCacheKey([entry], MODEL_ID)
    const result = await client.embed(texts)

    expect(result[0]).toEqual([0.5, 0.5])
    expect(result[1]).toEqual([0.2, 0.8])
  })

  test('pre-populate cache, assert hit returns correct embedding', async () => {
    const texts = ['pre-populated-text']
    const vectors = [[0.9, 0.1, 0.5]] as const
    const entry = makeMockEmbedEntry(texts, vectors, MODEL_ID)

    const client = new MockEmbedClientCacheKey([entry], MODEL_ID)

    // 히트 → 정확한 벡터 반환
    const result = await client.embed(texts)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual([0.9, 0.1, 0.5])
  })
})

// ── 7. register() 불변 헬퍼 ──────────────────────────────────────────────────

describe('MockEmbedClientCacheKey — register() 불변 헬퍼 (Sub-AC 6b)', () => {
  test('register()는 새 인스턴스를 반환하고 원본을 변이하지 않는다', async () => {
    const original = new MockEmbedClientCacheKey([], MODEL_ID)
    const entry = makeMockEmbedEntry(['new'], [[1.0, 2.0]], MODEL_ID)
    const extended = original.register(entry)

    // 원본 → miss
    await expect(original.embed(['new'])).rejects.toThrow(CacheMissError)

    // 확장본 → hit
    const result = await extended.embed(['new'])
    expect(result[0]).toEqual([1.0, 2.0])
  })

  test('register()로 추가된 인스턴스는 기존 항목도 유지한다', async () => {
    const textsA = ['alpha']
    const entryA = makeMockEmbedEntry(textsA, [[0.1, 0.2]], MODEL_ID)
    const client = new MockEmbedClientCacheKey([entryA], MODEL_ID)

    const textsB = ['beta']
    const entryB = makeMockEmbedEntry(textsB, [[0.3, 0.4]], MODEL_ID)
    const extended = client.register(entryB)

    const resA = await extended.embed(textsA)
    const resB = await extended.embed(textsB)

    expect(resA[0]).toEqual([0.1, 0.2])
    expect(resB[0]).toEqual([0.3, 0.4])
  })
})

// ── 8. 생성자 검증 ────────────────────────────────────────────────────────────

describe('MockEmbedClientCacheKey — 생성자 검증 (Sub-AC 6b)', () => {
  test('빈 entries로 생성하면 빈 캐시가 된다', async () => {
    const client = new MockEmbedClientCacheKey([], MODEL_ID)
    await expect(client.embed(['any'])).rejects.toThrow(CacheMissError)
  })

  test('modelId가 빈 문자열이면 TypeError를 던진다', () => {
    expect(() => new MockEmbedClientCacheKey([], '')).toThrow(TypeError)
  })

  test('modelId getter가 생성자에 전달된 값을 반환한다', () => {
    const client = new MockEmbedClientCacheKey([], 'text-embedding-3-small')
    expect(client.modelId).toBe('text-embedding-3-small')
  })

  test('여러 모델 ID 인스턴스가 각자 독립적인 캐시를 가진다', async () => {
    const texts = ['shared-text']
    const modelA = 'voyage-3-lite'
    const modelB = 'text-embedding-3-small'

    const entryA = makeMockEmbedEntry(texts, [[1.0, 0.0]], modelA)
    const entryB = makeMockEmbedEntry(texts, [[0.0, 1.0]], modelB)

    const clientA = new MockEmbedClientCacheKey([entryA], modelA)
    const clientB = new MockEmbedClientCacheKey([entryB], modelB)

    // modelA 클라이언트는 modelB의 캐시 키를 모름 → miss
    const keyB = buildCacheKey(texts.join('\0'), modelB)
    const clientAWithWrongKey = new MockEmbedClientCacheKey(
      [{ cacheKey: keyB, vectors: [[0.0, 1.0]] }],
      modelA,
    )
    // modelA로 요청 시 modelA 키를 계산하므로 miss
    await expect(clientAWithWrongKey.embed(texts)).rejects.toThrow(CacheMissError)

    // 각자 자기 모델 ID로 정상 히트
    const resA = await clientA.embed(texts)
    const resB = await clientB.embed(texts)
    expect(resA[0]).toEqual([1.0, 0.0])
    expect(resB[0]).toEqual([0.0, 1.0])
  })
})
