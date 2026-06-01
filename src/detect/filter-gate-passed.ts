/**
 * src/detect/filter-gate-passed.ts
 *
 * Sub-AC 5a: filterGatePassed — 구조 게이트 통과분 필터 순수 함수.
 *
 * M3 파이프라인에서 의미 판정(STAGE 2)과 judge는 구조 게이트를 통과한
 * 후보(gate_passed=true)에만 호출된다. 이 파일은 후보 목록에서
 * 게이트 통과분만 추출하는 순수 함수를 제공한다.
 *
 * 설계 원칙:
 *   - 순수 함수 (입력 불변, 부작용 없음)
 *   - 입력 배열을 변형하지 않음 (새 배열 반환)
 *   - 외부 API 호출 없음
 */

import type { StructureGateResult } from '../contracts.js'

/**
 * 구조 게이트 후보.
 * gate_passed=true인 항목만 의미 판정과 judge 단계로 진행한다.
 *
 * 설계:
 *   - gate_passed=true: 구조 게이트 발화 → STAGE 2(임베딩) 대상
 *   - gate_passed=false: 구조 게이트 미통과 → 파이프라인에서 제외
 */
export interface GateCandidate {
  /** 구조 게이트 결과 (gate_passed=true일 때만 의미 있음) */
  readonly gate: StructureGateResult | null
  /** 게이트 통과 여부 */
  readonly gate_passed: boolean
  /** 발화를 일으킨 이벤트 uuid */
  readonly triggerUuid: string
  /** 발화 시각 (트리거 이벤트 ts) */
  readonly ts: number
}

/**
 * 후보 목록에서 구조 게이트 통과분(gate_passed=true)만 필터링한다.
 *
 * SPEC §4: "judge는 구조 게이트 통과분에만 호출(비용 최소화).
 *           게이트 미통과 이벤트는 judge에 도달하지 않는다."
 *
 * @param candidates 게이트 후보 목록 (gate_passed 혼재)
 * @returns gate_passed=true인 항목만 포함한 새 배열 (원본 불변)
 */
export function filterGatePassed(candidates: readonly GateCandidate[]): readonly GateCandidate[] {
  return candidates.filter(c => c.gate_passed === true)
}
