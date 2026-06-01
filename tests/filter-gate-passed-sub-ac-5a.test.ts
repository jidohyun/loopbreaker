/**
 * tests/filter-gate-passed-sub-ac-5a.test.ts
 *
 * Sub-AC 5a: filterGatePassed(candidates) 단위 테스트.
 *
 * 검증 항목:
 *   1. gate_passed=true 항목만 반환
 *   2. gate_passed=false 항목은 제외
 *   3. 혼재 목록에서 통과분만 추출
 *   4. 빈 배열 입력 시 빈 배열 반환
 *   5. 전부 통과분인 경우 전체 반환
 *   6. 전부 미통과분인 경우 빈 배열 반환
 *   7. 원본 배열 불변 보장
 *   8. 반환 배열 순서 보존
 */

import { filterGatePassed, type GateCandidate } from '../src/detect/filter-gate-passed.js'
import type { StructureGateResult } from '../src/contracts.js'

// ── 픽스처 ────────────────────────────────────────────────────────────────────

const makeGateResult = (subtype: string): StructureGateResult => ({
  type: 'thrashing',
  subtype,
  severity: 'warning',
  sessionId: 'test-session',
  agentScope: 'root',
  windowRefs: ['uuid-1', 'uuid-2'],
  metrics: { repeatCount: 5 },
})

const makeCandidate = (
  triggerUuid: string,
  gate_passed: boolean,
  gate: StructureGateResult | null = null,
): GateCandidate => ({
  gate: gate_passed ? (gate ?? makeGateResult('repeat_edit')) : gate,
  gate_passed,
  triggerUuid,
  ts: Date.now(),
})

// gate_passed=true 픽스처
const passedA = makeCandidate('uuid-passed-a', true, makeGateResult('repeat_edit'))
const passedB = makeCandidate('uuid-passed-b', true, makeGateResult('error_loop'))
const passedC = makeCandidate('uuid-passed-c', true, makeGateResult('self_approval'))

// gate_passed=false 픽스처
const failedA = makeCandidate('uuid-failed-a', false)
const failedB = makeCandidate('uuid-failed-b', false)
const failedC = makeCandidate('uuid-failed-c', false)

// ── 1. gate_passed=true 항목만 반환 ──────────────────────────────────────────

describe('filterGatePassed — gate_passed=true 항목 포함', () => {
  test('단일 통과 후보를 반환한다', () => {
    const result = filterGatePassed([passedA])
    expect(result).toHaveLength(1)
    expect(result[0]?.triggerUuid).toBe('uuid-passed-a')
  })

  test('여러 통과 후보를 모두 반환한다', () => {
    const result = filterGatePassed([passedA, passedB, passedC])
    expect(result).toHaveLength(3)
    const uuids = result.map(c => c.triggerUuid)
    expect(uuids).toContain('uuid-passed-a')
    expect(uuids).toContain('uuid-passed-b')
    expect(uuids).toContain('uuid-passed-c')
  })
})

// ── 2. gate_passed=false 항목 제외 ───────────────────────────────────────────

describe('filterGatePassed — gate_passed=false 항목 제외', () => {
  test('단일 미통과 후보는 빈 배열 반환', () => {
    const result = filterGatePassed([failedA])
    expect(result).toHaveLength(0)
  })

  test('여러 미통과 후보는 빈 배열 반환', () => {
    const result = filterGatePassed([failedA, failedB, failedC])
    expect(result).toHaveLength(0)
  })

  test('미통과 후보의 triggerUuid가 결과에 없음', () => {
    const result = filterGatePassed([failedA, passedA])
    const uuids = result.map(c => c.triggerUuid)
    expect(uuids).not.toContain('uuid-failed-a')
  })
})

// ── 3. 혼재 목록에서 통과분만 추출 ───────────────────────────────────────────

describe('filterGatePassed — 혼재 후보 목록', () => {
  test('통과 1개 + 미통과 1개 → 통과 1개만 반환', () => {
    const result = filterGatePassed([passedA, failedA])
    expect(result).toHaveLength(1)
    expect(result[0]?.triggerUuid).toBe('uuid-passed-a')
  })

  test('통과 2개 + 미통과 3개 혼재 → 통과 2개만 반환', () => {
    const result = filterGatePassed([failedA, passedA, failedB, passedB, failedC])
    expect(result).toHaveLength(2)
    const uuids = result.map(c => c.triggerUuid)
    expect(uuids).toContain('uuid-passed-a')
    expect(uuids).toContain('uuid-passed-b')
    expect(uuids).not.toContain('uuid-failed-a')
    expect(uuids).not.toContain('uuid-failed-b')
    expect(uuids).not.toContain('uuid-failed-c')
  })

  test('미통과·통과 교대 순서에서 gate_passed=true만 추출', () => {
    const mixed = [failedA, passedA, failedB, passedB, failedC, passedC]
    const result = filterGatePassed(mixed)
    expect(result).toHaveLength(3)
    expect(result.every(c => c.gate_passed === true)).toBe(true)
  })
})

// ── 4. 빈 배열 입력 ──────────────────────────────────────────────────────────

describe('filterGatePassed — 빈 입력', () => {
  test('빈 배열 입력 시 빈 배열 반환', () => {
    const result = filterGatePassed([])
    expect(result).toEqual([])
  })
})

// ── 5. 전부 통과분인 경우 ─────────────────────────────────────────────────────

describe('filterGatePassed — 전부 통과분', () => {
  test('전부 gate_passed=true인 배열은 전체 반환', () => {
    const result = filterGatePassed([passedA, passedB, passedC])
    expect(result).toHaveLength(3)
    expect(result.every(c => c.gate_passed === true)).toBe(true)
  })
})

// ── 6. 전부 미통과분인 경우 ───────────────────────────────────────────────────

describe('filterGatePassed — 전부 미통과분', () => {
  test('전부 gate_passed=false인 배열은 빈 배열 반환', () => {
    const result = filterGatePassed([failedA, failedB, failedC])
    expect(result).toHaveLength(0)
  })
})

// ── 7. 원본 배열 불변 보장 ────────────────────────────────────────────────────

describe('filterGatePassed — 원본 불변', () => {
  test('원본 배열이 변형되지 않는다', () => {
    const original = [passedA, failedA, passedB]
    const originalLength = original.length
    const originalFirst = original[0]
    filterGatePassed(original)
    expect(original).toHaveLength(originalLength)
    expect(original[0]).toBe(originalFirst)
  })

  test('반환 배열과 원본 배열은 다른 참조다', () => {
    const original = [passedA, passedB]
    const result = filterGatePassed(original)
    expect(result).not.toBe(original)
  })
})

// ── 8. 반환 배열 순서 보존 ────────────────────────────────────────────────────

describe('filterGatePassed — 순서 보존', () => {
  test('통과 항목의 상대적 순서가 유지된다', () => {
    const ordered = [passedA, failedA, passedB, failedB, passedC]
    const result = filterGatePassed(ordered)
    expect(result[0]?.triggerUuid).toBe('uuid-passed-a')
    expect(result[1]?.triggerUuid).toBe('uuid-passed-b')
    expect(result[2]?.triggerUuid).toBe('uuid-passed-c')
  })

  test('미통과 후보가 앞에 있어도 통과 항목 순서가 유지된다', () => {
    const ordered = [failedC, failedB, passedA, failedA, passedC]
    const result = filterGatePassed(ordered)
    expect(result[0]?.triggerUuid).toBe('uuid-passed-a')
    expect(result[1]?.triggerUuid).toBe('uuid-passed-c')
  })
})

// ── 9. gate 필드 내용 보존 ────────────────────────────────────────────────────

describe('filterGatePassed — gate 결과 보존', () => {
  test('통과 항목의 gate 결과가 그대로 반환된다', () => {
    const gateResult = makeGateResult('custom_subtype')
    const candidate = makeCandidate('uuid-custom', true, gateResult)
    const result = filterGatePassed([candidate])
    expect(result[0]?.gate).toBe(gateResult)
    expect(result[0]?.gate?.subtype).toBe('custom_subtype')
  })

  test('통과 항목의 gate_passed는 반드시 true', () => {
    const result = filterGatePassed([passedA, failedA, passedB])
    expect(result.every(c => c.gate_passed)).toBe(true)
  })
})
