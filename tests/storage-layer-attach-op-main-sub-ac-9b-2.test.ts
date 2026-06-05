/**
 * tests/storage-layer-attach-op-main-sub-ac-9b-2.test.ts
 *
 * Sub-AC 9b-2: ATTACH 완료 후 op_main.embeddings 테이블을 SELECT 쿼리로
 * 조회할 수 있음을 검증하는 단일 테스트.
 *
 * 픽스처: 임시 op DB에 embeddings 테이블과 샘플 행을 미리 삽입.
 *
 * 부수효과 0: 임시 tmpdir 파일 DB + 테스트 후 삭제.
 * 실경로 리터럴 없음.
 */

import { mkdtempSync, rmSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { StorageLayer } from '../src/storage/storage-layer.js'
import { loadSqliteVec } from '../src/storage/vec-loader.js'

interface EmbeddingsRow {
  rowid: number
  cache_key: string
  embed_text_hash: string
  embed_model_id: string
  dim: number
  created_at: number
  token_count: number | null
}

function makeTmpDir(): { dir: string; opPath: string; evalPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loopbreaker-9b2-'))
  return {
    dir,
    opPath: join(dir, 'op.db'),
    evalPath: join(dir, 'eval.db'),
  }
}

/**
 * 임시 op DB 픽스처를 생성한다.
 * - 전체 op 마이그레이션 대신, embeddings 테이블만 생성하고 샘플 행을 삽입한다.
 * - StorageLayer.open()에서 ATTACH 전에 op DB 파일이 존재해야 하므로
 *   StorageLayer를 사용하지 않고 직접 better-sqlite3로 초기화한다.
 */
function prepareOpDbFixture(opPath: string): void {
  const db = new Database(opPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  loadSqliteVec(db)

  // schema_version 부트스트랩 (runMigrations 없이 최소 픽스처)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      version       INTEGER NOT NULL,
      applied_at    INTEGER NOT NULL,
      app_version   TEXT    NOT NULL,
      migrated_from INTEGER
    )
  `)

  // embeddings 메타 테이블 생성
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

  // 샘플 행 2건 삽입
  const insert = db.prepare(`
    INSERT INTO embeddings (cache_key, embed_text_hash, embed_model_id, dim, created_at, token_count)
    VALUES (@cache_key, @embed_text_hash, @embed_model_id, @dim, @created_at, @token_count)
  `)

  insert.run({
    cache_key: 'sha256-abc123:model-embed-v1',
    embed_text_hash: 'abc123',
    embed_model_id: 'model-embed-v1',
    dim: 1024,
    created_at: 1_700_000_000_000,
    token_count: 42,
  })

  insert.run({
    cache_key: 'sha256-def456:model-embed-v1',
    embed_text_hash: 'def456',
    embed_model_id: 'model-embed-v1',
    dim: 1024,
    created_at: 1_700_000_001_000,
    token_count: null,
  })

  db.close()
}

describe('StorageLayer.open() — op_main.embeddings SELECT (Sub-AC 9b-2)', () => {
  let dir: string
  let opPath: string
  let evalPath: string
  let layer: StorageLayer

  beforeEach(() => {
    ;({ dir, opPath, evalPath } = makeTmpDir())
    // 픽스처 op DB(embeddings 테이블 + 샘플 행) 미리 생성
    prepareOpDbFixture(opPath)
    layer = new StorageLayer()
  })

  afterEach(async () => {
    try {
      await layer.close()
    } catch {
      /* ignore */
    }
    rmSync(dir, { recursive: true, force: true })
  })

  test('ATTACH 후 op_main.embeddings에서 샘플 행을 SELECT할 수 있다', () => {
    // StorageLayer.open()은 eval DB에 op_main ATTACH를 수행한다
    layer.open(opPath, evalPath, { embedDim: 1024 })

    // op_main.embeddings 전체 조회
    const rows = layer.evalDb
      .prepare('SELECT rowid, cache_key, embed_text_hash, embed_model_id, dim, created_at, token_count FROM op_main.embeddings ORDER BY rowid')
      .all() as EmbeddingsRow[]

    // 픽스처에서 삽입한 2건이 조회되어야 한다
    expect(rows).toHaveLength(2)

    // 첫 번째 행 검증
    expect(rows[0].cache_key).toBe('sha256-abc123:model-embed-v1')
    expect(rows[0].embed_text_hash).toBe('abc123')
    expect(rows[0].embed_model_id).toBe('model-embed-v1')
    expect(rows[0].dim).toBe(1024)
    expect(rows[0].token_count).toBe(42)

    // 두 번째 행 검증 (token_count NULL)
    expect(rows[1].cache_key).toBe('sha256-def456:model-embed-v1')
    expect(rows[1].embed_text_hash).toBe('def456')
    expect(rows[1].token_count).toBeNull()
  })

  test('ATTACH 후 op_main.embeddings를 WHERE 조건으로 필터링할 수 있다', () => {
    layer.open(opPath, evalPath, { embedDim: 1024 })

    const row = layer.evalDb
      .prepare(
        "SELECT cache_key, dim FROM op_main.embeddings WHERE embed_text_hash = 'abc123'",
      )
      .get() as { cache_key: string; dim: number } | undefined

    expect(row).toBeTruthy()
    expect(row!.cache_key).toBe('sha256-abc123:model-embed-v1')
    expect(row!.dim).toBe(1024)
  })

  test('op DB 파일이 OS read-only면 op_main.embeddings INSERT가 차단된다', async () => {
    // 설계(사용자 결정): op_main read-only는 op DB 파일 OS 권한에 위임.
    // ⚠️ chmod 전에 op DB를 정식 마이그레이션 완료시켜야 한다 —
    //   read-only 상태에서 layer.open이 op DB에 runMigrations(쓰기)를 시도하면 실패하므로.
    const seed = new StorageLayer()
    seed.open(opPath, undefined, { embedDim: 1024 })
    await seed.close()

    // op DB 파일을 read-only로 만들면 일반 ATTACH라도 SQLITE_READONLY를 던진다.
    chmodSync(opPath, 0o444)
    try {
      const roLayer = new StorageLayer()
      roLayer.open(opPath, evalPath, { embedDim: 1024 })
      try {
        expect(() => {
          roLayer.evalDb
            .prepare(
              `INSERT INTO op_main.embeddings (cache_key, embed_text_hash, embed_model_id, dim, created_at)
               VALUES ('new-key', 'newhash', 'model-v1', 512, 0)`,
            )
            .run()
        }).toThrow()
      } finally {
        await roLayer.close()
      }
    } finally {
      chmodSync(opPath, 0o644)
    }
  })
})
