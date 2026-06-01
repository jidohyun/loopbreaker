/**
 * api/judge-client.ts — JudgeClient 인터페이스 + Mock 구현
 *
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본 타입을 re-export.
 *             이 파일에서 재정의 금지.
 * BLOCKER B2: judge는 Anthropic. EmbedClient와 완전 분리.
 * 제약: 외부 API 절대 미호출. 실제 Anthropic SDK 호출 골격은
 *       AnthropicJudgeClient 클래스 내부에 주석으로만 존재.
 *       모든 테스트는 MockJudgeClient로만 동작한다.
 */

import { type JudgeVerdict } from '../contracts.js'

// re-export so consumers can import from this module
export type { JudgeVerdict }

// ─────────────────────────────────────────────
// 1. JudgeRequest — judge 호출 단위 입력
// ─────────────────────────────────────────────

/**
 * judge 단일 호출에 필요한 최소 입력.
 * snapshot(system+cacheable+volatile 분리 텍스트) + kind + modelId.
 */
export interface JudgeRequest {
  /**
   * 판정 종류. thrashing 프롬프트와 false_success 프롬프트를 구분.
   * BLOCKER C1: 'false_success' 단일 리터럴.
   */
  readonly kind: 'thrashing' | 'false_success'

  /**
   * 캐시 가능 정적 블록 (루브릭+few-shot).
   * Anthropic prompt cache 대상.
   */
  readonly cacheableBlock: string

  /**
   * 매 호출 변동 블록 (precedingN + anchor).
   * 캐시 불가.
   */
  readonly volatileBlock: string

  /**
   * judge 모델 ID (Anthropic).
   * BLOCKER B2: Anthropic 모델 ID만 허용.
   * 예: "claude-3-5-sonnet-20241022"
   */
  readonly modelId: string

  /**
   * 샘플링 temperature (self-consistency 편향완화용).
   * 기본 0.4. 단일 결정론 호출은 0.
   */
  readonly temperature?: number
}

// ─────────────────────────────────────────────
// 2. JudgeClient 인터페이스
//    — Anthropic judge 호출의 단일 추상화 경계
// ─────────────────────────────────────────────

/**
 * judge 호출 추상 인터페이스.
 *
 * 구현 1: AnthropicJudgeClient  — 실제 Anthropic SDK (골격, 미사용)
 * 구현 2: MockJudgeClient       — 결정론 테스트용 (hash→고정응답)
 *
 * 모든 단위·통합 테스트는 MockJudgeClient만 사용.
 * 네트워크·API 키 일절 불필요.
 */
export interface JudgeClient {
  /**
   * JudgeRequest 1건에 대해 JudgeVerdict를 반환한다.
   *
   * - 실패·타임아웃 시 예외를 throw (호출자가 retry + fail-closed 처리).
   * - rawSamples에는 이 단일 응답의 원문을 포함해야 한다.
   */
  judge(req: JudgeRequest): Promise<JudgeVerdict>
}

// ─────────────────────────────────────────────
// 3. AnthropicJudgeClient — 실제 API 골격 (미사용/주석)
//    실제 운영 시 이 클래스를 언주석 후 Anthropic SDK 의존성 추가.
// ─────────────────────────────────────────────

/*
import Anthropic from '@anthropic-ai/sdk'

export class AnthropicJudgeClient implements JudgeClient {
  readonly #client: Anthropic

  constructor(apiKey: string) {
    this.#client = new Anthropic({ apiKey })
  }

  async judge(req: JudgeRequest): Promise<JudgeVerdict> {
    // 실제 구현 예시 (M3 통합 시 활성화):
    //
    // const response = await this.#client.messages.create({
    //   model: req.modelId,
    //   max_tokens: 1024,
    //   temperature: req.temperature ?? 0.4,
    //   system: [
    //     { type: 'text', text: req.cacheableBlock,
    //       cache_control: { type: 'ephemeral' } },
    //   ],
    //   messages: [
    //     { role: 'user', content: req.volatileBlock },
    //   ],
    // })
    //
    // const raw = response.content[0]?.type === 'text'
    //   ? response.content[0].text : ''
    // return parseJudgeVerdict(raw)
    throw new Error('AnthropicJudgeClient: not activated in this build')
  }
}
*/

// ─────────────────────────────────────────────
// 4. MockJudgeClient — 결정론 테스트 전용
//    입력 cacheKey(외부에서 sha256 계산 후 주입) → 고정 JudgeVerdict
// ─────────────────────────────────────────────

/**
 * MockJudgeClient 등록 항목.
 * cacheKey = sha256(prompt) + ':' + modelId (SPEC §1 표준 e).
 */
export interface MockJudgeCacheEntry {
  readonly cacheKey: string
  readonly verdict: JudgeVerdict
}

/**
 * 결정론 Mock judge 클라이언트.
 *
 * 사용법:
 *   const mock = new MockJudgeClient([
 *     { cacheKey: 'abc123:claude-3-5-sonnet-20241022', verdict: myVerdict },
 *   ])
 *   const result = await mock.judge({ ..., modelId: 'claude-3-5-sonnet-20241022', ... })
 *
 * 캐시 미스 → 명시적 에러. 조용한 폴백 금지 (SPEC 제약).
 */
export class MockJudgeClient implements JudgeClient {
  readonly #entries: ReadonlyMap<string, JudgeVerdict>

  constructor(entries: readonly MockJudgeCacheEntry[] = []) {
    this.#entries = new Map(entries.map(e => [e.cacheKey, e.verdict]))
  }

  async judge(req: JudgeRequest): Promise<JudgeVerdict> {
    // 테스트는 cacheKey를 직접 지정해서 등록해야 한다.
    // cacheKey 계산은 호출자 책임 (sha256(cacheableBlock+volatileBlock)+':'+modelId).
    // Mock에서는 단순화: modelId만 키로 사용 가능하도록 오버로드 지원을 위해
    // req에 _cacheKey 옵션을 인식한다.
    const key = (req as JudgeRequest & { _cacheKey?: string })._cacheKey
      ?? `${req.kind}:${req.modelId}`

    const verdict = this.#entries.get(key)
    if (verdict === undefined) {
      throw new CacheMissError(key)
    }
    return verdict
  }

  /**
   * 런타임에 항목을 추가한다 (테스트 헬퍼).
   */
  register(entry: MockJudgeCacheEntry): MockJudgeClient {
    return new MockJudgeClient([
      ...Array.from(this.#entries.entries()).map(
        ([cacheKey, verdict]): MockJudgeCacheEntry => ({ cacheKey, verdict })
      ),
      entry,
    ])
  }
}

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { CacheMissError } from './embedding-cache.js'

// re-export CacheMissError so judge-client consumers can reference it
export { CacheMissError }

/**
 * JudgeVerdict zod 스키마.
 * BLOCKER C1: kind는 'false_success' 단일 리터럴.
 * BLOCKER C2: 필드 목록은 contracts.ts 정본과 완전 일치.
 */
export const JudgeVerdictSchema = z.object({
  kind: z.enum(['thrashing', 'false_success', 'none']),
  subtype: z.string(),
  confidence: z.number().min(0).max(1),
  topicDivergence: z.number().min(0).max(1).optional(),
  circularReference: z.boolean().optional(),
  reason: z.string(),
  rawSamples: z.array(z.unknown()),
})

// ─────────────────────────────────────────────
// 6. MockJudgeClientWithHashKey — sha256 캐시 키 기반 결정론 Mock
//    SPEC §1 표준 e: cacheKey = sha256(prompt) + ':' + modelId
//    judge prompt = cacheableBlock + volatileBlock (정규화 후 JSON 키 정렬)
// ─────────────────────────────────────────────

/**
 * sha256 캐시 키 기반 Mock judge 클라이언트 등록 항목.
 * cacheKey = sha256(cacheableBlock + volatileBlock) + ':' + modelId
 */
export interface MockJudgeHashEntry {
  readonly cacheKey: string
  readonly verdict: JudgeVerdict
}

/**
 * sha256(prompt)+':'+modelId 키로 등록하는 결정론 Mock judge 클라이언트.
 *
 * SPEC §1 표준 e 준수:
 *   cacheKey = sha256(cacheableBlock + volatileBlock) + ':' + modelId
 *
 * 사용법:
 * ```ts
 * const modelId = 'claude-3-5-sonnet-20241022'
 * const prompt = cacheableBlock + volatileBlock
 * const key = sha256Prompt(prompt) + ':' + modelId
 * const client = new MockJudgeClientWithHashKey([{ cacheKey: key, verdict: myVerdict }])
 * ```
 *
 * 캐시 미스 → 명시적 에러. 조용한 폴백 금지 (SPEC 제약).
 */
export class MockJudgeClientWithHashKey implements JudgeClient {
  readonly #entries: ReadonlyMap<string, JudgeVerdict>

  constructor(entries: readonly MockJudgeHashEntry[] = []) {
    this.#entries = new Map(entries.map(e => [e.cacheKey, e.verdict]))
  }

  async judge(req: JudgeRequest): Promise<JudgeVerdict> {
    const prompt = req.cacheableBlock + req.volatileBlock
    const hash = sha256Prompt(prompt)
    const key = `${hash}:${req.modelId}`
    const verdict = this.#entries.get(key)
    if (verdict === undefined) {
      throw new CacheMissError(key)
    }
    return verdict
  }

  /**
   * 항목을 추가한 새 MockJudgeClientWithHashKey를 반환한다 (불변 헬퍼).
   */
  register(entry: MockJudgeHashEntry): MockJudgeClientWithHashKey {
    return new MockJudgeClientWithHashKey([
      ...Array.from(this.#entries.entries()).map(
        ([cacheKey, verdict]): MockJudgeHashEntry => ({ cacheKey, verdict })
      ),
      entry,
    ])
  }
}

/**
 * sha256(prompt) hex 문자열을 반환하는 유틸리티.
 * MockJudgeClientWithHashKey 캐시 키 생성에 사용.
 * SPEC §1 표준 e: judge payload = 정규화 프롬프트(cacheableBlock + volatileBlock).
 */
export function sha256Prompt(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex')
}

// ─────────────────────────────────────────────
// 7. JudgeVerdict 파싱 유틸리티 (zod 검증)
// ─────────────────────────────────────────────

/**
 * judge 응답 JSON 문자열을 JudgeVerdict로 파싱한다.
 * 파싱 실패 시 예외 throw (호출자가 fail-closed 처리).
 */
export function parseJudgeVerdict(raw: string): JudgeVerdict {
  const trimmed = raw.trim()
  // JSON 코드블록 감싸인 경우 벗기기
  const jsonStr = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed

  const parsed: unknown = JSON.parse(jsonStr)
  return JudgeVerdictSchema.parse(parsed) as JudgeVerdict
}
