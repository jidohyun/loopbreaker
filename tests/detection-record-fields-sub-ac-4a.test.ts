/**
 * tests/detection-record-fields-sub-ac-4a.test.ts
 *
 * Sub-AC 4a: DetectionRecord 타입의 모든 필수 필드(verdict, timestamp, sessionId 등)가
 * M4 이후에도 동일한 이름·타입으로 존재함을 검증하는 단위 테스트.
 *
 * M4는 DetectionRecord를 읽기만 하고 변경하지 않는다(단조 누적 불변 계승).
 * 이 테스트는 contracts.ts의 DetectionRecord 인터페이스가 M3 정본과
 * 동일한 구조를 유지함을 컴파일 타임 + 런타임으로 이중 검증한다.
 */

import { describe, expect, it } from '@jest/globals'
import type {
  DetectionRecord,
  DetectionVerdict,
  EmbeddingSimilarityResult,
  JudgeVerdict,
  StructureGateResult,
} from '../src/contracts.js'
import { resolveDetectionRecord, buildDetectionRecord_gate } from '../src/detect/build-detection-record.js'

// ─── 테스트 픽스처 ────────────────────────────────────────────────────────────

const makeGate = (): StructureGateResult => ({
  type: 'thrashing',
  subtype: 'argkey_repeat',
  severity: 'warning',
  sessionId: 'session-m4-test',
  agentScope: 'root',
  windowRefs: ['uuid-1', 'uuid-2'],
  metrics: { repeatCount: 12 },
})

const makeEmbed = (): EmbeddingSimilarityResult => ({
  maxCosine: 0.95,
  pairs: [{ a: 'uuid-1', b: 'uuid-2', cos: 0.95 }],
})

const makeJudge = (): JudgeVerdict => ({
  kind: 'thrashing',
  subtype: 'argkey_repeat',
  confidence: 0.92,
  reason: 'LLM judge: thrashing detected',
  rawSamples: [],
})

const makeVerdict = (): DetectionVerdict => ({
  kind: 'thrashing',
  subtype: 'argkey_repeat',
  confidence: 0.92,
  signals: { maxCosine: 0.95, structuralRepeatCount: 12 },
  evidence: [
    { uuid: 'uuid-1', ts: 1000, note: 'gate window ref 1/2' },
    { uuid: 'uuid-2', ts: 2000, note: 'gate window ref 2/2' },
  ],
  reason: 'thrashing detected',
})

function makeFullRecord(): DetectionRecord {
  const gate = makeGate()
  const embed = makeEmbed()
  const judge = makeJudge()

  const pending = buildDetectionRecord_gate(gate)
  const withEmbed = { ...pending, embed }
  const withJudge = { ...withEmbed, judge }
  return resolveDetectionRecord(withJudge)
}

// ─── 테스트 ────────────────────────────────────────────────────────────────────

describe('DetectionRecord 필드 불변성 검증 (Sub-AC 4a)', () => {
  describe('DetectionRecord 필수 필드 존재 확인', () => {
    it('gate 필드가 StructureGateResult 타입으로 존재한다', () => {
      const record = makeFullRecord()

      expect(record).toHaveProperty('gate')
      expect(record.gate).toBeDefined()
      // StructureGateResult 구조 검증
      expect(record.gate).toHaveProperty('type')
      expect(record.gate).toHaveProperty('subtype')
      expect(record.gate).toHaveProperty('severity')
      expect(record.gate).toHaveProperty('sessionId')
      expect(record.gate).toHaveProperty('agentScope')
      expect(record.gate).toHaveProperty('windowRefs')
      expect(record.gate).toHaveProperty('metrics')
    })

    it('final 필드가 DetectionVerdict 타입으로 존재한다', () => {
      const record = makeFullRecord()

      expect(record).toHaveProperty('final')
      expect(record.final).toBeDefined()
      // DetectionVerdict 구조 검증
      expect(record.final).toHaveProperty('kind')
      expect(record.final).toHaveProperty('subtype')
      expect(record.final).toHaveProperty('confidence')
      expect(record.final).toHaveProperty('signals')
      expect(record.final).toHaveProperty('evidence')
      expect(record.final).toHaveProperty('reason')
    })

    it('final.kind는 thrashing|false_success|none 중 하나이다', () => {
      const record = makeFullRecord()
      const validKinds = ['thrashing', 'false_success', 'none']
      expect(validKinds).toContain(record.final.kind)
    })

    it('final.confidence는 0~1 범위의 숫자이다', () => {
      const record = makeFullRecord()
      expect(typeof record.final.confidence).toBe('number')
      expect(record.final.confidence).toBeGreaterThanOrEqual(0)
      expect(record.final.confidence).toBeLessThanOrEqual(1)
    })

    it('final.evidence는 배열이다', () => {
      const record = makeFullRecord()
      expect(Array.isArray(record.final.evidence)).toBe(true)
    })

    it('final.evidence 각 항목은 {uuid, ts, note} 구조이다', () => {
      const record = makeFullRecord()
      for (const ev of record.final.evidence) {
        expect(ev).toHaveProperty('uuid')
        expect(ev).toHaveProperty('ts')
        expect(ev).toHaveProperty('note')
        expect(typeof ev.uuid).toBe('string')
        expect(typeof ev.ts).toBe('number')
        expect(typeof ev.note).toBe('string')
      }
    })

    it('final.signals는 DetectionSignals 구조이다', () => {
      const record = makeFullRecord()
      expect(typeof record.final.signals).toBe('object')
      expect(record.final.signals).not.toBeNull()
    })
  })

  describe('선택적 필드 타입 검증', () => {
    it('embed 필드는 undefined 또는 EmbeddingSimilarityResult이다', () => {
      const record = makeFullRecord()

      if (record.embed !== undefined) {
        expect(record.embed).toHaveProperty('maxCosine')
        expect(record.embed).toHaveProperty('pairs')
        expect(typeof record.embed.maxCosine).toBe('number')
        expect(Array.isArray(record.embed.pairs)).toBe(true)
      }
    })

    it('judge 필드는 undefined 또는 JudgeVerdict이다', () => {
      const record = makeFullRecord()

      if (record.judge !== undefined) {
        expect(record.judge).toHaveProperty('kind')
        expect(record.judge).toHaveProperty('subtype')
        expect(record.judge).toHaveProperty('confidence')
        expect(record.judge).toHaveProperty('reason')
        expect(record.judge).toHaveProperty('rawSamples')
        const validKinds = ['thrashing', 'false_success', 'none']
        expect(validKinds).toContain(record.judge.kind)
      }
    })

    it('judgeError 필드는 undefined 또는 true이다', () => {
      const record = makeFullRecord()

      if (record.judgeError !== undefined) {
        expect(record.judgeError).toBe(true)
      }
    })

    it('deferred 필드는 undefined 또는 true이다', () => {
      const record = makeFullRecord()

      if (record.deferred !== undefined) {
        expect(record.deferred).toBe(true)
      }
    })
  })

  describe('gate 필드 sessionId 동일성 (verdict가 sessionId를 보존하는 경로)', () => {
    it('gate.sessionId는 문자열이다', () => {
      const record = makeFullRecord()
      expect(typeof record.gate.sessionId).toBe('string')
      expect(record.gate.sessionId.length).toBeGreaterThan(0)
    })

    it('gate.agentScope는 root 또는 서브에이전트 경로이다', () => {
      const record = makeFullRecord()
      expect(typeof record.gate.agentScope).toBe('string')
    })
  })

  describe('M4 불변 — DetectionRecord는 M4에서 변경되지 않음', () => {
    it('M4 VerdictRouter가 record.final을 읽어도 record 구조 자체는 변경되지 않는다', () => {
      const record = makeFullRecord()

      // record를 "소비"하여 final을 읽음 (VerdictRouter가 하는 일)
      const verdict: DetectionVerdict = record.final
      void verdict // 사용만 함

      // record 구조 여전히 동일
      expect(record).toHaveProperty('gate')
      expect(record).toHaveProperty('final')
      expect(record.final.kind).toBe('thrashing')
      expect(record.final.confidence).toBe(0.92)
    })

    it('Object.isFrozen(record)는 true이다 (M3 불변성 계승)', () => {
      const record = makeFullRecord()
      expect(Object.isFrozen(record)).toBe(true)
    })

    it('record.final을 재할당하려 하면 strict 모드에서 에러이다', () => {
      const record = makeFullRecord()

      expect(() => {
        // frozen object에 대한 쓰기 시도 → strict 모드에서 TypeError
        ;(record as { final: DetectionVerdict }).final = makeVerdict()
      }).toThrow(TypeError)
    })
  })

  describe('judgeError/deferred 레코드 필드 검증', () => {
    it('judgeError=true 레코드는 final.kind=none, final.subtype=inconclusive이다', () => {
      const gate = makeGate()
      const pending = buildDetectionRecord_gate(gate)
      const withError = { ...pending, judgeError: true as const, deferred: true as const }
      const record = resolveDetectionRecord(withError)

      expect(record.judgeError).toBe(true)
      expect(record.deferred).toBe(true)
      expect(record.final.kind).toBe('none')
      expect(record.final.subtype).toBe('inconclusive')
      expect(record.final.confidence).toBe(0)
    })

    it('judgeError=true 레코드도 gate 필드를 보존한다', () => {
      const gate = makeGate()
      const pending = buildDetectionRecord_gate(gate)
      const withError = { ...pending, judgeError: true as const, deferred: true as const }
      const record = resolveDetectionRecord(withError)

      expect(record.gate).toBe(gate)
      expect(record.gate.sessionId).toBe('session-m4-test')
    })
  })

  describe('타입 컴파일 검증 (타입스크립트 컴파일 통과 자체가 증명)', () => {
    it('DetectionRecord 타입을 직접 구성할 수 있다', () => {
      const gate = makeGate()
      const verdict = makeVerdict()

      const record: DetectionRecord = {
        gate,
        final: verdict,
      }

      expect(record.gate).toBe(gate)
      expect(record.final).toBe(verdict)
    })

    it('모든 선택적 필드를 포함한 DetectionRecord를 구성할 수 있다', () => {
      const gate = makeGate()
      const embed = makeEmbed()
      const judge = makeJudge()
      const verdict = makeVerdict()

      const record: DetectionRecord = {
        gate,
        embed,
        judge,
        judgeError: undefined,
        deferred: undefined,
        final: verdict,
      }

      expect(record.gate).toBe(gate)
      expect(record.embed).toBe(embed)
      expect(record.judge).toBe(judge)
      expect(record.final).toBe(verdict)
    })
  })
})
