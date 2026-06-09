// src/eval/cli/run-eval.ts
//
// M6 골드셋 실측 리포트 오케스트레이터 (MANUAL-ONLY).
//
// 흐름: goldset.eval.db 로드 → 세션별 그룹화 → live_jsonl 세션 JSONL 복원 →
//       replaySession(Mock embed/judge) → buildPairedLabels → computeMetrics →
//       calibrate → renderReportMd/Json → .goldset/eval-report.{md,json} 산출.
//
// 부수효과 격리 / 정직성 계약:
//   - 실 ~/.claude/projects/**/<sid>.jsonl 은 read-only 로드만 (쓰기 0).
//   - API 는 MockEmbedClient/MockJudgeClient 만 (실 네트워크 0).
//     → 의미판정(STAGE2)이 빈 fixture CacheMissError 로 fail-closed 되어
//       최종 발화는 0 에 수렴한다. 따라서 이 리포트의 정량 precision/recall 은
//       "Mock judge 기준"이며 실 judge 정량치가 아님 — 리포트 notes 에 명시.
//   - false_success(dohyun_adapted) 5건은 합성 라벨만 존재(JSONL 없음) → 미발화 FN,
//     support 5 < 15 → SPEC §6 정성폴백 대상(설계상 의도된 한계).
//   - eval DB(goldset.eval.db)는 read-only 조회만.
//
// 실행: node dist/eval/cli/run-eval.js
//       (실 judge 정량치가 필요하면 별도 record 모드 + ANTHROPIC_API_KEY 필요)

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

import Database from 'better-sqlite3'

import { DEFAULT_DETECTOR_CONFIG } from '../../contracts.js'
import { replaySession, loadReplayEvents } from '../replay-session.js'
import { buildPairedLabels, computeMetrics } from '../metrics.js'
import type { PairedLabelEntry, PredEntry, GoldPredPairInput } from '../metrics.js'
import { calibrate } from '../calibrate.js'
import { renderReportMd, renderReportJson } from '../report.js'
import { MockEmbedClient } from '../../api/embed-client.js'
import { MockJudgeClient } from '../../api/judge-client.js'
import type {
  GoldLabel,
  GoldSampleEnvelope,
  ReplaySessionResult,
  ReportContext,
  DetectionKind,
} from '../eval-contracts.js'

// ── 결정론 상수 ───────────────────────────────────────────────────────────────
const FIXED_RUN_AT = 1_780_000_000_000 // build-goldset.mjs 와 동일 고정 시각
const RUN_ID = 'goldset-eval-run-001'
const CAL_RUN_ID = 'goldset-cal-run-001'

// ── 골드셋 라벨 로드 (read-only) ──────────────────────────────────────────────

interface GoldRow {
  label_id: string
  label_kind: 'point' | 'span' | 'window'
  anchor_uuid: string | null
  start_uuid: string | null
  end_uuid: string | null
  window_id: string | null
  session_id: string
  expected_signal: DetectionKind
  source: GoldLabel['source']
  labeler_id: string
  label_round: number
  labeled_at: number
  notes: string | null
}

function loadAllGoldLabels(evalDbPath: string): GoldLabel[] {
  const db = new Database(evalDbPath, { readonly: true })
  try {
    const rows = db
      .prepare(
        `SELECT label_id, label_kind, anchor_uuid, start_uuid, end_uuid, window_id,
                session_id, expected_signal, source, labeler_id, label_round, labeled_at, notes
         FROM gold_labels ORDER BY session_id, labeled_at`,
      )
      .all() as GoldRow[]
    return rows.map((r) => ({
      labelId: r.label_id,
      labelKind: r.label_kind,
      anchorUuid: r.anchor_uuid ?? undefined,
      startUuid: r.start_uuid ?? undefined,
      endUuid: r.end_uuid ?? undefined,
      windowId: r.window_id ?? undefined,
      sessionId: r.session_id,
      expectedSignal: r.expected_signal,
      source: r.source,
      labelerId: r.labeler_id,
      labelRound: r.label_round,
      labeledAt: r.labeled_at,
      notes: r.notes ?? undefined,
    }))
  } finally {
    db.close()
  }
}

// ── 세션 ID → 실 JSONL 경로 인덱스 (read-only) ────────────────────────────────

/**
 * ~/.claude/projects 하위를 한 번 순회해 sessionId → JSONL 경로 맵을 만든다.
 * 파일명이 `<sessionId>.jsonl` 규칙이므로 파일명에서 직접 sessionId 도출.
 */
function buildSessionPathIndex(): Map<string, string> {
  const projectsDir = join(homedir(), '.claude', 'projects')
  const index = new Map<string, string>()
  if (!existsSync(projectsDir)) return index
  // readdirSync recursive 로 .jsonl 전체 수집 (build-goldset.mjs 와 동일 전략)
  for (const e of readdirSync(projectsDir, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.jsonl')) {
      const sid = e.name.slice(0, -'.jsonl'.length)
      const parent = (e as { parentPath?: string; path?: string }).parentPath ?? projectsDir
      if (!index.has(sid)) index.set(sid, join(parent, e.name))
    }
  }
  return index
}

// ── 세션별 replay → preds + orderedUuids ──────────────────────────────────────

interface SessionReplay {
  sessionId: string
  orderedUuids: string[]
  preds: PredEntry[]
  replayResult: ReplaySessionResult
  rawLines: readonly string[]
}

async function replayOneSession(
  sessionId: string,
  jsonlPath: string | undefined,
  embedClient: MockEmbedClient,
  judgeClient: MockJudgeClient,
): Promise<SessionReplay> {
  // live_jsonl 세션: 실 파일 라인 로드. 합성 세션(JSONL 없음): 빈 입력 → 미발화.
  let rawLines: string[] = []
  let orderedUuids: string[] = []
  if (jsonlPath !== undefined && existsSync(jsonlPath)) {
    const raw = readFileSync(jsonlPath, 'utf8')
    rawLines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
    const loaded = loadReplayEvents(jsonlPath)
    orderedUuids = loaded.events.map((ev) => ev.uuid)
  }

  const records =
    rawLines.length > 0
      ? await replaySession(rawLines, {
          recordIsReplay: true,
          pipelineOpts: { embedClient, judgeClient, config: DEFAULT_DETECTOR_CONFIG },
        })
      : []

  const preds: PredEntry[] = records.map((r) => ({
    anchorUuid: r.final.evidence[0]?.uuid ?? r.gate.windowRefs[0] ?? '',
    kind: r.final.kind,
    windowRefs: r.gate.windowRefs,
    sessionId: r.gate.sessionId,
    confidence: r.final.confidence,
  }))

  const replayResult: ReplaySessionResult = {
    sessionId,
    replayAt: FIXED_RUN_AT,
    eventCount: orderedUuids.length,
    detections: records,
    recordedDetectionIds: [],
    durationMs: 0,
    errors: [],
  }

  return { sessionId, orderedUuids, preds, replayResult, rawLines }
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const goldsetDir = join(process.cwd(), '.goldset')
  const evalDbPath = join(goldsetDir, 'goldset.eval.db')
  if (!existsSync(evalDbPath)) {
    throw new Error(`골드셋 DB 없음: ${evalDbPath} (먼저 node .goldset/build-goldset.mjs 실행)`)
  }

  // 1) 골드 라벨 전체 로드 + 세션 그룹화
  const allGold = loadAllGoldLabels(evalDbPath)
  const goldBySession = new Map<string, GoldLabel[]>()
  for (const g of allGold) {
    const arr = goldBySession.get(g.sessionId) ?? []
    arr.push(g)
    goldBySession.set(g.sessionId, arr)
  }

  // 2) 세션 → JSONL 경로 인덱스 (live_jsonl 만 해당)
  const pathIndex = buildSessionPathIndex()

  // 3) Mock 클라이언트 (빈 fixture → 의미판정 fail-closed). 실 API 0.
  const embedClient = new MockEmbedClient([], DEFAULT_DETECTOR_CONFIG.embedDim ?? 1024)
  const judgeClient = new MockJudgeClient([])

  // 4) 세션별 replay
  const replays: SessionReplay[] = []
  let liveSessions = 0
  let syntheticSessions = 0
  let missingJsonl = 0
  for (const [sessionId, golds] of goldBySession) {
    const isSynthetic = golds.every((g) => g.source === 'dohyun_adapted')
    const jsonlPath = isSynthetic ? undefined : pathIndex.get(sessionId)
    if (isSynthetic) syntheticSessions++
    else if (jsonlPath !== undefined) liveSessions++
    else missingJsonl++
    const sr = await replayOneSession(sessionId, jsonlPath, embedClient, judgeClient)
    replays.push(sr)
  }

  // 5) 세션별 buildPairedLabels → 전체 paired 합산
  const allPaired: PairedLabelEntry[] = []
  for (const sr of replays) {
    const golds = goldBySession.get(sr.sessionId) ?? []
    const goldPairInputs: GoldPredPairInput[] = golds.map((l) => ({
      goldKind: l.expectedSignal,
      ...(l.startUuid !== undefined ? { goldStartUuid: l.startUuid } : {}),
      ...(l.endUuid !== undefined ? { goldEndUuid: l.endUuid } : {}),
      goldAnchorUuid: l.anchorUuid ?? null,
      goldSessionId: l.sessionId,
    }))
    const paired = buildPairedLabels({
      golds: goldPairInputs,
      preds: sr.preds,
      orderedUuids: sr.orderedUuids,
      sessionId: sr.sessionId,
      k: 5,
      iouThreshold: 0.5,
    })
    allPaired.push(...paired)
  }

  // 6) computeMetrics — 전체 골드셋 정량 메트릭 (소표본 정성폴백 자동 적용)
  const metricsBase = computeMetrics({
    paired: allPaired,
    gold: allGold,
    minSupport: 15,
    runId: RUN_ID,
    runAt: FIXED_RUN_AT,
    detectorConfigId: 'default',
    embedModelId: DEFAULT_DETECTOR_CONFIG.embedModelId,
    isReplay: true,
  })
  // notes 는 결과 객체에 부착 (ComputeMetricsInput 에는 notes 필드 없음)
  const metrics = {
    ...metricsBase,
    notes:
      'Mock judge 기준 리플레이. 의미판정 STAGE2가 빈 Mock fixture로 fail-closed → 최종 발화 0에 수렴. ' +
      '정량 precision/recall은 Mock 기준이며 실 judge 정량치 아님(SPEC §8 한계). ' +
      `live=${liveSessions} synthetic=${syntheticSessions} missingJsonl=${missingJsonl}`,
  }

  // 7) calibrate — 실 세션 rawLinesBySession 으로 격자탐색 (소표본 → grid 축소 + 정성폴백)
  const rawLinesBySession = new Map<string, readonly string[]>()
  const envelopes: GoldSampleEnvelope[] = []
  for (const sr of replays) {
    if (sr.rawLines.length > 0) {
      rawLinesBySession.set(sr.sessionId, sr.rawLines)
    }
    const golds = goldBySession.get(sr.sessionId) ?? []
    envelopes.push({
      envelopeId: sr.sessionId,
      events: [],
      labels: golds,
      source: golds.every((g) => g.source === 'dohyun_adapted') ? 'synthetic' : 'live_jsonl',
    } as GoldSampleEnvelope)
  }

  const calib = await calibrate(
    allGold,
    envelopes,
    {
      candidates: [
        {},
        { simThresh: 0.85 },
        { CRITICAL: 15 },
        { decideThresh: 0.6 },
      ],
    },
    {
      lambda: 0.5,
      k: 5,
      minSupport: 15,
      embedClient,
      judgeClient,
      rawLinesBySession,
      runId: CAL_RUN_ID,
      runAt: FIXED_RUN_AT,
    },
  )

  // 8) report — md/json 렌더 (SPEC §8 6대 한계 자동 인용)
  const ctx: ReportContext = {
    metrics,
    calibration: calib,
    replaySessions: replays.map((r) => r.replayResult),
    title: 'LoopBreaker 골드셋 실측 평가 리포트 (Mock judge)',
    generatedAt: FIXED_RUN_AT,
    generatedBy: 'run-eval.ts',
  }
  const md = renderReportMd(ctx)
  const json = renderReportJson(ctx)

  const mdPath = join(goldsetDir, 'eval-report.md')
  const jsonPath = join(goldsetDir, 'eval-report.json')
  writeFileSync(mdPath, md, 'utf8')
  writeFileSync(jsonPath, json, 'utf8')

  // 9) 콘솔 요약
  process.stdout.write('=== 골드셋 실측 평가 완료 ===\n')
  process.stdout.write(`골드 라벨: ${allGold.length}건 (세션 ${goldBySession.size}개)\n`)
  process.stdout.write(`  live_jsonl 세션: ${liveSessions} / 합성: ${syntheticSessions} / JSONL 누락: ${missingJsonl}\n`)
  process.stdout.write(`페어링: ${allPaired.length}건\n`)
  process.stdout.write(`macroF1: ${metrics.macroF1 ?? 'N/A(정성폴백)'} | microF1: ${metrics.microF1 ?? 'N/A'}\n`)
  process.stdout.write(`정성폴백: ${metrics.hasQualitativeFallback}\n`)
  for (const pc of metrics.perClass) {
    process.stdout.write(
      `  ${pc.kind.padEnd(14)} support=${pc.positiveCount} tp=${pc.tp} fp=${pc.fp} fn=${pc.fn} ` +
        `${pc.skipped ? '[정성폴백]' : `f1=${(pc.f1 ?? 0).toFixed(3)}`}\n`,
    )
  }
  process.stdout.write(`calibrate best candidate: #${calib.bestCandidateIndex} (정성폴백=${calib.qualitativeFallback})\n`)
  process.stdout.write(`리포트: ${mdPath}\n`)
  process.stdout.write(`        ${jsonPath}\n`)
}

main().catch((err: unknown) => {
  process.stderr.write(`run-eval 실패: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
  process.exitCode = 1
})
