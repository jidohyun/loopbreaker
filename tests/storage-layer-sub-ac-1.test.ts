/**
 * tests/storage-layer-sub-ac-1.test.ts
 *
 * Sub-AC 1: StorageLayer.open() — WAL·synchronous=NORMAL·foreign_keys=ON·
 *            busy_timeout 5000·temp_store=MEMORY PRAGMA 적용 검증.
 *
 * 임시 경로 DB를 사용. 실제 네트워크·OS알림·~/.loopbreaker 접근 0.
 * op DB는 sqlite-vec 로드가 필요하므로 tmpdir 파일 DB를 사용.
 */

import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StorageLayer } from '../src/storage/storage-layer.js'

/** 임시 디렉토리와 DB 경로를 생성한다. */
function makeTmpDir(): { dir: string; opPath: string; evalPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loopbreaker-m5-ac1-'))
  return {
    dir,
    opPath: join(dir, 'op.db'),
    evalPath: join(dir, 'eval.db'),
  }
}

/** pragma 쿼리 결과에서 값을 추출한다 (better-sqlite3 반환 형식) */
function pragmaValue(db: Database.Database, name: string): string | number {
  const rows = db.pragma(name) as Record<string, string | number>[]
  if (!rows || rows.length === 0) throw new Error(`PRAGMA ${name} returned empty`)
  const row = rows[0]!
  // better-sqlite3 pragma() returns an object keyed by the pragma name
  const key = Object.keys(row)[0]!
  return row[key]!
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StorageLayer.open() — PRAGMA 적용 (Sub-AC 1)', () => {
  let dir: string
  let opPath: string
  let evalPath: string
  let layer: StorageLayer

  beforeEach(() => {
    ({ dir, opPath, evalPath } = makeTmpDir())
    layer = new StorageLayer()
  })

  afterEach(async () => {
    // close가 아직 안 됐으면 닫기
    try { await layer.close() } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true })
  })

  // ── op DB PRAGMA 검증 ──────────────────────────────────────────────────

  test('op DB: journal_mode = wal', () => {
    layer.open(opPath, undefined, { embedDim: 1024 })
    expect(pragmaValue(layer.opDb, 'journal_mode')).toBe('wal')
  })

  test('op DB: synchronous = 1 (NORMAL)', () => {
    layer.open(opPath, undefined, { embedDim: 1024 })
    // NORMAL = 1 in SQLite numeric representation
    expect(pragmaValue(layer.opDb, 'synchronous')).toBe(1)
  })

  test('op DB: foreign_keys = 1 (ON)', () => {
    layer.open(opPath, undefined, { embedDim: 1024 })
    expect(pragmaValue(layer.opDb, 'foreign_keys')).toBe(1)
  })

  test('op DB: busy_timeout = 5000', () => {
    layer.open(opPath, undefined, { embedDim: 1024, busyTimeout: 5000 })
    expect(pragmaValue(layer.opDb, 'busy_timeout')).toBe(5000)
  })

  test('op DB: temp_store = 2 (MEMORY)', () => {
    layer.open(opPath, undefined, { embedDim: 1024 })
    // MEMORY = 2 in SQLite numeric representation
    expect(pragmaValue(layer.opDb, 'temp_store')).toBe(2)
  })

  // ── eval DB PRAGMA 검증 ────────────────────────────────────────────────

  test('eval DB: journal_mode = wal', () => {
    layer.open(opPath, evalPath, { embedDim: 1024 })
    expect(pragmaValue(layer.evalDb, 'journal_mode')).toBe('wal')
  })

  test('eval DB: synchronous = 1 (NORMAL)', () => {
    layer.open(opPath, evalPath, { embedDim: 1024 })
    expect(pragmaValue(layer.evalDb, 'synchronous')).toBe(1)
  })

  test('eval DB: foreign_keys = 1 (ON)', () => {
    layer.open(opPath, evalPath, { embedDim: 1024 })
    expect(pragmaValue(layer.evalDb, 'foreign_keys')).toBe(1)
  })

  test('eval DB: busy_timeout = 5000', () => {
    layer.open(opPath, evalPath, { embedDim: 1024, busyTimeout: 5000 })
    expect(pragmaValue(layer.evalDb, 'busy_timeout')).toBe(5000)
  })

  test('eval DB: temp_store = 2 (MEMORY)', () => {
    layer.open(opPath, evalPath, { embedDim: 1024 })
    expect(pragmaValue(layer.evalDb, 'temp_store')).toBe(2)
  })

  // ── 기본값 확인 (busyTimeout 미지정 = 5000) ───────────────────────────

  test('busyTimeout 미지정 시 기본값 5000이 적용된다', () => {
    layer.open(opPath, undefined, { embedDim: 1024 }) // busyTimeout 생략
    expect(pragmaValue(layer.opDb, 'busy_timeout')).toBe(5000)
  })

  // ── 커스텀 busyTimeout 검증 ────────────────────────────────────────────

  test('busyTimeout을 3000으로 설정하면 3000이 반환된다', () => {
    layer.open(opPath, undefined, { embedDim: 1024, busyTimeout: 3000 })
    expect(pragmaValue(layer.opDb, 'busy_timeout')).toBe(3000)
  })

  // ── 모든 PRAGMA 동시 검증 (one-shot) ─────────────────────────────────

  test('op DB: 5개 PRAGMA를 모두 한 번에 검증한다', () => {
    layer.open(opPath, undefined, { embedDim: 1024, busyTimeout: 5000 })
    const db = layer.opDb

    expect(pragmaValue(db, 'journal_mode')).toBe('wal')
    expect(pragmaValue(db, 'synchronous')).toBe(1)
    expect(pragmaValue(db, 'foreign_keys')).toBe(1)
    expect(pragmaValue(db, 'busy_timeout')).toBe(5000)
    expect(pragmaValue(db, 'temp_store')).toBe(2)
  })

  test('eval DB: 5개 PRAGMA를 모두 한 번에 검증한다', () => {
    layer.open(opPath, evalPath, { embedDim: 1024, busyTimeout: 5000 })
    const db = layer.evalDb

    expect(pragmaValue(db, 'journal_mode')).toBe('wal')
    expect(pragmaValue(db, 'synchronous')).toBe(1)
    expect(pragmaValue(db, 'foreign_keys')).toBe(1)
    expect(pragmaValue(db, 'busy_timeout')).toBe(5000)
    expect(pragmaValue(db, 'temp_store')).toBe(2)
  })

  // ── open() 전 접근 시 에러 ────────────────────────────────────────────

  test('open() 전 opDb에 접근하면 에러가 발생한다', () => {
    expect(() => layer.opDb).toThrow('StorageLayer')
  })

  test('open() 전 evalDb에 접근하면 에러가 발생한다', () => {
    expect(() => layer.evalDb).toThrow('StorageLayer')
  })

  test('evalPath 미지정 시 hasEvalDb = false', () => {
    layer.open(opPath, undefined, { embedDim: 1024 })
    expect(layer.hasEvalDb).toBe(false)
  })

  test('evalPath 지정 시 hasEvalDb = true', () => {
    layer.open(opPath, evalPath, { embedDim: 1024 })
    expect(layer.hasEvalDb).toBe(true)
  })
})
