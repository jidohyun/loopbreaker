/**
 * src/eval/mine-candidates.ts
 *
 * M6 평가 하니스 — 후보 추출 (구조 신호 전용, judge 0).
 *
 * 흐름:
 *   NormalizedEvent[] → runStructuralGateOverEvents(구조 게이트, LLM 0) → DetectionHit[]
 *   → CandidateSignal[] (thrashing/false_success 후보, 라벨링 입력용)
 *
 * thrashingScore:
 *   예측 windowRefs 집합과 골드 span(startUuid~endUuid) 집합의 IoU를 계산해
 *   탐지 강도 점수(0~1)를 반환한다.
 *   SPEC §5 매칭 규칙: pred 윈도(gate.windowRefs) ∩ gold span / ∪, IoU >= 0.5 → TP.
 *
 * ⚠️ 부수효과 완전 격리:
 *   - 이 모듈 자체는 FS/API/DB 접근 없음.
 *   - 실 마이닝은 src/eval/cli/mine-real-sessions.ts (MANUAL-ONLY) 에서만.
 *   - 테스트는 합성 픽스처 + 임시 DB만 사용.
 *
 * 설계 원칙:
 *   - LLM 호출 0, 결정론적
 *   - 불변성: 새 객체 반환, 입력 변경 금지
 *   - console.log 금지
 *   - 파일 200~400줄 목표
 */

import type { DetectorConfig } from '../contracts.js'
import type { StoredEvent } from '../ingest/event-store.js'
import type { CandidateSignal } from './eval-contracts.js'
import { runStructuralGateOverEvents } from '../detect/detection-pipeline.js'
import { detectFalseSuccessPatterns } from '../detect/false-success-patterns.js'

// ─── IoU 유틸리티 ─────────────────────────────────────────────────────────────

/**
 * 두 UUID 집합의 IoU (Intersection over Union) 를 계산한다.
 *
 * SPEC §5 thrashing 매칭 규칙:
 *   pred 윈도(gate.windowRefs 이벤트집합) ∩ gold span(start_uuid~end_uuid) / ∪
 *   IoU >= τ(0.5) → TP.
 *
 * @param predRefs  예측 windowRefs UUID 집합
 * @param goldSpan  골드 span UUID 집합 (start_uuid~end_uuid 범위 이벤트 UUIDs)
 * @returns IoU 점수 (0~1). 양 집합 모두 비어있으면 0 반환.
 */
export function computeIoU(
  predRefs: ReadonlySet<string>,
  goldSpan: ReadonlySet<string>,
): number {
  if (predRefs.size === 0 && goldSpan.size === 0) return 0
  if (predRefs.size === 0 || goldSpan.size === 0) return 0

  let intersectionCount = 0
  for (const uuid of predRefs) {
    if (goldSpan.has(uuid)) intersectionCount++
  }

  const unionCount = predRefs.size + goldSpan.size - intersectionCount
  return unionCount === 0 ? 0 : intersectionCount / unionCount
}

// ─── thrashingScore ───────────────────────────────────────────────────────────

/**
 * thrashingScore — 이벤트 시퀀스에서 구조 게이트를 실행하고
 * 게이트 발화분 중 골드 span과의 최대 IoU 점수를 반환한다.
 *
 * Sub-AC 6a 핵심 함수:
 *   events → 구조 게이트 → DetectionHit[].windowRefs 집합들
 *   → 각 hit와 goldSpanUuids 사이의 IoU 계산
 *   → 최댓값 반환 (0~1, 게이트 미발화 시 0)
 *
 * SPEC §5 IoU 매칭:
 *   τ = 0.5 확정. IoU >= τ → TP (이 함수는 점수만 계산, TP 판정은 computeMetrics).
 *
 * @param events        세션 이벤트 배열 (정렬됨, NormalizedEvent as StoredEvent)
 * @param goldSpanUuids 골드 span UUID 배열 (start_uuid~end_uuid 범위의 이벤트 UUIDs)
 * @param config        DetectorConfig (임계값 주입)
 * @returns             최대 IoU 점수 (0~1). 게이트 미발화 or 골드스팬 없으면 0.
 */
export function thrashingScore(
  events: readonly StoredEvent[],
  goldSpanUuids: readonly string[],
  config: DetectorConfig,
): number {
  if (goldSpanUuids.length === 0) return 0

  // 구조 게이트 실행 (LLM 0, 결정론적)
  const hits = runStructuralGateOverEvents(events, config)
  if (hits.length === 0) return 0

  const goldSet = new Set(goldSpanUuids)

  // 각 hit의 windowRefs와 goldSpan 사이의 IoU 계산 → 최댓값
  let maxIoU = 0
  for (const hit of hits) {
    const predSet = new Set(hit.gate.windowRefs)
    const iou = computeIoU(predSet, goldSet)
    if (iou > maxIoU) maxIoU = iou
  }

  return maxIoU
}

// ─── falseSuccessScore ────────────────────────────────────────────────────────

/**
 * falseSuccessScore — anchor 이벤트 ±k 윈도 내에서 가짜성공(false_success) 패턴을
 * 감지하고 0~1 범위의 점수를 계산한다.
 *
 * Sub-AC 6b-2 핵심 함수:
 *   events[anchorIndex−k .. anchorIndex+k] 범위 이벤트를 추출해
 *   각 이벤트의 text 필드에 detectFalseSuccessPatterns를 적용한다.
 *   패턴이 하나 이상 발견된 이벤트 수 / 윈도 크기 = 패턴 밀도 점수(0~1).
 *
 * SPEC §5 false_success 매칭: anchor ±k 이벤트 매칭 (k=5 확정).
 *
 * 특성:
 *   - 순수 함수: 입력 외 외부 상태/API/DB 접근 없음. LLM 호출 0.
 *   - 불변성: 입력 배열 변경 금지.
 *   - anchorUuid가 events 내 없으면 0 반환.
 *   - 윈도 내 text가 없는 이벤트(tool_use 등)는 패턴 없음으로 처리.
 *
 * @param events      세션 이벤트 배열 (정렬됨)
 * @param anchorUuid  기준 이벤트 UUID
 * @param k           윈도 반경 (±k, 기본 5). SPEC §5 확정값.
 * @returns           패턴 밀도 점수 (0~1). 패턴 없음 = 0, 전부 패턴 = 1.
 *
 * @example
 * // 완료선언 텍스트를 포함한 이벤트가 윈도의 절반 → 0.5
 * falseSuccessScore(events, anchorUuid, 5)
 */
export function falseSuccessScore(
  events: readonly StoredEvent[],
  anchorUuid: string,
  k = 5,
): number {
  if (events.length === 0 || anchorUuid.length === 0) return 0

  // anchor 인덱스 탐색
  const anchorIndex = events.findIndex(ev => ev.uuid === anchorUuid)
  if (anchorIndex === -1) return 0

  // ±k 윈도 추출 (범위 클램핑)
  const start = Math.max(0, anchorIndex - k)
  const end = Math.min(events.length - 1, anchorIndex + k)
  const window = events.slice(start, end + 1)

  if (window.length === 0) return 0

  // 각 이벤트 text에 대해 false success 패턴 감지
  let patternCount = 0
  for (const ev of window) {
    const text = ev.text ?? ''
    if (text.trim().length > 0 && detectFalseSuccessPatterns(text).length > 0) {
      patternCount++
    }
  }

  // 패턴 밀도 = 패턴 발견 이벤트 수 / 윈도 크기
  return patternCount / window.length
}

// ─── mineCandidates ───────────────────────────────────────────────────────────

/**
 * 이벤트 시퀀스에서 구조 신호 후보를 추출한다.
 *
 * SPEC §6 후보 추출 규칙:
 *   - 구조 게이트 신호만 사용 (judge 0, LLM 호출 없음)
 *   - thrashing/false_success 후보를 CandidateSignal로 변환
 *   - 라벨링 입력으로 사용할 수 있는 형태로 반환
 *
 * ⚠️ judge 호출 없음 — 구조 신호만으로 후보 추출.
 * ⚠️ 실 마이닝 부수효과(FS/API 접근) 없음 — 이벤트 배열만 처리.
 *
 * @param events      세션 이벤트 배열 (정렬됨)
 * @param sessionId   세션 ID
 * @param config      DetectorConfig
 * @param minedAt     추출 시각 (epoch ms)
 * @returns           CandidateSignal 배열
 */
export function mineCandidates(
  events: readonly StoredEvent[],
  sessionId: string,
  config: DetectorConfig,
  minedAt: number,
): readonly CandidateSignal[] {
  // 구조 게이트 실행 (LLM 0)
  const hits = runStructuralGateOverEvents(events, config)

  return Object.freeze(
    hits.map((hit, index) => {
      const gate = hit.gate

      // thrashing은 span 라벨 (windowRefs로 start/end 추정)
      const windowRefs = gate.windowRefs
      const startUuid = windowRefs[0]
      const endUuid = windowRefs[windowRefs.length - 1]

      const candidate: CandidateSignal = Object.freeze({
        candidateId: `candidate-${sessionId}-${index}-${hit.triggerUuid}`,
        sessionId,
        kind: gate.type, // 'thrashing' | 'false_success'
        subtype: gate.subtype,
        anchorUuid: gate.type === 'false_success' ? hit.triggerUuid : undefined,
        startUuid: gate.type === 'thrashing' ? startUuid : undefined,
        endUuid: gate.type === 'thrashing' ? endUuid : undefined,
        windowRefs: [...windowRefs],
        severity: gate.severity,
        metrics: { ...gate.metrics },
        minedAt,
      })

      return candidate
    }),
  )
}
