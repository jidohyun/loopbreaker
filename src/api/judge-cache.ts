/**
 * api/judge-cache.ts — judge 캐시 조회/등록 유틸리티
 *
 * Sub-AC 6c: getOrRegisterJudge(key, cache) -> JudgeVerdict
 *
 * 캐시 키 규칙 (SPEC §1 표준화 결정 (e)):
 *   cacheKey = sha256(prompt) + ':' + judgeModelId
 *
 * 설계 원칙:
 *   - 캐시 히트 → 결정론 응답 반환 (불변 복사본)
 *   - 캐시 미스 → JudgeCacheMissError 발생 (조용한 폴백 절대 금지)
 *   - 불변성: 캐시 맵 자체는 변이 없이 새 맵을 반환
 *   - 외부 API 절대 호출 없음
 *
 * 이 모듈은 순수 함수만 포함한다. 네트워크/I-O 없음.
 */

import { type JudgeVerdict } from '../contracts.js'

// re-export so consumers can import JudgeVerdict from this module
export type { JudgeVerdict }

// ---- 타입 정의 ----

/**
 * 인메모리 judge 캐시.
 * 키: cacheKey (sha256(prompt)+':'+judgeModelId)
 * 값: JudgeVerdict (고정 판정)
 */
export type JudgeCache = ReadonlyMap<string, JudgeVerdict>

/**
 * 변경 가능한 judge 캐시 (등록 전용).
 * JudgeCache의 mutable 버전.
 */
export type MutableJudgeCache = Map<string, JudgeVerdict>

// ---- 에러 ----

/**
 * judge 캐시 미스 에러.
 *
 * getOrRegisterJudge가 키를 찾지 못했을 때 던진다.
 * 조용한 폴백(silent fallback) 절대 금지 — 테스트에서 명시적으로 등록해야 한다.
 */
export class JudgeCacheMissError extends Error {
  /** 조회에 실패한 캐시 키 */
  public readonly cacheKey: string

  constructor(cacheKey: string) {
    super(
      `JudgeCacheMissError: 캐시 미스 — 등록되지 않은 키: "${cacheKey}". ` +
        `테스트에서 명시적으로 등록하세요 (조용한 폴백 금지).`,
    )
    this.name = 'JudgeCacheMissError'
    this.cacheKey = cacheKey
  }
}

// ---- 캐시 팩토리 ----

/**
 * 빈 MutableJudgeCache를 생성한다.
 */
export function createJudgeCache(): MutableJudgeCache {
  return new Map<string, JudgeVerdict>()
}

/**
 * 항목들로 초기화된 MutableJudgeCache를 생성한다.
 *
 * @param entries - [cacheKey, verdict] 쌍 배열
 */
export function createJudgeCacheFrom(
  entries: ReadonlyArray<readonly [string, JudgeVerdict]>,
): MutableJudgeCache {
  return new Map<string, JudgeVerdict>(entries.map(([k, v]) => [k, v]))
}

// ---- 핵심 함수 ----

/**
 * 캐시에서 JudgeVerdict를 조회한다.
 *
 * 히트: 결정론 판정을 불변 복사본으로 반환한다.
 * 미스: JudgeCacheMissError를 던진다 (조용한 폴백 절대 금지).
 *
 * @param key   - 조회할 캐시 키 (sha256(prompt)+':'+judgeModelId)
 * @param cache - judge 캐시 (ReadonlyMap)
 * @returns 등록된 JudgeVerdict의 불변 복사본
 * @throws {JudgeCacheMissError} 캐시에 키가 없을 때
 *
 * @example
 * ```ts
 * const verdict: JudgeVerdict = {
 *   kind: 'thrashing', subtype: 'repeat', confidence: 0.9,
 *   reason: 'loop detected', rawSamples: [],
 * }
 * const cache = createJudgeCacheFrom([
 *   ['abc123:claude-3-5-haiku-20241022', verdict],
 * ])
 * const result = getOrRegisterJudge('abc123:claude-3-5-haiku-20241022', cache)
 * // result deep-equals verdict
 *
 * // 미스: JudgeCacheMissError 발생
 * getOrRegisterJudge('unknown-key', cache) // throws JudgeCacheMissError
 * ```
 */
export function getOrRegisterJudge(
  key: string,
  cache: JudgeCache,
): JudgeVerdict {
  const verdict = cache.get(key)
  if (verdict === undefined) {
    throw new JudgeCacheMissError(key)
  }
  // 불변성: 원본 객체 노출 금지 — 얕은 복사본 반환 (JudgeVerdict는 plain object)
  return Object.freeze({ ...verdict })
}

/**
 * 캐시에 JudgeVerdict를 등록하여 새 캐시를 반환한다 (불변 헬퍼).
 *
 * 기존 캐시는 변이하지 않는다. 새 맵을 생성하여 반환한다.
 *
 * @param key     - 등록할 캐시 키
 * @param verdict - 저장할 JudgeVerdict
 * @param cache   - 기존 캐시
 * @returns 키가 추가된 새 MutableJudgeCache
 */
export function registerJudge(
  key: string,
  verdict: JudgeVerdict,
  cache: JudgeCache,
): MutableJudgeCache {
  const next = new Map(cache)
  next.set(key, Object.freeze({ ...verdict }))
  return next
}
