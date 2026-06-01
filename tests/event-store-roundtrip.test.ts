// tests/event-store-roundtrip.test.ts
// M1 acceptance #7(events 적재) + #8(리플레이 라운드트립 무손실) 검증.
// JSONL 라인 → parseChunk → parseLine → insertParsedLines → queryEventsBySession 무손실 확인.

import Database from 'better-sqlite3'
import { loadSqliteVec } from '../src/storage/vec-loader.js'
import { runMigrations } from '../src/storage/migrations.js'
import { parseChunk, parseLine } from '../src/ingest/parser.js'
import {
  insertParsedLines,
  queryEventsBySession,
  countEvents,
  insertParsedLine,
} from '../src/ingest/event-store.js'

function makeOpDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  loadSqliteVec(db)
  runMigrations(db, 'op', '0.1.0', 1024)
  return db
}

// 실제 Claude Code 세션 JSONL을 닮은 샘플 라인들 (한 세션)
const SESSION = 's-roundtrip-1'
// timestamp는 실제 Claude Code JSONL처럼 ISO 8601 문자열 (parser가 Date.parse로 변환)
const TS1 = '2026-05-29T00:00:01.000Z'
const TS2 = '2026-05-29T00:00:02.000Z'
const TS3 = '2026-05-29T00:00:03.000Z'
const SAMPLE_LINES: readonly string[] = [
  JSON.stringify({
    type: 'user', uuid: 'u1', parentUuid: null, sessionId: SESSION,
    cwd: '/Users/x/proj', timestamp: TS1, isSidechain: false,
    message: { role: 'user', content: '테스트 통과시켜줘' },
  }),
  JSON.stringify({
    type: 'assistant', uuid: 'a1', parentUuid: 'u1', sessionId: SESSION,
    cwd: '/Users/x/proj', timestamp: TS2, isSidechain: false,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: 'a.ts' } }] },
  }),
  JSON.stringify({
    type: 'user', uuid: 'r1', parentUuid: 'a1', sessionId: SESSION,
    cwd: '/Users/x/proj', timestamp: TS3, isSidechain: false,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
  }),
]

/** 라인 배열을 byteOffset과 함께 parseLine 처리한 결과 묶음 */
function parseAll(lines: readonly string[]): { result: ReturnType<typeof parseLine>; rawLine: string }[] {
  let offset = 0
  return lines.map((line) => {
    const r = { result: parseLine(line, offset, `/sessions/${SESSION}.jsonl`), rawLine: line }
    offset += Buffer.byteLength(line + '\n', 'utf8')
    return r
  })
}

describe('M1 라운드트립 — events 적재/재조회 무손실', () => {
  test('적재한 이벤트 수가 재조회 수와 일치한다 (무손실 카운트)', () => {
    const db = makeOpDb()
    const parsed = parseAll(SAMPLE_LINES)
    const inserted = insertParsedLines(db, parsed, 9999)
    expect(inserted).toBe(SAMPLE_LINES.length)
    expect(countEvents(db)).toBe(SAMPLE_LINES.length)

    const back = queryEventsBySession(db, SESSION)
    expect(back).toHaveLength(SAMPLE_LINES.length)
    db.close()
  })

  test('재조회 시 uuid·parentUuid·kind·ts·sessionId가 보존된다', () => {
    const db = makeOpDb()
    insertParsedLines(db, parseAll(SAMPLE_LINES), 9999)
    const back = queryEventsBySession(db, SESSION)

    const uuids = back.map((e) => e.uuid)
    expect(uuids).toEqual(['u1', 'a1', 'r1']) // ts 순서 보존
    expect(back[0]?.parentUuid).toBeNull()
    expect(back[1]?.parentUuid).toBe('u1')
    expect(back[2]?.parentUuid).toBe('a1')
    expect(back.every((e) => e.sessionId === SESSION)).toBe(true)
    expect(back[0]?.ts).toBe(Date.parse(TS1))
    db.close()
  })

  test('raw_json은 모든 라인에 대해 보존된다 (parse_ok 무관)', () => {
    const db = makeOpDb()
    insertParsedLines(db, parseAll(SAMPLE_LINES), 9999)
    const rows = db.prepare('SELECT uuid, raw_json FROM events ORDER BY ts').all() as { uuid: string; raw_json: string }[]
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.raw_json.length).toBeGreaterThan(0)
      expect(() => JSON.parse(row.raw_json)).not.toThrow()
    }
    db.close()
  })

  test('파싱 실패 라인은 parse_ok=0 + parse_error로 격리 저장된다 (중단 없음)', () => {
    const db = makeOpDb()
    const broken = '{ this is not valid json'
    const r = parseLine(broken, 0, `/sessions/${SESSION}.jsonl`)
    expect(r.parseOk).toBe(false)
    const ok = insertParsedLine(db, r, broken, 9999)
    expect(ok).toBe(true)

    const row = db.prepare('SELECT parse_ok, parse_error, raw_json FROM events').get() as
      { parse_ok: number; parse_error: string | null; raw_json: string }
    expect(row.parse_ok).toBe(0)
    expect(row.parse_error).toBeTruthy()
    expect(row.raw_json).toBe(broken) // 원본 보존
    db.close()
  })

  test('정상 + 깨진 라인이 섞여도 정상은 적재되고 깨진 건 격리된다', () => {
    const db = makeOpDb()
    const mixed = [SAMPLE_LINES[0]!, '{ broken', SAMPLE_LINES[1]!]
    let offset = 0
    const parsed = mixed.map((line) => {
      const item = { result: parseLine(line, offset, 'x'), rawLine: line }
      offset += Buffer.byteLength(line + '\n', 'utf8')
      return item
    })
    const inserted = insertParsedLines(db, parsed, 1)
    expect(inserted).toBe(3) // 깨진 것도 raw 보존으로 INSERT됨
    const okCount = (db.prepare('SELECT COUNT(*) AS n FROM events WHERE parse_ok = 1').get() as { n: number }).n
    const badCount = (db.prepare('SELECT COUNT(*) AS n FROM events WHERE parse_ok = 0').get() as { n: number }).n
    expect(okCount).toBe(2)
    expect(badCount).toBe(1)
    db.close()
  })

  test('동일 라인 재주입(at-least-once)은 uuid 멱등으로 중복되지 않는다', () => {
    const db = makeOpDb()
    const parsed = parseAll(SAMPLE_LINES)
    insertParsedLines(db, parsed, 1)
    const secondInserted = insertParsedLines(db, parsed, 2) // 재주입
    expect(secondInserted).toBe(0) // 전부 멱등 무시
    expect(countEvents(db)).toBe(SAMPLE_LINES.length) // 중복 없음
    db.close()
  })

  test('parseChunk → parseLine → 적재 전체 파이프라인 라운드트립', () => {
    const db = makeOpDb()
    // 청크를 두 조각으로 쪼개 부분 라인 버퍼링까지 경유
    const full = SAMPLE_LINES.join('\n') + '\n'
    const buf = Buffer.from(full, 'utf8')
    const mid = Math.floor(buf.length / 2)

    const c1 = parseChunk(buf.subarray(0, mid), '')
    const c2 = parseChunk(buf.subarray(mid), c1.partialLine)
    const allLines = [...c1.lines, ...c2.lines]
    expect(allLines).toHaveLength(SAMPLE_LINES.length) // 부분 라인 버퍼링 무손실

    let offset = 0
    const parsed = allLines.map((line) => {
      const item = { result: parseLine(line, offset, 'x'), rawLine: line }
      offset += Buffer.byteLength(line + '\n', 'utf8')
      return item
    })
    insertParsedLines(db, parsed, 1)
    expect(countEvents(db)).toBe(SAMPLE_LINES.length)
    expect(queryEventsBySession(db, SESSION).map((e) => e.uuid)).toEqual(['u1', 'a1', 'r1'])
    db.close()
  })
})
