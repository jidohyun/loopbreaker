/**
 * src/detect/run-judge-stage.ts
 *
 * Sub-AC 5e: `runJudgeStage(candidate, judgeClient, n)` — integration of 5a–5d.
 *
 * M3 judge 단계 진입점:
 *   - 게이트 미통과(gate_passed=false) → null 즉시 반환 (judge 미호출, 비용 게이트).
 *   - 게이트 통과(gate_passed=true)  → collectNSamples(n회 × position-swap 쌍)
 *     + majorityVote → JudgeVerdict(rawSamples 포함) 반환.
 *
 * SPEC §4: "judge는 구조 게이트 통과분에만 호출(비용 최소화).
 *           게이트 미통과 이벤트는 judge에 도달하지 않는다."
 *
 * SPEC §5 편향완화:
 *   - position swap: buildPositionSwappedPairs(candidate, judgeClient, ctx)로
 *     원본(A→A, B→B) + swap(B→A, A→B) 쌍 수집.
 *   - self-consistency: n회 반복 → rawSamples.length === n × 2.
 *   - majorityVote: 홀수 n 강제(호출자 책임), 다수결 JudgeVerdict 반환.
 *
 * 설계 원칙:
 *   - 외부 API 절대 미호출: JudgeClient 인터페이스를 통해서만 호출.
 *   - 불변성: 입력 candidate·ctx를 변경하지 않는다.
 *   - fail-closed: judgeClient 실패 시 예외를 그대로 throw.
 *   - console.log 금지.
 *
 * BLOCKER C1: JudgeVerdict.kind는 'thrashing' | 'false_success' | 'none'.
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본.
 */

import type { JudgeVerdict } from '../contracts.js'
import type { JudgeClient } from '../api/judge-client.js'
import type { GateCandidate } from './filter-gate-passed.js'
import type { PositionSwapContext } from './build-position-swapped-pairs.js'
import { collectNSamples } from './collect-n-samples.js'
import { majorityVote } from './semantic-stage.js'

// ── 공개 타입 ──────────────────────────────────────────────────────────────────

/**
 * runJudgeStage 반환 타입.
 *
 * skipped=true: gate_passed=false인 후보 → judge 미호출.
 * verdict:      gate_passed=true인 후보의 majorityVote 결과 (rawSamples 포함).
 */
export interface JudgeStageResult {
  /** 게이트 미통과로 judge를 건너뛴 경우 true */
  readonly skipped: boolean
  /**
   * 게이트 통과분에 대한 judge 판정 결과.
   * skipped=true이면 undefined.
   * rawSamples에 n×2개 응답이 보존된다.
   */
  readonly verdict?: JudgeVerdict
  /** judge를 호출한 대상 후보 (참조 추적용) */
  readonly candidate: GateCandidate
}

// ── 핵심 함수 ──────────────────────────────────────────────────────────────────

/**
 * gate-passed 후보 1건에 대해 judge 단계 전체를 실행한다.
 *
 * 동작:
 *   1. candidate.gate_passed=false → { skipped: true, candidate } 즉시 반환.
 *   2. candidate.gate_passed=true  →
 *      a. collectNSamples(candidate, judgeClient, ctx, n): n×2개 RawSample 수집.
 *      b. majorityVote(rawSamples): 다수결 JudgeVerdict 산출.
 *      c. { skipped: false, verdict, candidate } 반환.
 *
 * 제약:
 *   - 외부 API 절대 미호출: judgeClient는 JudgeClient 인터페이스를 통해서만 호출.
 *   - 불변성: 입력 candidate·ctx를 변경하지 않는다.
 *   - fail-closed: collectNSamples/judgeClient 실패 시 예외를 그대로 throw.
 *   - 홀수 n 강제 책임은 호출자(DetectorConfig.judgeSelfConsistency).
 *
 * @param candidate   구조 게이트 후보 (gate_passed 혼재 허용)
 * @param judgeClient JudgeClient 구현 (MockJudgeClient 또는 AnthropicJudgeClient)
 * @param ctx         judge 호출 컨텍스트 (positionA, positionB, cacheableBlock, modelId, kind)
 * @param n           self-consistency 반복 횟수 (n×2개 rawSamples 생성)
 * @returns JudgeStageResult — 게이트 미통과 시 skipped=true, 통과 시 verdict 포함
 * @throws {Error} collectNSamples 실패 시 (fail-closed)
 */
export async function runJudgeStage(
  candidate: GateCandidate,
  judgeClient: JudgeClient,
  ctx: PositionSwapContext,
  n: number,
): Promise<JudgeStageResult> {
  // 게이트 미통과 → 즉시 건너뜀 (비용 게이트, SPEC §4)
  if (!candidate.gate_passed) {
    return { skipped: true, candidate }
  }

  // 게이트 통과 → position-swap 포함 n×2개 샘플 수집 (SPEC §5)
  // fail-closed: collectNSamples 실패 시 예외 그대로 throw
  const rawSamples = await collectNSamples(candidate, judgeClient, ctx, n)

  // 다수결 JudgeVerdict 산출 (rawSamples 전체 보존)
  const verdict = majorityVote(rawSamples)

  return { skipped: false, verdict, candidate }
}
