/**
 * src/eval/gold-label-store.ts
 *
 * M6 평가 하니스 — 골드 라벨 저장소.
 *
 * eval DB gold_labels 테이블에 GoldLabel 레코드를 삽입·조회하는 함수 모음.
 *
 * 규칙:
 *   - eval DB(gold_labels 테이블) 대상만. op DB는 절대 수정하지 않는다.
 *   - console.log 금지.
 *   - 불변성: 입력 GoldLabel 객체를 변경하지 않는다.
 *   - 멱등: label_id PK 충돌 시 INSERT OR IGNORE(중복 무시).
 *
 * BLOCKER C9:
 *   gold_labels.source CHECK ('live_jsonl'|'synthetic'|'dohyun_adapted')
 *   gold_labels.label_kind CHECK ('point'|'span'|'window')
 *   gold_labels.expected_signal CHECK ('thrashing'|'false_success'|'none')
 */

import type Database from 'better-sqlite3'
import type { GoldLabel } from './eval-contracts.js'

// ─── boolean ↔ SQLite INTEGER ─────────────────────────────────────────────────

function boolToInt(v: boolean): number {
  return v ? 1 : 0
}

// ─── insertGoldLabel ──────────────────────────────────────────────────────────

/**
 * 파싱된 GoldLabel 레코드를 eval DB의 gold_labels 테이블에 삽입한다.
 *
 * - label_id PK 충돌 시 INSERT OR IGNORE로 멱등 무시.
 * - BLOCKER C9: source/label_kind/expected_signal CHECK 제약은 DB가 검증.
 * - 동기 SQLite 삽입 (better-sqlite3 동기 API).
 *
 * @param db      eval DB 핸들 (gold_labels 테이블이 존재해야 함)
 * @param record  삽입할 GoldLabel
 * @returns       실제 INSERT됐으면 true, label_id 중복으로 무시됐으면 false
 */
export function insertGoldLabel(
  db: Database.Database,
  record: GoldLabel,
): boolean {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO gold_labels (
      label_id,
      label_kind,
      anchor_uuid,
      start_uuid,
      end_uuid,
      window_id,
      session_id,
      expected_signal,
      source,
      labeler_id,
      label_round,
      labeled_at,
      notes
    ) VALUES (
      @labelId,
      @labelKind,
      @anchorUuid,
      @startUuid,
      @endUuid,
      @windowId,
      @sessionId,
      @expectedSignal,
      @source,
      @labelerId,
      @labelRound,
      @labeledAt,
      @notes
    )
  `)

  const info = stmt.run({
    labelId:        record.labelId,
    labelKind:      record.labelKind,
    anchorUuid:     record.anchorUuid ?? null,
    startUuid:      record.startUuid ?? null,
    endUuid:        record.endUuid ?? null,
    windowId:       record.windowId ?? null,
    sessionId:      record.sessionId,
    expectedSignal: record.expectedSignal,
    source:         record.source,
    labelerId:      record.labelerId,
    labelRound:     record.labelRound,
    labeledAt:      record.labeledAt,
    notes:          record.notes ?? null,
  })

  return info.changes > 0
}

// ─── insertGoldLabels ─────────────────────────────────────────────────────────

/**
 * GoldLabel 배열을 순차적으로 eval DB에 삽입한다.
 *
 * - 전체를 단일 트랜잭션으로 감싸 원자성을 보장한다.
 * - 각 레코드는 label_id PK 충돌 시 멱등 무시 (INSERT OR IGNORE).
 *
 * @param db      eval DB 핸들
 * @param records 삽입할 GoldLabel 배열
 * @returns       실제 INSERT된 행 수 (중복 무시된 건은 제외)
 */
export function insertGoldLabels(
  db: Database.Database,
  records: readonly GoldLabel[],
): number {
  if (records.length === 0) return 0

  let insertedCount = 0

  const tx = db.transaction(() => {
    for (const record of records) {
      if (insertGoldLabel(db, record)) {
        insertedCount++
      }
    }
  })

  tx()
  return insertedCount
}

// ─── queryGoldLabelsBySession ─────────────────────────────────────────────────

/**
 * 특정 세션의 모든 GoldLabel을 labeled_at 오름차순으로 조회한다.
 *
 * @param db        eval DB 핸들
 * @param sessionId 세션 ID
 * @returns         GoldLabel 배열 (없으면 빈 배열)
 */
export function queryGoldLabelsBySession(
  db: Database.Database,
  sessionId: string,
): GoldLabel[] {
  type Row = {
    label_id:        string
    label_kind:      'point' | 'span' | 'window'
    anchor_uuid:     string | null
    start_uuid:      string | null
    end_uuid:        string | null
    window_id:       string | null
    session_id:      string
    expected_signal: 'thrashing' | 'false_success' | 'none'
    source:          'live_jsonl' | 'synthetic' | 'dohyun_adapted'
    labeler_id:      string
    label_round:     number
    labeled_at:      number
    notes:           string | null
  }

  const rows = db.prepare(`
    SELECT
      label_id, label_kind, anchor_uuid, start_uuid, end_uuid, window_id,
      session_id, expected_signal, source, labeler_id, label_round, labeled_at, notes
    FROM gold_labels
    WHERE session_id = ?
    ORDER BY labeled_at ASC
  `).all(sessionId) as Row[]

  return rows.map((row) => ({
    labelId:        row.label_id,
    labelKind:      row.label_kind,
    anchorUuid:     row.anchor_uuid ?? undefined,
    startUuid:      row.start_uuid ?? undefined,
    endUuid:        row.end_uuid ?? undefined,
    windowId:       row.window_id ?? undefined,
    sessionId:      row.session_id,
    expectedSignal: row.expected_signal,
    source:         row.source,
    labelerId:      row.labeler_id,
    labelRound:     row.label_round,
    labeledAt:      row.labeled_at,
    notes:          row.notes ?? undefined,
  }))
}

// ─── countGoldLabels ──────────────────────────────────────────────────────────

/**
 * gold_labels 테이블의 전체 행 수를 반환한다.
 * 단위 테스트 및 상태 확인용.
 *
 * @param db eval DB 핸들
 * @returns  전체 행 수
 */
export function countGoldLabels(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM gold_labels').get() as { cnt: number }
  return row.cnt
}
