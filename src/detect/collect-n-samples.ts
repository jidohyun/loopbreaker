/**
 * src/detect/collect-n-samples.ts
 *
 * Sub-AC 5c: `collectNSamples(candidate, judgeClient, ctx, n)`
 *
 * gate-passed 후보 1건에 대해 `buildPositionSwappedPairs`를 n회 호출하고,
 * 각 호출에서 나온 { original, swapped } 두 응답을 flat하게 누적하여
 * 총 n×2개의 RawSample 배열을 반환한다.
 *
 * SPEC §5 self-consistency + position swap 편향완화:
 *   - 각 반복마다 buildPositionSwappedPairs를 1회 호출 → 2개 RawSample.
 *   - n회 반복 → rawSamples.length === n × 2.
 *   - n < 1이면 즉시 빈 배열 반환 (client 미호출).
 *   - 홀수 n 강제 책임은 호출자(DetectorConfig.judgeSelfConsistency).
 *
 * 설계 원칙:
 *   - 외부 API 절대 미호출: JudgeClient 인터페이스를 통해서만 호출.
 *   - 불변성: 입력 candidate·ctx를 변경하지 않는다.
 *   - fail-closed: buildPositionSwappedPairs 실패 시 예외를 그대로 throw.
 *   - console.log 금지.
 *
 * BLOCKER C1: JudgeVerdict.kind는 'thrashing' | 'false_success' | 'none'.
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본.
 */

import type { JudgeVerdict } from '../contracts.js'
import type { JudgeClient } from '../api/judge-client.js'
import type { GateCandidate } from './filter-gate-passed.js'
import {
  buildPositionSwappedPairs,
  type PositionSwapContext,
} from './build-position-swapped-pairs.js'

/**
 * gate-passed 후보 1건에 대해 `buildPositionSwappedPairs`를 n회 호출하고,
 * 각 쌍의 { original, swapped }을 flat하게 누적하여 n×2개의 JudgeVerdict 배열을 반환한다.
 *
 * SPEC §5 self-consistency:
 *   1. n < 1이면 즉시 빈 배열 반환 (buildPositionSwappedPairs 미호출).
 *   2. buildPositionSwappedPairs를 n회 순차 호출.
 *   3. 각 호출에서 { original, swapped }를 [original, swapped] 순서로 누적.
 *   4. 총 n×2개의 JudgeVerdict 배열을 반환.
 *
 * 제약:
 *   - 외부 API 절대 미호출: judgeClient는 JudgeClient 인터페이스를 통해서만 호출.
 *   - 불변성: 입력 candidate·ctx를 변경하지 않는다.
 *   - fail-closed: buildPositionSwappedPairs 실패 시 예외를 그대로 throw (호출자가 처리).
 *   - 호출 순서 보존: 결과 배열은 [pair0.original, pair0.swapped, pair1.original, pair1.swapped, ...].
 *
 * @param candidate   구조 게이트 후보 (gate_passed=true이어야 함)
 * @param judgeClient JudgeClient 구현 (MockJudgeClient 또는 AnthropicJudgeClient)
 * @param ctx         judge 호출 컨텍스트 (positionA, positionB, cacheableBlock, modelId, kind)
 * @param n           반복 횟수 (self-consistency 표본 쌍 수). n×2개의 RawSample을 반환.
 * @returns           n×2개의 JudgeVerdict 배열 (호출 순서 보존)
 * @throws {JudgeGateNotPassedError} candidate.gate_passed=false일 때
 * @throws {Error}    buildPositionSwappedPairs 실패 시 (fail-closed)
 */
export async function collectNSamples(
  candidate: GateCandidate,
  judgeClient: JudgeClient,
  ctx: PositionSwapContext,
  n: number,
): Promise<JudgeVerdict[]> {
  if (n < 1) {
    return []
  }

  const samples: JudgeVerdict[] = []

  for (let i = 0; i < n; i++) {
    // 각 반복마다 buildPositionSwappedPairs를 1회 호출 → 2개 RawSample
    const pair = await buildPositionSwappedPairs(candidate, judgeClient, ctx)
    // [original, swapped] 순서로 flat하게 누적
    samples.push(pair.original, pair.swapped)
  }

  return samples
}
