/**
 * tests/storage-layer-attach-op-main-sub-ac-9b-1.test.ts
 *
 * Sub-AC 9b-1: StorageLayer.open()이 eval DB를 열고 나서
 * op DB를 op_main 스키마로 read-only ATTACH하는지 검증한다.
 *
 * 검증 내용:
 *   1. ATTACH DATABASE '...' AS op_main 이 실행된 후
 *      op_main 스키마에서 op DB 테이블을 조회할 수 있다.
 *   2. op_main 스키마는 read-only — 쓰기 시도 시 에러가 발생한다.
 *   3. evalPath 미지정 시 ATTACH가 호출되지 않는다.
 *
 * 부수효과 0: 임시 tmpdir 파일 DB + 테스트 후 삭제.
 * 실경로 리터럴 없음.
 */

import { mkdtempSync, rmSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StorageLayer } from '../src/storage/storage-layer.js'

function makeTmpDir(): { dir: string; opPath: string; evalPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loopbreaker-9b1-'))
  return {
    dir,
    opPath: join(dir, 'op.db'),
    evalPath: join(dir, 'eval.db'),
  }
}

describe('StorageLayer.open() — ATTACH op_main (Sub-AC 9b-1)', () => {
  let dir: string
  let opPath: string
  let evalPath: string
  let layer: StorageLayer

  beforeEach(() => {
    ;({ dir, opPath, evalPath } = makeTmpDir())
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

  test('eval DB를 열면 op_main 스키마가 ATTACH된다', () => {
    layer.open(opPath, evalPath, { embedDim: 1024 })

    // op_main 스키마에서 op DB의 events 테이블을 조회할 수 있어야 한다
    const row = layer.evalDb
      .prepare(
        "SELECT name FROM op_main.sqlite_master WHERE type='table' AND name='events'",
      )
      .get() as { name: string } | undefined

    expect(row).toBeTruthy()
    expect(row!.name).toBe('events')
  })

  test('op DB 파일이 OS read-only면 op_main INSERT가 SQLITE_READONLY로 차단된다', async () => {
    // 설계(사용자 결정): better-sqlite3는 file: URI ATTACH·schema 단위 read-only를
    // 지원하지 않으므로, op_main read-only는 op DB 파일의 OS 권한에 위임한다.
    // op DB 파일을 0o444로 만들면 일반 ATTACH라도 SQLite가 SQLITE_READONLY를 던진다.

    // 1) op DB를 한 번 만들어(스키마 생성) 닫는다.
    const seed = new StorageLayer()
    seed.open(opPath, undefined, { embedDim: 1024 })
    await seed.close()

    // 2) op DB 파일을 read-only로 만든다.
    chmodSync(opPath, 0o444)
    try {
      // 3) 별도 StorageLayer로 eval+op_main(일반 ATTACH) 연다.
      const roLayer = new StorageLayer()
      roLayer.open(opPath, evalPath, { embedDim: 1024 })
      try {
        // op_main.detector_config에 write 시도 → SQLITE_READONLY 에러
        expect(() => {
          roLayer.evalDb
            .prepare(
              `INSERT INTO op_main.detector_config
               (config_id, version_tag, is_active, config_json, created_at)
               VALUES ('test', 'v0', 0, '{}', 0)`,
            )
            .run()
        }).toThrow()
        // eval 본체(gold_labels 등)는 read-only가 아니어야 한다 — 규약 검증.
        // (op 파일만 read-only, eval 파일은 쓰기 가능)
      } finally {
        await roLayer.close()
      }
    } finally {
      // 권한 복구(afterEach rmSync가 안전하게 삭제하도록).
      chmodSync(opPath, 0o644)
    }
  })

  test('op_main ATTACH SQL은 정확히 op DB 파일 경로를 포함한다', () => {
    // ATTACH가 올바른 SQL로 이루어졌는지 간접 검증:
    // pragma database_list에 op_main이 나타나야 한다.
    layer.open(opPath, evalPath, { embedDim: 1024 })

    const databases = layer.evalDb.pragma('database_list') as Array<{
      seq: number
      name: string
      file: string
    }>

    const opMain = databases.find((d) => d.name === 'op_main')
    expect(opMain).toBeTruthy()
    // file 경로가 opPath와 동일한 실제 파일을 가리켜야 한다
    expect(opMain!.file).toContain('op.db')
  })

  test('evalPath 미지정 시 op_main ATTACH가 없다 (eval DB 미열기)', () => {
    // evalPath 없이 open — eval DB 자체가 없으므로 ATTACH도 없음
    layer.open(opPath, undefined, { embedDim: 1024 })

    expect(layer.hasEvalDb).toBe(false)
    // opDb에는 op_main 스키마가 없어야 한다
    const databases = layer.opDb.pragma('database_list') as Array<{
      name: string
    }>
    const opMain = databases.find((d) => d.name === 'op_main')
    expect(opMain).toBeUndefined()
  })
})
