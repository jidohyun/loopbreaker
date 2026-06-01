/**
 * tests/cooldown-store-m4.test.ts
 *
 * CooldownStore 단위 테스트.
 *
 * 검증:
 *   - 인메모리 캐시 조회/갱신
 *   - SQLite 영속
 *   - 부팅 시 DB → 인메모리 워밍업
 *   - UPSERT (중복 키 갱신)
 *   - WAL 모드 준수
 */

import { describe, expect, it } from '@jest/globals'
import Database from 'better-sqlite3'
import { CooldownStore, ensureNotificationsTable } from '../src/notify/cooldown-store.js'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureNotificationsTable(db)
  return db
}

describe('CooldownStore', () => {
  describe('초기 상태', () => {
    it('초기에는 모든 키의 lastSentTs가 undefined이다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      const state = store.getDebounceState('any-key')
      expect(state.lastSentTs).toBeUndefined()
    })

    it('cacheSize()는 초기에 0이다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      expect(store.cacheSize()).toBe(0)
    })
  })

  describe('recordSent', () => {
    it('recordSent 후 인메모리에서 조회 가능하다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.recordSent('session-a\x1fthrashing', 1_000_000, 'session-a', 'thrashing')

      const state = store.getDebounceState('session-a\x1fthrashing')
      expect(state.lastSentTs).toBe(1_000_000)
    })

    it('recordSent 후 DB에 기록된다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.recordSent('session-a\x1fthrashing', 1_000_000, 'session-a', 'thrashing')

      const row = db.prepare('SELECT * FROM notifications WHERE dedupe_key = ?')
        .get('session-a\x1fthrashing') as {
          last_sent_ts: number
          session_id: string
          kind: string
          send_count: number
        } | undefined

      expect(row).toBeDefined()
      expect(row!.last_sent_ts).toBe(1_000_000)
      expect(row!.session_id).toBe('session-a')
      expect(row!.kind).toBe('thrashing')
      expect(row!.send_count).toBe(1)
    })

    it('동일 키에 두 번 recordSent 하면 send_count가 2가 된다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.recordSent('key', 1_000_000, 'session', 'thrashing')
      store.recordSent('key', 1_010_000, 'session', 'thrashing')

      const row = db.prepare('SELECT send_count, last_sent_ts FROM notifications WHERE dedupe_key = ?')
        .get('key') as { send_count: number; last_sent_ts: number } | undefined

      expect(row!.send_count).toBe(2)
      expect(row!.last_sent_ts).toBe(1_010_000)
    })

    it('cacheSize()가 recordSent 후 증가한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.recordSent('key-1', 1000, 'session', 'thrashing')
      expect(store.cacheSize()).toBe(1)

      store.recordSent('key-2', 2000, 'session', 'false_success')
      expect(store.cacheSize()).toBe(2)
    })

    it('동일 키 업데이트는 cacheSize를 변경하지 않는다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.recordSent('key', 1000, 'session', 'thrashing')
      store.recordSent('key', 2000, 'session', 'thrashing')

      expect(store.cacheSize()).toBe(1)
    })
  })

  describe('warmUp (DB → 인메모리 로드)', () => {
    it('warmUp 후 DB 데이터가 인메모리에 로드된다', () => {
      const db = makeDb()

      // DB에 직접 기록
      db.prepare(`
        INSERT INTO notifications (dedupe_key, last_sent_ts, session_id, kind, send_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run('session-x\x1fthrashing', 9_999_000, 'session-x', 'thrashing', 9_999_000, 9_999_000)

      // 새 CooldownStore 인스턴스 → warmUp
      const store = new CooldownStore(db)
      store.warmUp()

      const state = store.getDebounceState('session-x\x1fthrashing')
      expect(state.lastSentTs).toBe(9_999_000)
    })

    it('warmUp 없이 새 인스턴스는 DB 데이터를 모른다', () => {
      const db = makeDb()

      db.prepare(`
        INSERT INTO notifications (dedupe_key, last_sent_ts, session_id, kind, send_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run('session-x\x1fthrashing', 9_999_000, 'session-x', 'thrashing', 9_999_000, 9_999_000)

      const store = new CooldownStore(db)
      // warmUp 없음

      const state = store.getDebounceState('session-x\x1fthrashing')
      expect(state.lastSentTs).toBeUndefined()
    })

    it('여러 키가 DB에 있을 때 모두 워밍업된다', () => {
      const db = makeDb()

      const entries = [
        { key: 'session-a\x1fthrashing', ts: 1000 },
        { key: 'session-b\x1ffalse_success', ts: 2000 },
        { key: 'session-c\x1fmeta', ts: 3000 },
      ]

      for (const entry of entries) {
        db.prepare(`
          INSERT INTO notifications (dedupe_key, last_sent_ts, session_id, kind, send_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?)
        `).run(entry.key, entry.ts, 'session', 'thrashing', entry.ts, entry.ts)
      }

      const store = new CooldownStore(db)
      store.warmUp()

      expect(store.cacheSize()).toBe(3)
      for (const entry of entries) {
        expect(store.getDebounceState(entry.key).lastSentTs).toBe(entry.ts)
      }
    })

    it('notifications 테이블이 없어도 warmUp이 예외를 던지지 않는다', () => {
      const db = new Database(':memory:')
      // 테이블 생성 없음

      const store = new CooldownStore(db)
      expect(() => store.warmUp()).not.toThrow()
    })
  })

  describe('clearCache', () => {
    it('clearCache 후 인메모리가 비워진다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.recordSent('key', 1000, 'session', 'thrashing')
      expect(store.cacheSize()).toBe(1)

      store.clearCache()
      expect(store.cacheSize()).toBe(0)

      const state = store.getDebounceState('key')
      expect(state.lastSentTs).toBeUndefined()
    })

    it('clearCache 후 DB는 그대로 유지된다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.recordSent('key', 1000, 'session', 'thrashing')
      store.clearCache()

      const row = db.prepare('SELECT last_sent_ts FROM notifications WHERE dedupe_key = ?')
        .get('key') as { last_sent_ts: number } | undefined

      expect(row).toBeDefined()
      expect(row!.last_sent_ts).toBe(1000)
    })
  })

  describe('setCooldown', () => {
    it('setCooldown 후 getCooldownUntil로 조회 가능하다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.setCooldown('session-a\x1fthrashing', 2_000_000)

      expect(store.getCooldownUntil('session-a\x1fthrashing')).toBe(2_000_000)
    })

    it('setCooldown 후 DB에 cooldown_until이 기록된다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.setCooldown('session-a\x1fthrashing', 2_000_000)

      const row = db.prepare('SELECT cooldown_until FROM notifications WHERE dedupe_key = ?')
        .get('session-a\x1fthrashing') as { cooldown_until: number } | undefined

      expect(row).toBeDefined()
      expect(row!.cooldown_until).toBe(2_000_000)
    })

    it('동일 key로 setCooldown 재호출 시 값이 덮어써진다 (upsert)', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.setCooldown('key', 1_000_000)
      store.setCooldown('key', 9_999_999)

      // 인메모리
      expect(store.getCooldownUntil('key')).toBe(9_999_999)

      // SQLite
      const row = db.prepare('SELECT cooldown_until FROM notifications WHERE dedupe_key = ?')
        .get('key') as { cooldown_until: number } | undefined

      expect(row!.cooldown_until).toBe(9_999_999)
    })

    it('여러 키에 setCooldown 하면 각각 독립적으로 저장된다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.setCooldown('session-a\x1fthrashing', 1_000_000)
      store.setCooldown('session-b\x1ffalse_success', 2_000_000)

      expect(store.getCooldownUntil('session-a\x1fthrashing')).toBe(1_000_000)
      expect(store.getCooldownUntil('session-b\x1ffalse_success')).toBe(2_000_000)

      const rows = db.prepare('SELECT dedupe_key, cooldown_until FROM notifications ORDER BY dedupe_key')
        .all() as { dedupe_key: string; cooldown_until: number }[]

      expect(rows).toHaveLength(2)
    })

    it('존재하지 않는 key의 getCooldownUntil은 undefined이다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      expect(store.getCooldownUntil('nonexistent')).toBeUndefined()
    })

    it('setCooldown 후 warmUp하면 새 인스턴스에서도 조회된다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.setCooldown('session-x\x1fthrashing', 5_000_000)

      // 새 인스턴스 → warmUp
      const store2 = new CooldownStore(db)
      store2.warmUp()

      expect(store2.getCooldownUntil('session-x\x1fthrashing')).toBe(5_000_000)
    })

    it('setCooldown은 recordSent와 독립적으로 동작한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.recordSent('key', 1_000_000, 'session', 'thrashing')
      store.setCooldown('key', 1_060_000) // +60s cooldown

      // recordSent 값은 유지
      expect(store.getDebounceState('key').lastSentTs).toBe(1_000_000)
      // setCooldown 값도 저장
      expect(store.getCooldownUntil('key')).toBe(1_060_000)

      // DB에서 확인
      const row = db.prepare('SELECT last_sent_ts, cooldown_until FROM notifications WHERE dedupe_key = ?')
        .get('key') as { last_sent_ts: number; cooldown_until: number } | undefined

      expect(row!.last_sent_ts).toBe(1_000_000)
      expect(row!.cooldown_until).toBe(1_060_000)
    })

    it('clearCache 후 setCooldown으로 저장한 값도 지워진다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.setCooldown('key', 1_000_000)
      store.clearCache()

      expect(store.getCooldownUntil('key')).toBeUndefined()
    })
  })

  describe('ensureNotificationsTable 멱등성', () => {
    it('테이블이 이미 존재할 때 두 번 호출해도 에러 없음', () => {
      const db = makeDb()

      expect(() => {
        ensureNotificationsTable(db)
        ensureNotificationsTable(db)
      }).not.toThrow()
    })
  })
})
