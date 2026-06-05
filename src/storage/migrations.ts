// src/storage/migrations.ts
// SQLite 마이그레이션 러너.
// SPEC §3 §5 DDL 정본을 따름.
// 운영 DB(loopbreaker.db)와 평가 DB(loopbreaker-eval.db) 분리.
// BLOCKER B1: sqlite-vec float[N] 차원은 config.embedDim에서 생성 (매직넘버 금지).
// BLOCKER C1: detections.signal CHECK에 'false_success' 단일 (fake_success 금지).
// BLOCKER C3: detector_config.config_json 단일 컬럼 (개별 컬럼 직렬화 아님).
// BLOCKER C9: mock_cache.kind IN ('embed','judge') ('embedding' 금지).
// BLOCKER C9: gold_labels.source IN ('live_jsonl','synthetic','dohyun_adapted').

import type Database from 'better-sqlite3'
import type { DbKind } from '../contracts.js'
import { ensureNotificationsTable } from '../notify/cooldown-store.js'

/** 단일 마이그레이션 정의 */
export interface Migration {
  /** 마이그레이션 번호 (오름차순 적용) */
  version: number
  /** 적용 대상 DB 종류 */
  kind: DbKind | 'both'
  /** 마이그레이션 실행 함수 (embedDim 필요한 경우 인자로 받음) */
  up: (db: Database.Database, embedDim?: number) => void
}

// ---- 운영 DB 초기 스키마 (version 1) ----

/**
 * schema_version 테이블이 없으면 생성한다.
 * 이미 존재하면 에러 없이 통과 (멱등).
 * 운영·평가 DB 공통 부트스트랩.
 *
 * Sub-AC 6.1: 단독 export로 단위 테스트 가능.
 */
export function ensureSchemaVersionTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      version       INTEGER NOT NULL,
      applied_at    INTEGER NOT NULL,
      app_version   TEXT    NOT NULL,
      migrated_from INTEGER
    )
  `)
}

/** @internal schema_version 테이블 생성 (runMigrations 내부 호출용 alias) */
function createSchemaVersion(db: Database.Database): void {
  ensureSchemaVersionTable(db)
}

/**
 * 운영 DB 초기 스키마.
 * SPEC §3 DDL 정본.
 * BLOCKER B1: vec_embeddings는 embedDim 인자에서 DDL 생성.
 * BLOCKER C1: detections.signal CHECK 'false_success' 단일.
 * BLOCKER C3: detector_config.config_json 단일 컬럼.
 * BLOCKER C5: contracts 컬럼명 사용 (cwd, agent_scope, is_sidechain, kind, tool, input_json, result_class).
 */
function createOpInitialSchema(db: Database.Database, embedDim?: number): void {
  const dim = embedDim ?? 1024

  // ---- events 테이블 (BLOCKER C5 컬럼명) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      uuid                TEXT    PRIMARY KEY,
      parent_uuid         TEXT,
      session_id          TEXT    NOT NULL,
      cwd                 TEXT    NOT NULL,
      agent_scope         TEXT    NOT NULL,
      is_sidechain        INTEGER NOT NULL DEFAULT 0,
      ts                  INTEGER NOT NULL,
      ingested_at         INTEGER NOT NULL,
      kind                TEXT    NOT NULL
                            CHECK (kind IN ('user','assistant','system','attachment','tool_use','tool_result','other')),
      tool                TEXT,
      input_json          TEXT,
      result_class        TEXT
                            CHECK (result_class IN ('ok','error','rejected','blocked','empty','unknown') OR result_class IS NULL),
      tool_use_id         TEXT,
      text                TEXT,
      reasoning           TEXT,
      system_subtype      TEXT,
      interrupted_message_id TEXT,
      raw_json            TEXT    NOT NULL,
      parse_ok            INTEGER NOT NULL DEFAULT 1,
      parse_error         TEXT
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_session_ts
      ON events (session_id, ts)
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_kind
      ON events (session_id, kind)
  `)

  // ---- embeddings 메타 테이블 ----
  // BLOCKER B1: dim 컬럼에 실제 차원 저장 (DDL 생성 시 사용)
  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      rowid           INTEGER PRIMARY KEY,
      cache_key       TEXT    NOT NULL UNIQUE,
      embed_text_hash TEXT    NOT NULL,
      embed_model_id  TEXT    NOT NULL,
      dim             INTEGER NOT NULL,
      created_at      INTEGER NOT NULL,
      token_count     INTEGER
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_embeddings_text_model
      ON embeddings (embed_text_hash, embed_model_id)
  `)

  // ---- vec_embeddings 가상 테이블 ----
  // BLOCKER B1: float[N]에 매직넘버 하드코딩 금지. config.embedDim에서 생성.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
      embedding float[${dim}]
    )
  `)

  // ---- detector_config 테이블 ----
  // BLOCKER C3: config_json 단일 컬럼 (평면 DetectorConfig 직렬화)
  db.exec(`
    CREATE TABLE IF NOT EXISTS detector_config (
      config_id    TEXT    PRIMARY KEY,
      version_tag  TEXT    NOT NULL UNIQUE,
      is_active    INTEGER NOT NULL DEFAULT 0,
      config_json  TEXT    NOT NULL,
      created_at   INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_detector_active
      ON detector_config (is_active) WHERE is_active = 1
  `)

  // ---- detections 테이블 ----
  // BLOCKER C1: signal CHECK에 'false_success' 단일 ('fake_success' 금지)
  db.exec(`
    CREATE TABLE IF NOT EXISTS detections (
      detection_id      TEXT    PRIMARY KEY,
      session_id        TEXT    NOT NULL,
      agent_scope       TEXT    NOT NULL,
      kind              TEXT    NOT NULL
                          CHECK (kind IN ('thrashing','false_success','none')),
      subtype           TEXT    NOT NULL,
      confidence        REAL    NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      signals_json      TEXT    NOT NULL,
      evidence_json     TEXT    NOT NULL,
      reason            TEXT    NOT NULL,
      gate_json         TEXT    NOT NULL,
      embed_json        TEXT,
      judge_json        TEXT,
      detector_config_id TEXT   NOT NULL,
      is_replay         INTEGER NOT NULL DEFAULT 0,
      created_at        INTEGER NOT NULL,
      FOREIGN KEY (detector_config_id) REFERENCES detector_config(config_id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_detections_session
      ON detections (session_id, created_at)
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_detections_kind
      ON detections (kind, created_at)
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_detections_replay
      ON detections (is_replay, created_at)
  `)

  // ---- watch_offsets 테이블 ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS watch_offsets (
      file_path                  TEXT    PRIMARY KEY,
      inode                      INTEGER NOT NULL,
      dev                        INTEGER NOT NULL,
      byte_offset                INTEGER NOT NULL DEFAULT 0,
      last_complete_line_offset  INTEGER NOT NULL DEFAULT 0,
      partial_buffer             TEXT    NOT NULL DEFAULT '',
      file_size                  INTEGER NOT NULL DEFAULT 0,
      last_event_uuid            TEXT,
      rotation_seq               INTEGER NOT NULL DEFAULT 0,
      updated_at                 INTEGER NOT NULL,
      status                     TEXT    NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active','rotated','missing','error')),
      last_error                 TEXT
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_watch_status
      ON watch_offsets (status)
  `)
}

// ---- 평가 DB 초기 스키마 (version 1) ----

/**
 * 평가 DB 초기 스키마.
 * BLOCKER C1: expected_signal CHECK 'false_success' 단일.
 * BLOCKER C9: gold_labels.source enum 통일.
 * BLOCKER C9: mock_cache.kind IN ('embed','judge') ('embedding' 금지).
 */
function createEvalInitialSchema(db: Database.Database, _embedDim?: number): void {
  // ---- gold_labels 테이블 ----
  // BLOCKER C9: source IN ('live_jsonl','synthetic','dohyun_adapted')
  // BLOCKER C1: expected_signal IN ('thrashing','false_success','none')
  db.exec(`
    CREATE TABLE IF NOT EXISTS gold_labels (
      label_id        TEXT    PRIMARY KEY,
      label_kind      TEXT    NOT NULL
                        CHECK (label_kind IN ('point','span','window')),
      anchor_uuid     TEXT,
      start_uuid      TEXT,
      end_uuid        TEXT,
      window_id       TEXT,
      session_id      TEXT    NOT NULL,
      expected_signal TEXT    NOT NULL
                        CHECK (expected_signal IN ('thrashing','false_success','none')),
      source          TEXT    NOT NULL
                        CHECK (source IN ('live_jsonl','synthetic','dohyun_adapted')),
      labeler_id      TEXT    NOT NULL,
      label_round     INTEGER NOT NULL DEFAULT 1,
      labeled_at      INTEGER NOT NULL,
      notes           TEXT,
      CHECK (
        (label_kind = 'point'  AND anchor_uuid IS NOT NULL) OR
        (label_kind = 'span'   AND start_uuid IS NOT NULL AND end_uuid IS NOT NULL) OR
        (label_kind = 'window' AND window_id IS NOT NULL)
      )
    )
  `)

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_gold_point
      ON gold_labels (labeler_id, label_round, anchor_uuid) WHERE label_kind = 'point'
  `)

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_gold_span
      ON gold_labels (labeler_id, label_round, start_uuid, end_uuid) WHERE label_kind = 'span'
  `)

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_gold_window
      ON gold_labels (labeler_id, label_round, window_id) WHERE label_kind = 'window'
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gold_signal
      ON gold_labels (expected_signal)
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gold_session
      ON gold_labels (session_id)
  `)

  // ---- eval_metrics 테이블 ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_metrics (
      run_id              TEXT    PRIMARY KEY,
      run_at              INTEGER NOT NULL,
      detector_config_id  TEXT    NOT NULL,
      embed_model_id      TEXT    NOT NULL,
      judge_model_id      TEXT,
      gold_count          INTEGER NOT NULL,
      is_replay           INTEGER NOT NULL DEFAULT 0,
      precision           REAL,
      recall              REAL,
      f1                  REAL,
      cohens_kappa        REAL,
      balanced_acc        REAL,
      metrics_json        TEXT    NOT NULL,
      notes               TEXT
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_eval_run_at
      ON eval_metrics (run_at)
  `)

  // ---- mock_cache 테이블 (평가 DB 전용) ----
  // BLOCKER C9: kind IN ('embed','judge') ('embedding' 금지)
  db.exec(`
    CREATE TABLE IF NOT EXISTS mock_cache (
      cache_key     TEXT    PRIMARY KEY,
      kind          TEXT    NOT NULL CHECK (kind IN ('embed','judge')),
      model_id      TEXT    NOT NULL,
      response_json TEXT    NOT NULL,
      created_at    INTEGER NOT NULL,
      hit_count     INTEGER NOT NULL DEFAULT 0
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mock_kind_model
      ON mock_cache (kind, model_id)
  `)
}

// ---- 마이그레이션 목록 ----

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    kind: 'op',
    up: createOpInitialSchema,
  },
  {
    version: 1,
    kind: 'eval',
    up: createEvalInitialSchema,
  },
  // ---- M4 알림: notifications 테이블 (op DB version 2) ----
  // CooldownStore가 디바운스/쿨다운 상태를 영속·워밍업하는 테이블.
  // DDL 단일 출처는 cooldown-store.ts (ensureNotificationsTable).
  {
    version: 2,
    kind: 'op',
    up: (db) => ensureNotificationsTable(db),
  },
  // ---- M6 평가 하니스: eval DB version 2 ----
  // op_main ATTACH 지원 마커.
  // open()에서 ATTACH DATABASE <opPath> AS op_main (read-only) 수행.
  // up은 schema_version 마커만 기록 (ATTACH는 open()에서 처리).
  {
    version: 2,
    kind: 'eval',
    up: (_db) => {
      // schema_version 마커만 — ATTACH는 StorageLayer.open()에서 처리.
      // no DDL changes needed here.
    },
  },
]

// ---- 마이그레이션 러너 ----

/**
 * 마이그레이션 러너.
 * - schema_version 테이블을 부트스트랩.
 * - 현재 version보다 높은 마이그레이션을 번호 오름차순으로 멱등 적용.
 * - 각 마이그레이션은 단일 트랜잭션으로 실행.
 * - 실패 시 롤백 (better-sqlite3 동기 트랜잭션).
 *
 * SPEC §5 마이그레이션 러너 의사코드 구현.
 */
export function runMigrations(
  db: Database.Database,
  kind: DbKind,
  appVersion: string,
  embedDim: number,
): void {
  // schema_version 부트스트랩
  createSchemaVersion(db)

  const row = db.prepare(
    'SELECT version FROM schema_version WHERE id = 1',
  ).get() as { version: number } | undefined

  let current = row?.version ?? 0

  const pending = MIGRATIONS
    .filter((m) => (m.kind === kind || m.kind === 'both') && m.version > current)
    .sort((a, b) => a.version - b.version)

  for (const m of pending) {
    const tx = db.transaction(() => {
      m.up(db, embedDim)

      db.prepare(`
        INSERT INTO schema_version (id, version, applied_at, app_version, migrated_from)
        VALUES (1, @v, @t, @a, @from)
        ON CONFLICT(id) DO UPDATE SET
          version = @v,
          applied_at = @t,
          app_version = @a,
          migrated_from = @from
      `).run({
        v: m.version,
        t: Date.now(),
        a: appVersion,
        from: current,
      })
    })

    tx()
    current = m.version
  }
}

/**
 * 단일 마이그레이션을 트랜잭션 안에서 실행하고
 * schema_version 테이블에 버전·적용 시각을 INSERT/UPSERT한다.
 *
 * Sub-AC 6.3.1: 단독 export로 단위 테스트 가능.
 * - 트랜잭션 커밋 후 schema_version 행 존재 확인.
 * - 실패 시 자동 롤백 (better-sqlite3 동기 트랜잭션).
 *
 * @param db           better-sqlite3 DB 인스턴스
 * @param migration    적용할 Migration 객체
 * @param appVersion   app_version 문자열 (schema_version 행에 기록)
 * @param embedDim     벡터 차원 (vec_embeddings DDL 생성 시 사용)
 * @param currentVersion 이미 적용된 최신 버전 (migrated_from에 기록)
 */
export function applyMigration(
  db: Database.Database,
  migration: Migration,
  appVersion: string = '0.0.0',
  embedDim: number = 1024,
  currentVersion: number = 0,
): void {
  ensureSchemaVersionTable(db)

  const tx = db.transaction(() => {
    migration.up(db, embedDim)

    db.prepare(`
      INSERT INTO schema_version (id, version, applied_at, app_version, migrated_from)
      VALUES (1, @v, @t, @a, @from)
      ON CONFLICT(id) DO UPDATE SET
        version      = @v,
        applied_at   = @t,
        app_version  = @a,
        migrated_from = @from
    `).run({
      v: migration.version,
      t: Date.now(),
      a: appVersion,
      from: currentVersion,
    })
  })

  tx()
}

/**
 * 현재 DB 스키마 버전을 조회한다.
 * schema_version 테이블이 없으면 0을 반환.
 */
export function getSchemaVersion(db: Database.Database): number {
  try {
    const row = db.prepare(
      'SELECT version FROM schema_version WHERE id = 1',
    ).get() as { version: number } | undefined
    return row?.version ?? 0
  } catch {
    return 0
  }
}

/**
 * schema_version 테이블에서 이미 적용된 마이그레이션 버전 목록을 반환한다.
 *
 * SPEC §5: schema_version은 단일행(id=1)으로 현재 최신 버전을 보유한다.
 * 마이그레이션은 번호 오름차순으로 순차 적용되므로,
 * 버전 N이 적용됐다면 1..N 모든 버전이 적용된 것이다.
 *
 * Sub-AC 6.2: 빈 테이블(미적용)과 일부 적용 상태 양쪽을 반환 가능.
 *
 * @param db better-sqlite3 DB 인스턴스
 * @returns 적용된 버전 번호 배열 (오름차순). 미적용이면 빈 배열.
 */
export function getAppliedMigrations(db: Database.Database): number[] {
  try {
    const row = db.prepare(
      'SELECT version FROM schema_version WHERE id = 1',
    ).get() as { version: number } | undefined

    const current = row?.version ?? 0
    if (current <= 0) return []

    // 1..current 순차 배열 반환 (순차 마이그레이션 불변: N 적용 = 1..N 전부 적용)
    return Array.from({ length: current }, (_, i) => i + 1)
  } catch {
    // schema_version 테이블 자체가 없는 경우 (초기 상태)
    return []
  }
}
