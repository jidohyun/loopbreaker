/**
 * tests/cooldown-store-sub-ac-10b2.test.ts
 *
 * Sub-AC 10-B-2: CooldownStore.getCooldown(notificationKey)
 *
 * 검증:
 *   - in-memory SQLite notifications 테이블에서 쿨다운 항목을 read하여 반환
 *   - 존재하지 않는 key에 대해 null/undefined를 반환
 *   - recordSent로 기록한 행을 getCooldown으로 조회 가능
 *   - setCooldown으로 기록한 cooldown_until도 getCooldown으로 조회 가능
 *   - warmUp 없이 DB에 직접 기록된 항목도 getCooldown으로 조회 가능
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

describe('CooldownStore.getCooldown (Sub-AC 10-B-2)', () => {
  describe('존재하지 않는 key', () => {
    it('getCooldown은 존재하지 않는 key에 대해 null을 반환한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      const result = store.getCooldown('nonexistent-key')
      expect(result).toBeNull()
    })

    it('빈 테이블에서 getCooldown은 null을 반환한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      expect(store.getCooldown('session-a\x1fthrashing')).toBeNull()
      expect(store.getCooldown('session-b\x1ffalse_success')).toBeNull()
    })

    it('다른 key가 존재할 때 없는 key는 여전히 null이다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.recordSent('session-a\x1fthrashing', 1_000_000, 'session-a', 'thrashing')

      expect(store.getCooldown('session-b\x1ffalse_success')).toBeNull()
    })
  })

  describe('recordSent 후 getCooldown 조회', () => {
    it('recordSent로 기록된 항목을 getCooldown으로 조회할 수 있다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.recordSent('session-a\x1fthrashing', 1_000_000, 'session-a', 'thrashing')

      const row = store.getCooldown('session-a\x1fthrashing')
      expect(row).not.toBeNull()
      expect(row!.dedupe_key).toBe('session-a\x1fthrashing')
      expect(row!.last_sent_ts).toBe(1_000_000)
      expect(row!.session_id).toBe('session-a')
      expect(row!.kind).toBe('thrashing')
      expect(row!.send_count).toBe(1)
    })

    it('send_count가 2인 경우 getCooldown이 최신 값을 반환한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.recordSent('key', 1_000_000, 'session', 'thrashing')
      store.recordSent('key', 1_010_000, 'session', 'thrashing')

      const row = store.getCooldown('key')
      expect(row).not.toBeNull()
      expect(row!.last_sent_ts).toBe(1_010_000)
      expect(row!.send_count).toBe(2)
    })
  })

  describe('setCooldown 후 getCooldown 조회', () => {
    it('setCooldown으로 기록된 항목을 getCooldown으로 조회할 수 있다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.setCooldown('session-a\x1fthrashing', 2_000_000)

      const row = store.getCooldown('session-a\x1fthrashing')
      expect(row).not.toBeNull()
      expect(row!.dedupe_key).toBe('session-a\x1fthrashing')
      expect(row!.cooldown_until).toBe(2_000_000)
    })

    it('setCooldown upsert 후 getCooldown이 최신 cooldown_until을 반환한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.setCooldown('key', 1_000_000)
      store.setCooldown('key', 9_999_999)

      const row = store.getCooldown('key')
      expect(row).not.toBeNull()
      expect(row!.cooldown_until).toBe(9_999_999)
    })
  })

  describe('DB 직접 기록 후 getCooldown 조회 (warmUp 없이)', () => {
    it('DB에 직접 기록한 항목을 warmUp 없이 getCooldown으로 조회할 수 있다', () => {
      const db = makeDb()

      // DB에 직접 기록 (warmUp 없이도 getCooldown은 SQLite에서 읽음)
      db.prepare(`
        INSERT INTO notifications (dedupe_key, last_sent_ts, cooldown_until, session_id, kind, send_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run('session-x\x1fthrashing', 9_999_000, 5_000_000, 'session-x', 'thrashing', 9_999_000, 9_999_000)

      const store = new CooldownStore(db)
      // warmUp 호출 없음 — getCooldown은 SQLite를 직접 읽어야 함

      const row = store.getCooldown('session-x\x1fthrashing')
      expect(row).not.toBeNull()
      expect(row!.last_sent_ts).toBe(9_999_000)
      expect(row!.cooldown_until).toBe(5_000_000)
    })

    it('warmUp 없이 DB 미기록 key는 null이다', () => {
      const db = makeDb()

      db.prepare(`
        INSERT INTO notifications (dedupe_key, last_sent_ts, session_id, kind, send_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run('session-x\x1fthrashing', 9_999_000, 'session-x', 'thrashing', 9_999_000, 9_999_000)

      const store = new CooldownStore(db)
      // warmUp 없음

      expect(store.getCooldown('session-y\x1fthrashing')).toBeNull()
    })
  })

  describe('테이블 없음 (마이그레이션 전)', () => {
    it('notifications 테이블이 없을 때 getCooldown은 null을 반환하며 예외를 던지지 않는다', () => {
      const db = new Database(':memory:')
      // 테이블 생성 없음
      const store = new CooldownStore(db)

      expect(() => store.getCooldown('any-key')).not.toThrow()
      expect(store.getCooldown('any-key')).toBeNull()
    })
  })
})
