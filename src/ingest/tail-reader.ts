/**
 * ingest/tail-reader.ts — 바이트 오프셋 기반 증분 JSONL 테일 리더
 *
 * TailReader:
 *   - 파일 경로와 라인 콜백을 받아 초기 오프셋을 0으로 설정
 *   - chokidar로 파일 변경을 감지해 새 바이트만 증분 읽기
 *   - 미완성 부분 라인(fsync 전 부분 쓰기)은 버퍼에 보존
 *   - 파싱 실패 라인은 parse_ok=false로 콜백 전달 (전체 중단 금지)
 *   - macOS fs.watch 누락 대응 폴링 백업
 *
 * SPEC §2 §4 §6: 바이트 오프셋 증분 파싱, 부분 라인 버퍼링,
 *   파싱 실패 격리, watch_offsets 재개 상태 저장.
 *
 * 설계 원칙:
 *   - 불변성: 내부 상태 직접 노출 금지, 게터로만 접근
 *   - 에러 처리: 모든 fs/parse 오류를 감싸서 콜백 통보
 *   - console.log 금지
 *   - zod 입력 검증
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import { z } from 'zod'
import { parseChunk, parseLine } from './parser.js'
import type { ParseLineResult } from './parser.js'

// ---- Zod 입력 검증 스키마 ----

const FilePathSchema = z.string().min(1, 'filePath must be non-empty')

// ---- 공개 타입 ----

/** TailReader가 새 라인을 파싱할 때마다 호출하는 콜백 */
export type LineCallback = (result: ParseLineResult, byteOffset: number) => void

/**
 * 파일시스템 어댑터 인터페이스 (테스트 주입용).
 * 실제 구현은 node:fs / node:fs/promises를 사용하며,
 * 단위 테스트에서는 mock 구현을 주입한다.
 */
export interface FsAdapter {
  /** node:fs/promises stat — 파일 크기 조회 */
  stat(path: string): Promise<{ size: number }>
  /** node:fs createReadStream — 바이트 오프셋부터 읽기 */
  createReadStream(
    path: string,
    options: { start: number; encoding: undefined },
  ): NodeJS.ReadableStream
}

/** TailReader 생성 옵션 */
export interface TailReaderOptions {
  /**
   * 시작 바이트 오프셋. 기본값: 0.
   * watch_offsets에서 복원된 오프셋을 주입할 때 사용.
   */
  readonly initialByteOffset?: number
  /**
   * 폴링 간격(ms). usePolling=true 시 사용.
   * macOS fs.watch 누락 대응. 기본값: 1000.
   */
  readonly pollIntervalMs?: number
  /**
   * usePolling 강제 활성화 여부.
   * 기본값: false (chokidar가 자동 감지).
   * macOS에서는 createWatcher와 동일하게 darwin 감지 후 자동 활성화.
   */
  readonly usePolling?: boolean
  /**
   * chokidar 팩토리 함수 (테스트 주입용).
   * 미제공 시 실제 chokidar.watch를 사용.
   */
  readonly watcherFactory?: WatcherFactory
  /**
   * 파일시스템 어댑터 (테스트 주입용).
   * 미제공 시 실제 node:fs / node:fs/promises를 사용.
   */
  readonly fsAdapter?: FsAdapter
}

/**
 * chokidar watcher 팩토리 함수 타입.
 * 단위 테스트에서 mock watcher를 주입할 수 있도록 분리.
 */
export type WatcherFactory = (
  path: string,
  options: {
    persistent: boolean
    usePolling: boolean
    interval: number
    ignoreInitial: boolean
    awaitWriteFinish: { stabilityThreshold: number; pollInterval: number }
  },
) => FSWatcher

/** TailReader 현재 상태 */
export type TailReaderState = 'idle' | 'watching' | 'closed'

// ---- 내부 기본 구현체 ----

/**
 * 실제 node:fs / node:fs/promises를 사용하는 기본 FsAdapter.
 * @internal
 */
const defaultFsAdapter: FsAdapter = {
  stat: (path: string) => stat(path),
  createReadStream: (
    path: string,
    options: { start: number; encoding: undefined },
  ) => createReadStream(path, options) as unknown as NodeJS.ReadableStream,
}

/**
 * 실제 chokidar.watch를 호출하는 기본 팩토리.
 * @internal
 */
function defaultWatcherFactory(
  path: string,
  options: {
    persistent: boolean
    usePolling: boolean
    interval: number
    ignoreInitial: boolean
    awaitWriteFinish: { stabilityThreshold: number; pollInterval: number }
  },
): FSWatcher {
  return chokidar.watch(path, options)
}

// ---- TailReader 클래스 ----

/**
 * 바이트 오프셋 기반 증분 JSONL 테일 리더.
 *
 * ## 사용 흐름
 * ```ts
 * const reader = new TailReader('/path/to/session.jsonl', (result, offset) => {
 *   // result.event, result.parseOk
 * })
 * reader.start()
 * // ...
 * await reader.close()
 * ```
 *
 * ## 테스트 주입
 * ```ts
 * const reader = new TailReader(path, cb, {
 *   watcherFactory: (p, opts) => mockFSWatcher,
 * })
 * ```
 */
export class TailReader {
  /** 감시 대상 JSONL 파일 절대 경로 */
  private readonly _filePath: string

  /** 새 라인 파싱 시 호출되는 콜백 */
  private readonly _callback: LineCallback

  /** 현재 읽기 바이트 오프셋 (읽은 바이트 수) */
  private _byteOffset: number

  /** 미완성 부분 라인 버퍼 (fsync 전 부분 쓰기 대응) */
  private _partialLine: string

  /** chokidar FSWatcher 인스턴스 */
  private _watcher: FSWatcher | null

  /** 현재 상태 */
  private _state: TailReaderState

  /** 폴링 간격(ms) */
  private readonly _pollIntervalMs: number

  /** usePolling 여부 */
  private readonly _usePolling: boolean

  /** chokidar 팩토리 함수 */
  private readonly _watcherFactory: WatcherFactory

  /** 파일시스템 어댑터 (테스트 주입용) */
  private readonly _fsAdapter: FsAdapter

  /** 현재 진행 중인 read 작업 (중복 실행 방지) */
  private _readPromise: Promise<void> | null

  constructor(
    filePath: string,
    callback: LineCallback,
    options: TailReaderOptions = {},
  ) {
    // 입력 검증
    const validPath = FilePathSchema.parse(filePath)

    this._filePath = validPath
    this._callback = callback
    this._byteOffset = options.initialByteOffset ?? 0
    this._partialLine = ''
    this._watcher = null
    this._state = 'idle'
    this._readPromise = null

    this._pollIntervalMs = options.pollIntervalMs ?? 1000
    // macOS(darwin)에서는 usePolling 자동 활성화 (options.usePolling 명시 우선)
    this._usePolling =
      options.usePolling !== undefined
        ? options.usePolling
        : process.platform === 'darwin'
    this._watcherFactory = options.watcherFactory ?? defaultWatcherFactory
    this._fsAdapter = options.fsAdapter ?? defaultFsAdapter
  }

  // ---- 공개 게터 ----

  /** 현재 바이트 오프셋 (읽기 전용) */
  get byteOffset(): number {
    return this._byteOffset
  }

  /** 현재 미완성 부분 라인 버퍼 (읽기 전용) */
  get partialLine(): string {
    return this._partialLine
  }

  /** 현재 상태 */
  get state(): TailReaderState {
    return this._state
  }

  /** 감시 대상 파일 경로 */
  get filePath(): string {
    return this._filePath
  }

  /** chokidar FSWatcher 인스턴스 (테스트 접근용) */
  get watcher(): FSWatcher | null {
    return this._watcher
  }

  // ---- 공개 메서드 ----

  /**
   * 파일 감시를 시작한다.
   *
   * - chokidar watcher를 생성하고 'change' 이벤트에 바인딩한다.
   * - 이미 watching/closed 상태면 no-op.
   * - 'ready' 이벤트 후 초기 읽기를 트리거한다 (기존 데이터 처리).
   */
  start(): void {
    if (this._state !== 'idle') return

    const watcher = this._watcherFactory(this._filePath, {
      persistent: true,
      usePolling: this._usePolling,
      interval: this._pollIntervalMs,
      ignoreInitial: false,  // 기존 파일 내용도 읽기 위해 false
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    })

    this._watcher = watcher
    this._state = 'watching'

    // 파일 변경 시 증분 읽기
    watcher.on('change', (_path: string) => {
      this._scheduleRead()
    })

    // ready 이벤트: 감시 시작 후 초기 읽기 (기존 내용 처리)
    watcher.on('ready', () => {
      this._scheduleRead()
    })

    // add 이벤트: 파일이 새로 생성된 경우 (초기 byteOffset=0에서 읽기)
    watcher.on('add', (_path: string) => {
      this._scheduleRead()
    })

    // 에러 이벤트 핸들러 (watcher 자체 에러)
    watcher.on('error', (err: unknown) => {
      this._state = 'error' as TailReaderState
      // 에러를 더미 ParseLineResult로 콜백에 전달
      const errorMsg = err instanceof Error ? err.message : String(err)
      const fallbackResult: ParseLineResult = {
        event: {
          uuid: `watcher-error-${Date.now()}`,
          parentUuid: null,
          sessionId: '',
          cwd: '',
          agentScope: 'root',
          isSidechain: false,
          ts: Date.now(),
          byteOffset: this._byteOffset,
          kind: 'other',
        },
        parseOk: false,
        parseError: `watcher error: ${errorMsg}`,
      }
      this._callback(fallbackResult, this._byteOffset)
    })
  }

  /**
   * 파일 감시를 중지하고 리소스를 해제한다.
   * 이미 closed 상태면 no-op.
   */
  async close(): Promise<void> {
    if (this._state === 'closed') return

    this._state = 'closed'

    // 진행 중인 read 완료 대기
    if (this._readPromise !== null) {
      try {
        await this._readPromise
      } catch {
        // close 시점 read 실패는 무시
      }
    }

    if (this._watcher !== null) {
      await this._watcher.close()
      this._watcher = null
    }
  }

  /**
   * 현재 바이트 오프셋을 외부에서 업데이트한다.
   * watch_offsets에서 복원 후 재개 시 사용.
   *
   * @param offset 새 바이트 오프셋 (≥0)
   */
  updateOffset(offset: number): void {
    const validated = z.number().int().min(0).parse(offset)
    this._byteOffset = validated
  }

  // ---- 내부 메서드 ----

  /**
   * 증분 읽기를 스케줄한다.
   * 이미 읽기 중이면 중복 실행을 방지한다 (직렬 보장).
   */
  private _scheduleRead(): void {
    if (this._readPromise !== null) return
    this._readPromise = this._readIncremental().finally(() => {
      this._readPromise = null
    })
  }

  /**
   * 현재 byteOffset부터 EOF까지 증분 읽기를 수행한다.
   *
   * - createReadStream으로 byteOffset부터 EOF까지 읽기
   * - parseChunk로 청크 → 완성 라인 추출 (partialLine 보존)
   * - parseLine으로 각 라인 파싱 → 콜백 호출
   * - 파싱 실패 라인은 parseOk=false로 콜백 전달 (전체 중단 금지)
   */
  private async _readIncremental(): Promise<void> {
    if (this._state === 'closed') return

    let currentFileSize: number
    try {
      const fileStat = await this._fsAdapter.stat(this._filePath)
      currentFileSize = fileStat.size
    } catch {
      // 파일이 아직 없거나 접근 불가 → 조용히 skip
      return
    }

    // 파일이 잘린 경우(로테이션/truncate) → 오프셋 리셋
    if (currentFileSize < this._byteOffset) {
      this._byteOffset = 0
      this._partialLine = ''
    }

    // EOF까지 이미 읽은 경우 → skip
    if (currentFileSize === this._byteOffset) return

    const startOffset = this._byteOffset

    await new Promise<void>((resolve, reject) => {
      const stream = this._fsAdapter.createReadStream(this._filePath, {
        start: startOffset,
        encoding: undefined,  // Binary Buffer
      })

      let readBytes = 0

      stream.on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, 'utf8')
        readBytes += buf.length

        // parseChunk: 청크 → 완성 라인 + 새 partialLine
        const { lines, partialLine: newPartial } = parseChunk(buf, this._partialLine)
        this._partialLine = newPartial

        // 각 완성 라인 파싱 후 콜백
        let lineOffset = startOffset + readBytes - buf.length
        for (const line of lines) {
          const lineByteLen = Buffer.byteLength(line, 'utf8') + 1  // +1 for '\n'
          const result = parseLine(line, lineOffset, this._filePath)
          this._callback(result, lineOffset)
          lineOffset += lineByteLen
        }
      })

      stream.on('end', () => {
        // 완성된 바이트만 오프셋 전진 (partialLine 바이트는 미포함)
        this._byteOffset = startOffset + readBytes - Buffer.byteLength(this._partialLine, 'utf8')
        resolve()
      })

      stream.on('error', (err: Error) => {
        reject(err)
      })
    }).catch((err: unknown) => {
      // 읽기 실패 → 에러 콜백 전달, 오프셋은 유지
      const errorMsg = err instanceof Error ? err.message : String(err)
      const fallbackResult: ParseLineResult = {
        event: {
          uuid: `read-error-${Date.now()}`,
          parentUuid: null,
          sessionId: '',
          cwd: '',
          agentScope: 'root',
          isSidechain: false,
          ts: Date.now(),
          byteOffset: this._byteOffset,
          kind: 'other',
        },
        parseOk: false,
        parseError: `read error: ${errorMsg}`,
      }
      this._callback(fallbackResult, this._byteOffset)
    })
  }
}
