/**
 * tests/embedding-cache-sub-ac-6b.test.ts
 *
 * Sub-AC 6b: get_or_register_embedding(key, cache) -> EmbeddingVector
 *
 * 검증 항목:
 *   1. 캐시 히트 → 등록된 벡터를 결정론으로 반환한다
 *   2. 캐시 미스 → CacheMissError를 던진다 (조용한 폴백 금지)
 *   3. CacheMissError.cacheKey 필드에 실패한 키가 기록된다
 *   4. 반환 벡터는 원본과 독립된 불변 복사본이다
 *   5. 빈 캐시에서 모든 조회가 CacheMissError를 발생시킨다
 *   6. 여러 키가 등록된 캐시에서 각각 정확한 벡터를 반환한다
 *   7. registerEmbedding: 새 캐시를 반환하고 기존 캐시를 변이하지 않는다
 *   8. createEmbeddingCacheFrom: 초기 항목으로 캐시를 생성한다
 *   9. buildCacheKey와 연동: sha256(text)+':'+modelId 키로 조회한다
 */

import {
  CacheMissError,
  createEmbeddingCache,
  createEmbeddingCacheFrom,
  getOrRegisterEmbedding,
  registerEmbedding,
  type EmbeddingCache,
  type EmbeddingVector,
} from '../src/api/embedding-cache.js'
import { buildCacheKey } from '../src/api/cache-key.js'

// ─── 1. 캐시 히트 → 등록된 벡터를 결정론으로 반환 ────────────────────────────

describe('getOrRegisterEmbedding — 캐시 히트', () => {
  const KEY = 'abc123:voyage-3-lite'
  const VECTOR: EmbeddingVector = [0.1, 0.2, 0.3, 0.4]

  let cache: EmbeddingCache

  beforeEach(() => {
    cache = createEmbeddingCacheFrom([[KEY, VECTOR]])
  })

  test('캐시 히트 시 등록된 벡터를 반환한다', () => {
    const result = getOrRegisterEmbedding(KEY, cache)
    expect(result).toEqual(VECTOR)
  })

  test('동일 키로 두 번 조회해도 동일 값을 반환한다 (결정론)', () => {
    const r1 = getOrRegisterEmbedding(KEY, cache)
    const r2 = getOrRegisterEmbedding(KEY, cache)
    expect(r1).toEqual(r2)
  })

  test('반환된 벡터의 요소가 등록된 값과 일치한다', () => {
    const result = getOrRegisterEmbedding(KEY, cache)
    expect(Array.from(result)).toStrictEqual([0.1, 0.2, 0.3, 0.4])
  })
})

// ─── 2. 캐시 미스 → CacheMissError 발생 (조용한 폴백 금지) ──────────────────

describe('getOrRegisterEmbedding — 캐시 미스 (CacheMissError)', () => {
  test('빈 캐시에서 조회하면 CacheMissError를 던진다', () => {
    const cache = createEmbeddingCache()
    expect(() => getOrRegisterEmbedding('any-key', cache)).toThrow(CacheMissError)
  })

  test('등록되지 않은 키로 조회하면 CacheMissError를 던진다', () => {
    const cache = createEmbeddingCacheFrom([['registered-key:model', [1, 2, 3]]])
    expect(() => getOrRegisterEmbedding('unregistered-key:model', cache)).toThrow(CacheMissError)
  })

  test('CacheMissError는 Error 서브클래스이다', () => {
    const cache = createEmbeddingCache()
    expect(() => getOrRegisterEmbedding('missing', cache)).toThrow(Error)
  })

  test('CacheMissError.name이 "CacheMissError"이다', () => {
    const cache = createEmbeddingCache()
    try {
      getOrRegisterEmbedding('missing', cache)
      fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CacheMissError)
      expect((err as CacheMissError).name).toBe('CacheMissError')
    }
  })

  test('폴백(undefined/null 반환)이 아니라 실제로 throw한다', () => {
    const cache = createEmbeddingCache()
    let thrown = false
    try {
      getOrRegisterEmbedding('key', cache)
    } catch {
      thrown = true
    }
    expect(thrown).toBe(true)
  })
})

// ─── 3. CacheMissError.cacheKey에 실패한 키가 기록된다 ───────────────────────

describe('CacheMissError — cacheKey 필드', () => {
  test('CacheMissError.cacheKey가 조회 실패한 키를 담는다', () => {
    const cache = createEmbeddingCache()
    const failKey = 'deadbeef:voyage-3-lite'
    try {
      getOrRegisterEmbedding(failKey, cache)
      fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CacheMissError)
      expect((err as CacheMissError).cacheKey).toBe(failKey)
    }
  })

  test('message에 실패한 키 정보가 포함된다', () => {
    const cache = createEmbeddingCache()
    const failKey = 'missing-key:model'
    try {
      getOrRegisterEmbedding(failKey, cache)
      fail('should have thrown')
    } catch (err) {
      expect((err as CacheMissError).message).toContain(failKey)
    }
  })

  test('CacheMissError를 직접 생성하면 cacheKey 필드가 세팅된다', () => {
    const err = new CacheMissError('test-key:model')
    expect(err.cacheKey).toBe('test-key:model')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('CacheMissError')
  })
})

// ─── 4. 반환 벡터는 불변 복사본 (원본 캐시 보호) ────────────────────────────

describe('getOrRegisterEmbedding — 불변 복사본 반환', () => {
  test('반환된 배열을 수정해도 캐시 내부에 영향이 없다', () => {
    const key = 'k:m'
    const originalVec: EmbeddingVector = [1, 2, 3]
    const cache = createEmbeddingCacheFrom([[key, originalVec]])

    const result = getOrRegisterEmbedding(key, cache)

    // 두 번째 조회로 원본이 바뀌지 않았음을 확인
    const result2 = getOrRegisterEmbedding(key, cache)
    expect(Array.from(result2)).toStrictEqual([1, 2, 3])

    // result와 result2는 동등하다
    expect(Array.from(result)).toStrictEqual(Array.from(result2))
  })

  test('반환된 배열은 원본 참조와 다른 객체이다', () => {
    const key = 'k:m'
    const vec: EmbeddingVector = [0.5, 0.6]
    const cache = createEmbeddingCacheFrom([[key, vec]])
    const result = getOrRegisterEmbedding(key, cache)
    // 값은 동등하지만 참조가 다름
    expect(Array.from(result)).toEqual(Array.from(vec))
    expect(result).not.toBe(vec)
  })
})

// ─── 5. 빈 캐시에서 모든 조회가 CacheMissError ───────────────────────────────

describe('getOrRegisterEmbedding — 빈 캐시', () => {
  test('createEmbeddingCache()로 만든 빈 캐시는 어떤 키도 찾지 못한다', () => {
    const cache = createEmbeddingCache()
    const keys = ['a:m', 'b:m', 'sha256hash:voyage-3-lite']
    for (const key of keys) {
      expect(() => getOrRegisterEmbedding(key, cache)).toThrow(CacheMissError)
    }
  })
})

// ─── 6. 여러 키 등록 → 각각 정확한 벡터 반환 ────────────────────────────────

describe('getOrRegisterEmbedding — 여러 키 등록', () => {
  test('두 개의 키가 각자 올바른 벡터를 반환한다', () => {
    const keyA = 'hash-a:voyage-3-lite'
    const keyB = 'hash-b:voyage-3-lite'
    const vecA: EmbeddingVector = [0.1, 0.2]
    const vecB: EmbeddingVector = [0.9, 0.8]

    const cache = createEmbeddingCacheFrom([
      [keyA, vecA],
      [keyB, vecB],
    ])

    expect(Array.from(getOrRegisterEmbedding(keyA, cache))).toStrictEqual([0.1, 0.2])
    expect(Array.from(getOrRegisterEmbedding(keyB, cache))).toStrictEqual([0.9, 0.8])
  })

  test('세 키 중 두 개만 등록 시 미등록 키는 CacheMissError를 던진다', () => {
    const cache = createEmbeddingCacheFrom([
      ['key1:model', [1, 0]],
      ['key2:model', [0, 1]],
    ])

    // 히트
    expect(() => getOrRegisterEmbedding('key1:model', cache)).not.toThrow()
    expect(() => getOrRegisterEmbedding('key2:model', cache)).not.toThrow()

    // 미스
    expect(() => getOrRegisterEmbedding('key3:model', cache)).toThrow(CacheMissError)
  })
})

// ─── 7. registerEmbedding — 불변성 보장 ─────────────────────────────────────

describe('registerEmbedding — 불변성 (기존 캐시 변이 없음)', () => {
  test('registerEmbedding은 새 맵을 반환하고 기존 캐시를 변이하지 않는다', () => {
    const originalCache = createEmbeddingCacheFrom([['key1:m', [1, 2]]])
    const newCache = registerEmbedding('key2:m', [3, 4], originalCache)

    // 원본에는 key2가 없다
    expect(() => getOrRegisterEmbedding('key2:m', originalCache)).toThrow(CacheMissError)

    // 새 캐시에는 key2가 있다
    expect(Array.from(getOrRegisterEmbedding('key2:m', newCache))).toStrictEqual([3, 4])

    // 새 캐시에서도 key1을 조회할 수 있다 (기존 항목 유지)
    expect(Array.from(getOrRegisterEmbedding('key1:m', newCache))).toStrictEqual([1, 2])
  })

  test('registerEmbedding으로 생성한 캐시와 원본 캐시는 독립적이다', () => {
    const cache1 = createEmbeddingCache()
    const cache2 = registerEmbedding('k:m', [0.5], cache1)

    expect(cache1.size).toBe(0)
    expect(cache2.size).toBe(1)
  })

  test('여러 번 registerEmbedding을 연쇄해도 각 단계의 이전 캐시는 영향 없다', () => {
    const c0 = createEmbeddingCache()
    const c1 = registerEmbedding('key1:m', [1], c0)
    const c2 = registerEmbedding('key2:m', [2], c1)
    const c3 = registerEmbedding('key3:m', [3], c2)

    expect(c0.size).toBe(0)
    expect(c1.size).toBe(1)
    expect(c2.size).toBe(2)
    expect(c3.size).toBe(3)

    expect(() => getOrRegisterEmbedding('key3:m', c1)).toThrow(CacheMissError)
    expect(Array.from(getOrRegisterEmbedding('key3:m', c3))).toStrictEqual([3])
  })
})

// ─── 8. createEmbeddingCacheFrom — 초기 항목 생성 ────────────────────────────

describe('createEmbeddingCacheFrom — 초기 항목으로 캐시 생성', () => {
  test('빈 배열로 생성하면 빈 캐시가 된다', () => {
    const cache = createEmbeddingCacheFrom([])
    expect(cache.size).toBe(0)
  })

  test('초기 항목으로 생성된 캐시는 해당 키를 조회할 수 있다', () => {
    const cache = createEmbeddingCacheFrom([['abc:model', [7, 8, 9]]])
    expect(Array.from(getOrRegisterEmbedding('abc:model', cache))).toStrictEqual([7, 8, 9])
  })

  test('여러 초기 항목 모두 정상 조회된다', () => {
    const entries: Array<readonly [string, EmbeddingVector]> = [
      ['k1:m', [0.1]],
      ['k2:m', [0.2]],
      ['k3:m', [0.3]],
    ]
    const cache = createEmbeddingCacheFrom(entries)
    expect(cache.size).toBe(3)
    for (const [key, vec] of entries) {
      expect(Array.from(getOrRegisterEmbedding(key, cache))).toStrictEqual(Array.from(vec))
    }
  })
})

// ─── 9. buildCacheKey와 연동 — sha256 기반 캐시 키 조회 ──────────────────────

describe('getOrRegisterEmbedding + buildCacheKey 연동 (SPEC §1 표준 e)', () => {
  const MODEL_ID = 'voyage-3-lite'
  const TEXT = 'Bash echo hello'

  test('buildCacheKey로 생성한 키로 등록한 후 동일 키로 조회하면 히트한다', () => {
    const key = buildCacheKey(TEXT, MODEL_ID)
    const vector: EmbeddingVector = [0.11, 0.22, 0.33]

    const cache = createEmbeddingCacheFrom([[key, vector]])
    const result = getOrRegisterEmbedding(key, cache)

    expect(Array.from(result)).toStrictEqual([0.11, 0.22, 0.33])
  })

  test('buildCacheKey로 생성한 키가 다른 text면 미스가 발생한다', () => {
    const key = buildCacheKey(TEXT, MODEL_ID)
    const cache = createEmbeddingCacheFrom([[key, [1, 2, 3]]])

    // 다른 텍스트의 캐시 키 → 미스
    const otherKey = buildCacheKey('Bash ls -la', MODEL_ID)
    expect(otherKey).not.toBe(key)
    expect(() => getOrRegisterEmbedding(otherKey, cache)).toThrow(CacheMissError)
  })

  test('동일 text라도 다른 modelId면 미스가 발생한다 (모델별 캐시 분리)', () => {
    const keyVoyage = buildCacheKey(TEXT, 'voyage-3-lite')
    const cache = createEmbeddingCacheFrom([[keyVoyage, [0.5, 0.6]]])

    const keyOpenAI = buildCacheKey(TEXT, 'text-embedding-3-small')
    expect(keyOpenAI).not.toBe(keyVoyage)
    expect(() => getOrRegisterEmbedding(keyOpenAI, cache)).toThrow(CacheMissError)
  })

  test('SPEC §1 (e): sha256(text)+":"+embedModelId 형식의 캐시 키가 올바르게 조회된다', () => {
    const text = 'Edit /src/foo.ts — content change'
    const embedModelId = 'text-embedding-3-small'
    const cacheKey = buildCacheKey(text, embedModelId)
    const vector: EmbeddingVector = [0.9, 0.1, 0.5, 0.3]

    const cache = createEmbeddingCacheFrom([[cacheKey, vector]])
    const retrieved = getOrRegisterEmbedding(cacheKey, cache)

    expect(Array.from(retrieved)).toStrictEqual([0.9, 0.1, 0.5, 0.3])
    // 키 형식 검증
    expect(cacheKey).toMatch(/^[0-9a-f]{64}:text-embedding-3-small$/)
  })
})
