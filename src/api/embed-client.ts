/**
 * api/embed-client.ts — EmbedClient 인터페이스 정의
 *
 * BLOCKER B2: 임베딩 provider는 Voyage 또는 OpenAI (Anthropic은 임베딩 API 없음).
 * 실제 구현(VoyageEmbedClient, OpenAIEmbedClient)과 테스트용 MockEmbedClient는
 * 이 인터페이스를 구현하여 네트워크/API 키 없이 동작한다.
 *
 * 외부 API 절대 미호출: 이 파일은 인터페이스 정의만 포함.
 * 실제 HTTP 호출 골격은 src/api/voyage-embed-client.ts 에 별도 분리.
 */

/**
 * 텍스트 배열을 임베딩 벡터 배열로 변환하는 클라이언트 인터페이스.
 *
 * - 구현체: VoyageEmbedClient, OpenAIEmbedClient (실제 API용 골격, 미사용)
 * - 테스트용: MockEmbedClient (src/api/mock-embed-client.ts)
 * - 모든 단위·통합 테스트는 MockEmbedClient로만 동작 (네트워크·API 키 불필요)
 *
 * @example
 * ```ts
 * const client: EmbedClient = new MockEmbedClient(fixtures)
 * const vectors = await client.embed(['text a', 'text b'])
 * // vectors.length === 2, vectors[0].length === embedDim
 * ```
 */
export interface EmbedClient {
  /**
   * 텍스트 배열을 임베딩 벡터 배열로 변환한다.
   *
   * @param texts - 임베딩할 텍스트 배열 (빈 배열 허용, 빈 배열이면 빈 배열 반환)
   * @returns 각 텍스트에 대응하는 부동소수점 벡터 배열.
   *          반환 배열의 길이는 texts.length와 동일.
   *          각 내부 배열의 길이는 embedDim (DetectorConfig.embedDim)과 동일.
   * @throws {EmbedClientError} API 오류·타임아웃 시 (재시도 소진 후)
   */
  embed(texts: string[]): Promise<number[][]>
}

/**
 * EmbedClient 호출 실패 시 던지는 에러.
 * fail-closed 정책: 재시도(지수백오프, 상한 apiMaxRetries) 소진 후 이 에러를 throw.
 */
export class EmbedClientError extends Error {
  public readonly embedCause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'EmbedClientError'
    this.embedCause = cause
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MockEmbedClient — 결정론 테스트 전용
//
// 설계 원칙:
//   - 동일 입력 텍스트 → 항상 동일 벡터 (결정론)
//   - 모든 벡터 길이 = dim (상수 차원)
//   - 캐시 미스 → EmbedClientError throw (조용한 폴백 금지)
//   - 외부 API 절대 미호출
//
// 캐시 키 규칙 (SPEC §1 표준 e):
//   cacheKey = sha256(text) + ':' + embedModelId
//   MockEmbedClient에서는 text → 사전등록 벡터 직접 매핑 (sha256 연산 생략).
//   통합 테스트에서 sha256 기반 키를 쓰려면 MockEmbedClientWithHashKey를 사용.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto'

/**
 * MockEmbedClient 등록 항목.
 * text → 고정 float 벡터 매핑.
 * 모든 벡터는 dim 길이여야 한다 (생성 시 검증).
 */
export interface MockEmbedEntry {
  readonly text: string
  readonly vector: readonly number[]
}

/**
 * 결정론 Mock 임베딩 클라이언트.
 *
 * 사용법:
 * ```ts
 * const client = new MockEmbedClient([
 *   { text: 'hello', vector: [0.1, 0.2, 0.3, 0.4] },
 *   { text: 'world', vector: [0.5, 0.6, 0.7, 0.8] },
 * ], 4)
 * const vecs = await client.embed(['hello', 'world'])
 * // vecs[0] === [0.1, 0.2, 0.3, 0.4], vecs[1] === [0.5, 0.6, 0.7, 0.8]
 * ```
 *
 * 캐시 미스 → EmbedClientError (조용한 폴백 금지, SPEC 제약).
 */
export class MockEmbedClient implements EmbedClient {
  readonly #fixtures: ReadonlyMap<string, readonly number[]>
  readonly #dim: number

  /**
   * @param entries - 텍스트→벡터 매핑 배열. 각 벡터 길이는 dim과 일치해야 함.
   * @param dim     - 임베딩 차원. 모든 벡터의 길이를 이 값으로 강제.
   */
  constructor(entries: readonly MockEmbedEntry[], dim: number) {
    if (dim <= 0 || !Number.isInteger(dim)) {
      throw new TypeError(`MockEmbedClient: dim must be a positive integer, got ${dim}`)
    }
    for (const { text, vector } of entries) {
      if (vector.length !== dim) {
        throw new TypeError(
          `MockEmbedClient: vector for "${text}" has length ${vector.length}, expected ${dim}`
        )
      }
    }
    this.#fixtures = new Map(entries.map(e => [e.text, e.vector]))
    this.#dim = dim
  }

  /** 등록된 임베딩 차원 */
  get dim(): number {
    return this.#dim
  }

  /**
   * 텍스트 배열을 임베딩 벡터 배열로 변환한다 (결정론, 네트워크 없음).
   *
   * @throws {EmbedClientError} 등록되지 않은 텍스트가 포함된 경우
   */
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => {
      const vec = this.#fixtures.get(text)
      if (vec === undefined) {
        throw new EmbedClientError(
          `MockEmbedClient: 캐시 미스 — 등록되지 않은 텍스트: "${text}". ` +
          `테스트에서 명시적으로 등록하세요 (조용한 폴백 금지).`
        )
      }
      // 불변성: 복사본 반환 (내부 배열 노출 금지)
      return [...vec]
    })
  }

  /**
   * 항목을 추가한 새 MockEmbedClient를 반환한다 (불변 헬퍼).
   */
  register(entry: MockEmbedEntry): MockEmbedClient {
    return new MockEmbedClient(
      [
        ...Array.from(this.#fixtures.entries()).map(
          ([text, vector]): MockEmbedEntry => ({ text, vector })
        ),
        entry,
      ],
      this.#dim
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MockEmbedClientWithHashKey — sha256 캐시 키 기반 결정론 Mock
//
// SPEC §1 표준 e: cacheKey = sha256(text) + ':' + embedModelId
// 통합 테스트에서 sha256 키로 등록할 때 사용.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * sha256 캐시 키 기반 Mock 임베딩 클라이언트.
 * cacheKey = sha256(text) + ':' + embedModelId
 *
 * 사용법:
 * ```ts
 * const modelId = 'voyage-3-lite'
 * const key = sha256Text('hello') + ':' + modelId
 * const client = new MockEmbedClientWithHashKey([{ cacheKey: key, vector: [...] }], 4)
 * ```
 */
export interface MockEmbedHashEntry {
  readonly cacheKey: string
  readonly vector: readonly number[]
}

/**
 * sha256(text)+':'+modelId 키로 등록하는 결정론 Mock.
 * 내부적으로 embed(texts) 호출 시 각 text의 sha256을 계산해 조회.
 */
export class MockEmbedClientWithHashKey implements EmbedClient {
  readonly #entries: ReadonlyMap<string, readonly number[]>
  readonly #dim: number
  readonly #modelId: string

  constructor(
    entries: readonly MockEmbedHashEntry[],
    dim: number,
    modelId: string
  ) {
    if (dim <= 0 || !Number.isInteger(dim)) {
      throw new TypeError(`MockEmbedClientWithHashKey: dim must be a positive integer, got ${dim}`)
    }
    for (const { cacheKey, vector } of entries) {
      if (vector.length !== dim) {
        throw new TypeError(
          `MockEmbedClientWithHashKey: vector for key "${cacheKey}" has length ${vector.length}, expected ${dim}`
        )
      }
    }
    this.#entries = new Map(entries.map(e => [e.cacheKey, e.vector]))
    this.#dim = dim
    this.#modelId = modelId
  }

  get dim(): number {
    return this.#dim
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => {
      const hash = createHash('sha256').update(text, 'utf8').digest('hex')
      const key = `${hash}:${this.#modelId}`
      const vec = this.#entries.get(key)
      if (vec === undefined) {
        throw new EmbedClientError(
          `MockEmbedClientWithHashKey: 캐시 미스 — 등록되지 않은 키: "${key}" (text: "${text}"). ` +
          `테스트에서 명시적으로 등록하세요 (조용한 폴백 금지).`
        )
      }
      return [...vec]
    })
  }
}

/**
 * sha256(text) hex 문자열을 반환하는 유틸리티.
 * MockEmbedClientWithHashKey 캐시 키 생성에 사용.
 */
export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// ─────────────────────────────────────────────────────────────────────────────
// MockEmbedClientCacheKey — buildCacheKey + CacheMissError 기반 결정론 Mock
//
// Sub-AC 6b: MockEmbedClient cache lookup:
//   - embed(texts) 호출 시 buildCacheKey(texts.join('\0'), modelId)로 캐시 키 계산
//   - 캐시 히트 → 등록된 벡터 배열 반환 (결정론)
//   - 캐시 미스 → CacheMissError throw (조용한 폴백 절대 금지)
//
// SPEC §1 표준 e: cacheKey = sha256(payload)+':'+embedModelId
//   여기서 payload = texts.join('\0') (texts 배열 전체를 하나의 payload로)
// ─────────────────────────────────────────────────────────────────────────────

import { buildCacheKey } from './cache-key.js'
import { CacheMissError } from './embedding-cache.js'

/**
 * MockEmbedClientCacheKey 등록 항목.
 * cacheKey = buildCacheKey(texts.join('\0'), modelId)
 * vectors = 각 텍스트에 대응하는 벡터 배열 (texts.length 개수와 일치)
 */
export interface MockEmbedCacheEntry {
  /** buildCacheKey(texts.join('\0'), modelId) 로 생성된 캐시 키 */
  readonly cacheKey: string
  /** 각 텍스트에 대응하는 임베딩 벡터 배열. embed() 반환값과 동일한 구조. */
  readonly vectors: readonly (readonly number[])[]
}

/**
 * buildCacheKey 기반 결정론 Mock 임베딩 클라이언트.
 *
 * Sub-AC 6b 구현:
 *   - embed(texts) 호출 시 cacheKey = buildCacheKey(texts.join('\0'), modelId)
 *   - 캐시 히트 → 등록된 vectors 반환 (불변 복사본)
 *   - 캐시 미스 → CacheMissError throw (조용한 폴백 절대 금지)
 *
 * 사용법:
 * ```ts
 * import { buildCacheKey } from './cache-key.js'
 *
 * const modelId = 'voyage-3-lite'
 * const texts = ['hello', 'world']
 * const key = buildCacheKey(texts.join('\0'), modelId)
 * const client = new MockEmbedClientCacheKey(
 *   [{ cacheKey: key, vectors: [[0.1, 0.2], [0.3, 0.4]] }],
 *   modelId,
 * )
 * const result = await client.embed(texts)
 * // result[0] === [0.1, 0.2], result[1] === [0.3, 0.4]
 * ```
 */
export class MockEmbedClientCacheKey implements EmbedClient {
  readonly #cache: ReadonlyMap<string, readonly (readonly number[])[]>
  readonly #modelId: string

  /**
   * @param entries - 사전 등록할 캐시 항목 배열
   * @param modelId - 임베딩 모델 ID (캐시 키 생성에 사용)
   */
  constructor(
    entries: readonly MockEmbedCacheEntry[],
    modelId: string,
  ) {
    if (!modelId || typeof modelId !== 'string') {
      throw new TypeError(
        `MockEmbedClientCacheKey: modelId must be a non-empty string, got "${modelId}"`,
      )
    }
    this.#cache = new Map(entries.map(e => [e.cacheKey, e.vectors]))
    this.#modelId = modelId
  }

  /** 등록된 모델 ID */
  get modelId(): string {
    return this.#modelId
  }

  /**
   * 텍스트 배열을 임베딩 벡터 배열로 변환한다 (결정론, 네트워크 없음).
   *
   * 캐시 키 = buildCacheKey(texts.join('\0'), modelId)
   *
   * @throws {CacheMissError} 캐시에 등록되지 않은 texts 조합인 경우
   */
  async embed(texts: string[]): Promise<number[][]> {
    const payload = texts.join('\0')
    const cacheKey = buildCacheKey(payload, this.#modelId)
    const vectors = this.#cache.get(cacheKey)
    if (vectors === undefined) {
      throw new CacheMissError(cacheKey)
    }
    // 불변성: 복사본 반환 (내부 배열 노출 금지)
    return vectors.map(vec => [...vec])
  }

  /**
   * 항목을 추가한 새 MockEmbedClientCacheKey를 반환한다 (불변 헬퍼).
   */
  register(entry: MockEmbedCacheEntry): MockEmbedClientCacheKey {
    return new MockEmbedClientCacheKey(
      [
        ...Array.from(this.#cache.entries()).map(
          ([cacheKey, vectors]): MockEmbedCacheEntry => ({ cacheKey, vectors }),
        ),
        entry,
      ],
      this.#modelId,
    )
  }
}

/**
 * MockEmbedClientCacheKey 등록용 헬퍼 함수.
 * texts 배열과 modelId로 캐시 키를 자동 계산하여 MockEmbedCacheEntry를 생성한다.
 *
 * @param texts   - 임베딩할 텍스트 배열
 * @param vectors - 각 텍스트에 대응하는 벡터 배열
 * @param modelId - 임베딩 모델 ID
 * @returns MockEmbedCacheEntry (cacheKey + vectors)
 *
 * @example
 * ```ts
 * const entry = makeMockEmbedEntry(
 *   ['hello', 'world'],
 *   [[0.1, 0.2], [0.3, 0.4]],
 *   'voyage-3-lite',
 * )
 * const client = new MockEmbedClientCacheKey([entry], 'voyage-3-lite')
 * ```
 */
export function makeMockEmbedEntry(
  texts: string[],
  vectors: readonly (readonly number[])[],
  modelId: string,
): MockEmbedCacheEntry {
  const payload = texts.join('\0')
  const cacheKey = buildCacheKey(payload, modelId)
  return { cacheKey, vectors }
}
