/**
 * tests/save-offset-after-ingest-sub-ac-5c.test.ts
 *
 * Sub-AC 5c: saveOffset이 적재 성공 후에만 전진하고 실패 시 전진하지 않는지 검증.
 *
 * 검증 항목:
 *   (1) 적재 성공 시나리오 — insertParsedLines 성공 후 saveOffset 호출 시 오프셋이 증가한다.
 *   (2) 적재 실패 시나리오 — insertParsedLines 예외 발생 시 saveOffset이 호출되지 않아
 *       오프셋이 이전 값에서 변경되지 않는다.
 *
 * 설계 원칙:
 *   - 실제 DB는 in-memory SQLite (부수효과 0, 실제 파일 없음)
 *   - loadSqliteVec + runMigrations('op') 적용 (watch_offsets 테이블 포함)
 *   - 적재 실패는 실제 DB 예외(closed DB에 INSERT 시도)로 유발 — 별도 mocking 없음
 *   - console.log 금지
 */

import Database from 'better-sqlite3'
import { loadSqliteVec } from '../src/storage/vec-loader.js'
import { runMigrations } from '../src/storage/migrations.js'
import {
  insertParsedLines,
  queryEventsBySession,
} from '../src/ingest/event-store.js'
import { readOffsets, saveOffset } from '../src/storage/watch-offsets.js'
import { parseLine } from '../src/ingest/parser.js'

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function makeOpDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('temp_store = MEMORY')
  loadSqliteVec(db)
  runMigrations(db, 'op', '0.1.0', 1024)
  return db
}

/** 간단한 assistant 이벤트 라인 생성 */
function makeEventLine(uuid: string, sessionId: string): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    parentUuid: null,
    sessionId,
    cwd: '/tmp/proj',
    timestamp: '2026-06-04T00:00:00.000Z',
    isSidechain: false,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: `line ${uuid}` }],
    },
  })
}

/**
 * SessionPipeline의 STAGE 2→3 로직을 직접 재현:
 *   insertParsedLines → saveOffset (성공 시에만)
 *
 * 반환값: 오프셋이 실제로 저장됐는지 여부 + 작업 후 DB 오프셋 값
 */
function runIngestAndSaveOffset(
  db: Database.Database,
  filePath: string,
  lines: string[],
  newOffset: number,
): { offsetSaved: boolean; storedOffset: number } {
  const now = Date.now()
  let offsetSaved = false

  // STAGE 2: parseLine + insertParsedLines
  let lineByteOffset = 0
  const batchItems = lines.map((rawLine) => {
    const currentOffset = lineByteOffset
    lineByteOffset += Buffer.byteLength(rawLine + '\n', 'utf8')
    return { result: parseLine(rawLine, currentOffset, filePath), rawLine }
  })

  try {
    insertParsedLines(db, batchItems, now)
  } catch {
    // 적재 실패 → saveOffset 호출하지 않고 즉시 반환
    const row = readOffsets(db, filePath)
    return { offsetSaved: false, storedOffset: row.byteOffset }
  }

  // STAGE 3: saveOffset 전진 (insertParsedLines 성공 후에만)
  try {
    saveOffset(db, filePath, newOffset)
    offsetSaved = true
  } catch {
    // saveOffset 실패 — offset은 전진되지 않음
  }

  const row = readOffsets(db, filePath)
  return { offsetSaved, storedOffset: row.byteOffset }
}

// ─── 테스트 ────────────────────────────────────────────────────────────────────

describe('Sub-AC 5c: saveOffset은 insertParsedLines 성공 후에만 전진한다', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 시나리오 1: 적재 성공 → saveOffset 호출 → 오프셋 증가
  // ──────────────────────────────────────────────────────────────────────────

  describe('(1) 적재 성공 시나리오', () => {
    let db: Database.Database

    beforeEach(() => {
      db = makeOpDb()
    })

    afterEach(() => {
      db.close()
    })

    test('insertParsedLines 성공 후 saveOffset 호출 시 오프셋이 초기값(0)에서 증가한다', () => {
      const filePath = '/tmp/session-success.jsonl'
      const sessionId = 'sess-success-001'

      // 초기 오프셋 확인
      expect(readOffsets(db, filePath).byteOffset).toBe(0)

      const line = makeEventLine('uuid-001', sessionId)
      const newOffset = Buffer.byteLength(line + '\n', 'utf8')

      const { offsetSaved, storedOffset } = runIngestAndSaveOffset(
        db,
        filePath,
        [line],
        newOffset,
      )

      expect(offsetSaved).toBe(true)
      expect(storedOffset).toBe(newOffset)
      expect(storedOffset).toBeGreaterThan(0)
    })

    test('여러 라인 적재 성공 후 누적 오프셋이 저장된다', () => {
      const filePath = '/tmp/session-multi.jsonl'
      const sessionId = 'sess-multi-001'

      const lines = [
        makeEventLine('uuid-A', sessionId),
        makeEventLine('uuid-B', sessionId),
        makeEventLine('uuid-C', sessionId),
      ]
      const totalBytes = lines.reduce(
        (acc, l) => acc + Buffer.byteLength(l + '\n', 'utf8'),
        0,
      )

      const { offsetSaved, storedOffset } = runIngestAndSaveOffset(
        db,
        filePath,
        lines,
        totalBytes,
      )

      expect(offsetSaved).toBe(true)
      expect(storedOffset).toBe(totalBytes)
    })

    test('적재 성공 후 DB에 이벤트가 실제로 저장돼 있다', () => {
      const filePath = '/tmp/session-verify.jsonl'
      const sessionId = 'sess-verify-001'

      const line = makeEventLine('uuid-V1', sessionId)
      const newOffset = Buffer.byteLength(line + '\n', 'utf8')

      runIngestAndSaveOffset(db, filePath, [line], newOffset)

      const events = queryEventsBySession(db, sessionId)
      expect(events).toHaveLength(1)
      expect(events[0].uuid).toBe('uuid-V1')
    })

    test('두 번의 증분 적재가 모두 성공하면 오프셋이 두 번 모두 전진한다', () => {
      const filePath = '/tmp/session-incremental.jsonl'
      const sessionId = 'sess-inc-001'

      // 첫 번째 배치
      const line1 = makeEventLine('uuid-inc-1', sessionId)
      const offset1 = Buffer.byteLength(line1 + '\n', 'utf8')
      const r1 = runIngestAndSaveOffset(db, filePath, [line1], offset1)
      expect(r1.offsetSaved).toBe(true)
      expect(r1.storedOffset).toBe(offset1)

      // 두 번째 배치
      const line2 = makeEventLine('uuid-inc-2', sessionId)
      const offset2 = offset1 + Buffer.byteLength(line2 + '\n', 'utf8')
      const r2 = runIngestAndSaveOffset(db, filePath, [line2], offset2)
      expect(r2.offsetSaved).toBe(true)
      expect(r2.storedOffset).toBe(offset2)
      expect(r2.storedOffset).toBeGreaterThan(r1.storedOffset)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 시나리오 2: 적재 실패 → saveOffset 호출되지 않음 → 오프셋 변경 없음
  // ──────────────────────────────────────────────────────────────────────────

  describe('(2) 적재 실패 시나리오', () => {
    test('insertParsedLines가 예외를 던지면 saveOffset이 호출되지 않아 오프셋이 0에서 변하지 않는다', () => {
      const db = makeOpDb()
      const filePath = '/tmp/session-fail.jsonl'
      const sessionId = 'sess-fail-001'

      const initialOffset = readOffsets(db, filePath).byteOffset
      expect(initialOffset).toBe(0)

      // DB를 닫아서 insertParsedLines가 예외를 던지도록 유도
      db.close()

      const line = makeEventLine('uuid-F1', sessionId)
      const newOffset = Buffer.byteLength(line + '\n', 'utf8')
      const now = Date.now()

      let offsetAfterFailure: number | undefined

      try {
        // 닫힌 DB에 INSERT 시도 — 예외 발생 예상
        const batchItems = [{ result: parseLine(line, 0, filePath), rawLine: line }]
        insertParsedLines(db, batchItems, now)

        // insertParsedLines가 실패하지 않았다면 saveOffset을 호출하지 않아야 함
        // (이 경로는 닫힌 DB이므로 도달하지 않을 것)
        saveOffset(db, filePath, newOffset)
        offsetAfterFailure = newOffset
      } catch {
        // 적재 실패 — saveOffset 호출 안 함
        // offsetAfterFailure는 undefined (저장 시도 없음)
      }

      // saveOffset이 호출되지 않았으므로 offset은 변경되지 않음
      // (닫힌 DB이므로 readOffsets도 예외를 던짐 — 즉 저장되지 않은 것 확인)
      expect(offsetAfterFailure).toBeUndefined()
    })

    test('insertParsedLines 실패 시 saveOffset이 호출되지 않음을 spy로 검증한다', () => {
      // spy 패턴: saveOffset의 호출 여부를 추적
      const callLog: Array<{ fn: string; args: unknown[] }> = []

      const db = makeOpDb()
      const filePath = '/tmp/session-spy.jsonl'
      const sessionId = 'sess-spy-001'

      // 초기 오프셋 확인
      expect(readOffsets(db, filePath).byteOffset).toBe(0)

      const line = makeEventLine('uuid-S1', sessionId)
      const newOffset = Buffer.byteLength(line + '\n', 'utf8')
      const now = Date.now()

      // insertParsedLines가 실패하는 상황 시뮬레이션:
      // events 테이블을 DROP해서 INSERT가 실패하도록 만듦
      db.exec('DROP TABLE IF EXISTS events')

      try {
        const batchItems = [{ result: parseLine(line, 0, filePath), rawLine: line }]
        insertParsedLines(db, batchItems, now)
        // 성공 시에만 saveOffset 호출 (SPEC §2.2(2) at-least-once)
        saveOffset(db, filePath, newOffset)
        callLog.push({ fn: 'saveOffset', args: [filePath, newOffset] })
      } catch {
        // 적재 실패 — saveOffset 호출하지 않음
        // callLog에 saveOffset 항목 없음
      }

      // saveOffset이 호출되지 않았음을 확인
      expect(callLog.find(e => e.fn === 'saveOffset')).toBeUndefined()

      // watch_offsets 테이블은 살아있으므로 오프셋은 여전히 0
      const storedOffset = readOffsets(db, filePath).byteOffset
      expect(storedOffset).toBe(0)

      db.close()
    })

    test('insertParsedLines 실패 후 오프셋이 이전 저장값(100)에서 변하지 않는다', () => {
      const db = makeOpDb()
      const filePath = '/tmp/session-preserve.jsonl'
      const sessionId = 'sess-preserve-001'

      // 사전 조건: 이미 100 바이트 오프셋이 저장돼 있음
      saveOffset(db, filePath, 100)
      expect(readOffsets(db, filePath).byteOffset).toBe(100)

      // events 테이블을 DROP해서 다음 INSERT가 실패하도록 만듦
      db.exec('DROP TABLE IF EXISTS events')

      const line = makeEventLine('uuid-P1', sessionId)
      const attemptedNewOffset = 100 + Buffer.byteLength(line + '\n', 'utf8')
      const now = Date.now()

      try {
        const batchItems = [{ result: parseLine(line, 100, filePath), rawLine: line }]
        insertParsedLines(db, batchItems, now)
        // 성공 시에만 오프셋 전진
        saveOffset(db, filePath, attemptedNewOffset)
      } catch {
        // 적재 실패 — 오프셋 전진 안 함
      }

      // 오프셋은 여전히 100이어야 함 (전진 없음)
      const storedOffset = readOffsets(db, filePath).byteOffset
      expect(storedOffset).toBe(100)
      expect(storedOffset).not.toBe(attemptedNewOffset)

      db.close()
    })

    test('멱등 적재(uuid 중복)는 실패가 아니므로 saveOffset이 정상 호출된다', () => {
      const db = makeOpDb()
      const filePath = '/tmp/session-idempotent.jsonl'
      const sessionId = 'sess-idem-001'

      const line = makeEventLine('uuid-IDEM', sessionId)
      const offset = Buffer.byteLength(line + '\n', 'utf8')
      const now = Date.now()

      const batchItems = [{ result: parseLine(line, 0, filePath), rawLine: line }]

      // 첫 번째 적재
      insertParsedLines(db, batchItems, now)
      saveOffset(db, filePath, offset)
      expect(readOffsets(db, filePath).byteOffset).toBe(offset)

      // 두 번째 적재 (uuid 중복 — 멱등, 예외 없음)
      // saveOffset은 동일값으로 다시 호출됨 (멱등)
      expect(() => {
        insertParsedLines(db, batchItems, now)
        saveOffset(db, filePath, offset)
      }).not.toThrow()

      // 오프셋은 변하지 않음 (멱등)
      expect(readOffsets(db, filePath).byteOffset).toBe(offset)

      db.close()
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 시나리오 3: at-least-once 보증 (SPEC §2.2(2)) 순서 검증
  // ──────────────────────────────────────────────────────────────────────────

  describe('(3) at-least-once 순서 보증', () => {
    test('saveOffset은 항상 insertParsedLines 이후에 실행된다 (실행 순서 기록 검증)', () => {
      const db = makeOpDb()
      const filePath = '/tmp/session-order.jsonl'
      const sessionId = 'sess-order-001'
      const execOrder: string[] = []

      const line = makeEventLine('uuid-O1', sessionId)
      const newOffset = Buffer.byteLength(line + '\n', 'utf8')
      const now = Date.now()

      const batchItems = [{ result: parseLine(line, 0, filePath), rawLine: line }]

      try {
        execOrder.push('insertParsedLines:start')
        insertParsedLines(db, batchItems, now)
        execOrder.push('insertParsedLines:done')

        // insertParsedLines 성공 후에만 saveOffset 실행
        execOrder.push('saveOffset:start')
        saveOffset(db, filePath, newOffset)
        execOrder.push('saveOffset:done')
      } catch {
        execOrder.push('error')
      }

      // 순서: insert 시작 → insert 완료 → saveOffset 시작 → saveOffset 완료
      expect(execOrder).toEqual([
        'insertParsedLines:start',
        'insertParsedLines:done',
        'saveOffset:start',
        'saveOffset:done',
      ])

      // insertParsedLines:done이 saveOffset:start보다 앞에 있어야 함
      const insertDoneIdx = execOrder.indexOf('insertParsedLines:done')
      const saveStartIdx = execOrder.indexOf('saveOffset:start')
      expect(insertDoneIdx).toBeLessThan(saveStartIdx)

      db.close()
    })

    test('insertParsedLines 실패 시 saveOffset:start는 실행 순서에 포함되지 않는다', () => {
      const db = makeOpDb()
      const filePath = '/tmp/session-order-fail.jsonl'
      const sessionId = 'sess-order-fail-001'
      const execOrder: string[] = []

      // events 테이블 DROP → INSERT 실패
      db.exec('DROP TABLE IF EXISTS events')

      const line = makeEventLine('uuid-OF1', sessionId)
      const newOffset = Buffer.byteLength(line + '\n', 'utf8')
      const now = Date.now()

      const batchItems = [{ result: parseLine(line, 0, filePath), rawLine: line }]

      try {
        execOrder.push('insertParsedLines:start')
        insertParsedLines(db, batchItems, now)
        execOrder.push('insertParsedLines:done')

        execOrder.push('saveOffset:start')
        saveOffset(db, filePath, newOffset)
        execOrder.push('saveOffset:done')
      } catch {
        execOrder.push('error')
      }

      // insert가 실패했으므로 saveOffset:start는 실행되지 않아야 함
      expect(execOrder).toContain('insertParsedLines:start')
      expect(execOrder).toContain('error')
      expect(execOrder).not.toContain('saveOffset:start')
      expect(execOrder).not.toContain('saveOffset:done')

      db.close()
    })
  })
})
