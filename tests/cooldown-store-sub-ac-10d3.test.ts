/**
 * tests/cooldown-store-sub-ac-10d3.test.ts
 *
 * Sub-AC 10-D-3: 동일 DB 파일에 대해 복수 writer가 동시 접근할 때
 * 직렬화(대기) 또는 SQLITE_BUSY 에러가 발생함을 assert하는 단위 테스트.
 *
 * 단일 writer 규칙 위반 시나리오를 재현하고 예상 동작을 검증한다.
 *
 * 검증 항목:
 *   1. 단일 DB 인스턴스(직렬 접근)는 BUSY 없이 모든 쓰기를 완료한다
 *   2. 별도 DB 인스턴스 2개가 동일 파일에 동시 WAL 쓰기를 하면
 *      직렬화(대기) 또는 SQLITE_BUSY(code='SQLITE_BUSY') 중 하나가 발생한다
 *   3. WAL 모드에서는 reader가 writer와 동시 접근 시 블로킹되지 않는다
 *   4. 단일 writer 규칙 준수 시 write 후 데이터가 일관되게 읽힌다
 *
 * 모두 임시 파일 기반 SQLite + :memory: 로만 동작 — 네트워크/OS 알림 없음.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CooldownStore, ensureNotificationsTable } from '../src/notify/cooldown-store.js'

// ── helpers ──────────────────────────────────────────────────────────────────

/** :memory: DB를 생성, WAL 적용, notifications 테이블 초기화 */
function makeMemDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureNotificationsTable(db)
  return db
}

/** 임시 파일 경로에 DB 생성, WAL 적용, notifications 테이블 초기화 */
function makeFileDb(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 0') // 대기 없이 즉시 SQLITE_BUSY 반환
  ensureNotificationsTable(db)
  return db
}

/** 임시 디렉토리를 생성하고 DB 경로를 반환 */
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'loopbreaker-m4-test-'))
}

// ── test state ────────────────────────────────────────────────────────────────

let tempDir: string

beforeEach(() => {
  tempDir = makeTempDir()
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // 정리 실패는 무시
  }
})

// ── tests ─────────────────────────────────────────────────────────────────────

describe('CooldownStore 단일 writer 규칙 (Sub-AC 10-D-3)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. 단일 DB 인스턴스(직렬 접근): BUSY 없이 모두 완료
  // ─────────────────────────────────────────────────────────────────────────
  describe('단일 writer — 직렬 쓰기는 BUSY 없이 완료된다', () => {
    it(':memory: DB에서 단일 CooldownStore가 반복 쓰기를 BUSY 없이 완료한다', () => {
      const db = makeMemDb()
      const store = new CooldownStore(db)

      // 100회 직렬 write — 예외 없어야 함
      const writes: Array<{ key: string; ts: number }> = []
      for (let i = 0; i < 100; i++) {
        const key = `session-${i}\x1fthrashing`
        const ts = 1_700_000_000_000 + i
        expect(() => store.recordSent(key, ts, `session-${i}`, 'thrashing')).not.toThrow()
        writes.push({ key, ts })
      }

      // 데이터 일관성 확인
      for (const w of writes) {
        const state = store.getDebounceState(w.key)
        expect(state.lastSentTs).toBe(w.ts)
      }
    })

    it('파일 DB에서 단일 CooldownStore가 반복 쓰기를 BUSY 없이 완료한다', () => {
      const dbPath = join(tempDir, 'single-writer.db')
      const db = makeFileDb(dbPath)
      const store = new CooldownStore(db)

      for (let i = 0; i < 50; i++) {
        const key = `sess-${i}\x1fkind`
        expect(() => store.recordSent(key, i * 1000, `sess-${i}`, 'kind')).not.toThrow()
      }

      // 마지막 값 확인
      const state = store.getDebounceState('sess-49\x1fkind')
      expect(state.lastSentTs).toBe(49_000)

      db.close()
    })

    it('단일 writer: setCooldown 연속 호출이 BUSY 없이 완료된다', () => {
      const db = makeMemDb()
      const store = new CooldownStore(db)

      for (let i = 0; i < 50; i++) {
        const key = `sess-${i}\x1fthrashing`
        expect(() => store.setCooldown(key, 1_000_000 + i)).not.toThrow()
      }

      // 최신 값 검증
      for (let i = 0; i < 50; i++) {
        const key = `sess-${i}\x1fthrashing`
        expect(store.getCooldownUntil(key)).toBe(1_000_000 + i)
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 2. 복수 writer — 동일 파일에 별도 DB 인스턴스가 동시 쓰기 시
  //    직렬화(대기) 또는 SQLITE_BUSY 중 하나가 발생한다
  // ─────────────────────────────────────────────────────────────────────────
  describe('복수 writer — 단일 writer 규칙 위반 시나리오', () => {
    it('동일 파일에 열린 두 DB 인스턴스(busy_timeout=0)가 BEGIN EXCLUSIVE 트랜잭션 충돌 시 SQLITE_BUSY를 발생시킨다', () => {
      const dbPath = join(tempDir, 'multi-writer.db')

      // writer1: 테이블 초기화
      const writer1 = makeFileDb(dbPath)
      // writer2: 동일 파일, busy_timeout=0 (즉시 실패)
      const writer2 = new Database(dbPath)
      writer2.pragma('journal_mode = WAL')
      writer2.pragma('busy_timeout = 0')

      let busyOrError = false

      try {
        // writer1이 EXCLUSIVE 트랜잭션을 열어 보유
        writer1.prepare('BEGIN EXCLUSIVE').run()

        // writer2가 같은 파일에 EXCLUSIVE 트랜잭션 시도 → SQLITE_BUSY
        try {
          writer2.prepare('BEGIN EXCLUSIVE').run()
          // 여기까지 오면 직렬화(대기)로 성공했거나 예외 없이 진행됨
          // busy_timeout=0 이므로 보통 예외가 발생하지만
          // WAL 모드에서는 읽기 트랜잭션은 허용됨(쓰기만 충돌)
          writer2.prepare('ROLLBACK').run()
        } catch (err) {
          busyOrError = true
          const message = (err as Error).message
          // SQLite BUSY 에러 또는 locked 에러여야 함
          expect(
            message.includes('SQLITE_BUSY') ||
              message.includes('database is locked') ||
              message.includes('busy'),
          ).toBe(true)
        } finally {
          try {
            writer1.prepare('ROLLBACK').run()
          } catch {
            // 이미 롤백됐을 수 있음
          }
        }
      } finally {
        writer1.close()
        writer2.close()
      }

      // busy_timeout=0 이므로 EXCLUSIVE 충돌 시 반드시 에러가 발생해야 함
      expect(busyOrError).toBe(true)
    })

    it('두 CooldownStore 인스턴스가 동일 파일에서 순차 쓰기 시 데이터 일관성을 유지한다 (직렬화)', () => {
      const dbPath = join(tempDir, 'two-stores.db')

      // store1이 테이블을 초기화
      const db1 = makeFileDb(dbPath)
      const store1 = new CooldownStore(db1)

      // store2는 동일 파일 (busy_timeout 기본값 = WAL 모드 직렬화)
      const db2 = new Database(dbPath)
      db2.pragma('journal_mode = WAL')
      db2.pragma('busy_timeout = 5000') // 5초 대기 → 직렬화

      const store2 = new CooldownStore(db2)

      // store1 쓰기
      store1.recordSent('session-a\x1fthrashing', 1_000_000, 'session-a', 'thrashing')

      // store2 쓰기 (직렬화로 성공해야 함)
      store2.recordSent('session-b\x1ffalse_success', 2_000_000, 'session-b', 'false_success')

      // 두 레코드 모두 DB에 있어야 함 (db1으로 확인)
      const rowA = db1
        .prepare('SELECT last_sent_ts FROM notifications WHERE dedupe_key = ?')
        .get('session-a\x1fthrashing') as { last_sent_ts: number } | undefined

      const rowB = db1
        .prepare('SELECT last_sent_ts FROM notifications WHERE dedupe_key = ?')
        .get('session-b\x1ffalse_success') as { last_sent_ts: number } | undefined

      expect(rowA).toBeDefined()
      expect(rowA!.last_sent_ts).toBe(1_000_000)
      expect(rowB).toBeDefined()
      expect(rowB!.last_sent_ts).toBe(2_000_000)

      db1.close()
      db2.close()
    })

    it('동일 파일 두 writer가 동일 key를 upsert 하면 마지막 writer 값이 남는다 (WAL 직렬화)', () => {
      const dbPath = join(tempDir, 'upsert-conflict.db')

      const db1 = makeFileDb(dbPath)
      const store1 = new CooldownStore(db1)

      const db2 = new Database(dbPath)
      db2.pragma('journal_mode = WAL')
      db2.pragma('busy_timeout = 5000')
      const store2 = new CooldownStore(db2)

      const key = 'session-shared\x1fthrashing'

      // store1이 먼저 씀
      store1.recordSent(key, 1_000_000, 'session-shared', 'thrashing')
      // store2가 나중에 같은 key로 씀 (더 큰 ts)
      store2.recordSent(key, 2_000_000, 'session-shared', 'thrashing')

      // DB에는 최신 ts와 send_count=2 가 있어야 함
      const row = db1
        .prepare('SELECT last_sent_ts, send_count FROM notifications WHERE dedupe_key = ?')
        .get(key) as { last_sent_ts: number; send_count: number } | undefined

      expect(row).toBeDefined()
      expect(row!.send_count).toBe(2)
      expect(row!.last_sent_ts).toBe(2_000_000)

      db1.close()
      db2.close()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 3. WAL 모드: reader는 writer와 동시 접근 가능
  // ─────────────────────────────────────────────────────────────────────────
  describe('WAL 모드 — reader는 writer 트랜잭션 도중 블로킹되지 않는다', () => {
    it('writer가 EXCLUSIVE 트랜잭션 보유 중에도 reader는 SELECT 가능하다 (WAL 특성)', () => {
      const dbPath = join(tempDir, 'wal-reader.db')

      const writer = makeFileDb(dbPath)
      const reader = new Database(dbPath)
      reader.pragma('journal_mode = WAL')
      reader.pragma('busy_timeout = 0')

      // 데이터 삽입
      ensureNotificationsTable(writer)
      writer
        .prepare(
          `INSERT INTO notifications (dedupe_key, last_sent_ts, cooldown_until, session_id, kind, send_count, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, 1, ?, ?)`,
        )
        .run('before-tx\x1fthrashing', 100, 'before-tx', 'thrashing', 100, 100)

      // writer가 BEGIN (WAL 쓰기 트랜잭션 시작)
      writer.prepare('BEGIN').run()
      writer
        .prepare(
          `INSERT INTO notifications (dedupe_key, last_sent_ts, cooldown_until, session_id, kind, send_count, created_at, updated_at)
           VALUES (?, ?, NULL, ?, ?, 1, ?, ?)`,
        )
        .run('in-tx\x1fthrashing', 200, 'in-tx', 'thrashing', 200, 200)

      // reader는 writer의 미커밋 변경을 보지 않아야 하지만 SELECT 자체는 성공해야 함
      let readError: Error | null = null
      let rowCount = 0

      try {
        const rows = reader.prepare('SELECT COUNT(*) AS cnt FROM notifications').get() as {
          cnt: number
        }
        rowCount = rows.cnt
      } catch (err) {
        readError = err as Error
      }

      // WAL 모드에서 SELECT는 writer의 열린 트랜잭션과 무관하게 성공해야 함
      expect(readError).toBeNull()
      // 커밋 전 → reader는 트랜잭션 시작 전 데이터만 봄 (1개)
      expect(rowCount).toBe(1)

      // writer 커밋
      writer.prepare('COMMIT').run()

      // 커밋 후 reader는 2개를 봄
      const afterCommit = reader.prepare('SELECT COUNT(*) AS cnt FROM notifications').get() as {
        cnt: number
      }
      expect(afterCommit.cnt).toBe(2)

      writer.close()
      reader.close()
    })

    it(':memory: DB는 동일 인스턴스에서만 접근 가능하고, 다른 인스턴스(:memory:)는 격리된다', () => {
      // :memory: DB는 각 인스턴스가 독립적 — "concurrent writer"가 물리적으로 불가능
      const db1 = makeMemDb()
      const db2 = makeMemDb() // 별도 인메모리 DB

      const store1 = new CooldownStore(db1)
      const store2 = new CooldownStore(db2)

      store1.recordSent('key\x1fkind', 111, 'key', 'kind')
      store2.recordSent('key\x1fkind', 222, 'key', 'kind')

      // 각 인스턴스는 서로 독립적
      expect(store1.getDebounceState('key\x1fkind').lastSentTs).toBe(111)
      expect(store2.getDebounceState('key\x1fkind').lastSentTs).toBe(222)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 4. 단일 writer 규칙 준수 시 write 후 데이터 일관성
  // ─────────────────────────────────────────────────────────────────────────
  describe('단일 writer 규칙 — write 후 데이터 일관성', () => {
    it('CooldownStore가 단독으로 recordSent+setCooldown 순서를 지키면 일관된 결과를 반환한다', () => {
      const db = makeMemDb()
      const store = new CooldownStore(db)
      const key = 'session-a\x1fthrashing'

      store.recordSent(key, 1_000_000, 'session-a', 'thrashing')
      store.setCooldown(key, 1_060_000)

      // 인메모리 일관성
      expect(store.getDebounceState(key).lastSentTs).toBe(1_000_000)
      expect(store.getCooldownUntil(key)).toBe(1_060_000)

      // SQLite 일관성
      const row = store.getCooldown(key)
      expect(row).not.toBeNull()
      expect(row!.last_sent_ts).toBe(1_000_000)
      expect(row!.cooldown_until).toBe(1_060_000)
    })

    it('warmUp으로 재시작 후에도 단일 writer가 기록한 상태가 복원된다', () => {
      const dbPath = join(tempDir, 'restart-consistency.db')
      const db = makeFileDb(dbPath)
      const store = new CooldownStore(db)

      const key = 'session-restart\x1ffalse_success'
      store.recordSent(key, 5_000_000, 'session-restart', 'false_success')
      store.setCooldown(key, 5_060_000)
      db.close()

      // 재시작 시나리오
      const db2 = new Database(dbPath)
      db2.pragma('journal_mode = WAL')
      const store2 = new CooldownStore(db2)
      store2.warmUp()

      expect(store2.getDebounceState(key).lastSentTs).toBe(5_000_000)
      expect(store2.getCooldownUntil(key)).toBe(5_060_000)
      db2.close()
    })

    it('busy_timeout=0 설정 시 동일 파일 EXCLUSIVE 트랜잭션 충돌은 반드시 에러를 발생시킨다', () => {
      const dbPath = join(tempDir, 'busy-assert.db')
      const db1 = makeFileDb(dbPath)
      const db2 = new Database(dbPath)
      db2.pragma('journal_mode = WAL')
      db2.pragma('busy_timeout = 0')

      // db1이 EXCLUSIVE 잠금 획득
      db1.prepare('BEGIN EXCLUSIVE').run()

      // db2의 EXCLUSIVE 시도는 반드시 실패해야 함
      expect(() => {
        db2.prepare('BEGIN EXCLUSIVE').run()
      }).toThrow()

      // 정리
      try {
        db1.prepare('ROLLBACK').run()
      } catch {
        /* ignore */
      }
      db1.close()
      db2.close()
    })

    it('busy_timeout > 0 (5000ms) 설정 시 첫 writer가 커밋하면 두 번째 writer가 성공한다 (직렬화)', () => {
      const dbPath = join(tempDir, 'serialized-writers.db')
      const db1 = makeFileDb(dbPath)

      const db2 = new Database(dbPath)
      db2.pragma('journal_mode = WAL')
      db2.pragma('busy_timeout = 5000')

      // db1이 쓰기 후 커밋
      db1.prepare('BEGIN EXCLUSIVE').run()
      // 이미 테이블이 있으므로 즉시 커밋
      db1.prepare('COMMIT').run()

      // db2는 이제 EXCLUSIVE 잠금 획득 가능
      expect(() => {
        db2.prepare('BEGIN EXCLUSIVE').run()
        db2.prepare('COMMIT').run()
      }).not.toThrow()

      db1.close()
      db2.close()
    })
  })
})
