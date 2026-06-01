/**
 * api/anthropic-judge-client.ts — AnthropicJudgeClient 골격 구현
 *
 * 제약 (SPEC §4 + Seed 제약):
 *   - 외부 API 절대 미호출: judge() 호출 시 NotImplementedError를 throw.
 *   - 운영 활성화 예정인 실제 Anthropic SDK 호출 코드는 주석으로만 존재.
 *   - 모든 테스트는 MockJudgeClient / MockJudgeClientWithHashKey로만 동작.
 *     이 파일은 타입 체크(tsc --noEmit) 용도로만 참조한다.
 *
 * BLOCKER B2: judge provider는 Anthropic. EmbedClient와 완전 분리.
 *             임베딩(Voyage/OpenAI)과 혼용 금지.
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본 타입. 재정의 금지.
 */

import { type JudgeClient, type JudgeRequest, type JudgeVerdict } from './judge-client.js'

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
// AnthropicJudgeClient — Anthropic Messages API judge 골격 (미사용)
//
// 운영 활성화 시:
//   1. @anthropic-ai/sdk 의존성 추가
//   2. constructor에 apiKey 주입
//   3. judge() 메서드 내 주석 해제
//   4. NotImplementedError throw 제거
//
// BLOCKER B2: Anthropic은 judge 전용. 임베딩 provider(Voyage/OpenAI)와 구분.
// BLOCKER C2: JudgeVerdict는 contracts.ts 정본 — 이 파일에서 재정의 금지.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Anthropic Messages API를 사용하는 judge 클라이언트 골격.
 *
 * 현재 상태: 미활성화 — judge() 호출 시 NotImplementedError를 throw.
 * 네트워크 호출 없음. API 키 불필요(미사용).
 *
 * 운영 활성화 예시 (주석):
 * ```ts
 * // import Anthropic from '@anthropic-ai/sdk'
 * //
 * // const response = await this.#client.messages.create({
 * //   model: req.modelId,
 * //   max_tokens: 1024,
 * //   temperature: req.temperature ?? 0.4,
 * //   system: [
 * //     { type: 'text', text: req.cacheableBlock,
 * //       cache_control: { type: 'ephemeral' } },
 * //   ],
 * //   messages: [
 * //     { role: 'user', content: req.volatileBlock },
 * //   ],
 * // })
 * //
 * // const raw = response.content[0]?.type === 'text'
 * //   ? response.content[0].text : ''
 * // return parseJudgeVerdict(raw)
 * ```
 */
export class AnthropicJudgeClient implements JudgeClient {
  readonly #apiKey: string
  readonly #defaultModelId: string

  /**
   * @param apiKey         - Anthropic API 키 (골격: 저장만 하고 미사용)
   * @param defaultModelId - 기본 judge 모델 ID.
   *                         예: "claude-3-5-sonnet-20241022"
   *                         (BLOCKER B2: Anthropic 모델 ID만 허용)
   */
  constructor(apiKey: string, defaultModelId = 'claude-3-5-sonnet-20241022') {
    this.#apiKey = apiKey
    this.#defaultModelId = defaultModelId
  }

  /** 저장된 기본 모델 ID (타입 검증용) */
  get defaultModelId(): string {
    return this.#defaultModelId
  }

  /**
   * JudgeRequest 1건에 대해 JudgeVerdict를 반환한다.
   *
   * 현재 상태: 미구현 골격. 호출 시 NotImplementedError를 throw.
   * 운영 활성화 전까지 이 메서드는 절대 네트워크를 호출하지 않는다.
   *
   * @throws {NotImplementedError} 항상 throw (골격 미활성화)
   */
  async judge(_req: JudgeRequest): Promise<JudgeVerdict> {
    // apiKey 필드가 사용되지 않는다는 lint 경고 방지 (골격 코드)
    void this.#apiKey
    throw new NotImplementedError(
      `AnthropicJudgeClient.judge: 실제 Anthropic API 골격은 미활성화 상태입니다. ` +
      `테스트에서는 MockJudgeClient / MockJudgeClientWithHashKey를 사용하세요 ` +
      `(src/api/judge-client.ts). 운영 활성화 시 이 메서드의 NotImplementedError ` +
      `throw를 제거하고 Anthropic Messages API 호출 코드를 활성화하세요. ` +
      `(modelId: ${_req.modelId ?? this.#defaultModelId})`
    )
  }
}
