/**
 * tests/notify-integration-m4.test.ts
 *
 * M4 End-to-End 통합 테스트.
 *
 * M3 DetectionRecord → VerdictRouter → NotifyDispatcher → MockNotifySink
 *
 * 검증:
 *   - thrashing/false_success 케이스 → 발송
 *   - kind=none / 저신뢰도 / 디바운스 케이스 → 미발송
 *   - M0~M3 재사용 확인 (contracts 타입 그대로 소비)
 *   - NotificationPayload §7-2 #7 스키마 검증 통과
 *
 * 부수효과 없음 — MockNotifySink만 사용.
 */

import { describe, expect, it, beforeEach } from '@jest/globals'
import Database from 'better-sqlite3'
import { NotificationPayloadSchema } from '../src/contracts.js'
import type {
  DetectionRecord,
  StructureGateResult,
  EmbeddingSimilarityResult,
  JudgeVerdict,
} from '../src/contracts.js'
import {
  buildDetectionRecord_gate,
  buildDetectionRecord_embed,
  buildDetectionRecord_judge,
  buildDetectionRecord_judgeError,
  resolveDetectionRecord,
} from '../src/detect/build-detection-record.js'
import { NotifyDispatcher } from '../src/notify/notify-dispatcher.js'
import { MockNotifySink } from '../src/notify/sinks/mock-notify-sink.js'
import { CooldownStore, ensureNotificationsTable } from '../src/notify/cooldown-store.js'

// ─── 픽스처 빌더 ─────────────────────────────────────────────────────────────

function makeGate(
  type: 'thrashing' | 'false_success',
  sessionId: string,
): StructureGateResult {
  return {
    type,
    subtype: 'argkey_repeat',
    severity: type === 'false_success' ? 'critical' : 'warning',
    sessionId,
    agentScope: 'root',
    windowRefs: ['ev-uuid-1', 'ev-uuid-2', 'ev-uuid-3'],
    metrics: { repeatCount: 15, windowSize: 30 },
  }
}

function makeEmbed(): EmbeddingSimilarityResult {
  return {
    maxCosine: 0.96,
    pairs: [{ a: 'ev-uuid-1', b: 'ev-uuid-2', cos: 0.96 }],
  }
}

function makeJudge(
  kind: 'thrashing' | 'false_success' | 'none',
  confidence: number,
): JudgeVerdict {
  return {
    kind,
    subtype: 'argkey_repeat',
    confidence,
    reason: `Judge verdict: ${kind} with confidence ${confidence}`,
    rawSamples: [{ vote: kind, conf: confidence }],
  }
}

/**
 * 완전한 M3 파이프라인을 거쳐 DetectionRecord를 생성한다.
 * buildDetectionRecord_gate → _embed → _judge → resolveDetectionRecord
 */
function buildFullRecord(
  type: 'thrashing' | 'false_success',
  sessionId: string,
  judgeKind: 'thrashing' | 'false_success' | 'none',
  confidence: number,
): DetectionRecord {
  const gate = makeGate(type, sessionId)
  const pending = buildDetectionRecord_gate(gate)
  const withEmbed = buildDetectionRecord_embed(pending, makeEmbed())
  const withJudge = buildDetectionRecord_judge(withEmbed, makeJudge(judgeKind, confidence))
  return resolveDetectionRecord(withJudge)
}

/**
 * judgeError DetectionRecord를 생성한다.
 */
function buildJudgeErrorRecord(sessionId: string): DetectionRecord {
  const gate = makeGate('thrashing', sessionId)
  const pending = buildDetectionRecord_gate(gate)
  const withEmbed = buildDetectionRecord_embed(pending, makeEmbed())
  const withError = buildDetectionRecord_judgeError(withEmbed)
  return resolveDetectionRecord(withError)
}

// ─── 테스트 설정 ──────────────────────────────────────────────────────────────

const SESSION_A = 'session-integration-A'
const SESSION_B = 'session-integration-B'
const DECIDE_THRESH = 0.7
const DEBOUNCE_MS = 60_000
const NOW = 5_000_000

function makeTestEnv(overrides: {
  decideThresh?: number
  notifyDebounceMs?: number
  lowConfidenceNotify?: boolean
} = {}) {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureNotificationsTable(db)

  const cooldown = new CooldownStore(db)
  const sink = new MockNotifySink()
  const dispatcher = new NotifyDispatcher(
    [sink],
    cooldown,
    {
      decideThresh: overrides.decideThresh ?? DECIDE_THRESH,
      notifyDebounceMs: overrides.notifyDebounceMs ?? DEBOUNCE_MS,
      lowConfidenceNotify: overrides.lowConfidenceNotify ?? false,
    },
  )

  return { db, cooldown, sink, dispatcher }
}

// ─── 테스트 ────────────────────────────────────────────────────────────────────

describe('M3 DetectionRecord → VerdictRouter → NotifyDispatcher E2E (MockNotifySink)', () => {
  let env: ReturnType<typeof makeTestEnv>

  beforeEach(() => {
    env = makeTestEnv()
  })

  describe('발송 케이스: thrashing/false_success 고신뢰도', () => {
    it('thrashing 고신뢰도 레코드 → 알림 발송', async () => {
      const record = buildFullRecord('thrashing', SESSION_A, 'thrashing', 0.92)

      const result = await env.dispatcher.dispatch(record, SESSION_A, NOW)

      expect(result.routed).toBe(true)
      expect(env.sink.count).toBe(1)

      const payload = env.sink.last!.payload
      expect(payload.kind).toBe('thrashing')
      expect(payload.sessionId).toBe(SESSION_A)
      expect(payload.confidence).toBe(0.92)
    })

    it('false_success 고신뢰도 레코드 → 알림 발송', async () => {
      const record = buildFullRecord('false_success', SESSION_A, 'false_success', 0.88)

      const result = await env.dispatcher.dispatch(record, SESSION_A, NOW)

      expect(result.routed).toBe(true)
      expect(env.sink.last!.payload.kind).toBe('false_success')
    })

    it('발송된 payload는 §7-2 #7 스키마(NotificationPayloadSchema)를 통과한다', async () => {
      const record = buildFullRecord('thrashing', SESSION_A, 'thrashing', 0.92)

      await env.dispatcher.dispatch(record, SESSION_A, NOW)

      const payload = env.sink.last!.payload
      const parseResult = NotificationPayloadSchema.safeParse(payload)
      expect(parseResult.success).toBe(true)
    })

    it('payload.evidence는 근거 목록을 담고 있다 (사람 호출용)', async () => {
      const record = buildFullRecord('thrashing', SESSION_A, 'thrashing', 0.92)

      await env.dispatcher.dispatch(record, SESSION_A, NOW)

      const payload = env.sink.last!.payload
      expect(payload.evidence.length).toBeGreaterThan(0)
      for (const ev of payload.evidence) {
        expect(typeof ev.uuid).toBe('string')
        expect(typeof ev.ts).toBe('number')
        expect(typeof ev.note).toBe('string')
      }
    })

    it('payload.dedupeKey = sessionId + 0x1F + kind', async () => {
      const record = buildFullRecord('thrashing', SESSION_A, 'thrashing', 0.92)

      await env.dispatcher.dispatch(record, SESSION_A, NOW)

      expect(env.sink.last!.payload.dedupeKey).toBe(`${SESSION_A}\x1fthrashing`)
    })
  })

  describe('미발송 케이스: kind=none', () => {
    it('judge가 none을 반환하면 미발송', async () => {
      const record = buildFullRecord('thrashing', SESSION_A, 'none', 0.0)

      const result = await env.dispatcher.dispatch(record, SESSION_A, NOW)

      expect(result.routed).toBe(false)
      expect(result.suppressedReason).toBe('kind_none')
      expect(env.sink.count).toBe(0)
    })
  })

  describe('미발송 케이스: 저신뢰도', () => {
    it('confidence=0.5 < decideThresh=0.7 → 미발송', async () => {
      const record = buildFullRecord('thrashing', SESSION_A, 'thrashing', 0.5)

      const result = await env.dispatcher.dispatch(record, SESSION_A, NOW)

      expect(result.routed).toBe(false)
      expect(result.suppressedReason).toBe('below_threshold')
      expect(env.sink.count).toBe(0)
    })
  })

  describe('미발송 케이스: 디바운스', () => {
    it('동일 session+kind 디바운스 윈도우 내 재발송 → 미발송', async () => {
      const record = buildFullRecord('thrashing', SESSION_A, 'thrashing', 0.92)

      // 첫 발송
      await env.dispatcher.dispatch(record, SESSION_A, NOW)
      expect(env.sink.count).toBe(1)

      // 30초 후 재시도 (윈도우 내)
      const result = await env.dispatcher.dispatch(record, SESSION_A, NOW + 30_000)
      expect(result.routed).toBe(false)
      expect(result.suppressedReason).toBe('debounced')
      expect(env.sink.count).toBe(1)
    })

    it('다른 session의 동일 kind는 디바운스되지 않는다', async () => {
      const record = buildFullRecord('thrashing', SESSION_A, 'thrashing', 0.92)

      await env.dispatcher.dispatch(record, SESSION_A, NOW)

      // 다른 세션은 독립적으로 발송
      const recordB = buildFullRecord('thrashing', SESSION_B, 'thrashing', 0.92)
      const result = await env.dispatcher.dispatch(recordB, SESSION_B, NOW + 1000)

      expect(result.routed).toBe(true)
      expect(env.sink.count).toBe(2)
    })

    it('동일 session의 다른 kind는 디바운스되지 않는다', async () => {
      const thrashingRecord = buildFullRecord('thrashing', SESSION_A, 'thrashing', 0.92)
      const falseSuccessRecord = buildFullRecord('false_success', SESSION_A, 'false_success', 0.88)

      await env.dispatcher.dispatch(thrashingRecord, SESSION_A, NOW)

      // 같은 세션의 다른 kind는 독립적으로 발송
      const result = await env.dispatcher.dispatch(falseSuccessRecord, SESSION_A, NOW + 1000)
      expect(result.routed).toBe(true)
      expect(env.sink.count).toBe(2)
    })
  })

  describe('judgeError 케이스', () => {
    it('judgeError=true + lowConfidenceNotify=false → 미발송', async () => {
      const record = buildJudgeErrorRecord(SESSION_A)

      const result = await env.dispatcher.dispatch(record, SESSION_A, NOW)

      expect(result.routed).toBe(false)
      expect(env.sink.count).toBe(0)
    })

    it('judgeError=true + lowConfidenceNotify=true → low_confidence 발송', async () => {
      const lowConfEnv = makeTestEnv({ lowConfidenceNotify: true })
      const record = buildJudgeErrorRecord(SESSION_A)

      const result = await lowConfEnv.dispatcher.dispatch(record, SESSION_A, NOW)

      expect(result.routed).toBe(true)
      expect(lowConfEnv.sink.last!.payload.severity).toBe('low_confidence')
    })

    it('judgeError 레코드의 deferred 플래그도 인식한다', () => {
      const record = buildJudgeErrorRecord(SESSION_A)
      expect(record.judgeError).toBe(true)
      expect(record.deferred).toBe(true)
      expect(record.final.kind).toBe('none')
      expect(record.final.subtype).toBe('inconclusive')
    })
  })

  describe('M3 contracts 타입 호환성 (재정의 없이 소비)', () => {
    it('DetectionRecord를 M4에서 변경 없이 소비한다', async () => {
      const record = buildFullRecord('thrashing', SESSION_A, 'thrashing', 0.92)

      // M4에서 record를 단순 소비 (read-only)
      const verdict = record.final
      expect(verdict.kind).toBe('thrashing')
      expect(verdict.confidence).toBe(0.92)
      expect(record.gate.sessionId).toBe(SESSION_A)

      // record 자체는 frozen (M3 불변성 유지)
      expect(Object.isFrozen(record)).toBe(true)
    })
  })
})
