// src/eval/metrics.ts
// M6 평가 메트릭 — 혼동행렬·Wilson 신뢰구간 등 통계 함수.
//
// 규칙:
//   - 새 npm 의존성 추가 금지 (직접 구현).
//   - console.log 금지.
//   - 불변성 (새 객체 생성, 뮤테이션 금지).

import type {
  DetectionKind,
  GoldLabel,
  GoldLabelSource,
  GoldSetSummary,
  EvalMetricsResult,
  PerClassMetric,
} from './eval-contracts.js'

// ---- false_success 매칭 (anchor±k) ----

/**
 * false_success 매칭 규칙 입력.
 * SPEC §5: gold↔pred를 anchorUuid join, anchor±k 이내 = TP.
 */
export interface FalseSuccessMatchInput {
  /**
   * 세션 내 이벤트 UUID 순서 배열.
   * 정렬 기준: ts → parentUuid 위상 → byteOffset (NormalizedEvent 동일 정렬기).
   * 세션 경계를 나타내는 단일 세션의 uuid 시퀀스여야 한다.
   */
  orderedUuids: readonly string[]
  /** 세션 ID (gold 기준) */
  goldSessionId: string
  /** 세션 ID (pred 기준) */
  predSessionId: string
  /** gold anchor 이벤트 UUID */
  goldAnchorUuid: string
  /** pred anchor 이벤트 UUID */
  predAnchorUuid: string
  /**
   * 매칭 허용 범위 k (기본 5).
   * |pred_position − gold_position| <= k 이면 TP.
   * SPEC §5 확정값: k=5.
   */
  k?: number
}

/**
 * false_success 매칭 결과.
 */
export interface FalseSuccessMatchResult {
  /** true이면 TP (anchor±k 이내에서 매칭) */
  matched: boolean
  /**
   * 세션 경계를 넘는 매칭 여부.
   * goldSessionId !== predSessionId이면 true — 항상 matched=false.
   * SPEC §5: 세션 경계 넘는 매칭은 cross_session 플래그로 제외.
   */
  crossSession: boolean
  /** gold anchor의 orderedUuids 내 위치 (미발견이면 -1) */
  goldPosition: number
  /** pred anchor의 orderedUuids 내 위치 (미발견이면 -1) */
  predPosition: number
  /** |pred_position − gold_position| (crossSession 또는 미발견이면 undefined) */
  positionDelta?: number
  /** 실제 적용된 k값 */
  k: number
}

/**
 * false_success anchor±k 매칭 함수.
 *
 * SPEC §5 정본:
 *   false_success = anchor±k 매칭.
 *   |pred.anchorUuid 위치 − gold.anchorUuid 위치| <= k(=5) 이면 TP.
 *   동일 세션 내에서만 유효.
 *   세션 경계 넘는 매칭은 cross_session 플래그로 제외.
 *
 * 탐지 미발화(pred anchor 없음):
 *   predAnchorUuid가 orderedUuids에 없으면 predPosition=-1, matched=false.
 *
 * 불변성: 입력 배열 수정 없음, 새 객체 반환.
 *
 * @param input  FalseSuccessMatchInput
 * @returns      FalseSuccessMatchResult
 */
export function matchFalseSuccess(input: FalseSuccessMatchInput): FalseSuccessMatchResult {
  const k = input.k ?? 5

  // 1. 세션 경계 검사
  if (input.goldSessionId !== input.predSessionId) {
    return {
      matched: false,
      crossSession: true,
      goldPosition: -1,
      predPosition: -1,
      positionDelta: undefined,
      k,
    }
  }

  // 2. anchor 위치 조회
  const goldPosition = input.orderedUuids.indexOf(input.goldAnchorUuid)
  const predPosition = input.orderedUuids.indexOf(input.predAnchorUuid)

  // 3. anchor 미발견 처리
  if (goldPosition === -1 || predPosition === -1) {
    return {
      matched: false,
      crossSession: false,
      goldPosition,
      predPosition,
      positionDelta: undefined,
      k,
    }
  }

  // 4. ±k 범위 판정
  const positionDelta = Math.abs(predPosition - goldPosition)
  const matched = positionDelta <= k

  return {
    matched,
    crossSession: false,
    goldPosition,
    predPosition,
    positionDelta,
    k,
  }
}

// ---- 혼동행렬 타입 ----

/**
 * 단일 클래스(OvR)에 대한 이진 혼동행렬 셀.
 * OvR(One-vs-Rest): 해당 클래스를 Positive로, 나머지를 Negative로 간주.
 */
export interface ConfusionCell {
  /** True Positive: gold=kind, pred=kind */
  tp: number
  /** False Positive: gold≠kind, pred=kind */
  fp: number
  /** False Negative: gold=kind, pred≠kind */
  fn: number
  /** True Negative: gold≠kind, pred≠kind */
  tn: number
}

/**
 * 전체 혼동행렬.
 * 각 클래스별 OvR 이진 혼동행렬 셀을 포함.
 *
 * BLOCKER C1: DetectionKind = 'thrashing' | 'false_success' | 'none'
 */
export interface ConfusionMatrix {
  /** 클래스별 OvR 혼동행렬 */
  perClass: Record<DetectionKind, ConfusionCell>
  /**
   * 전체 멀티클래스 혼동행렬 (행=gold, 열=pred).
   * confusionRaw[goldKind][predKind] = 건수.
   */
  confusionRaw: Record<DetectionKind, Record<DetectionKind, number>>
  /** 평가에 사용된 총 샘플 수 */
  totalSamples: number
}

// 평가에 사용하는 DetectionKind 전체 목록 (고정 순서)
const ALL_KINDS: readonly DetectionKind[] = ['thrashing', 'false_success', 'none'] as const

/**
 * 골드 라벨과 예측 라벨 쌍으로부터 혼동행렬을 계산한다.
 *
 * 규칙:
 *  - gold/pred 배열 길이가 같아야 한다 (다르면 RangeError).
 *  - 빈 배열은 허용 (TP=FP=FN=TN=0).
 *  - 탐지 미발화(구조게이트 미통과) = pred 'none'으로 처리.
 *  - 불변성: 입력 배열 수정 없음, 새 객체 반환.
 *
 * @param gold  골드 라벨 배열 (DetectionKind[])
 * @param pred  예측 라벨 배열 (DetectionKind[]) — 동일 인덱스가 쌍
 * @returns     ConfusionMatrix
 * @throws      RangeError if gold.length !== pred.length
 */
export function buildConfusionMatrix(
  gold: readonly DetectionKind[],
  pred: readonly DetectionKind[],
): ConfusionMatrix {
  if (gold.length !== pred.length) {
    throw new RangeError(
      `buildConfusionMatrix: gold.length (${gold.length}) !== pred.length (${pred.length})`,
    )
  }

  // 멀티클래스 원시 혼동행렬 초기화
  const raw = Object.fromEntries(
    ALL_KINDS.map((g) => [
      g,
      Object.fromEntries(ALL_KINDS.map((p) => [p, 0])) as Record<DetectionKind, number>,
    ]),
  ) as Record<DetectionKind, Record<DetectionKind, number>>

  // 집계
  for (let i = 0; i < gold.length; i++) {
    const g = gold[i]!
    const p = pred[i]!
    raw[g][p] = (raw[g][p] ?? 0) + 1
  }

  // OvR 이진 혼동행렬 산출
  const perClass = Object.fromEntries(
    ALL_KINDS.map((kind): [DetectionKind, ConfusionCell] => {
      let tp = 0
      let fp = 0
      let fn = 0
      let tn = 0

      for (const g of ALL_KINDS) {
        for (const p of ALL_KINDS) {
          const count = raw[g][p] ?? 0
          const goldPos = g === kind
          const predPos = p === kind

          if (goldPos && predPos) tp += count
          else if (!goldPos && predPos) fp += count
          else if (goldPos && !predPos) fn += count
          else tn += count
        }
      }

      return [kind, { tp, fp, fn, tn }]
    }),
  ) as Record<DetectionKind, ConfusionCell>

  return {
    perClass,
    confusionRaw: raw,
    totalSamples: gold.length,
  }
}

// ---- 미발화(none) 예측 규칙 ----

/**
 * 탐지 미발화(none) 예측 해소 입력.
 *
 * SPEC §5: 탐지 미발화(구조게이트 미통과) = predByAnchor.get(uuid) ?? 'none'.
 * anchor uuid를 기준으로 pred 결과를 조회하고, 없으면 'none'으로 간주한다.
 */
export interface ResolveNonePredictionInput {
  /**
   * gold anchor uuid — gold 라벨의 anchorUuid (false_success 점 라벨) 또는
   * span 라벨의 대표 uuid.
   * null이면 gold=none 케이스(anchor 없음).
   */
  goldAnchorUuid: string | null
  /**
   * pred 결과 맵. anchor uuid → DetectionKind.
   * 탐지 파이프라인이 발화한 anchor uuid에 대해 DetectionKind를 보유한다.
   * 미발화 anchor는 이 맵에 없다.
   */
  predByAnchor: ReadonlyMap<string, DetectionKind>
  /**
   * gold 라벨의 기대 신호.
   * 'none'이면 gold=none 케이스.
   */
  goldKind: DetectionKind
}

/**
 * 탐지 미발화(none) 예측 해소 결과.
 */
export interface ResolveNonePredictionResult {
  /**
   * 해소된 pred 종류.
   * - anchor 발견 → predByAnchor.get(uuid)
   * - anchor 미발견 (미발화) → 'none'
   */
  predKind: DetectionKind
  /**
   * 미발화(구조게이트 미통과) 여부.
   * predByAnchor에 goldAnchorUuid가 없으면 true.
   */
  isMiss: boolean
  /**
   * 혼동행렬 셀 종류.
   * - gold≠none, pred=gold → TP
   * - gold≠none, pred=none → FN  (미발화)
   * - gold=none,  pred=none → TN
   * - gold=none,  pred≠none → FP  (오탐)
   * - gold≠none, pred≠none, pred≠gold → misclassified (멀티클래스 오분류)
   */
  cellLabel: 'tp' | 'fp' | 'fn' | 'tn' | 'misclassified'
}

/**
 * 탐지 미발화(none) 예측 규칙을 적용해 pred 종류와 혼동행렬 셀을 반환한다.
 *
 * SPEC §5 정본:
 *   탐지 미발화(구조게이트 미통과) = predByAnchor.get(uuid) ?? 'none'.
 *
 * 규칙:
 *   1. goldAnchorUuid가 null (gold=none 케이스):
 *      - predByAnchor에서 해당 anchor로 조회 불가 → predKind='none' (TN)
 *        단, gold=none인데 pred에 이벤트(비none)가 있으면 FP.
 *        이 함수는 gold=none 케이스에서 predKind를 외부에서 주입받는다.
 *        goldAnchorUuid=null이면 predKind='none'으로 고정(TN).
 *      → cellLabel='tn'
 *   2. goldAnchorUuid가 있고 predByAnchor에 발견:
 *      predKind = predByAnchor.get(goldAnchorUuid)
 *      - predKind === goldKind → TP
 *      - predKind !== goldKind → misclassified
 *   3. goldAnchorUuid가 있으나 predByAnchor에 미발견 (미발화):
 *      predKind = 'none'
 *      - goldKind ≠ 'none' → FN
 *      - goldKind = 'none'  → TN (정상 미발화)
 *
 * gold=none인데 pred에 이벤트가 있는 FP는 별도 resolveNonePredictionFp 또는
 * 상위 매칭 로직에서 처리한다(이 함수는 anchor 기반 lookup만 담당).
 *
 * 불변성: 입력 수정 없음, 새 객체 반환.
 *
 * @param input ResolveNonePredictionInput
 * @returns     ResolveNonePredictionResult
 */
export function resolveNonePrediction(
  input: ResolveNonePredictionInput,
): ResolveNonePredictionResult {
  const { goldAnchorUuid, predByAnchor, goldKind } = input

  // case 1: gold anchor 없음 (gold=none 케이스)
  if (goldAnchorUuid === null) {
    return {
      predKind: 'none',
      isMiss: false,
      cellLabel: 'tn',
    }
  }

  // case 2 & 3: anchor 기반 조회
  const found = predByAnchor.get(goldAnchorUuid)

  if (found === undefined) {
    // 미발화 (isMiss=true)
    const cellLabel = goldKind !== 'none' ? 'fn' : 'tn'
    return {
      predKind: 'none',
      isMiss: true,
      cellLabel,
    }
  }

  // 발화됨 — 정확도 판정
  const predKind = found
  let cellLabel: ResolveNonePredictionResult['cellLabel']
  if (predKind === goldKind) {
    cellLabel = 'tp'
  } else if (goldKind === 'none') {
    // gold=none인데 pred가 비none → FP
    cellLabel = 'fp'
  } else {
    // gold≠none, pred≠none, pred≠gold → 멀티클래스 오분류
    cellLabel = 'misclassified'
  }

  return {
    predKind,
    isMiss: false,
    cellLabel,
  }
}

/**
 * gold=none인데 pred에 이벤트가 있는 FP 케이스를 탐지한다.
 *
 * SPEC §5: 탐지 미발화 규칙의 역방향 — pred가 발화했으나 gold가 none인 경우.
 * predByAnchor에서 이벤트를 순회하며 해당 세션의 gold에 매칭되지 않는
 * pred anchor를 찾아 FP로 마킹한다.
 *
 * @param predAnchorsInSession  해당 세션의 pred anchor uuid → kind 맵
 * @param goldAnchorUuidsInSession  해당 세션의 gold anchor uuid 집합
 * @returns  gold에 매칭되지 않는 pred anchor uuid 목록 (FP 후보)
 */
export function findUnmatchedPredAnchors(
  predAnchorsInSession: ReadonlyMap<string, DetectionKind>,
  goldAnchorUuidsInSession: ReadonlySet<string>,
): ReadonlyArray<{ anchorUuid: string; predKind: DetectionKind }> {
  const result: Array<{ anchorUuid: string; predKind: DetectionKind }> = []
  for (const [uuid, kind] of predAnchorsInSession) {
    if (!goldAnchorUuidsInSession.has(uuid)) {
      result.push({ anchorUuid: uuid, predKind: kind })
    }
  }
  return result
}

// ---- thrashing 매칭 (IoU span) ----

/**
 * thrashing IoU span 매칭 입력.
 * SPEC §5: pred 윈도(gate.windowRefs 이벤트집합) ∩ gold span(start_uuid~end_uuid) / ∪,
 *          IoU >= 0.5(τ=0.5 확정) → TP.
 */
export interface ThrashingMatchInput {
  /**
   * 세션 내 이벤트 UUID 순서 배열 (정렬 기준: ts → parentUuid위상 → byteOffset).
   * span 슬라이스 계산 기준.
   */
  orderedUuids: readonly string[]
  /** gold span 시작 이벤트 UUID (inclusive) */
  goldStartUuid: string
  /** gold span 종료 이벤트 UUID (inclusive) */
  goldEndUuid: string
  /**
   * pred 윈도우 이벤트 UUID 집합 (gate.windowRefs 기반).
   * 순서 무관, 집합으로 처리.
   */
  predWindowRefs: readonly string[]
  /**
   * IoU 임계값 (기본 0.5 — SPEC §5 확정값 τ=0.5).
   */
  iouThreshold?: number
  /**
   * 구조신호 이벤트 UUID 집합 (선택).
   *
   * 제공 시 gold span 슬라이스를 이 집합과 교집합하여 pred 윈도우와 같은
   * "구조신호 단위(file_edit/tool_use)"로 정규화한 뒤 IoU를 계산한다.
   *
   * 단위 정합 근거:
   *   gold span = orderedUuids[start..end] 는 user/assistant/tool 등 모든 이벤트를
   *   담는 연속 슬라이스(예: 117개)인 반면, pred 윈도우(gate.windowRefs)는 구조 게이트가
   *   잡은 file_edit tool_use 이벤트만(예: 13개) 담는다. 두 집합의 단위가 달라
   *   IoU가 항상 |fe|/|span| ≈ 0.1 수준으로 떨어져 동일 구간도 매칭 실패한다.
   *   structuralUuids 로 gold span 도 file_edit 단위로 축소하면 동일 구간 IoU ≈ 1.0.
   *
   * 미제공 시(undefined) 기존 동작(전체 슬라이스 기준 IoU)을 그대로 유지한다.
   * → 하위호환: 단위가 이미 일치하는 호출(합성 픽스처 등)은 영향 없음.
   */
  structuralUuids?: ReadonlySet<string>
}

/**
 * thrashing IoU span 매칭 결과.
 */
export interface ThrashingMatchResult {
  /** true이면 TP (IoU >= τ) */
  matched: boolean
  /** 교집합 크기 |pred ∩ gold_span| */
  intersectionSize: number
  /** 합집합 크기 |pred ∪ gold_span| */
  unionSize: number
  /** IoU 값 (unionSize=0이면 0) */
  iou: number
  /** 적용된 IoU 임계값 */
  iouThreshold: number
  /**
   * gold span 내 이벤트 UUID 집합.
   * orderedUuids에서 [goldStartUuid, goldEndUuid] 슬라이스로 결정.
   * start 또는 end가 orderedUuids에 없으면 빈 집합 → matched=false.
   */
  goldSpanUuids: ReadonlySet<string>
}

/**
 * thrashing IoU span 매칭 함수.
 *
 * SPEC §5 정본:
 *   thrashing = IoU span 매칭.
 *   pred 윈도(gate.windowRefs 이벤트집합) ∩ gold span(start_uuid~end_uuid) / ∪.
 *   IoU >= 0.5(τ=0.5 확정) → TP.
 *
 * gold span:
 *   orderedUuids에서 goldStartUuid 위치 ~ goldEndUuid 위치까지의 슬라이스.
 *   start > end이면 역방향으로 간주하지 않고 빈 집합 반환 (matched=false).
 *   start 또는 end가 없으면 빈 집합 반환 (matched=false).
 *
 * pred 윈도우:
 *   predWindowRefs는 gate.windowRefs — 이벤트 UUID 목록, 집합으로 변환.
 *
 * IoU 계산:
 *   intersection = |goldSpanUuids ∩ predWindowSet|
 *   union = |goldSpanUuids ∪ predWindowSet|
 *   iou = union === 0 ? 0 : intersection / union
 *   matched = iou >= τ
 *
 * 불변성: 입력 배열 수정 없음, 새 객체 반환.
 *
 * @param input ThrashingMatchInput
 * @returns     ThrashingMatchResult
 */
export function matchThrashing(input: ThrashingMatchInput): ThrashingMatchResult {
  const τ = input.iouThreshold ?? 0.5

  // 1. gold span 슬라이스 계산
  const startIdx = input.orderedUuids.indexOf(input.goldStartUuid)
  const endIdx = input.orderedUuids.indexOf(input.goldEndUuid)

  if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) {
    return {
      matched: false,
      intersectionSize: 0,
      unionSize: 0,
      iou: 0,
      iouThreshold: τ,
      goldSpanUuids: new Set<string>(),
    }
  }

  // 2. gold span UUID 집합 (inclusive 양쪽 끝)
  //    structuralUuids 제공 시 file_edit 단위로 정규화(pred 윈도우와 단위 정합).
  const spanSlice = input.orderedUuids.slice(startIdx, endIdx + 1)
  const goldSpanUuids = new Set<string>(
    input.structuralUuids === undefined
      ? spanSlice
      : spanSlice.filter((u) => input.structuralUuids!.has(u)),
  )

  // 3. pred 윈도우 UUID 집합
  const predWindowSet = new Set<string>(input.predWindowRefs)

  // 4. 교집합 / 합집합 계산
  let intersectionSize = 0
  for (const uuid of goldSpanUuids) {
    if (predWindowSet.has(uuid)) intersectionSize++
  }
  // union = |gold| + |pred| - |intersection|
  const unionSize = goldSpanUuids.size + predWindowSet.size - intersectionSize

  // 5. IoU 판정
  const iou = unionSize === 0 ? 0 : intersectionSize / unionSize
  const matched = iou >= τ

  return {
    matched,
    intersectionSize,
    unionSize,
    iou,
    iouThreshold: τ,
    goldSpanUuids,
  }
}

// ---- 규칙 통합 — gold/pred 쌍 해소 ----

/**
 * gold 라벨 하나에 대한 pred 매칭 입력.
 * buildPairedLabels에서 사용.
 */
export interface GoldPredPairInput {
  /** gold 라벨 종류 */
  goldKind: DetectionKind
  /**
   * thrashing 전용: gold span 시작 UUID.
   * goldKind='thrashing'이면 필수.
   */
  goldStartUuid?: string
  /**
   * thrashing 전용: gold span 종료 UUID.
   * goldKind='thrashing'이면 필수.
   */
  goldEndUuid?: string
  /**
   * false_success / none 전용: gold anchor UUID.
   * goldKind='false_success'이면 필수.
   * goldKind='none'이면 null.
   */
  goldAnchorUuid?: string | null
  /** 세션 ID (gold 기준) */
  goldSessionId: string
}

/**
 * pred 탐지 결과 하나 (단일 발화).
 */
export interface PredEntry {
  /** pred anchor UUID (false_success용) */
  anchorUuid: string
  /** pred 탐지 종류 */
  kind: DetectionKind
  /** pred 윈도우 이벤트 UUID 목록 (thrashing용 gate.windowRefs) */
  windowRefs: string[]
  /** 세션 ID */
  sessionId: string
  /** 신뢰도 (0~1, 없으면 undefined) */
  confidence?: number
}

/**
 * buildPairedLabels 입력.
 */
export interface BuildPairedLabelsInput {
  /**
   * gold 라벨 목록.
   * 세션 내 전체 gold.
   */
  golds: readonly GoldPredPairInput[]
  /**
   * pred 탐지 결과 목록.
   * 세션 내 전체 pred.
   */
  preds: readonly PredEntry[]
  /**
   * 세션 내 이벤트 UUID 순서 배열.
   * thrashing IoU 및 false_success anchor±k 계산 기준.
   */
  orderedUuids: readonly string[]
  /** 세션 ID */
  sessionId: string
  /**
   * anchor±k 허용 범위 (기본 5).
   * SPEC §5: k=5 확정.
   */
  k?: number
  /**
   * IoU 임계값 (기본 0.5).
   * SPEC §5: τ=0.5 확정.
   */
  iouThreshold?: number
}

/**
 * gold/pred 쌍 해소 결과 — 혼동행렬 입력에 바로 사용 가능.
 */
export interface PairedLabelEntry {
  /** gold 라벨 종류 */
  goldKind: DetectionKind
  /** 해소된 pred 라벨 종류 (미발화이면 'none') */
  predKind: DetectionKind
  /** 매칭 방식 */
  matchMethod: 'iou_span' | 'anchor_k' | 'none_rule' | 'unmatched_pred'
  /** 매칭 여부 */
  matched: boolean
}

/**
 * gold 라벨 목록과 pred 탐지 목록을 매칭 규칙으로 해소하여
 * buildConfusionMatrix에 바로 넣을 수 있는 paired label 배열을 반환한다.
 *
 * 매칭 규칙 (SPEC §5):
 *   thrashing → IoU span 매칭 (τ=0.5):
 *     pred 중 kind='thrashing'이고 gold span과 IoU>=0.5인 첫 pred = TP.
 *     없으면 pred='none' (FN).
 *
 *   false_success → anchor±k 매칭 (k=5):
 *     pred 중 kind='false_success'이고 anchor 위치 차 <=k인 첫 pred = TP.
 *     없으면 pred='none' (FN).
 *     세션 경계 넘는 매칭 제외 (crossSession).
 *
 *   none (gold) → resolveNonePrediction 규칙:
 *     gold anchor=null이면 pred='none' (TN).
 *
 * 매칭된 pred는 소비됨 (다른 gold에 중복 매칭 불가 — greedy 첫 매칭).
 * 매칭되지 않은 pred → FP (gold='none', pred=predKind) 행으로 추가.
 *
 * 불변성: 입력 배열 수정 없음, 새 배열 반환.
 *
 * @param input BuildPairedLabelsInput
 * @returns     PairedLabelEntry[]
 */
export function buildPairedLabels(input: BuildPairedLabelsInput): PairedLabelEntry[] {
  const k = input.k ?? 5
  const τ = input.iouThreshold ?? 0.5
  const { golds, preds, orderedUuids, sessionId } = input

  // pred 소비 추적 (index set)
  const usedPredIndices = new Set<number>()
  const result: PairedLabelEntry[] = []

  // 구조신호 UUID 집합 = 이 세션 thrashing pred 윈도우(file_edit) + gold span 양끝.
  // gold span(연속 전체 슬라이스)을 pred와 같은 file_edit 단위로 정규화하기 위한 기준.
  //
  // gold start/end 도 포함하는 이유:
  //   실 골드셋에서 gold span 양끝(start/end)은 file_edit 이벤트다(구조 후보 마이닝 산출).
  //   pred 윈도우에 없는 gold start/end 까지 structural로 인정해야
  //   ① 동일 구간(start/end가 pred 양끝과 일치) → 정확히 매칭
  //   ② 부분겹침(gold에만 있는 끝 이벤트) → union에 남아 IoU 희석 → FN 유지(과탐 방지).
  // (pred가 없으면 windowRefs 합집합은 비고 gold 끝만 남음 → 교집합 0 → 미매칭.)
  const structuralUuids = new Set<string>()
  for (const pred of preds) {
    if (pred.kind !== 'thrashing') continue
    if (pred.sessionId !== sessionId) continue
    for (const ref of pred.windowRefs) structuralUuids.add(ref)
  }
  for (const gold of golds) {
    if (gold.goldKind !== 'thrashing') continue
    if (gold.goldStartUuid !== undefined) structuralUuids.add(gold.goldStartUuid)
    if (gold.goldEndUuid !== undefined) structuralUuids.add(gold.goldEndUuid)
  }

  // ── gold 라벨 순서대로 매칭 ──
  for (const gold of golds) {
    if (gold.goldKind === 'thrashing') {
      // IoU span 매칭
      const startUuid = gold.goldStartUuid ?? ''
      const endUuid = gold.goldEndUuid ?? ''

      let bestIdx = -1
      let bestIou = -1

      for (let i = 0; i < preds.length; i++) {
        if (usedPredIndices.has(i)) continue
        const pred = preds[i]!
        if (pred.kind !== 'thrashing') continue
        if (pred.sessionId !== sessionId) continue

        const mr = matchThrashing({
          orderedUuids,
          goldStartUuid: startUuid,
          goldEndUuid: endUuid,
          predWindowRefs: pred.windowRefs,
          iouThreshold: τ,
          structuralUuids,
        })
        if (mr.matched && mr.iou > bestIou) {
          bestIou = mr.iou
          bestIdx = i
        }
      }

      if (bestIdx >= 0) {
        usedPredIndices.add(bestIdx)
        result.push({
          goldKind: 'thrashing',
          predKind: 'thrashing',
          matchMethod: 'iou_span',
          matched: true,
        })
      } else {
        result.push({
          goldKind: 'thrashing',
          predKind: 'none',
          matchMethod: 'iou_span',
          matched: false,
        })
      }
    } else if (gold.goldKind === 'false_success') {
      // anchor±k 매칭
      const goldAnchor = gold.goldAnchorUuid ?? null

      let bestIdx = -1
      let bestDelta = Infinity

      for (let i = 0; i < preds.length; i++) {
        if (usedPredIndices.has(i)) continue
        const pred = preds[i]!
        if (pred.kind !== 'false_success') continue

        const mr = matchFalseSuccess({
          orderedUuids,
          goldSessionId: sessionId,
          predSessionId: pred.sessionId,
          goldAnchorUuid: goldAnchor ?? '',
          predAnchorUuid: pred.anchorUuid,
          k,
        })
        if (!mr.crossSession && mr.matched) {
          const delta = mr.positionDelta ?? Infinity
          if (delta < bestDelta) {
            bestDelta = delta
            bestIdx = i
          }
        }
      }

      if (bestIdx >= 0) {
        usedPredIndices.add(bestIdx)
        result.push({
          goldKind: 'false_success',
          predKind: 'false_success',
          matchMethod: 'anchor_k',
          matched: true,
        })
      } else {
        result.push({
          goldKind: 'false_success',
          predKind: 'none',
          matchMethod: 'anchor_k',
          matched: false,
        })
      }
    } else {
      // gold='none' → resolveNonePrediction 규칙
      result.push({
        goldKind: 'none',
        predKind: 'none',
        matchMethod: 'none_rule',
        matched: true,
      })
    }
  }

  // ── 매칭되지 않은 pred → FP 행 추가 ──
  for (let i = 0; i < preds.length; i++) {
    if (usedPredIndices.has(i)) continue
    const pred = preds[i]!
    if (pred.sessionId !== sessionId) continue
    result.push({
      goldKind: 'none',
      predKind: pred.kind,
      matchMethod: 'unmatched_pred',
      matched: false,
    })
  }

  return result
}

// ---- Cohen's κ (multiclass) ----

/**
 * Cohen's κ 계산 결과.
 */
export interface CohenKappaResult {
  /** κ 값 (−1 ~ 1). 완전 일치이면 1, 우연 기준선이면 0, 완전 불일치이면 −1에 근접. */
  kappa: number
  /** 관측 일치율 p_o = 대각선 합계 / 전체 */
  observedAgreement: number
  /** 기대 일치율 p_e = Σ (row_i * col_i) / total² */
  expectedAgreement: number
  /** 평가 샘플 수 */
  totalSamples: number
}

/**
 * 다중 클래스 Cohen's κ (Cohen's Kappa) 를 계산한다.
 *
 * 공식:
 *   p_o = (TP_thrashing + TP_false_success + TP_none) / N
 *       = 대각선 합계 / N
 *
 *   p_e = Σ_c [ (row_c / N) * (col_c / N) ]
 *       = Σ_c (row_c * col_c) / N²
 *       where row_c = gold에서 class c 개수,
 *             col_c = pred에서 class c 개수.
 *
 *   κ = (p_o − p_e) / (1 − p_e)
 *
 * 경계 조건:
 *   - totalSamples === 0 → kappa=0, p_o=0, p_e=0 (정의 불가, 0 반환).
 *   - p_e === 1 (기대 일치율이 1) → kappa=0 (1−p_e = 0, 분모 0 방지).
 *
 * 불변성: 입력 ConfusionMatrix 수정 없음, 새 객체 반환.
 *
 * @param cm  buildConfusionMatrix()가 반환한 ConfusionMatrix
 * @returns   CohenKappaResult
 */
export function cohenKappa(cm: ConfusionMatrix): CohenKappaResult {
  const N = cm.totalSamples

  // 빈 행렬
  if (N === 0) {
    return { kappa: 0, observedAgreement: 0, expectedAgreement: 0, totalSamples: 0 }
  }

  // 대각선 합 (observed agreement)
  let diagSum = 0
  for (const kind of ALL_KINDS) {
    diagSum += cm.confusionRaw[kind][kind] ?? 0
  }
  const pO = diagSum / N

  // 행 주변합(gold) / 열 주변합(pred) 로 기대 일치율 계산
  let peSum = 0
  for (const kind of ALL_KINDS) {
    // row marginal: gold=kind 의 총 개수
    let rowSum = 0
    for (const p of ALL_KINDS) {
      rowSum += cm.confusionRaw[kind][p] ?? 0
    }
    // col marginal: pred=kind 의 총 개수
    let colSum = 0
    for (const g of ALL_KINDS) {
      colSum += cm.confusionRaw[g][kind] ?? 0
    }
    peSum += rowSum * colSum
  }
  const pE = peSum / (N * N)

  // 분모 0 방지 (p_e === 1 이면 κ 정의 불가 → 0)
  if (1 - pE === 0) {
    return { kappa: 0, observedAgreement: pO, expectedAgreement: pE, totalSamples: N }
  }

  const kappa = (pO - pE) / (1 - pE)

  return { kappa, observedAgreement: pO, expectedAgreement: pE, totalSamples: N }
}

// ---- Wilson 신뢰구간 ----

/**
 * Wilson score interval 결과.
 * 95% CI (z=1.96) 기준.
 */
export interface WilsonInterval {
  /** 점 추정값 (p̂ = successes / total) */
  estimate: number
  /** Wilson CI 하한 */
  low: number
  /** Wilson CI 상한 */
  high: number
  /** 표본 크기 */
  total: number
  /** 성공 횟수 */
  successes: number
}

/**
 * Wilson score interval (이항 비율 신뢰구간).
 *
 * 공식:
 *   p̂ = successes / total
 *   center = (p̂ + z²/(2n)) / (1 + z²/n)
 *   margin = z * sqrt(p̂(1-p̂)/n + z²/(4n²)) / (1 + z²/n)
 *   low = center - margin, high = center + margin
 *
 * 경계 조건:
 *   - total === 0 → estimate=0, low=0, high=1 (무정보 사전)
 *   - successes > total → 예외 발생
 *
 * @param successes 성공 횟수 (>=0)
 * @param total     전체 시도 수 (>=0)
 * @param z         표준 정규 분위수 (기본 1.96 = 95% CI)
 */
export function wilsonInterval(
  successes: number,
  total: number,
  z: number = 1.96,
): WilsonInterval {
  if (successes < 0) {
    throw new RangeError(`wilsonInterval: successes must be >= 0, got ${successes}`)
  }
  if (total < 0) {
    throw new RangeError(`wilsonInterval: total must be >= 0, got ${total}`)
  }
  if (successes > total) {
    throw new RangeError(
      `wilsonInterval: successes (${successes}) > total (${total})`,
    )
  }

  // total === 0: 무정보 사전 — [0, 1] 반환
  if (total === 0) {
    return { estimate: 0, low: 0, high: 1, total: 0, successes: 0 }
  }

  const n = total
  const p = successes / n
  const z2 = z * z

  // Wilson center & margin
  const denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator

  const low = Math.max(0, center - margin)
  const high = Math.min(1, center + margin)

  return {
    estimate: p,
    low,
    high,
    total,
    successes,
  }
}

// ---- computeWilsonCI 공개 API ----

/**
 * Wilson 95% 신뢰구간 결과.
 * computeWilsonCI의 반환 타입.
 */
export interface WilsonCI {
  /** 점 추정값 (p̂ = k / n) */
  estimate: number
  /** Wilson CI 하한 */
  lower: number
  /** Wilson CI 상한 */
  upper: number
  /** 전체 시도 수 */
  n: number
  /** 성공 횟수 */
  k: number
}

/**
 * Wilson score interval (이항 비율 신뢰구간) — 공개 API.
 *
 * 내부적으로 wilsonInterval()을 위임하며, AC 명세 시그니처
 * computeWilsonCI(k, n, z?) 와 lower/upper 필드명을 제공한다.
 *
 * 공식 (Wilson 1927):
 *   p̂ = k / n
 *   center = (p̂ + z²/(2n)) / (1 + z²/n)
 *   margin = z * sqrt(p̂(1-p̂)/n + z²/(4n²)) / (1 + z²/n)
 *   lower = max(0, center - margin)
 *   upper = min(1, center + margin)
 *
 * 경계 조건:
 *   - n === 0 → estimate=0, lower=0, upper=1 (무정보 사전)
 *   - k === 0 → lower≈0 (z에 따라 미세 양수), upper < 1
 *   - k === n → lower > 0, upper≈1
 *   - k > n  → RangeError
 *   - k < 0  → RangeError
 *
 * @param k  성공 횟수 (>=0)
 * @param n  전체 시도 수 (>=0)
 * @param z  표준 정규 분위수 (기본 1.96 = 95% CI)
 * @returns  WilsonCI { estimate, lower, upper, n, k }
 * @throws   RangeError (k<0, n<0, k>n)
 */
export function computeWilsonCI(k: number, n: number, z: number = 1.96): WilsonCI {
  const wi = wilsonInterval(k, n, z)
  return {
    estimate: wi.estimate,
    lower: wi.low,
    upper: wi.high,
    n,
    k,
  }
}

// ---- 클래스별 메트릭 산출 ----

/**
 * computePerClassMetrics 옵션.
 */
export interface ComputePerClassMetricsOptions {
  /**
   * 클래스당 최소 양성 지지(support) 임계.
   * 양성 수(tp + fn) < minSupport 이면 F1 산출을 생략하고 skipped=true로 표시.
   * SPEC §6: 기본값 15.
   */
  minSupport?: number
}

/**
 * 단일 클래스(OvR)에 대한 메트릭 산출 결과.
 * PerClassMetric(eval-contracts.ts) 과 동일 구조로 반환.
 *
 * - precision  = TP / (TP + FP)   — TP=FP=0 이면 1.0 (정의: 탐지 없음은 오탐도 없음)
 * - recall     = TP / (TP + FN)   — TP=FN=0 이면 1.0 (정의: 해당 클래스 없음)
 * - f1         = 2 * P * R / (P + R) — P=R=0 이면 0.0
 * - support    = TP + FN          (gold 기준 해당 클래스 실제 수)
 * - skipped    = positiveCount < minSupport
 *
 * Wilson CI:
 *   precision 기준: successes=TP, total=TP+FP
 *   recall    기준: successes=TP, total=TP+FN
 */
export interface PerClassMetricsEntry {
  kind: DetectionKind
  tp: number
  fp: number
  fn: number
  tn: number
  precision?: number
  recall?: number
  f1?: number
  wilsonPrecisionLow?: number
  wilsonPrecisionHigh?: number
  wilsonRecallLow?: number
  wilsonRecallHigh?: number
  skipped: boolean
  skippedReason?: string
  /** 양성 샘플 수 = TP + FN (gold 기준 해당 클래스 수) */
  positiveCount: number
}

/**
 * ConfusionMatrix로부터 각 클래스별 precision/recall/f1/support 및
 * Wilson 95% CI를 산출한다.
 *
 * 규칙:
 *   - 클래스당 양성 수(positiveCount = tp + fn) < minSupport(기본 15) 이면
 *     precision/recall/f1 산출을 생략하고 skipped=true + skippedReason을 반환.
 *     Wilson CI와 TP/FP/FN/TN 원시값은 항상 반환.
 *   - precision 정의:
 *       tp + fp === 0 이면 1.0 (탐지 없음 = 오탐 없음)
 *       그 외 tp / (tp + fp)
 *   - recall 정의:
 *       tp + fn === 0 이면 1.0 (해당 클래스 없음)
 *       그 외 tp / (tp + fn)
 *   - f1 정의:
 *       precision + recall === 0 이면 0.0
 *       그 외 2 * P * R / (P + R)
 *   - Wilson CI:
 *       precision: wilsonInterval(tp, tp + fp)
 *       recall:    wilsonInterval(tp, tp + fn)
 *   - 불변성: cm 수정 없음, 새 배열 반환.
 *
 * @param cm       buildConfusionMatrix()가 반환한 ConfusionMatrix
 * @param options  ComputePerClassMetricsOptions
 * @returns        PerClassMetricsEntry[] (ALL_KINDS 순서 고정)
 */
export function computePerClassMetrics(
  cm: ConfusionMatrix,
  options: ComputePerClassMetricsOptions = {},
): PerClassMetricsEntry[] {
  const minSupport = options.minSupport ?? 15

  return ALL_KINDS.map((kind): PerClassMetricsEntry => {
    const cell = cm.perClass[kind]
    const { tp, fp, fn, tn } = cell

    // 양성 수 (gold 기준 해당 클래스 실제 수)
    const positiveCount = tp + fn

    // Wilson CI (항상 산출 — skipped 여부와 무관)
    const wPrec = wilsonInterval(tp, tp + fp)
    const wRec = wilsonInterval(tp, tp + fn)

    // 소표본 정성폴백 — F1/precision/recall 생략
    if (positiveCount < minSupport) {
      return {
        kind,
        tp,
        fp,
        fn,
        tn,
        skipped: true,
        skippedReason: `양성 수 ${positiveCount} < minSupport ${minSupport}`,
        positiveCount,
        wilsonPrecisionLow: wPrec.low,
        wilsonPrecisionHigh: wPrec.high,
        wilsonRecallLow: wRec.low,
        wilsonRecallHigh: wRec.high,
      }
    }

    // precision
    const precision = tp + fp === 0 ? 1.0 : tp / (tp + fp)
    // recall
    const recall = tp + fn === 0 ? 1.0 : tp / (tp + fn)
    // f1
    const f1 = precision + recall === 0 ? 0.0 : (2 * precision * recall) / (precision + recall)

    return {
      kind,
      tp,
      fp,
      fn,
      tn,
      precision,
      recall,
      f1,
      wilsonPrecisionLow: wPrec.low,
      wilsonPrecisionHigh: wPrec.high,
      wilsonRecallLow: wRec.low,
      wilsonRecallHigh: wRec.high,
      skipped: false,
      positiveCount,
    }
  })
}

// ---- 골드셋 요약 ----

/**
 * 골드 라벨 배열을 1패스 집계해 GoldSetSummary를 생성한다.
 * SPEC §8: 골드셋 규모(소스별/클래스별/라운드/라벨러) 리포트용.
 *
 * 불변성: 입력 배열 수정 없음, 새 객체 반환.
 */
export function buildGoldSetSummary(gold: readonly GoldLabel[]): GoldSetSummary {
  const bySource: Record<GoldLabelSource, number> = {
    live_jsonl: 0,
    synthetic: 0,
    dohyun_adapted: 0,
  }
  const byKind: Record<DetectionKind, number> = {
    thrashing: 0,
    false_success: 0,
    none: 0,
  }
  const rounds = new Set<number>()
  const labelers = new Set<string>()
  let periodStart: number | undefined
  let periodEnd: number | undefined

  for (const g of gold) {
    bySource[g.source] += 1
    byKind[g.expectedSignal] += 1
    rounds.add(g.labelRound)
    labelers.add(g.labelerId)
    if (periodStart === undefined || g.labeledAt < periodStart) periodStart = g.labeledAt
    if (periodEnd === undefined || g.labeledAt > periodEnd) periodEnd = g.labeledAt
  }

  return {
    totalLabels: gold.length,
    bySource,
    byKind,
    rounds: [...rounds].sort((a, b) => a - b),
    labelers: [...labelers].sort(),
    ...(periodStart !== undefined ? { periodStart } : {}),
    ...(periodEnd !== undefined ? { periodEnd } : {}),
  }
}

// ---- computeMetrics ----

/**
 * computeMetrics 입력.
 * paired label(gold↔pred 해소 결과)과 메타를 받아 EvalMetricsResult를 조립한다.
 */
export interface ComputeMetricsInput {
  /** 페어링된 gold/pred 라벨 (buildPairedLabels 결과를 세션별로 합친 것) */
  paired: readonly PairedLabelEntry[]
  /** 평가에 사용된 골드 라벨 전체 (요약용) */
  gold: readonly GoldLabel[]
  /** 오류 샘플 (FP/FN 정성 분석용, 선택) */
  errorSamples?: readonly import('./eval-contracts.js').ErrorSample[]
  /** 클래스당 최소 지지 (기본 15) */
  minSupport?: number
  /** 실행 ID (없으면 호출자가 채움 — 결정론 위해 주입) */
  runId: string
  /** 실행 시각 (epoch ms, 결정론 위해 주입) */
  runAt: number
  /** DetectorConfig 식별자 */
  detectorConfigId: string
  /** 임베딩 모델 ID */
  embedModelId: string
  /** judge 모델 ID (선택) */
  judgeModelId?: string
  /** 리플레이 실행 여부 */
  isReplay: boolean
}

/**
 * 페어링된 gold/pred 라벨로부터 EvalMetricsResult를 조립한다.
 *
 * SPEC §6 정량 메트릭:
 *   precision/recall/f1(클래스별) + macroF1 + microF1 + cohenKappa + balancedAccuracy
 *   + Wilson CI. accuracy는 부록만. 소표본 <minSupport 정성폴백.
 *
 * 집계 규칙:
 *   - perClass: computePerClassMetrics (skipped 클래스 정성폴백 표시)
 *   - macroF1 : skipped 제외 클래스 f1 단순 평균 (전부 skipped면 undefined)
 *   - microF1 : 전체 TP/FP/FN 합산 후 산출
 *   - cohenKappa: 전체 혼동행렬 (소표본이면 undefined)
 *   - balancedAccuracy: skipped 제외 클래스 recall 평균
 *   - accuracy: 대각합 / 전체 (부록)
 *
 * 불변성: 입력 수정 없음, 새 객체 반환.
 */
export function computeMetrics(input: ComputeMetricsInput): EvalMetricsResult {
  const minSupport = input.minSupport ?? 15
  const goldKinds = input.paired.map((p) => p.goldKind)
  const predKinds = input.paired.map((p) => p.predKind)

  const cm = buildConfusionMatrix(goldKinds, predKinds)
  const perClassEntries = computePerClassMetrics(cm, { minSupport })
  // PerClassMetricsEntry는 PerClassMetric과 동일 구조 → 그대로 사용.
  const perClass: PerClassMetric[] = perClassEntries.map((e) => ({ ...e }))

  const hasQualitativeFallback = perClass.some((p) => p.skipped)

  // macroF1: skipped 제외 f1 평균
  const f1s = perClass.filter((p) => !p.skipped && p.f1 !== undefined).map((p) => p.f1 as number)
  const macroF1 = f1s.length > 0 ? f1s.reduce((a, b) => a + b, 0) / f1s.length : undefined

  // microF1: 전체 TP/FP/FN 합산
  let microTp = 0
  let microFp = 0
  let microFn = 0
  for (const p of perClass) {
    microTp += p.tp
    microFp += p.fp
    microFn += p.fn
  }
  const microPrec = microTp + microFp === 0 ? 1 : microTp / (microTp + microFp)
  const microRec = microTp + microFn === 0 ? 1 : microTp / (microTp + microFn)
  const microF1 =
    microPrec + microRec === 0 ? 0 : (2 * microPrec * microRec) / (microPrec + microRec)

  // cohenKappa: 소표본 정성폴백이면 undefined (라벨 천장 신뢰 못함)
  const kappaResult = cohenKappa(cm)
  const cohenKappaVal = hasQualitativeFallback ? undefined : kappaResult.kappa

  // balancedAccuracy: skipped 제외 recall 평균
  const recalls = perClass
    .filter((p) => !p.skipped && p.recall !== undefined)
    .map((p) => p.recall as number)
  const balancedAccuracy =
    recalls.length > 0 ? recalls.reduce((a, b) => a + b, 0) / recalls.length : undefined

  // accuracy (부록): 대각합 / 전체
  let diag = 0
  for (const kind of ['thrashing', 'false_success', 'none'] as DetectionKind[]) {
    diag += cm.confusionRaw[kind][kind]
  }
  const accuracy = cm.totalSamples === 0 ? undefined : diag / cm.totalSamples

  return {
    runId: input.runId,
    runAt: input.runAt,
    detectorConfigId: input.detectorConfigId,
    embedModelId: input.embedModelId,
    ...(input.judgeModelId !== undefined ? { judgeModelId: input.judgeModelId } : {}),
    goldCount: input.gold.length,
    isReplay: input.isReplay,
    perClass,
    ...(macroF1 !== undefined ? { macroF1 } : {}),
    microF1,
    ...(cohenKappaVal !== undefined ? { cohenKappa: cohenKappaVal } : {}),
    ...(balancedAccuracy !== undefined ? { balancedAccuracy } : {}),
    ...(accuracy !== undefined ? { accuracy } : {}),
    errorSamples: input.errorSamples ? [...input.errorSamples] : [],
    goldSetSummary: buildGoldSetSummary(input.gold),
    hasQualitativeFallback,
  }
}
