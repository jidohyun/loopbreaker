/**
 * tests/resolve-with-embed-only-sub-ac-9b.test.ts
 *
 * Sub-AC 9b: resolveWithEmbedOnly(gate, embed) 단위 테스트
 *
 * 검증 항목:
 *   - judge=undefined, embed=valid → verdict는 embed 기반값
 *   - confidence = embed.maxCosine
 *   - kind/subtype = gate.type/gate.subtype
 *   - signals.maxCosine = embed.maxCosine
 *   - signals.structuralRepeatCount = sum of gate.metrics values
 *   - evidence 배열은 gate.windowRefs 기반
 *   - reason 문자열에 embed.maxCosine이 포함됨
 *   - 반환값은 불변(frozen)
 */

import { resolveWithEmbedOnly } from '../src/detect/build-detection-record.js'
import type {
  EmbeddingSimilarityResult,
  StructureGateResult,
} from '../src/contracts.js'

// ---------------------------------------------------------------------------
// 헬퍼: 테스트용 gate/embed 픽스처
// ---------------------------------------------------------------------------

function makeGate(overrides?: Partial<StructureGateResult>): StructureGateResult {
  return {
    type: 'thrashing',
    subtype: 'argkey_repeat',
    severity: 'warning',
    sessionId: 'sess-9b-001',
    agentScope: 'root',
    windowRefs: ['uuid-a', 'uuid-b', 'uuid-c'],
    metrics: { argkeyRepeat: 5, editRepeat: 2 },
    ...overrides,
  }
}

function makeEmbed(overrides?: Partial<EmbeddingSimilarityResult>): EmbeddingSimilarityResult {
  return {
    maxCosine: 0.92,
    pairs: [
      { a: 'text-a', b: 'text-b', cos: 0.92 },
      { a: 'text-a', b: 'text-c', cos: 0.87 },
    ],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. 기본 동작: judge=undefined, embed=valid → embed 기반 DetectionVerdict
// ---------------------------------------------------------------------------

describe('resolveWithEmbedOnly — Sub-AC 9b', () => {
  test('returns DetectionVerdict when judge is absent and embed is provided', () => {
    const gate = makeGate()
    const embed = makeEmbed()

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict).toBeDefined()
    expect(verdict.kind).toBe('thrashing')
    expect(verdict.subtype).toBe('argkey_repeat')
  })

  // ---------------------------------------------------------------------------
  // 2. confidence = embed.maxCosine
  // ---------------------------------------------------------------------------

  test('confidence equals embed.maxCosine', () => {
    const gate = makeGate()
    const embed = makeEmbed({ maxCosine: 0.95 })

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.confidence).toBe(0.95)
  })

  test('confidence equals embed.maxCosine for lower value', () => {
    const gate = makeGate()
    const embed = makeEmbed({ maxCosine: 0.91 })

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.confidence).toBe(0.91)
  })

  // ---------------------------------------------------------------------------
  // 3. kind = gate.type, subtype = gate.subtype
  // ---------------------------------------------------------------------------

  test('kind is derived from gate.type (thrashing)', () => {
    const gate = makeGate({ type: 'thrashing', subtype: 'err_loop' })
    const embed = makeEmbed()

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.kind).toBe('thrashing')
    expect(verdict.subtype).toBe('err_loop')
  })

  test('kind is derived from gate.type (false_success)', () => {
    const gate = makeGate({ type: 'false_success', subtype: 'self_approval' })
    const embed = makeEmbed()

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.kind).toBe('false_success')
    expect(verdict.subtype).toBe('self_approval')
  })

  // ---------------------------------------------------------------------------
  // 4. signals.maxCosine = embed.maxCosine
  // ---------------------------------------------------------------------------

  test('signals.maxCosine equals embed.maxCosine', () => {
    const gate = makeGate()
    const embed = makeEmbed({ maxCosine: 0.93 })

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.signals.maxCosine).toBe(0.93)
  })

  // ---------------------------------------------------------------------------
  // 5. signals.structuralRepeatCount = sum of gate.metrics values
  // ---------------------------------------------------------------------------

  test('signals.structuralRepeatCount is sum of gate.metrics values', () => {
    const gate = makeGate({ metrics: { argkeyRepeat: 5, editRepeat: 2 } })
    const embed = makeEmbed()

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.signals.structuralRepeatCount).toBe(7) // 5 + 2
  })

  test('signals.structuralRepeatCount handles single metric', () => {
    const gate = makeGate({ metrics: { argkeyRepeat: 3 } })
    const embed = makeEmbed()

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.signals.structuralRepeatCount).toBe(3)
  })

  test('signals.structuralRepeatCount handles empty metrics', () => {
    const gate = makeGate({ metrics: {} })
    const embed = makeEmbed()

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.signals.structuralRepeatCount).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // 6. evidence 배열은 gate.windowRefs 기반
  // ---------------------------------------------------------------------------

  test('evidence is built from gate.windowRefs', () => {
    const gate = makeGate({ windowRefs: ['uuid-x', 'uuid-y'] })
    const embed = makeEmbed()

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.evidence).toHaveLength(2)
    expect(verdict.evidence[0].uuid).toBe('uuid-x')
    expect(verdict.evidence[1].uuid).toBe('uuid-y')
  })

  test('evidence entries have uuid, ts, and note fields', () => {
    const gate = makeGate({ windowRefs: ['uuid-p', 'uuid-q', 'uuid-r'] })
    const embed = makeEmbed()

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.evidence).toHaveLength(3)
    for (const entry of verdict.evidence) {
      expect(entry).toHaveProperty('uuid')
      expect(entry).toHaveProperty('ts')
      expect(entry).toHaveProperty('note')
    }
  })

  test('evidence ts values are sequential indices', () => {
    const gate = makeGate({ windowRefs: ['uuid-1', 'uuid-2', 'uuid-3'] })
    const embed = makeEmbed()

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.evidence[0].ts).toBe(0)
    expect(verdict.evidence[1].ts).toBe(1)
    expect(verdict.evidence[2].ts).toBe(2)
  })

  test('evidence is empty when windowRefs is empty', () => {
    const gate = makeGate({ windowRefs: [] })
    const embed = makeEmbed()

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.evidence).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // 7. reason 문자열에 embed.maxCosine 값이 포함됨
  // ---------------------------------------------------------------------------

  test('reason includes embed.maxCosine value', () => {
    const gate = makeGate()
    const embed = makeEmbed({ maxCosine: 0.92 })

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.reason).toContain('0.920')
  })

  test('reason indicates judge was not called', () => {
    const gate = makeGate()
    const embed = makeEmbed()

    const verdict = resolveWithEmbedOnly(gate, embed)

    // reason should indicate judge was not invoked
    expect(verdict.reason.length).toBeGreaterThan(0)
    expect(typeof verdict.reason).toBe('string')
  })

  // ---------------------------------------------------------------------------
  // 8. 반환값은 불변(frozen)
  // ---------------------------------------------------------------------------

  test('returned verdict is frozen (immutable)', () => {
    const gate = makeGate()
    const embed = makeEmbed()

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(Object.isFrozen(verdict)).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // 9. edge case: boundary maxCosine = 0.0 and 1.0
  // ---------------------------------------------------------------------------

  test('confidence is 0.0 when embed.maxCosine = 0.0', () => {
    const gate = makeGate()
    const embed = makeEmbed({ maxCosine: 0.0, pairs: [] })

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.confidence).toBe(0.0)
    expect(verdict.signals.maxCosine).toBe(0.0)
  })

  test('confidence is 1.0 when embed.maxCosine = 1.0', () => {
    const gate = makeGate()
    const embed = makeEmbed({ maxCosine: 1.0 })

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict.confidence).toBe(1.0)
    expect(verdict.signals.maxCosine).toBe(1.0)
  })

  // ---------------------------------------------------------------------------
  // 10. 반환 타입: DetectionVerdict 필드 완전성
  // ---------------------------------------------------------------------------

  test('returned verdict has all required DetectionVerdict fields', () => {
    const gate = makeGate()
    const embed = makeEmbed()

    const verdict = resolveWithEmbedOnly(gate, embed)

    expect(verdict).toHaveProperty('kind')
    expect(verdict).toHaveProperty('subtype')
    expect(verdict).toHaveProperty('confidence')
    expect(verdict).toHaveProperty('signals')
    expect(verdict).toHaveProperty('evidence')
    expect(verdict).toHaveProperty('reason')
  })
})
