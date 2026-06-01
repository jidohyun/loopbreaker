/**
 * tests/resolve-with-judge-sub-ac-9a.test.ts
 *
 * Sub-AC 9a: resolveWithJudge(gate, embed, judge) 함수 단위 테스트
 *
 * 검증 항목:
 *   1. judge=valid → DetectionVerdict.kind/subtype/confidence/reason이 judge 기반
 *   2. judge.kind='thrashing' → verdict.kind='thrashing'
 *   3. judge.kind='false_success' → verdict.kind='false_success' (BLOCKER C1)
 *   4. judge.kind='none' → verdict.kind='none'
 *   5. judge=undefined, embed=valid → embed 기반 verdict 반환
 *   6. judge=undefined, embed=undefined → gate 기반 verdict, confidence=0
 *   7. judge 있으면 verdict.signals.maxCosine이 embed.maxCosine
 *   8. judge 있으면 verdict.signals.structuralRepeatCount가 gate.metrics 합
 *   9. judge 있으면 verdict.evidence가 gate.windowRefs 기반
 *  10. 반환된 DetectionVerdict는 Object.isFrozen이다
 */

import { describe, expect, it } from '@jest/globals'
import { resolveWithJudge } from '../src/detect/build-detection-record.js'
import type {
  EmbeddingSimilarityResult,
  JudgeVerdict,
  StructureGateResult,
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

function makeEmbed(maxCosine = 0.95): EmbeddingSimilarityResult {
  return {
    maxCosine,
    pairs: [{ a: 'text-a', b: 'text-b', cos: maxCosine }],
  }
}

function makeJudge(
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

// ─── judge=valid → judge 기반 DetectionVerdict ───────────────────────────────

describe('resolveWithJudge — judge 존재 시 judge 기반 verdict (Sub-AC 9a)', () => {
  it('judge=valid → verdict.kind/subtype/confidence/reason이 judge 기반이다', () => {
    const gate = makeGate()
    const embed = makeEmbed(0.95)
    const judge = makeJudge('thrashing', {
      subtype: 'circular_tool_loop',
      confidence: 0.92,
      reason: 'Judge detected thrashing.',
    })

    const verdict = resolveWithJudge(gate, embed, judge)

    expect(verdict.kind).toBe('thrashing')
    expect(verdict.subtype).toBe('circular_tool_loop')
    expect(verdict.confidence).toBe(0.92)
    expect(verdict.reason).toBe('Judge detected thrashing.')
  })

  it('judge.kind=thrashing → verdict.kind=thrashing', () => {
    const verdict = resolveWithJudge(makeGate(), makeEmbed(), makeJudge('thrashing'))
    expect(verdict.kind).toBe('thrashing')
  })

  it('judge.kind=false_success → verdict.kind=false_success (BLOCKER C1)', () => {
    const judge = makeJudge('false_success', { subtype: 'self_approval' })
    const verdict = resolveWithJudge(makeGate(), makeEmbed(), judge)
    expect(verdict.kind).toBe('false_success')
    expect(verdict.subtype).toBe('self_approval')
  })

  it('judge.kind=none → verdict.kind=none', () => {
    const judge = makeJudge('none', { subtype: 'no_issue', confidence: 0.1, reason: 'no issue found' })
    const verdict = resolveWithJudge(makeGate(), makeEmbed(), judge)
    expect(verdict.kind).toBe('none')
  })

  it('judge 있으면 verdict.signals.maxCosine이 embed.maxCosine이다', () => {
    const embed = makeEmbed(0.97)
    const verdict = resolveWithJudge(makeGate(), embed, makeJudge())
    expect(verdict.signals.maxCosine).toBe(0.97)
  })

  it('judge 있으면 verdict.signals.structuralRepeatCount가 gate.metrics 값의 합이다', () => {
    const gate = makeGate({ metrics: { repeatCount: 5, windowSize: 10 } })
    const verdict = resolveWithJudge(gate, makeEmbed(), makeJudge())
    expect(verdict.signals.structuralRepeatCount).toBe(15)
  })

  it('judge 있으면 verdict.evidence가 gate.windowRefs 기반으로 생성된다', () => {
    const gate = makeGate({ windowRefs: ['ref-a', 'ref-b'] })
    const verdict = resolveWithJudge(gate, makeEmbed(), makeJudge())
    expect(verdict.evidence).toHaveLength(2)
    expect(verdict.evidence[0].uuid).toBe('ref-a')
    expect(verdict.evidence[1].uuid).toBe('ref-b')
  })

  it('반환된 DetectionVerdict는 Object.isFrozen이다', () => {
    const verdict = resolveWithJudge(makeGate(), makeEmbed(), makeJudge())
    expect(Object.isFrozen(verdict)).toBe(true)
  })
})

// ─── judge=undefined 폴백 케이스 ────────────────────────────────────────────

describe('resolveWithJudge — judge=undefined 폴백', () => {
  it('judge=undefined, embed=valid → embed 기반 verdict (confidence=embed.maxCosine)', () => {
    const embed = makeEmbed(0.93)
    const verdict = resolveWithJudge(makeGate(), embed, undefined)
    expect(verdict.confidence).toBe(0.93)
    expect(verdict.kind).toBe('thrashing') // gate.type 기반
  })

  it('judge=undefined, embed=undefined → gate 기반 verdict, confidence=0', () => {
    const gate = makeGate({ type: 'thrashing', subtype: 'err_loop' })
    const verdict = resolveWithJudge(gate, undefined, undefined)
    expect(verdict.kind).toBe('thrashing')
    expect(verdict.subtype).toBe('err_loop')
    expect(verdict.confidence).toBe(0)
  })

  it('judge=undefined, embed=undefined → signals.maxCosine이 undefined이다', () => {
    const verdict = resolveWithJudge(makeGate(), undefined, undefined)
    expect(verdict.signals.maxCosine).toBeUndefined()
  })
})
