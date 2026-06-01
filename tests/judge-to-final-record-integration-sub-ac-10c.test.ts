/**
 * tests/judge-to-final-record-integration-sub-ac-10c.test.ts
 *
 * Sub-AC 10c: judge-stage → FinalVerdictResolver → DetectionRecord 생성 통합 테스트
 *
 * JudgeVerdict 입력으로 FinalVerdictResolver가 DetectionRecord
 * (gate→embed→judge→final 필드 완비)를 올바르게 조립하는 단일 테스트 함수.
 *
 * 검증 경로:
 *   1. JudgeVerdict (Mock) → runJudgeStage → JudgeStageResult
 *   2. JudgeStageResult.verdict → buildDetectionRecord_judge → PendingDetectionRecord
 *   3. PendingDetectionRecord → resolveDetectionRecord → DetectionRecord
 *   4. DetectionRecord.final (FinalVerdictResolver 산출) 완비 검증
 *
 * 검증 항목:
 *   - gate / embed / judge / final 필드 모두 존재
 *   - final.kind = judge.kind (judge 기반 final)
 *   - final.confidence = judge.confidence
 *   - final.reason = judge.reason
 *   - final.signals.maxCosine = embed.maxCosine
 *   - final.signals.structuralRepeatCount = sum(gate.metrics)
 *   - final.evidence = gate.windowRefs 기반
 *   - DetectionRecord는 Object.isFrozen
 *   - BLOCKER C1: final.kind ∈ {'thrashing','false_success','none'}
 *   - BLOCKER C2: judge 필드는 contracts.ts JudgeVerdict 정본
 *   - BLOCKER C8: embed.pairs:{a,b,cos}[] (pairCount 금지)
 *   - judge 실패(judgeError) 시 final.kind='none', subtype='inconclusive'
 *
 * 제약:
 *   - 외부 API 절대 미호출: 인라인 MockJudgeClient만 사용
 *   - 네트워크·API 키 불필요
 */

import { describe, expect, test } from '@jest/globals'
import { runJudgeStage } from '../src/detect/run-judge-stage.js'
import {
  buildDetectionRecord_gate,
  buildDetectionRecord_embed,
  buildDetectionRecord_judge,
  buildDetectionRecord_judgeError,
  resolveDetectionRecord,
} from '../src/detect/build-detection-record.js'
import type { GateCandidate } from '../src/detect/filter-gate-passed.js'
import type { PositionSwapContext } from '../src/detect/build-position-swapped-pairs.js'
import type {
  EmbeddingSimilarityResult,
  JudgeVerdict,
  StructureGateResult,
} from '../src/contracts.js'
import type { JudgeClient, JudgeRequest } from '../src/api/judge-client.js'

// ── 픽스처 ────────────────────────────────────────────────────────────────────

function makeGate(overrides?: Partial<StructureGateResult>): StructureGateResult {
  return {
    type: 'thrashing',
    subtype: 'argkey_repeat',
    severity: 'warning',
    sessionId: 'session-10c',
    agentScope: 'root',
    windowRefs: ['uuid-gate-1', 'uuid-gate-2'],
    metrics: { repeatCount: 5, windowSize: 8 },
    ...overrides,
  }
}

function makeEmbed(maxCosine = 0.95): EmbeddingSimilarityResult {
  return {
    maxCosine,
    pairs: [{ a: 'text-a', b: 'text-b', cos: maxCosine }],
  }
}

const FALSE_SUCCESS_VERDICT: JudgeVerdict = {
  kind: 'false_success',
  subtype: 'unsupported_completion_claim',
  confidence: 0.88,
  circularReference: false,
  reason: '근거 없는 완료 선언이 감지되었습니다.',
  rawSamples: [],
}

const THRASHING_VERDICT: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'circular_tool_loop',
  confidence: 0.82,
  reason: '동일 도구 패턴이 반복되었습니다.',
  rawSamples: [],
}

/**
 * 인라인 MockJudgeClient — 고정 JudgeVerdict를 반환한다.
 * 외부 API 절대 미호출.
 */
function makeMockJudgeClient(verdict: JudgeVerdict): JudgeClient {
  return {
    async judge(_req: JudgeRequest): Promise<JudgeVerdict> {
      return verdict
    },
  }
}

const GATE_PASSED: GateCandidate = {
  gate: null,
  gate_passed: true,
  triggerUuid: 'uuid-10c-trigger',
  ts: Date.now(),
}

const GATE_FAILED: GateCandidate = {
  gate: null,
  gate_passed: false,
  triggerUuid: 'uuid-10c-trigger-fail',
  ts: Date.now(),
}

function makeCtx(): PositionSwapContext {
  return {
    positionA: 'write /src/app.ts — attempt 1',
    positionB: 'write /src/app.ts — attempt 2',
    cacheableBlock: '루브릭: 아래 두 발화가 false_success 패턴인지 판정하라.',
    modelId: 'claude-3-5-sonnet-20241022',
    kind: 'false_success',
    temperature: 0,
  }
}

// ── 핵심 통합 테스트 ──────────────────────────────────────────────────────────

describe('Sub-AC 10c: judge-stage → FinalVerdictResolver → DetectionRecord 통합', () => {
  /**
   * 핵심 단일 테스트 함수:
   * JudgeVerdict → FinalVerdictResolver → DetectionRecord(gate→embed→judge→final) 완비 검증
   */
  test('JudgeVerdict(false_success) → FinalVerdictResolver → DetectionRecord gate/embed/judge/final 완비', async () => {
    // ── STEP 1: gate 단계 레코드 초기화 ─────────────────────────────────────
    const gate = makeGate({ type: 'false_success', subtype: 'self_approval' })
    const embed = makeEmbed(0.93)

    const gateRecord = buildDetectionRecord_gate(gate)

    // gate만 채워진 상태 확인
    expect(gateRecord.gate).toBe(gate)
    expect(gateRecord.embed).toBeUndefined()
    expect(gateRecord.judge).toBeUndefined()
    expect(gateRecord.final).toBeUndefined()

    // ── STEP 2: embed 단계 레코드 추가 ───────────────────────────────────────
    const embedRecord = buildDetectionRecord_embed(gateRecord, embed)

    expect(embedRecord.gate).toBe(gate)
    expect(embedRecord.embed).toBe(embed)
    expect(embedRecord.judge).toBeUndefined()

    // 단조 누적 검증: 원본 레코드 불변
    expect(gateRecord.embed).toBeUndefined()

    // ── STEP 3: judge-stage 실행 → JudgeStageResult ──────────────────────────
    const judgeClient = makeMockJudgeClient(FALSE_SUCCESS_VERDICT)
    const ctx = makeCtx()

    // selfConsistencyN=1 → 원본(1회) + swap(1회) = 2회 호출
    const stageResult = await runJudgeStage(GATE_PASSED, judgeClient, ctx, 1)

    expect(stageResult.skipped).toBe(false)
    expect(stageResult.verdict).toBeDefined()
    // rawSamples에 1×2=2개 응답 보존 (SPEC §5)
    expect(stageResult.verdict!.rawSamples).toHaveLength(2)

    // ── STEP 4: judge 결과를 레코드에 append ─────────────────────────────────
    const judgeRecord = buildDetectionRecord_judge(embedRecord, stageResult.verdict!)

    expect(judgeRecord.gate).toBe(gate)
    expect(judgeRecord.embed).toBe(embed)
    expect(judgeRecord.judge).toBe(stageResult.verdict)
    expect(judgeRecord.final).toBeUndefined()

    // 단조 누적 검증: 이전 레코드 불변
    expect(embedRecord.judge).toBeUndefined()

    // ── STEP 5: FinalVerdictResolver → DetectionRecord 완성 ──────────────────
    const detectionRecord = resolveDetectionRecord(judgeRecord)

    // gate/embed/judge/final 필드 모두 존재 (완비)
    expect(detectionRecord.gate).toBeDefined()
    expect(detectionRecord.embed).toBeDefined()
    expect(detectionRecord.judge).toBeDefined()
    expect(detectionRecord.final).toBeDefined()

    // ── STEP 6: DetectionRecord.final 내용 검증 (FinalVerdictResolver 정확성) ─

    const final = detectionRecord.final

    // BLOCKER C1: final.kind ∈ {'thrashing','false_success','none'}
    expect(['thrashing', 'false_success', 'none']).toContain(final.kind)

    // judge 기반 final: judge.kind/subtype/confidence/reason 사용
    expect(final.kind).toBe(stageResult.verdict!.kind)
    expect(final.subtype).toBe(stageResult.verdict!.subtype)
    expect(final.confidence).toBe(stageResult.verdict!.confidence)
    expect(final.reason).toBe(stageResult.verdict!.reason)

    // signals.maxCosine = embed.maxCosine
    expect(final.signals.maxCosine).toBe(embed.maxCosine)

    // signals.structuralRepeatCount = sum(gate.metrics) = 5+8 = 13
    expect(final.signals.structuralRepeatCount).toBe(
      Object.values(gate.metrics).reduce((sum, v) => sum + v, 0),
    )

    // evidence = gate.windowRefs 기반
    expect(final.evidence).toHaveLength(gate.windowRefs.length)
    expect(final.evidence[0]!.uuid).toBe(gate.windowRefs[0])
    expect(final.evidence[1]!.uuid).toBe(gate.windowRefs[1])

    // ── STEP 7: 불변성 검증 ──────────────────────────────────────────────────
    expect(Object.isFrozen(detectionRecord)).toBe(true)

    // ── STEP 8: BLOCKER C2 — judge 필드는 contracts.ts JudgeVerdict 정본 ──────
    const judgeField = detectionRecord.judge!
    expect(judgeField).toHaveProperty('kind')
    expect(judgeField).toHaveProperty('subtype')
    expect(judgeField).toHaveProperty('confidence')
    expect(judgeField).toHaveProperty('reason')
    expect(judgeField).toHaveProperty('rawSamples')
    expect(Array.isArray(judgeField.rawSamples)).toBe(true)

    // ── STEP 9: BLOCKER C8 — embed.pairs:{a,b,cos}[] (pairCount 금지) ─────────
    expect(detectionRecord.embed).not.toHaveProperty('pairCount')
    expect(Array.isArray(detectionRecord.embed!.pairs)).toBe(true)
    for (const pair of detectionRecord.embed!.pairs) {
      expect(pair).toHaveProperty('a')
      expect(pair).toHaveProperty('b')
      expect(pair).toHaveProperty('cos')
    }
  })

  // ── 보조: thrashing kind로도 동일 조립 경로 동작 ─────────────────────────

  test('JudgeVerdict(thrashing) → FinalVerdictResolver → final.kind=thrashing 검증', async () => {
    const gate = makeGate({ type: 'thrashing', subtype: 'argkey_repeat' })
    const embed = makeEmbed(0.91)

    const judgeClient = makeMockJudgeClient(THRASHING_VERDICT)
    const ctx = makeCtx()
    const stageResult = await runJudgeStage(GATE_PASSED, judgeClient, ctx, 1)

    const record = resolveDetectionRecord(
      buildDetectionRecord_judge(
        buildDetectionRecord_embed(buildDetectionRecord_gate(gate), embed),
        stageResult.verdict!,
      ),
    )

    expect(record.final.kind).toBe('thrashing')
    expect(record.final.confidence).toBe(THRASHING_VERDICT.confidence)
    expect(record.gate).toBeDefined()
    expect(record.embed).toBeDefined()
    expect(record.judge).toBeDefined()
  })

  // ── 보조: judge 실패(judgeError) 시 final='inconclusive' ─────────────────

  test('judge 실패(judgeError) → DetectionRecord.final.kind=none, subtype=inconclusive', () => {
    const gate = makeGate()
    const embed = makeEmbed(0.92)

    const withJudgeError = buildDetectionRecord_judgeError(
      buildDetectionRecord_embed(buildDetectionRecord_gate(gate), embed),
    )

    const record = resolveDetectionRecord(withJudgeError)

    // SPEC §4 fail-closed: judge 실패 → inconclusive
    expect(record.final.kind).toBe('none')
    expect(record.final.subtype).toBe('inconclusive')
    expect(record.final.confidence).toBe(0)
    expect(record.final.reason).toMatch(/judge|API|미확정|deferred/i)

    // gate/embed 보존
    expect(record.gate).toBeDefined()
    expect(record.embed).toBeDefined()
    // judge 필드는 없고 judgeError:true 표시
    expect(record.judge).toBeUndefined()
    expect(record.judgeError).toBe(true)
    expect(record.deferred).toBe(true)

    expect(Object.isFrozen(record)).toBe(true)
  })

  // ── 보조: gate 미통과 후보는 judge 건너뜀 ────────────────────────────────

  test('gate_passed=false 후보 → judge 미호출(skipped=true), gate-only DetectionRecord', async () => {
    const gate = makeGate()

    const judgeClient = makeMockJudgeClient(FALSE_SUCCESS_VERDICT)
    const ctx = makeCtx()

    // gate_passed=false → skipped=true
    const stageResult = await runJudgeStage(GATE_FAILED, judgeClient, ctx, 1)
    expect(stageResult.skipped).toBe(true)
    expect(stageResult.verdict).toBeUndefined()

    // judge 미호출이므로 gate-only DetectionRecord 조립
    const record = resolveDetectionRecord(buildDetectionRecord_gate(gate))

    expect(record.gate).toBeDefined()
    expect(record.embed).toBeUndefined()
    expect(record.judge).toBeUndefined()

    // gate-only → confidence=0, 의미 단계 미진행
    expect(record.final.confidence).toBe(0)
    expect(record.final.reason).toMatch(/미진행|의미 단계/)
  })

  // ── 단조 누적 불변성: 각 단계 빌더는 원본을 변경하지 않는다 ──────────────

  test('단조 누적 불변성: buildDetectionRecord_* 각 단계는 원본 레코드를 변경하지 않는다', async () => {
    const gate = makeGate()
    const embed = makeEmbed(0.94)

    // STEP 1: gate-only
    const r0 = buildDetectionRecord_gate(gate)
    const r0Snap = { ...r0 }

    // STEP 2: embed append
    const r1 = buildDetectionRecord_embed(r0, embed)
    // r0는 변경되지 않아야 함
    expect(r0.embed).toBeUndefined()
    expect(r0.gate).toBe(r0Snap.gate)

    // STEP 3: judge append
    const judgeClient = makeMockJudgeClient(FALSE_SUCCESS_VERDICT)
    const stageResult = await runJudgeStage(GATE_PASSED, judgeClient, makeCtx(), 1)
    const r2 = buildDetectionRecord_judge(r1, stageResult.verdict!)
    // r1는 변경되지 않아야 함
    expect(r1.judge).toBeUndefined()
    expect(r1.embed).toBe(embed)

    // STEP 4: resolve
    const r3 = resolveDetectionRecord(r2)
    // r2는 변경되지 않아야 함 (final은 PendingDetectionRecord에 없었음)
    expect(r2.final).toBeUndefined()
    // r3은 완전한 DetectionRecord
    expect(r3.final).toBeDefined()
    expect(Object.isFrozen(r3)).toBe(true)
  })
})
