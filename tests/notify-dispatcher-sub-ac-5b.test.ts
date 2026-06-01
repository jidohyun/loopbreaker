/**
 * tests/notify-dispatcher-sub-ac-5b.test.ts
 *
 * Sub-AC 5b: NotifyDispatcher.dispatch()가 특정 sink에서 throw 발생 시
 * 해당 채널을 {channel, ok:false, error}로 기록하고 나머지 sink 호출을
 * 계속 진행하여 침묵 실패 없이 NotifyDispatchResult를 반환함을 검증.
 *
 * 테스트 부수효과 절대 금지:
 *   - MockNotifySink + ThrowingSink만 사용 (실제 OS 알림·네트워크 없음)
 *   - CooldownStore는 in-memory SQLite(:memory:) 사용
 *
 * 검증 범위:
 *   1. 첫 번째 sink가 throw → {ok:false, error} 기록, 두 번째 sink 계속 진행
 *   2. 마지막 sink가 throw → 앞 sink 성공 결과는 보존
 *   3. 중간 sink가 throw → 앞뒤 sink 모두 진행
 *   4. 모든 sink가 throw → failCount=총수, successCount=0, 예외 없이 반환
 *   5. throw한 채널의 error 메시지가 channelResults에 정확히 담긴다
 *   6. 일부 throw + 일부 성공 → successCount>0이면 cooldown 갱신
 *   7. 모두 throw → cooldown 갱신 없음 (successCount=0)
 *   8. dispatchMeta에서도 throw 격리가 동작함
 */

import { describe, expect, it, beforeEach } from '@jest/globals'
import Database from 'better-sqlite3'
import type { NotificationPayload, NotifyResult, NotifySink } from '../src/contracts.js'
import type { StructureGateResult } from '../src/contracts.js'
import { resolveDetectionRecord, buildDetectionRecord_gate } from '../src/detect/build-detection-record.js'
import { NotifyDispatcher } from '../src/notify/notify-dispatcher.js'
import { MockNotifySink } from '../src/notify/sinks/mock-notify-sink.js'
import { CooldownStore, ensureNotificationsTable } from '../src/notify/cooldown-store.js'

// ─── 헬퍼: throw를 실제로 던지는 Sink ─────────────────────────────────────────

/**
 * ThrowingSink — send() 호출 시 Promise를 reject한다.
 * MockNotifySink.setFailMode(true)는 {success:false}를 반환하지만,
 * 이 sink는 실제로 throw(reject)하여 Promise.allSettled의 'rejected' 분기를 테스트.
 */
class ThrowingSink implements NotifySink {
  readonly channelName: 'desktop' | 'webhook' | 'cli' | 'mock'
  private readonly _throwMessage: string
  private _callCount = 0

  constructor(
    channelName: 'desktop' | 'webhook' | 'cli' | 'mock' = 'mock',
    throwMessage = 'sink exploded',
  ) {
    this.channelName = channelName
    this._throwMessage = throwMessage
  }

  async send(_payload: NotificationPayload): Promise<NotifyResult> {
    this._callCount++
    throw new Error(this._throwMessage)
  }

  get callCount(): number {
    return this._callCount
  }
}

// ─── 헬퍼: 호출 기록 + 성공 반환 Sink ──────────────────────────────────────────

class TrackingSink implements NotifySink {
  private _callCount = 0
  readonly channelName: 'desktop' | 'webhook' | 'cli' | 'mock'

  constructor(channelName: 'desktop' | 'webhook' | 'cli' | 'mock' = 'mock') {
    this.channelName = channelName
  }

  async send(_payload: NotificationPayload): Promise<NotifyResult> {
    this._callCount++
    return { success: true, channel: this.channelName }
  }

  get callCount(): number {
    return this._callCount
  }
}

// ─── 테스트 데이터 헬퍼 ────────────────────────────────────────────────────────

function makeInMemoryDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureNotificationsTable(db)
  return db
}

function makeGate(
  kind: 'thrashing' | 'false_success' = 'thrashing',
  sessionId = 'session-5b',
): StructureGateResult {
  return {
    type: kind,
    subtype: 'argkey_repeat',
    severity: 'warning',
    sessionId,
    agentScope: 'root',
    windowRefs: ['uuid-x', 'uuid-y'],
    metrics: { repeatCount: 7 },
  }
}

function makeRecord(
  kind: 'thrashing' | 'false_success' = 'thrashing',
  confidence = 0.9,
  sessionId = 'session-5b',
) {
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

const SESSION = 'session-5b'
const NOW = 5_000_000

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('Sub-AC 5b: NotifyDispatcher — sink throw 격리 (침묵 실패 금지)', () => {
  let db: Database.Database
  let cooldown: CooldownStore

  beforeEach(() => {
    db = makeInMemoryDb()
    cooldown = new CooldownStore(db)
  })

  function makeDispatcher(sinks: NotifySink[]) {
    return new NotifyDispatcher(
      sinks,
      cooldown,
      { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
    )
  }

  // ── 1. 첫 번째 sink throw → 두 번째 sink 계속 진행 ──────────────────────────

  it('첫 번째 sink가 throw → {ok:false, error} 기록 + 두 번째 sink 계속 호출됨', async () => {
    const throwSink = new ThrowingSink('mock', 'first sink exploded')
    const successSink = new TrackingSink('cli')
    const dispatcher = makeDispatcher([throwSink, successSink])

    const record = makeRecord('thrashing', 0.9)
    const result = await dispatcher.dispatch(record, SESSION, NOW)

    // 예외 없이 DispatchResult 반환
    expect(result).toBeDefined()
    expect(result.routed).toBe(true)

    // 두 채널 모두 기록
    expect(result.channelResults).toHaveLength(2)

    // 실패 채널: ok=false, error 존재
    const failedChannel = result.channelResults.find((r) => !r.success)
    expect(failedChannel).toBeDefined()
    expect(failedChannel!.success).toBe(false)
    expect(failedChannel!.error).toContain('first sink exploded')

    // 성공 채널: ok=true
    const successChannel = result.channelResults.find((r) => r.success)
    expect(successChannel).toBeDefined()
    expect(successChannel!.success).toBe(true)
    expect(successChannel!.channel).toBe('cli')

    // 카운터
    expect(result.successCount).toBe(1)
    expect(result.failCount).toBe(1)

    // 두 번째 sink가 실제 호출됨 (throw 이후에도 계속 진행)
    expect(throwSink.callCount).toBe(1)
    expect(successSink.callCount).toBe(1)
  })

  // ── 2. 마지막 sink throw → 앞 sink 성공 보존 ────────────────────────────────

  it('마지막 sink가 throw → 앞 sink 성공 결과는 보존되고 failCount=1', async () => {
    const successSink = new TrackingSink('desktop')
    const throwSink = new ThrowingSink('webhook', 'last sink exploded')
    const dispatcher = makeDispatcher([successSink, throwSink])

    const record = makeRecord('thrashing', 0.9)
    const result = await dispatcher.dispatch(record, SESSION, NOW)

    expect(result.routed).toBe(true)
    expect(result.channelResults).toHaveLength(2)
    expect(result.successCount).toBe(1)
    expect(result.failCount).toBe(1)

    // 성공 채널 보존
    const ok = result.channelResults.find((r) => r.success)
    expect(ok!.channel).toBe('desktop')

    // 실패 채널 기록
    const fail = result.channelResults.find((r) => !r.success)
    expect(fail!.success).toBe(false)
    expect(fail!.error).toContain('last sink exploded')
  })

  // ── 3. 중간 sink throw → 앞뒤 sink 모두 진행 ────────────────────────────────

  it('중간 sink throw → 앞뒤 sink 모두 호출되고 channelResults 3항목 반환', async () => {
    const firstSink = new TrackingSink('desktop')
    const midThrow = new ThrowingSink('mock', 'middle sink exploded')
    const lastSink = new TrackingSink('cli')
    const dispatcher = makeDispatcher([firstSink, midThrow, lastSink])

    const record = makeRecord('thrashing', 0.9)
    const result = await dispatcher.dispatch(record, SESSION, NOW)

    expect(result.routed).toBe(true)
    expect(result.channelResults).toHaveLength(3)
    expect(result.successCount).toBe(2) // first + last 성공
    expect(result.failCount).toBe(1)    // mid 실패

    // 세 sink 모두 호출됨 (Promise.allSettled 병렬 호출)
    expect(firstSink.callCount).toBe(1)
    expect(midThrow.callCount).toBe(1)
    expect(lastSink.callCount).toBe(1)

    // 실패 항목 error 기록
    const fail = result.channelResults.find((r) => !r.success)
    expect(fail!.error).toContain('middle sink exploded')
  })

  // ── 4. 모든 sink throw → failCount=총수, successCount=0, 예외 없이 반환 ───────

  it('모든 sink가 throw → successCount=0, failCount=N, 예외 없이 DispatchResult 반환', async () => {
    const throw1 = new ThrowingSink('desktop', 'desktop exploded')
    const throw2 = new ThrowingSink('cli', 'cli exploded')
    const throw3 = new ThrowingSink('webhook', 'webhook exploded')
    const dispatcher = makeDispatcher([throw1, throw2, throw3])

    const record = makeRecord('thrashing', 0.9)

    // dispatch() 자체가 throw하지 않아야 함 (침묵 실패 금지 = 예외 전파 금지)
    await expect(dispatcher.dispatch(record, SESSION, NOW)).resolves.toBeDefined()

    const result = await dispatcher.dispatch(record, SESSION, NOW + 1000)

    expect(result.routed).toBe(true)
    expect(result.channelResults).toHaveLength(3)
    expect(result.successCount).toBe(0)
    expect(result.failCount).toBe(3)

    // 모든 항목이 ok:false
    for (const ch of result.channelResults) {
      expect(ch.success).toBe(false)
      expect(typeof ch.error).toBe('string')
      expect(ch.error!.length).toBeGreaterThan(0)
    }
  })

  // ── 5. throw한 채널의 error 메시지가 channelResults에 정확히 담김 ──────────────

  it('throw된 Error 메시지가 channelResults[].error에 정확히 기록된다', async () => {
    const specificMessage = 'UNIQUE_ERROR_SENTINEL_XYZ'
    const throwSink = new ThrowingSink('mock', specificMessage)
    const dispatcher = makeDispatcher([throwSink])

    const record = makeRecord('thrashing', 0.9)
    const result = await dispatcher.dispatch(record, SESSION, NOW)

    expect(result.channelResults).toHaveLength(1)
    expect(result.channelResults[0].success).toBe(false)
    expect(result.channelResults[0].error).toContain(specificMessage)
  })

  // ── 6. 일부 throw + 일부 성공 → successCount>0이면 cooldown 갱신 ───────────────

  it('일부 throw + 일부 성공 → successCount>0이면 dedupeKey cooldown 갱신됨', async () => {
    const throwSink = new ThrowingSink('mock', 'throw!')
    const successSink = new TrackingSink('cli')
    const dispatcher = makeDispatcher([throwSink, successSink])

    const record = makeRecord('thrashing', 0.9)
    await dispatcher.dispatch(record, SESSION, NOW)

    // 성공 채널이 있으므로 cooldown이 기록되어야 함
    const dedupeKey = `${SESSION}\x1fthrashing`
    const state = cooldown.getDebounceState(dedupeKey)
    expect(state.lastSentTs).toBe(NOW)
  })

  // ── 7. 모두 throw → cooldown 갱신 없음 (successCount=0) ─────────────────────

  it('모든 sink throw → successCount=0이므로 cooldown 갱신 없음', async () => {
    const throw1 = new ThrowingSink('mock', 'throw1')
    const throw2 = new ThrowingSink('cli', 'throw2')
    const dispatcher = makeDispatcher([throw1, throw2])

    const record = makeRecord('thrashing', 0.9)
    await dispatcher.dispatch(record, SESSION, NOW)

    // cooldown이 갱신되지 않아야 함 (캐시에 키 없음 → lastSentTs = undefined)
    const dedupeKey = `${SESSION}\x1fthrashing`
    const state = cooldown.getDebounceState(dedupeKey)
    expect(state.lastSentTs).toBeUndefined()
  })

  // ── 8. dispatchMeta에서도 throw 격리 동작 ─────────────────────────────────────

  it('dispatchMeta: 첫 sink throw → 두 번째 sink 계속 호출되고 meta payload 발송됨', async () => {
    const throwSink = new ThrowingSink('mock', 'meta sink throw')
    const successSink = new MockNotifySink()
    const dispatcher = new NotifyDispatcher(
      [throwSink, successSink],
      cooldown,
      { decideThresh: 0.7, notifyDebounceMs: 60_000, lowConfidenceNotify: false },
    )

    const result = await dispatcher.dispatchMeta(SESSION, '비용 상한 초과', NOW)

    expect(result.routed).toBe(true)
    expect(result.channelResults).toHaveLength(2)
    expect(result.successCount).toBe(1)
    expect(result.failCount).toBe(1)

    // 성공 sink에 meta payload 전달됨
    expect(successSink.count).toBe(1)
    expect(successSink.last!.payload.severity).toBe('meta')
    expect(successSink.last!.payload.reason).toBe('비용 상한 초과')

    // throw sink도 호출됨
    expect(throwSink.callCount).toBe(1)
  })

  // ── 9. throw + setFailMode 혼합 → 각각 독립적으로 기록됨 ─────────────────────

  it('throw sink + setFailMode(true) sink + 성공 sink 혼합 → 각각 독립 기록', async () => {
    const throwSink = new ThrowingSink('desktop', 'desktop throw')
    const failModeSink = new MockNotifySink()
    failModeSink.setFailMode(true, 'failmode error')
    const successSink = new TrackingSink('cli')

    const dispatcher = makeDispatcher([throwSink, failModeSink, successSink])

    const record = makeRecord('false_success', 0.88)
    const result = await dispatcher.dispatch(record, SESSION, NOW)

    expect(result.routed).toBe(true)
    expect(result.channelResults).toHaveLength(3)
    expect(result.successCount).toBe(1)  // cli만 성공
    expect(result.failCount).toBe(2)     // desktop throw + failmode

    // throw sink 실패 기록
    const throwResult = result.channelResults.find(
      (r) => !r.success && r.error?.includes('desktop throw'),
    )
    expect(throwResult).toBeDefined()

    // failmode sink 실패 기록
    const failResult = result.channelResults.find(
      (r) => !r.success && r.error?.includes('failmode error'),
    )
    expect(failResult).toBeDefined()

    // 성공 채널
    const okResult = result.channelResults.find((r) => r.success)
    expect(okResult!.channel).toBe('cli')

    // throw sink와 failmode sink 모두 호출됨
    expect(throwSink.callCount).toBe(1)
    expect(failModeSink.count).toBe(1)
    expect(successSink.callCount).toBe(1)
  })

  // ── 10. throw sink 단독 → routed=true + failCount=1 반환 (파이프라인 안 죽음) ──

  it('단일 throw sink → routed=true, failCount=1 반환, dispatch()가 throw하지 않음', async () => {
    const throwSink = new ThrowingSink('mock', 'only sink exploded')
    const dispatcher = makeDispatcher([throwSink])

    const record = makeRecord('thrashing', 0.9)

    // dispatch() 자체가 throw하지 않아야 함
    const result = await expect(
      dispatcher.dispatch(record, SESSION, NOW),
    ).resolves.toMatchObject({
      routed: true,
      successCount: 0,
      failCount: 1,
    })

    void result // used
  })
})
