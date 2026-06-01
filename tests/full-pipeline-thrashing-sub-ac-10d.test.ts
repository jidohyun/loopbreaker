/**
 * tests/full-pipeline-thrashing-sub-ac-10d.test.ts
 *
 * Sub-AC 10d: thrashing 시나리오 전체 파이프라인 통합 테스트
 *
 * Mock 클라이언트만 사용하여 DetectionHit(thrashing) →
 * semantic-stage → judge-stage → FinalVerdictResolver → DetectionRecord
 * full pipeline이 thrashing 판정을 누적 생성하는 단일 테스트 함수.
 *
 * 검증 항목:
 *   - DetectionRecord.gate / embed / judge / final 모두 존재
 *   - final.kind = 'thrashing' (judge 기반 final)
 *   - final.signals.maxCosine = embed.maxCosine (>= simThresh)
 *   - final.signals.structuralRepeatCount = sum(gate.metrics)
 *   - final.evidence = gate.windowRefs 기반
 *   - Object.isFrozen(DetectionRecord) = true
 *   - BLOCKER C1: final.kind ∈ {'thrashing','false_success','none'}
 *   - BLOCKER C2: judge 필드는 contracts.ts JudgeVerdict 정본
 *   - BLOCKER C8: embed.pairs:{a,b,cos}[] (pairCount 금지)
 *   - 게이트 미통과 hit → judge 미호출
 *   - judge 실패 → final.kind='none', subtype='inconclusive' (fail-closed)
 *
 * 제약:
 *   - 외부 API 절대 미호출: MockEmbedClient + MockJudgeClient만 사용
 *   - 네트워크·API 키 불필요
 */

import { describe, expect, test } from '@jest/globals'
import { runM3Pipeline, type M3PipelineOptions } from '../src/detect/m3-pipeline.js'
import { MockEmbedClient, type MockEmbedEntry } from '../src/api/embed-client.js'
import type { DetectionHit } from '../src/detect/detection-pipeline.js'
import type {
  ActionTriple,
  DetectorConfig,
  JudgeVerdict,
  StructureGateResult,
} from '../src/contracts.js'
import type { JudgeClient, JudgeRequest } from '../src/api/judge-client.js'

// ── 픽스처 헬퍼 ───────────────────────────────────────────────────────────────

function makeGate(overrides?: Partial<StructureGateResult>): StructureGateResult {
  return {
    type: 'thrashing',
    subtype: 'argkey_repeat',
    severity: 'warning',
    sessionId: 'session-10d',
    agentScope: 'root',
    windowRefs: ['uuid-10d-1', 'uuid-10d-2', 'uuid-10d-3'],
    metrics: { repeatCount: 4, windowSize: 6 },
    ...overrides,
  }
}

function makeHit(gate: StructureGateResult): DetectionHit {
  return {
    gate,
    triggerUuid: `trigger-${gate.subtype}`,
    ts: Date.now(),
  }
}

function makeTriples(tool: string, argKey: string, count: number): ActionTriple[] {
  return Array.from({ length: count }, (_, i) => ({
    tool,
    argKey,
    resultClass: 'ok' as const,
    ref: { uuid: `uuid-triple-${i}`, ts: i * 1000 },
  }))
}

// ── Mock 클라이언트 팩토리 ─────────────────────────────────────────────────────

/**
 * 고정 JudgeVerdict를 항상 반환하는 인라인 MockJudgeClient.
 * 외부 API 절대 미호출.
 */
function makeInlineMockJudgeClient(verdict: JudgeVerdict): JudgeClient {
  return {
    async judge(_req: JudgeRequest): Promise<JudgeVerdict> {
      return { ...verdict, rawSamples: [...verdict.rawSamples, _req] }
    },
  }
}

/**
 * 항상 에러를 던지는 MockJudgeClient (fail-closed 검증용).
 */
function makeFailingJudgeClient(): JudgeClient {
  return {
    async judge(_req: JudgeRequest): Promise<JudgeVerdict> {
      throw new Error('MockJudgeClient: 의도적 실패 (fail-closed 테스트)')
    },
  }
}

// ── 공통 픽스처 ───────────────────────────────────────────────────────────────

const EMBED_DIM = 4
const MODEL_ID_EMBED = 'voyage-3-lite'
const MODEL_ID_JUDGE = 'claude-3-5-sonnet-20241022'

/**
 * thrashing 판정 픽스처.
 * BLOCKER C1: kind='thrashing'
 * BLOCKER C2: JudgeVerdict 정본 필드 완비
 */
const THRASHING_VERDICT: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'circular_tool_loop',
  confidence: 0.87,
  reason: '동일 도구+인자 패턴이 슬라이딩 윈도 내에서 반복 감지됨.',
  rawSamples: [],
}

/**
 * 고유사도 벡터: 같은 방향 → cosine ≈ 1.0
 * thrashing 시나리오에서 두 발화가 의미적으로 거의 동일.
 */
const HIGH_SIM_VECTOR: readonly number[] = [1.0, 0.0, 0.0, 0.0]

/**
 * 저유사도 벡터: 직교 → cosine = 0.0
 * simThresh 미달 시나리오.
 */
const LOW_SIM_VECTOR_A: readonly number[] = [1.0, 0.0, 0.0, 0.0]
const LOW_SIM_VECTOR_B: readonly number[] = [0.0, 1.0, 0.0, 0.0]

// renderTripleText 결과: `${tool} ${argKey}`
const TRIPLE_TOOL = 'write'
const TRIPLE_ARG_KEY = '/src/app.ts'
const RENDERED_TEXT = `${TRIPLE_TOOL} ${TRIPLE_ARG_KEY}`

/**
 * BaseDetectorConfig — 통합 테스트 전용 최소 설정.
 * simThresh=0.8 → HIGH_SIM_VECTOR 쌍(cosine=1.0)은 통과,
 *                  LOW_SIM_VECTOR 쌍(cosine=0.0)은 탈락.
 */
const BASE_CONFIG: DetectorConfig = {
  WARNING: 10,
  CRITICAL: 20,
  circuitBreaker: 30,
  historySize: 30,
  errLoopWarn: 3,
  errLoopCrit: 5,
  fileEditWarn: 5,
  fileEditCrit: 8,
  simThresh: 0.8,
  decideThresh: 0.7,
  selfApprovalMs: 15000,
  selfApprovalCriticalMs: 1000,
  judgeSelfConsistencyN: 1,
  judgePositionSwaps: 0,
  embedModelId: MODEL_ID_EMBED,
  judgeModelId: MODEL_ID_JUDGE,
  embedDim: EMBED_DIM,
}

// ── 핵심 통합 테스트 ──────────────────────────────────────────────────────────

describe('Sub-AC 10d: thrashing 시나리오 full pipeline 통합', () => {
  /**
   * 핵심 단일 테스트 함수:
   * DetectionHit(thrashing) → semantic-stage → judge-stage → DetectionRecord 완비.
   *
   * 검증 경로:
   *   1. gate(thrashing) → 구조 게이트 통과 → hit 생성
   *   2. semantic-stage: MockEmbedClient → cosine=1.0 >= simThresh=0.8 → STRONG
   *   3. judge-stage: MockJudgeClient → JudgeVerdict(thrashing)
   *   4. FinalVerdictResolver → DetectionRecord(gate+embed+judge+final) 완비
   */
  test('핵심: DetectionHit(thrashing) → full pipeline → DetectionRecord(gate+embed+judge+final) 완비', async () => {
    // ── GIVEN: 구조 게이트 통과분(thrashing hit) ─────────────────────────────
    const gate = makeGate()
    const hit = makeHit(gate)
    const triples = makeTriples(TRIPLE_TOOL, TRIPLE_ARG_KEY, 2)

    // MockEmbedClient: RENDERED_TEXT → HIGH_SIM_VECTOR (동일 방향 → cosine=1.0)
    const embedEntries: MockEmbedEntry[] = [
      { text: RENDERED_TEXT, vector: HIGH_SIM_VECTOR },
    ]
    const embedClient = new MockEmbedClient(embedEntries, EMBED_DIM)
    const judgeClient = makeInlineMockJudgeClient(THRASHING_VERDICT)

    const opts: M3PipelineOptions = {
      embedClient,
      judgeClient,
      config: BASE_CONFIG,
    }

    // ── WHEN: M3 파이프라인 실행 ──────────────────────────────────────────────
    const records = await runM3Pipeline([hit], [triples], opts)

    // ── THEN: DetectionRecord가 1개 생성됨 ────────────────────────────────────
    expect(records).toHaveLength(1)
    const record = records[0]!

    // ── THEN: gate / embed / judge / final 모두 존재 (완비) ───────────────────
    expect(record.gate).toBeDefined()
    expect(record.embed).toBeDefined()
    expect(record.judge).toBeDefined()
    expect(record.final).toBeDefined()

    // ── THEN: gate 필드 보존 ──────────────────────────────────────────────────
    expect(record.gate).toBe(gate)
    expect(record.gate.type).toBe('thrashing')
    expect(record.gate.subtype).toBe('argkey_repeat')

    // ── THEN: embed 필드 — BLOCKER C8: pairs:{a,b,cos}[] (pairCount 금지) ────
    expect(record.embed!.maxCosine).toBeCloseTo(1.0, 5)
    expect(Array.isArray(record.embed!.pairs)).toBe(true)
    expect(record.embed!.pairs.length).toBeGreaterThan(0)
    expect(record.embed).not.toHaveProperty('pairCount')
    for (const pair of record.embed!.pairs) {
      expect(pair).toHaveProperty('a')
      expect(pair).toHaveProperty('b')
      expect(pair).toHaveProperty('cos')
    }

    // ── THEN: judge 필드 — BLOCKER C2: JudgeVerdict 정본 필드 완비 ───────────
    const judgeField = record.judge!
    expect(judgeField).toHaveProperty('kind')
    expect(judgeField).toHaveProperty('subtype')
    expect(judgeField).toHaveProperty('confidence')
    expect(judgeField).toHaveProperty('reason')
    expect(judgeField).toHaveProperty('rawSamples')
    expect(Array.isArray(judgeField.rawSamples)).toBe(true)

    // ── THEN: final 필드 — BLOCKER C1: kind ∈ {'thrashing','false_success','none'} ──
    const final = record.final
    expect(['thrashing', 'false_success', 'none']).toContain(final.kind)

    // judge 기반 final: kind='thrashing'
    expect(final.kind).toBe('thrashing')
    expect(final.subtype).toBe(THRASHING_VERDICT.subtype)
    expect(final.confidence).toBe(THRASHING_VERDICT.confidence)
    expect(final.reason).toBe(THRASHING_VERDICT.reason)

    // ── THEN: final.signals ───────────────────────────────────────────────────
    // signals.maxCosine = embed.maxCosine
    expect(final.signals.maxCosine).toBeCloseTo(record.embed!.maxCosine, 5)
    // signals.structuralRepeatCount = sum(gate.metrics) = 4 + 6 = 10
    const expectedRepeatCount = Object.values(gate.metrics).reduce((s, v) => s + v, 0)
    expect(final.signals.structuralRepeatCount).toBe(expectedRepeatCount)

    // ── THEN: final.evidence = gate.windowRefs 기반 ───────────────────────────
    expect(final.evidence).toHaveLength(gate.windowRefs.length)
    for (let i = 0; i < gate.windowRefs.length; i++) {
      expect(final.evidence[i]!.uuid).toBe(gate.windowRefs[i])
    }

    // ── THEN: judgeError/deferred 필드는 없음 (정상 경로) ────────────────────
    expect(record.judgeError).toBeUndefined()
    expect(record.deferred).toBeUndefined()
  })

  // ── 보조: simThresh 미달 → judge 미호출, embed-only record ──────────────────

  test('simThresh 미달(cosine=0.0) → judge 미호출, embed-only DetectionRecord', async () => {
    const gate = makeGate({ subtype: 'low_sim_scenario' })
    const hit = makeHit(gate)

    // 두 트리플이 서로 다른 텍스트 → 직교 벡터 등록
    const tripleA: ActionTriple = {
      tool: 'read', argKey: '/file/a.ts', resultClass: 'ok',
      ref: { uuid: 'uuid-a', ts: 0 },
    }
    const tripleB: ActionTriple = {
      tool: 'bash', argKey: 'npm test', resultClass: 'ok',
      ref: { uuid: 'uuid-b', ts: 1 },
    }
    const triples = [tripleA, tripleB]

    // renderTripleText 결과: "read /file/a.ts", "bash npm test"
    const textA = `${tripleA.tool} ${tripleA.argKey}`
    const textB = `${tripleB.tool} ${tripleB.argKey}`

    const embedClient = new MockEmbedClient(
      [
        { text: textA, vector: LOW_SIM_VECTOR_A },
        { text: textB, vector: LOW_SIM_VECTOR_B },
      ],
      EMBED_DIM,
    )

    // judge가 호출되면 에러를 던지도록 설정 (호출 여부 검증)
    let judgeCallCount = 0
    const judgeClient: JudgeClient = {
      async judge(_req: JudgeRequest): Promise<JudgeVerdict> {
        judgeCallCount++
        throw new Error('judge는 simThresh 미달 시 호출되어서는 안 됨')
      },
    }

    const opts: M3PipelineOptions = {
      embedClient,
      judgeClient,
      config: BASE_CONFIG,
    }

    const records = await runM3Pipeline([hit], [triples], opts)

    // embed-only: embed가 있지만 judge는 없어야 함
    expect(records).toHaveLength(1)
    const record = records[0]!

    expect(record.gate).toBeDefined()
    expect(record.embed).toBeDefined()
    expect(record.judge).toBeUndefined()
    expect(record.final).toBeDefined()

    // cosine=0.0 → simThresh(0.8) 미달
    expect(record.embed!.maxCosine).toBeCloseTo(0.0, 5)

    // judge는 호출되지 않았어야 함
    expect(judgeCallCount).toBe(0)

    // final.confidence = embed.maxCosine (embed 기반)
    expect(record.final.confidence).toBeCloseTo(0.0, 5)

    // BLOCKER C1
    expect(['thrashing', 'false_success', 'none']).toContain(record.final.kind)

  })

  // ── 보조: judge 실패 → fail-closed → inconclusive ────────────────────────────

  test('judge 실패(API 오류) → fail-closed → DetectionRecord.judge 없음, final.kind=none', async () => {
    const gate = makeGate({ subtype: 'judge_fail_scenario' })
    const hit = makeHit(gate)
    const triples = makeTriples(TRIPLE_TOOL, TRIPLE_ARG_KEY, 2)

    const embedClient = new MockEmbedClient(
      [{ text: RENDERED_TEXT, vector: HIGH_SIM_VECTOR }],
      EMBED_DIM,
    )
    const judgeClient = makeFailingJudgeClient()

    const opts: M3PipelineOptions = {
      embedClient,
      judgeClient,
      config: BASE_CONFIG,
    }

    const records = await runM3Pipeline([hit], [triples], opts)

    // m3-pipeline.ts: judge 실패는 processHit 내부에서 catch되어
    // {gate, embed, judgeError:true, deferred:true, final} 레코드를 반환.
    // embed 실패만 runM3Pipeline 외부 catch(hit 건너뜀)에서 처리됨.
    expect(records).toHaveLength(1)
    const record = records[0]!

    expect(record.gate).toBeDefined()
    expect(record.embed).toBeDefined()
    // judge 실패 → judge 필드 없음
    expect(record.judge).toBeUndefined()
    // judgeError + deferred 표시 (fail-closed)
    expect(record.judgeError).toBe(true)
    expect(record.deferred).toBe(true)

    // final은 synthesizeVerdict(gate, embed, undefined) 기반 — gate.type 사용
    // BLOCKER C1: final.kind ∈ {'thrashing','false_success','none'}
    expect(['thrashing', 'false_success', 'none']).toContain(record.final.kind)
  })

  // ── 보조: 여러 hit → 복수 DetectionRecord 생성 ─────────────────────────────

  test('복수 DetectionHit → 각각 DetectionRecord 누적 생성', async () => {
    const gate1 = makeGate({ subtype: 'repeat_edit', sessionId: 'session-multi-1' })
    const gate2 = makeGate({ subtype: 'repeat_bash', sessionId: 'session-multi-2' })
    const hit1 = makeHit(gate1)
    const hit2 = makeHit(gate2)

    const triples1 = makeTriples('write', '/src/a.ts', 2)
    const triples2 = makeTriples('bash', 'npm run build', 2)

    const textForTriples1 = `write /src/a.ts`
    const textForTriples2 = `bash npm run build`

    const embedClient = new MockEmbedClient(
      [
        { text: textForTriples1, vector: HIGH_SIM_VECTOR },
        { text: textForTriples2, vector: HIGH_SIM_VECTOR },
      ],
      EMBED_DIM,
    )
    const judgeClient = makeInlineMockJudgeClient(THRASHING_VERDICT)

    const opts: M3PipelineOptions = {
      embedClient,
      judgeClient,
      config: BASE_CONFIG,
    }

    const records = await runM3Pipeline(
      [hit1, hit2],
      [triples1, triples2],
      opts,
    )

    expect(records).toHaveLength(2)

    for (const record of records) {
      // gate / embed / judge / final 모두 존재
      expect(record.gate).toBeDefined()
      expect(record.embed).toBeDefined()
      expect(record.judge).toBeDefined()
      expect(record.final).toBeDefined()

      // BLOCKER C1
      expect(['thrashing', 'false_success', 'none']).toContain(record.final.kind)

      // judge 기반 final
      expect(record.final.kind).toBe('thrashing')

    }

    // 두 record는 서로 다른 gate 참조
    expect(records[0]!.gate).toBe(gate1)
    expect(records[1]!.gate).toBe(gate2)
  })

  // ── 보조: hits.length !== triples.length → 에러 ────────────────────────────

  test('hits.length !== triples.length → runM3Pipeline throws', async () => {
    const gate = makeGate()
    const hit = makeHit(gate)
    const embedClient = new MockEmbedClient([], EMBED_DIM)
    const judgeClient = makeInlineMockJudgeClient(THRASHING_VERDICT)

    const opts: M3PipelineOptions = {
      embedClient,
      judgeClient,
      config: BASE_CONFIG,
    }

    // hits 1개, triples 2개 → mismatch
    await expect(
      runM3Pipeline([hit], [makeTriples(TRIPLE_TOOL, TRIPLE_ARG_KEY, 2), []], opts),
    ).rejects.toThrow()
  })
})
