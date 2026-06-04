// tests/insert-parsed-lines-idempotent-sub-ac-5b.test.ts
// Sub-AC 5b: insertParsedLines가 동일 입력으로 재호출될 때 중복 없이 멱등 적재되는지 검증.
// in-memory DB에 동일한 파싱 라인 배열을 두 번 삽입한 후 저장된 행 수가 최초 1회 삽입분과 동일함을 단언한다.

import Database from 'better-sqlite3'
import { loadSqliteVec } from '../src/storage/vec-loader.js'
import { runMigrations } from '../src/storage/migrations.js'
import { parseLine } from '../src/ingest/parser.js'
import {
  insertParsedLines,
  countEvents,
  queryEventsBySession,
} from '../src/ingest/event-store.js'

/** in-memory op DB 초기화 */
function makeOpDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  loadSqliteVec(db)
  runMigrations(db, 'op', '0.1.0', 1024)
  return db
}

const SESSION = 's-idempotent-test'
const TS1 = '2026-05-29T10:00:01.000Z'
const TS2 = '2026-05-29T10:00:02.000Z'
const TS3 = '2026-05-29T10:00:03.000Z'

const SAMPLE_LINES: readonly string[] = [
  JSON.stringify({
    type: 'user',
    uuid: 'idem-u1',
    parentUuid: null,
    sessionId: SESSION,
    cwd: '/Users/test/proj',
    timestamp: TS1,
    isSidechain: false,
    message: { role: 'user', content: '첫 번째 메시지' },
  }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'idem-a1',
    parentUuid: 'idem-u1',
    sessionId: SESSION,
    cwd: '/Users/test/proj',
    timestamp: TS2,
    isSidechain: false,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu-idem-1', name: 'Read', input: { file_path: 'a.ts' } }],
    },
  }),
  JSON.stringify({
    type: 'user',
    uuid: 'idem-r1',
    parentUuid: 'idem-a1',
    sessionId: SESSION,
    cwd: '/Users/test/proj',
    timestamp: TS3,
    isSidechain: false,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu-idem-1', content: 'file contents here' }],
    },
  }),
]

/** 라인 배열 → parseLine 처리 결과 묶음 */
function parseAll(
  lines: readonly string[],
  sessionFile = `/sessions/${SESSION}.jsonl`,
): { result: ReturnType<typeof parseLine>; rawLine: string }[] {
  let offset = 0
  return lines.map((line) => {
    const item = { result: parseLine(line, offset, sessionFile), rawLine: line }
    offset += Buffer.byteLength(line + '\n', 'utf8')
    return item
  })
}

describe('insertParsedLines 멱등 적재 (Sub-AC 5b)', () => {
  test('동일 파싱 라인 배열을 두 번 삽입해도 행 수는 최초 삽입분과 동일하다', () => {
    const db = makeOpDb()
    const parsed = parseAll(SAMPLE_LINES)

    // 1차 삽입
    const firstInserted = insertParsedLines(db, parsed, 1000)
    expect(firstInserted).toBe(SAMPLE_LINES.length) // 3행 모두 신규 INSERT

    const countAfterFirst = countEvents(db)
    expect(countAfterFirst).toBe(SAMPLE_LINES.length) // DB에 3행

    // 2차 삽입 (완전히 동일한 입력)
    const secondInserted = insertParsedLines(db, parsed, 2000) // ingestedAt 달라도 uuid PK로 무시
    expect(secondInserted).toBe(0) // 전부 멱등 무시

    const countAfterSecond = countEvents(db)
    expect(countAfterSecond).toBe(countAfterFirst) // 행 수 변화 없음
    expect(countAfterSecond).toBe(SAMPLE_LINES.length)

    db.close()
  })

  test('세 번 이상 재삽입해도 행 수는 변하지 않는다', () => {
    const db = makeOpDb()
    const parsed = parseAll(SAMPLE_LINES)

    insertParsedLines(db, parsed, 1000)
    const baseline = countEvents(db)

    for (let i = 2; i <= 5; i++) {
      const inserted = insertParsedLines(db, parsed, i * 1000)
      expect(inserted).toBe(0)
      expect(countEvents(db)).toBe(baseline)
    }

    db.close()
  })

  test('재삽입 후 queryEventsBySession이 반환하는 이벤트 목록이 동일하다', () => {
    const db = makeOpDb()
    const parsed = parseAll(SAMPLE_LINES)

    insertParsedLines(db, parsed, 1000)
    const eventsAfterFirst = queryEventsBySession(db, SESSION)

    insertParsedLines(db, parsed, 2000) // 재삽입
    const eventsAfterSecond = queryEventsBySession(db, SESSION)

    expect(eventsAfterSecond).toHaveLength(eventsAfterFirst.length)
    expect(eventsAfterSecond.map((e) => e.uuid)).toEqual(eventsAfterFirst.map((e) => e.uuid))
    expect(eventsAfterSecond.map((e) => e.ts)).toEqual(eventsAfterFirst.map((e) => e.ts))

    db.close()
  })

  test('빈 배열을 삽입하면 행 수가 0이고 멱등이다', () => {
    const db = makeOpDb()

    const firstInserted = insertParsedLines(db, [], 1000)
    expect(firstInserted).toBe(0)
    expect(countEvents(db)).toBe(0)

    const secondInserted = insertParsedLines(db, [], 2000)
    expect(secondInserted).toBe(0)
    expect(countEvents(db)).toBe(0)

    db.close()
  })

  test('파싱 실패 라인도 uuid 기반 멱등 처리된다', () => {
    const db = makeOpDb()
    const brokenLine = '{ this is not valid json'
    const parsed = [{ result: parseLine(brokenLine, 0, 'x.jsonl'), rawLine: brokenLine }]

    const firstInserted = insertParsedLines(db, parsed, 1000)
    expect(firstInserted).toBe(1) // 실패 라인도 raw_json 보존으로 INSERT됨
    expect(countEvents(db)).toBe(1)

    const secondInserted = insertParsedLines(db, parsed, 2000) // 재삽입
    expect(secondInserted).toBe(0) // uuid PK 충돌로 무시
    expect(countEvents(db)).toBe(1) // 행 수 불변

    db.close()
  })

  test('정상 라인과 실패 라인이 섞인 배열도 재삽입 시 멱등이다', () => {
    const db = makeOpDb()
    const mixedLines = [SAMPLE_LINES[0]!, '{ broken json line', SAMPLE_LINES[1]!]
    let offset = 0
    const parsed = mixedLines.map((line) => {
      const item = { result: parseLine(line, offset, 'mixed.jsonl'), rawLine: line }
      offset += Buffer.byteLength(line + '\n', 'utf8')
      return item
    })

    const firstInserted = insertParsedLines(db, parsed, 1000)
    expect(firstInserted).toBe(3) // 정상 2 + 실패 1 모두 INSERT
    const baseline = countEvents(db)
    expect(baseline).toBe(3)

    const secondInserted = insertParsedLines(db, parsed, 2000)
    expect(secondInserted).toBe(0)
    expect(countEvents(db)).toBe(baseline)

    db.close()
  })
})
