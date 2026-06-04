/**
 * daemon/session-pipeline.ts — 세션당 직렬 처리 파이프라인
 *
 * SPEC §3.1 '세션별 직렬 큐':
 *   - 세션당 1 인스턴스, concurrency=1 직렬 EventQueue(SerialQueue)
 *   - enqueue('change')가 tail→parse→적재→offset전진→gate→bridge→m3→dispatch를 직렬로 수행
 *   - maxQueueDepth 기본 1000, 초과 시 COALESCE (change 중복 skip)
 *   - 세션 격리: 한 파이프라인의 예외가 다른 세션/데몬 전체를 죽이지 않음
 *
 * SPEC §4 장애처리:
 *   - per-line try/catch: JSON.parse 실패는 skip+카운트, 파이프라인 계속
 *   - API 실패는 fail-closed(M3 계승), 세션 파이프라인을 죽이지 않음
 *   - 부분 라인(종결 개행 없음)은 _partialLine에 보관
 *   - 모든 degrade는 구조화 로그/카운터로 가시화 (console.log 금지)
 *
 * 설계 원칙:
 *   - 불변성: 새 객체 반환, 입력 변경 금지
 *   - console.log 금지 (주입된 logger 또는 구조화 이벤트 사용)
 *   - chokidar 직접 import 금지 (WatchSource 인터페이스에만 의존)
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type Database from 'better-sqlite3'
import type { DetectorConfig } from '../contracts.js'
import type { EmbedClient } from '../api/embed-client.js'
import type { JudgeClient } from '../api/judge-client.js'
import type { NotifyDispatcher } from '../notify/notify-dispatcher.js'
import { SerialQueue } from './serial-queue.js'
import { insertParsedLines, queryEventsBySession } from '../ingest/event-store.js'
import { readOffsets, saveOffset } from '../storage/watch-offsets.js'
import { parseLine } from '../ingest/parser.js'
import { runStructuralGateOverEvents } from '../detect/detection-pipeline.js'
import { hitsToTriples, makeEventLookupFromArray } from '../detect/hits-to-triples.js'
import { runM3Pipeline } from '../detect/m3-pipeline.js'

// ─── 로거 인터페이스 ──────────────────────────────────────────────────────────

export interface SessionPipelineLogger {
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
}

/** no-op 기본 로거 */
const noopLogger: SessionPipelineLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

// ─── 의존성 인터페이스 ────────────────────────────────────────────────────────

export interface SessionPipelineDeps {
  /** op DB 핸들 */
  readonly db: Database.Database
  /** 평면 DetectorConfig */
  readonly detectorConfig: DetectorConfig
  /** Embed 클라이언트 (Mock or Real) */
  readonly embedClient: EmbedClient
  /** Judge 클라이언트 (Mock or Real) */
  readonly judgeClient: JudgeClient
  /** 알림 디스패처 */
  readonly dispatcher: NotifyDispatcher
  /** 구조화 로거 (옵션) */
  readonly logger?: SessionPipelineLogger
}

// ─── SessionPipeline ─────────────────────────────────────────────────────────

/**
 * 세션당 1 인스턴스를 갖는 직렬 처리 파이프라인.
 *
 * 내부적으로 SerialQueue(maxDepth=1000)를 사용해
 * 파일 증분 읽기 → parseLine → insertParsedLines → saveOffset →
 * queryEventsBySession → gate → hits→triples → runM3Pipeline → dispatch를
 * concurrency=1로 직렬 실행한다.
 */
export class SessionPipeline {
  /** 세션 식별자 */
  readonly sessionId: string

  /** 감시 대상 파일 경로 */
  readonly filePath: string

  /** 내부 직렬 큐 */
  private readonly _queue: SerialQueue

  /** 의존성 */
  private readonly _deps: SessionPipelineDeps

  /** 구조화 로거 */
  private readonly _logger: SessionPipelineLogger

  /** 스킵된 알 수 없는 라인 카운터 (SPEC §4) */
  private _skippedUnknownCount = 0

  /** 현재 바이트 오프셋 */
  private _byteOffset = 0

  /** 부분 라인 버퍼 */
  private _partialLine = ''

  constructor(
    sessionId: string,
    filePath: string,
    deps: SessionPipelineDeps,
    maxQueueDepth = 1000,
  ) {
    this.sessionId = sessionId
    this.filePath = filePath
    this._deps = deps
    this._logger = deps.logger ?? noopLogger
    this._queue = new SerialQueue(maxQueueDepth)

    // DB에서 저장된 오프셋 복원 (동기)
    try {
      const row = readOffsets(deps.db, filePath)
      this._byteOffset = row.byteOffset
      this._partialLine = row.partialBuffer ?? ''
    } catch (err) {
      this._logger.warn('session-pipeline: 오프셋 복원 실패, 0부터 시작', {
        sessionId,
        filePath,
        error: String(err),
      })
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * 파일 변경 신호를 큐에 enqueue한다.
   * maxDepth 초과 시 COALESCE (skip) — TailReader가 EOF까지 흡수하므로 안전.
   *
   * 내부적으로 파일 증분 read → parseLine → insertParsedLines →
   * saveOffset → queryEventsBySession → gate → bridge → runM3Pipeline → dispatch를
   * 직렬로 수행한다.
   */
  enqueueChange(): Promise<void> {
    return this._queue.enqueue(() => this._processChange())
  }

  /**
   * 큐 drain 후 파이프라인을 닫는다.
   * 세션 파일 unlink 시 호출.
   */
  async drainAndClose(): Promise<void> {
    await this._queue.drainAndClose()
  }

  /** 스킵된 알 수 없는 라인 카운터 */
  get skippedUnknownCount(): number {
    return this._skippedUnknownCount
  }

  /** 현재 바이트 오프셋 */
  get byteOffset(): number {
    return this._byteOffset
  }

  /** 부분 라인 버퍼 */
  get partialLine(): string {
    return this._partialLine
  }

  /** 큐가 닫혔는지 여부 */
  get isClosed(): boolean {
    return this._queue.isClosed
  }

  /** 대기 중 + 실행 중 작업 수 */
  get pendingCount(): number {
    return this._queue.pendingCount
  }

  // ─── 내부 파이프라인 ──────────────────────────────────────────────────────

  /**
   * 파일에서 새 바이트를 증분 읽어 파이프라인을 실행한다.
   * SPEC §3.1: 직렬 큐 내부에서만 호출된다.
   */
  private async _processChange(): Promise<void> {
    const { db, detectorConfig, embedClient, judgeClient, dispatcher } = this._deps

    // ── STAGE 1: 파일 증분 읽기 ──────────────────────────────────────────────
    let newLines: string[] = []
    let newOffset = this._byteOffset
    let newPartial = this._partialLine

    try {
      const result = await this._readIncremental(this._byteOffset, this._partialLine)
      newLines = result.lines
      newOffset = result.newOffset
      newPartial = result.newPartial
    } catch (err) {
      this._logger.error('session-pipeline: 파일 읽기 실패', {
        sessionId: this.sessionId,
        filePath: this.filePath,
        error: String(err),
      })
      return
    }

    if (newLines.length === 0) return

    // ── STAGE 2: parseLine + insertParsedLines (멱등) ─────────────────────────
    const now = Date.now()
    const batchItems: Array<{ result: ReturnType<typeof parseLine>; rawLine: string }> = []

    // Track per-line byte offsets for accurate byteOffset in ParseLineResult
    let lineByteOffset = this._byteOffset
    for (const rawLine of newLines) {
      const currentLineOffset = lineByteOffset
      lineByteOffset += Buffer.byteLength(rawLine + '\n', 'utf8')
      try {
        const result = parseLine(rawLine, currentLineOffset, this.filePath)
        batchItems.push({ result, rawLine })
      } catch (err) {
        // per-line try/catch: skip + 카운터 (SPEC §4a)
        this._skippedUnknownCount++
        this._logger.warn('session-pipeline: parseLine 실패, skip', {
          sessionId: this.sessionId,
          rawLine: rawLine.slice(0, 200),
          error: String(err),
        })
      }
    }

    if (batchItems.length > 0) {
      try {
        insertParsedLines(db, batchItems, now)
      } catch (err) {
        this._logger.error('session-pipeline: insertParsedLines 실패', {
          sessionId: this.sessionId,
          error: String(err),
        })
        return
      }
    }

    // ── STAGE 3: saveOffset 전진 (insertParsedLines 성공 후에만) ─────────────
    try {
      saveOffset(db, this.filePath, newOffset)
      this._byteOffset = newOffset
      this._partialLine = newPartial
    } catch (err) {
      this._logger.error('session-pipeline: saveOffset 실패', {
        sessionId: this.sessionId,
        error: String(err),
      })
    }

    // ── STAGE 4: queryEventsBySession → structuralGate ────────────────────────
    let hits: ReturnType<typeof runStructuralGateOverEvents>
    try {
      const events = queryEventsBySession(db, this.sessionId)
      hits = runStructuralGateOverEvents(events, detectorConfig)
    } catch (err) {
      this._logger.error('session-pipeline: 구조 게이트 실패', {
        sessionId: this.sessionId,
        error: String(err),
      })
      return
    }

    if (hits.length === 0) return

    // ── STAGE 5: hits→triples bridge ─────────────────────────────────────────
    let bridgeResult: Awaited<ReturnType<typeof hitsToTriples>>
    try {
      const rawEvents = queryEventsBySession(db, this.sessionId)
      // detection-pipeline::toGateEvent と同一ロジック:
      // tool フィールドが存在するイベントは kind='tool_use' に正規化して
      // buildTriple が正しくトリプルを生成できるようにする。
      // 原本 DB レコードは変更しない (Object.freeze で新オブジェクト生成)。
      const events = rawEvents.map(ev => {
        if (ev.kind === 'tool_use') return ev
        if (ev.tool !== undefined && ev.tool !== null && ev.input !== undefined) {
          return Object.freeze({ ...ev, kind: 'tool_use' as const })
        }
        return ev
      })
      const lookup = makeEventLookupFromArray(events)
      bridgeResult = await hitsToTriples(hits, lookup)
    } catch (err) {
      this._logger.error('session-pipeline: hits→triples bridge 실패', {
        sessionId: this.sessionId,
        error: String(err),
      })
      return
    }

    if (bridgeResult.hits.length === 0) return

    // ── STAGE 6: runM3Pipeline → DetectionRecord[] ────────────────────────────
    let records: Awaited<ReturnType<typeof runM3Pipeline>>
    try {
      records = await runM3Pipeline(
        bridgeResult.hits,
        bridgeResult.triples,
        { embedClient, judgeClient, config: detectorConfig },
      )
    } catch (err) {
      // API 실패는 fail-closed(M3 계승) — 세션 파이프라인을 죽이지 않음 (SPEC §4d)
      this._logger.error('session-pipeline: runM3Pipeline 실패 (fail-closed)', {
        sessionId: this.sessionId,
        error: String(err),
      })
      return
    }

    // ── STAGE 7: NotifyDispatcher ─────────────────────────────────────────────
    for (const record of records) {
      try {
        await dispatcher.dispatch(record, this.sessionId)
      } catch (err) {
        this._logger.error('session-pipeline: dispatch 실패', {
          sessionId: this.sessionId,
          error: String(err),
        })
      }
    }
  }

  // ─── 증분 읽기 헬퍼 ──────────────────────────────────────────────────────

  /**
   * 파일에서 byteOffset부터 새 바이트를 읽어 완결 라인을 반환한다.
   * 부분 라인(종결 개행 없음)은 newPartial에 보관.
   * SPEC §4e: byteOffset은 마지막 완결 라인까지만 전진.
   */
  private async _readIncremental(
    byteOffset: number,
    partialLine: string,
  ): Promise<{ lines: string[]; newOffset: number; newPartial: string }> {
    let fileSize: number
    try {
      const stats = await stat(this.filePath)
      fileSize = stats.size
    } catch {
      // 파일이 없거나 접근 불가 — 빈 결과 반환
      return { lines: [], newOffset: byteOffset, newPartial: partialLine }
    }

    if (fileSize <= byteOffset) {
      return { lines: [], newOffset: byteOffset, newPartial: partialLine }
    }

    // 새 바이트 읽기
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(this.filePath, { start: byteOffset } as Parameters<typeof createReadStream>[1])
      stream.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
      })
      stream.on('end', () => resolve())
      stream.on('error', reject)
    })

    const rawText = partialLine + Buffer.concat(chunks).toString('utf8')
    const parts = rawText.split('\n')

    // 마지막 부분이 개행으로 끝나지 않으면 partial로 보관
    const newPartial = parts[parts.length - 1] ?? ''
    const completeLines = parts.slice(0, -1).filter(l => l.length > 0)

    // 완결 라인까지의 바이트 수만 offset 전진
    const completedText = completeLines.join('\n') + (completeLines.length > 0 ? '\n' : '')
    const newOffset = byteOffset + Buffer.byteLength(completedText, 'utf8')

    return { lines: completeLines, newOffset, newPartial }
  }
}
