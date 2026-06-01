// tests/detection-pipeline-integration.test.ts
// M2 acceptance #8: events→buildTriple→runStructuralGate end-to-end 통합.
// M1 events 적재 → M2 구조 게이트가 실제 DB 경유로 thrashing 후보를 발화하는지 검증.
// 반복 편집 시퀀스 → 발화, 정상(다른 영역) 시퀀스 → 미발화.

import Database from 'better-sqlite3'
import { loadSqliteVec } from '../src/storage/vec-loader.js'
import { runMigrations } from '../src/storage/migrations.js'
import { parseLine } from '../src/ingest/parser.js'
import { insertParsedLines } from '../src/ingest/event-store.js'
import { detectThrashingForSession } from '../src/detect/detection-pipeline.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'
import type { DetectorConfig } from '../src/contracts.js'

const SESSION = 'integ-sess-1'

function makeOpDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  loadSqliteVec(db)
  runMigrations(db, 'op', '0.1.0', 1024)
  return db
}

let _seq = 0
function editLine(filePath: string, oldS: string, newS: string, tsBase: number): string {
  _seq++
  return JSON.stringify({
    type: 'assistant',
    uuid: `e${_seq}`,
    parentUuid: null,
    sessionId: SESSION,
    cwd: '/proj',
    timestamp: new Date(tsBase + _seq * 1000).toISOString(),
    isSidechain: false,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: `tu${_seq}`, name: 'Edit', input: { file_path: filePath, old_string: oldS, new_string: newS } }],
    },
  })
}

/** 라인 배열을 적재 (parseLine → insertParsedLines) */
function ingest(db: Database.Database, lines: readonly string[]): void {
  let offset = 0
  const parsed = lines.map((line) => {
    const item = { result: parseLine(line, offset, `/s/${SESSION}.jsonl`), rawLine: line }
    offset += Buffer.byteLength(line + '\n', 'utf8')
    return item
  })
  insertParsedLines(db, parsed, Date.now())
}

// fileEditWarn=3로 낮춰 빠른 발화. 반복 카운트 검출은 비활성(임계 매우 높게).
const FILE_EDIT_CONFIG: DetectorConfig = {
  ...DEFAULT_DETECTOR_CONFIG,
  fileEditWarn: 3,
  fileEditCrit: 9,
  WARNING: 999,
  CRITICAL: 999,
  errLoopWarn: 999,
  errLoopCrit: 999,
  historySize: 30,
}

describe('M2 통합 — events 적재 → 구조 게이트 end-to-end', () => {
  test('같은 파일을 같은 영역에서 반복 편집하면 thrashing 후보가 발화한다', () => {
    const db = makeOpDb()
    const base = Date.parse('2026-06-01T00:00:00Z')
    // 같은 함수 본문을 미세 변형하며 3회 편집 (thrashing)
    const lines = [
      editLine('/proj/a.ts', 'function foo() { return 0; }', 'function foo() { return 1; }', base),
      editLine('/proj/a.ts', 'function foo() { return 1; }', 'function foo() { return 2; }', base),
      editLine('/proj/a.ts', 'function foo() { return 2; }', 'function foo() { return 3; }', base),
    ]
    ingest(db, lines)

    const hits = detectThrashingForSession(db, SESSION, FILE_EDIT_CONFIG)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    const last = hits[hits.length - 1]!
    expect(last.gate.type).toBe('thrashing')
    expect(last.gate.subtype).toBe('file_edit_loop')
    db.close()
  })

  test('서로 다른 영역을 편집하면(정상 진행) 발화하지 않는다', () => {
    const db = makeOpDb()
    const base = Date.parse('2026-06-01T01:00:00Z')
    // 매번 무관한 줄/심볼 편집 (정상)
    const lines = [
      editLine('/proj/b.ts', 'const alpha = 1', 'const alpha = 2', base),
      editLine('/proj/b.ts', 'let beta = true', 'let beta = false', base),
      editLine('/proj/b.ts', 'function gamma() {}', 'function gamma() { return 1 }', base),
    ]
    ingest(db, lines)

    const hits = detectThrashingForSession(db, SESSION, FILE_EDIT_CONFIG)
    expect(hits).toHaveLength(0)
    db.close()
  })

  test('fileEditWarn 미만 편집은 발화하지 않는다 (경계)', () => {
    const db = makeOpDb()
    const base = Date.parse('2026-06-01T02:00:00Z')
    const lines = [
      editLine('/proj/c.ts', 'function foo() { return 0; }', 'function foo() { return 1; }', base),
      editLine('/proj/c.ts', 'function foo() { return 1; }', 'function foo() { return 2; }', base),
    ] // 2회 < fileEditWarn(3)
    ingest(db, lines)

    const hits = detectThrashingForSession(db, SESSION, FILE_EDIT_CONFIG)
    expect(hits).toHaveLength(0)
    db.close()
  })

  test('빈 세션(events 없음)은 빈 결과를 반환한다', () => {
    const db = makeOpDb()
    const hits = detectThrashingForSession(db, 'no-such-session', FILE_EDIT_CONFIG)
    expect(hits).toHaveLength(0)
    db.close()
  })
})
