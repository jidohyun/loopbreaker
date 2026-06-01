/**
 * api/embed-client-providers.ts — 실제 API 공급자 골격 (미사용/주석 처리)
 *
 * 제약 (SPEC §4 + Seed 제약):
 *   - 외부 API 절대 미호출: 이 파일의 실제 구현 메서드는 NotImplementedError를 throw.
 *   - 운영 시 활성화 예정인 골격 코드는 주석으로만 존재.
 *   - 모든 테스트는 MockEmbedClient(embed-client.ts)로만 동작. 이 파일 참조 금지.
 *
 * BLOCKER B2: 임베딩 provider는 Voyage 또는 OpenAI. Anthropic은 임베딩 API 없음.
 */

import { type EmbedClient, EmbedClientError } from './embed-client.js'

// ─────────────────────────────────────────────────────────────────────────────
// NotImplementedError — 골격 클라이언트가 실수로 호출될 때 명확한 오류 제공
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 실제 API 골격 클라이언트의 미구현 메서드 호출 시 던지는 에러.
 * 외부 네트워크 호출 없이 즉시 throw 한다.
 */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotImplementedError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VoyageEmbedClient — Voyage AI 임베딩 API 골격 (미사용)
//
// 운영 활성화 시:
//   1. @voyageai/client (또는 fetch 기반 구현) 의존성 추가
//   2. constructor에 apiKey 주입
//   3. embed() 메서드 내 주석 해제
//   4. NotImplementedError throw 제거
//
// BLOCKER B2: Voyage AI는 임베딩 provider. Anthropic은 사용하지 않음.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Voyage AI 임베딩 API 클라이언트 골격.
 *
 * 현재 상태: 미활성화 — embed() 호출 시 NotImplementedError를 throw.
 * 네트워크 호출 없음. API 키 불필요.
 *
 * 운영 활성화 예시 (주석):
 * ```ts
 * // const response = await fetch('https://api.voyageai.com/v1/embeddings', {
 * //   method: 'POST',
 * //   headers: {
 * //     'Authorization': `Bearer ${this.#apiKey}`,
 * //     'Content-Type': 'application/json',
 * //   },
 * //   body: JSON.stringify({ model: this.#modelId, input: texts }),
 * // })
 * // const data = await response.json()
 * // return (data as { data: { embedding: number[] }[] }).data.map(d => d.embedding)
 * ```
 */
export class VoyageEmbedClient implements EmbedClient {
  readonly #modelId: string

  /**
   * @param modelId - Voyage 임베딩 모델 ID. 예: "voyage-3-lite"
   * @param _apiKey - Voyage API 키 (골격: 미사용, 네트워크 호출 없음)
   */
  constructor(modelId: string, _apiKey?: string) {
    this.#modelId = modelId
  }

  /** 등록된 Voyage 모델 ID */
  get modelId(): string {
    return this.#modelId
  }

  /**
   * 텍스트 배열을 임베딩 벡터 배열로 변환한다.
   *
   * 현재 상태: 미구현 골격. 호출 시 NotImplementedError를 throw.
   * 운영 활성화 전까지 이 메서드는 절대 네트워크를 호출하지 않는다.
   *
   * @throws {NotImplementedError} 항상 throw (골격 미활성화)
   */
  async embed(_texts: string[]): Promise<number[][]> {
    throw new NotImplementedError(
      `VoyageEmbedClient.embed: 실제 Voyage API 골격은 미활성화 상태입니다. ` +
      `테스트에서는 MockEmbedClient를 사용하세요 (src/api/embed-client.ts). ` +
      `운영 활성화 시 이 메서드의 NotImplementedError throw를 제거하고 ` +
      `Voyage AI API 호출 코드를 활성화하세요. (modelId: ${this.#modelId})`
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAIEmbedClient — OpenAI 임베딩 API 골격 (미사용)
//
// BLOCKER B2: OpenAI도 임베딩 provider로 허용됨.
// 운영 활성화 시 embed() 내 주석 해제 및 NotImplementedError throw 제거.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * OpenAI 임베딩 API 클라이언트 골격.
 *
 * 현재 상태: 미활성화 — embed() 호출 시 NotImplementedError를 throw.
 * 네트워크 호출 없음. API 키 불필요.
 *
 * 운영 활성화 예시 (주석):
 * ```ts
 * // import OpenAI from 'openai'
 * // const client = new OpenAI({ apiKey: this.#apiKey })
 * // const response = await client.embeddings.create({
 * //   model: this.#modelId,
 * //   input: texts,
 * // })
 * // return response.data.map(d => d.embedding)
 * ```
 */
export class OpenAIEmbedClient implements EmbedClient {
  readonly #modelId: string

  /**
   * @param modelId - OpenAI 임베딩 모델 ID. 예: "text-embedding-3-small"
   * @param _apiKey - OpenAI API 키 (골격: 미사용, 네트워크 호출 없음)
   */
  constructor(modelId: string, _apiKey?: string) {
    this.#modelId = modelId
  }

  /** 등록된 OpenAI 모델 ID */
  get modelId(): string {
    return this.#modelId
  }

  /**
   * 텍스트 배열을 임베딩 벡터 배열로 변환한다.
   *
   * 현재 상태: 미구현 골격. 호출 시 NotImplementedError를 throw.
   * 운영 활성화 전까지 이 메서드는 절대 네트워크를 호출하지 않는다.
   *
   * @throws {NotImplementedError} 항상 throw (골격 미활성화)
   */
  async embed(_texts: string[]): Promise<number[][]> {
    throw new NotImplementedError(
      `OpenAIEmbedClient.embed: 실제 OpenAI API 골격은 미활성화 상태입니다. ` +
      `테스트에서는 MockEmbedClient를 사용하세요 (src/api/embed-client.ts). ` +
      `운영 활성화 시 이 메서드의 NotImplementedError throw를 제거하고 ` +
      `OpenAI API 호출 코드를 활성화하세요. (modelId: ${this.#modelId})`
    )
  }
}

// Re-export EmbedClientError for convenience
export { EmbedClientError }
