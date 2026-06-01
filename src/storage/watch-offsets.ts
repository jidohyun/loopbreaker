/**
 * storage/watch-offsets.ts — watch_offsets 테이블 읽기/쓰기
 *
 * Sub-AC 5c: readOffsets / saveOffset 함수 쌍.
 * - readOffsets(db, filePath): 저장된 오프셋 행을 반환. 최초 읽기 시 0(byte_offset) 반환.
 * - saveOffset(db, filePath, byteOffset): byte_offset을 원자적으로 upsert.
 *
 * 규칙:
 * - 불변성: 입력 객체 변경 금지
 * - 에러 처리: 모든 DB 오류를 감싸서 상세 메시지와 함께 rethrow
 * - console.log 금지
 * - zod 입력 검증
 */

import type Database from 'better-sqlite3'
import { z } from 'zod'

// ---- Zod 입력 스키마 ----

const FilePathSchema = z.string().min(1, 'filePath must be non-empty')
const ByteOffsetSchema = z.number().int().min(0, 'byteOffset must be a non-negative integer')

// ---- WatchOffsetRow 타입 ----

/**
 * watch_offsets 테이블의 한 행을 나타내는 읽기 전용 타입.
 * DB에서 조회한 원시 값을 그대로 보유.
 */
export interface WatchOffsetRow {
  readonly filePath: string
  readonly inode: number
  readonly dev: number
  readonly byteOffset: number
  readonly lastCompleteLineOffset: number
  readonly partialBuffer: string
  readonly fileSize: number
  readonly lastEventUuid: string | null
  readonly rotationSeq: number
  readonly updatedAt: number
  readonly status: 'active' | 'rotated' | 'missing' | 'error'
  readonly lastError: string | null
}

// ---- 내부 DB 행 매핑 타입 ----

interface RawWatchOffsetRow {
  file_path: string
  inode: number
  dev: number
  byte_offset: number
  last_complete_line_offset: number
  partial_buffer: string
  file_size: number
  last_event_uuid: string | null
  rotation_seq: number
  updated_at: number
  status: string
  last_error: string | null
}

// ---- 변환 함수 ----

function toWatchOffsetRow(raw: RawWatchOffsetRow): WatchOffsetRow {
  return {
    filePath: raw.file_path,
    inode: raw.inode,
    dev: raw.dev,
    byteOffset: raw.byte_offset,
    lastCompleteLineOffset: raw.last_complete_line_offset,
    partialBuffer: raw.partial_buffer,
    fileSize: raw.file_size,
    lastEventUuid: raw.last_event_uuid,
    rotationSeq: raw.rotation_seq,
    updatedAt: raw.updated_at,
    status: raw.status as WatchOffsetRow['status'],
    lastError: raw.last_error,
  }
}

// ---- 공개 API ----

/**
 * watch_offsets 테이블에서 filePath에 해당하는 행을 반환한다.
 *
 * - 행이 존재하면 WatchOffsetRow를 반환.
 * - 행이 없으면 byteOffset=0인 기본값 객체를 반환 (최초 파일 처음부터 파싱).
 * - DB 오류는 래핑해서 rethrow.
 *
 * @param db      better-sqlite3 DB 인스턴스 (watch_offsets 테이블이 있어야 함)
 * @param filePath 감시할 JSONL 파일의 절대 경로
 * @returns       저장된 WatchOffsetRow, 또는 byteOffset=0인 초기 기본 행
 */
export function readOffsets(
  db: Database.Database,
  filePath: string,
): WatchOffsetRow {
  const validPath = FilePathSchema.parse(filePath)

  try {
    const row = db
      .prepare<[string], RawWatchOffsetRow>(
        'SELECT * FROM watch_offsets WHERE file_path = ?',
      )
      .get(validPath)

    if (row == null) {
      // 최초 읽기 — 기본 행 반환 (byteOffset = 0)
      return {
        filePath: validPath,
        inode: 0,
        dev: 0,
        byteOffset: 0,
        lastCompleteLineOffset: 0,
        partialBuffer: '',
        fileSize: 0,
        lastEventUuid: null,
        rotationSeq: 0,
        updatedAt: 0,
        status: 'active',
        lastError: null,
      }
    }

    return toWatchOffsetRow(row)
  } catch (err) {
    if (err instanceof z.ZodError) throw err
    throw new Error(
      `readOffsets: DB 조회 실패 (filePath=${validPath}): ${String(err)}`,
    )
  }
}

/**
 * watch_offsets 테이블에 filePath의 byte_offset을 저장(upsert)한다.
 *
 * - 행이 없으면 INSERT, 있으면 byte_offset + updated_at만 UPDATE.
 * - inode/dev/file_size는 0 기본값으로 채운다(파일 메타 미수집 시).
 * - 원자적 단일 트랜잭션 실행.
 * - DB 오류는 래핑해서 rethrow.
 *
 * @param db         better-sqlite3 DB 인스턴스
 * @param filePath   감시 중인 JSONL 파일의 절대 경로
 * @param byteOffset 저장할 바이트 오프셋 (≥0, 정수)
 */
export function saveOffset(
  db: Database.Database,
  filePath: string,
  byteOffset: number,
): void {
  const validPath = FilePathSchema.parse(filePath)
  const validOffset = ByteOffsetSchema.parse(byteOffset)

  const now = Date.now()

  try {
    db.prepare<[string, number, number, number]>(`
      INSERT INTO watch_offsets
        (file_path, inode, dev, byte_offset, last_complete_line_offset,
         partial_buffer, file_size, last_event_uuid, rotation_seq,
         updated_at, status, last_error)
      VALUES
        (?, 0, 0, ?, ?, '', 0, NULL, 0, ?, 'active', NULL)
      ON CONFLICT(file_path) DO UPDATE SET
        byte_offset  = excluded.byte_offset,
        updated_at   = excluded.updated_at
    `).run(validPath, validOffset, validOffset, now)
  } catch (err) {
    if (err instanceof z.ZodError) throw err
    throw new Error(
      `saveOffset: DB 저장 실패 (filePath=${validPath}, byteOffset=${validOffset}): ${String(err)}`,
    )
  }
}
