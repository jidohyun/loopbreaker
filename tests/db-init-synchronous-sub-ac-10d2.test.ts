// tests/db-init-synchronous-sub-ac-10d2.test.ts
//
// Sub-AC 10-D-2: DB 연결 초기화 함수가 PRAGMA synchronous 설정을
//   올바르게 적용하는지 검증.
//
// 검증 대상: src/storage/migrate-cli.ts の migrate() 함수는
//   db.pragma('synchronous = NORMAL') 를 호출한다.
//
// SQLite PRAGMA synchronous 값 매핑:
//   0 = OFF, 1 = NORMAL, 2 = FULL, 3 = EXTRA
//
// WAL 모드에서 NORMAL(1)은 데이터 안전성과 성능의 권장 균형점.
// :memory: DB는 WAL 모드를 지원하지 않으므로, tmp 파일 DB로 테스트한다.

import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrate } from '../src/storage/migrate-cli.js'

/** 임시 디렉토리 생성 후 DB 파일 경로를 반환 */
function makeTmpDbPath(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loopbreaker-sync-test-'))
  const dbPath = join(dir, 'test.db')
  return { dir, dbPath }
}

/** PRAGMA synchronous 쿼리 결과에서 숫자 값을 추출 */
function getSynchronousValue(db: Database.Database): number {
  const result = db.pragma('synchronous') as { synchronous: number }[]
  expect(result).toHaveLength(1)
  return result[0]!.synchronous
}

describe('DB 연결 초기화 — PRAGMA synchronous (Sub-AC 10-D-2)', () => {
  test('migrate() 호출 후 synchronous 값이 NORMAL(1)이다 (eval DB)', () => {
    const { dir, dbPath } = makeTmpDbPath()
    try {
      // eval kind는 sqlite-vec 로드 없이 동작하므로 테스트에 사용
      migrate('eval', dbPath, 1024)

      // migrate()는 DB를 close하므로 새 연결로 확인
      const db = new Database(dbPath)
      try {
        // NORMAL = 1
        expect(getSynchronousValue(db)).toBe(1)
      } finally {
        db.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('synchronous를 설정하지 않으면 기본값은 FULL(2)이다 (대조군)', () => {
    const { dir, dbPath } = makeTmpDbPath()
    try {
      // pragma 설정 없는 새 DB: 기본 synchronous는 FULL(2)
      const db = new Database(dbPath)
      try {
        // SQLite 기본값은 FULL = 2
        expect(getSynchronousValue(db)).toBe(2)
      } finally {
        db.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('db.pragma("synchronous = NORMAL") 직접 호출 후 값이 1이다', () => {
    const { dir, dbPath } = makeTmpDbPath()
    try {
      const db = new Database(dbPath)
      try {
        // 초기화 함수가 수행하는 핵심 동작을 단독으로 검증
        db.pragma('synchronous = NORMAL')

        expect(getSynchronousValue(db)).toBe(1)
      } finally {
        db.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('migrate() 호출 전후 synchronous 변화를 확인한다', () => {
    const { dir, dbPath } = makeTmpDbPath()
    try {
      // migrate 전: 기본 synchronous는 FULL(2)
      const dbBefore = new Database(dbPath)
      expect(getSynchronousValue(dbBefore)).toBe(2)
      dbBefore.close()

      // migrate 실행 (synchronous = NORMAL 포함)
      migrate('eval', dbPath, 1024)

      // migrate 후: synchronous는 NORMAL(1)
      const dbAfter = new Database(dbPath)
      try {
        expect(getSynchronousValue(dbAfter)).toBe(1)
      } finally {
        dbAfter.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('WAL 모드와 synchronous=NORMAL이 함께 설정된다', () => {
    const { dir, dbPath } = makeTmpDbPath()
    try {
      migrate('eval', dbPath, 1024)

      const db = new Database(dbPath)
      try {
        // journal_mode = wal
        const jm = db.pragma('journal_mode') as { journal_mode: string }[]
        expect(jm[0]!.journal_mode).toBe('wal')

        // synchronous = NORMAL(1)
        expect(getSynchronousValue(db)).toBe(1)
      } finally {
        db.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
