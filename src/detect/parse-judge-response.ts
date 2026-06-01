/**
 * src/detect/parse-judge-response.ts
 *
 * Sub-AC 5c-2: parseJudgeResponse(raw: string) → JudgeVerdict
 *
 * LLM judge 응답 문자열을 파싱하여 JudgeVerdict를 반환한다.
 * SPEC §5 §2.1 출력 스키마 기준.
 *
 * BLOCKER C1: kind는 'thrashing' | 'false_success' | 'none' 단일 리터럴.
 *             'fake_success' / 'fakeSuccess' 입력은 파싱 실패로 처리.
 * BLOCKER C2: JudgeVerdict 필드는 contracts.ts 정본. 이 파일에서 재정의 금지.
 *
 * 특성:
 *   - 순수 함수: 외부 상태·네트워크 미사용.
 *   - 불변성: 입력 raw 문자열을 변경하지 않는다.
 *   - JSON 코드블록(```json ... ```) 감싸인 응답도 처리한다.
 *   - 파싱/검증 실패 시 JudgeParseError를 throw (호출자가 fail-closed 처리).
 *   - console.log 금지.
 */

import { z } from 'zod'
import type { JudgeVerdict } from '../contracts.js'

// ── JudgeParseError ──────────────────────────────────────────────────────────

/**
 * judge 응답 파싱 실패를 나타내는 에러 클래스.
 * 호출자가 fail-closed 처리를 위해 구분할 수 있도록 분리한다.
 */
export class JudgeParseError extends Error {
  /** 파싱 실패한 원본 문자열 (감사용) */
  readonly raw: string
  /** 실패 원인 태그 */
  readonly cause_tag: 'invalid_json' | 'schema_mismatch' | 'empty_input'

  constructor(
    message: string,
    raw: string,
    cause_tag: 'invalid_json' | 'schema_mismatch' | 'empty_input',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'JudgeParseError'
    this.raw = raw
    this.cause_tag = cause_tag
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ── zod 검증 스키마 ──────────────────────────────────────────────────────────

/**
 * JudgeVerdict zod 파싱 스키마.
 * BLOCKER C1: kind enum은 'thrashing' | 'false_success' | 'none'.
 *             'fake_success' / 'fakeSuccess' 입력은 zod 검증 실패.
 * BLOCKER C2: 필드 목록은 contracts.ts JudgeVerdict 정본과 완전 일치.
 *
 * rawSamples: LLM 응답의 rawSamples가 없거나 null이면 빈 배열로 기본처리.
 * subtype: null이면 빈 문자열('')로 정규화.
 */
const JudgeResponseSchema = z.object({
  kind: z.enum(['thrashing', 'false_success', 'none']),
  subtype: z
    .union([z.string(), z.null()])
    .transform(v => (v === null ? '' : v))
    .default(''),
  confidence: z.number().min(0).max(1),
  topicDivergence: z.number().min(0).max(1).optional(),
  circularReference: z.boolean().optional(),
  reason: z.string().default(''),
  rawSamples: z.array(z.unknown()).default([]),
})

// ── 내부 헬퍼 ───────────────────────────────────────────────────────────────

/**
 * LLM 응답 문자열에서 JSON 부분을 추출한다.
 *
 * 지원 형식:
 *   1. 순수 JSON 문자열
 *   2. ```json ... ``` 코드블록
 *   3. ``` ... ``` 코드블록 (언어 미지정)
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim()

  // 코드블록 감싸인 경우 벗기기
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()
  }

  return trimmed
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * LLM judge 응답 문자열을 파싱하여 JudgeVerdict를 반환한다.
 *
 * SPEC §5 §2.1 출력 스키마를 기준으로 zod 검증을 수행한다.
 *
 * BLOCKER C1: kind는 'thrashing' | 'false_success' | 'none' 단일 리터럴.
 * BLOCKER C2: 반환 타입은 contracts.ts JudgeVerdict 정본.
 *
 * @param raw LLM 원본 응답 문자열 (JSON 또는 ```json ... ``` 형식)
 * @returns   파싱·검증된 JudgeVerdict (불변 객체)
 *
 * @throws {JudgeParseError} raw가 빈 문자열인 경우 (cause_tag: 'empty_input')
 * @throws {JudgeParseError} JSON 파싱 실패 시 (cause_tag: 'invalid_json')
 * @throws {JudgeParseError} zod 스키마 검증 실패 시 (cause_tag: 'schema_mismatch')
 *
 * @example
 * // 유효한 false_success 응답
 * const verdict = parseJudgeResponse(JSON.stringify({
 *   kind: 'false_success',
 *   subtype: 'unverified_completion',
 *   confidence: 0.85,
 *   reason: '완료선언이 있으나 검증 근거가 없습니다.',
 *   rawSamples: ['작업이 완료되었습니다.'],
 * }))
 * verdict.kind // 'false_success'
 *
 * @example
 * // 유효한 none(비판정) 응답
 * const verdict = parseJudgeResponse(JSON.stringify({
 *   kind: 'none',
 *   subtype: null,
 *   confidence: 0.2,
 *   reason: '판정 근거 불충분.',
 *   rawSamples: [],
 * }))
 * verdict.kind // 'none'
 */
export function parseJudgeResponse(raw: string): JudgeVerdict {
  // 빈 입력 조기 실패
  if (raw.trim().length === 0) {
    throw new JudgeParseError(
      'parseJudgeResponse: 빈 입력 문자열 — LLM 응답이 비어 있습니다.',
      raw,
      'empty_input',
    )
  }

  const jsonStr = extractJson(raw)

  // JSON 파싱
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch (err) {
    throw new JudgeParseError(
      `parseJudgeResponse: JSON 파싱 실패 — ${err instanceof Error ? err.message : String(err)}`,
      raw,
      'invalid_json',
      { cause: err },
    )
  }

  // zod 스키마 검증
  const result = JudgeResponseSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new JudgeParseError(
      `parseJudgeResponse: 스키마 검증 실패 — ${issues}`,
      raw,
      'schema_mismatch',
      { cause: result.error },
    )
  }

  // 불변 객체로 반환
  return Object.freeze(result.data) as JudgeVerdict
}
