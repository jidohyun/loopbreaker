/**
 * tests/evaluate-semantic-signal-sub-ac-3d.test.ts
 *
 * Sub-AC 3d: evaluateSemanticSignal 단위 테스트
 *
 * 검증 항목:
 *  1. maxCosine > simThresh → STRONG
 *  2. maxCosine < simThresh → WEAK
 *  3. maxCosine === simThresh (경계값) → STRONG (>= 이므로 포함)
 */

import { evaluateSemanticSignal, SemanticSignal } from '../src/detect/semantic-stage.js'
import type { EmbeddingSimilarityResult } from '../src/contracts.js'

function makeResult(maxCosine: number): EmbeddingSimilarityResult {
  return { maxCosine, pairs: [] }
}

describe('evaluateSemanticSignal', () => {
  const simThresh = 0.90

  it('above threshold → STRONG', () => {
    const result = makeResult(0.95)
    expect(evaluateSemanticSignal(result, simThresh)).toBe(SemanticSignal.STRONG)
  })

  it('below threshold → WEAK', () => {
    const result = makeResult(0.85)
    expect(evaluateSemanticSignal(result, simThresh)).toBe(SemanticSignal.WEAK)
  })

  it('exact threshold (boundary) → STRONG (>= includes equal)', () => {
    const result = makeResult(0.90)
    expect(evaluateSemanticSignal(result, simThresh)).toBe(SemanticSignal.STRONG)
  })

  it('maxCosine = 1.0 (identical vectors) → STRONG', () => {
    const result = makeResult(1.0)
    expect(evaluateSemanticSignal(result, simThresh)).toBe(SemanticSignal.STRONG)
  })

  it('maxCosine = 0.0 → WEAK', () => {
    const result = makeResult(0.0)
    expect(evaluateSemanticSignal(result, simThresh)).toBe(SemanticSignal.WEAK)
  })

  it('maxCosine just below threshold (0.8999) → WEAK', () => {
    const result = makeResult(0.8999)
    expect(evaluateSemanticSignal(result, simThresh)).toBe(SemanticSignal.WEAK)
  })

  it('maxCosine just above threshold (0.9001) → STRONG', () => {
    const result = makeResult(0.9001)
    expect(evaluateSemanticSignal(result, simThresh)).toBe(SemanticSignal.STRONG)
  })

  it('works with a different simThresh value', () => {
    const result = makeResult(0.75)
    expect(evaluateSemanticSignal(result, 0.80)).toBe(SemanticSignal.WEAK)
    expect(evaluateSemanticSignal(result, 0.70)).toBe(SemanticSignal.STRONG)
    expect(evaluateSemanticSignal(result, 0.75)).toBe(SemanticSignal.STRONG)
  })
})
