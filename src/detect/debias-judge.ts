/**
 * src/detect/debias-judge.ts
 *
 * Sub-AC 5d-1: debias_judge_call — judge 편향완화 래퍼.
 *
 * SPEC §5: position swap + self-consistency N개 표본 다수결.
 * judge_fn을 n_samples회 동일 입력으로 호출하여 RawSample을 수집하고,
 * majorityVote로 대표 JudgeVerdict를 반환한다.
 *
 * 설계 원칙:
 *   - 외부 API 절대 미호출: judge_fn은 JudgeClient 인터페이스를 통해서만 호출.
 *   - 불변성: 입력 text·rubric·llm_client를 변경하지 않는다.
 *   - fail-closed: judge_fn 실패 시 예외를 그대로 throw.
 *   - n_samples < 1이면 즉시 majorityVote([]) 반환 (빈 배열 → none, confidence=0).
 *   - console.log 금지.
 *
 * BLOCKER C1: JudgeVerdict.kind는 'thrashing' | 'false_success' | 'none'.
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본. 이 파일에서 재정의 금지.
 */

import type { JudgeVerdict } from '../contracts.js'
import type { JudgeClient } from '../api/judge-client.js'
import type { Rubric } from './false-success-rubric.js'
import { majorityVote, type RawSample } from './semantic-stage.js'

// ── 공개 타입 ──────────────────────────────────────────────────────────────────

/**
 * debias_judge_call에 주입되는 judge 함수 타입.
 *
 * 시그니처: (text, rubric, llm_client) → Promise<JudgeVerdict>
 * 실제 구현: judgeFalseSuccess 또는 테스트용 Mock 함수.
 */
export type JudgeFn = (
  text: string,
  rubric: Rubric,
  llmClient: JudgeClient,
) => Promise<JudgeVerdict>

// ── 핵심 함수 ──────────────────────────────────────────────────────────────────

/**
 * judge 편향완화 래퍼 — judge_fn을 n_samples회 동일 입력으로 호출하고
 * self-consistency 다수결로 대표 JudgeVerdict를 반환한다.
 *
 * SPEC §5 self-consistency:
 *   1. judge_fn을 n_samples회 호출하여 RawSample[] 수집.
 *   2. majorityVote(samples)로 다수결 JudgeVerdict 산출.
 *   3. rawSamples에 N개 응답 전체를 보존 (감사용).
 *
 * 제약:
 *   - judge_fn은 동일 (text, rubric, llm_client) 인수로 매번 호출된다.
 *   - n_samples < 1이면 judge_fn 미호출, majorityVote([]) 반환.
 *   - 실패 시 예외를 그대로 throw (fail-closed, 호출자가 처리).
 *   - 입력 text·rubric·llm_client를 변경하지 않는다 (불변성).
 *   - 호출 순서 보존: rawSamples는 호출 순서와 동일.
 *
 * @param judge_fn   judge 함수 (judgeFalseSuccess 또는 Mock)
 * @param text       판정 대상 정규화 텍스트
 * @param rubric     false_success 판정용 루브릭
 * @param llm_client JudgeClient 구현 (MockJudgeClient 또는 AnthropicJudgeClient)
 * @param n_samples  호출 횟수 (self-consistency 표본 수, 기본 2)
 * @returns          다수결 JudgeVerdict (rawSamples에 N개 응답 보존)
 *
 * @throws {Error}  judge_fn 호출 실패 시 (fail-closed)
 *
 * @example
 * import { judgeFalseSuccess } from './judge-false-success.js'
 * import { buildFalseSuccessRubric } from './false-success-rubric.js'
 *
 * const rubric = buildFalseSuccessRubric()
 * const verdict = await debiasJudgeCall(
 *   judgeFalseSuccess,
 *   '작업이 완료되었습니다.',
 *   rubric,
 *   mockClient,
 *   2,
 * )
 * // verdict.rawSamples.length === 2
 * // verdict.kind: 다수결로 선택된 kind
 */
export async function debiasJudgeCall(
  judge_fn: JudgeFn,
  text: string,
  rubric: Rubric,
  llm_client: JudgeClient,
  n_samples = 2,
): Promise<JudgeVerdict> {
  if (n_samples < 1) {
    return majorityVote([])
  }

  const samples: RawSample[] = []
  for (let i = 0; i < n_samples; i++) {
    // 동일 인수로 n_samples회 독립 호출 (fail-closed: 실패 시 throw)
    const verdict = await judge_fn(text, rubric, llm_client)
    samples.push(verdict)
  }

  return majorityVote(samples)
}
