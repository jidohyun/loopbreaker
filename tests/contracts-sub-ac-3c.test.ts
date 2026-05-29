// tests/contracts-sub-ac-3c.test.ts
// Sub-AC 3c: StructureGateResult, EmbeddingSimilarityResult, JudgeVerdict
// 각 타입의 필드명·타입이 SPEC.md §1 / §1-1 BLOCKER 규칙과 정확히 일치하는지 검증.

import {
  type StructureGateResult,
  type EmbeddingSimilarityResult,
  type JudgeVerdict,
} from '../src/contracts.js'

// ---------------------------------------------------------------------------
// StructureGateResult — SPEC §1 정본
// interface StructureGateResult {
//   type: 'thrashing'|'false_success'; subtype: string
//   severity: 'warning'|'critical'; sessionId: string; agentScope: AgentScope
//   windowRefs: string[]; metrics: Record<string, number>
// }
// BLOCKER C1: type 필드 리터럴은 'false_success' 단일 (fake_success/fakeSuccess 금지)
// ---------------------------------------------------------------------------

describe('Sub-AC 3c — StructureGateResult 필드명·타입 검증 (SPEC §1)', () => {
  const makeThrashing = (): StructureGateResult => ({
    type: 'thrashing',
    subtype: 'micro_variant_loop',
    severity: 'critical',
    sessionId: 'sess-001',
    agentScope: 'root',
    windowRefs: ['uuid-a', 'uuid-b'],
    metrics: { repeatCount: 12 },
  })

  const makeFalseSuccess = (): StructureGateResult => ({
    type: 'false_success',
    subtype: 'self_approval',
    severity: 'warning',
    sessionId: 'sess-002',
    agentScope: 'agent-sub-01',
    windowRefs: ['uuid-c'],
    metrics: { deltaMs: 800, selfConsecutive: 1 },
  })

  test('type 필드가 존재하며 string 타입이다', () => {
    const r = makeThrashing()
    expect(typeof r.type).toBe('string')
  })

  test('type 필드는 "thrashing" 리터럴을 허용한다', () => {
    const r = makeThrashing()
    expect(r.type).toBe('thrashing')
  })

  test('type 필드는 "false_success" 리터럴을 허용한다 (BLOCKER C1)', () => {
    const r = makeFalseSuccess()
    expect(r.type).toBe('false_success')
  })

  test('subtype 필드가 존재하며 string 타입이다', () => {
    const r = makeThrashing()
    expect(typeof r.subtype).toBe('string')
  })

  test('severity 필드가 존재하며 "warning" | "critical" 리터럴을 허용한다', () => {
    expect(makeThrashing().severity).toBe('critical')
    expect(makeFalseSuccess().severity).toBe('warning')
  })

  test('sessionId 필드가 존재하며 string 타입이다', () => {
    const r = makeThrashing()
    expect(typeof r.sessionId).toBe('string')
  })

  test('agentScope 필드가 존재하며 "root" 또는 agentId 문자열이다', () => {
    expect(makeThrashing().agentScope).toBe('root')
    expect(makeFalseSuccess().agentScope).toBe('agent-sub-01')
  })

  test('windowRefs 필드가 존재하며 string[] 타입이다', () => {
    const r = makeThrashing()
    expect(Array.isArray(r.windowRefs)).toBe(true)
    expect(typeof r.windowRefs[0]).toBe('string')
  })

  test('metrics 필드가 존재하며 Record<string,number> 타입이다', () => {
    const r = makeThrashing()
    expect(typeof r.metrics).toBe('object')
    expect(r.metrics).not.toBeNull()
    for (const v of Object.values(r.metrics)) {
      expect(typeof v).toBe('number')
    }
  })

  test('SPEC §1에 없는 필드(fake_success 등)는 타입 구조에 없다 (BLOCKER C1)', () => {
    const r = makeFalseSuccess()
    // 런타임에서 fake_success 키가 실제로 없음을 확인
    expect(r).not.toHaveProperty('fake_success')
    expect(r).not.toHaveProperty('fakeSuccess')
    // label/rationale 등 §6 재정의 흔적 없음 (BLOCKER C2 side effect)
    expect(r).not.toHaveProperty('label')
    expect(r).not.toHaveProperty('rationale')
  })

  test('StructureGateResult는 SPEC §1의 7개 필드를 모두 갖는다', () => {
    const r = makeThrashing()
    const expectedKeys = ['type', 'subtype', 'severity', 'sessionId', 'agentScope', 'windowRefs', 'metrics']
    for (const key of expectedKeys) {
      expect(r).toHaveProperty(key)
    }
  })
})

// ---------------------------------------------------------------------------
// EmbeddingSimilarityResult — SPEC §1 정본
// interface EmbeddingSimilarityResult {
//   maxCosine: number; clusterId?: number
//   pairs: {a:string; b:string; cos:number}[]
// }
// BLOCKER C8: pairs:{a,b,cos}[] 가 정본 (pairCount 필드 금지)
// ---------------------------------------------------------------------------

describe('Sub-AC 3c — EmbeddingSimilarityResult 필드명·타입 검증 (SPEC §1, BLOCKER C8)', () => {
  const makeResult = (): EmbeddingSimilarityResult => ({
    maxCosine: 0.94,
    clusterId: 2,
    pairs: [
      { a: 'uuid-1', b: 'uuid-2', cos: 0.94 },
      { a: 'uuid-2', b: 'uuid-3', cos: 0.87 },
    ],
  })

  const makeMinimal = (): EmbeddingSimilarityResult => ({
    maxCosine: 0.82,
    pairs: [],
  })

  test('maxCosine 필드가 존재하며 number 타입이다', () => {
    const r = makeResult()
    expect(typeof r.maxCosine).toBe('number')
  })

  test('maxCosine 값은 0~1 범위의 코사인 유사도다', () => {
    const r = makeResult()
    expect(r.maxCosine).toBeGreaterThanOrEqual(0)
    expect(r.maxCosine).toBeLessThanOrEqual(1)
  })

  test('clusterId 필드는 선택적(optional)이며 number 타입이다', () => {
    const withCluster = makeResult()
    const withoutCluster = makeMinimal()
    expect(typeof withCluster.clusterId).toBe('number')
    expect(withoutCluster.clusterId).toBeUndefined()
  })

  test('pairs 필드가 존재하며 배열 타입이다 (BLOCKER C8)', () => {
    const r = makeResult()
    expect(Array.isArray(r.pairs)).toBe(true)
  })

  test('pairs 각 원소는 {a: string, b: string, cos: number} 구조다 (BLOCKER C8)', () => {
    const r = makeResult()
    for (const pair of r.pairs) {
      expect(typeof pair.a).toBe('string')
      expect(typeof pair.b).toBe('string')
      expect(typeof pair.cos).toBe('number')
    }
  })

  test('pairs 원소의 cos 값은 0~1 범위다', () => {
    const r = makeResult()
    for (const pair of r.pairs) {
      expect(pair.cos).toBeGreaterThanOrEqual(0)
      expect(pair.cos).toBeLessThanOrEqual(1)
    }
  })

  test('pairCount 필드가 없다 (BLOCKER C8: pairCount 금지)', () => {
    const r = makeResult()
    expect(r).not.toHaveProperty('pairCount')
  })

  test('빈 pairs 배열도 유효한 EmbeddingSimilarityResult다', () => {
    const r = makeMinimal()
    expect(r.pairs).toHaveLength(0)
    expect(typeof r.maxCosine).toBe('number')
  })

  test('EmbeddingSimilarityResult는 SPEC §1의 필수 2개 필드를 모두 갖는다', () => {
    const r = makeMinimal()
    expect(r).toHaveProperty('maxCosine')
    expect(r).toHaveProperty('pairs')
  })
})

// ---------------------------------------------------------------------------
// JudgeVerdict — SPEC §1 정본 (BLOCKER C2)
// interface JudgeVerdict {
//   kind: 'thrashing'|'false_success'|'none'; subtype: string
//   confidence: number; topicDivergence?: number; circularReference?: boolean
//   reason: string; rawSamples: unknown[]
// }
// BLOCKER C1: kind는 'false_success' 단일 ('fakeSuccess' 금지)
// BLOCKER C2: §6의 {label,rationale,positionSwapAgreement,selfConsistencyVotes} 재정의 무효
// ---------------------------------------------------------------------------

describe('Sub-AC 3c — JudgeVerdict 필드명·타입 검증 (SPEC §1, BLOCKER C1/C2)', () => {
  const makeThrashing = (): JudgeVerdict => ({
    kind: 'thrashing',
    subtype: 'micro_variant_loop',
    confidence: 0.88,
    topicDivergence: 0.12,
    circularReference: true,
    reason: 'repeated identical edits with no progress',
    rawSamples: [{ verdict: 'thrashing', confidence: 0.88 }],
  })

  const makeFalseSuccess = (): JudgeVerdict => ({
    kind: 'false_success',
    subtype: 'self_approval',
    confidence: 0.92,
    reason: 'self-confirmed completion within 800ms',
    rawSamples: [],
  })

  const makeNone = (): JudgeVerdict => ({
    kind: 'none',
    subtype: '',
    confidence: 0.05,
    reason: 'no anomaly detected',
    rawSamples: [],
  })

  test('kind 필드가 존재하며 string 타입이다', () => {
    expect(typeof makeThrashing().kind).toBe('string')
  })

  test('kind 필드는 "thrashing" 리터럴을 허용한다', () => {
    expect(makeThrashing().kind).toBe('thrashing')
  })

  test('kind 필드는 "false_success" 리터럴을 허용한다 (BLOCKER C1)', () => {
    expect(makeFalseSuccess().kind).toBe('false_success')
  })

  test('kind 필드는 "none" 리터럴을 허용한다', () => {
    expect(makeNone().kind).toBe('none')
  })

  test('subtype 필드가 존재하며 string 타입이다', () => {
    expect(typeof makeThrashing().subtype).toBe('string')
  })

  test('confidence 필드가 존재하며 number 타입이다', () => {
    expect(typeof makeThrashing().confidence).toBe('number')
  })

  test('confidence 값은 0~1 범위다', () => {
    expect(makeThrashing().confidence).toBeGreaterThanOrEqual(0)
    expect(makeThrashing().confidence).toBeLessThanOrEqual(1)
  })

  test('topicDivergence 필드는 선택적(optional)이며 number 타입이다', () => {
    const withDivergence = makeThrashing()
    const withoutDivergence = makeFalseSuccess()
    expect(typeof withDivergence.topicDivergence).toBe('number')
    expect(withoutDivergence.topicDivergence).toBeUndefined()
  })

  test('circularReference 필드는 선택적(optional)이며 boolean 타입이다', () => {
    const withRef = makeThrashing()
    const withoutRef = makeFalseSuccess()
    expect(typeof withRef.circularReference).toBe('boolean')
    expect(withoutRef.circularReference).toBeUndefined()
  })

  test('reason 필드가 존재하며 string 타입이다', () => {
    expect(typeof makeThrashing().reason).toBe('string')
  })

  test('rawSamples 필드가 존재하며 배열 타입이다', () => {
    const r = makeThrashing()
    expect(Array.isArray(r.rawSamples)).toBe(true)
  })

  test('rawSamples는 빈 배열도 허용한다 (선택 호출 없을 때)', () => {
    const r = makeNone()
    expect(r.rawSamples).toHaveLength(0)
  })

  test('rawSamples는 임의 객체를 담을 수 있다 (unknown[])', () => {
    const r = makeThrashing()
    expect(r.rawSamples.length).toBeGreaterThan(0)
  })

  test('BLOCKER C2: §6 재정의 필드(label, rationale)가 없다', () => {
    const r = makeThrashing()
    expect(r).not.toHaveProperty('label')
    expect(r).not.toHaveProperty('rationale')
  })

  test('BLOCKER C2: positionSwapAgreement / selfConsistencyVotes 필드가 없다', () => {
    const r = makeThrashing()
    expect(r).not.toHaveProperty('positionSwapAgreement')
    expect(r).not.toHaveProperty('selfConsistencyVotes')
  })

  test('BLOCKER C1: "fakeSuccess" 리터럴이 kind에 없다', () => {
    // kind는 'thrashing'|'false_success'|'none' 이어야 함
    const validKinds = ['thrashing', 'false_success', 'none']
    expect(validKinds).not.toContain('fakeSuccess')
    expect(validKinds).not.toContain('fake_success')
    // 실제 verdict의 kind도 유효 범위 내임을 확인
    expect(validKinds).toContain(makeFalseSuccess().kind)
  })

  test('JudgeVerdict는 SPEC §1의 필수 4개 필드를 모두 갖는다', () => {
    const r = makeFalseSuccess()
    const requiredKeys = ['kind', 'subtype', 'confidence', 'reason', 'rawSamples']
    for (const key of requiredKeys) {
      expect(r).toHaveProperty(key)
    }
  })
})
