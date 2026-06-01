/**
 * tests/merge-embed-result-sub-ac-8b.test.ts
 *
 * Sub-AC 8b: mergeEmbedResult 함수 단위 테스트
 *
 * 검증 항목:
 *  1. gate-only DetectionRecord에 EmbeddingSimilarityResult를 병합하면 embed 필드가 채워진다.
 *  2. gate 필드는 병합 후에도 불변이다.
 *  3. 의미 약함(임계값 미달) 시 embed 필드가 undefined로 유지된다.
 *  4. 경계값(maxCosine === simThresh): STRONG → embed 채워짐.
 *  5. 원본 record가 변경되지 않는다 (불변성).
 *  6. embed 필드에 올바른 EmbeddingSimilarityResult가 저장된다.
 */

import {
  buildDetectionRecord_gate,
  mergeEmbedResult,
} from '../src/detect/build-detection-record.js'
import type { EmbeddingSimilarityResult, StructureGateResult } from '../src/contracts.js'

// ---- 헬퍼 ----

function makeGate(overrides?: Partial<StructureGateResult>): StructureGateResult {
  return {
    type: 'thrashing',
    subtype: 'repeated_tool_call',
    severity: 'warning',
    sessionId: 'session-001',
    agentScope: 'root',
    windowRefs: ['uuid-1', 'uuid-2'],
    metrics: { repeatCount: 3 },
    ...overrides,
  }
}

function makeEmbedResult(
  maxCosine: number,
  pairs?: { a: string; b: string; cos: number }[],
): EmbeddingSimilarityResult {
  return {
    maxCosine,
    pairs: pairs ?? [{ a: 'text-a', b: 'text-b', cos: maxCosine }],
  }
}

const SIM_THRESH = 0.90

// ---- 테스트 ----

describe('mergeEmbedResult', () => {
  describe('임계값 이상: embed 필드 채워짐', () => {
    it('maxCosine > simThresh → embed 필드가 채워진다', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(0.95)

      const merged = mergeEmbedResult(record, embedResult, SIM_THRESH)

      expect(merged.embed).toBeDefined()
      expect(merged.embed).toEqual(embedResult)
    })

    it('maxCosine === simThresh (경계값) → embed 필드가 채워진다 (>= 포함)', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(0.90)

      const merged = mergeEmbedResult(record, embedResult, SIM_THRESH)

      expect(merged.embed).toBeDefined()
      expect(merged.embed).toEqual(embedResult)
    })

    it('maxCosine = 1.0 (동일 벡터) → embed 필드가 채워진다', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(1.0)

      const merged = mergeEmbedResult(record, embedResult, SIM_THRESH)

      expect(merged.embed).toBeDefined()
      expect(merged.embed!.maxCosine).toBe(1.0)
    })
  })

  describe('임계값 미달: embed 필드 undefined 유지', () => {
    it('maxCosine < simThresh → embed 필드가 undefined로 유지된다', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(0.85)

      const merged = mergeEmbedResult(record, embedResult, SIM_THRESH)

      expect(merged.embed).toBeUndefined()
    })

    it('maxCosine = 0.0 → embed 필드가 undefined로 유지된다', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(0.0, [])

      const merged = mergeEmbedResult(record, embedResult, SIM_THRESH)

      expect(merged.embed).toBeUndefined()
    })

    it('maxCosine 임계값 바로 아래 (0.8999) → embed 필드 undefined', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(0.8999)

      const merged = mergeEmbedResult(record, embedResult, SIM_THRESH)

      expect(merged.embed).toBeUndefined()
    })
  })

  describe('gate 필드 불변성', () => {
    it('병합 후 gate 필드는 원본과 동일 참조를 가진다', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(0.95)

      const merged = mergeEmbedResult(record, embedResult, SIM_THRESH)

      expect(merged.gate).toBe(record.gate)
    })

    it('임계값 미달 시에도 gate 필드는 원본과 동일하다', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(0.80)

      const merged = mergeEmbedResult(record, embedResult, SIM_THRESH)

      expect(merged.gate).toBe(record.gate)
    })

    it('gate 필드의 모든 속성이 보존된다', () => {
      const gate = makeGate({
        type: 'false_success',
        subtype: 'self_approval',
        severity: 'critical',
        sessionId: 'session-xyz',
        agentScope: 'agent-123',
        windowRefs: ['w1', 'w2', 'w3'],
        metrics: { repeatCount: 10, editCount: 5 },
      })
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(0.95)

      const merged = mergeEmbedResult(record, embedResult, SIM_THRESH)

      expect(merged.gate.type).toBe('false_success')
      expect(merged.gate.subtype).toBe('self_approval')
      expect(merged.gate.severity).toBe('critical')
      expect(merged.gate.sessionId).toBe('session-xyz')
      expect(merged.gate.agentScope).toBe('agent-123')
      expect(merged.gate.windowRefs).toEqual(['w1', 'w2', 'w3'])
      expect(merged.gate.metrics).toEqual({ repeatCount: 10, editCount: 5 })
    })
  })

  describe('원본 record 불변성', () => {
    it('임계값 이상: 원본 record의 embed가 변경되지 않는다', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(0.95)

      mergeEmbedResult(record, embedResult, SIM_THRESH)

      // 원본 record의 embed는 여전히 undefined
      expect(record.embed).toBeUndefined()
    })

    it('임계값 미달: 반환된 레코드가 원본과 동일 참조이다', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(0.80)

      const merged = mergeEmbedResult(record, embedResult, SIM_THRESH)

      expect(merged).toBe(record)
    })
  })

  describe('EmbeddingSimilarityResult 내용 검증', () => {
    it('pairs 배열이 정확히 저장된다 (BLOCKER C8)', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const pairs = [
        { a: 'text-1', b: 'text-2', cos: 0.92 },
        { a: 'text-1', b: 'text-3', cos: 0.95 },
        { a: 'text-2', b: 'text-3', cos: 0.91 },
      ]
      const embedResult: EmbeddingSimilarityResult = { maxCosine: 0.95, pairs }

      const merged = mergeEmbedResult(record, embedResult, SIM_THRESH)

      expect(merged.embed!.pairs).toHaveLength(3)
      expect(merged.embed!.pairs[0]).toEqual({ a: 'text-1', b: 'text-2', cos: 0.92 })
      expect(merged.embed!.pairs[1]).toEqual({ a: 'text-1', b: 'text-3', cos: 0.95 })
      expect(merged.embed!.pairs[2]).toEqual({ a: 'text-2', b: 'text-3', cos: 0.91 })
    })

    it('maxCosine 값이 정확히 저장된다', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(0.9314)

      const merged = mergeEmbedResult(record, embedResult, SIM_THRESH)

      expect(merged.embed!.maxCosine).toBe(0.9314)
    })

    it('pairs 빈 배열인 EmbeddingSimilarityResult도 저장 가능 (maxCosine >= simThresh)', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      // maxCosine이 임계 이상이면 pairs가 빈 배열이어도 embed에 저장
      const embedResult: EmbeddingSimilarityResult = { maxCosine: 0.95, pairs: [] }

      const merged = mergeEmbedResult(record, embedResult, SIM_THRESH)

      expect(merged.embed).toBeDefined()
      expect(merged.embed!.pairs).toHaveLength(0)
    })
  })

  describe('다른 simThresh 값 테스트', () => {
    it('simThresh=0.70, maxCosine=0.75 → embed 채워짐', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(0.75)

      const merged = mergeEmbedResult(record, embedResult, 0.70)

      expect(merged.embed).toBeDefined()
    })

    it('simThresh=0.70, maxCosine=0.65 → embed undefined', () => {
      const gate = makeGate()
      const record = buildDetectionRecord_gate(gate)
      const embedResult = makeEmbedResult(0.65)

      const merged = mergeEmbedResult(record, embedResult, 0.70)

      expect(merged.embed).toBeUndefined()
    })
  })
})
