/**
 * tests/merge-judge-verdict-sub-ac-8c.test.ts
 *
 * Sub-AC 8c: mergeJudgeVerdict 함수 단위 테스트
 *
 * 검증 항목:
 *  1. embed가 채워진 DetectionRecord에 JudgeVerdict를 병합하면 judge 필드가 채워진다.
 *  2. gate 필드는 병합 후에도 불변이다.
 *  3. embed 필드는 병합 후에도 불변이다.
 *  4. judgeVerdict가 undefined이면 judge 필드가 undefined로 유지된다.
 *  5. 원본 record가 변경되지 않는다 (불변성).
 *  6. judge 필드에 올바른 JudgeVerdict가 저장된다 (BLOCKER C1/C2).
 *  7. kind 값이 'thrashing' | 'false_success' | 'none' 모두 처리된다.
 *  8. rawSamples가 정확히 보존된다 (편향완화 감사용).
 */

import { describe, expect, it } from '@jest/globals'
import {
  buildDetectionRecord_gate,
  buildDetectionRecord_embed,
  mergeJudgeVerdict,
} from '../src/detect/build-detection-record.js'
import type {
  EmbeddingSimilarityResult,
  JudgeVerdict,
  StructureGateResult,
} from '../src/contracts.js'

// ─── 테스트 픽스처 ────────────────────────────────────────────────────────────

function makeGate(overrides?: Partial<StructureGateResult>): StructureGateResult {
  return {
    type: 'thrashing',
    subtype: 'argkey_repeat',
    severity: 'warning',
    sessionId: 'session-001',
    agentScope: 'root',
    windowRefs: ['uuid-1', 'uuid-2'],
    metrics: { repeatCount: 5 },
    ...overrides,
  }
}

function makeEmbedResult(maxCosine = 0.95): EmbeddingSimilarityResult {
  return {
    maxCosine,
    pairs: [{ a: 'text-a', b: 'text-b', cos: maxCosine }],
  }
}

function makeJudgeVerdict(
  kind: JudgeVerdict['kind'] = 'thrashing',
  overrides?: Partial<JudgeVerdict>,
): JudgeVerdict {
  return {
    kind,
    subtype: 'repeated_tool_call',
    confidence: 0.88,
    reason: 'Agent is calling the same tool repeatedly without progress.',
    rawSamples: ['sample-response-1', 'sample-response-2'],
    ...overrides,
  }
}

/** gate + embed가 채워진 PendingDetectionRecord를 생성하는 헬퍼 */
function makeEmbedRecord() {
  const gate = makeGate()
  const embed = makeEmbedResult()
  const gateRecord = buildDetectionRecord_gate(gate)
  return buildDetectionRecord_embed(gateRecord, embed)
}

// ─── 테스트 ────────────────────────────────────────────────────────────────────

describe('mergeJudgeVerdict (Sub-AC 8c)', () => {
  // ── 1. judge 필드 채워짐 ──────────────────────────────────────────────────

  describe('judgeVerdict 제공 시: judge 필드가 채워진다', () => {
    it('thrashing verdict → judge 필드가 채워진다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict('thrashing')

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judge).toBeDefined()
      expect(merged.judge).toEqual(verdict)
    })

    it('false_success verdict → judge 필드가 채워진다 (BLOCKER C1)', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict('false_success', {
        subtype: 'self_approval',
        confidence: 0.95,
        reason: 'The agent approved its own output without external verification.',
      })

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judge).toBeDefined()
      expect(merged.judge!.kind).toBe('false_success')
      expect(merged.judge!.subtype).toBe('self_approval')
    })

    it('none verdict → judge 필드가 채워진다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict('none', {
        subtype: 'no_issue',
        confidence: 0.10,
        reason: 'No thrashing or false success detected.',
      })

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judge).toBeDefined()
      expect(merged.judge!.kind).toBe('none')
    })

    it('반환된 레코드는 Object.isFrozen이다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict()

      const merged = mergeJudgeVerdict(record, verdict)

      expect(Object.isFrozen(merged)).toBe(true)
    })
  })

  // ── 2. judge 미진행: judge 필드 undefined 유지 ──────────────────────────

  describe('judgeVerdict === undefined: judge 필드가 undefined로 유지된다', () => {
    it('undefined 전달 → judge 필드가 undefined이다', () => {
      const record = makeEmbedRecord()

      const merged = mergeJudgeVerdict(record, undefined)

      expect(merged.judge).toBeUndefined()
    })

    it('undefined 전달 → 원본 record와 동일 참조를 반환한다', () => {
      const record = makeEmbedRecord()

      const merged = mergeJudgeVerdict(record, undefined)

      expect(merged).toBe(record)
    })

    it('gate-only record + undefined → judge 필드가 undefined이다', () => {
      const gate = makeGate()
      const gateRecord = buildDetectionRecord_gate(gate)

      const merged = mergeJudgeVerdict(gateRecord, undefined)

      expect(merged.judge).toBeUndefined()
      expect(merged).toBe(gateRecord)
    })
  })

  // ── 3. gate 필드 불변성 ──────────────────────────────────────────────────

  describe('gate 필드는 병합 후에도 불변이다', () => {
    it('judge 병합 후 gate 필드는 원본과 동일 참조를 가진다', () => {
      const gate = makeGate()
      const gateRecord = buildDetectionRecord_gate(gate)
      const embedRecord = buildDetectionRecord_embed(gateRecord, makeEmbedResult())
      const verdict = makeJudgeVerdict()

      const merged = mergeJudgeVerdict(embedRecord, verdict)

      expect(merged.gate).toBe(gate)
    })

    it('gate 필드의 모든 속성이 보존된다', () => {
      const gate = makeGate({
        type: 'false_success',
        subtype: 'self_approval',
        severity: 'critical',
        sessionId: 'session-xyz',
        agentScope: 'sub-agent-99',
        windowRefs: ['w1', 'w2', 'w3'],
        metrics: { repeatCount: 10, editCount: 5 },
      })
      const gateRecord = buildDetectionRecord_gate(gate)
      const embedRecord = buildDetectionRecord_embed(gateRecord, makeEmbedResult())
      const verdict = makeJudgeVerdict()

      const merged = mergeJudgeVerdict(embedRecord, verdict)

      expect(merged.gate.type).toBe('false_success')
      expect(merged.gate.subtype).toBe('self_approval')
      expect(merged.gate.severity).toBe('critical')
      expect(merged.gate.sessionId).toBe('session-xyz')
      expect(merged.gate.agentScope).toBe('sub-agent-99')
      expect(merged.gate.windowRefs).toEqual(['w1', 'w2', 'w3'])
      expect(merged.gate.metrics).toEqual({ repeatCount: 10, editCount: 5 })
    })
  })

  // ── 4. embed 필드 불변성 ─────────────────────────────────────────────────

  describe('embed 필드는 병합 후에도 불변이다', () => {
    it('judge 병합 후 embed 필드는 원본과 동일 참조를 가진다', () => {
      const embedResult = makeEmbedResult(0.93)
      const gateRecord = buildDetectionRecord_gate(makeGate())
      const embedRecord = buildDetectionRecord_embed(gateRecord, embedResult)
      const verdict = makeJudgeVerdict()

      const merged = mergeJudgeVerdict(embedRecord, verdict)

      expect(merged.embed).toBe(embedResult)
    })

    it('embed 필드의 maxCosine과 pairs가 보존된다', () => {
      const pairs = [
        { a: 'text-1', b: 'text-2', cos: 0.92 },
        { a: 'text-1', b: 'text-3', cos: 0.93 },
      ]
      const embedResult: EmbeddingSimilarityResult = { maxCosine: 0.93, pairs }
      const gateRecord = buildDetectionRecord_gate(makeGate())
      const embedRecord = buildDetectionRecord_embed(gateRecord, embedResult)
      const verdict = makeJudgeVerdict()

      const merged = mergeJudgeVerdict(embedRecord, verdict)

      expect(merged.embed!.maxCosine).toBe(0.93)
      expect(merged.embed!.pairs).toHaveLength(2)
      expect(merged.embed!.pairs[0]).toEqual({ a: 'text-1', b: 'text-2', cos: 0.92 })
    })
  })

  // ── 5. 원본 record 불변성 ────────────────────────────────────────────────

  describe('원본 record 불변성', () => {
    it('병합 후 원본 record의 judge 필드가 변경되지 않는다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict()

      mergeJudgeVerdict(record, verdict)

      expect(record.judge).toBeUndefined()
    })

    it('병합 후 원본 record의 gate 필드가 변경되지 않는다', () => {
      const gate = makeGate()
      const gateRecord = buildDetectionRecord_gate(gate)
      const embedRecord = buildDetectionRecord_embed(gateRecord, makeEmbedResult())
      const verdict = makeJudgeVerdict()

      mergeJudgeVerdict(embedRecord, verdict)

      expect(embedRecord.gate).toBe(gate)
    })

    it('병합 결과 레코드와 원본 레코드는 다른 참조이다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict()

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged).not.toBe(record)
    })
  })

  // ── 6. JudgeVerdict 내용 검증 (BLOCKER C1/C2) ────────────────────────────

  describe('JudgeVerdict 내용 정확성 (BLOCKER C1/C2)', () => {
    it('kind 필드가 정확히 저장된다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict('false_success')

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judge!.kind).toBe('false_success')
    })

    it('subtype 필드가 정확히 저장된다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict('thrashing', { subtype: 'err_loop_repeat' })

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judge!.subtype).toBe('err_loop_repeat')
    })

    it('confidence 필드가 정확히 저장된다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict('thrashing', { confidence: 0.7654 })

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judge!.confidence).toBe(0.7654)
    })

    it('reason 필드가 정확히 저장된다', () => {
      const record = makeEmbedRecord()
      const reason = 'Detected circular reference in agent approval chain.'
      const verdict = makeJudgeVerdict('false_success', { reason })

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judge!.reason).toBe(reason)
    })

    it('topicDivergence 선택 필드가 보존된다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict('thrashing', { topicDivergence: 0.42 })

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judge!.topicDivergence).toBe(0.42)
    })

    it('circularReference 선택 필드가 보존된다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict('false_success', { circularReference: true })

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judge!.circularReference).toBe(true)
    })

    it('topicDivergence/circularReference 미설정 시 undefined이다', () => {
      const record = makeEmbedRecord()
      const verdict: JudgeVerdict = {
        kind: 'none',
        subtype: 'no_issue',
        confidence: 0.05,
        reason: 'Nothing detected.',
        rawSamples: [],
      }

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judge!.topicDivergence).toBeUndefined()
      expect(merged.judge!.circularReference).toBeUndefined()
    })
  })

  // ── 7. rawSamples 보존 (편향완화 감사용) ────────────────────────────────

  describe('rawSamples 보존 (self-consistency 편향완화 감사)', () => {
    it('rawSamples 배열이 정확히 저장된다', () => {
      const record = makeEmbedRecord()
      const rawSamples = [
        { verdict: 'thrashing', confidence: 0.9 },
        { verdict: 'thrashing', confidence: 0.85 },
        { verdict: 'none', confidence: 0.2 },
      ]
      const verdict = makeJudgeVerdict('thrashing', { rawSamples })

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judge!.rawSamples).toHaveLength(3)
      expect(merged.judge!.rawSamples[0]).toEqual({ verdict: 'thrashing', confidence: 0.9 })
      expect(merged.judge!.rawSamples[2]).toEqual({ verdict: 'none', confidence: 0.2 })
    })

    it('rawSamples가 빈 배열이어도 저장된다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict('none', { rawSamples: [] })

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judge!.rawSamples).toEqual([])
    })

    it('N×2개(position swap 포함) rawSamples가 모두 보존된다', () => {
      const record = makeEmbedRecord()
      // N=3 self-consistency × 2 positions (swap) = 6 samples
      const rawSamples = [
        'original-sample-1',
        'original-sample-2',
        'original-sample-3',
        'swapped-sample-1',
        'swapped-sample-2',
        'swapped-sample-3',
      ]
      const verdict = makeJudgeVerdict('thrashing', { rawSamples })

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judge!.rawSamples).toHaveLength(6)
      expect(merged.judge!.rawSamples[3]).toBe('swapped-sample-1')
    })
  })

  // ── 8. 단조 누적: 이전 필드 보존 검증 ──────────────────────────────────

  describe('단조 누적: 이전 단계 필드 보존', () => {
    it('gate → embed → judge 순서로 누적 시 모든 필드가 보존된다', () => {
      const gate = makeGate({ sessionId: 'session-mono', windowRefs: ['r1', 'r2'] })
      const embed = makeEmbedResult(0.97)
      const verdict = makeJudgeVerdict('false_success', {
        subtype: 'self_approval',
        confidence: 0.91,
      })

      const step1 = buildDetectionRecord_gate(gate)
      const step2 = buildDetectionRecord_embed(step1, embed)
      const step3 = mergeJudgeVerdict(step2, verdict)

      // gate 보존
      expect(step3.gate).toBe(gate)
      expect(step3.gate.sessionId).toBe('session-mono')
      expect(step3.gate.windowRefs).toEqual(['r1', 'r2'])

      // embed 보존
      expect(step3.embed).toBe(embed)
      expect(step3.embed!.maxCosine).toBe(0.97)

      // judge 채워짐
      expect(step3.judge).toBeDefined()
      expect(step3.judge!.kind).toBe('false_success')
      expect(step3.judge!.confidence).toBe(0.91)
    })

    it('judge 이후 단계(final)는 여전히 undefined이다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict()

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.final).toBeUndefined()
    })

    it('judgeError/deferred 필드는 mergeJudgeVerdict로 설정되지 않는다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict()

      const merged = mergeJudgeVerdict(record, verdict)

      expect(merged.judgeError).toBeUndefined()
      expect(merged.deferred).toBeUndefined()
    })
  })

  // ── 9. 레코드 구조 키 검증 ───────────────────────────────────────────────

  describe('레코드 구조 키 목록', () => {
    it('judge 병합 후 레코드는 gate, embed, judge 키를 가진다', () => {
      const record = makeEmbedRecord()
      const verdict = makeJudgeVerdict()

      const merged = mergeJudgeVerdict(record, verdict)

      const keys = Object.keys(merged).sort()
      expect(keys).toContain('gate')
      expect(keys).toContain('embed')
      expect(keys).toContain('judge')
      expect(keys).not.toContain('final')
      expect(keys).not.toContain('judgeError')
      expect(keys).not.toContain('deferred')
    })

    it('undefined 전달 시 레코드는 gate, embed 키만 가진다', () => {
      const record = makeEmbedRecord()

      const merged = mergeJudgeVerdict(record, undefined)

      const keys = Object.keys(merged).sort()
      expect(keys).toContain('gate')
      expect(keys).toContain('embed')
      expect(keys).not.toContain('judge')
    })
  })
})
