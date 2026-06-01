/**
 * api/cache-key.ts — 캐시 키 생성 유틸리티
 *
 * SPEC §1 표준화 결정 (e):
 *   캐시 키 = sha256(payload) + ':' + modelId
 *
 * 임베딩·judge 양쪽에 동일 규칙 적용:
 *   - 임베딩: cacheKey = sha256(text)   + ':' + embedModelId
 *   - judge:  cacheKey = sha256(prompt) + ':' + judgeModelId
 *
 * 이 모듈은 순수 함수만 포함한다. 외부 API 호출 없음.
 */

import { createHash } from 'node:crypto'

/**
 * 캐시 키를 생성하는 순수 함수.
 *
 * 규칙: sha256(payload, utf8) hex + ':' + modelId
 *
 * @param payload - 해시할 문자열 (텍스트 또는 프롬프트)
 * @param modelId - 모델 식별자 (예: 'voyage-3-lite', 'claude-3-5-haiku-20241022')
 * @returns `${sha256hex}:${modelId}` 형식의 캐시 키
 *
 * @example
 * ```ts
 * buildCacheKey('hello world', 'voyage-3-lite')
 * // => 'b94d27b9934d3e08a52e52d7da7dabfac484efe04294e576c7c3f2c3831d8:voyage-3-lite'
 * ```
 */
export function buildCacheKey(payload: string, modelId: string): string {
  const hash = createHash('sha256').update(payload, 'utf8').digest('hex')
  return `${hash}:${modelId}`
}

/**
 * sha256(text) hex 문자열만 반환하는 유틸리티 (내부 공용).
 *
 * @param text - 해시할 문자열
 * @returns sha256 hex 문자열 (64자)
 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
