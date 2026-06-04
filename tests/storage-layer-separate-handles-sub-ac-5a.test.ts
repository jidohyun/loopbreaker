/**
 * tests/storage-layer-separate-handles-sub-ac-5a.test.ts
 *
 * Sub-AC 5a: ops 핸들과 eval 핸들이 별도 DB 인스턴스를 참조하는지 검증.
 *
 * in-memory DB 두 개를 생성하고 StorageLayer를 통해 ops 핸들과 eval 핸들을
 * 각각 획득한 뒤, 두 핸들의 내부 db 참조(파일경로/식별자)가 서로 다른 객체임을
 * 단언(assert)한다.
 *
 * 부수효과 0: 실제 ~/.loopbreaker, 네트워크, OS알림 접근 없음.
 * sqlite-vec 로드는 op DB에 필요하므로 tmpdir 파일 DB를 사용한다
 * (:memory: 는 WAL/sqlite-vec 한계가 있음).
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StorageLayer } from '../src/storage/storage-layer.js'

/** 임시 디렉토리와 DB 경로들을 반환한다. */
function makeTmpDir(): { dir: string; opPath: string; evalPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loopbreaker-m5-ac5a-'))
  return {
    dir,
    opPath: join(dir, 'op.db'),
    evalPath: join(dir, 'eval.db'),
  }
}

describe('StorageLayer — ops/eval 핸들이 별도 DB 인스턴스를 참조한다 (Sub-AC 5a)', () => {
  let dir: string
  let opPath: string
  let evalPath: string
  let layer: StorageLayer

  beforeEach(() => {
    ({ dir, opPath, evalPath } = makeTmpDir())
    layer = new StorageLayer()
  })

  afterEach(async () => {
    await layer.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('opDb와 evalDb는 서로 다른 DB 객체 인스턴스이다', () => {
    layer.open(opPath, evalPath)

    const opHandle = layer.opDb
    const evalHandle = layer.evalDb

    // 두 핸들은 서로 다른 객체 참조여야 한다
    expect(opHandle).not.toBe(evalHandle)
  })

  test('opDb와 evalDb는 서로 다른 파일 경로를 가진다', () => {
    layer.open(opPath, evalPath)

    const opHandle = layer.opDb
    const evalHandle = layer.evalDb

    // better-sqlite3 Database 인스턴스의 name 속성은 파일 경로를 반환한다
    expect((opHandle as unknown as { name: string }).name).toBe(opPath)
    expect((evalHandle as unknown as { name: string }).name).toBe(evalPath)
    expect((opHandle as unknown as { name: string }).name).not.toBe(
      (evalHandle as unknown as { name: string }).name,
    )
  })

  test('opDb에 쓴 데이터가 evalDb에 영향을 미치지 않는다 (격리 확인)', () => {
    layer.open(opPath, evalPath)

    const opHandle = layer.opDb
    const evalHandle = layer.evalDb

    // op DB에 임시 테이블 생성 후 row 삽입
    opHandle.exec('CREATE TABLE IF NOT EXISTS _test_isolation (val TEXT)')
    opHandle.prepare('INSERT INTO _test_isolation VALUES (?)').run('hello')

    // eval DB에서 같은 테이블 조회 시 존재하지 않아야 한다
    const evalTables = evalHandle
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_test_isolation'")
      .all() as { name: string }[]

    expect(evalTables).toHaveLength(0)
  })

  test('evalDb 없이 open하면 hasEvalDb가 false이고 opDb는 정상 접근된다', () => {
    // evalPath 없이 op만 열기
    layer.open(opPath)

    expect(layer.hasEvalDb).toBe(false)
    // opDb는 정상적으로 접근 가능해야 한다
    expect(() => layer.opDb).not.toThrow()
    // evalDb 접근은 throw해야 한다
    expect(() => layer.evalDb).toThrow()
  })

  test('두 개의 StorageLayer 인스턴스를 생성하면 각각 독립적인 핸들을 가진다', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'loopbreaker-m5-ac5a-second-'))
    const opPath2 = join(dir2, 'op.db')
    const evalPath2 = join(dir2, 'eval.db')
    const layer2 = new StorageLayer()

    try {
      layer.open(opPath, evalPath)
      layer2.open(opPath2, evalPath2)

      // 두 레이어의 opDb 핸들은 서로 다른 인스턴스
      expect(layer.opDb).not.toBe(layer2.opDb)
      // 두 레이어의 evalDb 핸들은 서로 다른 인스턴스
      expect(layer.evalDb).not.toBe(layer2.evalDb)
      // 같은 레이어 내에서도 op/eval은 다른 인스턴스
      expect(layer.opDb).not.toBe(layer.evalDb)
      expect(layer2.opDb).not.toBe(layer2.evalDb)
    } finally {
      layer2.close().catch(() => {})
      rmSync(dir2, { recursive: true, force: true })
    }
  })
})
