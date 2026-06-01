/**
 * tests/shared-cache-integration-sub-ac-6d-4.test.ts
 *
 * Sub-AC 6d-4: 임베딩·judge 두 경로 공유 캐시 통합 테스트
 *
 * 검증 항목:
 *   - 임베딩 경로와 judge 경로가 동일한 인메모리 맵 인스턴스를 참조한다
 *   - 임베딩 경로에서 등록한 엔트리를 judge 경로에서 히트한다 (cross-path hit)
 *   - judge 경로에서 등록한 엔트리를 임베딩 경로에서 히트한다 (cross-path hit)
 *   - 미등록 엔트리에서 CacheMissError / JudgeCacheMissError를 각각 확인한다
 *   - 맵 인스턴스 동일성(Object.is) 검증
 *
 * 외부 API 절대 미호출 — 네트워크·API 키 불필요.
 * SPEC §1 표준화 결정 (e): cacheKey = sha256(payload)+':'+modelId
 */

import {
  CacheMissError,
  createEmbeddingCache,
  getOrRegisterEmbedding,
  type EmbeddingVector,
  type MutableEmbeddingCache,
} from '../src/api/embedding-cache.js'

import {
  JudgeCacheMissError,
  createJudgeCache,
  getOrRegisterJudge,
  type MutableJudgeCache,
} from '../src/api/judge-cache.js'

import { type JudgeVerdict } from '../src/contracts.js'
import { buildCacheKey } from '../src/api/cache-key.js'

// ─── 공통 픽스처 ─────────────────────────────────────────────────────────────

const EMBED_MODEL = 'voyage-3-lite'
const JUDGE_MODEL = 'claude-3-5-haiku-20241022'

const SAMPLE_VECTOR: EmbeddingVector = [0.1, 0.2, 0.3, 0.4]
const SAMPLE_VECTOR_B: EmbeddingVector = [0.5, 0.6, 0.7, 0.8]

const SAMPLE_VERDICT: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'repeat',
  confidence: 0.9,
  reason: 'loop detected',
  rawSamples: ['raw-sample-1'],
}

const SAMPLE_VERDICT_B: JudgeVerdict = {
  kind: 'false_success',
  subtype: 'convergence-illusion',
  confidence: 0.75,
  reason: 'false convergence detected',
  rawSamples: ['raw-sample-2'],
}

// ─── 공유 맵 인스턴스 헬퍼 ────────────────────────────────────────────────────

/**
 * 임베딩·judge 두 경로가 공유하는 단일 인메모리 맵.
 *
 * 이 테스트에서 "공유 캐시"란 동일 Map 인스턴스를 MutableEmbeddingCache와
 * MutableJudgeCache 두 경로 모두가 참조하는 구성을 말한다.
 * 실제 DetectorConfig에서 embedCache/judgeCache가 같은 Map 인스턴스로
 * 주입될 때의 동작을 검증한다.
 *
 * 키 충돌은 sha256+modelId 규칙으로 자연 분리되므로 안전하다.
 */
type SharedRawMap = Map<string, unknown>

function makeSharedMapPair(): {
  sharedMap: SharedRawMap
  embedCache: MutableEmbeddingCache
  judgeCache: MutableJudgeCache
} {
  // 동일 Map 인스턴스를 두 타입으로 캐스팅 — 공유 인스턴스 패턴
  const sharedMap: SharedRawMap = new Map()
  const embedCache = sharedMap as unknown as MutableEmbeddingCache
  const judgeCache = sharedMap as unknown as MutableJudgeCache
  return { sharedMap, embedCache, judgeCache }
}

// ─── 1. 맵 인스턴스 동일성 검증 ───────────────────────────────────────────────

describe('공유 캐시 인스턴스 동일성 (Sub-AC 6d-4)', () => {
  test('embedCache와 judgeCache가 동일한 Map 인스턴스를 참조한다 (Object.is)', () => {
    const { embedCache, judgeCache } = makeSharedMapPair()

    // Object.is: 두 참조가 정확히 같은 인스턴스인지 검증
    expect(Object.is(embedCache, judgeCache)).toBe(true)
  })

  test('임베딩 경로에서 set한 항목이 judge 경로 맵에도 즉시 반영된다', () => {
    const { embedCache, judgeCache } = makeSharedMapPair()

    const key = buildCacheKey('shared-text', EMBED_MODEL)
    ;(embedCache as Map<string, unknown>).set(key, Object.freeze([...SAMPLE_VECTOR]))

    // judge 경로(같은 인스턴스)에서 해당 키가 보인다
    expect((judgeCache as Map<string, unknown>).has(key)).toBe(true)
  })

  test('judge 경로에서 set한 항목이 임베딩 경로 맵에도 즉시 반영된다', () => {
    const { embedCache, judgeCache } = makeSharedMapPair()

    const key = buildCacheKey('shared-prompt', JUDGE_MODEL)
    ;(judgeCache as Map<string, unknown>).set(key, Object.freeze({ ...SAMPLE_VERDICT }))

    // 임베딩 경로(같은 인스턴스)에서 해당 키가 보인다
    expect((embedCache as Map<string, unknown>).has(key)).toBe(true)
  })
})

// ─── 2. 임베딩 경로 등록 → judge 경로에서 히트 ─────────────────────────────

describe('임베딩 경로 등록 → 공유 맵 → judge 경로 히트 (Sub-AC 6d-4)', () => {
  test('임베딩 경로에서 등록한 후 judge 경로에서 같은 맵에 엔트리가 존재한다', () => {
    const { embedCache, judgeCache } = makeSharedMapPair()

    // 임베딩 경로에서 엔트리 등록
    const embedKey = buildCacheKey('embed-text-for-cross-test', EMBED_MODEL)
    embedCache.set(embedKey, Object.freeze([...SAMPLE_VECTOR]))

    // 공유 맵이므로 judge 경로 변수에서도 동일 키를 has()로 확인 가능
    expect((judgeCache as Map<string, unknown>).has(embedKey)).toBe(true)
    expect((judgeCache as Map<string, unknown>).get(embedKey)).toEqual(SAMPLE_VECTOR)
  })

  test('임베딩 경로 등록 후 getOrRegisterEmbedding으로 히트 확인', () => {
    const { embedCache } = makeSharedMapPair()

    const embedKey = buildCacheKey('cross-path-embed', EMBED_MODEL)
    // 직접 맵에 등록 (임베딩 경로 시뮬레이션)
    embedCache.set(embedKey, Object.freeze([...SAMPLE_VECTOR]))

    // getOrRegisterEmbedding으로 히트 확인 (no throw)
    const result = getOrRegisterEmbedding(embedKey, embedCache)
    expect(result).toEqual(SAMPLE_VECTOR)
  })

  test('공유 맵에 임베딩 엔트리 등록 후 미등록 judge 키는 JudgeCacheMissError를 던진다', () => {
    const { embedCache, judgeCache } = makeSharedMapPair()

    const embedKey = buildCacheKey('embed-only-text', EMBED_MODEL)
    embedCache.set(embedKey, Object.freeze([...SAMPLE_VECTOR]))

    // judge 캐시에는 별도 등록 없음 → JudgeCacheMissError
    const unregisteredJudgeKey = buildCacheKey('not-registered-prompt', JUDGE_MODEL)
    expect(() => getOrRegisterJudge(unregisteredJudgeKey, judgeCache)).toThrow(
      JudgeCacheMissError,
    )
  })
})

// ─── 3. judge 경로 등록 → 임베딩 경로에서 히트 ─────────────────────────────

describe('judge 경로 등록 → 공유 맵 → 임베딩 경로 히트 (Sub-AC 6d-4)', () => {
  test('judge 경로에서 등록한 후 임베딩 경로에서 같은 맵에 엔트리가 존재한다', () => {
    const { embedCache, judgeCache } = makeSharedMapPair()

    // judge 경로에서 엔트리 등록
    const judgeKey = buildCacheKey('judge-prompt-for-cross-test', JUDGE_MODEL)
    judgeCache.set(judgeKey, Object.freeze({ ...SAMPLE_VERDICT }))

    // 공유 맵이므로 임베딩 경로 변수에서도 동일 키를 has()로 확인 가능
    expect((embedCache as Map<string, unknown>).has(judgeKey)).toBe(true)
  })

  test('judge 경로 등록 후 getOrRegisterJudge로 히트 확인', () => {
    const { judgeCache } = makeSharedMapPair()

    const judgeKey = buildCacheKey('cross-path-judge', JUDGE_MODEL)
    // 직접 맵에 등록 (judge 경로 시뮬레이션)
    judgeCache.set(judgeKey, Object.freeze({ ...SAMPLE_VERDICT }))

    // getOrRegisterJudge로 히트 확인 (no throw)
    const result = getOrRegisterJudge(judgeKey, judgeCache)
    expect(result.kind).toBe('thrashing')
    expect(result.confidence).toBe(0.9)
  })

  test('공유 맵에 judge 엔트리 등록 후 미등록 임베딩 키는 CacheMissError를 던진다', () => {
    const { embedCache, judgeCache } = makeSharedMapPair()

    const judgeKey = buildCacheKey('judge-only-prompt', JUDGE_MODEL)
    judgeCache.set(judgeKey, Object.freeze({ ...SAMPLE_VERDICT }))

    // 임베딩 캐시에는 별도 등록 없음 → CacheMissError
    const unregisteredEmbedKey = buildCacheKey('not-registered-text', EMBED_MODEL)
    expect(() => getOrRegisterEmbedding(unregisteredEmbedKey, embedCache)).toThrow(
      CacheMissError,
    )
  })
})

// ─── 4. 독립 맵 인스턴스: 한 경로 등록이 다른 경로에 영향 없음 ──────────────

describe('독립 맵 인스턴스: 경로 간 격리 확인 (Sub-AC 6d-4 대조군)', () => {
  test('독립 임베딩 캐시와 독립 judge 캐시는 서로 다른 인스턴스이다', () => {
    const embedCache = createEmbeddingCache()
    const judgeCache = createJudgeCache()

    // 독립 인스턴스: 서로 다른 맵
    expect(Object.is(embedCache, judgeCache)).toBe(false)
  })

  test('독립 인스턴스: 임베딩 캐시에 등록해도 judge 캐시는 영향 없음', () => {
    const embedCache = createEmbeddingCache()
    const judgeCache = createJudgeCache()

    const embedKey = buildCacheKey('isolated-text', EMBED_MODEL)
    embedCache.set(embedKey, Object.freeze([...SAMPLE_VECTOR]))

    // judge 캐시는 독립 인스턴스이므로 임베딩 키가 없다
    expect(judgeCache.has(embedKey)).toBe(false)

    // 독립 judge 캐시에서 해당 키 조회 시 JudgeCacheMissError
    expect(() => getOrRegisterJudge(embedKey, judgeCache)).toThrow(JudgeCacheMissError)
  })

  test('독립 인스턴스: judge 캐시에 등록해도 임베딩 캐시는 영향 없음', () => {
    const embedCache = createEmbeddingCache()
    const judgeCache = createJudgeCache()

    const judgeKey = buildCacheKey('isolated-prompt', JUDGE_MODEL)
    judgeCache.set(judgeKey, Object.freeze({ ...SAMPLE_VERDICT }))

    // 임베딩 캐시는 독립 인스턴스이므로 judge 키가 없다
    expect(embedCache.has(judgeKey)).toBe(false)

    // 독립 임베딩 캐시에서 해당 키 조회 시 CacheMissError
    expect(() => getOrRegisterEmbedding(judgeKey, embedCache)).toThrow(CacheMissError)
  })
})

// ─── 5. 공유 맵 + 복수 엔트리 교차 등록 시나리오 ─────────────────────────────

describe('공유 맵 복수 엔트리 교차 등록 통합 시나리오 (Sub-AC 6d-4)', () => {
  test('임베딩·judge 엔트리를 공유 맵에 교대로 등록 후 각 경로에서 모두 히트한다', () => {
    const { embedCache, judgeCache } = makeSharedMapPair()

    // 임베딩 엔트리 2개 등록
    const embedKey1 = buildCacheKey('text-alpha', EMBED_MODEL)
    const embedKey2 = buildCacheKey('text-beta', EMBED_MODEL)
    embedCache.set(embedKey1, Object.freeze([...SAMPLE_VECTOR]))
    embedCache.set(embedKey2, Object.freeze([...SAMPLE_VECTOR_B]))

    // judge 엔트리 2개 등록
    const judgeKey1 = buildCacheKey('prompt-alpha', JUDGE_MODEL)
    const judgeKey2 = buildCacheKey('prompt-beta', JUDGE_MODEL)
    judgeCache.set(judgeKey1, Object.freeze({ ...SAMPLE_VERDICT }))
    judgeCache.set(judgeKey2, Object.freeze({ ...SAMPLE_VERDICT_B }))

    // 공유 맵 크기: 임베딩 2 + judge 2 = 4
    expect((embedCache as Map<string, unknown>).size).toBe(4)
    expect((judgeCache as Map<string, unknown>).size).toBe(4)

    // 임베딩 경로에서 getOrRegisterEmbedding 히트
    expect(getOrRegisterEmbedding(embedKey1, embedCache)).toEqual(SAMPLE_VECTOR)
    expect(getOrRegisterEmbedding(embedKey2, embedCache)).toEqual(SAMPLE_VECTOR_B)

    // judge 경로에서 getOrRegisterJudge 히트
    const v1 = getOrRegisterJudge(judgeKey1, judgeCache)
    expect(v1.kind).toBe('thrashing')
    const v2 = getOrRegisterJudge(judgeKey2, judgeCache)
    expect(v2.kind).toBe('false_success')
  })

  test('공유 맵에서 미등록 임베딩 키와 미등록 judge 키 모두 올바른 에러를 던진다', () => {
    const { embedCache, judgeCache } = makeSharedMapPair()

    // 임베딩 엔트리 1개만 등록
    const registeredEmbedKey = buildCacheKey('registered-text', EMBED_MODEL)
    embedCache.set(registeredEmbedKey, Object.freeze([...SAMPLE_VECTOR]))

    // 미등록 임베딩 키 → CacheMissError
    const unregisteredEmbedKey = buildCacheKey('missing-text', EMBED_MODEL)
    let embedError: unknown
    try {
      getOrRegisterEmbedding(unregisteredEmbedKey, embedCache)
    } catch (err) {
      embedError = err
    }
    expect(embedError).toBeInstanceOf(CacheMissError)
    expect((embedError as CacheMissError).cacheKey).toBe(unregisteredEmbedKey)

    // 미등록 judge 키 → JudgeCacheMissError
    const unregisteredJudgeKey = buildCacheKey('missing-prompt', JUDGE_MODEL)
    let judgeError: unknown
    try {
      getOrRegisterJudge(unregisteredJudgeKey, judgeCache)
    } catch (err) {
      judgeError = err
    }
    expect(judgeError).toBeInstanceOf(JudgeCacheMissError)
    expect((judgeError as JudgeCacheMissError).cacheKey).toBe(unregisteredJudgeKey)
  })

  test('임베딩 경로 등록 후 judge 경로 변수에서 동일 맵 크기가 증가한다', () => {
    const { embedCache, judgeCache } = makeSharedMapPair()

    expect((judgeCache as Map<string, unknown>).size).toBe(0)

    // 임베딩 경로에서 엔트리 추가
    const key = buildCacheKey('size-test-text', EMBED_MODEL)
    embedCache.set(key, Object.freeze([...SAMPLE_VECTOR]))

    // judge 경로 변수에서 크기가 1 증가
    expect((judgeCache as Map<string, unknown>).size).toBe(1)

    // judge 경로에서 엔트리 추가
    const judgeKey = buildCacheKey('size-test-prompt', JUDGE_MODEL)
    judgeCache.set(judgeKey, Object.freeze({ ...SAMPLE_VERDICT }))

    // 임베딩 경로 변수에서 크기가 2로 증가
    expect((embedCache as Map<string, unknown>).size).toBe(2)
  })

  test('buildCacheKey 규칙으로 모델 ID가 달라 임베딩·judge 키가 자연 분리된다', () => {
    // 같은 payload라도 modelId가 다르면 다른 키
    const payload = 'same-payload'
    const embedKey = buildCacheKey(payload, EMBED_MODEL)
    const judgeKey = buildCacheKey(payload, JUDGE_MODEL)

    expect(embedKey).not.toBe(judgeKey)

    // 키 형식 검증
    expect(embedKey).toMatch(/^[0-9a-f]{64}:voyage-3-lite$/)
    expect(judgeKey).toMatch(/^[0-9a-f]{64}:claude-3-5-haiku-20241022$/)

    // 독립 캐시에서 미등록 키는 각각의 에러를 던진다 (공유 맵에서는 값 타입이 달라 검증 불가)
    const embedCache = createEmbeddingCache()
    const judgeCache = createJudgeCache()

    // 공유 맵에서 두 키는 충돌 없이 독립적으로 저장된다
    const { embedCache: sharedEmbedCache, judgeCache: sharedJudgeCache } = makeSharedMapPair()
    sharedEmbedCache.set(embedKey, Object.freeze([...SAMPLE_VECTOR]))
    sharedJudgeCache.set(judgeKey, Object.freeze({ ...SAMPLE_VERDICT }))

    // 공유 맵에 2개 엔트리가 존재 (키 충돌 없음)
    expect((sharedEmbedCache as Map<string, unknown>).size).toBe(2)

    // 각 경로에서 자신의 키만 히트
    expect(getOrRegisterEmbedding(embedKey, sharedEmbedCache)).toEqual(SAMPLE_VECTOR)
    expect(getOrRegisterJudge(judgeKey, sharedJudgeCache).kind).toBe('thrashing')

    // 독립 캐시에서 미등록 키 → 각각의 CacheMiss 에러
    expect(() => getOrRegisterEmbedding(embedKey, embedCache)).toThrow(CacheMissError)
    expect(() => getOrRegisterJudge(judgeKey, judgeCache)).toThrow(JudgeCacheMissError)
  })
})
