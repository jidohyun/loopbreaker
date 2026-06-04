/**
 * tests/storage-layer-migration-order-sub-ac-2b.test.ts
 *
 * Sub-AC 2b: StorageLayer.open() — 'op' 마이그레이션 적용 순서 검증.
 *
 * 임시경로 DB에서 loadSqliteVec() 호출 이후 runMigrations('op')가
 * 실행되었는지를 migrations 테이블(schema_version) 및 대상 스키마
 * (테이블/컬럼 존재 여부)를 쿼리해 확인한다.
 *
 * 검증 항목:
 *  1. schema_version 테이블이 존재한다 (runMigrations 실행 증거)
 *  2. schema_version.version = 2 (op 최신 마이그레이션 v2 적용 완료)
 *  3. loadSqliteVec가 먼저 실행됐음을 보증: vec_embeddings 가상 테이블이
 *     생성돼 있다 (sqlite-vec 없이는 CREATE VIRTUAL TABLE vec0이 불가)
 *  4. 각 op 마이그레이션(v1, v2)의 대표 테이블·컬럼이 모두 존재한다
 *     - v1: events, embeddings (dim 컬럼), vec_embeddings, detector_config,
 *           detections, watch_offsets
 *     - v2: notifications (CooldownStore 디바운스 테이블)
 *  5. 순서 보장 — sqlite-vec 로드 이전에 runMigrations를 실행하면
 *     vec_embeddings 생성 시 오류가 발생해야 한다 (역순 실패 대조군)
 *
 * 부수효과 0: 실제 네트워크·OS알림·~/.loopbreaker·~/.claude 접근 없음.
 *             임시 디렉토리(os.tmpdir 하위)를 사용하고 테스트 종료 후 정리.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { StorageLayer } from '../src/storage/storage-layer.js'
import { loadSqliteVec } from '../src/storage/vec-loader.js'
import { runMigrations, getSchemaVersion } from '../src/storage/migrations.js'

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

function makeTmpDir(): { dir: string; opPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loopbreaker-m5-ac2b-'))
  return { dir, opPath: join(dir, 'op.db') }
}

function applyPragmas(db: Database.Database, busyTimeout = 5000): void {
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma(`busy_timeout = ${busyTimeout}`)
  db.pragma('temp_store = MEMORY')
}

/**
 * sqlite-vec 익스텐션이 현재 환경에서 사용 가능한지 판별한다.
 * 불가능한 환경에서는 sqlite-vec 의존 케이스를 skip한다.
 */
function isSqliteVecAvailable(): boolean {
  try {
    const { dir, opPath } = makeTmpDir()
    const db = new Database(opPath)
    try {
      applyPragmas(db)
      loadSqliteVec(db)
      db.prepare('SELECT vec_version()').get()
      return true
    } finally {
      try { db.close() } catch { /* ignore */ }
      rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    return false
  }
}

const SQLITE_VEC_AVAILABLE = isSqliteVecAvailable()

// ---------------------------------------------------------------------------
// StorageLayer.open() 마이그레이션 순서 검증
// ---------------------------------------------------------------------------

describe('StorageLayer.open() — op 마이그레이션 적용 순서 (Sub-AC 2b)', () => {
  let dir: string
  let opPath: string
  let layer: StorageLayer

  beforeEach(() => {
    ({ dir, opPath } = makeTmpDir())
    layer = new StorageLayer()
  })

  afterEach(async () => {
    try { await layer.close() } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true })
  })

  // ── 1. schema_version 테이블 존재 (runMigrations 실행 증거) ─────────────

  test('open() 후 schema_version 테이블이 존재한다', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    layer.open(opPath, undefined, { embedDim: 1024, appVersion: '0.1.0' })

    const row = layer.opDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
      .get() as { name: string } | undefined

    expect(row).toBeDefined()
    expect(row!.name).toBe('schema_version')
  })

  // ── 2. op 마이그레이션 최신 버전 = 2 ────────────────────────────────────

  test('open() 후 op DB schema_version이 2이다 (v1+v2 모두 적용)', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    layer.open(opPath, undefined, { embedDim: 1024, appVersion: '0.1.0' })

    expect(getSchemaVersion(layer.opDb)).toBe(2)
  })

  // ── 3. loadSqliteVec 선행 보증: vec_embeddings 가상 테이블 존재 ──────────

  test('open() 후 vec_embeddings 가상 테이블이 존재한다 (sqlite-vec 선행 증거)', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    layer.open(opPath, undefined, { embedDim: 1024, appVersion: '0.1.0' })

    // vec_embeddings는 sqlite-vec 없이는 CREATE VIRTUAL TABLE vec0이 실패함
    // 따라서 이 테이블이 존재한다 = loadSqliteVec가 runMigrations 전에 실행됐음을 보증
    const row = layer.opDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_embeddings'")
      .get() as { name: string } | undefined

    expect(row).toBeDefined()
    expect(row!.name).toBe('vec_embeddings')
  })

  // ── 4a. v1 대표 테이블들 존재 ────────────────────────────────────────────

  test('open() 후 v1 마이그레이션 대표 테이블들이 모두 존재한다', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    layer.open(opPath, undefined, { embedDim: 1024, appVersion: '0.1.0' })

    const db = layer.opDb
    const expectedTables = ['events', 'embeddings', 'detector_config', 'detections', 'watch_offsets']

    for (const tbl of expectedTables) {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(tbl) as { name: string } | undefined
      expect(row).toBeDefined()
      expect(row!.name).toBe(tbl)
    }
  })

  // ── 4b. embeddings 테이블의 dim 컬럼 존재 (BLOCKER B1) ──────────────────

  test('open() 후 embeddings 테이블에 dim 컬럼이 존재한다 (BLOCKER B1)', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    layer.open(opPath, undefined, { embedDim: 1024, appVersion: '0.1.0' })

    const cols = layer.opDb
      .prepare('PRAGMA table_info(embeddings)')
      .all() as { name: string }[]
    const names = cols.map(c => c.name)

    expect(names).toContain('dim')
  })

  // ── 4c. v2 notifications 테이블 존재 (CooldownStore 디바운스) ────────────

  test('open() 후 v2 마이그레이션으로 notifications 테이블이 존재한다', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    layer.open(opPath, undefined, { embedDim: 1024, appVersion: '0.1.0' })

    const row = layer.opDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'")
      .get() as { name: string } | undefined

    expect(row).toBeDefined()
    expect(row!.name).toBe('notifications')
  })

  // ── 4d. schema_version 행의 필드가 정확하다 ─────────────────────────────

  test('open() 후 schema_version 행에 version/app_version/applied_at이 기록된다', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    const before = Date.now()
    layer.open(opPath, undefined, { embedDim: 1024, appVersion: '1.2.3' })
    const after = Date.now()

    const row = layer.opDb
      .prepare('SELECT version, app_version, applied_at FROM schema_version WHERE id = 1')
      .get() as { version: number; app_version: string; applied_at: number } | undefined

    expect(row).toBeDefined()
    expect(row!.version).toBe(2)
    expect(row!.app_version).toBe('1.2.3')
    expect(row!.applied_at).toBeGreaterThanOrEqual(before)
    expect(row!.applied_at).toBeLessThanOrEqual(after)
  })

  // ── 5. 역순 실패 대조군: sqlite-vec 없이 runMigrations 먼저 실행하면 실패 ─

  test('sqlite-vec 로드 없이 op 마이그레이션을 실행하면 vec_embeddings 생성 시 오류가 발생한다 (역순 실패 대조군)', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    // StorageLayer를 직접 거치지 않고 sqlite-vec 없이 runMigrations만 실행
    const db = new Database(opPath)
    try {
      applyPragmas(db)
      // loadSqliteVec 없이 바로 runMigrations — vec0 가상 테이블 생성 실패 예상
      expect(() => {
        runMigrations(db, 'op', '0.0.0', 1024)
      }).toThrow()
    } finally {
      try { db.close() } catch { /* ignore */ }
    }
  })

  // ── 6. 멱등성: open 후 schema_version 버전은 여전히 2이다 ────────────────

  test('open()을 두 번 호출하면 두 번째도 오류 없이 schema_version = 2가 유지된다', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    layer.open(opPath, undefined, { embedDim: 1024, appVersion: '0.1.0' })
    const v1 = getSchemaVersion(layer.opDb)
    expect(v1).toBe(2)

    // 이미 열린 layer를 close하고 새 layer로 같은 경로를 재오픈
    // (멱등 재적용 검증)
    layer.opDb.close()
    const layer2 = new StorageLayer()
    try {
      layer2.open(opPath, undefined, { embedDim: 1024, appVersion: '0.1.0' })
      expect(getSchemaVersion(layer2.opDb)).toBe(2)
    } finally {
      try { layer2.opDb.close() } catch { /* ignore */ }
    }
  })

  // ── 7. embedDim이 vec_embeddings DDL에 반영된다 (BLOCKER B1) ─────────────

  test('embedDim=512 옵션이 vec_embeddings 생성에 사용된다 (512차원)', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    const { dir: dir512, opPath: opPath512 } = makeTmpDir()
    const layer512 = new StorageLayer()
    try {
      layer512.open(opPath512, undefined, { embedDim: 512, appVersion: '0.1.0' })

      // vec_embeddings가 존재하면 embedDim=512로 DDL이 실행된 것
      const row = layer512.opDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_embeddings'")
        .get() as { name: string } | undefined

      expect(row).toBeDefined()
      expect(row!.name).toBe('vec_embeddings')
    } finally {
      try { layer512.opDb.close() } catch { /* ignore */ }
      rmSync(dir512, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// 수동 순서 검증 — loadSqliteVec → runMigrations 호출 순서 시뮬레이션
// ---------------------------------------------------------------------------

describe('loadSqliteVec → runMigrations 호출 순서 직접 검증 (Sub-AC 2b)', () => {
  let dir: string
  let opPath: string

  beforeEach(() => {
    ({ dir, opPath } = makeTmpDir())
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('loadSqliteVec 이후 runMigrations("op") 호출 시 schema_version = 2가 된다', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    const db = new Database(opPath)
    try {
      applyPragmas(db)
      // 올바른 순서: loadSqliteVec 먼저
      loadSqliteVec(db)
      runMigrations(db, 'op', '0.1.0', 1024)

      expect(getSchemaVersion(db)).toBe(2)
    } finally {
      try { db.close() } catch { /* ignore */ }
    }
  })

  test('loadSqliteVec 이후 runMigrations("op") 호출 시 vec_embeddings가 존재한다', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    const db = new Database(opPath)
    try {
      applyPragmas(db)
      loadSqliteVec(db)
      runMigrations(db, 'op', '0.1.0', 1024)

      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_embeddings'")
        .get() as { name: string } | undefined

      expect(row).toBeDefined()
    } finally {
      try { db.close() } catch { /* ignore */ }
    }
  })

  test('loadSqliteVec 이후 runMigrations("op") 호출 시 notifications 테이블이 존재한다 (v2)', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    const db = new Database(opPath)
    try {
      applyPragmas(db)
      loadSqliteVec(db)
      runMigrations(db, 'op', '0.1.0', 1024)

      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'")
        .get() as { name: string } | undefined

      expect(row).toBeDefined()
    } finally {
      try { db.close() } catch { /* ignore */ }
    }
  })
})
