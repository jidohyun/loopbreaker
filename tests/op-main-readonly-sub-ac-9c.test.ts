// tests/op-main-readonly-sub-ac-9c.test.ts
// Sub-AC 9c: op_main ATTACH 경로에서 쓰기(INSERT/UPDATE/DELETE) 시도 시
// 오류가 발생함을 검증하는 단일 테스트.
//
// StorageLayer.open()은 eval DB에 op DB를 op_main 스키마로 ATTACH한다.
// op_main read-only 격리는 op DB 파일의 OS 권한에 위임한다(사용자 결정):
//   better-sqlite3는 file: URI ATTACH·schema 단위 read-only를 지원하지 않고,
//   connection 단위 query_only는 eval DB 본체 쓰기까지 막으므로 둘 다 불가.
//   따라서 op DB 파일을 0o444로 만들면 일반 ATTACH라도 SQLITE_READONLY를 던진다.
// 이 테스트는 그 보호가 실제로 동작함을 보장한다.

import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { StorageLayer } from '../src/storage/storage-layer.js'

let _seq = 0
function makeTempPath(suffix: string): string {
  _seq += 1
  return path.join(os.tmpdir(), `lb-sub-ac-9c-${_seq}${suffix}`)
}

describe('Sub-AC 9c — op_main ATTACH read-only 쓰기 차단', () => {
  let opPath: string
  let evalPath: string
  let layer: StorageLayer

  beforeEach(async () => {
    opPath = makeTempPath('.op.db')
    evalPath = makeTempPath('.eval.db')

    // op DB를 정식 마이그레이션 완료시킨 뒤 닫는다(read-only면 open이 쓰기 실패하므로).
    const seed = new StorageLayer()
    seed.open(opPath, undefined, { embedDim: 64 })
    await seed.close()

    // op DB 파일을 OS read-only로 만들어 op_main 쓰기를 SQLITE_READONLY로 차단.
    fs.chmodSync(opPath, 0o444)

    layer = new StorageLayer()
    layer.open(opPath, evalPath, { embedDim: 64 })
  })

  afterEach(async () => {
    await layer.close()
    try { fs.chmodSync(opPath, 0o644) } catch { /* ignore */ }
    for (const p of [opPath, evalPath, `${opPath}-wal`, `${opPath}-shm`, `${evalPath}-wal`, `${evalPath}-shm`]) {
      try { fs.unlinkSync(p) } catch { /* ignore */ }
    }
  })

  test('op_main.events에 INSERT 시도 시 오류가 발생한다', () => {
    const evalDb = layer.evalDb
    expect(() => {
      evalDb.prepare(
        `INSERT INTO op_main.events
           (uuid, session_id, ts, kind, tool, input_json, result_class, cwd, agent_scope, is_sidechain, byte_offset)
         VALUES ('uuid-test', 'sess-test', 1000, 'tool_use', 'Read', '{}', 'success', '/tmp', 'root', 0, 0)`
      ).run()
    }).toThrow()
  })

  test('op_main.events에 UPDATE 시도 시 오류가 발생한다', () => {
    const evalDb = layer.evalDb
    expect(() => {
      evalDb.prepare(
        `UPDATE op_main.events SET result_class = 'error' WHERE uuid = 'nonexistent-uuid'`
      ).run()
    }).toThrow()
  })

  test('op_main.events에 DELETE 시도 시 오류가 발생한다', () => {
    const evalDb = layer.evalDb
    expect(() => {
      evalDb.prepare(
        `DELETE FROM op_main.events WHERE uuid = 'nonexistent-uuid'`
      ).run()
    }).toThrow()
  })

})
