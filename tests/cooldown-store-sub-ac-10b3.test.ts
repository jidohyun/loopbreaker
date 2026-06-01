/**
 * tests/cooldown-store-sub-ac-10b3.test.ts
 *
 * Sub-AC 10-B-3: setCooldown + getCooldown 통합 시나리오 단위 테스트.
 *
 * 검증 항목:
 *   1. setCooldown 후 getCooldown으로 동일 값이 조회된다
 *   2. 갱신(upsert) 후 getCooldown이 최신 값을 반환한다
 *   3. 만료 시각 기반 조건부 조회: cooldown_until > now 이면 활성, 그 외 만료
 *   4. 복합 시나리오: recordSent → setCooldown → getCooldown 조합
 *
 * 모두 in-memory SQLite(:memory:)로만 동작 — 네트워크/OS 알림 없음.
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

/** epoch ms 기준 "지금으로부터 +offsetMs 후" 시각 */
function futureTs(offsetMs: number): number {
  return Date.now() + offsetMs
}

/** epoch ms 기준 "지금으로부터 -offsetMs 전" 시각 */
function pastTs(offsetMs: number): number {
  return Date.now() - offsetMs
}

describe('CooldownStore setCooldown+getCooldown 통합 (Sub-AC 10-B-3)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. set 후 get으로 동일 값 조회
  // ─────────────────────────────────────────────────────────────────────────
  describe('set → get 동일 값 조회', () => {
    it('setCooldown 후 getCooldown이 동일한 cooldown_until을 반환한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)
      const key = 'session-a\x1fthrashing'
      const cooldownUntil = 1_700_000_000_000

      store.setCooldown(key, cooldownUntil)

      const row = store.getCooldown(key)
      expect(row).not.toBeNull()
      expect(row!.cooldown_until).toBe(cooldownUntil)
    })

    it('인메모리 getCooldownUntil과 SQLite getCooldown의 cooldown_until이 일치한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)
      const key = 'session-b\x1ffalse_success'
      const cooldownUntil = 2_000_000_000_000

      store.setCooldown(key, cooldownUntil)

      // 인메모리 경로
      const memValue = store.getCooldownUntil(key)
      // SQLite 경로
      const dbRow = store.getCooldown(key)

      expect(memValue).toBe(cooldownUntil)
      expect(dbRow).not.toBeNull()
      expect(dbRow!.cooldown_until).toBe(cooldownUntil)
      // 두 경로가 동일
      expect(memValue).toBe(dbRow!.cooldown_until)
    })

    it('존재하지 않는 key에 대해 getCooldown은 null을 반환한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      // setCooldown 호출 없음
      expect(store.getCooldown('nonexistent\x1fkind')).toBeNull()
    })

    it('다른 key로 setCooldown해도 무관한 key는 null이다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      store.setCooldown('session-a\x1fthrashing', 1_000_000_000)

      expect(store.getCooldown('session-b\x1fthrashing')).toBeNull()
      expect(store.getCooldown('session-a\x1ffalse_success')).toBeNull()
    })

    it('여러 키 각각 setCooldown 후 getCooldown이 각각의 값을 독립적으로 반환한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      const entries = [
        { key: 'session-a\x1fthrashing',     cooldownUntil: 1_100_000_000_000 },
        { key: 'session-b\x1ffalse_success',  cooldownUntil: 1_200_000_000_000 },
        { key: 'session-c\x1fmeta',           cooldownUntil: 1_300_000_000_000 },
      ]

      for (const e of entries) {
        store.setCooldown(e.key, e.cooldownUntil)
      }

      for (const e of entries) {
        const row = store.getCooldown(e.key)
        expect(row).not.toBeNull()
        expect(row!.cooldown_until).toBe(e.cooldownUntil)
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 2. 갱신(upsert) 후 최신 값 반환
  // ─────────────────────────────────────────────────────────────────────────
  describe('upsert 후 최신 값 반환', () => {
    it('동일 key로 setCooldown을 두 번 호출하면 getCooldown이 마지막 값을 반환한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)
      const key = 'session-a\x1fthrashing'

      store.setCooldown(key, 1_000_000_000_000)
      store.setCooldown(key, 1_999_999_999_999)

      const row = store.getCooldown(key)
      expect(row).not.toBeNull()
      expect(row!.cooldown_until).toBe(1_999_999_999_999)
    })

    it('upsert 후 인메모리 getCooldownUntil도 최신 값과 일치한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)
      const key = 'session-x\x1fthrashing'

      store.setCooldown(key, 500_000)
      store.setCooldown(key, 999_000)
      store.setCooldown(key, 1_234_567)

      expect(store.getCooldownUntil(key)).toBe(1_234_567)
      expect(store.getCooldown(key)!.cooldown_until).toBe(1_234_567)
    })

    it('upsert 시 DB 행은 1개만 존재한다 (중복 없음)', () => {
      const db = makeDb()
      const store = new CooldownStore(db)
      const key = 'session-a\x1fthrashing'

      store.setCooldown(key, 1_000_000)
      store.setCooldown(key, 2_000_000)
      store.setCooldown(key, 3_000_000)

      const rows = db
        .prepare('SELECT COUNT(*) AS cnt FROM notifications WHERE dedupe_key = ?')
        .get(key) as { cnt: number }

      expect(rows.cnt).toBe(1)
    })

    it('갱신 후 새 CooldownStore + warmUp으로도 최신 값이 로드된다 (영속 확인)', () => {
      const db = makeDb()
      const store = new CooldownStore(db)
      const key = 'session-persist\x1fthrashing'

      store.setCooldown(key, 1_000_000)
      store.setCooldown(key, 5_000_000) // 갱신

      // 새 인스턴스 → warmUp
      const store2 = new CooldownStore(db)
      store2.warmUp()

      // warmUp은 cooldown_until을 cooldownCache에 올림
      expect(store2.getCooldownUntil(key)).toBe(5_000_000)
      // getCooldown은 SQLite를 직접 읽음
      expect(store2.getCooldown(key)!.cooldown_until).toBe(5_000_000)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 3. 만료 시각 기반 조건부 조회
  // ─────────────────────────────────────────────────────────────────────────
  describe('만료 시각 기반 조건부 조회', () => {
    it('cooldown_until > now 이면 쿨다운이 아직 활성이다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)
      const key = 'session-active\x1fthrashing'
      const now = Date.now()
      const active = futureTs(60_000) // 60초 후 만료

      store.setCooldown(key, active)

      const row = store.getCooldown(key)
      expect(row).not.toBeNull()
      expect(row!.cooldown_until).toBeGreaterThan(now)
      // 조건부 판정: 활성 쿨다운
      const isActive = row!.cooldown_until != null && row!.cooldown_until > now
      expect(isActive).toBe(true)
    })

    it('cooldown_until <= now 이면 쿨다운이 만료됐다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)
      const key = 'session-expired\x1fthrashing'
      const now = Date.now()
      const expired = pastTs(5_000) // 5초 전에 이미 만료

      store.setCooldown(key, expired)

      const row = store.getCooldown(key)
      expect(row).not.toBeNull()
      expect(row!.cooldown_until).toBeLessThanOrEqual(now)
      // 조건부 판정: 만료 쿨다운
      const isActive = row!.cooldown_until != null && row!.cooldown_until > now
      expect(isActive).toBe(false)
    })

    it('쿨다운 갱신 후 만료 여부가 새 값을 기준으로 재판정된다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)
      const key = 'session-refresh\x1fthrashing'
      const now = Date.now()

      // 먼저 이미 만료된 쿨다운 설정
      store.setCooldown(key, pastTs(10_000))
      const rowExpired = store.getCooldown(key)!
      expect(rowExpired.cooldown_until! <= now).toBe(true)

      // 쿨다운 갱신 (미래로)
      store.setCooldown(key, futureTs(60_000))
      const rowActive = store.getCooldown(key)!
      expect(rowActive.cooldown_until! > now).toBe(true)
    })

    it('cooldown_until이 null인 행은 쿨다운 비활성으로 판정된다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)

      // recordSent는 cooldown_until을 NULL로 삽입
      store.recordSent('session-a\x1fthrashing', 1_000_000, 'session-a', 'thrashing')

      const row = store.getCooldown('session-a\x1fthrashing')
      expect(row).not.toBeNull()
      // cooldown_until이 null이면 쿨다운 비활성
      const now = Date.now()
      const isActive = row!.cooldown_until != null && row!.cooldown_until > now
      expect(isActive).toBe(false)
    })

    it('만료 직전(경계값) 쿨다운은 활성이다 (cooldown_until = now+1)', () => {
      const db = makeDb()
      const store = new CooldownStore(db)
      const key = 'session-boundary\x1fthrashing'
      const now = Date.now()
      const justFuture = now + 1_000 // 1초 후

      store.setCooldown(key, justFuture)

      const row = store.getCooldown(key)!
      const isActive = row.cooldown_until != null && row.cooldown_until > now
      expect(isActive).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 4. 복합 시나리오: recordSent → setCooldown → getCooldown
  // ─────────────────────────────────────────────────────────────────────────
  describe('복합 시나리오', () => {
    it('recordSent 후 setCooldown을 호출하면 getCooldown이 양쪽 값을 모두 반환한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)
      const key = 'session-combo\x1fthrashing'
      const sentTs = 1_700_000_000_000
      const cooldownUntil = sentTs + 60_000

      store.recordSent(key, sentTs, 'session-combo', 'thrashing')
      store.setCooldown(key, cooldownUntil)

      const row = store.getCooldown(key)
      expect(row).not.toBeNull()
      expect(row!.last_sent_ts).toBe(sentTs)
      expect(row!.cooldown_until).toBe(cooldownUntil)
      expect(row!.session_id).toBe('session-combo')
      expect(row!.kind).toBe('thrashing')
    })

    it('sendCount가 증가한 상태에서도 setCooldown upsert가 정확히 동작한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)
      const key = 'session-multi\x1fthrashing'

      store.recordSent(key, 1_000_000, 'session-multi', 'thrashing')
      store.recordSent(key, 2_000_000, 'session-multi', 'thrashing')
      store.setCooldown(key, 2_060_000) // 두 번째 발송 기준 쿨다운

      const row = store.getCooldown(key)
      expect(row).not.toBeNull()
      expect(row!.send_count).toBe(2)
      expect(row!.last_sent_ts).toBe(2_000_000)
      expect(row!.cooldown_until).toBe(2_060_000)
    })

    it('clearCache 후에도 getCooldown(SQLite)은 값을 반환한다', () => {
      const db = makeDb()
      const store = new CooldownStore(db)
      const key = 'session-persist\x1fthrashing'
      const cooldownUntil = 9_000_000_000_000

      store.setCooldown(key, cooldownUntil)
      store.clearCache() // 인메모리 초기화

      // 인메모리는 비워졌지만 SQLite는 유지
      expect(store.getCooldownUntil(key)).toBeUndefined()
      const row = store.getCooldown(key)
      expect(row).not.toBeNull()
      expect(row!.cooldown_until).toBe(cooldownUntil)
    })

    it('재시작 시나리오: store1에서 setCooldown → store2 warmUp → getCooldown 일치', () => {
      const db = makeDb()
      const store1 = new CooldownStore(db)
      const key = 'session-restart\x1ffalse_success'
      const cooldownUntil = futureTs(300_000) // 5분 후 만료

      // "재시작 전" store1이 쿨다운 기록
      store1.setCooldown(key, cooldownUntil)

      // "재시작 후" 새 인스턴스 → warmUp으로 DB 복원
      const store2 = new CooldownStore(db)
      store2.warmUp()

      // 인메모리 복원
      expect(store2.getCooldownUntil(key)).toBe(cooldownUntil)
      // SQLite 직접 조회
      const row = store2.getCooldown(key)
      expect(row).not.toBeNull()
      expect(row!.cooldown_until).toBe(cooldownUntil)
      // 활성 쿨다운 판정
      const now = Date.now()
      expect(row!.cooldown_until! > now).toBe(true)
    })
  })
})
