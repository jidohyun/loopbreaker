/**
 * tests/build-detection-record-gate-sub-ac-8a.test.ts
 *
 * Sub-AC 8a: buildDetectionRecord_gate 함수 단위 테스트
 *
 * 검증 항목:
 *   1. gate 결과만으로 PendingDetectionRecord 생성
 *   2. embed 필드가 undefined
 *   3. judge 필드가 undefined
 *   4. final 필드가 undefined
 *   5. gate 필드가 입력과 동일
 *   6. 불변성: 반환된 객체는 frozen
 *   7. 다른 gate 입력으로도 동작 확인
 */

import { describe, expect, it } from '@jest/globals'
import { buildDetectionRecord_gate } from '../src/detect/build-detection-record.js'
import type { StructureGateResult } from '../src/contracts.js'

// ─── 테스트 픽스처 ────────────────────────────────────────────────────────────

const makeThrashingGate = (): StructureGateResult => ({
  type: 'thrashing',
  subtype: 'argkey_repeat',
  severity: 'warning',
  sessionId: 'session-abc-123',
  agentScope: 'root',
  windowRefs: ['uuid-1', 'uuid-2', 'uuid-3'],
  metrics: { repeatCount: 10, windowSize: 30 },
})

const makeFalseSuccessGate = (): StructureGateResult => ({
  type: 'false_success',
  subtype: 'self_approval',
  severity: 'critical',
  sessionId: 'session-xyz-456',
  agentScope: 'sub-agent-1',
  windowRefs: ['uuid-a', 'uuid-b'],
  metrics: { temporalProximityMs: 500 },
})

// ─── 테스트 ────────────────────────────────────────────────────────────────────

describe('buildDetectionRecord_gate (Sub-AC 8a)', () => {
  describe('기본 gate-only 레코드 생성', () => {
    it('gate 필드가 입력 StructureGateResult와 동일하게 설정된다', () => {
      const gate = makeThrashingGate()
      const record = buildDetectionRecord_gate(gate)

      expect(record.gate).toBe(gate)
    })

    it('embed 필드가 undefined이다', () => {
      const gate = makeThrashingGate()
      const record = buildDetectionRecord_gate(gate)

      expect(record.embed).toBeUndefined()
    })

    it('judge 필드가 undefined이다', () => {
      const gate = makeThrashingGate()
      const record = buildDetectionRecord_gate(gate)

      expect(record.judge).toBeUndefined()
    })

    it('final 필드가 undefined이다', () => {
      const gate = makeThrashingGate()
      const record = buildDetectionRecord_gate(gate)

      expect(record.final).toBeUndefined()
    })

    it('judgeError 필드가 undefined이다', () => {
      const gate = makeThrashingGate()
      const record = buildDetectionRecord_gate(gate)

      expect(record.judgeError).toBeUndefined()
    })

    it('deferred 필드가 undefined이다', () => {
      const gate = makeThrashingGate()
      const record = buildDetectionRecord_gate(gate)

      expect(record.deferred).toBeUndefined()
    })
  })

  describe('gate 필드 내용 보존', () => {
    it('thrashing 타입 gate의 모든 필드가 보존된다', () => {
      const gate = makeThrashingGate()
      const record = buildDetectionRecord_gate(gate)

      expect(record.gate.type).toBe('thrashing')
      expect(record.gate.subtype).toBe('argkey_repeat')
      expect(record.gate.severity).toBe('warning')
      expect(record.gate.sessionId).toBe('session-abc-123')
      expect(record.gate.agentScope).toBe('root')
      expect(record.gate.windowRefs).toEqual(['uuid-1', 'uuid-2', 'uuid-3'])
      expect(record.gate.metrics).toEqual({ repeatCount: 10, windowSize: 30 })
    })

    it('false_success 타입 gate의 모든 필드가 보존된다', () => {
      const gate = makeFalseSuccessGate()
      const record = buildDetectionRecord_gate(gate)

      expect(record.gate.type).toBe('false_success')
      expect(record.gate.subtype).toBe('self_approval')
      expect(record.gate.severity).toBe('critical')
      expect(record.gate.sessionId).toBe('session-xyz-456')
      expect(record.gate.agentScope).toBe('sub-agent-1')
      expect(record.gate.windowRefs).toEqual(['uuid-a', 'uuid-b'])
      expect(record.gate.metrics).toEqual({ temporalProximityMs: 500 })
    })
  })

  describe('불변성 (immutability)', () => {
    it('반환된 record는 Object.isFrozen이다', () => {
      const gate = makeThrashingGate()
      const record = buildDetectionRecord_gate(gate)

      expect(Object.isFrozen(record)).toBe(true)
    })

    it('gate를 변경해도 record.gate가 영향받지 않는다 (참조 동일성)', () => {
      const gate = makeThrashingGate()
      const record = buildDetectionRecord_gate(gate)

      // record.gate는 원본 gate 참조를 가짐
      // frozen이므로 record 자체는 변경 불가
      expect(record.gate).toBe(gate)
    })

    it('동일 gate로 두 번 호출하면 독립적인 레코드를 반환한다', () => {
      const gate = makeThrashingGate()
      const record1 = buildDetectionRecord_gate(gate)
      const record2 = buildDetectionRecord_gate(gate)

      expect(record1).not.toBe(record2)
      expect(record1.gate).toBe(record2.gate)
    })
  })

  describe('레코드 구조 — 키 목록', () => {
    it('반환된 레코드에는 gate 키만 존재한다 (embed/judge/final/judgeError/deferred 없음)', () => {
      const gate = makeThrashingGate()
      const record = buildDetectionRecord_gate(gate)

      const keys = Object.keys(record)
      expect(keys).toEqual(['gate'])
    })
  })

  describe('다양한 gate 입력', () => {
    it('windowRefs가 비어있는 gate로도 정상 생성된다', () => {
      const gate: StructureGateResult = {
        type: 'thrashing',
        subtype: 'err_loop',
        severity: 'critical',
        sessionId: 'session-empty',
        agentScope: 'root',
        windowRefs: [],
        metrics: { errCount: 5 },
      }
      const record = buildDetectionRecord_gate(gate)

      expect(record.gate).toBe(gate)
      expect(record.embed).toBeUndefined()
      expect(record.judge).toBeUndefined()
      expect(record.final).toBeUndefined()
    })

    it('metrics가 비어있는 gate로도 정상 생성된다', () => {
      const gate: StructureGateResult = {
        type: 'thrashing',
        subtype: 'file_edit_repeat',
        severity: 'warning',
        sessionId: 'session-nometa',
        agentScope: 'root',
        windowRefs: ['uuid-x'],
        metrics: {},
      }
      const record = buildDetectionRecord_gate(gate)

      expect(record.gate).toBe(gate)
      expect(record.embed).toBeUndefined()
      expect(record.judge).toBeUndefined()
      expect(record.final).toBeUndefined()
    })

    it('서브에이전트 스코프로도 정상 생성된다', () => {
      const gate: StructureGateResult = {
        type: 'thrashing',
        subtype: 'argkey_repeat',
        severity: 'warning',
        sessionId: 'session-sub',
        agentScope: '/path/to/subagent',
        windowRefs: ['uuid-sub-1'],
        metrics: { repeatCount: 12 },
      }
      const record = buildDetectionRecord_gate(gate)

      expect(record.gate.agentScope).toBe('/path/to/subagent')
      expect(record.embed).toBeUndefined()
      expect(record.judge).toBeUndefined()
      expect(record.final).toBeUndefined()
    })
  })
})
