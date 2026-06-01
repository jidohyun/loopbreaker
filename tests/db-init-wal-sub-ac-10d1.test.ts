// tests/db-init-wal-sub-ac-10d1.test.ts
//
// Sub-AC 10-D-1: DB 연결 초기화 함수가 PRAGMA journal_mode=WAL을 실행하는지 검증.
// 연결 생성 후 `PRAGMA journal_mode` 쿼리 결과가 'wal'임을 assert한다.
//
// 검증 대상: src/storage/migrate-cli.ts の migrate() 함수는
//   db.pragma('journal_mode = WAL') 를 호출한다.
// :memory: DB는 WAL 모드를 지원하지 않으므로, tmp 파일 DB로 테스트한다.

import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrate } from '../src/storage/migrate-cli.js'

/** 임시 디렉토리 생성 후 DB 파일 경로를 반환 */
function makeTmpDbPath(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loopbreaker-test-'))
  const dbPath = join(dir, 'test.db')
  return { dir, dbPath }
}

describe('DB 연결 초기화 — PRAGMA journal_mode=WAL (Sub-AC 10-D-1)', () => {
  test('migrate() 호출 후 journal_mode가 wal이다 (op DB)', () => {
    const { dir, dbPath } = makeTmpDbPath()
    try {
      // migrate()는 내부에서 db.pragma('journal_mode = WAL')를 실행한다
      // eval kind는 sqlite-vec 로드 없이 동작하므로 테스트에 사용
      migrate('eval', dbPath, 1024)

      // migrate()는 DB를 close하므로 새 연결로 확인
      const db = new Database(dbPath)
      try {
        const result = db.pragma('journal_mode') as { journal_mode: string }[]
        expect(result).toHaveLength(1)
        expect(result[0]!.journal_mode).toBe('wal')
      } finally {
        db.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('PRAGMA journal_mode를 명시적으로 설정하지 않으면 기본값은 wal이 아니다 (대조군)', () => {
    // :memory: DB는 WAL 미지원 → 기본 journal_mode는 'memory'
    const db = new Database(':memory:')
    try {
      const result = db.pragma('journal_mode') as { journal_mode: string }[]
      expect(result[0]!.journal_mode).not.toBe('wal')
    } finally {
      db.close()
    }
  })

  test('db.pragma("journal_mode = WAL") 직접 호출 후 journal_mode가 wal이다', () => {
    const { dir, dbPath } = makeTmpDbPath()
    try {
      const db = new Database(dbPath)
      try {
        // 초기화 함수가 수행하는 핵심 동작을 단독으로 검증
        db.pragma('journal_mode = WAL')

        const result = db.pragma('journal_mode') as { journal_mode: string }[]
        expect(result).toHaveLength(1)
        expect(result[0]!.journal_mode).toBe('wal')
      } finally {
        db.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('migrate() 호출 전후 journal_mode 변화를 확인한다', () => {
    const { dir, dbPath } = makeTmpDbPath()
    try {
      // migrate 전: 기본 journal_mode는 'delete'
      const dbBefore = new Database(dbPath)
      const beforeResult = dbBefore.pragma('journal_mode') as { journal_mode: string }[]
      expect(beforeResult[0]!.journal_mode).not.toBe('wal')
      dbBefore.close()

      // migrate 실행 (WAL 설정 포함)
      migrate('eval', dbPath, 1024)

      // migrate 후: journal_mode는 'wal'
      const dbAfter = new Database(dbPath)
      try {
        const afterResult = dbAfter.pragma('journal_mode') as { journal_mode: string }[]
        expect(afterResult[0]!.journal_mode).toBe('wal')
      } finally {
        dbAfter.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
