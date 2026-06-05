/**
 * tests/storage-layer-attach-op-main-sub-ac-9b-3.test.ts
 *
 * Sub-AC 9b-3: ATTACH 완료 후 op_main.vec_embeddings 테이블을
 * SELECT 쿼리로 조회할 수 있음을 검증하는 단일 테스트.
 *
 * 픽스처: 임시 op DB에 vec_embeddings 가상 테이블과 샘플 행을 미리 삽입.
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

const EMBED_DIM = 4 // 테스트용 소형 차원

function makeTmpDir(): { dir: string; opPath: string; evalPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loopbreaker-9b3-'))
  return {
    dir,
    opPath: join(dir, 'op.db'),
    evalPath: join(dir, 'eval.db'),
  }
}

/**
 * float32 배열을 sqlite-vec이 기대하는 little-endian Buffer로 직렬화한다.
 */
function float32ToBuffer(values: number[]): Buffer {
  const buf = Buffer.allocUnsafe(values.length * 4)
  for (let i = 0; i < values.length; i++) {
    buf.writeFloatLE(values[i], i * 4)
  }
  return buf
}

/**
 * 임시 op DB 픽스처를 생성한다.
 * - sqlite-vec 확장을 로드한 뒤 vec_embeddings 가상 테이블을 생성하고
 *   샘플 행 2건을 삽입한다.
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

  // vec_embeddings 가상 테이블 생성 (EMBED_DIM 차원)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
      embedding float[${EMBED_DIM}]
    )
  `)

  // 샘플 행 2건 삽입
  // sqlite-vec vec0는 auto-rowid INSERT만 지원한다.
  // 명시적 rowid 바인딩(named/positional)은 "Only integers are allowed" 에러를 낸다.
  const insert = db.prepare('INSERT INTO vec_embeddings(embedding) VALUES (?)')

  insert.run(float32ToBuffer([0.1, 0.2, 0.3, 0.4]))
  insert.run(float32ToBuffer([0.5, 0.6, 0.7, 0.8]))

  db.close()
}

describe('StorageLayer.open() — op_main.vec_embeddings SELECT (Sub-AC 9b-3)', () => {
  let dir: string
  let opPath: string
  let evalPath: string
  let layer: StorageLayer

  beforeEach(() => {
    ;({ dir, opPath, evalPath } = makeTmpDir())
    // 픽스처 op DB(vec_embeddings 가상 테이블 + 샘플 행) 미리 생성
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

  test('ATTACH 후 op_main.vec_embeddings에서 샘플 행을 SELECT할 수 있다', () => {
    // StorageLayer.open()은 eval DB에 op_main ATTACH를 수행한다
    layer.open(opPath, evalPath, { embedDim: EMBED_DIM })

    // op_main.vec_embeddings 전체 조회
    const rows = layer.evalDb
      .prepare(
        'SELECT rowid FROM op_main.vec_embeddings ORDER BY rowid',
      )
      .all() as { rowid: number }[]

    // 픽스처에서 삽입한 2건이 조회되어야 한다
    expect(rows).toHaveLength(2)
    expect(rows[0].rowid).toBe(1)
    expect(rows[1].rowid).toBe(2)
  })

  test('ATTACH 후 op_main.vec_embeddings를 rowid 조건으로 단건 조회할 수 있다', () => {
    layer.open(opPath, evalPath, { embedDim: EMBED_DIM })

    const row = layer.evalDb
      .prepare('SELECT rowid FROM op_main.vec_embeddings WHERE rowid = 1')
      .get() as { rowid: number } | undefined

    expect(row).toBeTruthy()
    expect(row!.rowid).toBe(1)
  })

  test('op DB 파일이 OS read-only면 op_main.vec_embeddings INSERT가 차단된다', async () => {
    // 설계(사용자 결정): op_main read-only는 op DB 파일 OS 권한에 위임.
    // ⚠️ chmod 전에 op DB를 정식 마이그레이션 완료시켜야 한다(read-only면 open이 쓰기 실패).
    const seed = new StorageLayer()
    seed.open(opPath, undefined, { embedDim: EMBED_DIM })
    await seed.close()

    chmodSync(opPath, 0o444)
    try {
      const roLayer = new StorageLayer()
      roLayer.open(opPath, evalPath, { embedDim: EMBED_DIM })
      try {
        const embedding = float32ToBuffer([0.9, 0.8, 0.7, 0.6])
        expect(() => {
          roLayer.evalDb
            .prepare(
              'INSERT INTO op_main.vec_embeddings (rowid, embedding) VALUES (99, ?)',
            )
            .run(embedding)
        }).toThrow()
      } finally {
        await roLayer.close()
      }
    } finally {
      chmodSync(opPath, 0o644)
    }
  })

  test('op_main.vec_embeddings 테이블이 sqlite_master에 나타난다', () => {
    layer.open(opPath, evalPath, { embedDim: EMBED_DIM })

    // vec0 가상 테이블은 sqlite_master에 type='table'로 나타난다
    const row = layer.evalDb
      .prepare(
        "SELECT name FROM op_main.sqlite_master WHERE name='vec_embeddings'",
      )
      .get() as { name: string } | undefined

    expect(row).toBeTruthy()
    expect(row!.name).toBe('vec_embeddings')
  })
})
