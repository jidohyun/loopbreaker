/**
 * tests/resolve-final-verdict-sub-ac-9d.test.ts
 *
 * Sub-AC 9d: resolveFinalVerdict(gate, embed, judge?, judgeError?) 통합 분기 라우터
 * — 세 케이스의 통합 라우팅을 검증한다.
 *
 * 검증 항목 (분기별):
 *
 * Branch 1 — judgeError 존재 → resolveWithJudgeError 라우팅
 *   1-1. kind='none', subtype='inconclusive', confidence=0
 *   1-2. reason에 deferred/inconclusive/미확정 키워드 포함
 *   1-3. Error 메시지가 reason에 포함됨
 *   1-4. embed가 있을 때 signals.maxCosine 보존
 *   1-5. embed가 없을 때 signals.maxCosine 미존재
 *
 * Branch 2 — judge 존재(에러 없음) → resolveWithJudge 라우팅
 *   2-1. verdict.kind = judge.kind ('thrashing')
 *   2-2. verdict.kind = 'false_success' (BLOCKER C1)
 *   2-3. verdict.kind = 'none'
 *   2-4. verdict.confidence = judge.confidence
 *   2-5. verdict.reason = judge.reason
 *   2-6. signals.maxCosine = embed.maxCosine (embed 있을 때)
 *   2-7. signals.maxCosine 미존재 (embed 없을 때)
 *   2-8. signals.structuralRepeatCount = sum(gate.metrics)
 *   2-9. evidence = gate.windowRefs 기반
 *
 * Branch 3 — embed만 있음(judge=undefined) → resolveWithEmbedOnly 라우팅
 *   3-1. verdict.kind = gate.type
 *   3-2. verdict.confidence = embed.maxCosine
 *   3-3. signals.maxCosine = embed.maxCosine
 *   3-4. reason에 '의미 유사도' 또는 judge 미호출 표시 포함
 *
 * Branch 4 — gate만 있음(embed=undefined, judge=undefined) → gate-only 폴백
 *   4-1. verdict.kind = gate.type
 *   4-2. verdict.confidence = 0
 *   4-3. signals.maxCosine 미존재
 *   4-4. reason에 '의미 단계 미진행' 포함
 *
 * 공통:
 *   C-1. 반환된 DetectionVerdict는 Object.isFrozen이다
 *   C-2. judgeError 우선순위 > judge (둘 다 제공 시 judgeError 분기)
 */

import { describe, expect, it } from '@jest/globals'
import { resolveFinalVerdict } from '../src/detect/build-detection-record.js'
import type {
  EmbeddingSimilarityResult,
  JudgeVerdict,
  StructureGateResult,
} from '../src/contracts.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeGate(overrides?: Partial<StructureGateResult>): StructureGateResult {
  return {
    type: 'thrashing',
    subtype: 'argkey_repeat',
    severity: 'warning',
    sessionId: 'session-9d',
    agentScope: 'root',
    windowRefs: ['uuid-1', 'uuid-2', 'uuid-3'],
    metrics: { repeatCount: 4, windowSize: 6 },
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
    subtype: 'circular_tool_loop',
    confidence: 0.87,
    reason: 'Judge: thrashing detected.',
    rawSamples: ['sample-1'],
    ...overrides,
  }
}

// ─── Branch 1: judgeError → resolveWithJudgeError ────────────────────────────

describe('resolveFinalVerdict — Branch 1: judgeError → inconclusive', () => {
  it('1-1: kind=none, subtype=inconclusive, confidence=0', () => {
    const verdict = resolveFinalVerdict(
      makeGate(),
      makeEmbed(),
      undefined,
      new Error('timeout'),
    )
    expect(verdict.kind).toBe('none')
    expect(verdict.subtype).toBe('inconclusive')
    expect(verdict.confidence).toBe(0)
  })

  it('1-2: reason에 deferred/inconclusive/미확정 키워드 포함', () => {
    const verdict = resolveFinalVerdict(
      makeGate(),
      undefined,
      undefined,
      new Error('API error'),
    )
    expect(verdict.reason).toMatch(/deferred|inconclusive|미확정/i)
  })

  it('1-3: Error 메시지가 reason에 포함됨', () => {
    const verdict = resolveFinalVerdict(
      makeGate(),
      undefined,
      undefined,
      new Error('rate limit exceeded'),
    )
    expect(verdict.reason).toContain('rate limit exceeded')
  })

  it('1-4: embed 있을 때 signals.maxCosine 보존', () => {
    const embed = makeEmbed(0.88)
    const verdict = resolveFinalVerdict(
      makeGate(),
      embed,
      undefined,
      new Error('fail'),
    )
    expect(verdict.signals.maxCosine).toBe(0.88)
  })

  it('1-5: embed 없을 때 signals.maxCosine 미존재', () => {
    const verdict = resolveFinalVerdict(
      makeGate(),
      undefined,
      undefined,
      new Error('fail'),
    )
    expect('maxCosine' in verdict.signals).toBe(false)
  })

  it('judgeError 우선순위 > judge (둘 다 있으면 judgeError 분기)', () => {
    const judge = makeJudge('thrashing', { confidence: 0.99 })
    const verdict = resolveFinalVerdict(
      makeGate(),
      makeEmbed(),
      judge,
      new Error('judge api down'),
    )
    // judgeError가 우선이므로 judge.confidence(0.99)가 아닌 0이어야 함
    expect(verdict.kind).toBe('none')
    expect(verdict.subtype).toBe('inconclusive')
    expect(verdict.confidence).toBe(0)
  })
})

// ─── Branch 2: judge 존재 → resolveWithJudge ─────────────────────────────────

describe('resolveFinalVerdict — Branch 2: judge 존재 → judge 기반 verdict', () => {
  it('2-1: judge.kind=thrashing → verdict.kind=thrashing', () => {
    const verdict = resolveFinalVerdict(makeGate(), makeEmbed(), makeJudge('thrashing'))
    expect(verdict.kind).toBe('thrashing')
  })

  it('2-2: judge.kind=false_success → verdict.kind=false_success (BLOCKER C1)', () => {
    const judge = makeJudge('false_success', { subtype: 'self_approval' })
    const verdict = resolveFinalVerdict(makeGate(), makeEmbed(), judge)
    expect(verdict.kind).toBe('false_success')
    expect(verdict.subtype).toBe('self_approval')
  })

  it('2-3: judge.kind=none → verdict.kind=none', () => {
    const judge = makeJudge('none', { subtype: 'no_issue', confidence: 0.1, reason: 'clean' })
    const verdict = resolveFinalVerdict(makeGate(), makeEmbed(), judge)
    expect(verdict.kind).toBe('none')
  })

  it('2-4: verdict.confidence = judge.confidence', () => {
    const judge = makeJudge('thrashing', { confidence: 0.92 })
    const verdict = resolveFinalVerdict(makeGate(), makeEmbed(), judge)
    expect(verdict.confidence).toBe(0.92)
  })

  it('2-5: verdict.reason = judge.reason', () => {
    const judge = makeJudge('thrashing', { reason: 'Specific judge reason.' })
    const verdict = resolveFinalVerdict(makeGate(), makeEmbed(), judge)
    expect(verdict.reason).toBe('Specific judge reason.')
  })

  it('2-6: signals.maxCosine = embed.maxCosine (embed 있을 때)', () => {
    const embed = makeEmbed(0.96)
    const verdict = resolveFinalVerdict(makeGate(), embed, makeJudge())
    expect(verdict.signals.maxCosine).toBe(0.96)
  })

  it('2-7: signals.maxCosine 미존재 (embed=undefined)', () => {
    const verdict = resolveFinalVerdict(makeGate(), undefined, makeJudge())
    expect('maxCosine' in verdict.signals).toBe(false)
  })

  it('2-8: signals.structuralRepeatCount = sum(gate.metrics)', () => {
    const gate = makeGate({ metrics: { repeatCount: 4, windowSize: 6 } })
    const verdict = resolveFinalVerdict(gate, makeEmbed(), makeJudge())
    expect(verdict.signals.structuralRepeatCount).toBe(10)
  })

  it('2-9: evidence = gate.windowRefs 기반 (uuid 매핑)', () => {
    const gate = makeGate({ windowRefs: ['ref-A', 'ref-B'] })
    const verdict = resolveFinalVerdict(gate, makeEmbed(), makeJudge())
    expect(verdict.evidence).toHaveLength(2)
    expect(verdict.evidence[0].uuid).toBe('ref-A')
    expect(verdict.evidence[1].uuid).toBe('ref-B')
  })
})

// ─── Branch 3: embed만 있음 → resolveWithEmbedOnly ───────────────────────────

describe('resolveFinalVerdict — Branch 3: embed만 있음 → embed 기반 verdict', () => {
  it('3-1: verdict.kind = gate.type', () => {
    const gate = makeGate({ type: 'thrashing' })
    const verdict = resolveFinalVerdict(gate, makeEmbed(0.93), undefined)
    expect(verdict.kind).toBe('thrashing')
  })

  it('3-1b: gate.type=false_success → verdict.kind=false_success (BLOCKER C1)', () => {
    const gate = makeGate({ type: 'false_success', subtype: 'unsubstantiated_claim' })
    const verdict = resolveFinalVerdict(gate, makeEmbed(0.91), undefined)
    expect(verdict.kind).toBe('false_success')
  })

  it('3-2: verdict.confidence = embed.maxCosine', () => {
    const verdict = resolveFinalVerdict(makeGate(), makeEmbed(0.93), undefined)
    expect(verdict.confidence).toBe(0.93)
  })

  it('3-3: signals.maxCosine = embed.maxCosine', () => {
    const embed = makeEmbed(0.91)
    const verdict = resolveFinalVerdict(makeGate(), embed, undefined)
    expect(verdict.signals.maxCosine).toBe(0.91)
  })

  it('3-4: reason에 judge 미호출 / 의미 유사도 표시 포함', () => {
    const verdict = resolveFinalVerdict(makeGate(), makeEmbed(0.93), undefined)
    expect(verdict.reason).toMatch(/judge|유사도|미호출/i)
  })

  it('3-5: signals.structuralRepeatCount = sum(gate.metrics)', () => {
    const gate = makeGate({ metrics: { repeatCount: 4, windowSize: 6 } })
    const verdict = resolveFinalVerdict(gate, makeEmbed(0.9), undefined)
    expect(verdict.signals.structuralRepeatCount).toBe(10)
  })
})

// ─── Branch 4: gate만 있음 → gate-only 폴백 ──────────────────────────────────

describe('resolveFinalVerdict — Branch 4: gate만 있음 → gate-only, confidence=0', () => {
  it('4-1: verdict.kind = gate.type', () => {
    const gate = makeGate({ type: 'thrashing', subtype: 'err_loop' })
    const verdict = resolveFinalVerdict(gate, undefined, undefined)
    expect(verdict.kind).toBe('thrashing')
    expect(verdict.subtype).toBe('err_loop')
  })

  it('4-2: verdict.confidence = 0', () => {
    const verdict = resolveFinalVerdict(makeGate(), undefined, undefined)
    expect(verdict.confidence).toBe(0)
  })

  it('4-3: signals.maxCosine 미존재', () => {
    const verdict = resolveFinalVerdict(makeGate(), undefined, undefined)
    expect('maxCosine' in verdict.signals).toBe(false)
  })

  it('4-4: reason에 의미 단계 미진행 표시 포함', () => {
    const verdict = resolveFinalVerdict(makeGate(), undefined, undefined)
    expect(verdict.reason).toMatch(/미진행|의미 단계/)
  })

  it('4-5: signals.structuralRepeatCount = sum(gate.metrics)', () => {
    const gate = makeGate({ metrics: { repeatCount: 3, errorCount: 2 } })
    const verdict = resolveFinalVerdict(gate, undefined, undefined)
    expect(verdict.signals.structuralRepeatCount).toBe(5)
  })

  it('4-6: evidence = gate.windowRefs 기반', () => {
    const gate = makeGate({ windowRefs: ['w1', 'w2', 'w3'] })
    const verdict = resolveFinalVerdict(gate, undefined, undefined)
    expect(verdict.evidence).toHaveLength(3)
    expect(verdict.evidence[0].uuid).toBe('w1')
    expect(verdict.evidence[2].uuid).toBe('w3')
  })
})

// ─── 공통: 불변성 ────────────────────────────────────────────────────────────

describe('resolveFinalVerdict — 공통: 반환값 불변성', () => {
  it('C-1: Branch 1 반환값은 Object.isFrozen', () => {
    const verdict = resolveFinalVerdict(makeGate(), undefined, undefined, new Error('err'))
    expect(Object.isFrozen(verdict)).toBe(true)
  })

  it('C-1b: Branch 2 반환값은 Object.isFrozen', () => {
    const verdict = resolveFinalVerdict(makeGate(), makeEmbed(), makeJudge())
    expect(Object.isFrozen(verdict)).toBe(true)
  })

  it('C-1c: Branch 3 반환값은 Object.isFrozen', () => {
    const verdict = resolveFinalVerdict(makeGate(), makeEmbed(), undefined)
    expect(Object.isFrozen(verdict)).toBe(true)
  })

  it('C-1d: Branch 4 반환값은 Object.isFrozen', () => {
    const verdict = resolveFinalVerdict(makeGate(), undefined, undefined)
    expect(Object.isFrozen(verdict)).toBe(true)
  })

  it('C-2: 입력 gate/embed 객체를 변경하지 않음', () => {
    const gate = makeGate()
    const embed = makeEmbed()
    const gateCopy = JSON.stringify(gate)
    const embedCopy = JSON.stringify(embed)

    resolveFinalVerdict(gate, embed, makeJudge())

    expect(JSON.stringify(gate)).toBe(gateCopy)
    expect(JSON.stringify(embed)).toBe(embedCopy)
  })
})
