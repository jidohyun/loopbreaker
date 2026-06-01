/**
 * src/notify/cooldown-store.ts
 *
 * CooldownStore — 디바운스/dedup/쿨다운 상태 관리.
 *
 * 인메모리 맵(빠른 조회) + SQLite 영속(재시작 후 쿨다운 유지) 둘 다.
 * 부팅 시 DB에서 인메모리로 워밍업.
 *
 * SPEC §2.2(6) 불변식:
 *   - dedupeKey = sessionId + '\x1f' + kind
 *   - 알림 발송 후 ts를 기록 (마지막 발송 ts + notifyDebounceMs = 쿨다운 만료)
 *   - 알림 실패 시에도 DetectionRecord는 이미 영속 → 손실 없음
 *
 * 단일writer/WAL 준수.
 */

import type Database from 'better-sqlite3'
import type { DebounceState } from './verdict-router.js'

/** notifications 테이블 행 */
interface NotificationRow {
  dedupe_key: string
  last_sent_ts: number
  cooldown_until: number | null
  session_id: string
  kind: string
  send_count: number
}

/**
 * CooldownStore — 디바운스 상태 인메모리 + SQLite 영속.
 *
 * 사용법:
 *   const store = new CooldownStore(db)
 *   store.warmUp()                   // 부팅 시 DB → 인메모리 워밍업
 *   store.getDebounceState(key)      // VerdictRouter에 주입
 *   store.recordSent(key, ts, ...)   // 발송 후 갱신
 */
export class CooldownStore {
  /** 인메모리 쿨다운 맵: dedupeKey → lastSentTs */
  private readonly cache = new Map<string, number>()

  /** 인메모리 쿨다운 만료 맵: notificationKey → cooldownUntil (epoch ms) */
  private readonly cooldownCache = new Map<string, number>()

  constructor(private readonly db: Database.Database) {}

  /**
   * DB → 인메모리 워밍업.
   * 데몬 시작 시 1회 호출.
   *
   * loadCooldowns()의 별칭 — 기존 호출 코드와의 호환을 유지한다.
   */
  warmUp(): void {
    this.loadCooldowns()
  }

  /**
   * 프로세스 시작 시 notifications 테이블에서 활성 cooldown 레코드를 읽어
   * 인메모리 캐시(cache / cooldownCache)를 초기화한다.
   *
   * - cache:         dedupeKey → lastSentTs  (디바운스 윈도우 판정용)
   * - cooldownCache: dedupeKey → cooldownUntil (쿨다운 만료 시각)
   *
   * notifications 테이블이 아직 존재하지 않는 경우(마이그레이션 전)
   * 예외를 던지지 않고 조용히 반환한다.
   *
   * @returns 로드된 행 수 (단위 테스트 검증용)
   */
  loadCooldowns(): number {
    try {
      const rows = this.db.prepare(
        'SELECT dedupe_key, last_sent_ts, cooldown_until FROM notifications',
      ).all() as Pick<NotificationRow, 'dedupe_key' | 'last_sent_ts' | 'cooldown_until'>[]

      for (const row of rows) {
        this.cache.set(row.dedupe_key, row.last_sent_ts)
        if (row.cooldown_until != null) {
          this.cooldownCache.set(row.dedupe_key, row.cooldown_until)
        }
      }

      return rows.length
    } catch {
      // notifications 테이블이 없으면 (마이그레이션 전) 조용히 무시
      return 0
    }
  }

  /**
   * 디바운스 상태 조회 (VerdictRouter에 주입하는 순수 조회 함수).
   * 상태를 변경하지 않음.
   */
  getDebounceState(dedupeKey: string): DebounceState {
    const lastSentTs = this.cache.get(dedupeKey)
    return { lastSentTs }
  }

  /**
   * 발송 완료 후 상태 갱신 (인메모리 + SQLite).
   *
   * @param dedupeKey  디바운스 키
   * @param ts         발송 시각 (epoch ms)
   * @param sessionId  세션 ID
   * @param kind       탐지 종류
   */
  recordSent(dedupeKey: string, ts: number, sessionId: string, kind: string): void {
    // 인메모리 갱신
    this.cache.set(dedupeKey, ts)

    // SQLite 영속 (WAL 단일writer)
    try {
      this.db.prepare(`
        INSERT INTO notifications (dedupe_key, last_sent_ts, cooldown_until, session_id, kind, send_count, created_at, updated_at)
        VALUES (@dedupeKey, @ts, NULL, @sessionId, @kind, 1, @ts, @ts)
        ON CONFLICT(dedupe_key) DO UPDATE SET
          last_sent_ts = @ts,
          send_count   = send_count + 1,
          updated_at   = @ts
      `).run({ dedupeKey, ts, sessionId, kind })
    } catch {
      // DB 쓰기 실패 시 인메모리는 이미 갱신됨 → 기록하고 계속
    }
  }

  /**
   * 쿨다운 만료 시각을 직접 지정해 저장 (인메모리 + SQLite upsert).
   *
   * recordSent가 "발송 시각"을 기록하는 것과 달리,
   * setCooldown은 "쿨다운 만료 시각(cooldownUntil)"을 직접 지정한다.
   * 동일 key로 재호출 시 값이 덮어써진다 (upsert).
   *
   * @param notificationKey  디바운스/dedup 키 (sessionId + '\x1f' + kind 등)
   * @param cooldownUntil    쿨다운 만료 시각 (epoch ms)
   */
  setCooldown(notificationKey: string, cooldownUntil: number): void {
    // 인메모리 갱신
    this.cooldownCache.set(notificationKey, cooldownUntil)

    // SQLite 영속 (WAL 단일writer, upsert)
    try {
      this.db.prepare(`
        INSERT INTO notifications (dedupe_key, last_sent_ts, cooldown_until, session_id, kind, send_count, created_at, updated_at)
        VALUES (@key, @cooldownUntil, @cooldownUntil, '', '', 0, @cooldownUntil, @cooldownUntil)
        ON CONFLICT(dedupe_key) DO UPDATE SET
          cooldown_until = @cooldownUntil,
          updated_at     = @cooldownUntil
      `).run({ key: notificationKey, cooldownUntil })
    } catch {
      // DB 쓰기 실패 시 인메모리는 이미 갱신됨 → 기록하고 계속
    }
  }

  /**
   * 쿨다운 만료 시각 조회 (인메모리 캐시).
   * setCooldown으로 설정한 값을 반환. 없으면 undefined.
   *
   * @param notificationKey  디바운스/dedup 키
   * @returns                cooldownUntil (epoch ms) 또는 undefined
   */
  getCooldownUntil(notificationKey: string): number | undefined {
    return this.cooldownCache.get(notificationKey)
  }

  /**
   * SQLite notifications 테이블에서 쿨다운 항목을 직접 조회한다.
   *
   * in-memory 캐시가 아닌 SQLite를 읽으므로, 재시작 후에도
   * 영속된 쿨다운 값을 확인할 수 있다.
   *
   * @param notificationKey  디바운스/dedup 키 (dedupe_key 컬럼)
   * @returns                notifications 행 전체, 또는 존재하지 않으면 null
   */
  getCooldown(notificationKey: string): NotificationRow | null {
    try {
      const row = this.db
        .prepare(
          'SELECT dedupe_key, last_sent_ts, cooldown_until, session_id, kind, send_count FROM notifications WHERE dedupe_key = ?',
        )
        .get(notificationKey) as NotificationRow | undefined

      return row ?? null
    } catch {
      // 테이블이 없는 등 DB 오류 시 null 반환
      return null
    }
  }

  /**
   * 인메모리 캐시 초기화 (테스트용).
   */
  clearCache(): void {
    this.cache.clear()
    this.cooldownCache.clear()
  }

  /**
   * 현재 인메모리 캐시 크기 반환 (모니터링용).
   */
  cacheSize(): number {
    return this.cache.size
  }
}

/**
 * notifications 테이블 마이그레이션 SQL.
 * src/storage/migrations.ts에서 호출.
 */
export const NOTIFICATIONS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS notifications (
    dedupe_key    TEXT    PRIMARY KEY,
    last_sent_ts  INTEGER NOT NULL,
    cooldown_until INTEGER,
    session_id    TEXT    NOT NULL,
    kind          TEXT    NOT NULL,
    send_count    INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  )
`

/**
 * notifications 테이블을 DB에 생성한다 (멱등).
 * 마이그레이션 러너 또는 직접 호출.
 */
export function ensureNotificationsTable(db: Database.Database): void {
  db.exec(NOTIFICATIONS_TABLE_DDL)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_notifications_session
      ON notifications (session_id, updated_at)
  `)
}
