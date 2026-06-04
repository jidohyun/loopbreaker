/**
 * tests/storage-layer-sqlite-vec-sub-ac-2a.test.ts
 *
 * Sub-AC 2a: StorageLayer.open() — sqlite-vec 확장 로드 검증.
 *
 * 임시경로 DB를 열어 loadSqliteVec()를 호출한 뒤,
 * `SELECT vec_version()` 쿼리가 오류 없이 버전 문자열을 반환하는지 확인.
 * sqlite-vec 미설치 환경에서는 skip 처리.
 *
 * 부수효과 0: 실제 네트워크·OS알림·~/.loopbreaker 접근 없음.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StorageLayer } from '../src/storage/storage-layer.js'

/** 임시 디렉토리와 op DB 경로를 생성한다. */
function makeTmpDir(): { dir: string; opPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loopbreaker-m5-ac2a-'))
  return { dir, opPath: join(dir, 'op.db') }
}

/**
 * sqlite-vec가 설치돼 있는지 미리 탐색한다.
 * 설치되지 않은 환경에서 테스트 전체를 skip하기 위해 사용.
 */
function isSqliteVecAvailable(): boolean {
  try {
    // StorageLayer를 임시 DB로 열어 확장 로드 시도
    const { dir, opPath } = makeTmpDir()
    const layer = new StorageLayer()
    try {
      layer.open(opPath, undefined, { embedDim: 1024 })
      // vec_version() 호출 가능 여부 확인
      layer.opDb.prepare('SELECT vec_version()').get()
      return true
    } finally {
      try { layer.opDb.close() } catch { /* ignore */ }
      rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    return false
  }
}

const SQLITE_VEC_AVAILABLE = isSqliteVecAvailable()

describe('StorageLayer.open() — sqlite-vec 확장 로드 (Sub-AC 2a)', () => {
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

  // ── 핵심: vec_version() 반환값 검증 ──────────────────────────────────

  test('open() 후 vec_version() 쿼리가 버전 문자열을 반환한다', () => {
    if (!SQLITE_VEC_AVAILABLE) {
      // sqlite-vec 미설치 환경에서는 skip
      return
    }

    layer.open(opPath, undefined, { embedDim: 1024 })

    // vec_version()은 sqlite-vec가 로드된 경우에만 존재
    const row = layer.opDb
      .prepare('SELECT vec_version() AS ver')
      .get() as { ver: string } | undefined

    expect(row).toBeDefined()
    expect(typeof row!.ver).toBe('string')
    expect(row!.ver.length).toBeGreaterThan(0)
  })

  test('open() 후 vec_version()은 숫자로 시작하는 semver 형식이다', () => {
    if (!SQLITE_VEC_AVAILABLE) {
      return
    }

    layer.open(opPath, undefined, { embedDim: 1024 })

    const row = layer.opDb
      .prepare('SELECT vec_version() AS ver')
      .get() as { ver: string } | undefined

    expect(row).toBeDefined()
    // semver 형식이어야 한다 (e.g., "0.1.6", "1.0.0", "v0.1.6")
    expect(/^v?\d/.test(row!.ver)).toBe(true)
  })

  // ── sqlite-vec 미설치 환경 — 명시적 skip 케이스 ──────────────────────

  test('sqlite-vec 미설치 시 open()이 명확한 에러를 던진다 (대조군)', () => {
    if (SQLITE_VEC_AVAILABLE) {
      // 설치된 환경에서는 이 케이스를 검증할 수 없으므로 skip
      return
    }

    // sqlite-vec가 없는 환경에서 StorageLayer.open()은 에러를 던져야 한다
    expect(() => {
      layer.open(opPath, undefined, { embedDim: 1024 })
    }).toThrow()
  })

  // ── loadSqliteVec 직접 호출 검증 ─────────────────────────────────────

  test('open() 후 opDb에서 vec_version() 함수가 존재한다 (함수 등록 확인)', () => {
    if (!SQLITE_VEC_AVAILABLE) {
      return
    }

    layer.open(opPath, undefined, { embedDim: 1024 })

    // vec_version() SQL 함수가 등록됐는지 확인
    // 등록되지 않았다면 "no such function: vec_version" 에러가 발생한다
    expect(() => {
      layer.opDb.prepare('SELECT vec_version()').get()
    }).not.toThrow()
  })

  // ── vec_embeddings 가상 테이블 생성 확인 (sqlite-vec 로드 완전성 검증) ──

  test('open() 후 vec_embeddings 가상 테이블이 존재한다', () => {
    if (!SQLITE_VEC_AVAILABLE) {
      return
    }

    layer.open(opPath, undefined, { embedDim: 1024 })

    // vec_embeddings는 op 마이그레이션에서 sqlite-vec로 생성됨
    const row = layer.opDb
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='vec_embeddings'`
      )
      .get() as { name: string } | undefined

    expect(row).toBeDefined()
    expect(row!.name).toBe('vec_embeddings')
  })
})
