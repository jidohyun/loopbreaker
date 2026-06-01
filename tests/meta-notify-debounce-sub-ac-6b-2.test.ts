/**
 * tests/meta-notify-debounce-sub-ac-6b-2.test.ts
 *
 * Sub-AC 6b-2: 디바운스 윈도우 내 meta 알림 억제 테스트
 *
 * 검증 항목:
 *   1. 첫 번째 meta 이벤트는 발송된다
 *   2. 디바운스 윈도우(notifyDebounceMs) 내 동일 meta 이벤트 재도달 → 추가 발송 없음
 *   3. 디바운스 윈도우 만료 직전(1ms 부족)은 여전히 억제됨
 *   4. 디바운스 윈도우 만료 시점(경계값 포함) → 재발송 허용
 *   5. 윈도우 만료 후 재도달 → 정확히 1회 재발송
 *   6. 윈도우 만료 후 재발송된 항목도 다시 윈도우 내 억제됨
 *   7. 서로 다른 sessionId는 독립적 디바운스 (한 세션 억제가 다른 세션에 미영향)
 *   8. 부수효과 없음 — MockNotifySink만 사용 (OS 알림·네트워크 없음)
 *
 * 시간 제어: NotifyDispatcher.dispatchMeta(sessionId, reason, now)에
 *   주입 가능한 `now` 파라미터를 이용해 가짜 타이머 없이 결정론적으로 동작.
 */

import { describe, it, expect, beforeEach } from '@jest/globals'
import Database from 'better-sqlite3'
import { NotifyDispatcher } from '../src/notify/notify-dispatcher.js'
import { MockNotifySink } from '../src/notify/sinks/mock-notify-sink.js'
import { CooldownStore, ensureNotificationsTable } from '../src/notify/cooldown-store.js'

// ── 테스트용 헬퍼 ────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 60_000   // 60초 디바운스 윈도우
const BASE_NOW = 1_700_000_000_000  // 기준 epoch ms (결정론적)
const SESSION = 'session-meta-debounce'
const EVENT = 'cost_limit_exceeded'

/** 인메모리 SQLite CooldownStore 생성 */
function makeCooldownStore(): CooldownStore {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureNotificationsTable(db)
  return new CooldownStore(db)
}

/** NotifyDispatcher + MockNotifySink 조합 생성 (주입 가능 clock) */
function makeDispatcher(
  sink: MockNotifySink,
  cooldown: CooldownStore,
  debounceMs = DEBOUNCE_MS,
): NotifyDispatcher {
  return new NotifyDispatcher(
    [sink],
    cooldown,
    {
      decideThresh: 0.7,
      notifyDebounceMs: debounceMs,
      lowConfidenceNotify: false,
    },
  )
}

// ── 핵심: 디바운스 윈도우 내 억제 ───────────────────────────────────────────

describe('meta notification debounce suppression (Sub-AC 6b-2)', () => {
  let sink: MockNotifySink
  let cooldown: CooldownStore
  let dispatcher: NotifyDispatcher

  beforeEach(() => {
    sink = new MockNotifySink()
    cooldown = makeCooldownStore()
    dispatcher = makeDispatcher(sink, cooldown)
  })

  it('첫 번째 meta 이벤트는 발송된다', async () => {
    const result = await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    expect(result.routed).toBe(true)
    expect(result.successCount).toBe(1)
    expect(sink.count).toBe(1)
  })

  it('발송된 payload의 severity가 meta이다', async () => {
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    expect(sink.last?.payload.severity).toBe('meta')
  })

  it('발송된 payload의 kind가 meta이다', async () => {
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    expect(sink.last?.payload.kind).toBe('meta')
  })

  it('발송된 payload에 sessionId가 포함된다', async () => {
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    expect(sink.last?.payload.sessionId).toBe(SESSION)
  })

  // ── 윈도우 내 억제 ──────────────────────────────────────────────────────

  it('디바운스 윈도우 내 즉각 재도달은 억제된다', async () => {
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    // 1ms 후 재시도 — 윈도우(60s) 내
    const result = await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW + 1)
    expect(result.routed).toBe(false)
    expect(result.suppressedReason).toBe('debounced')
    expect(sink.count).toBe(1)  // 추가 발송 없음
  })

  it('디바운스 윈도우 중간(30초 경과)에도 억제된다', async () => {
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    const result = await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW + 30_000)
    expect(result.routed).toBe(false)
    expect(result.suppressedReason).toBe('debounced')
    expect(sink.count).toBe(1)
  })

  it('디바운스 윈도우 만료 1ms 직전은 억제된다', async () => {
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    // 59999ms 경과 — 60000ms 미만이므로 억제
    const result = await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW + DEBOUNCE_MS - 1)
    expect(result.routed).toBe(false)
    expect(result.suppressedReason).toBe('debounced')
    expect(sink.count).toBe(1)
  })

  it('N번 재도달해도 윈도우 내 발송은 1회만이다', async () => {
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    for (let i = 1; i <= 10; i++) {
      await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW + i * 1000)  // 1~10초 후
    }
    expect(sink.count).toBe(1)
  })

  // ── 윈도우 만료 후 재발송 허용 ─────────────────────────────────────────

  it('디바운스 윈도우 정확한 만료 시점(경계값)에 재발송이 허용된다', async () => {
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    // 정확히 60000ms 경과 — SPEC 경계값: >= debounceMs → 통과
    const result = await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW + DEBOUNCE_MS)
    expect(result.routed).toBe(true)
    expect(sink.count).toBe(2)
  })

  it('윈도우 만료 후 재도달 시 1회 재발송된다', async () => {
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    const t2 = BASE_NOW + DEBOUNCE_MS + 1  // 1ms 여유 후 만료
    const result = await dispatcher.dispatchMeta(SESSION, EVENT, t2)
    expect(result.routed).toBe(true)
    expect(result.successCount).toBe(1)
    expect(sink.count).toBe(2)
  })

  it('윈도우 만료 후 재발송된 payload도 severity=meta이다', async () => {
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    const t2 = BASE_NOW + DEBOUNCE_MS + 1
    await dispatcher.dispatchMeta(SESSION, EVENT, t2)
    expect(sink.last?.payload.severity).toBe('meta')
  })

  it('재발송 후 새 윈도우 내 재도달은 다시 억제된다', async () => {
    // 1차 발송
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    // 2차 발송 (윈도우 만료 후)
    const t2 = BASE_NOW + DEBOUNCE_MS + 1
    await dispatcher.dispatchMeta(SESSION, EVENT, t2)
    expect(sink.count).toBe(2)

    // 새 윈도우 내 재도달 → 억제
    const result = await dispatcher.dispatchMeta(SESSION, EVENT, t2 + 1000)
    expect(result.routed).toBe(false)
    expect(result.suppressedReason).toBe('debounced')
    expect(sink.count).toBe(2)  // 여전히 2회
  })

  it('재발송 후 새 윈도우 만료 시점에 3차 발송이 허용된다', async () => {
    const t1 = BASE_NOW
    const t2 = t1 + DEBOUNCE_MS + 1
    const t3 = t2 + DEBOUNCE_MS

    await dispatcher.dispatchMeta(SESSION, EVENT, t1)
    await dispatcher.dispatchMeta(SESSION, EVENT, t2)
    const result = await dispatcher.dispatchMeta(SESSION, EVENT, t3)
    expect(result.routed).toBe(true)
    expect(sink.count).toBe(3)
  })
})

// ── 서로 다른 sessionId 독립성 ───────────────────────────────────────────────

describe('meta debounce: session isolation', () => {
  let sink: MockNotifySink
  let cooldown: CooldownStore
  let dispatcher: NotifyDispatcher

  beforeEach(() => {
    sink = new MockNotifySink()
    cooldown = makeCooldownStore()
    dispatcher = makeDispatcher(sink, cooldown)
  })

  it('다른 sessionId는 독립적으로 첫 번째 발송이 허용된다', async () => {
    await dispatcher.dispatchMeta('session-A', EVENT, BASE_NOW)
    const result = await dispatcher.dispatchMeta('session-B', EVENT, BASE_NOW)
    expect(result.routed).toBe(true)
    expect(sink.count).toBe(2)
  })

  it('session-A 억제가 session-B에 영향을 미치지 않는다', async () => {
    // session-A 발송
    await dispatcher.dispatchMeta('session-A', EVENT, BASE_NOW)
    // session-A 윈도우 내 재도달 → 억제
    await dispatcher.dispatchMeta('session-A', EVENT, BASE_NOW + 1000)
    // session-B는 독립적으로 발송됨
    const result = await dispatcher.dispatchMeta('session-B', EVENT, BASE_NOW + 1000)
    expect(result.routed).toBe(true)
    expect(sink.count).toBe(2)  // session-A 1회 + session-B 1회
  })

  it('session-A 만료 후 재발송이 session-B 윈도우에 영향 없다', async () => {
    // session-A는 BASE_NOW에 발송
    await dispatcher.dispatchMeta('session-A', EVENT, BASE_NOW)
    // session-B는 나중에 발송 (더 큰 윈도우 내에 있도록)
    const tB = BASE_NOW + DEBOUNCE_MS + 1   // session-B 발송 시각 (session-A는 이미 만료)
    await dispatcher.dispatchMeta('session-B', EVENT, tB)
    expect(sink.count).toBe(2)

    // session-A 두 번째 윈도우 만료 후 재발송 (t3 = tB + DEBOUNCE_MS + 1)
    // session-B는 tB + DEBOUNCE_MS - 1 시점에서 아직 윈도우 내
    const tCheck = tB + DEBOUNCE_MS - 1  // session-B 윈도우 내

    // session-A는 BASE_NOW로부터 충분히 지났으므로 t3에서 재발송 가능
    const t3 = BASE_NOW + 2 * DEBOUNCE_MS + 2
    await dispatcher.dispatchMeta('session-A', EVENT, t3)
    expect(sink.count).toBe(3)

    // session-B는 tCheck 시점에서 아직 윈도우 내 → 억제
    const bResult = await dispatcher.dispatchMeta('session-B', EVENT, tCheck)
    expect(bResult.routed).toBe(false)
    expect(bResult.suppressedReason).toBe('debounced')
    expect(sink.count).toBe(3)
  })

  it('N개 세션이 동시 첫 발송 시 모두 통과된다', async () => {
    const sessions = ['s1', 's2', 's3', 's4', 's5']
    for (const s of sessions) {
      await dispatcher.dispatchMeta(s, EVENT, BASE_NOW)
    }
    expect(sink.count).toBe(sessions.length)
  })

  it('N개 세션이 각각 윈도우 내 재도달해도 추가 발송 없음', async () => {
    const sessions = ['s1', 's2', 's3']
    for (const s of sessions) {
      await dispatcher.dispatchMeta(s, EVENT, BASE_NOW)
    }
    // 윈도우 내 재시도
    for (const s of sessions) {
      await dispatcher.dispatchMeta(s, EVENT, BASE_NOW + 1000)
    }
    expect(sink.count).toBe(sessions.length)  // 각 세션 1회만
  })
})

// ── 다양한 debounceMs 설정 ───────────────────────────────────────────────────

describe('meta debounce: configurable debounceMs', () => {
  it('debounceMs=0이면 항상 통과된다', async () => {
    const sink = new MockNotifySink()
    const cooldown = makeCooldownStore()
    const dispatcher = makeDispatcher(sink, cooldown, 0)

    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)  // 동일 시각 재시도
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    // debounceMs=0이면 passesCooldown이 항상 true
    expect(sink.count).toBe(3)
  })

  it('debounceMs=1000이면 1000ms 전 억제, 1000ms 경과 후 통과', async () => {
    const sink = new MockNotifySink()
    const cooldown = makeCooldownStore()
    const dispatcher = makeDispatcher(sink, cooldown, 1_000)

    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    // 999ms 후 → 억제
    const r1 = await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW + 999)
    expect(r1.routed).toBe(false)
    // 1000ms 후 → 통과 (경계값 포함)
    const r2 = await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW + 1_000)
    expect(r2.routed).toBe(true)
    expect(sink.count).toBe(2)
  })

  it('debounceMs=5000이면 5초 이내 억제, 이후 통과', async () => {
    const sink = new MockNotifySink()
    const cooldown = makeCooldownStore()
    const dispatcher = makeDispatcher(sink, cooldown, 5_000)

    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW + 4_999)  // 억제
    const r = await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW + 5_000)  // 통과
    expect(r.routed).toBe(true)
    expect(sink.count).toBe(2)
  })
})

// ── 부수효과 없음 보장 ───────────────────────────────────────────────────────

describe('meta debounce: no side effects', () => {
  it('MockNotifySink만 사용 — 실제 OS 알림·네트워크 없음', async () => {
    const sink = new MockNotifySink()
    const cooldown = makeCooldownStore()
    const dispatcher = makeDispatcher(sink, cooldown)

    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)

    // channel='mock' → MockNotifySink 경로만 사용
    expect(sink.last?.result.channel).toBe('mock')
    expect(sink.last?.result.success).toBe(true)
  })

  it('윈도우 내 억제 시 sink에 아무 기록도 남지 않는다', async () => {
    const sink = new MockNotifySink()
    const cooldown = makeCooldownStore()
    const dispatcher = makeDispatcher(sink, cooldown)

    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    expect(sink.count).toBe(1)

    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW + 1000)
    expect(sink.count).toBe(1)  // 추가 기록 없음
  })

  it('CooldownStore는 SQLite 인메모리 DB만 사용 — 파일시스템 무영향', async () => {
    // :memory: DB를 사용하므로 파일시스템에 아무 영향도 없음
    const sink = new MockNotifySink()
    const cooldown = makeCooldownStore()  // ':memory:' DB
    const dispatcher = makeDispatcher(sink, cooldown)

    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    const t2 = BASE_NOW + DEBOUNCE_MS + 1
    await dispatcher.dispatchMeta(SESSION, EVENT, t2)

    expect(sink.count).toBe(2)
  })
})

// ── CooldownStore 영속 상태 확인 (디바운스 키 정확성) ────────────────────────

describe('meta debounce: cooldown persistence invariant', () => {
  it('발송 후 CooldownStore에 dedupeKey가 기록된다', async () => {
    const sink = new MockNotifySink()
    const cooldown = makeCooldownStore()
    const dispatcher = makeDispatcher(sink, cooldown)

    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)

    // dedupeKey = sessionId + '\x1f' + 'meta' (routeMetaEvent 정의)
    const dedupeKey = `${SESSION}\x1fmeta`
    const state = cooldown.getDebounceState(dedupeKey)
    expect(state.lastSentTs).toBe(BASE_NOW)
  })

  it('억제된 재도달은 CooldownStore 상태를 갱신하지 않는다', async () => {
    const sink = new MockNotifySink()
    const cooldown = makeCooldownStore()
    const dispatcher = makeDispatcher(sink, cooldown)

    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)
    // 억제 재시도
    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW + 1000)

    const dedupeKey = `${SESSION}\x1fmeta`
    const state = cooldown.getDebounceState(dedupeKey)
    // lastSentTs는 최초 발송 시각 그대로 (갱신 없음)
    expect(state.lastSentTs).toBe(BASE_NOW)
  })

  it('윈도우 만료 후 재발송은 CooldownStore에 새 ts를 기록한다', async () => {
    const sink = new MockNotifySink()
    const cooldown = makeCooldownStore()
    const dispatcher = makeDispatcher(sink, cooldown)

    await dispatcher.dispatchMeta(SESSION, EVENT, BASE_NOW)

    const t2 = BASE_NOW + DEBOUNCE_MS + 1
    await dispatcher.dispatchMeta(SESSION, EVENT, t2)

    const dedupeKey = `${SESSION}\x1fmeta`
    const state = cooldown.getDebounceState(dedupeKey)
    expect(state.lastSentTs).toBe(t2)
  })

  it('다른 sessionId는 각자 독립적인 dedupeKey를 가진다', async () => {
    const sink = new MockNotifySink()
    const cooldown = makeCooldownStore()
    const dispatcher = makeDispatcher(sink, cooldown)

    await dispatcher.dispatchMeta('session-X', EVENT, BASE_NOW)
    await dispatcher.dispatchMeta('session-Y', EVENT, BASE_NOW + 500)

    const keyX = `session-X\x1fmeta`
    const keyY = `session-Y\x1fmeta`

    expect(cooldown.getDebounceState(keyX).lastSentTs).toBe(BASE_NOW)
    expect(cooldown.getDebounceState(keyY).lastSentTs).toBe(BASE_NOW + 500)
  })
})
