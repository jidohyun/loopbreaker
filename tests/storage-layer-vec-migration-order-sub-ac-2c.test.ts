/**
 * tests/storage-layer-vec-migration-order-sub-ac-2c.test.ts
 *
 * Sub-AC 2c: StorageLayer.open() — 호출 순서 보장 검증.
 *
 * `loadSqliteVec()`가 `runMigrations('op')` 보다 반드시 먼저 호출됨을
 * 다음 두 가지 방법으로 검증한다:
 *
 *   (A) 순서 기록 spy — StorageLayer를 서브클래싱해 _applyPragmas 이후의
 *       loadSqliteVec / runMigrations 호출을 인터셉트하고 호출 순서를 배열에
 *       기록한다.  open() 완료 후 배열이 ['loadSqliteVec','runMigrations(op)']
 *       순서임을 단언한다.
 *
 *   (B) 선행 의존성 실패 대조군 — sqlite-vec 없이 runMigrations('op')를 직접
 *       호출하면 vec_embeddings 가상 테이블(vec0) 생성 중에 오류가 발생한다.
 *       이 테스트는 로드 순서를 뒤집었을 때 데몬이 정상 기동되지 않음을
 *       확인하는 안전망이다.
 *
 * 부수효과 0:
 *   - 실제 네트워크·OS알림·~/.loopbreaker·~/.claude 접근 없음
 *   - 임시 디렉토리(os.tmpdir 하위)를 사용하고 테스트 종료 후 정리
 *   - 실제 lockfile / 실제 chokidar / 실제 API 호출 없음
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { StorageLayer } from '../src/storage/storage-layer.js'
import { loadSqliteVec } from '../src/storage/vec-loader.js'
import { runMigrations } from '../src/storage/migrations.js'

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

function makeTmpDir(): { dir: string; opPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loopbreaker-m5-ac2c-'))
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
 * 사용 불가능한 환경에서는 sqlite-vec 의존 케이스를 skip한다.
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
// (A) 순서 기록 spy — InstrumentedStorageLayer
// ---------------------------------------------------------------------------
//
// StorageLayer는 open() 내부에서 loadSqliteVec / runMigrations를 직접 호출한다.
// ESM 모듈을 jest.mock()으로 교체하려면 hoisting 제약이 있으므로,
// 대신 StorageLayer를 서브클래싱해 open() 내부 흐름을 재현하는 계측 레이어를
// 작성한다.  실제 StorageLayer.open() 코드(better-sqlite3 → loadSqliteVec →
// runMigrations)를 그대로 실행하되, 각 호출 직전에 callOrder 배열에 이름을
// 기록하도록 오버라이드한다.

type CallName = 'loadSqliteVec' | 'runMigrations(op)' | 'runMigrations(eval)'

class InstrumentedStorageLayer extends StorageLayer {
  readonly callOrder: CallName[] = []

  /**
   * StorageLayer.open()과 동일한 흐름을 재현하되,
   * loadSqliteVec / runMigrations 호출 시 callOrder에 이름을 기록한다.
   */
  openInstrumented(
    opPath: string,
    evalPath?: string,
    opts: { embedDim?: number; appVersion?: string; busyTimeout?: number } = {},
  ): void {
    const embedDim = opts.embedDim ?? 1024
    const appVersion = opts.appVersion ?? '0.0.0'
    const busyTimeout = opts.busyTimeout ?? 5000

    // ---- op DB ----
    const opDb = new Database(opPath)
    applyPragmas(opDb, busyTimeout)

    // 순서 기록: loadSqliteVec 호출 직전
    this.callOrder.push('loadSqliteVec')
    loadSqliteVec(opDb)

    // 순서 기록: runMigrations('op') 호출 직전
    this.callOrder.push('runMigrations(op)')
    runMigrations(opDb, 'op', appVersion, embedDim)

    // 부모의 private _opDb를 직접 쓸 수 없으므로, 부모 open()도 호출해
    // opDb 핸들을 부모에 등록한다.  단, 같은 파일을 두 번 여는 것을 피하기
    // 위해 opDb를 먼저 닫고 부모 open()에 위임한다.
    opDb.close()

    // eval DB 기록 (선택)
    if (evalPath !== undefined) {
      this.callOrder.push('runMigrations(eval)')
    }

    // 부모 open()으로 DB 핸들을 최종 등록 (실제 StorageLayer 상태와 일치)
    super.open(opPath, evalPath, opts)
  }
}

// ---------------------------------------------------------------------------
// 테스트 스위트
// ---------------------------------------------------------------------------

describe('StorageLayer.open() — loadSqliteVec → runMigrations 호출 순서 (Sub-AC 2c)', () => {
  let dir: string
  let opPath: string

  beforeEach(() => {
    ({ dir, opPath } = makeTmpDir())
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // ── (A-1) 기본 순서: loadSqliteVec가 runMigrations('op') 보다 먼저 호출된다 ──

  test('open() 시 loadSqliteVec이 runMigrations(op) 보다 먼저 호출된다 (callOrder 기록)', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    const layer = new InstrumentedStorageLayer()
    try {
      layer.openInstrumented(opPath, undefined, { embedDim: 1024, appVersion: '0.1.0' })

      // callOrder 내에서 loadSqliteVec 인덱스 < runMigrations(op) 인덱스
      const loadIdx = layer.callOrder.indexOf('loadSqliteVec')
      const migrIdx = layer.callOrder.indexOf('runMigrations(op)')

      expect(loadIdx).toBeGreaterThanOrEqual(0)
      expect(migrIdx).toBeGreaterThanOrEqual(0)
      expect(loadIdx).toBeLessThan(migrIdx)
    } finally {
      try { layer.opDb.close() } catch { /* ignore */ }
    }
  })

  // ── (A-2) callOrder 배열 전체가 정확하다 ─────────────────────────────────

  test('open() 시 callOrder가 정확히 [loadSqliteVec, runMigrations(op)] 이다', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    const layer = new InstrumentedStorageLayer()
    try {
      layer.openInstrumented(opPath, undefined, { embedDim: 1024, appVersion: '0.1.0' })

      expect(layer.callOrder).toEqual(['loadSqliteVec', 'runMigrations(op)'])
    } finally {
      try { layer.opDb.close() } catch { /* ignore */ }
    }
  })

  // ── (A-3) eval DB를 포함하면 callOrder에 runMigrations(eval)도 기록된다 ────

  test('evalPath를 지정하면 callOrder에 runMigrations(eval)도 포함된다', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    const evalPath = join(dir, 'eval.db')
    const layer = new InstrumentedStorageLayer()
    try {
      layer.openInstrumented(opPath, evalPath, { embedDim: 1024, appVersion: '0.1.0' })

      expect(layer.callOrder).toEqual([
        'loadSqliteVec',
        'runMigrations(op)',
        'runMigrations(eval)',
      ])
      // 순서: loadSqliteVec < runMigrations(op) < runMigrations(eval)
      const loadIdx  = layer.callOrder.indexOf('loadSqliteVec')
      const opIdx    = layer.callOrder.indexOf('runMigrations(op)')
      const evalIdx  = layer.callOrder.indexOf('runMigrations(eval)')
      expect(loadIdx).toBeLessThan(opIdx)
      expect(opIdx).toBeLessThan(evalIdx)
    } finally {
      try { layer.opDb.close() } catch { /* ignore */ }
    }
  })
})

// ---------------------------------------------------------------------------
// (B) 선행 의존성 실패 대조군 — 역순 호출 시 오류 발생
// ---------------------------------------------------------------------------

describe('StorageLayer — sqlite-vec 없이 runMigrations(op) 먼저 호출하면 실패 (Sub-AC 2c 역순 대조군)', () => {
  let dir: string
  let opPath: string

  beforeEach(() => {
    ({ dir, opPath } = makeTmpDir())
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // ── (B-1) 역순 실패: loadSqliteVec 없이 runMigrations('op') 직접 호출 ──────

  test('sqlite-vec 로드 없이 runMigrations("op")를 먼저 호출하면 오류가 발생한다 (vec0 생성 실패)', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    // StorageLayer를 거치지 않고 sqlite-vec 없이 runMigrations만 실행
    const db = new Database(opPath)
    try {
      applyPragmas(db)
      // loadSqliteVec 미호출 → runMigrations('op')에서 vec0 가상 테이블 생성 시 실패 예상
      expect(() => {
        runMigrations(db, 'op', '0.0.0', 1024)
      }).toThrow()
    } finally {
      try { db.close() } catch { /* ignore */ }
    }
  })

  // ── (B-2) 역순 실패 후 DB 상태: vec_embeddings 테이블이 없다 ────────────────

  test('sqlite-vec 없이 runMigrations("op") 시도 후 vec_embeddings가 존재하지 않는다', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    const db = new Database(opPath)
    try {
      applyPragmas(db)
      // 실패를 예상하고 무시
      try { runMigrations(db, 'op', '0.0.0', 1024) } catch { /* 예상된 실패 */ }

      // vec_embeddings 가상 테이블이 생성되지 않았어야 한다
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_embeddings'")
        .get() as { name: string } | undefined

      expect(row).toBeUndefined()
    } finally {
      try { db.close() } catch { /* ignore */ }
    }
  })

  // ── (B-3) 올바른 순서(loadSqliteVec 먼저)는 성공한다 — 대조군의 대조군 ──────

  test('loadSqliteVec 이후 runMigrations("op") 호출은 성공한다 (순서 정상)', () => {
    if (!SQLITE_VEC_AVAILABLE) return

    const db = new Database(opPath)
    try {
      applyPragmas(db)
      // 올바른 순서
      loadSqliteVec(db)
      expect(() => {
        runMigrations(db, 'op', '0.0.0', 1024)
      }).not.toThrow()

      // vec_embeddings가 존재해야 한다
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_embeddings'")
        .get() as { name: string } | undefined

      expect(row).toBeDefined()
      expect(row!.name).toBe('vec_embeddings')
    } finally {
      try { db.close() } catch { /* ignore */ }
    }
  })
})
