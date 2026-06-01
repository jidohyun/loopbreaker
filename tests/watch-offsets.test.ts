/**
 * tests/watch-offsets.test.ts — Sub-AC 5c 통합 테스트
 *
 * readOffsets / saveOffset 함수 쌍 검증:
 * - 최초 읽기 시 byteOffset=0 반환
 * - 저장 후 재조회 시 일치
 * - 여러 filePath 독립 관리
 * - saveOffset 멱등성 (같은 값 재저장)
 * - saveOffset 증분 갱신 (덮어쓰기)
 * - 유효성 검증 (빈 경로, 음수 오프셋)
 * - 에러 격리
 */

import Database from 'better-sqlite3'
import { loadSqliteVec } from '../src/storage/vec-loader.js'
import { runMigrations } from '../src/storage/migrations.js'
import { readOffsets, saveOffset } from '../src/storage/watch-offsets.js'

// ---- 헬퍼 ----

function makeOpDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  loadSqliteVec(db)
  runMigrations(db, 'op', '0.1.0', 1024)
  return db
}

// ---- 테스트 ----

describe('readOffsets / saveOffset — Sub-AC 5c 통합 테스트', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeOpDb()
  })

  afterEach(() => {
    db.close()
  })

  // ---- 최초 읽기 ----

  describe('최초 읽기 (행 없음)', () => {
    test('존재하지 않는 filePath 조회 시 byteOffset=0을 반환한다', () => {
      const row = readOffsets(db, '/tmp/test-session.jsonl')
      expect(row.byteOffset).toBe(0)
    })

    test('최초 읽기 반환 행의 filePath는 요청한 경로와 일치한다', () => {
      const path = '/home/user/.claude/projects/my-proj/session.jsonl'
      const row = readOffsets(db, path)
      expect(row.filePath).toBe(path)
    })

    test('최초 읽기 반환 행의 status는 active이다', () => {
      const row = readOffsets(db, '/tmp/new-file.jsonl')
      expect(row.status).toBe('active')
    })

    test('최초 읽기 반환 행의 lastCompleteLineOffset은 0이다', () => {
      const row = readOffsets(db, '/tmp/test.jsonl')
      expect(row.lastCompleteLineOffset).toBe(0)
    })

    test('최초 읽기 반환 행의 partialBuffer는 빈 문자열이다', () => {
      const row = readOffsets(db, '/tmp/test.jsonl')
      expect(row.partialBuffer).toBe('')
    })

    test('최초 읽기 반환 행의 lastEventUuid는 null이다', () => {
      const row = readOffsets(db, '/tmp/test.jsonl')
      expect(row.lastEventUuid).toBeNull()
    })

    test('같은 경로를 두 번 읽어도 동일하게 byteOffset=0을 반환한다', () => {
      const path = '/tmp/repeated-read.jsonl'
      const row1 = readOffsets(db, path)
      const row2 = readOffsets(db, path)
      expect(row1.byteOffset).toBe(0)
      expect(row2.byteOffset).toBe(0)
    })
  })

  // ---- 저장 후 재조회 일치 검증 ----

  describe('saveOffset 후 readOffsets — 저장값 일치', () => {
    test('저장한 byteOffset을 재조회 시 정확히 반환한다', () => {
      const path = '/tmp/ingest-a.jsonl'
      saveOffset(db, path, 1024)
      const row = readOffsets(db, path)
      expect(row.byteOffset).toBe(1024)
    })

    test('byteOffset=0 저장 후 재조회 시 0을 반환한다', () => {
      const path = '/tmp/zero-offset.jsonl'
      saveOffset(db, path, 0)
      const row = readOffsets(db, path)
      expect(row.byteOffset).toBe(0)
    })

    test('큰 byteOffset 값(수 MB)도 정확히 저장·조회된다', () => {
      const path = '/tmp/large-file.jsonl'
      const large = 50 * 1024 * 1024 // 50 MB
      saveOffset(db, path, large)
      const row = readOffsets(db, path)
      expect(row.byteOffset).toBe(large)
    })

    test('재조회된 filePath는 저장 시 전달한 경로와 일치한다', () => {
      const path = '/home/user/.claude/projects/enc-proj/sess-abc.jsonl'
      saveOffset(db, path, 256)
      const row = readOffsets(db, path)
      expect(row.filePath).toBe(path)
    })
  })

  // ---- 증분 갱신 ----

  describe('saveOffset — 증분 갱신(덮어쓰기)', () => {
    test('두 번 저장하면 마지막 값으로 갱신된다', () => {
      const path = '/tmp/incremental.jsonl'
      saveOffset(db, path, 100)
      saveOffset(db, path, 500)
      const row = readOffsets(db, path)
      expect(row.byteOffset).toBe(500)
    })

    test('세 번 연속 증가하는 오프셋 저장 시 최종값이 조회된다', () => {
      const path = '/tmp/three-saves.jsonl'
      saveOffset(db, path, 100)
      saveOffset(db, path, 200)
      saveOffset(db, path, 300)
      const row = readOffsets(db, path)
      expect(row.byteOffset).toBe(300)
    })

    test('동일한 값을 두 번 저장해도 오류 없이 동일값을 반환한다 (멱등)', () => {
      const path = '/tmp/idempotent.jsonl'
      saveOffset(db, path, 512)
      saveOffset(db, path, 512)
      const row = readOffsets(db, path)
      expect(row.byteOffset).toBe(512)
    })
  })

  // ---- 여러 filePath 독립성 ----

  describe('여러 filePath 독립 관리', () => {
    test('다른 filePath는 독립된 오프셋을 가진다', () => {
      const pathA = '/tmp/session-a.jsonl'
      const pathB = '/tmp/session-b.jsonl'
      saveOffset(db, pathA, 100)
      saveOffset(db, pathB, 999)
      expect(readOffsets(db, pathA).byteOffset).toBe(100)
      expect(readOffsets(db, pathB).byteOffset).toBe(999)
    })

    test('pathA 갱신이 pathB에 영향을 주지 않는다', () => {
      const pathA = '/tmp/file-a.jsonl'
      const pathB = '/tmp/file-b.jsonl'
      saveOffset(db, pathA, 100)
      saveOffset(db, pathB, 200)
      saveOffset(db, pathA, 9999)
      expect(readOffsets(db, pathB).byteOffset).toBe(200)
    })

    test('세 개의 서로 다른 파일 경로가 각각 독립된 오프셋을 유지한다', () => {
      const paths = [
        '/tmp/s1.jsonl',
        '/tmp/sub/s2.jsonl',
        '/home/user/.claude/projects/p1/s3.jsonl',
      ] as const
      saveOffset(db, paths[0], 10)
      saveOffset(db, paths[1], 20)
      saveOffset(db, paths[2], 30)

      expect(readOffsets(db, paths[0]).byteOffset).toBe(10)
      expect(readOffsets(db, paths[1]).byteOffset).toBe(20)
      expect(readOffsets(db, paths[2]).byteOffset).toBe(30)
    })
  })

  // ---- updated_at 갱신 확인 ----

  describe('saveOffset — updated_at 갱신', () => {
    test('saveOffset 호출 후 updatedAt이 현재 시각 근방으로 설정된다', () => {
      const path = '/tmp/ts-check.jsonl'
      const before = Date.now()
      saveOffset(db, path, 42)
      const after = Date.now()
      const row = readOffsets(db, path)
      expect(row.updatedAt).toBeGreaterThanOrEqual(before)
      expect(row.updatedAt).toBeLessThanOrEqual(after)
    })

    test('두 번째 saveOffset 후 updatedAt이 첫 번째보다 같거나 크다', () => {
      const path = '/tmp/ts-order.jsonl'
      saveOffset(db, path, 1)
      const row1 = readOffsets(db, path)

      // 약간의 시간 간격을 두어 updatedAt이 다를 수 있도록
      saveOffset(db, path, 2)
      const row2 = readOffsets(db, path)

      expect(row2.updatedAt).toBeGreaterThanOrEqual(row1.updatedAt)
    })
  })

  // ---- 유효성 검증 ----

  describe('입력 유효성 검증', () => {
    test('readOffsets: 빈 문자열 filePath는 ZodError를 던진다', () => {
      expect(() => readOffsets(db, '')).toThrow()
    })

    test('saveOffset: 빈 문자열 filePath는 ZodError를 던진다', () => {
      expect(() => saveOffset(db, '', 0)).toThrow()
    })

    test('saveOffset: 음수 byteOffset은 ZodError를 던진다', () => {
      expect(() => saveOffset(db, '/tmp/x.jsonl', -1)).toThrow()
    })

    test('saveOffset: 소수 byteOffset은 ZodError를 던진다', () => {
      expect(() => saveOffset(db, '/tmp/x.jsonl', 1.5)).toThrow()
    })

    test('saveOffset: byteOffset=0은 유효하다', () => {
      expect(() => saveOffset(db, '/tmp/x.jsonl', 0)).not.toThrow()
    })

    test('saveOffset: byteOffset=Number.MAX_SAFE_INTEGER는 유효하다', () => {
      expect(() =>
        saveOffset(db, '/tmp/x.jsonl', Number.MAX_SAFE_INTEGER),
      ).not.toThrow()
    })
  })

  // ---- 라운드트립 무손실 검증 ----

  describe('라운드트립 무손실 (저장→재조회 보존)', () => {
    test('저장한 오프셋을 N번 연속 조회해도 항상 동일한 값을 반환한다', () => {
      const path = '/tmp/roundtrip.jsonl'
      const offset = 8192
      saveOffset(db, path, offset)

      for (let i = 0; i < 5; i++) {
        const row = readOffsets(db, path)
        expect(row.byteOffset).toBe(offset)
      }
    })

    test('저장→조회→재저장→재조회 사이클이 올바르게 동작한다', () => {
      const path = '/tmp/cycle.jsonl'

      // 최초 읽기
      expect(readOffsets(db, path).byteOffset).toBe(0)

      // 저장
      saveOffset(db, path, 100)
      expect(readOffsets(db, path).byteOffset).toBe(100)

      // 재저장
      saveOffset(db, path, 200)
      expect(readOffsets(db, path).byteOffset).toBe(200)

      // 또 재저장
      saveOffset(db, path, 300)
      expect(readOffsets(db, path).byteOffset).toBe(300)
    })
  })

  // ---- watch_offsets 테이블 의존 ----

  describe('watch_offsets 테이블 의존 검증', () => {
    test('마이그레이션 없이 readOffsets를 호출하면 에러가 발생한다', () => {
      const rawDb = new Database(':memory:')
      rawDb.pragma('journal_mode = WAL')
      try {
        expect(() => readOffsets(rawDb, '/tmp/x.jsonl')).toThrow()
      } finally {
        rawDb.close()
      }
    })

    test('마이그레이션 없이 saveOffset를 호출하면 에러가 발생한다', () => {
      const rawDb = new Database(':memory:')
      rawDb.pragma('journal_mode = WAL')
      try {
        expect(() => saveOffset(rawDb, '/tmp/x.jsonl', 0)).toThrow()
      } finally {
        rawDb.close()
      }
    })
  })
})
