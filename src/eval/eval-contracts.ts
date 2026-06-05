// src/eval/eval-contracts.ts
// M6 평가 하니스 신규 타입 정의.
//
// 규칙:
//   - contracts.ts는 수정하지 않는다 (불변).
//   - enum/리터럴은 contracts.ts/스키마 기존 값을 import해 단일 출처 유지.
//   - 신규 평가 타입만 이 파일에 정의.
//
// BLOCKER C1: kind 리터럴은 contracts.ts의 'thrashing'|'false_success'|'none' import.
// BLOCKER C9: source 리터럴은 migrations.ts DDL 정본과 일치.
//             'live_jsonl'|'synthetic'|'dohyun_adapted'
// BLOCKER C9: label 리터럴은 'positive'|'negative' (이 파일 정의, 단일 출처).

import type {
  DetectionRecord,
  DetectionVerdict,
  DetectorConfig,
  NormalizedEvent,
} from '../contracts.js'

// ---- 재사용 enum/리터럴 (단일 출처 — contracts.ts import) ----

/**
 * 탐지 종류 리터럴.
 * contracts.ts DetectionVerdict.kind / JudgeVerdict.kind 와 동일.
 * 단일 출처 유지: 이 파일에서 재정의 금지, import 사용.
 */
export type DetectionKind = DetectionVerdict['kind'] // 'thrashing' | 'false_success' | 'none'

// ---- 골드셋 소스 enum ----

/**
 * 골드 라벨 소스 — eval DB gold_labels.source DDL 정본과 동일.
 * BLOCKER C9: 'live_jsonl'|'synthetic'|'dohyun_adapted' 정본.
 */
export type GoldLabelSource = 'live_jsonl' | 'synthetic' | 'dohyun_adapted'

// ---- 골드 라벨 레코드 ----

/**
 * 골드셋 라벨 레코드.
 * eval DB gold_labels 테이블과 1:1 매핑.
 *
 * label_kind:
 *   - 'point'  : anchor_uuid 단일 이벤트 지점 (false_success용)
 *   - 'span'   : start_uuid~end_uuid 범위 (thrashing용 IoU 매칭)
 *   - 'window' : window_id 기반 (gate windowRefs 기반)
 *
 * BLOCKER C1: expected_signal은 contracts.ts DetectionKind import (재정의 금지).
 * BLOCKER C9: source는 GoldLabelSource 리터럴.
 */
export interface GoldLabel {
  /** PK (UUID) */
  labelId: string
  /** 라벨 종류 */
  labelKind: 'point' | 'span' | 'window'
  /** point 라벨용 anchor 이벤트 UUID */
  anchorUuid?: string
  /** span 라벨용 시작 이벤트 UUID */
  startUuid?: string
  /** span 라벨용 종료 이벤트 UUID */
  endUuid?: string
  /** window 라벨용 window ID */
  windowId?: string
  /** 세션 ID */
  sessionId: string
  /**
   * 기대 신호 — BLOCKER C1: 'thrashing'|'false_success'|'none' 단일 리터럴.
   * contracts.ts DetectionKind import.
   */
  expectedSignal: DetectionKind
  /**
   * 소스 — BLOCKER C9: 'live_jsonl'|'synthetic'|'dohyun_adapted' 정본.
   */
  source: GoldLabelSource
  /** 라벨러 식별자 */
  labelerId: string
  /** 라벨링 라운드 (1부터) */
  labelRound: number
  /** 라벨 생성 시각 (epoch ms) */
  labeledAt: number
  /** 메모 */
  notes?: string
}

// ---- 골드 샘플 봉투 ----

/**
 * 골드 샘플 봉투 — 이벤트 시퀀스 + 해당 라벨 묶음.
 * replay/calibrate가 단위로 소비하는 패키지.
 *
 * SPEC §5: ReplayEvent = NormalizedEvent (동일 정렬기 통과).
 */
export interface GoldSampleEnvelope {
  /** 봉투 ID (세션 ID와 같거나 별도 UUID) */
  envelopeId: string
  /** 세션 이벤트 배열 (정렬됨, NormalizedEvent = ReplayEvent) */
  events: NormalizedEvent[]
  /** 해당 세션의 골드 라벨 목록 */
  labels: GoldLabel[]
  /** 소스 메타 */
  source: GoldLabelSource
}

// ---- 후보 신호 ----

/**
 * mineCandidates가 추출한 구조 신호 후보.
 * 라벨링 입력으로 사용.
 * judge 없이 구조 게이트 신호만 포함.
 */
export interface CandidateSignal {
  /** 후보 ID */
  candidateId: string
  /** 세션 ID */
  sessionId: string
  /**
   * 구조 게이트 결과 기반 종류.
   * BLOCKER C1: contracts.ts DetectionKind (재정의 금지).
   */
  kind: DetectionKind
  /** 세부 유형 */
  subtype: string
  /** anchor 이벤트 UUID (false_success용) */
  anchorUuid?: string
  /** span 시작 이벤트 UUID (thrashing용) */
  startUuid?: string
  /** span 종료 이벤트 UUID (thrashing용) */
  endUuid?: string
  /** gate windowRefs — span 이벤트 UUID 목록 */
  windowRefs: string[]
  /** 신호 심각도 */
  severity: 'warning' | 'critical'
  /** 탐지 지표들 */
  metrics: Record<string, number>
  /** 추출 시각 (epoch ms) */
  minedAt: number
}

// ---- 클래스별 메트릭 ----

/**
 * 단일 클래스(종류)에 대한 메트릭.
 * Wilson 95% CI 동반.
 *
 * SPEC §6: 클래스당 양성 <15(minSupport 기본 15)이면
 *   F1/κ 생략 → skipped=true + skippedReason, 정성분석+CI만 리포트.
 */
export interface PerClassMetric {
  /**
   * 클래스 종류.
   * BLOCKER C1: contracts.ts DetectionKind.
   */
  kind: DetectionKind
  /** True Positive 수 */
  tp: number
  /** False Positive 수 */
  fp: number
  /** False Negative 수 */
  fn: number
  /** True Negative 수 */
  tn: number
  /** 정밀도 (0~1). skipped=true이면 undefined. */
  precision?: number
  /** 재현율 (0~1). skipped=true이면 undefined. */
  recall?: number
  /** F1 (0~1). skipped=true이면 undefined. */
  f1?: number
  /** Wilson 95% CI 하한 (precision 기준). */
  wilsonPrecisionLow?: number
  /** Wilson 95% CI 상한 (precision 기준). */
  wilsonPrecisionHigh?: number
  /** Wilson 95% CI 하한 (recall 기준). */
  wilsonRecallLow?: number
  /** Wilson 95% CI 상한 (recall 기준). */
  wilsonRecallHigh?: number
  /**
   * true이면 양성 수 < minSupport → F1/κ 생략, 정성폴백.
   * SPEC §6 소표본 정성폴백 규칙.
   */
  skipped: boolean
  /** 스킵 이유 (예: "양성 수 7 < minSupport 15") */
  skippedReason?: string
  /** 양성 샘플 수 */
  positiveCount: number
}

// ---- 오류 샘플 ----

/**
 * 메트릭 계산 시 수집된 오류 샘플 (FP/FN 예시).
 * 정성 분석 보조용.
 */
export interface ErrorSample {
  /** 샘플 ID (labelId 또는 detectionId) */
  sampleId: string
  /** 오류 유형 */
  errorType: 'fp' | 'fn'
  /** 세션 ID */
  sessionId: string
  /**
   * 실제 라벨 (gold).
   * BLOCKER C1: contracts.ts DetectionKind.
   */
  goldKind: DetectionKind
  /**
   * 예측 종류.
   * BLOCKER C1: contracts.ts DetectionKind.
   */
  predKind: DetectionKind
  /** gold 신뢰도 (없으면 undefined) */
  goldConfidence?: number
  /** pred 신뢰도 */
  predConfidence: number
  /** 메모 */
  notes?: string
}

// ---- 골드셋 요약 ----

/**
 * 골드셋 전체 요약 통계.
 * 리포트 서두에 표시.
 *
 * SPEC §8: 골드셋 규모(n=30~200 단일라벨러), Wilson CI 동반.
 */
export interface GoldSetSummary {
  /** 전체 라벨 수 */
  totalLabels: number
  /** 소스별 라벨 수 */
  bySource: Record<GoldLabelSource, number>
  /**
   * 클래스별 라벨 수.
   * BLOCKER C1: contracts.ts DetectionKind.
   */
  byKind: Record<DetectionKind, number>
  /** 라벨링 라운드 목록 */
  rounds: number[]
  /** 라벨러 목록 */
  labelers: string[]
  /** 골드셋 수집 기간 시작 (epoch ms) */
  periodStart?: number
  /** 골드셋 수집 기간 종료 (epoch ms) */
  periodEnd?: number
}

// ---- 평가 메트릭 결과 ----

/**
 * computeMetrics 최종 출력.
 * eval DB eval_metrics 테이블에 영속화.
 *
 * SPEC §6 정량 메트릭:
 *   precision/recall/f1(클래스별) + macroF1 + microF1 + cohenKappa + balancedAccuracy
 *   + Wilson CI.
 *   accuracy는 부록만 (클래스 불균형).
 *   소표본 <15 정성폴백.
 */
export interface EvalMetricsResult {
  /** 실행 ID (UUID) */
  runId: string
  /** 실행 시각 (epoch ms) */
  runAt: number
  /** 사용된 DetectorConfig ID */
  detectorConfigId: string
  /** 임베딩 모델 ID */
  embedModelId: string
  /** judge 모델 ID (없으면 undefined) */
  judgeModelId?: string
  /** 평가에 사용된 골드 라벨 수 */
  goldCount: number
  /** 리플레이 실행 여부 */
  isReplay: boolean

  // ---- 클래스별 메트릭 ----
  /** 클래스별 메트릭 목록 */
  perClass: PerClassMetric[]

  // ---- 매크로/마이크로 집계 ----
  /**
   * Macro F1 (클래스별 F1 단순 평균).
   * skipped 클래스는 평균에서 제외.
   * skipped 클래스만 남으면 undefined.
   */
  macroF1?: number
  /**
   * Micro F1 (전체 TP/FP/FN 합산 후 산출).
   */
  microF1?: number
  /**
   * Cohen's κ (전체).
   * 소표본 skipped이면 undefined.
   */
  cohenKappa?: number
  /**
   * Balanced Accuracy ((recall_class1 + recall_class2 + ...) / n_classes).
   * skipped 클래스는 제외.
   */
  balancedAccuracy?: number
  /**
   * Accuracy (부록 전용 — 클래스 불균형으로 주 지표 아님).
   */
  accuracy?: number

  // ---- 오류 샘플 ----
  /** FP/FN 예시 샘플 */
  errorSamples: ErrorSample[]

  // ---- 메타 ----
  /** 골드셋 요약 */
  goldSetSummary: GoldSetSummary
  /** 메모 */
  notes?: string
  /**
   * 정성폴백 여부 — 클래스당 양성 <15인 클래스가 하나 이상 있을 때 true.
   * SPEC §6 소표본 정성폴백.
   */
  hasQualitativeFallback: boolean
}

// ---- 캘리브레이션 결과 ----

/**
 * 단일 candidate config에 대한 k-fold 교차검증 결과.
 */
export interface CandidateFoldResult {
  /** 폴드 번호 (1부터) */
  foldIndex: number
  /** 폴드 내 macroF1 */
  macroF1: number
  /** 폴드 내 FPR_none (none 클래스 FP율) */
  fprNone: number
  /** objective = macroF1 − λ·FPR_none */
  objective: number
  /** 폴드 내 골드 수 */
  goldCount: number
}

/**
 * 단일 candidate config에 대한 캘리브레이션 평가 결과.
 */
export interface CandidateCalibrationResult {
  /** candidate 인덱스 (CalibrationGrid.candidates 배열 인덱스) */
  candidateIndex: number
  /** 적용된 DetectorConfig 부분 오버라이드 */
  configOverride: Partial<DetectorConfig>
  /** 폴드별 결과 */
  folds: CandidateFoldResult[]
  /** 폴드 평균 macroF1 */
  meanMacroF1: number
  /** 폴드 평균 FPR_none */
  meanFprNone: number
  /** 폴드 평균 objective */
  meanObjective: number
  /**
   * 정성폴백 여부 — 골드셋이 너무 작아 grid 축소 + 정성폴백 적용됨.
   * SPEC: 클래스당 <30이면 grid 2~3점 축소 + qualitativeFallback=true.
   */
  qualitativeFallback: boolean
}

/**
 * calibrate 최종 출력.
 *
 * SPEC §6 캘리브레이션 규칙:
 *   - stratified k-fold(k=5), objective=macroF1 − λ·FPR_none
 *   - 선택 config = DEFAULT_DETECTOR_CONFIG copy+override (원본 불변)
 *   - 골드셋 작으면 grid 2~3점 축소 + qualitativeFallback=true
 */
export interface CalibrationResult {
  /** 실행 ID (UUID) */
  runId: string
  /** 실행 시각 (epoch ms) */
  runAt: number
  /** k-fold k값 */
  k: number
  /** 오탐 페널티 λ */
  lambda: number
  /** 최소 지지 임계 (클래스당 minSupport) */
  minSupport: number
  /** 전체 candidate 결과 */
  candidateResults: CandidateCalibrationResult[]
  /**
   * 선정된 best candidate 인덱스.
   * objective 최대값 기준.
   */
  bestCandidateIndex: number
  /**
   * 선정된 best config.
   * DEFAULT_DETECTOR_CONFIG copy + best override (원본 불변).
   */
  bestConfig: DetectorConfig
  /** best candidate의 평균 objective */
  bestObjective: number
  /**
   * 전체 정성폴백 여부 (골드셋 규모 부족).
   */
  qualitativeFallback: boolean
  /** 골드셋 요약 */
  goldSetSummary: GoldSetSummary
  /** 메모 */
  notes?: string
}

// ---- 리플레이 탐지 레코드 ----

/**
 * 리플레이 세션에서 반환되는 DetectionRecord 확장 타입.
 * contracts.ts DetectionRecord에 is_replay 필드를 추가.
 *
 * is_replay=1: replaySession(recordIsReplay=true)으로 생성된 레코드.
 * is_replay=0: 일반 live 탐지 레코드.
 *
 * contracts.ts는 불변이므로 eval-contracts.ts에서 확장 정의.
 */
export type ReplayDetectionRecord = DetectionRecord & {
  /** eval DB detections.is_replay 컬럼 값 (0 또는 1) */
  is_replay: 0 | 1
}

// ---- 리플레이 세션 옵션 ----

/**
 * replaySession 옵션.
 */
export interface ReplaySessionOptions extends M3PipelineOptionsRef {
  /**
   * true이면 반환된 모든 DetectionRecord에 is_replay=1 설정.
   * eval DB detections.is_replay=1 기록에 사용.
   * SPEC §5(f): recordIsReplay=true → is_replay=1.
   */
  recordIsReplay?: boolean
  /** 세션 ID (없으면 이벤트에서 추론) */
  sessionId?: string
}

/**
 * M3PipelineOptions 참조 타입 (순환 import 회피용 재정의).
 * replay-session.ts에서 M3PipelineOptions를 주입받기 위해 사용.
 */
export interface M3PipelineOptionsRef {
  /** 임베딩 클라이언트 */
  embedClient: unknown
  /** judge 클라이언트 */
  judgeClient: unknown
  /** 탐지기 설정 */
  config: DetectorConfig
}

// ---- 리플레이 결과 ----

/**
 * replaySession 단일 세션 리플레이 결과.
 *
 * SPEC §5(f): 녹화 JSONL → parse → gate → bridge → m3 동일 파이프라인.
 *   dispatcher.dispatch 호출 금지.
 *   is_replay=true로 detections에 기록.
 */
export interface ReplaySessionResult {
  /** 세션 ID */
  sessionId: string
  /** 리플레이 시작 시각 (epoch ms) */
  replayAt: number
  /** 처리된 이벤트 수 */
  eventCount: number
  /** 탐지 결과 목록 (is_replay 필드 포함) */
  detections: ReplayDetectionRecord[]
  /** eval DB에 기록된 detection_id 목록 */
  recordedDetectionIds: string[]
  /** 처리 소요 시간 (ms) */
  durationMs: number
  /** 에러 목록 (있는 경우) */
  errors: string[]
}

// ---- 리포트 입력 ----

/**
 * renderReportMd / renderReportJson 입력 컨텍스트.
 * 모든 평가 결과를 묶어서 리포트 렌더러에 전달.
 */
export interface ReportContext {
  /** 메트릭 결과 */
  metrics: EvalMetricsResult
  /** 캘리브레이션 결과 (없으면 undefined) */
  calibration?: CalibrationResult
  /** 리플레이 결과 목록 */
  replaySessions: ReplaySessionResult[]
  /** 리포트 제목 (기본: 'LoopBreaker Evaluation Report') */
  title?: string
  /** 리포트 생성 시각 (epoch ms) */
  generatedAt: number
  /** 리포트 생성자 식별자 */
  generatedBy?: string
}
