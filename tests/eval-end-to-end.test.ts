// tests/eval-end-to-end.test.ts
//
// M6 평가 하니스 end-to-end 통합 테스트.
//
// 흐름: 합성 세션 JSONL → mineCandidates(+seed-dohyun) → label(Mock io) →
//       gold-label-store 적재 → replaySession(Mock embed/judge) →
//       computeMetrics → calibrate → renderReportMd/Json.
//
// 부수효과 0 (M6 최우선 계약):
//   - 합성 세션은 인라인 JSONL string[] (실 ~/.claude·~/.dohyun·~/Desktop 미접근).
//   - API는 MockEmbedClient/MockJudgeClient만 (실 네트워크 0).
//   - DB는 os.tmpdir() 임시 eval DB만 (실 ops.db/eval.db 미사용).
//   - 정상 세션(none) → 구조 게이트 미발화 → embed 미호출(빈 fixture가 throw로 회귀 감지).

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { StorageLayer } from '../src/storage/storage-layer.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'
import { processReplayInput, replaySession } from '../src/eval/replay-session.js'
import { mineCandidates } from '../src/eval/mine-candidates.js'
import { buildDohyunSeedLabels } from '../src/eval/seed-dohyun.js'
import {
  insertGoldLabels,
  queryGoldLabelsBySession,
  countGoldLabels,
} from '../src/eval/gold-label-store.js'
import { computeMetrics, buildPairedLabels } from '../src/eval/metrics.js'
import { calibrate } from '../src/eval/calibrate.js'
import { renderReportMd, renderReportJson } from '../src/eval/report.js'
import { parseLabel, formatCandidate, type LabelCliIO } from '../src/eval/cli/label-cli.js'
import { MockEmbedClient } from '../src/api/embed-client.js'
import { MockJudgeClient } from '../src/api/judge-client.js'
import type { StoredEvent } from '../src/ingest/event-store.js'
import type {
  GoldLabel,
  GoldSampleEnvelope,
  ReportContext,
} from '../src/eval/eval-contracts.js'

// ── 합성 세션 (정상 흐름 → 게이트 미발화 → embed 미호출) ──────────────────────

const SESSION_ID = 'e2e-eval-session-001'
const CWD = '/tmp/e2e-proj'

function evt(o: object): string {
  return JSON.stringify(o)
}

const JSONL_LINES: readonly string[] = [
  evt({
    type: 'user',
    uuid: 'e2e-u1',
    parentUuid: null,
    sessionId: SESSION_ID,
    cwd: CWD,
    timestamp: '2026-05-01T10:00:00.000Z',
    isSidechain: false,
    message: { role: 'user', content: 'task A' },
  }),
  evt({
    type: 'assistant',
    uuid: 'e2e-a1',
    parentUuid: 'e2e-u1',
    sessionId: SESSION_ID,
    cwd: CWD,
    timestamp: '2026-05-01T10:00:01.000Z',
    isSidechain: false,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file: 'a.ts' } }],
    },
  }),
  evt({
    type: 'user',
    uuid: 'e2e-u2',
    parentUuid: 'e2e-a1',
    sessionId: SESSION_ID,
    cwd: CWD,
    timestamp: '2026-05-01T10:00:02.000Z',
    isSidechain: false,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
  }),
]

// ── 임시 eval DB 관리 ─────────────────────────────────────────────────────────

describe('M6 평가 하니스 end-to-end (mine→label→store→replay→metrics→calibrate→report)', () => {
  let dir: string
  let layer: StorageLayer

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lb-m6-e2e-'))
    layer = new StorageLayer()
    layer.open(join(dir, 'op.db'), join(dir, 'eval.db'), { embedDim: 1024 })
  })

  afterEach(async () => {
    try {
      await layer.close()
    } catch {
      // 정리 실패는 결과에 영향 없음
    }
    rmSync(dir, { recursive: true, force: true })
  })

  test('전 구간이 합성 픽스처·Mock·임시 DB로 부수효과 0으로 흐른다', async () => {
    const fixedNow = 1_700_000_000_000

    // ── 1) MINE: 합성 세션 → NormalizedEvent → mineCandidates (judge 0) ──
    const { events } = processReplayInput([...JSONL_LINES])
    const candidates = mineCandidates(
      events as unknown as readonly StoredEvent[],
      SESSION_ID,
      DEFAULT_DETECTOR_CONFIG,
      fixedNow,
    )
    expect(Array.isArray(candidates)).toBe(true)

    // ── 2) LABEL: dohyun 5건 시드 + 후보 라벨링(Mock io) ──
    const seedLabels = buildDohyunSeedLabels()
    expect(seedLabels).toHaveLength(5)
    expect(seedLabels.every((l) => l.source === 'dohyun_adapted')).toBe(true)
    expect(seedLabels.every((l) => l.expectedSignal === 'false_success')).toBe(true)

    // Mock LabelCliIO — write는 수집, read는 항상 'tp'(positive) 반환
    const written: string[] = []
    const io: LabelCliIO = {
      write: (s: string) => {
        written.push(s)
      },
      read: async () => 'tp',
    }
    // 라벨링 루프 (runLabeler 부재 → formatCandidate + parseLabel 인라인 사용)
    const minedLabels: GoldLabel[] = []
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!
      io.write(formatCandidate(c))
      const labelValue = parseLabel(await io.read('label?'))
      // tp/fn → positive(해당 kind), fp/tn → none
      const expectedSignal =
        labelValue === 'tp' || labelValue === 'fn' ? c.kind : ('none' as const)
      minedLabels.push({
        labelId: `e2e-mined-${i}`,
        labelKind: c.startUuid !== undefined ? 'span' : 'point',
        ...(c.anchorUuid !== undefined ? { anchorUuid: c.anchorUuid } : {}),
        ...(c.startUuid !== undefined ? { startUuid: c.startUuid } : {}),
        ...(c.endUuid !== undefined ? { endUuid: c.endUuid } : {}),
        sessionId: c.sessionId,
        expectedSignal,
        source: 'synthetic',
        labelerId: 'test',
        labelRound: 1,
        labeledAt: fixedNow,
      })
    }
    expect(written.length).toBe(candidates.length)
    const allLabels: GoldLabel[] = [...seedLabels, ...minedLabels]

    // ── 3) GOLD-STORE: eval DB 적재 + 조회 ──
    const inserted = insertGoldLabels(layer.evalDb, allLabels)
    expect(inserted).toBe(allLabels.length)
    expect(countGoldLabels(layer.evalDb)).toBe(allLabels.length)
    const firstSession = allLabels[0]!.sessionId
    const back = queryGoldLabelsBySession(layer.evalDb, firstSession)
    expect(back.length).toBeGreaterThan(0)

    // ── 4) REPLAY: Mock embed/judge. 정상 세션 → 게이트 미발화 → records 0(embed 미호출) ──
    const embedClient = new MockEmbedClient([], 1024) // 빈 fixture: 호출되면 throw → 회귀 감지
    const judgeClient = new MockJudgeClient([])
    const records = await replaySession([...JSONL_LINES], {
      recordIsReplay: true,
      pipelineOpts: { embedClient, judgeClient, config: DEFAULT_DETECTOR_CONFIG },
    })
    expect(Array.isArray(records)).toBe(true)
    for (const r of records) {
      expect(r.is_replay).toBe(1) // 평가 모드 플래그
    }

    // ── 5) METRICS: 페어링 → computeMetrics ──
    const orderedUuids = events.map((e) => e.uuid)
    const paired = buildPairedLabels({
      golds: back.map((l) => ({
        goldKind: l.expectedSignal,
        ...(l.startUuid !== undefined ? { goldStartUuid: l.startUuid } : {}),
        ...(l.endUuid !== undefined ? { goldEndUuid: l.endUuid } : {}),
        goldAnchorUuid: l.anchorUuid ?? null,
        goldSessionId: l.sessionId,
      })),
      preds: records.map((r) => ({
        anchorUuid: r.final.evidence[0]?.uuid ?? r.gate.windowRefs[0] ?? '',
        kind: r.final.kind,
        windowRefs: r.gate.windowRefs,
        sessionId: r.gate.sessionId,
        confidence: r.final.confidence,
      })),
      orderedUuids,
      sessionId: firstSession,
      k: 5,
      iouThreshold: 0.5,
    })
    const metrics = computeMetrics({
      paired,
      gold: allLabels,
      minSupport: 15,
      runId: 'e2e-run',
      runAt: fixedNow,
      detectorConfigId: 'default',
      embedModelId: DEFAULT_DETECTOR_CONFIG.embedModelId,
      isReplay: true,
    })
    expect(metrics.goldCount).toBe(allLabels.length)
    // false_success 양성 5건 < minSupport 15 → 정성폴백
    expect(metrics.hasQualitativeFallback).toBe(true)

    // ── 6) CALIBRATE: 격자탐색 (소표본 → grid 축소 + 정성폴백) ──
    const envelopes: GoldSampleEnvelope[] = [
      { envelopeId: SESSION_ID, events, labels: back, source: 'synthetic' },
    ]
    const rawLinesBySession = new Map<string, readonly string[]>([[SESSION_ID, JSONL_LINES]])
    const calib = await calibrate(
      allLabels,
      envelopes,
      { candidates: [{}, { simThresh: 0.85 }, { CRITICAL: 15 }, { decideThresh: 0.6 }] },
      { lambda: 0.5, k: 5, minSupport: 15, embedClient, judgeClient, rawLinesBySession, runId: 'e2e-cal', runAt: fixedNow },
    )
    expect(calib.qualitativeFallback).toBe(true) // 소표본
    expect(calib.candidateResults.length).toBeLessThanOrEqual(3) // grid 축소
    // 원본 DEFAULT_DETECTOR_CONFIG 불변
    expect(DEFAULT_DETECTOR_CONFIG.simThresh).toBe(0.9)
    expect(calib.bestConfig).not.toBe(DEFAULT_DETECTOR_CONFIG)

    // ── 7) REPORT: md/json 렌더 + SPEC §8 6대 한계 인용 ──
    const ctx: ReportContext = {
      metrics,
      calibration: calib,
      replaySessions: [
        {
          sessionId: SESSION_ID,
          replayAt: fixedNow,
          eventCount: events.length,
          detections: records,
          recordedDetectionIds: [],
          durationMs: 0,
          errors: [],
        },
      ],
      generatedAt: fixedNow,
    }
    const md = renderReportMd(ctx)
    const json = renderReportJson(ctx)

    // 6대 한계 키워드 전부 포함
    for (const kw of ['0.72', 'arXiv:2511.10650', 'Wilson', 'intra-rater', 'nested', '정밀도 X%']) {
      expect(md).toContain(kw)
    }
    // 소표본 정성폴백 경고 표기
    expect(md).toContain('정성폴백')
    // json 파싱 가능 + limitations 6개
    const parsed = JSON.parse(json) as { limitations: string[] }
    expect(parsed.limitations.length).toBe(6)
  })

  test('동일 입력 → 동일 calibrate 결과 (결정론)', async () => {
    const fixedNow = 1_700_000_000_000
    const seedLabels = buildDohyunSeedLabels()
    insertGoldLabels(layer.evalDb, seedLabels)
    const embedClient = new MockEmbedClient([], 1024)
    const judgeClient = new MockJudgeClient([])
    const envelopes: GoldSampleEnvelope[] = []
    const rawLinesBySession = new Map<string, readonly string[]>()
    const grid = { candidates: [{}, { simThresh: 0.85 }] }
    const opts = {
      lambda: 0.5,
      k: 5,
      minSupport: 15,
      embedClient,
      judgeClient,
      rawLinesBySession,
      runId: 'det-run',
      runAt: fixedNow,
    }
    const a = await calibrate(seedLabels, envelopes, grid, opts)
    const b = await calibrate(seedLabels, envelopes, grid, opts)
    expect(a.bestCandidateIndex).toBe(b.bestCandidateIndex)
    expect(a.bestObjective).toBe(b.bestObjective)
    expect(a.bestConfig).toEqual(b.bestConfig)
  })
})
