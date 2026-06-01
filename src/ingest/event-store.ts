// src/ingest/event-store.ts
// 파서가 만든 NormalizedEvent(+파싱 결과)를 events 테이블에 적재하고 재조회한다.
// M1 적재 글루: parser.ts(ParseLineResult) → M0 events 스키마(migrations.ts).
//
// 무손실 보증:
//   - 모든 라인을 raw_json으로 보존하고, 파싱 실패는 parse_ok=0 + parse_error로 격리 저장(중단 없음).
//   - uuid PK 충돌은 멱등 무시(INSERT OR IGNORE) — at-least-once 재주입에도 중복 없음.
//   - byteOffset은 events에 저장하지 않음(watch_offsets 담당) — contracts 주석 정본.
//
// BLOCKER C5: contracts 컬럼명 사용(cwd, agent_scope, is_sidechain, kind, tool, input_json, result_class).

import type Database from 'better-sqlite3'
import type { NormalizedEvent } from '../contracts.js'
import type { ParseLineResult } from './parser.js'

/** events 테이블 한 행(재조회 결과). NormalizedEvent + 적재 메타. */
export interface StoredEvent extends NormalizedEvent {
  /** 파싱 성공 여부 (parse_ok 컬럼) */
  parseOk: boolean
  /** 파싱 실패 사유 (parse_ok=false일 때) */
  parseError?: string
  /** 적재 시각 (epoch ms) */
  ingestedAt: number
}

/** input?: unknown 을 JSON 문자열로 직렬화 (없으면 null) */
function serializeInput(input: unknown): string | null {
  if (input === undefined) return null
  try {
    return JSON.stringify(input)
  } catch {
    // 순환참조 등 직렬화 불가 → 표식 문자열 (무손실 원칙: 버리지 않고 흔적 남김)
    return JSON.stringify({ __unserializable: true })
  }
}

/** boolean → SQLite INTEGER */
function boolToInt(v: boolean): number {
  return v ? 1 : 0
}

/**
 * 단일 ParseLineResult를 events 테이블에 멱등 INSERT한다.
 * - parseOk=false면 parse_error를 기록하되 raw_json·최소 NormalizedEvent는 보존.
 * - uuid 충돌 시 무시(멱등).
 *
 * @returns 실제 INSERT됐으면 true, uuid 중복으로 무시됐으면 false
 */
export function insertParsedLine(
  db: Database.Database,
  result: ParseLineResult,
  rawLine: string,
  ingestedAt: number,
): boolean {
  const ev = result.event
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO events (
      uuid, parent_uuid, session_id, cwd, agent_scope, is_sidechain, ts, ingested_at,
      kind, tool, input_json, result_class, tool_use_id, text, reasoning,
      system_subtype, interrupted_message_id, raw_json, parse_ok, parse_error
    ) VALUES (
      @uuid, @parentUuid, @sessionId, @cwd, @agentScope, @isSidechain, @ts, @ingestedAt,
      @kind, @tool, @inputJson, @resultClass, @toolUseId, @text, @reasoning,
      @systemSubtype, @interruptedMessageId, @rawJson, @parseOk, @parseError
    )
  `)

  const info = stmt.run({
    uuid: ev.uuid,
    parentUuid: ev.parentUuid,
    sessionId: ev.sessionId,
    cwd: ev.cwd,
    agentScope: ev.agentScope,
    isSidechain: boolToInt(ev.isSidechain),
    ts: ev.ts,
    ingestedAt,
    kind: ev.kind,
    tool: ev.tool ?? null,
    inputJson: serializeInput(ev.input),
    resultClass: ev.resultClass ?? null,
    toolUseId: ev.toolUseId ?? null,
    text: ev.text ?? null,
    reasoning: ev.reasoning ?? null,
    systemSubtype: ev.systemSubtype ?? null,
    interruptedMessageId: ev.interruptedMessageId ?? null,
    rawJson: rawLine,
    parseOk: boolToInt(result.parseOk),
    parseError: result.parseError ?? null,
  })

  return info.changes > 0
}

/**
 * 여러 ParseLineResult를 단일 트랜잭션으로 적재한다.
 *
 * @returns 실제 INSERT된 행 수(중복 제외)
 */
export function insertParsedLines(
  db: Database.Database,
  results: readonly { result: ParseLineResult; rawLine: string }[],
  ingestedAt: number,
): number {
  const tx = db.transaction((items: readonly { result: ParseLineResult; rawLine: string }[]) => {
    let inserted = 0
    for (const item of items) {
      if (insertParsedLine(db, item.result, item.rawLine, ingestedAt)) inserted += 1
    }
    return inserted
  })
  return tx(results)
}

/** SQLite 행 → StoredEvent 복원 (불변 객체) */
function rowToStoredEvent(row: Record<string, unknown>): StoredEvent {
  const base: StoredEvent = {
    uuid: row.uuid as string,
    parentUuid: (row.parent_uuid as string | null) ?? null,
    sessionId: row.session_id as string,
    cwd: row.cwd as string,
    agentScope: row.agent_scope as string,
    isSidechain: (row.is_sidechain as number) === 1,
    ts: row.ts as number,
    // byteOffset은 events에 없음 — 재조회 시 0 (watch_offsets가 진실의 원천)
    byteOffset: 0,
    kind: row.kind as NormalizedEvent['kind'],
    parseOk: (row.parse_ok as number) === 1,
    ingestedAt: row.ingested_at as number,
  }
  // 옵셔널 필드는 NULL이 아닐 때만 복원 (불변 — 새 객체 반환)
  return Object.freeze({
    ...base,
    ...(row.tool != null ? { tool: row.tool as string } : {}),
    ...(row.input_json != null ? { input: JSON.parse(row.input_json as string) as unknown } : {}),
    ...(row.result_class != null ? { resultClass: row.result_class as NormalizedEvent['resultClass'] } : {}),
    ...(row.tool_use_id != null ? { toolUseId: row.tool_use_id as string } : {}),
    ...(row.text != null ? { text: row.text as string } : {}),
    ...(row.reasoning != null ? { reasoning: row.reasoning as string } : {}),
    ...(row.system_subtype != null ? { systemSubtype: row.system_subtype as string } : {}),
    ...(row.interrupted_message_id != null ? { interruptedMessageId: row.interrupted_message_id as string } : {}),
    ...(row.parse_error != null ? { parseError: row.parse_error as string } : {}),
  })
}

/**
 * 한 세션의 events를 적재 순서(ingested_at, ts)로 재조회한다.
 * 리플레이 라운드트립 검증·후속 탐지(M2)가 사용.
 */
export function queryEventsBySession(
  db: Database.Database,
  sessionId: string,
): readonly StoredEvent[] {
  const rows = db.prepare(`
    SELECT * FROM events WHERE session_id = @sessionId ORDER BY ts, ingested_at
  `).all({ sessionId }) as Record<string, unknown>[]
  return rows.map(rowToStoredEvent)
}

/** events 전체 행 수 (라운드트립 카운트 검증용) */
export function countEvents(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }
  return row.n
}
