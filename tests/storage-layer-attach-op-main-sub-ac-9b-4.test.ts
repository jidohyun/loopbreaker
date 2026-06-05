/**
 * tests/storage-layer-attach-op-main-sub-ac-9b-4.test.ts
 *
 * Sub-AC 9b-4: op DB 파일이 존재하지 않거나 경로가 잘못된 경우
 * StorageLayer.open()이 명시적 에러를 throw하고
 * eval DB가 닫힌 상태로 복구됨을 검증하는 단일 테스트.
 *
 * 검증 내용:
 *   1. 존재하지 않는 디렉터리 경로의 op DB → open() throw + hasEvalDb = false
 *   2. throw 후 layer.opDb getter도 에러를 throw한다 (열리지 않은 상태)
 *   3. throw 후 layer.evalDb getter도 에러를 throw한다 (열리지 않은 상태)
 *
 * 부수효과 0: 임시 tmpdir 파일 DB + 테스트 후 삭제.
 * 실경로 리터럴 없음.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StorageLayer } from '../src/storage/storage-layer.js'

function makeTmpDir(): { dir: string; evalPath: string; invalidOpPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loopbreaker-9b4-'))
  return {
    dir,
    evalPath: join(dir, 'eval.db'),
    // 존재하지 않는 중간 디렉터리를 포함한 경로 → better-sqlite3가 에러를 던진다
    invalidOpPath: join(dir, 'nonexistent-subdir', 'op.db'),
  }
}

describe('StorageLayer.open() — invalid op DB path error recovery (Sub-AC 9b-4)', () => {
  let dir: string
  let evalPath: string
  let invalidOpPath: string
  let layer: StorageLayer

  beforeEach(() => {
    ;({ dir, evalPath, invalidOpPath } = makeTmpDir())
    layer = new StorageLayer()
  })

  afterEach(async () => {
    try {
      await layer.close()
    } catch {
      /* ignore — layer may already be in error state */
    }
    rmSync(dir, { recursive: true, force: true })
  })

  test('존재하지 않는 경로의 op DB로 open()을 호출하면 에러를 throw한다', () => {
    expect(() => {
      layer.open(invalidOpPath, evalPath, { embedDim: 1024 })
    }).toThrow()
  })

  test('open() 실패 후 hasEvalDb는 false이다 (eval DB가 열리지 않음)', () => {
    try {
      layer.open(invalidOpPath, evalPath, { embedDim: 1024 })
    } catch {
      /* expected */
    }

    expect(layer.hasEvalDb).toBe(false)
  })

  test('open() 실패 후 opDb getter는 에러를 throw한다', () => {
    try {
      layer.open(invalidOpPath, evalPath, { embedDim: 1024 })
    } catch {
      /* expected */
    }

    expect(() => layer.opDb).toThrow()
  })

  test('open() 실패 후 evalDb getter는 에러를 throw한다', () => {
    try {
      layer.open(invalidOpPath, evalPath, { embedDim: 1024 })
    } catch {
      /* expected */
    }

    expect(() => layer.evalDb).toThrow()
  })
})
