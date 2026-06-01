/**
 * tests/cooldown-store-sub-ac-10c.test.ts
 *
 * Sub-AC 10-C: CooldownStore.loadCooldowns() 워밍업 함수 검증.
 *
 * 검증 항목:
 *   1. 사전 삽입된 픽스처 행이 캐시에 정확히 반영된다
 *   2. last_sent_ts → cache (getDebounceState)
 *   3. cooldown_until → cooldownCache (getCooldownUntil)
 *   4. notifications 테이블 없음(마이그레이션 전)에서도 예외 없음
 *   5. 로드된 행 수 반환값이 정확하다
 *   6. loadCooldowns() 호출 전에는 캐시가 비어있다
 *   7. 복수 픽스처 행 전체 반영 (누락 없음)
 *   8. cooldown_until NULL 행은 cooldownCache에 추가되지 않는다
 *   9. warmUp()과 loadCooldowns()는 동일하게 동작한다 (하위호환)
 *  10. 재호출 시 중복 없이 최신 DB 상태가 반영된다
 *
 * 모든 테스트는 in-memory SQLite(:memory:)만 사용 — OS 알림·네트워크 없음.
 */

import { describe, expect, it } from '@jest/globals'
import Database from 'better-sqlite3'
import { CooldownStore, ensureNotificationsTable } from '../src/notify/cooldown-store.js'

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureNotificationsTable(db)
  return db
}

/** notifications 테이블에 픽스처 행을 직접 삽입한다 */
function insertFixture(
  db: Database.Database,
  opts: {
    dedupeKey: string
    lastSentTs: number
    cooldownUntil?: number | null
    sessionId?: string
    kind?: string
  },
): void {
  db.prepare(`
    INSERT INTO notifications
      (dedupe_key, last_sent_ts, cooldown_until, session_id, kind, send_count, created_at, updated_at)
    VALUES
      (@dedupeKey, @lastSentTs, @cooldownUntil, @sessionId, @kind, 1, @lastSentTs, @lastSentTs)
  `).run({
    dedupeKey: opts.dedupeKey,
    lastSentTs: opts.lastSentTs,
    cooldownUntil: opts.cooldownUntil ?? null,
    sessionId: opts.sessionId ?? 'session-fixture',
    kind: opts.kind ?? 'thrashing',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────────────────────────────────────

describe('CooldownStore.loadCooldowns (Sub-AC 10-C)', () => {

  // ── 1. 기본 워밍업 동작 ───────────────────────────────────────────────────

  describe('기본 워밍업 동작', () => {
    it('loadCooldowns 호출 전에는 캐시가 비어있다', () => {
      const db = makeDb()
      insertFixture(db, { dedupeKey: 'session-a\x1fthrashing', lastSentTs: 1_000_000 })

      const store = new CooldownStore(db)

      // loadCooldowns 전 — 캐시 비어있음
      expect(store.cacheSize()).toBe(0)
      expect(store.getDebounceState('session-a\x1fthrashing').lastSentTs).toBeUndefined()
    })

    it('loadCooldowns 호출 후 DB 픽스처 행이 캐시에 반영된다', () => {
      const db = makeDb()
      insertFixture(db, { dedupeKey: 'session-a\x1fthrashing', lastSentTs: 1_000_000 })

      const store = new CooldownStore(db)
      const loaded = store.loadCooldowns()

      expect(loaded).toBe(1)
      expect(store.cacheSize()).toBe(1)
      expect(store.getDebounceState('session-a\x1fthrashing').lastSentTs).toBe(1_000_000)
    })

    it('last_sent_ts가 getDebounceState로 정확히 조회된다', () => {
      const db = makeDb()
      const expectedTs = 9_876_543_210

      insertFixture(db, {
        dedupeKey: 'session-b\x1ffalse_success',
        lastSentTs: expectedTs,
        sessionId: 'session-b',
        kind: 'false_success',
      })

      const store = new CooldownStore(db)
      store.loadCooldowns()

      expect(store.getDebounceState('session-b\x1ffalse_success').lastSentTs).toBe(expectedTs)
    })

    it('cooldown_until이 있는 픽스처 행은 getCooldownUntil로 조회된다', () => {
      const db = makeDb()
      const cooldownUntil = 1_700_000_000_000

      insertFixture(db, {
        dedupeKey: 'session-c\x1fthrashing',
        lastSentTs: 1_699_000_000_000,
        cooldownUntil,
        sessionId: 'session-c',
        kind: 'thrashing',
      })

      const store = new CooldownStore(db)
      store.loadCooldowns()

      expect(store.getCooldownUntil('session-c\x1fthrashing')).toBe(cooldownUntil)
    })

    it('cooldown_until이 NULL인 행은 cooldownCache에 추가되지 않는다', () => {
      const db = makeDb()

      insertFixture(db, {
        dedupeKey: 'session-d\x1fthrashing',
        lastSentTs: 5_000_000,
        cooldownUntil: null,
      })

      const store = new CooldownStore(db)
      store.loadCooldowns()

      // lastSentTs는 캐시에 있어야 함
      expect(store.getDebounceState('session-d\x1fthrashing').lastSentTs).toBe(5_000_000)
      // cooldown_until은 없어야 함
      expect(store.getCooldownUntil('session-d\x1fthrashing')).toBeUndefined()
    })
  })

  // ── 2. 복수 픽스처 행 ────────────────────────────────────────────────────

  describe('복수 픽스처 행 전체 반영', () => {
    it('여러 픽스처 행이 모두 캐시에 반영된다 (누락 없음)', () => {
      const db = makeDb()

      const fixtures = [
        { dedupeKey: 'session-a\x1fthrashing',     lastSentTs: 1_000, cooldownUntil: 61_000 },
        { dedupeKey: 'session-b\x1ffalse_success',  lastSentTs: 2_000, cooldownUntil: 62_000 },
        { dedupeKey: 'session-c\x1fmeta',           lastSentTs: 3_000, cooldownUntil: null   },
        { dedupeKey: 'session-d\x1fthrashing',      lastSentTs: 4_000, cooldownUntil: 64_000 },
      ]

      for (const f of fixtures) {
        insertFixture(db, f)
      }

      const store = new CooldownStore(db)
      const loaded = store.loadCooldowns()

      expect(loaded).toBe(4)
      expect(store.cacheSize()).toBe(4)

      for (const f of fixtures) {
        expect(store.getDebounceState(f.dedupeKey).lastSentTs).toBe(f.lastSentTs)
        if (f.cooldownUntil != null) {
          expect(store.getCooldownUntil(f.dedupeKey)).toBe(f.cooldownUntil)
        } else {
          expect(store.getCooldownUntil(f.dedupeKey)).toBeUndefined()
        }
      }
    })

    it('대량 픽스처(100행)도 모두 반영된다', () => {
      const db = makeDb()

      for (let i = 0; i < 100; i++) {
        insertFixture(db, {
          dedupeKey: `session-${i}\x1fthrashing`,
          lastSentTs: i * 1_000,
          cooldownUntil: i % 2 === 0 ? i * 1_000 + 60_000 : null,
          sessionId: `session-${i}`,
          kind: 'thrashing',
        })
      }

      const store = new CooldownStore(db)
      const loaded = store.loadCooldowns()

      expect(loaded).toBe(100)
      expect(store.cacheSize()).toBe(100)

      for (let i = 0; i < 100; i++) {
        const key = `session-${i}\x1fthrashing`
        expect(store.getDebounceState(key).lastSentTs).toBe(i * 1_000)
        if (i % 2 === 0) {
          expect(store.getCooldownUntil(key)).toBe(i * 1_000 + 60_000)
        } else {
          expect(store.getCooldownUntil(key)).toBeUndefined()
        }
      }
    })
  })

  // ── 3. 빈 테이블 / 테이블 없음 ─────────────────────────────────────────

  describe('빈 테이블 / 테이블 없음', () => {
    it('notifications 테이블이 비어 있으면 loadCooldowns는 0을 반환한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      const loaded = store.loadCooldowns()

      expect(loaded).toBe(0)
      expect(store.cacheSize()).toBe(0)
    })

    it('notifications 테이블이 없어도 예외를 던지지 않는다', () => {
      const db = new Database(':memory:')
      db.pragma('journal_mode = WAL')
      // ensureNotificationsTable 미호출 — 테이블 없음

      const store = new CooldownStore(db)

      expect(() => store.loadCooldowns()).not.toThrow()
      expect(store.loadCooldowns()).toBe(0)
    })
  })

  // ── 4. warmUp() 하위호환 ─────────────────────────────────────────────────

  describe('warmUp()은 loadCooldowns()와 동일하게 동작한다 (하위호환)', () => {
    it('warmUp 후 픽스처 행이 캐시에 반영된다 (loadCooldowns와 동일)', () => {
      const db = makeDb()
      insertFixture(db, {
        dedupeKey: 'session-warm\x1fthrashing',
        lastSentTs: 7_777_777,
        cooldownUntil: 7_837_777,
        sessionId: 'session-warm',
        kind: 'thrashing',
      })

      const store = new CooldownStore(db)
      store.warmUp() // 내부적으로 loadCooldowns() 호출

      expect(store.getDebounceState('session-warm\x1fthrashing').lastSentTs).toBe(7_777_777)
      expect(store.getCooldownUntil('session-warm\x1fthrashing')).toBe(7_837_777)
    })

    it('warmUp과 loadCooldowns 모두 동일한 캐시 크기를 만든다', () => {
      const db = makeDb()

      const fixtures = [
        { dedupeKey: 'k1\x1fthrashing',    lastSentTs: 100 },
        { dedupeKey: 'k2\x1ffalse_success', lastSentTs: 200 },
        { dedupeKey: 'k3\x1fmeta',          lastSentTs: 300 },
      ]
      for (const f of fixtures) insertFixture(db, f)

      // warmUp 경로
      const storeA = new CooldownStore(db)
      storeA.warmUp()

      // loadCooldowns 경로
      const storeB = new CooldownStore(db)
      storeB.loadCooldowns()

      expect(storeA.cacheSize()).toBe(storeB.cacheSize())
      expect(storeA.cacheSize()).toBe(3)
    })
  })

  // ── 5. 재호출 / 갱신 후 재로드 ─────────────────────────────────────────

  describe('재호출 및 갱신 후 재로드', () => {
    it('loadCooldowns를 두 번 호출해도 중복 없이 정확한 값이 유지된다', () => {
      const db = makeDb()
      insertFixture(db, { dedupeKey: 'session-a\x1fthrashing', lastSentTs: 1_000 })

      const store = new CooldownStore(db)
      store.loadCooldowns()
      store.loadCooldowns() // 재호출

      // 동일 키가 두 번 set되지만 Map이라 1개만 유지됨
      expect(store.cacheSize()).toBe(1)
      expect(store.getDebounceState('session-a\x1fthrashing').lastSentTs).toBe(1_000)
    })

    it('clearCache 후 loadCooldowns를 다시 호출하면 DB 상태가 재반영된다', () => {
      const db = makeDb()
      insertFixture(db, {
        dedupeKey: 'session-reload\x1fthrashing',
        lastSentTs: 5_000_000,
        cooldownUntil: 5_060_000,
      })

      const store = new CooldownStore(db)
      store.loadCooldowns()
      expect(store.cacheSize()).toBe(1)

      store.clearCache()
      expect(store.cacheSize()).toBe(0)

      // 재로드
      const loaded = store.loadCooldowns()
      expect(loaded).toBe(1)
      expect(store.getDebounceState('session-reload\x1fthrashing').lastSentTs).toBe(5_000_000)
      expect(store.getCooldownUntil('session-reload\x1fthrashing')).toBe(5_060_000)
    })

    it('DB에 새 행이 추가된 후 loadCooldowns를 재호출하면 새 행도 반영된다', () => {
      const db = makeDb()
      insertFixture(db, { dedupeKey: 'session-a\x1fthrashing', lastSentTs: 1_000 })

      const store = new CooldownStore(db)
      store.loadCooldowns()
      expect(store.cacheSize()).toBe(1)

      // DB에 새 행 추가 (clearCache 없이)
      insertFixture(db, { dedupeKey: 'session-b\x1ffalse_success', lastSentTs: 2_000 })

      // 재로드 — 기존 캐시 위에 덮어쓰기
      const loaded = store.loadCooldowns()
      expect(loaded).toBe(2)
      expect(store.getDebounceState('session-b\x1ffalse_success').lastSentTs).toBe(2_000)
    })
  })

  // ── 6. 재시작 시나리오 ───────────────────────────────────────────────────

  describe('재시작 시나리오 (데몬 재시작 후 쿨다운 복원)', () => {
    it('store1에서 recordSent 후 store2가 loadCooldowns로 동일 상태를 복원한다', () => {
      const db = makeDb()

      const store1 = new CooldownStore(db)
      store1.recordSent('session-restart\x1fthrashing', 1_234_567_890, 'session-restart', 'thrashing')

      // "재시작" — 새 인스턴스
      const store2 = new CooldownStore(db)
      const loaded = store2.loadCooldowns()

      expect(loaded).toBe(1)
      expect(store2.getDebounceState('session-restart\x1fthrashing').lastSentTs).toBe(1_234_567_890)
    })

    it('store1에서 setCooldown 후 store2가 loadCooldowns로 cooldownUntil을 복원한다', () => {
      const db = makeDb()
      const cooldownUntil = Date.now() + 300_000 // 5분 후 만료

      const store1 = new CooldownStore(db)
      store1.setCooldown('session-persist\x1ffalse_success', cooldownUntil)

      // "재시작" — 새 인스턴스
      const store2 = new CooldownStore(db)
      store2.loadCooldowns()

      expect(store2.getCooldownUntil('session-persist\x1ffalse_success')).toBe(cooldownUntil)
    })

    it('혼합 시나리오: recordSent + setCooldown 후 재시작 시 모두 복원된다', () => {
      const db = makeDb()
      const sentTs = 1_700_000_000_000
      const cooldownUntil = sentTs + 60_000

      const store1 = new CooldownStore(db)
      store1.recordSent('session-combo\x1fthrashing', sentTs, 'session-combo', 'thrashing')
      store1.setCooldown('session-combo\x1fthrashing', cooldownUntil)

      // "재시작"
      const store2 = new CooldownStore(db)
      const loaded = store2.loadCooldowns()

      expect(loaded).toBe(1) // 동일 key이므로 1행
      expect(store2.getDebounceState('session-combo\x1fthrashing').lastSentTs).toBe(sentTs)
      expect(store2.getCooldownUntil('session-combo\x1fthrashing')).toBe(cooldownUntil)
    })
  })
})
