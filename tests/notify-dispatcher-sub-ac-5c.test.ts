/**
 * tests/notify-dispatcher-sub-ac-5c.test.ts
 *
 * Sub-AC 5c: NotifyDispatcher가 NotificationPayload 타입 및
 * NotifyDispatchResult 타입(perChannel:{channel,ok,error?}[])을
 * 정의·export하고, 해당 타입으로 컴파일 오류 없이 인스턴스를 생성할 수
 * 있음을 검증하는 타입 레벨 테스트.
 *
 * 테스트 부수효과 절대 금지:
 *   - MockNotifySink만 사용 (실제 OS 알림·네트워크 없음)
 *   - CooldownStore는 in-memory SQLite(:memory:) 사용
 *
 * 검증 범위:
 *   1. NotifyDispatchResult 타입이 export됨
 *   2. PerChannelResult 타입이 export됨
 *   3. NotifyDispatchResult.perChannel 배열의 원소가 {channel, ok, error?} 형태
 *   4. NotificationPayload 타입이 contracts.ts에서 export됨
 *   5. NotifyDispatcher.dispatch()의 반환값이 NotifyDispatchResult 형태와 호환
 *   6. DispatchResult도 여전히 export됨 (기존 테스트 호환성 유지)
 */

import { describe, expect, it, beforeEach } from '@jest/globals'
import Database from 'better-sqlite3'
import type { DetectionRecord, NotificationPayload } from '../src/contracts.js'
import type { StructureGateResult } from '../src/contracts.js'
import {
  NotifyDispatcher,
  type DispatchResult,
  type NotifyDispatchResult,
  type PerChannelResult,
} from '../src/notify/notify-dispatcher.js'
import { MockNotifySink } from '../src/notify/sinks/mock-notify-sink.js'
import { CooldownStore, ensureNotificationsTable } from '../src/notify/cooldown-store.js'
import { resolveDetectionRecord, buildDetectionRecord_gate } from '../src/detect/build-detection-record.js'

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureNotificationsTable(db)
  return db
}

function makeGate(
  kind: 'thrashing' | 'false_success' = 'thrashing',
  sessionId = 'session-5c',
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
  sessionId = 'session-5c',
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

const SESSION = 'session-5c'
const NOW = 5_000_000

// ─── 타입 레벨 테스트 ────────────────────────────────────────────────────────

describe('Sub-AC 5c: NotifyDispatchResult 타입 정의·export 검증', () => {
  let db: Database.Database
  let cooldown: CooldownStore

  beforeEach(() => {
    db = makeDb()
    cooldown = new CooldownStore(db)
  })

  // ── 1. 타입 import 컴파일 검증 ─────────────────────────────────────────────

  it('NotifyDispatchResult 타입을 notify-dispatcher에서 import할 수 있음', () => {
    // 타입 import가 컴파일 오류 없이 성공하면 이 테스트가 실행된다
    // (TypeScript는 타입 import 실패 시 컴파일 에러)
    const _typeCheck: NotifyDispatchResult = {
      routed: true,
      perChannel: [],
      successCount: 0,
      failCount: 0,
    }
    expect(_typeCheck.routed).toBe(true)
  })

  it('PerChannelResult 타입을 notify-dispatcher에서 import할 수 있음', () => {
    const item: PerChannelResult = {
      channel: 'mock',
      ok: true,
    }
    expect(item.channel).toBe('mock')
    expect(item.ok).toBe(true)
    expect(item.error).toBeUndefined()
  })

  it('PerChannelResult에 error 필드를 포함할 수 있음 (optional)', () => {
    const item: PerChannelResult = {
      channel: 'webhook',
      ok: false,
      error: 'connection refused',
    }
    expect(item.channel).toBe('webhook')
    expect(item.ok).toBe(false)
    expect(item.error).toBe('connection refused')
  })

  it('DispatchResult 타입도 여전히 export됨 (기존 호환성)', () => {
    const result: DispatchResult = {
      routed: false,
      suppressedReason: 'kind_none',
      channelResults: [],
      successCount: 0,
      failCount: 0,
    }
    expect(result.routed).toBe(false)
    expect(result.suppressedReason).toBe('kind_none')
  })

  // ── 2. NotificationPayload 타입 검증 ──────────────────────────────────────

  it('NotificationPayload 타입을 contracts.ts에서 import할 수 있음', () => {
    const payload: NotificationPayload = {
      sessionId: 'sess-type-check',
      kind: 'thrashing',
      subtype: 'argkey_repeat',
      confidence: 0.9,
      reason: 'test reason',
      evidence: [{ uuid: 'u1', ts: 1000, note: 'test note' }],
      ts: NOW,
      severity: 'critical',
      dedupeKey: 'sess-type-check\x1fthrashing',
    }
    expect(payload.sessionId).toBe('sess-type-check')
    expect(payload.kind).toBe('thrashing')
    expect(payload.severity).toBe('critical')
    expect(payload.evidence).toHaveLength(1)
  })

  it('NotificationPayload.severity는 4가지 리터럴 중 하나임', () => {
    const severities: NotificationPayload['severity'][] = [
      'critical',
      'warning',
      'low_confidence',
      'meta',
    ]
    expect(severities).toHaveLength(4)
    for (const s of severities) {
      expect(['critical', 'warning', 'low_confidence', 'meta']).toContain(s)
    }
  })

  it('NotificationPayload.kind는 4가지 리터럴 중 하나임', () => {
    const kinds: NotificationPayload['kind'][] = [
      'thrashing',
      'false_success',
      'none',
      'meta',
    ]
    expect(kinds).toHaveLength(4)
    for (const k of kinds) {
      expect(['thrashing', 'false_success', 'none', 'meta']).toContain(k)
    }
  })

  // ── 3. NotifyDispatcher 인스턴스 생성 컴파일 검증 ─────────────────────────

  it('NotifyDispatcher를 컴파일 오류 없이 인스턴스화할 수 있음', () => {
    const sink = new MockNotifySink()
    const dispatcher = new NotifyDispatcher(
      [sink],
      cooldown,
      { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
    )
    expect(dispatcher).toBeDefined()
    expect(typeof dispatcher.dispatch).toBe('function')
    expect(typeof dispatcher.dispatchMeta).toBe('function')
  })

  // ── 4. dispatch() 반환값이 DispatchResult 형태와 호환 ────────────────────

  it('dispatch() 반환값이 routed/channelResults/successCount/failCount 필드를 가짐', async () => {
    const sink = new MockNotifySink()
    const dispatcher = new NotifyDispatcher(
      [sink],
      cooldown,
      { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
    )
    const record = makeRecord('thrashing', 0.9)
    const result: DispatchResult = await dispatcher.dispatch(record, SESSION, NOW)

    // DispatchResult 필드 존재 확인
    expect(typeof result.routed).toBe('boolean')
    expect(Array.isArray(result.channelResults)).toBe(true)
    expect(typeof result.successCount).toBe('number')
    expect(typeof result.failCount).toBe('number')
  })

  // ── 5. NotifyDispatchResult 인스턴스를 직접 생성할 수 있음 ────────────────

  it('NotifyDispatchResult 인스턴스를 perChannel 배열로 생성할 수 있음', () => {
    const perChannel: PerChannelResult[] = [
      { channel: 'desktop', ok: true },
      { channel: 'cli', ok: true },
      { channel: 'webhook', ok: false, error: 'timeout' },
    ]

    const result: NotifyDispatchResult = {
      routed: true,
      perChannel,
      successCount: 2,
      failCount: 1,
    }

    expect(result.routed).toBe(true)
    expect(result.perChannel).toHaveLength(3)
    expect(result.perChannel[0].channel).toBe('desktop')
    expect(result.perChannel[0].ok).toBe(true)
    expect(result.perChannel[2].ok).toBe(false)
    expect(result.perChannel[2].error).toBe('timeout')
    expect(result.successCount).toBe(2)
    expect(result.failCount).toBe(1)
  })

  it('NotifyDispatchResult에 suppressedReason을 포함할 수 있음 (optional)', () => {
    const result: NotifyDispatchResult = {
      routed: false,
      suppressedReason: 'debounced',
      perChannel: [],
      successCount: 0,
      failCount: 0,
    }
    expect(result.routed).toBe(false)
    expect(result.suppressedReason).toBe('debounced')
    expect(result.perChannel).toHaveLength(0)
  })

  // ── 6. PerChannelResult의 channel 필드는 4가지 리터럴 중 하나 ─────────────

  it('PerChannelResult.channel은 desktop|webhook|cli|mock 중 하나임', () => {
    const channels: PerChannelResult['channel'][] = [
      'desktop',
      'webhook',
      'cli',
      'mock',
    ]
    expect(channels).toHaveLength(4)
    for (const ch of channels) {
      expect(['desktop', 'webhook', 'cli', 'mock']).toContain(ch)
    }
  })

  // ── 7. DispatchResult.channelResults를 perChannel로 매핑 가능 ────────────

  it('DispatchResult.channelResults → PerChannelResult[] 변환이 타입 안전하게 가능', async () => {
    const sink = new MockNotifySink()
    const dispatcher = new NotifyDispatcher(
      [sink],
      cooldown,
      { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
    )
    const record = makeRecord('thrashing', 0.9)
    const dispatchResult = await dispatcher.dispatch(record, SESSION, NOW)

    // DispatchResult → NotifyDispatchResult 형태로 변환 (타입 안전)
    const notifyDispatchResult: NotifyDispatchResult = {
      routed: dispatchResult.routed,
      suppressedReason: dispatchResult.suppressedReason,
      perChannel: dispatchResult.channelResults.map(
        (r): PerChannelResult => ({
          channel: r.channel,
          ok: r.success,
          ...(r.error !== undefined ? { error: r.error } : {}),
        })
      ),
      successCount: dispatchResult.successCount,
      failCount: dispatchResult.failCount,
    }

    expect(notifyDispatchResult.routed).toBe(true)
    expect(notifyDispatchResult.perChannel).toHaveLength(1)
    expect(notifyDispatchResult.perChannel[0].channel).toBe('mock')
    expect(notifyDispatchResult.perChannel[0].ok).toBe(true)
    expect(notifyDispatchResult.successCount).toBe(1)
  })
})
