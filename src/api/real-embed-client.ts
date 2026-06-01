/**
 * api/real-embed-client.ts — RealEmbedClient 골격 stub
 *
 * 제약 (SPEC §4 + Seed 제약):
 *   - 외부 API 절대 미호출: embed() 호출 시 NotImplementedError를 throw.
 *   - 운영 시 활성화 예정인 실제 API 호출 코드는 주석으로만 존재.
 *   - 모든 테스트는 MockEmbedClient(embed-client.ts)로만 동작. 이 파일 참조 금지.
 *
 * BLOCKER B2: 임베딩 provider는 Voyage 또는 OpenAI. Anthropic은 임베딩 API 없음.
 *
 * Sub-AC 3a: RealEmbedClient stub — EmbedClient 인터페이스를 구현하되,
 * embed() 메서드는 NotImplementedError를 throw한다.
 *
 * 운영 활성화 시:
 *   1. 원하는 provider(VoyageEmbedClient 또는 OpenAIEmbedClient)를 embed-client-providers.ts에서 사용
 *   2. 이 파일의 embed() 내 NotImplementedError throw를 제거하고 실제 구현으로 교체
 *   3. constructor에 apiKey 및 modelId 주입
 */

import { type EmbedClient, EmbedClientError } from './embed-client.js'
import { NotImplementedError } from './embed-client-providers.js'

// Re-export NotImplementedError for convenience in tests
export { NotImplementedError }

/**
 * RealEmbedClient — 실제 임베딩 API 연동을 위한 골격 stub.
 *
 * 현재 상태: 미활성화 — embed() 호출 시 NotImplementedError를 throw.
 * 네트워크 호출 없음. API 키 불필요.
 *
 * 운영 활성화 예시 (주석):
 * ```ts
 * // Voyage AI 사용 예:
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
 *
 * // OpenAI 사용 예:
 * // import OpenAI from 'openai'
 * // const client = new OpenAI({ apiKey: this.#apiKey })
 * // const response = await client.embeddings.create({
 * //   model: this.#modelId,
 * //   input: texts,
 * // })
 * // return response.data.map(d => d.embedding)
 * ```
 */
export class RealEmbedClient implements EmbedClient {
  readonly #modelId: string

  /**
   * @param modelId - 임베딩 모델 ID. 예: "voyage-3-lite", "text-embedding-3-small"
   * @param _apiKey - API 키 (골격: 미사용, 네트워크 호출 없음)
   */
  constructor(modelId: string, _apiKey?: string) {
    if (!modelId || typeof modelId !== 'string') {
      throw new TypeError('RealEmbedClient: modelId must be a non-empty string')
    }
    this.#modelId = modelId
  }

  /** 등록된 모델 ID */
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
      `RealEmbedClient.embed: 실제 임베딩 API 골격은 미활성화 상태입니다. ` +
      `테스트에서는 MockEmbedClient를 사용하세요 (src/api/embed-client.ts). ` +
      `운영 활성화 시 이 메서드의 NotImplementedError throw를 제거하고 ` +
      `Voyage AI 또는 OpenAI API 호출 코드를 활성화하세요. (modelId: ${this.#modelId})`
    )
  }
}

// Re-export EmbedClientError for convenience
export { EmbedClientError }
