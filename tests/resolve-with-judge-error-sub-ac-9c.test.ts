/**
 * tests/resolve-with-judge-error-sub-ac-9c.test.ts
 *
 * Sub-AC 9c: resolveWithJudgeError(gate, embed, judgeError) 함수 단위 테스트
 * — judge 결과가 에러일 때 final.verdict = 'inconclusive' 반환을 검증한다.
 */

import { resolveWithJudgeError } from '../src/detect/build-detection-record.js'
import type {
  EmbeddingSimilarityResult,
  StructureGateResult,
} from '../src/contracts.js'

// ── helpers ────────────────────────────────────────────────────────────────

function makeGate(overrides?: Partial<StructureGateResult>): StructureGateResult {
  return {
    type: 'thrashing',
    subtype: 'tool_repeat',
    severity: 'warning',
    sessionId: 'sess-001',
    agentScope: 'root',
    windowRefs: ['uuid-a', 'uuid-b'],
    metrics: { toolRepeat: 3, resultRepeat: 1 },
    ...overrides,
  }
}

function makeEmbed(maxCosine = 0.92): EmbeddingSimilarityResult {
  return {
    maxCosine,
    pairs: [{ a: 'text-a', b: 'text-b', cos: maxCosine }],
  }
}

// ── Sub-AC 9c: judge=error → verdict='inconclusive' ─────────────────────

describe('resolveWithJudgeError', () => {
  test('judge Error → kind=none, subtype=inconclusive, confidence=0', () => {
    const gate = makeGate()
    const embed = makeEmbed()
    const err = new Error('timeout after 3 retries')

    const verdict = resolveWithJudgeError(gate, embed, err)

    expect(verdict.kind).toBe('none')
    expect(verdict.subtype).toBe('inconclusive')
    expect(verdict.confidence).toBe(0)
  })

  test('reason contains deferred/inconclusive indicator', () => {
    const gate = makeGate()
    const verdict = resolveWithJudgeError(gate, undefined, new Error('API error'))

    // Korean reason: "judge API 실패: 판정 미확정(deferred) — ..."
    expect(verdict.reason).toMatch(/deferred|inconclusive|미확정/i)
  })

  test('reason contains the error message', () => {
    const gate = makeGate()
    const err = new Error('rate limit exceeded')
    const verdict = resolveWithJudgeError(gate, undefined, err)

    expect(verdict.reason).toContain('rate limit exceeded')
  })

  test('non-Error judgeError (string) → still inconclusive', () => {
    const gate = makeGate()
    const verdict = resolveWithJudgeError(gate, undefined, 'unknown failure')

    expect(verdict.kind).toBe('none')
    expect(verdict.subtype).toBe('inconclusive')
    expect(verdict.confidence).toBe(0)
  })

  test('signals.maxCosine present when embed provided', () => {
    const gate = makeGate()
    const embed = makeEmbed(0.87)
    const verdict = resolveWithJudgeError(gate, embed, new Error('err'))

    expect(verdict.signals.maxCosine).toBe(0.87)
  })

  test('signals.maxCosine absent when embed=undefined', () => {
    const gate = makeGate()
    const verdict = resolveWithJudgeError(gate, undefined, new Error('err'))

    expect('maxCosine' in verdict.signals).toBe(false)
  })

  test('signals.structuralRepeatCount sums gate metrics', () => {
    const gate = makeGate({ metrics: { toolRepeat: 3, resultRepeat: 1 } })
    const verdict = resolveWithJudgeError(gate, undefined, new Error('err'))

    expect(verdict.signals.structuralRepeatCount).toBe(4)
  })

  test('evidence entries correspond to gate.windowRefs', () => {
    const gate = makeGate({ windowRefs: ['ref-1', 'ref-2', 'ref-3'] })
    const verdict = resolveWithJudgeError(gate, undefined, new Error('err'))

    expect(verdict.evidence).toHaveLength(3)
    expect(verdict.evidence[0].uuid).toBe('ref-1')
    expect(verdict.evidence[2].uuid).toBe('ref-3')
  })

  test('returned verdict is frozen (immutable)', () => {
    const gate = makeGate()
    const verdict = resolveWithJudgeError(gate, undefined, new Error('err'))

    expect(Object.isFrozen(verdict)).toBe(true)
  })

  test('gate-only (no embed) → verdict still inconclusive', () => {
    const gate = makeGate()
    const verdict = resolveWithJudgeError(gate, undefined, new Error('timeout'))

    expect(verdict.kind).toBe('none')
    expect(verdict.subtype).toBe('inconclusive')
    expect(verdict.confidence).toBe(0)
  })

  test('does not mutate gate or embed inputs', () => {
    const gate = makeGate()
    const embed = makeEmbed()
    const gateCopy = JSON.stringify(gate)
    const embedCopy = JSON.stringify(embed)

    resolveWithJudgeError(gate, embed, new Error('err'))

    expect(JSON.stringify(gate)).toBe(gateCopy)
    expect(JSON.stringify(embed)).toBe(embedCopy)
  })
})
