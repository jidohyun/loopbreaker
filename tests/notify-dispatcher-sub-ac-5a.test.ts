/**
 * tests/notify-dispatcher-sub-ac-5a.test.ts
 *
 * Sub-AC 5a: NotifyDispatcher.dispatch()가 config.notifyChannels 순서대로
 * 주입된 NotifySink 배열을 순차 호출하고, 모든 sink 성공 시 perChannel
 * 배열(= channelResults)에 {channel, ok:true} 항목이 순서대로 담긴
 * NotifyDispatchResult(= DispatchResult)를 반환함을 검증하는 단위 테스트.
 *
 * 테스트 부수효과 절대 금지:
 *   - MockNotifySink만 사용 (실제 OS 알림·네트워크·데스크톱 없음)
 *   - CooldownStore는 in-memory SQLite(:memory:) 사용
 */

import { describe, expect, it, beforeEach } from '@jest/globals'
import Database from 'better-sqlite3'
import type { DetectionRecord, NotificationPayload, NotifyResult, NotifySink } from '../src/contracts.js'
import type { StructureGateResult } from '../src/contracts.js'
import { resolveDetectionRecord, buildDetectionRecord_gate } from '../src/detect/build-detection-record.js'
import { NotifyDispatcher } from '../src/notify/notify-dispatcher.js'
import { MockNotifySink } from '../src/notify/sinks/mock-notify-sink.js'
import { CooldownStore, ensureNotificationsTable } from '../src/notify/cooldown-store.js'

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureNotificationsTable(db)
  return db
}

function makeGate(
  kind: 'thrashing' | 'false_success' = 'thrashing',
  sessionId = 'session-5a',
): StructureGateResult {
  return {
    type: kind,
    subtype: 'argkey_repeat',
    severity: 'warning',
    sessionId,
    agentScope: 'root',
    windowRefs: ['uuid-a', 'uuid-b'],
    metrics: { repeatCount: 5 },
  }
}

function makeRecord(
  kind: 'thrashing' | 'false_success' = 'thrashing',
  confidence = 0.9,
  sessionId = 'session-5a',
): DetectionRecord {
  const gate = makeGate(kind, sessionId)
  const pending = buildDetectionRecord_gate(gate)
  const withJudge = {
    ...pending,
    judge: {
      kind,
      subtype: 'argkey_repeat',
      confidence,
      reason: `${kind} detected`,
      rawSamples: [] as unknown[],
    },
  }
  return resolveDetectionRecord(withJudge)
}

/** 호출 순서를 기록하는 추적 MockNotifySink */
class OrderedMockSink implements NotifySink {
  readonly callOrder: string[] = []
  constructor(
    readonly channelName: 'desktop' | 'webhook' | 'cli' | 'mock',
    private readonly callLog: string[],
  ) {}

  async send(_payload: NotificationPayload): Promise<NotifyResult> {
    this.callLog.push(this.channelName)
    this.callOrder.push(this.channelName)
    return { success: true, channel: this.channelName }
  }
}

const SESSION = 'session-5a'
const NOW = 3_000_000

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('Sub-AC 5a: NotifyDispatcher.dispatch() — 순서대로 sink 호출 + perChannel {ok:true}', () => {
  let db: Database.Database
  let cooldown: CooldownStore

  beforeEach(() => {
    db = makeDb()
    cooldown = new CooldownStore(db)
  })

  it('단일 MockNotifySink 성공 → channelResults에 {channel:"mock", success:true} 1항목', async () => {
    const sink = new MockNotifySink()
    const dispatcher = new NotifyDispatcher(
      [sink],
      cooldown,
      { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
    )
    const record = makeRecord('thrashing', 0.9)

    const result = await dispatcher.dispatch(record, SESSION, NOW)

    expect(result.routed).toBe(true)
    expect(result.channelResults).toHaveLength(1)
    // perChannel 첫 항목: channel='mock', ok=true (success:true)
    expect(result.channelResults[0].success).toBe(true)
    expect(result.channelResults[0].channel).toBe('mock')
    expect(result.successCount).toBe(1)
    expect(result.failCount).toBe(0)
  })

  it('두 MockNotifySink → channelResults에 순서대로 2항목, 모두 success:true', async () => {
    const sink1 = new MockNotifySink()
    const sink2 = new MockNotifySink()
    const dispatcher = new NotifyDispatcher(
      [sink1, sink2],
      cooldown,
      { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
    )
    const record = makeRecord('thrashing', 0.9)

    const result = await dispatcher.dispatch(record, SESSION, NOW)

    expect(result.routed).toBe(true)
    expect(result.channelResults).toHaveLength(2)

    // 두 항목 모두 ok:true
    expect(result.channelResults[0].success).toBe(true)
    expect(result.channelResults[1].success).toBe(true)
    expect(result.successCount).toBe(2)
    expect(result.failCount).toBe(0)
  })

  it('세 sink 순서 보장: 주입된 배열 순서대로 channelResults 채워짐', async () => {
    const callLog: string[] = []
    const sinkA = new OrderedMockSink('desktop', callLog)
    const sinkB = new OrderedMockSink('cli', callLog)
    const sinkC = new OrderedMockSink('webhook', callLog)

    const dispatcher = new NotifyDispatcher(
      [sinkA, sinkB, sinkC],
      cooldown,
      { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
    )
    const record = makeRecord('thrashing', 0.9)

    const result = await dispatcher.dispatch(record, SESSION, NOW)

    expect(result.routed).toBe(true)
    expect(result.channelResults).toHaveLength(3)

    // channelResults 순서: desktop → cli → webhook (주입 배열 순)
    expect(result.channelResults[0].channel).toBe('desktop')
    expect(result.channelResults[1].channel).toBe('cli')
    expect(result.channelResults[2].channel).toBe('webhook')

    // 모두 ok:true
    expect(result.channelResults[0].success).toBe(true)
    expect(result.channelResults[1].success).toBe(true)
    expect(result.channelResults[2].success).toBe(true)

    expect(result.successCount).toBe(3)
    expect(result.failCount).toBe(0)
  })

  it('false_success 고신뢰도 → 동일하게 순서대로 모든 sink 호출됨', async () => {
    const sink1 = new MockNotifySink()
    const sink2 = new MockNotifySink()
    const dispatcher = new NotifyDispatcher(
      [sink1, sink2],
      cooldown,
      { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
    )
    const record = makeRecord('false_success', 0.88)

    const result = await dispatcher.dispatch(record, SESSION, NOW)

    expect(result.routed).toBe(true)
    expect(result.channelResults).toHaveLength(2)
    expect(result.channelResults[0].success).toBe(true)
    expect(result.channelResults[1].success).toBe(true)
    // 두 sink 모두 실제 호출됨
    expect(sink1.count).toBe(1)
    expect(sink2.count).toBe(1)
    expect(result.successCount).toBe(2)
  })

  it('빈 sink 배열 → routed=true이나 channelResults=[], successCount=0', async () => {
    const dispatcher = new NotifyDispatcher(
      [],
      cooldown,
      { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
    )
    const record = makeRecord('thrashing', 0.9)

    const result = await dispatcher.dispatch(record, SESSION, NOW)

    // payload 검증은 통과하고, sink가 없으므로 successCount=0
    expect(result.routed).toBe(true)
    expect(result.channelResults).toHaveLength(0)
    expect(result.successCount).toBe(0)
    expect(result.failCount).toBe(0)
  })

  it('모든 sink 성공 시 successCount = sink 배열 길이', async () => {
    const sinks = [
      new MockNotifySink(),
      new MockNotifySink(),
      new MockNotifySink(),
    ]
    const dispatcher = new NotifyDispatcher(
      sinks,
      cooldown,
      { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
    )
    const record = makeRecord('thrashing', 0.95)

    const result = await dispatcher.dispatch(record, SESSION, NOW)

    expect(result.routed).toBe(true)
    expect(result.successCount).toBe(sinks.length)
    expect(result.failCount).toBe(0)
    // 각 sink가 정확히 1회 호출됨
    for (const sink of sinks) {
      expect(sink.count).toBe(1)
    }
  })

  it('각 sink에 동일한 payload가 전달됨 (동일 reference 또는 동등 내용)', async () => {
    const sink1 = new MockNotifySink()
    const sink2 = new MockNotifySink()
    const dispatcher = new NotifyDispatcher(
      [sink1, sink2],
      cooldown,
      { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
    )
    const record = makeRecord('thrashing', 0.9)

    await dispatcher.dispatch(record, SESSION, NOW)

    // 두 sink가 받은 payload는 동일 내용이어야 함
    expect(sink1.last!.payload.sessionId).toBe(sink2.last!.payload.sessionId)
    expect(sink1.last!.payload.kind).toBe(sink2.last!.payload.kind)
    expect(sink1.last!.payload.dedupeKey).toBe(sink2.last!.payload.dedupeKey)
    expect(sink1.last!.payload.ts).toBe(sink2.last!.payload.ts)
  })
})
