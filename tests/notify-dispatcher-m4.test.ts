/**
 * tests/notify-dispatcher-m4.test.ts
 *
 * NotifyDispatcher 통합 테스트.
 *
 * 모든 테스트는 MockNotifySink만 사용 (실제 OS 알림·네트워크 없음).
 *
 * 검증:
 *   - thrashing/false_success → 발송
 *   - kind=none → 미발송
 *   - 저신뢰도 → 미발송
 *   - 디바운스 → 미발송
 *   - judgeError + lowConfidenceNotify=false → 미발송
 *   - judgeError + lowConfidenceNotify=true → low_confidence 발송
 *   - 한 채널 실패가 다른 채널 막지 않음
 *   - 발송 후 cooldown 기록
 */

import { describe, expect, it, beforeEach } from '@jest/globals'
import Database from 'better-sqlite3'
import type { DetectionRecord } from '../src/contracts.js'
import type { StructureGateResult } from '../src/contracts.js'
import { resolveDetectionRecord, buildDetectionRecord_gate } from '../src/detect/build-detection-record.js'
import { NotifyDispatcher } from '../src/notify/notify-dispatcher.js'
import { MockNotifySink } from '../src/notify/sinks/mock-notify-sink.js'
import { CooldownStore, ensureNotificationsTable } from '../src/notify/cooldown-store.js'

// ─── 테스트 헬퍼 ─────────────────────────────────────────────────────────────

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureNotificationsTable(db)
  return db
}

function makeGate(
  kind: 'thrashing' | 'false_success' = 'thrashing',
  sessionId = 'session-test',
): StructureGateResult {
  return {
    type: kind,
    subtype: 'argkey_repeat',
    severity: 'warning',
    sessionId,
    agentScope: 'root',
    windowRefs: ['uuid-1', 'uuid-2'],
    metrics: { repeatCount: 12 },
  }
}

function makeRecord(
  kind: 'thrashing' | 'false_success' | 'none' = 'thrashing',
  confidence = 0.92,
  sessionId = 'session-test',
  judgeError = false,
): DetectionRecord {
  const gateKind = kind === 'none' ? 'thrashing' : kind
  const gate = makeGate(gateKind as 'thrashing' | 'false_success', sessionId)
  const pending = buildDetectionRecord_gate(gate)

  if (judgeError) {
    const withError = { ...pending, judgeError: true as const, deferred: true as const }
    return resolveDetectionRecord(withError)
  }

  // judge verdict를 주입하여 원하는 kind/confidence 조합 생성
  const withJudge = {
    ...pending,
    judge: {
      kind: kind as 'thrashing' | 'false_success' | 'none',
      subtype: 'argkey_repeat',
      confidence,
      reason: `${kind} detected`,
      rawSamples: [] as unknown[],
    },
  }
  return resolveDetectionRecord(withJudge)
}

const SESSION = 'session-test'
const NOW = 2_000_000

// ─── 테스트 ────────────────────────────────────────────────────────────────────

describe('NotifyDispatcher (MockNotifySink 전용)', () => {
  let db: Database.Database
  let cooldown: CooldownStore
  let sink: MockNotifySink

  beforeEach(() => {
    db = makeInMemoryDb()
    cooldown = new CooldownStore(db)
    sink = new MockNotifySink()
  })

  function makeDispatcher(
    overrides: {
      decideThresh?: number
      notifyDebounceMs?: number
      lowConfidenceNotify?: boolean
    } = {},
  ) {
    return new NotifyDispatcher(
      [sink],
      cooldown,
      {
        decideThresh: overrides.decideThresh ?? 0.7,
        notifyDebounceMs: overrides.notifyDebounceMs ?? 60_000,
        lowConfidenceNotify: overrides.lowConfidenceNotify ?? false,
      },
    )
  }

  describe('발송 케이스 (thrashing/false_success)', () => {
    it('thrashing 고신뢰도 → MockNotifySink에 발송됨', async () => {
      const dispatcher = makeDispatcher()
      const record = makeRecord('thrashing', 0.92)

      const result = await dispatcher.dispatch(record, SESSION, NOW)

      expect(result.routed).toBe(true)
      expect(result.successCount).toBe(1)
      expect(sink.count).toBe(1)
      expect(sink.last!.payload.kind).toBe('thrashing')
      expect(sink.last!.payload.sessionId).toBe(SESSION)
    })

    it('false_success 고신뢰도 → MockNotifySink에 발송됨', async () => {
      const dispatcher = makeDispatcher()
      const record = makeRecord('false_success', 0.88)

      const result = await dispatcher.dispatch(record, SESSION, NOW)

      expect(result.routed).toBe(true)
      expect(result.successCount).toBe(1)
      expect(sink.last!.payload.kind).toBe('false_success')
    })

    it('발송된 payload에 evidence가 포함된다', async () => {
      const dispatcher = makeDispatcher()
      const record = makeRecord('thrashing', 0.92)

      await dispatcher.dispatch(record, SESSION, NOW)

      const payload = sink.last!.payload
      expect(Array.isArray(payload.evidence)).toBe(true)
      expect(payload.evidence.length).toBeGreaterThan(0)
      // evidence의 각 항목은 {uuid, ts, note} 구조
      for (const ev of payload.evidence) {
        expect(ev).toHaveProperty('uuid')
        expect(ev).toHaveProperty('ts')
        expect(ev).toHaveProperty('note')
      }
    })

    it('발송 후 cooldown에 dedupeKey가 기록된다', async () => {
      const dispatcher = makeDispatcher()
      const record = makeRecord('thrashing', 0.92)

      await dispatcher.dispatch(record, SESSION, NOW)

      const dedupeKey = `${SESSION}\x1fthrashing`
      const state = cooldown.getDebounceState(dedupeKey)
      expect(state.lastSentTs).toBe(NOW)
    })
  })

  describe('미발송 케이스', () => {
    it('kind=none → 미발송', async () => {
      const dispatcher = makeDispatcher()
      const record = makeRecord('none', 0.0)

      const result = await dispatcher.dispatch(record, SESSION, NOW)

      expect(result.routed).toBe(false)
      expect(result.suppressedReason).toBe('kind_none')
      expect(sink.count).toBe(0)
    })

    it('저신뢰도(confidence<decideThresh) → 미발송', async () => {
      const dispatcher = makeDispatcher({ decideThresh: 0.7 })
      const record = makeRecord('thrashing', 0.5)

      const result = await dispatcher.dispatch(record, SESSION, NOW)

      expect(result.routed).toBe(false)
      expect(result.suppressedReason).toBe('below_threshold')
      expect(sink.count).toBe(0)
    })

    it('디바운스 윈도우 내 재알림 → 미발송', async () => {
      const dispatcher = makeDispatcher({ notifyDebounceMs: 60_000 })
      const record = makeRecord('thrashing', 0.92)

      // 첫 번째 발송
      await dispatcher.dispatch(record, SESSION, NOW)
      expect(sink.count).toBe(1)

      // 디바운스 윈도우 내 재시도
      const result = await dispatcher.dispatch(record, SESSION, NOW + 1000)
      expect(result.routed).toBe(false)
      expect(result.suppressedReason).toBe('debounced')
      expect(sink.count).toBe(1) // 추가 발송 없음
    })

    it('디바운스 윈도우 초과 후 재알림 → 발송', async () => {
      const dispatcher = makeDispatcher({ notifyDebounceMs: 60_000 })
      const record = makeRecord('thrashing', 0.92)

      // 첫 번째 발송
      await dispatcher.dispatch(record, SESSION, NOW)
      expect(sink.count).toBe(1)

      // 윈도우 초과 후 재시도
      const result = await dispatcher.dispatch(record, SESSION, NOW + 60_001)
      expect(result.routed).toBe(true)
      expect(sink.count).toBe(2)
    })

    it('judgeError=true + lowConfidenceNotify=false → 미발송', async () => {
      const dispatcher = makeDispatcher({ lowConfidenceNotify: false })
      const record = makeRecord('none', 0, SESSION, true)

      const result = await dispatcher.dispatch(record, SESSION, NOW)

      expect(result.routed).toBe(false)
      expect(sink.count).toBe(0)
    })
  })

  describe('judgeError + lowConfidenceNotify=true → low_confidence 발송', () => {
    it('judgeError=true + lowConfidenceNotify=true → 발송됨', async () => {
      const dispatcher = makeDispatcher({ lowConfidenceNotify: true })
      const record = makeRecord('none', 0, SESSION, true)

      const result = await dispatcher.dispatch(record, SESSION, NOW)

      expect(result.routed).toBe(true)
      expect(result.successCount).toBe(1)
      expect(sink.last!.payload.severity).toBe('low_confidence')
    })
  })

  describe('다중 sink — 한 채널 실패가 다른 채널 막지 않음', () => {
    it('실패 sink와 성공 sink를 같이 쓰면 성공 채널은 발송됨', async () => {
      const failSink = new MockNotifySink()
      failSink.setFailMode(true)
      const successSink = new MockNotifySink()

      const dispatcher = new NotifyDispatcher(
        [failSink, successSink],
        cooldown,
        { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
      )

      const record = makeRecord('thrashing', 0.92)
      const result = await dispatcher.dispatch(record, SESSION, NOW)

      expect(result.routed).toBe(true)
      expect(result.successCount).toBe(1) // successSink 성공
      expect(result.failCount).toBe(1)    // failSink 실패
      expect(failSink.count).toBe(1)      // failSink도 호출됨
      expect(successSink.count).toBe(1)   // successSink도 호출됨
    })

    it('모든 sink 실패해도 발송 결과가 반환되며 파이프라인이 죽지 않는다', async () => {
      const failSink1 = new MockNotifySink()
      failSink1.setFailMode(true)
      const failSink2 = new MockNotifySink()
      failSink2.setFailMode(true)

      const dispatcher = new NotifyDispatcher(
        [failSink1, failSink2],
        cooldown,
        { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
      )

      const record = makeRecord('thrashing', 0.92)

      // 발송 시도가 예외 없이 완료되어야 함
      await expect(dispatcher.dispatch(record, SESSION, NOW)).resolves.toBeDefined()

      const result = await dispatcher.dispatch(record, SESSION, NOW + 1000)
      expect(result.successCount).toBe(0)
      expect(result.failCount).toBe(2)
    })
  })

  describe('메타 이벤트 발송', () => {
    it('dispatchMeta → severity=meta 알림 발송', async () => {
      const dispatcher = makeDispatcher()

      const result = await dispatcher.dispatchMeta(SESSION, '일일 비용 상한 초과', NOW)

      expect(result.routed).toBe(true)
      expect(sink.last!.payload.severity).toBe('meta')
      expect(sink.last!.payload.kind).toBe('meta')
      expect(sink.last!.payload.reason).toBe('일일 비용 상한 초과')
    })

    it('dispatchMeta → 디바운스로 1회만 발송', async () => {
      const dispatcher = makeDispatcher()

      await dispatcher.dispatchMeta(SESSION, '비용상한', NOW)
      const result2 = await dispatcher.dispatchMeta(SESSION, '비용상한', NOW + 1000)

      expect(result2.routed).toBe(false)
      expect(result2.suppressedReason).toBe('debounced')
      expect(sink.count).toBe(1)
    })
  })

  describe('cooldown DB 영속 + 워밍업', () => {
    it('cooldown.recordSent 후 DB에 기록된다', async () => {
      const dispatcher = makeDispatcher()
      const record = makeRecord('thrashing', 0.92)

      await dispatcher.dispatch(record, SESSION, NOW)

      // DB에서 직접 확인
      const row = db.prepare('SELECT * FROM notifications WHERE dedupe_key = ?')
        .get(`${SESSION}\x1fthrashing`) as { last_sent_ts: number } | undefined

      expect(row).toBeDefined()
      expect(row!.last_sent_ts).toBe(NOW)
    })

    it('재시작 시나리오: 새 CooldownStore가 DB에서 워밍업하면 쿨다운 유지', async () => {
      const dispatcher = makeDispatcher()
      const record = makeRecord('thrashing', 0.92)

      // 첫 번째 발송 (DB에 기록)
      await dispatcher.dispatch(record, SESSION, NOW)

      // 새 CooldownStore 인스턴스 (재시작 시뮬레이션)
      const newCooldown = new CooldownStore(db)
      newCooldown.warmUp() // DB에서 인메모리로 로드

      const newDispatcher = new NotifyDispatcher(
        [sink],
        newCooldown,
        { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
      )

      // 재시작 직후에도 디바운스가 유지되어야 함
      const result = await newDispatcher.dispatch(record, SESSION, NOW + 1000)
      expect(result.routed).toBe(false)
      expect(result.suppressedReason).toBe('debounced')
    })
  })
})
