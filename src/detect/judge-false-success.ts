/**
 * src/detect/judge-false-success.ts
 *
 * Sub-AC 5c-3: judgeFalseSuccess(text, rubric, llmClient) → JudgeVerdict
 *
 * build_judge_prompt로 프롬프트 생성 후 llmClient 호출,
 * parse_judge_response로 결과 파싱하는 전체 흐름을 연결하는 통합 함수.
 *
 * SPEC §5 §2.3 false_success 판정 통합 흐름:
 *   buildJudgePrompt(text, rubric) → JudgePrompt
 *   → llmClient.judge(JudgeRequest) → raw string (via rawSamples[0] or reason)
 *   → parseJudgeResponse(raw) → JudgeVerdict
 *
 * BLOCKER C1: kind는 'thrashing' | 'false_success' | 'none' 단일 리터럴.
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본. 이 파일에서 재정의 금지.
 * BLOCKER B2: JudgeClient는 Anthropic 전용 추상화. EmbedClient와 완전 분리.
 *
 * 특성:
 *   - 외부 API 절대 미호출: JudgeClient 인터페이스를 통해서만 호출.
 *   - 불변성: 입력 text·rubric을 변경하지 않는다.
 *   - fail-closed: llmClient.judge() 실패 시 예외를 그대로 throw.
 *   - console.log 금지.
 */

import type { JudgeVerdict } from '../contracts.js'
import type { JudgeClient, JudgeRequest } from '../api/judge-client.js'
import type { Rubric } from './false-success-rubric.js'
import { buildJudgePrompt } from './judge-prompt.js'
import { parseJudgeResponse } from './parse-judge-response.js'

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * false_success 판정 통합 함수.
 *
 * 전체 흐름:
 *   1. buildJudgePrompt(text, rubric) → JudgePrompt (systemBlock + volatileBlock)
 *   2. llmClient.judge(JudgeRequest) → JudgeVerdict (MockJudgeClient 또는 실제 구현)
 *   3. JudgeVerdict를 반환 (rawSamples에 LLM 응답 보존)
 *
 * NOTE: JudgeClient.judge()가 직접 JudgeVerdict를 반환하므로
 *       parseJudgeResponse는 원시 JSON 문자열이 필요한 경우에만 호출한다.
 *       MockJudgeClient는 이미 파싱된 JudgeVerdict를 반환하므로 별도 파싱 불필요.
 *       실제 LLM 응답(raw string)을 처리하려면 rawSamples[0]을 parseJudgeResponse에 전달.
 *
 * BLOCKER C1: 반환 JudgeVerdict.kind는 'thrashing' | 'false_success' | 'none'.
 * BLOCKER C2: 반환 타입은 contracts.ts JudgeVerdict 정본.
 *
 * @param text      판정 대상 정규화 텍스트
 * @param rubric    false_success 판정용 루브릭 (buildFalseSuccessRubric() 반환값)
 * @param llmClient judge 클라이언트 (MockJudgeClient 또는 실제 구현)
 * @param modelId   judge 모델 ID (기본값: 'claude-3-5-sonnet-20241022')
 * @returns         파싱·검증된 JudgeVerdict
 *
 * @throws {Error}  text가 빈 문자열이거나 rubric이 유효하지 않을 때
 * @throws {Error}  llmClient.judge() 실패 시 (fail-closed)
 *
 * @example
 * // false_success 판정 경로
 * const rubric = buildFalseSuccessRubric()
 * const verdict = await judgeFalseSuccess(
 *   '작업이 완료되었습니다.',
 *   rubric,
 *   mockClient,
 * )
 * verdict.kind // 'false_success' 또는 'none'
 */
export async function judgeFalseSuccess(
  text: string,
  rubric: Rubric,
  llmClient: JudgeClient,
  modelId = 'claude-3-5-sonnet-20241022',
): Promise<JudgeVerdict> {
  // 1. buildJudgePrompt: 프롬프트 생성 (zod 검증 포함, 빈 text/유효하지 않은 rubric 시 throw)
  const judgePrompt = buildJudgePrompt(text, rubric)

  // 2. JudgeRequest 구성
  const req: JudgeRequest = {
    kind: 'false_success',
    cacheableBlock: judgePrompt.systemBlock,
    volatileBlock: judgePrompt.volatileBlock,
    modelId,
    temperature: 0.4,
  }

  // 3. llmClient.judge() 호출 (fail-closed: 실패 시 예외 그대로 전파)
  const verdict = await llmClient.judge(req)

  // 4. 반환 (JudgeVerdict는 이미 contracts.ts 정본 타입)
  return verdict
}

// ── 원시 LLM 응답 처리 변형 ───────────────────────────────────────────────────

/**
 * 원시 LLM 응답 문자열(JSON)을 받아 false_success 판정을 수행하는 변형 함수.
 *
 * 실제 LLM API가 raw JSON 문자열을 반환하는 경우에 사용한다.
 * MockJudgeClient는 이미 파싱된 JudgeVerdict를 반환하므로 이 함수가 필요 없다.
 *
 * 전체 흐름:
 *   1. buildJudgePrompt(text, rubric) → JudgePrompt
 *   2. rawResponse(raw JSON string) → parseJudgeResponse(raw) → JudgeVerdict
 *
 * BLOCKER C1/C2: parseJudgeResponse가 zod 검증 수행.
 *
 * @param text        판정 대상 정규화 텍스트
 * @param rubric      false_success 판정용 루브릭
 * @param rawResponse LLM이 반환한 원시 JSON 문자열
 * @returns           파싱·검증된 JudgeVerdict
 *
 * @throws {JudgeParseError} rawResponse 파싱 실패 시
 */
export function judgeFalseSuccessFromRaw(
  text: string,
  rubric: Rubric,
  rawResponse: string,
): JudgeVerdict {
  // 1. buildJudgePrompt: 입력 검증 수행 (사용하지 않지만 검증 목적으로 호출)
  buildJudgePrompt(text, rubric)

  // 2. parseJudgeResponse: 원시 LLM 응답 파싱 + zod 검증
  return parseJudgeResponse(rawResponse)
}
