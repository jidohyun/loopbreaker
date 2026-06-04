// tests/parse-line-insert-idempotent-sub-ac-3b-2.test.ts
//
// Sub-AC 3b-2: parseLine 출력이 insertParsedLines에 전달될 때
// 동일 데이터로 두 번 호출해도 DB 레코드가 한 건만 존재함을 검증한다.
//
// 조건:
//   - in-memory SQLite (부수효과 0)
//   - 실제 네트워크/파일시스템/OS알림 0
//   - parseLine → insertParsedLines 멱등성이 uuid PK 충돌 무시로 보장됨

import Database from 'better-sqlite3'
import { loadSqliteVec } from '../src/storage/vec-loader.js'
import { runMigrations } from '../src/storage/migrations.js'
import { parseLine } from '../src/ingest/parser.js'
import { insertParsedLines, countEvents, queryEventsBySession } from '../src/ingest/event-store.js'

// ---------------------------------------------------------------------------
// 헬퍼: in-memory op DB 생성
// ---------------------------------------------------------------------------

function makeOpDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  loadSqliteVec(db)
  runMigrations(db, 'op', '0.1.0', 1024)
  return db
}

// ---------------------------------------------------------------------------
// 샘플 JSONL 라인 (한 세션)
// ---------------------------------------------------------------------------

const SESSION_ID = 's-idempotent-test-1'
const TS1 = '2026-06-01T00:00:01.000Z'
const TS2 = '2026-06-01T00:00:02.000Z'

const LINE_USER = JSON.stringify({
  type: 'user',
  uuid: 'idem-u1',
  parentUuid: null,
  sessionId: SESSION_ID,
  cwd: '/tmp/proj',
  timestamp: TS1,
  isSidechain: false,
  message: { role: 'user', content: 'hello' },
})

const LINE_ASSISTANT = JSON.stringify({
  type: 'assistant',
  uuid: 'idem-a1',
  parentUuid: 'idem-u1',
  sessionId: SESSION_ID,
  cwd: '/tmp/proj',
  timestamp: TS2,
  isSidechain: false,
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/tmp/x.ts' } }],
  },
})

const LINE_BROKEN = '{ not valid json at all'

/** 라인 배열을 byteOffset과 함께 parseLine 처리 */
function parseAll(
  lines: readonly string[],
  sourcePath = `/sessions/${SESSION_ID}.jsonl`,
): { result: ReturnType<typeof parseLine>; rawLine: string }[] {
  let offset = 0
  return lines.map((line) => {
    const item = { result: parseLine(line, offset, sourcePath), rawLine: line }
    offset += Buffer.byteLength(line + '\n', 'utf8')
    return item
  })
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('Sub-AC 3b-2: parseLine → insertParsedLines 멱등성', () => {
  test('동일 라인을 두 번 insertParsedLines해도 DB 레코드는 한 건만 존재한다 (단일 라인)', () => {
    const db = makeOpDb()
    const items = parseAll([LINE_USER])

    // 첫 번째 삽입 — 1건 INSERT
    const first = insertParsedLines(db, items, 1000)
    expect(first).toBe(1)
    expect(countEvents(db)).toBe(1)

    // 두 번째 삽입 (동일 데이터) — 멱등: 0건 INSERT, 총 1건 유지
    const second = insertParsedLines(db, items, 2000)
    expect(second).toBe(0)
    expect(countEvents(db)).toBe(1)

    db.close()
  })

  test('동일 라인을 세 번 재삽입해도 레코드는 한 건만 존재한다', () => {
    const db = makeOpDb()
    const items = parseAll([LINE_USER])

    insertParsedLines(db, items, 1)
    insertParsedLines(db, items, 2)
    insertParsedLines(db, items, 3)

    expect(countEvents(db)).toBe(1)
    db.close()
  })

  test('여러 라인을 두 번 insertParsedLines해도 각 uuid는 한 번씩만 저장된다', () => {
    const db = makeOpDb()
    const lines = [LINE_USER, LINE_ASSISTANT]
    const items = parseAll(lines)

    const first = insertParsedLines(db, items, 1000)
    expect(first).toBe(2)
    expect(countEvents(db)).toBe(2)

    const second = insertParsedLines(db, items, 2000)
    expect(second).toBe(0)
    expect(countEvents(db)).toBe(2)

    db.close()
  })

  test('재삽입 후 queryEventsBySession 결과가 원본과 동일하다', () => {
    const db = makeOpDb()
    const items = parseAll([LINE_USER, LINE_ASSISTANT])

    insertParsedLines(db, items, 1000)
    insertParsedLines(db, items, 2000) // 재삽입

    const events = queryEventsBySession(db, SESSION_ID)
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.uuid)).toEqual(['idem-u1', 'idem-a1'])
    expect(events[0]?.sessionId).toBe(SESSION_ID)
    expect(events[1]?.parentUuid).toBe('idem-u1')

    db.close()
  })

  test('파싱 실패 라인도 uuid가 동일하면 두 번째 삽입은 멱등으로 무시된다', () => {
    const db = makeOpDb()
    const items = parseAll([LINE_BROKEN])

    // 파싱 실패이지만 raw_json 보존으로 INSERT됨
    expect(items[0]?.result.parseOk).toBe(false)

    const first = insertParsedLines(db, items, 1000)
    expect(first).toBe(1)
    expect(countEvents(db)).toBe(1)

    // 동일 라인 재삽입 → syntheticUuid가 동일 → 멱등 무시
    const second = insertParsedLines(db, items, 2000)
    expect(second).toBe(0)
    expect(countEvents(db)).toBe(1)

    db.close()
  })

  test('정상 라인과 파싱 실패 라인이 섞인 배치를 두 번 삽입해도 총 레코드 수는 불변이다', () => {
    const db = makeOpDb()
    const lines = [LINE_USER, LINE_BROKEN, LINE_ASSISTANT]
    const items = parseAll(lines)

    const first = insertParsedLines(db, items, 1000)
    expect(first).toBe(3) // 파싱 실패도 raw 보존으로 INSERT

    const second = insertParsedLines(db, items, 2000)
    expect(second).toBe(0) // 전부 멱등 무시
    expect(countEvents(db)).toBe(3) // 레코드 수 불변

    db.close()
  })

  test('ingestedAt 값이 달라도 동일 uuid는 한 건만 저장된다 (ingestedAt은 멱등 키가 아님)', () => {
    const db = makeOpDb()
    const items = parseAll([LINE_USER])

    insertParsedLines(db, items, 111)
    insertParsedLines(db, items, 999) // ingestedAt 다름

    expect(countEvents(db)).toBe(1)

    // 저장된 ingested_at은 첫 번째 삽입 값
    const row = db.prepare('SELECT ingested_at FROM events WHERE uuid = ?').get('idem-u1') as
      { ingested_at: number }
    expect(row.ingested_at).toBe(111)

    db.close()
  })

  test('parseLine 출력의 parseOk·uuid가 반복 호출 시 결정론적으로 동일하다', () => {
    // 동일 line + offset → 동일 uuid (syntheticUuid도 결정론적)
    const r1 = parseLine(LINE_USER, 0, `/sessions/${SESSION_ID}.jsonl`)
    const r2 = parseLine(LINE_USER, 0, `/sessions/${SESSION_ID}.jsonl`)

    expect(r1.parseOk).toBe(r2.parseOk)
    expect(r1.event.uuid).toBe(r2.event.uuid)
    expect(r1.event.sessionId).toBe(r2.event.sessionId)
    expect(r1.event.kind).toBe(r2.event.kind)
  })
})
