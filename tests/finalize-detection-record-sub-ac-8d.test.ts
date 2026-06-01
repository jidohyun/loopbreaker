/**
 * tests/finalize-detection-record-sub-ac-8d.test.ts
 *
 * Sub-AC 8d: finalizeDetectionRecord (resolveDetectionRecord) 함수 단위 테스트
 *
 * 검증 항목:
 *   1. gate→embed→judge→final 모든 필드가 존재하는 완전한 DetectionRecord 반환
 *   2. 단조 누적 순서 보장: gate 먼저, embed 다음, judge 다음, final 마지막
 *   3. judge 결과 있으면 final이 judge 기반으로 설정됨
 *   4. embed만 있고 judge 없으면 final이 embed 기반으로 설정됨
 *   5. gate만 있으면 final이 gate 기반, confidence=0
 *   6. judgeError=true이면 final.kind='none', reason에 'inconclusive' 포함
 *   7. judge kind 세 가지('thrashing', 'false_success', 'none') 모두 처리
 *   8. 반환된 DetectionRecord는 frozen (불변성)
 *   9. final.signals에 maxCosine(embed 있으면)과 structuralRepeatCount가 설정됨
 *  10. final.evidence가 gate.windowRefs 기반으로 생성됨
 *  11. DetectionRecord.final은 반드시 존재 (contracts 정본)
 */

import { describe, expect, it } from '@jest/globals'
import {
  buildDetectionRecord_gate,
  buildDetectionRecord_embed,
  buildDetectionRecord_judge,
  buildDetectionRecord_judgeError,
  resolveDetectionRecord,
} from '../src/detect/build-detection-record.js'
import type {
  EmbeddingSimilarityResult,
  JudgeVerdict,
  StructureGateResult,
  DetectionRecord,
} from '../src/contracts.js'

// ─── 픽스처 ──────────────────────────────────────────────────────────────────

function makeGate(overrides?: Partial<StructureGateResult>): StructureGateResult {
  return {
    type: 'thrashing',
    subtype: 'argkey_repeat',
    severity: 'warning',
    sessionId: 'session-001',
    agentScope: 'root',
    windowRefs: ['uuid-1', 'uuid-2', 'uuid-3'],
    metrics: { repeatCount: 5, windowSize: 10 },
    ...overrides,
  }
}

function makeEmbedResult(maxCosine = 0.95): EmbeddingSimilarityResult {
  return {
    maxCosine,
    pairs: [{ a: 'text-a', b: 'text-b', cos: maxCosine }],
  }
}

function makeJudgeVerdict(
  kind: JudgeVerdict['kind'] = 'thrashing',
  overrides?: Partial<JudgeVerdict>,
): JudgeVerdict {
  return {
    kind,
    subtype: 'repeated_tool_call',
    confidence: 0.88,
    reason: 'Agent is calling the same tool repeatedly without progress.',
    rawSamples: ['sample-1', 'sample-2'],
    ...overrides,
  }
}

// ─── 완전한 DetectionRecord (gate→embed→judge→final) ─────────────────────────

describe('resolveDetectionRecord — 완전한 레코드 (Sub-AC 8d)', () => {
  it('gate→embed→judge가 누적된 레코드를 resolve하면 완전한 DetectionRecord를 반환한다', () => {
    const gate = makeGate()
    const embed = makeEmbedResult(0.95)
    const judge = makeJudgeVerdict('thrashing')

    const pending = buildDetectionRecord_judge(
      buildDetectionRecord_embed(buildDetectionRecord_gate(gate), embed),
      judge,
    )
    const record: DetectionRecord = resolveDetectionRecord(pending)

    // 모든 필드 존재
    expect(record.gate).toBeDefined()
    expect(record.embed).toBeDefined()
    expect(record.judge).toBeDefined()
    expect(record.final).toBeDefined()
  })

  it('단조 누적 순서: gate → embed → judge → final 필드 각각 원본과 동일', () => {
    const gate = makeGate()
    const embed = makeEmbedResult(0.95)
    const judge = makeJudgeVerdict('thrashing')

    const pending = buildDetectionRecord_judge(
      buildDetectionRecord_embed(buildDetectionRecord_gate(gate), embed),
      judge,
    )
    const record = resolveDetectionRecord(pending)

    expect(record.gate).toBe(gate)
    expect(record.embed).toBe(embed)
    expect(record.judge).toBe(judge)
  })

  it('judge 결과 있으면 final.kind/subtype/confidence/reason이 judge 기반', () => {
    const gate = makeGate()
    const embed = makeEmbedResult(0.95)
    const judge = makeJudgeVerdict('thrashing', {
      subtype: 'circular_tool_loop',
      confidence: 0.92,
      reason: 'Judge says thrashing detected.',
    })

    const record = resolveDetectionRecord(
      buildDetectionRecord_judge(
        buildDetectionRecord_embed(buildDetectionRecord_gate(gate), embed),
        judge,
      ),
    )

    expect(record.final.kind).toBe('thrashing')
    expect(record.final.subtype).toBe('circular_tool_loop')
    expect(record.final.confidence).toBe(0.92)
    expect(record.final.reason).toBe('Judge says thrashing detected.')
  })

  it('judge.kind=false_success이면 final.kind도 false_success (BLOCKER C1)', () => {
    const gate = makeGate({ type: 'false_success', subtype: 'self_approval' })
    const embed = makeEmbedResult(0.96)
    const judge = makeJudgeVerdict('false_success', { subtype: 'self_approval' })

    const record = resolveDetectionRecord(
      buildDetectionRecord_judge(
        buildDetectionRecord_embed(buildDetectionRecord_gate(gate), embed),
        judge,
      ),
    )

    expect(record.final.kind).toBe('false_success')
    expect(record.final.subtype).toBe('self_approval')
  })

  it('judge.kind=none이면 final.kind도 none', () => {
    const gate = makeGate()
    const embed = makeEmbedResult(0.94)
    const judge = makeJudgeVerdict('none', { subtype: 'no_issue', confidence: 0.1, reason: 'no issue' })

    const record = resolveDetectionRecord(
      buildDetectionRecord_judge(
        buildDetectionRecord_embed(buildDetectionRecord_gate(gate), embed),
        judge,
      ),
    )

    expect(record.final.kind).toBe('none')
  })

  it('final.signals에 maxCosine이 포함된다 (embed 있을 때)', () => {
    const gate = makeGate()
    const embed = makeEmbedResult(0.95)
    const judge = makeJudgeVerdict()

    const record = resolveDetectionRecord(
      buildDetectionRecord_judge(
        buildDetectionRecord_embed(buildDetectionRecord_gate(gate), embed),
        judge,
      ),
    )

    expect(record.final.signals.maxCosine).toBe(0.95)
  })

  it('final.signals.structuralRepeatCount가 gate.metrics 값의 합으로 설정된다', () => {
    const gate = makeGate({ metrics: { repeatCount: 5, windowSize: 10 } })
    const embed = makeEmbedResult(0.95)
    const judge = makeJudgeVerdict()

    const record = resolveDetectionRecord(
      buildDetectionRecord_judge(
        buildDetectionRecord_embed(buildDetectionRecord_gate(gate), embed),
        judge,
      ),
    )

    expect(record.final.signals.structuralRepeatCount).toBe(15)
  })

  it('final.evidence가 gate.windowRefs 기반으로 생성된다', () => {
    const gate = makeGate({ windowRefs: ['ref-a', 'ref-b', 'ref-c'] })
    const embed = makeEmbedResult(0.95)
    const judge = makeJudgeVerdict()

    const record = resolveDetectionRecord(
      buildDetectionRecord_judge(
        buildDetectionRecord_embed(buildDetectionRecord_gate(gate), embed),
        judge,
      ),
    )

    expect(record.final.evidence).toHaveLength(3)
    expect(record.final.evidence[0].uuid).toBe('ref-a')
    expect(record.final.evidence[1].uuid).toBe('ref-b')
    expect(record.final.evidence[2].uuid).toBe('ref-c')
  })

  it('반환된 DetectionRecord는 Object.isFrozen이다', () => {
    const record = resolveDetectionRecord(
      buildDetectionRecord_judge(
        buildDetectionRecord_embed(buildDetectionRecord_gate(makeGate()), makeEmbedResult()),
        makeJudgeVerdict(),
      ),
    )

    expect(Object.isFrozen(record)).toBe(true)
  })
})

// ─── embed만 있고 judge 없는 경우 ─────────────────────────────────────────────

describe('resolveDetectionRecord — embed만, judge 없음', () => {
  it('embed만 있으면 final.confidence가 embed.maxCosine이다', () => {
    const gate = makeGate()
    const embed = makeEmbedResult(0.93)

    const record = resolveDetectionRecord(
      buildDetectionRecord_embed(buildDetectionRecord_gate(gate), embed),
    )

    expect(record.final.confidence).toBe(0.93)
  })

  it('embed만 있으면 final.kind가 gate.type 기반이다', () => {
    const gate = makeGate({ type: 'thrashing', subtype: 'argkey_repeat' })
    const embed = makeEmbedResult(0.93)

    const record = resolveDetectionRecord(
      buildDetectionRecord_embed(buildDetectionRecord_gate(gate), embed),
    )

    expect(record.final.kind).toBe('thrashing')
    expect(record.final.subtype).toBe('argkey_repeat')
  })

  it('embed만 있으면 judge 필드는 undefined이다', () => {
    const record = resolveDetectionRecord(
      buildDetectionRecord_embed(buildDetectionRecord_gate(makeGate()), makeEmbedResult()),
    )

    expect(record.judge).toBeUndefined()
  })

  it('embed만 있으면 final.signals.maxCosine이 embed.maxCosine이다', () => {
    const embed = makeEmbedResult(0.91)
    const record = resolveDetectionRecord(
      buildDetectionRecord_embed(buildDetectionRecord_gate(makeGate()), embed),
    )

    expect(record.final.signals.maxCosine).toBe(0.91)
  })
})

// ─── gate만 있는 경우 ─────────────────────────────────────────────────────────

describe('resolveDetectionRecord — gate만, embed/judge 없음', () => {
  it('gate만 있으면 final.confidence가 0이다', () => {
    const gate = makeGate()
    const record = resolveDetectionRecord(buildDetectionRecord_gate(gate))

    expect(record.final.confidence).toBe(0)
  })

  it('gate만 있으면 final.kind가 gate.type이다', () => {
    const gate = makeGate({ type: 'thrashing', subtype: 'err_loop' })
    const record = resolveDetectionRecord(buildDetectionRecord_gate(gate))

    expect(record.final.kind).toBe('thrashing')
    expect(record.final.subtype).toBe('err_loop')
  })

  it('gate만 있으면 embed/judge 필드 모두 undefined이다', () => {
    const record = resolveDetectionRecord(buildDetectionRecord_gate(makeGate()))

    expect(record.embed).toBeUndefined()
    expect(record.judge).toBeUndefined()
  })

  it('gate만 있으면 final.signals에 maxCosine이 없다', () => {
    const record = resolveDetectionRecord(buildDetectionRecord_gate(makeGate()))

    expect(record.final.signals.maxCosine).toBeUndefined()
  })

  it('gate만 있으면 final.evidence가 gate.windowRefs 기반이다', () => {
    const gate = makeGate({ windowRefs: ['only-ref'] })
    const record = resolveDetectionRecord(buildDetectionRecord_gate(gate))

    expect(record.final.evidence).toHaveLength(1)
    expect(record.final.evidence[0].uuid).toBe('only-ref')
  })
})

// ─── judgeError (fail-closed) ─────────────────────────────────────────────────

describe('resolveDetectionRecord — judgeError fail-closed', () => {
  it('judgeError=true이면 final.kind는 none이다', () => {
    const pending = buildDetectionRecord_judgeError(
      buildDetectionRecord_embed(buildDetectionRecord_gate(makeGate()), makeEmbedResult()),
    )
    const record = resolveDetectionRecord(pending)

    expect(record.final.kind).toBe('none')
  })

  it('judgeError=true이면 final.reason에 inconclusive 관련 텍스트가 포함된다', () => {
    const pending = buildDetectionRecord_judgeError(
      buildDetectionRecord_embed(buildDetectionRecord_gate(makeGate()), makeEmbedResult()),
    )
    const record = resolveDetectionRecord(pending)

    expect(record.final.reason).toMatch(/inconclusive|미확정|deferred/i)
  })

  it('judgeError=true이면 final.confidence가 0이다', () => {
    const pending = buildDetectionRecord_judgeError(
      buildDetectionRecord_embed(buildDetectionRecord_gate(makeGate()), makeEmbedResult()),
    )
    const record = resolveDetectionRecord(pending)

    expect(record.final.confidence).toBe(0)
  })

  it('judgeError=true이면 DetectionRecord.judgeError도 true이다', () => {
    const pending = buildDetectionRecord_judgeError(
      buildDetectionRecord_embed(buildDetectionRecord_gate(makeGate()), makeEmbedResult()),
    )
    const record = resolveDetectionRecord(pending)

    expect(record.judgeError).toBe(true)
  })

  it('judgeError=true이면 DetectionRecord.deferred도 true이다', () => {
    const pending = buildDetectionRecord_judgeError(
      buildDetectionRecord_embed(buildDetectionRecord_gate(makeGate()), makeEmbedResult()),
    )
    const record = resolveDetectionRecord(pending)

    expect(record.deferred).toBe(true)
  })
})

// ─── DetectionRecord.final 필수 필드 존재 ─────────────────────────────────────

describe('resolveDetectionRecord — final 필드 contracts 정본 준수', () => {
  it('final에 kind, subtype, confidence, signals, evidence, reason이 모두 존재한다', () => {
    const record = resolveDetectionRecord(
      buildDetectionRecord_judge(
        buildDetectionRecord_embed(buildDetectionRecord_gate(makeGate()), makeEmbedResult()),
        makeJudgeVerdict(),
      ),
    )

    expect(record.final).toHaveProperty('kind')
    expect(record.final).toHaveProperty('subtype')
    expect(record.final).toHaveProperty('confidence')
    expect(record.final).toHaveProperty('signals')
    expect(record.final).toHaveProperty('evidence')
    expect(record.final).toHaveProperty('reason')
  })

  it('windowRefs가 비어있으면 final.evidence도 빈 배열이다', () => {
    const gate = makeGate({ windowRefs: [] })
    const record = resolveDetectionRecord(buildDetectionRecord_gate(gate))

    expect(record.final.evidence).toEqual([])
  })

  it('metrics가 비어있으면 structuralRepeatCount가 0이다', () => {
    const gate = makeGate({ metrics: {} })
    const record = resolveDetectionRecord(buildDetectionRecord_gate(gate))

    expect(record.final.signals.structuralRepeatCount).toBe(0)
  })
})
