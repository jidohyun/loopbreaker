/**
 * watch/chokidar-watch-source.ts — ChokidarWatchSource 어댑터
 *
 * chokidar 의존성을 이 파일 안으로만 격리한다.
 * - daemon.ts, SessionRegistry, SessionPipeline은 WatchSource 인터페이스에만 의존한다.
 * - 기존 src/watch/index.ts의 WatchManager/createWatcher/resolveWatchPath/isMacOS를
 *   재작성하지 않고 내부에서 재사용(감싸기)한다.
 *
 * CONSTRAINT: chokidar import는 이 파일과 src/watch/index.ts에만 허용.
 */

import * as path from 'path'
import { WatchManager, type CreateWatcherOptions } from './index.js'
import type {
  WatchSource,
  WatchCallbacks,
} from './watch-source.js'

/**
 * 파일 경로에서 sessionId를 도출한다.
 *
 * 기존 parser/event-store가 사용하는 방식과 일치하게:
 * 파일명에서 확장자를 제거한 베이스네임을 sessionId로 사용한다.
 * 예: /path/to/abc123.jsonl → 'abc123'
 *     /path/to/session-xyz.jsonl → 'session-xyz'
 *
 * @internal
 */
export function deriveSessionId(filePath: string): string {
  const base = path.basename(filePath)
  const dotIndex = base.lastIndexOf('.')
  return dotIndex > 0 ? base.slice(0, dotIndex) : base
}

/**
 * .jsonl 확장자를 가진 파일인지 확인한다.
 * 세션 파일 필터링에 사용.
 *
 * @internal
 */
function isJsonlFile(filePath: string): boolean {
  return filePath.endsWith('.jsonl')
}

/**
 * ChokidarWatchSource — chokidar 기반 WatchSource 구현체.
 *
 * 기존 WatchManager/createWatcher를 내부에서 감싸 재사용하며,
 * chokidar FSWatcher 이벤트(add/change/unlink)를
 * WatchSource 콜백(onSessionAppear/onSessionChange/onSessionRemove)으로 변환한다.
 *
 * 사용 예:
 *   const src = new ChokidarWatchSource('~/.claude/projects')
 *   await src.start({ onSessionAppear, onSessionChange, onSessionRemove })
 *   // ...
 *   await src.close()
 */
/**
 * WatchManager의 최소 인터페이스 — 테스트에서 가짜 구현 주입을 허용한다.
 * @internal
 */
export interface IWatchManager {
  start(patterns: readonly string[]): Promise<void>
  stop(): Promise<void>
  readonly handle: {
    readonly watcher: {
      on(event: string, listener: (filePath: string) => void): unknown
    }
  } | null
}

export class ChokidarWatchSource implements WatchSource {
  private readonly _watchDir: string
  private readonly _manager: IWatchManager
  private _callbacks: WatchCallbacks | null = null
  private _started = false

  /**
   * @param watchDir  감시할 디렉터리 경로 (glob 패턴 또는 실제 경로)
   * @param options   WatchManager/createWatcher에 전달할 추가 옵션.
   *                  테스트에서는 _manager 파라미터로 가짜 구현을 주입한다.
   * @param _manager  내부 WatchManager 구현체 — 테스트 DI용. 기본값: new WatchManager(options)
   */
  constructor(
    watchDir: string,
    options: CreateWatcherOptions = {},
    _manager?: IWatchManager,
  ) {
    this._watchDir = watchDir
    this._manager = _manager ?? new WatchManager(options)
  }

  /**
   * 세 가지 콜백을 등록하고 감시를 시작한다.
   *
   * chokidar 이벤트 매핑:
   *   'add'    → onSessionAppear  (새 .jsonl 파일 감지)
   *   'change' → onSessionChange  (기존 .jsonl 파일 변경)
   *   'unlink' → onSessionRemove  (파일 삭제/이동)
   *
   * 멱등 호출: 이미 시작된 상태에서 재호출 시 기존 watcher를 닫고 새로 시작.
   */
  async start(callbacks: WatchCallbacks): Promise<void> {
    this._callbacks = callbacks

    // WatchManager.start()가 패턴 배열을 받으므로 watchDir를 배열로 전달
    await this._manager.start([this._watchDir])
    this._started = true

    const handle = this._manager.handle
    if (handle === null) {
      throw new Error('ChokidarWatchSource: WatchManager handle is null after start')
    }

    const { watcher } = handle

    // add: 새 파일 → onSessionAppear
    watcher.on('add', (filePath: string) => {
      if (!isJsonlFile(filePath)) return
      const sessionId = deriveSessionId(filePath)
      this._callbacks?.onSessionAppear(sessionId, filePath)
    })

    // change: 파일 내용 변경 → onSessionChange
    watcher.on('change', (filePath: string) => {
      if (!isJsonlFile(filePath)) return
      const sessionId = deriveSessionId(filePath)
      this._callbacks?.onSessionChange(sessionId, filePath)
    })

    // unlink: 파일 삭제 → onSessionRemove
    watcher.on('unlink', (filePath: string) => {
      if (!isJsonlFile(filePath)) return
      const sessionId = deriveSessionId(filePath)
      this._callbacks?.onSessionRemove(sessionId, filePath)
    })
  }

  /**
   * 감시를 중단한다.
   * 이후 어떤 콜백도 발화하지 않는다.
   * gracefulShutdown에서 첫 번째로 호출된다.
   */
  async close(): Promise<void> {
    this._callbacks = null
    this._started = false
    await this._manager.stop()
  }

  /**
   * 현재 감시 중인지 여부 (테스트/진단용).
   */
  get isStarted(): boolean {
    return this._started
  }

  /**
   * 내부 WatchManager 접근자 (테스트/진단용).
   * @internal
   */
  get manager(): IWatchManager {
    return this._manager
  }
}
