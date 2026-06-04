/**
 * daemon/daemon.ts — Daemon (SPEC §3.3 메인루프 라이프사이클)
 *
 * M0~M4 부품을 단일 데몬 메인루프로 조립한다.
 *
 * start() 순서(SPEC §3.3):
 *   1. acquireLock(lockPath)               — 단일 인스턴스 보증
 *   2. StorageLayer.open(opPath, …)        — WAL + sqlite-vec + migrations
 *   3. createApiClients(…) (DI 우선)        — Embed/Judge
 *   4. CooldownStore(db).warmUp() + NotifyDispatcher 조립
 *   5. SessionRegistry 생성
 *   6. watchSource.start(registry.buildCallbacks())
 *   7. installSignalHandlers(SIGINT/SIGTERM → stop)
 *   8. configManager.onReload(updateConfig)  — 핫리로드
 *
 * stop() 순서(shutdown.ts buildShutdownSequence):
 *   watchSource.close → 세션 큐 drainAndClose → storage.close → releaseLock
 *
 * 설계 원칙:
 *   - 모든 외부 의존(watchSource/sinks/apiClients/storage/lock fn/configManager)은 DI.
 *     테스트는 Mock·임시경로로 데몬을 기동·정지할 수 있다(부수효과 0).
 *   - DaemonFactory는 순수 DI 보관소로 건드리지 않는다(Sub-AC 4a 참조 동일성 보호).
 *     Daemon은 동일 deps를 DaemonOptions로 직접 받는다(결합도 최소).
 *   - DB/lock 경로는 config 스키마에 없으므로 DaemonPaths로 받는다.
 *   - chokidar 직접 import 금지, console.log 금지(주입 logger 사용).
 */

import type { WatchSource } from '../watch/watch-source.js'
import type { ConfigManager } from '../config/config-manager.js'
import type { DetectorConfig, NotifySink } from '../contracts.js'
import { StorageLayer } from '../storage/storage-layer.js'
import { createApiClients, type ApiClients } from '../api/api-clients.js'
import { CooldownStore } from '../notify/cooldown-store.js'
import { NotifyDispatcher } from '../notify/notify-dispatcher.js'
import { SessionRegistry } from '../watch/session-registry.js'
import { acquireLock, releaseLock, type LockHandle } from './lockfile.js'
import {
  buildShutdownSequence,
  runShutdown,
  type CloseableStorage,
} from './shutdown.js'

// ─── 로거 ────────────────────────────────────────────────────────────────────

/**
 * 데몬 로거 — SessionPipelineLogger/ShutdownLogger/DispatchLogger와 구조 호환
 * (info/warn/error(string, Record?)). ApiClientsLogger(info/warn)에도 부분 호환.
 */
export interface DaemonLogger {
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
}

const noopLogger: DaemonLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

/** 앱 버전 (schema_version 기록용 — package.json과 일치) */
const APP_VERSION = '0.1.0'

// ─── 옵션 ────────────────────────────────────────────────────────────────────

/**
 * DB / lockfile 경로. config 스키마에 없으므로 별도로 주입한다.
 * 테스트는 os.tmpdir() 하위 임시경로를 주입한다.
 */
export interface DaemonPaths {
  /** op DB 경로 (기본 운영: ~/.loopbreaker/loopbreaker.db) */
  readonly opDbPath: string
  /** eval DB 경로 (옵션) */
  readonly evalDbPath?: string
  /** lockfile 경로 (기본 운영: ~/.loopbreaker/daemon.lock) */
  readonly lockPath: string
}

/**
 * Daemon 생성 옵션. 모든 외부 의존성을 DI로 받는다.
 */
export interface DaemonOptions {
  readonly paths: DaemonPaths
  readonly configManager: ConfigManager
  readonly watchSource: WatchSource
  /** 알림 sink 배열 (테스트는 [MockNotifySink]) */
  readonly sinks: readonly NotifySink[]
  /** API 클라이언트 (DI 우선 — 없으면 config로 createApiClients) */
  readonly apiClients?: ApiClients
  /** StorageLayer (DI — 없으면 내부 생성 후 open) */
  readonly storage?: StorageLayer
  /** lock 획득 함수 (DI — 기본 acquireLock) */
  readonly acquireLockFn?: (lockPath: string) => LockHandle
  /** lock 해제 함수 (DI — 기본 releaseLock) */
  readonly releaseLockFn?: (handle: LockHandle) => void
  /** 구조화 로거 (옵션) */
  readonly logger?: DaemonLogger
  /** graceful shutdown 타임아웃 (ms, 기본 10000) */
  readonly shutdownTimeoutMs?: number
}

// ─── Daemon ──────────────────────────────────────────────────────────────────

/**
 * LoopBreaker 데몬. start()/stop() 라이프사이클을 갖는다.
 */
export class Daemon {
  private _started = false
  private _storage: StorageLayer | null = null
  private _ownsStorage = false
  private _registry: SessionRegistry | null = null
  private _lockHandle: LockHandle | null = null
  private readonly _undoSignalHandlers: Array<() => void> = []
  private readonly _logger: DaemonLogger

  constructor(private readonly opts: DaemonOptions) {
    this._logger = opts.logger ?? noopLogger
  }

  /** 데몬이 기동 상태인지 */
  get isRunning(): boolean {
    return this._started
  }

  /** 세션 레지스트리 접근(테스트/검증용 — 미기동 시 null) */
  get registry(): SessionRegistry | null {
    return this._registry
  }

  /**
   * 데몬을 기동한다(SPEC §3.3 메인루프). 멱등(이미 기동 중이면 no-op).
   * lock 획득 실패 시 throw(단일 인스턴스 보증).
   */
  async start(): Promise<void> {
    if (this._started) return
    const { opts } = this
    const acquire = opts.acquireLockFn ?? acquireLock
    const detectorConfig: DetectorConfig = opts.configManager.getConfig()

    // 1) lockfile — 단일 인스턴스 보증(점유 중이면 throw)
    this._lockHandle = acquire(opts.paths.lockPath)

    // 2) storage open (DI 우선; 없으면 내부 생성 후 open)
    if (opts.storage !== undefined) {
      this._storage = opts.storage
      this._ownsStorage = false
    } else {
      const storage = new StorageLayer()
      storage.open(opts.paths.opDbPath, opts.paths.evalDbPath, {
        embedDim: detectorConfig.embedDim,
        appVersion: APP_VERSION,
        busyTimeout: 5000,
      })
      this._storage = storage
      this._ownsStorage = true
    }
    const db = this._storage.opDb

    // 3) apiClients (DI 우선; 없으면 config로 생성 — 키 없으면 Mock 폴백/스텁)
    const apiClients: ApiClients =
      opts.apiClients ??
      createApiClients({
        embedModelId: detectorConfig.embedModelId,
        judgeModelId: detectorConfig.judgeModelId,
        apiKey: process.env['ANTHROPIC_API_KEY'],
        logger: this._logger,
      })

    // 4) CooldownStore warmUp + NotifyDispatcher 조립
    const cooldown = new CooldownStore(db)
    cooldown.warmUp() // DB → 인메모리 (재시작 후 쿨다운 유지)
    const dispatcher = new NotifyDispatcher(
      opts.sinks,
      cooldown,
      {
        decideThresh: detectorConfig.decideThresh,
        notifyDebounceMs: detectorConfig.notifyDebounceMs,
        lowConfidenceNotify: detectorConfig.lowConfidenceNotify,
      },
      this._logger,
    )

    // 5) SessionRegistry 생성 (apiClients 번들을 embed/judge로 펼침)
    this._registry = new SessionRegistry({
      db,
      detectorConfig,
      embedClient: apiClients.embedClient,
      judgeClient: apiClients.judgeClient,
      dispatcher,
      logger: this._logger,
    })

    // 6) watchSource 콜백 배선 + start
    await opts.watchSource.start(this._registry.buildCallbacks())

    // 7) signal handlers (SIGINT/SIGTERM → stop)
    const onSignal = (): void => {
      void this.stop().catch((err: unknown) => {
        this._logger.error('daemon: 시그널 종료 중 오류', { error: String(err) })
      })
    }
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
    this._undoSignalHandlers.push(
      () => process.removeListener('SIGINT', onSignal),
      () => process.removeListener('SIGTERM', onSignal),
    )

    // 8) onReload 배선 (핫리로드 → registry.updateConfig)
    opts.configManager.onReload((next) => {
      this._registry?.updateConfig(next)
    })

    this._started = true
    this._logger.info('daemon: started', {
      lockPath: this._lockHandle.lockPath,
      opDbPath: opts.paths.opDbPath,
    })
  }

  /**
   * 데몬을 graceful 종료한다.
   * watchSource.close → 세션 큐 drainAndClose → storage.close → releaseLock 순서.
   * @returns 각 단계에서 발생한 오류 배열(비었으면 정상 종료)
   */
  async stop(): Promise<Error[]> {
    if (!this._started) return []
    const release = this.opts.releaseLockFn ?? releaseLock

    // 시그널 핸들러 먼저 해제(중복 stop 방지)
    for (const undo of this._undoSignalHandlers) undo()
    this._undoSignalHandlers.length = 0

    const storage = this._storage
    const registry = this._registry
    const lockHandle = this._lockHandle
    // start()가 완료됐다면 이들은 모두 non-null
    if (storage === null || registry === null || lockHandle === null) {
      this._started = false
      return []
    }

    // 외부 주입 storage는 데몬이 닫지 않는다(소유자가 닫음).
    const closeableStorage: CloseableStorage = this._ownsStorage
      ? storage
      : { close: async () => undefined }

    const steps = buildShutdownSequence({
      watchSource: this.opts.watchSource,
      sessions: registry.sessions,
      storage: closeableStorage,
      lockHandle,
      releaseLock: release,
    })
    const errors = await runShutdown(
      steps,
      this._logger,
      this.opts.shutdownTimeoutMs,
    )

    this._started = false
    this._storage = null
    this._registry = null
    this._lockHandle = null
    this._logger.info('daemon: stopped', { errorCount: errors.length })
    return errors
  }
}
