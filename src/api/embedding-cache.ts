/**
 * api/embedding-cache.ts — 임베딩 캐시 조회/등록 유틸리티
 *
 * Sub-AC 6b: get_or_register_embedding(key, cache) -> EmbeddingVector
 *
 * 캐시 키 규칙 (SPEC §1 표준화 결정 (e)):
 *   cacheKey = sha256(text) + ':' + embedModelId
 *
 * 설계 원칙:
 *   - 캐시 히트 → 결정론 응답 반환 (불변 복사본)
 *   - 캐시 미스 → CacheMissError 발생 (조용한 폴백 절대 금지)
 *   - 불변성: 캐시 맵 자체는 변이 없이 새 맵을 반환
 *   - 외부 API 절대 호출 없음
 *
 * 이 모듈은 순수 함수만 포함한다. 네트워크/I-O 없음.
 */

// ---- 타입 정의 ----

/**
 * 임베딩 벡터 타입 (float 배열).
 * DetectorConfig.embedDim 길이를 가진다.
 */
export type EmbeddingVector = readonly number[]

/**
 * 인메모리 임베딩 캐시.
 * 키: cacheKey (sha256(text)+':'+embedModelId)
 * 값: EmbeddingVector (고정 벡터)
 */
export type EmbeddingCache = ReadonlyMap<string, EmbeddingVector>

/**
 * 변경 가능한 임베딩 캐시 (등록 전용).
 * EmbeddingCache의 mutable 버전.
 */
export type MutableEmbeddingCache = Map<string, EmbeddingVector>

// ---- 에러 ----

/**
 * 임베딩 캐시 미스 에러.
 *
 * get_or_register_embedding이 키를 찾지 못했을 때 던진다.
 * 조용한 폴백(silent fallback) 절대 금지 — 테스트에서 명시적으로 등록해야 한다.
 */
export class CacheMissError extends Error {
  /** 조회에 실패한 캐시 키 */
  public readonly cacheKey: string

  constructor(cacheKey: string) {
    super(
      `CacheMissError: 캐시 미스 — 등록되지 않은 키: "${cacheKey}". ` +
        `테스트에서 명시적으로 등록하세요 (조용한 폴백 금지).`,
    )
    this.name = 'CacheMissError'
    this.cacheKey = cacheKey
  }
}

// ---- 캐시 팩토리 ----

/**
 * 빈 MutableEmbeddingCache를 생성한다.
 */
export function createEmbeddingCache(): MutableEmbeddingCache {
  return new Map<string, EmbeddingVector>()
}

/**
 * 항목들로 초기화된 MutableEmbeddingCache를 생성한다.
 *
 * @param entries - [cacheKey, vector] 쌍 배열
 */
export function createEmbeddingCacheFrom(
  entries: ReadonlyArray<readonly [string, EmbeddingVector]>,
): MutableEmbeddingCache {
  return new Map<string, EmbeddingVector>(entries.map(([k, v]) => [k, v]))
}

// ---- 핵심 함수 ----

/**
 * 캐시에서 임베딩 벡터를 조회한다.
 *
 * 히트: 결정론 벡터를 불변 복사본으로 반환한다.
 * 미스: CacheMissError를 던진다 (조용한 폴백 절대 금지).
 *
 * @param key   - 조회할 캐시 키 (sha256(text)+':'+embedModelId)
 * @param cache - 임베딩 캐시 (ReadonlyMap)
 * @returns 등록된 임베딩 벡터의 불변 복사본
 * @throws {CacheMissError} 캐시에 키가 없을 때
 *
 * @example
 * ```ts
 * const cache = createEmbeddingCacheFrom([
 *   ['abc123:voyage-3-lite', [0.1, 0.2, 0.3]],
 * ])
 * const vec = getOrRegisterEmbedding('abc123:voyage-3-lite', cache)
 * // vec === [0.1, 0.2, 0.3]
 *
 * // 미스: CacheMissError 발생
 * getOrRegisterEmbedding('unknown-key', cache) // throws CacheMissError
 * ```
 */
export function getOrRegisterEmbedding(
  key: string,
  cache: EmbeddingCache,
): EmbeddingVector {
  const vec = cache.get(key)
  if (vec === undefined) {
    throw new CacheMissError(key)
  }
  // 불변성: 원본 배열 노출 금지 — 복사본 반환
  return Object.freeze([...vec])
}

/**
 * 캐시에 임베딩 벡터를 등록하여 새 캐시를 반환한다 (불변 헬퍼).
 *
 * 기존 캐시는 변이하지 않는다. 새 맵을 생성하여 반환한다.
 *
 * @param key    - 등록할 캐시 키
 * @param vector - 저장할 임베딩 벡터
 * @param cache  - 기존 캐시
 * @returns 키가 추가된 새 MutableEmbeddingCache
 */
export function registerEmbedding(
  key: string,
  vector: EmbeddingVector,
  cache: EmbeddingCache,
): MutableEmbeddingCache {
  const next = new Map(cache)
  next.set(key, Object.freeze([...vector]))
  return next
}
