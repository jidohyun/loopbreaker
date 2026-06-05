// src/eval/calibrate.ts
// M6 캘리브레이션 — CalibrationGrid 격자를 stratified k-fold로 탐색해
// objective = macroF1 − λ·FPR_none 최대 DetectorConfig를 선택한다.
//
// SPEC §6 캘리브레이션 규칙:
//   - stratified k-fold(k=5), 각 candidate config로 hold-out replay → 메트릭
//   - objective = macroF1 − λ·FPR_none (λ=0.5 기본, 오탐 페널티)
//   - end-to-end 채점 (구조→의미→judge 합성, 단계 독립평가 금지)
//   - 선택 config = DEFAULT_DETECTOR_CONFIG copy + override (원본 동결)
//   - 골드셋 작으면(클래스당<30) grid 2~3점 축소 + qualitativeFallback=true 정성폴백
//
// 규칙:
//   - DEFAULT_DETECTOR_CONFIG 불변 (copy+override만).
//   - 실 API 금지 — Mock embed/judge 주입.
//   - console.log 금지. 불변성(새 객체 반환).

import { randomUUID } from 'node:crypto'
import {
  DEFAULT_DETECTOR_CONFIG,
  type DetectorConfig,
  type CalibrationGrid,
} from '../contracts.js'
import type { EmbedClient } from '../api/embed-client.js'
import type { JudgeClient } from '../api/judge-client.js'
import type {
  GoldLabel,
  GoldSampleEnvelope,
  GoldSetSummary,
  DetectionKind,
  CalibrationResult,
  CandidateCalibrationResult,
  CandidateFoldResult,
} from './eval-contracts.js'
import { replaySession } from './replay-session.js'
import {
  buildPairedLabels,
  buildConfusionMatrix,
  computePerClassMetrics,
  buildGoldSetSummary,
  type GoldPredPairInput,
  type PredEntry,
  type PairedLabelEntry,
  type ConfusionMatrix,
} from './metrics.js'

const ALL_KINDS: readonly DetectionKind[] = ['thrashing', 'false_success', 'none']

/** 소표본 판정 임계 — 클래스당 골드 수가 이 값 미만이면 grid 축소 + 정성폴백 */
const SMALL_SAMPLE_PER_CLASS = 30
/** 소표본 시 축소할 grid candidate 최대 수 */
const SMALL_SAMPLE_GRID_CAP = 3

// ---- 옵션 ----

/**
 * calibrate 옵션.
 *
 * embedClient/judgeClient는 candidate별로 config만 바뀌므로 고정 주입한다.
 * rawLinesBySession: replaySession은 raw JSONL을 다시 parseLine하므로,
 *   세션별 원본 JSONL 라인을 받아야 한다(GoldSampleEnvelope.events는 parseLine 입력형이 아님).
 */
export interface CalibrateOpts {
  /** 오탐 페널티 λ (기본 0.5, SPEC §6 정본) */
  lambda?: number
  /** k-fold k값 (기본 5) */
  k?: number
  /** 클래스당 최소 지지 (기본 15) */
  minSupport?: number
  /** Mock embed 클라이언트 (실 API 금지) */
  embedClient: EmbedClient
  /** Mock judge 클라이언트 (실 API 금지) */
  judgeClient: JudgeClient
  /** 세션 ID → 원본 JSONL 라인 배열 (replaySession 입력) */
  rawLinesBySession: ReadonlyMap<string, readonly string[]>
  /** 결정론용 runId 주입 (없으면 randomUUID) */
  runId?: string
  /** 결정론용 runAt 주입 (없으면 Date.now) */
  runAt?: number
}

// ---- 내부 헬퍼 ----

/** DEFAULT_DETECTOR_CONFIG copy + override (원본 동결) */
function copyConfigWithOverride(override: Partial<DetectorConfig>): DetectorConfig {
  return { ...DEFAULT_DETECTOR_CONFIG, ...override }
}

/** 빈 배열 → 0 평균 */
function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * stratified k-fold: expectedSignal(클래스) 비율을 유지하며 인덱스를 k개 폴드로 분할한다.
 * 각 클래스의 인덱스를 순서대로 fold에 라운드로빈 배분 → 클래스 비율 보존.
 * gold.length < k이면 k를 gold.length로 축소(빈 폴드 방지).
 *
 * @returns folds[f] = 그 fold의 test 라벨 인덱스 배열
 */
function stratifiedKFold(gold: readonly GoldLabel[], k: number): number[][] {
  const effectiveK = Math.max(1, Math.min(k, gold.length))
  const folds: number[][] = Array.from({ length: effectiveK }, () => [])
  if (gold.length === 0) return folds

  // 클래스별 인덱스 그룹화
  const byKind = new Map<DetectionKind, number[]>()
  for (const kind of ALL_KINDS) byKind.set(kind, [])
  gold.forEach((g, i) => {
    byKind.get(g.expectedSignal)?.push(i)
  })

  // 각 클래스 인덱스를 폴드에 라운드로빈 배분 (클래스 비율 보존)
  for (const kind of ALL_KINDS) {
    const indices = byKind.get(kind) ?? []
    indices.forEach((idx, j) => {
      folds[j % effectiveK]!.push(idx)
    })
  }
  return folds
}

/** none 클래스 FPR = FP / (FP + TN) — 실제 none인데 신호로 오탐한 비율 */
function fprNoneFromConfusion(cm: ConfusionMatrix): number {
  const cell = cm.perClass['none']
  const denom = cell.fp + cell.tn
  return denom === 0 ? 0 : cell.fp / denom
}

/** macroF1 = skipped 제외 클래스 f1 평균 (전부 skipped면 0) */
function macroF1FromPerClass(
  entries: ReturnType<typeof computePerClassMetrics>,
): number {
  const f1s = entries
    .filter((e) => !e.skipped && e.f1 !== undefined)
    .map((e) => e.f1 as number)
  return mean(f1s)
}

/** GoldLabel → GoldPredPairInput (페어링 입력) */
function toGoldPairInput(label: GoldLabel): GoldPredPairInput {
  return {
    goldKind: label.expectedSignal,
    ...(label.startUuid !== undefined ? { goldStartUuid: label.startUuid } : {}),
    ...(label.endUuid !== undefined ? { goldEndUuid: label.endUuid } : {}),
    goldAnchorUuid: label.anchorUuid ?? null,
    goldSessionId: label.sessionId,
  }
}

/**
 * 한 fold의 테스트 라벨을 replaySession→페어링→혼동행렬로 평가해
 * macroF1/FPR_none을 산출한다.
 *
 * 세션별로 testLabel을 묶어 replaySession(rawLines, config)을 호출하고,
 * pred(DetectionRecord)와 gold를 buildPairedLabels로 해소한 뒤 전 세션 합산.
 */
async function evaluateFold(
  testLabels: readonly GoldLabel[],
  envelopeBySession: ReadonlyMap<string, GoldSampleEnvelope>,
  rawLinesBySession: ReadonlyMap<string, readonly string[]>,
  config: DetectorConfig,
  embedClient: EmbedClient,
  judgeClient: JudgeClient,
  minSupport: number,
): Promise<{ macroF1: number; fprNone: number; goldCount: number }> {
  // 세션별 gold 그룹화
  const labelsBySession = new Map<string, GoldLabel[]>()
  for (const label of testLabels) {
    const arr = labelsBySession.get(label.sessionId) ?? []
    arr.push(label)
    labelsBySession.set(label.sessionId, arr)
  }

  const allPaired: PairedLabelEntry[] = []

  for (const [sessionId, sessionLabels] of labelsBySession) {
    const rawLines = rawLinesBySession.get(sessionId)
    const envelope = envelopeBySession.get(sessionId)
    if (rawLines === undefined || envelope === undefined) {
      // raw JSONL 또는 봉투 없는 세션 → 미발화(none 예측) 간주
      for (const label of sessionLabels) {
        allPaired.push({
          goldKind: label.expectedSignal,
          predKind: 'none',
          matchMethod: 'none_rule',
          matched: label.expectedSignal === 'none',
        })
      }
      continue
    }

    // replaySession: 동일 파이프라인 재구동 (dispatcher 미주입 = 알림 안 쏨)
    const records = await replaySession([...rawLines], {
      recordIsReplay: true,
      pipelineOpts: { embedClient, judgeClient, config },
    })

    const preds: PredEntry[] = records.map((r) => ({
      anchorUuid: r.final.evidence[0]?.uuid ?? r.gate.windowRefs[0] ?? '',
      kind: r.final.kind,
      windowRefs: r.gate.windowRefs,
      sessionId: r.gate.sessionId,
      confidence: r.final.confidence,
    }))

    const orderedUuids = envelope.events.map((e) => e.uuid)
    const paired = buildPairedLabels({
      golds: sessionLabels.map(toGoldPairInput),
      preds,
      orderedUuids,
      sessionId,
      k: 5,
      iouThreshold: 0.5,
    })
    allPaired.push(...paired)
  }

  const cm = buildConfusionMatrix(
    allPaired.map((p) => p.goldKind),
    allPaired.map((p) => p.predKind),
  )
  const perClass = computePerClassMetrics(cm, { minSupport })

  return {
    macroF1: macroF1FromPerClass(perClass),
    fprNone: fprNoneFromConfusion(cm),
    goldCount: testLabels.length,
  }
}

// ---- 공개 API ----

/**
 * CalibrationGrid 격자를 stratified k-fold로 탐색해
 * objective = macroF1 − λ·FPR_none 최대 DetectorConfig를 선택한다.
 *
 * @param gold         전체 골드 라벨
 * @param goldSamples  세션별 이벤트 봉투 (orderedUuids 산출용)
 * @param grid         CalibrationGrid (candidates: Partial<DetectorConfig>[])
 * @param opts         CalibrateOpts (Mock 클라이언트 + rawLinesBySession)
 * @returns            CalibrationResult (bestConfig은 DEFAULT copy+override)
 */
export async function calibrate(
  gold: readonly GoldLabel[],
  goldSamples: readonly GoldSampleEnvelope[],
  grid: CalibrationGrid,
  opts: CalibrateOpts,
): Promise<CalibrationResult> {
  const lambda = opts.lambda ?? 0.5
  const k = opts.k ?? 5
  const minSupport = opts.minSupport ?? 15
  const runId = opts.runId ?? randomUUID()
  const runAt = opts.runAt ?? Date.now()

  const goldSetSummary: GoldSetSummary = buildGoldSetSummary(gold)

  // 세션 ID → 봉투 맵 (labels[0].sessionId 우선, 없으면 envelopeId)
  const envelopeBySession = new Map<string, GoldSampleEnvelope>()
  for (const env of goldSamples) {
    const sid = env.labels[0]?.sessionId ?? env.envelopeId
    envelopeBySession.set(sid, env)
  }

  // 소표본 판정: 클래스당 골드 < 30이면 grid 축소 + 정성폴백
  const smallSample = ALL_KINDS.some(
    (kind) => goldSetSummary.byKind[kind] < SMALL_SAMPLE_PER_CLASS,
  )
  const effectiveCandidates = smallSample
    ? grid.candidates.slice(0, Math.min(SMALL_SAMPLE_GRID_CAP, grid.candidates.length))
    : grid.candidates

  const folds = stratifiedKFold(gold, k)

  const candidateResults: CandidateCalibrationResult[] = []
  for (let idx = 0; idx < effectiveCandidates.length; idx++) {
    const override = effectiveCandidates[idx]!
    const config = copyConfigWithOverride(override)
    const foldResults: CandidateFoldResult[] = []

    for (let f = 0; f < folds.length; f++) {
      const testIdx = folds[f]!
      const testLabels = testIdx.map((i) => gold[i]!)
      const { macroF1, fprNone, goldCount } = await evaluateFold(
        testLabels,
        envelopeBySession,
        opts.rawLinesBySession,
        config,
        opts.embedClient,
        opts.judgeClient,
        minSupport,
      )
      foldResults.push({
        foldIndex: f + 1,
        macroF1,
        fprNone,
        objective: macroF1 - lambda * fprNone,
        goldCount,
      })
    }

    candidateResults.push({
      candidateIndex: idx,
      configOverride: override,
      folds: foldResults,
      meanMacroF1: mean(foldResults.map((r) => r.macroF1)),
      meanFprNone: mean(foldResults.map((r) => r.fprNone)),
      meanObjective: mean(foldResults.map((r) => r.objective)),
      qualitativeFallback: smallSample,
    })
  }

  // best candidate = meanObjective argmax (동률 시 더 낮은 인덱스 = 결정론)
  let bestCandidateIndex = 0
  let bestObjective = candidateResults.length > 0 ? candidateResults[0]!.meanObjective : 0
  for (let i = 1; i < candidateResults.length; i++) {
    if (candidateResults[i]!.meanObjective > bestObjective) {
      bestObjective = candidateResults[i]!.meanObjective
      bestCandidateIndex = i
    }
  }

  const bestOverride =
    effectiveCandidates.length > 0 ? effectiveCandidates[bestCandidateIndex]! : {}
  const bestConfig = copyConfigWithOverride(bestOverride)

  return {
    runId,
    runAt,
    k,
    lambda,
    minSupport,
    candidateResults,
    bestCandidateIndex,
    bestConfig,
    bestObjective,
    qualitativeFallback: smallSample,
    goldSetSummary,
    notes: smallSample
      ? `소표본(클래스당<${SMALL_SAMPLE_PER_CLASS}): grid ${effectiveCandidates.length}점 축소 + 정성폴백. nested-CV 외부폴드만 일반화 추정.`
      : `${effectiveCandidates.length}개 candidate 중 #${bestCandidateIndex} 선택 (objective=macroF1−${lambda}·FPR_none).`,
  }
}
