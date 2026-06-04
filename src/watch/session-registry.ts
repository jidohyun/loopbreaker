/**
 * watch/session-registry.ts — SessionRegistry
 *
 * SPEC §2.1·§3.3 — sessionId → SessionPipeline lazy 맵.
 *
 * 역할:
 *   - WatchSource 콜백(onSessionAppear/Change/Remove)을 SessionPipeline 수명주기에 배선한다.
 *     · appear → ensurePipeline (lazy 생성)
 *     · change → enqueueChange (직렬 큐에 변경 신호)
 *     · remove → drainAndClose (drain 후 닫고 맵에서 제거)
 *   - 세션별로 변하지 않는 공유 의존성(db/embed/judge/dispatcher)을 1회 받아 보관하고,
 *     ensurePipeline에서 sessionId/filePath만 더해 SessionPipelineDeps를 조립한다.
 *
 * 설계 원칙(SPEC §4 세션 격리):
 *   - WatchCallbacks의 콜백은 동기(void)이고 enqueue/drainAndClose는 Promise이므로,
 *     콜백 내부에서 floating promise를 `void p.catch(...)`로 명시 처리한다
 *     (미처리 rejection이 데몬 전체를 죽이지 않게).
 *   - chokidar 직접 import 금지 — WatchSource 추상화에만 의존.
 *   - console.log 금지 — 주입된 logger 사용.
 *   - 불변성: 입력 변경 금지.
 */

import type Database from 'better-sqlite3'
import type { DetectorConfig } from '../contracts.js'
import type { EmbedClient } from '../api/embed-client.js'
import type { JudgeClient } from '../api/judge-client.js'
import type { NotifyDispatcher } from '../notify/notify-dispatcher.js'
import type { WatchCallbacks } from './watch-source.js'
import type { DrainableSession } from '../daemon/shutdown.js'
import {
  SessionPipeline,
  type SessionPipelineLogger,
} from '../daemon/session-pipeline.js'

// ─── deps ────────────────────────────────────────────────────────────────────

/**
 * SessionRegistry 생성 의존성.
 *
 * detectorConfig를 제외한 모든 필드는 세션 간 공유되는 불변 참조다.
 * detectorConfig는 핫리로드(updateConfig)로 교체될 수 있는 현재값 스냅샷이며,
 * 이후 생성되는 SessionPipeline부터 새 값을 적용한다(기존 파이프라인은 drain까지 유지).
 */
export interface SessionRegistryDeps {
  /** op DB 핸들 (daemon이 storage.opDb getter로 꺼내 전달) */
  readonly db: Database.Database
  /** 평면 DetectorConfig (configManager.getConfig()) — 현재값 스냅샷 */
  readonly detectorConfig: DetectorConfig
  /** Embed 클라이언트 (apiClients.embedClient) */
  readonly embedClient: EmbedClient
  /** Judge 클라이언트 (apiClients.judgeClient) */
  readonly judgeClient: JudgeClient
  /** 알림 디스패처 (daemon이 조립) */
  readonly dispatcher: NotifyDispatcher
  /** SessionPipeline 큐 최대 깊이 (옵션, 기본 1000) */
  readonly maxQueueDepth?: number
  /** 구조화 로거 (옵션) */
  readonly logger?: SessionPipelineLogger
}

// ─── SessionRegistry ───────────────────────────────────────────────────────

/**
 * sessionId → SessionPipeline lazy 맵.
 *
 * WatchSource 콜백을 SessionPipeline 수명주기에 배선하는 데몬 레이어 컴포넌트.
 */
export class SessionRegistry {
  private readonly _pipelines = new Map<string, SessionPipeline>()

  /** 핫리로드 시 교체되는 현재 DetectorConfig 스냅샷 */
  private _detectorConfig: DetectorConfig

  private readonly _db: Database.Database
  private readonly _embedClient: EmbedClient
  private readonly _judgeClient: JudgeClient
  private readonly _dispatcher: NotifyDispatcher
  private readonly _maxQueueDepth: number | undefined
  private readonly _logger: SessionPipelineLogger | undefined

  constructor(deps: SessionRegistryDeps) {
    this._detectorConfig = deps.detectorConfig
    this._db = deps.db
    this._embedClient = deps.embedClient
    this._judgeClient = deps.judgeClient
    this._dispatcher = deps.dispatcher
    this._maxQueueDepth = deps.maxQueueDepth
    this._logger = deps.logger
  }

  /** 현재 보유 중인 세션 수 */
  get size(): number {
    return this._pipelines.size
  }

  /**
   * lazy 생성: 이미 살아있는 파이프라인이 있으면 그대로 반환, 없으면 새로 생성한다.
   * 닫힌(isClosed) 파이프라인은 새로 만든다(파일 재등장 대응).
   */
  ensurePipeline(sessionId: string, filePath: string): SessionPipeline {
    const existing = this._pipelines.get(sessionId)
    if (existing !== undefined && !existing.isClosed) {
      return existing
    }

    const pipeline = new SessionPipeline(
      sessionId,
      filePath,
      {
        db: this._db,
        detectorConfig: this._detectorConfig,
        embedClient: this._embedClient,
        judgeClient: this._judgeClient,
        dispatcher: this._dispatcher,
        ...(this._logger !== undefined ? { logger: this._logger } : {}),
      },
      this._maxQueueDepth,
    )
    this._pipelines.set(sessionId, pipeline)
    return pipeline
  }

  /** 조회 (없으면 undefined) */
  pipeline(sessionId: string): SessionPipeline | undefined {
    return this._pipelines.get(sessionId)
  }

  /** enqueue 위임 — 없거나 닫힌 세션이면 no-op */
  async enqueue(sessionId: string): Promise<void> {
    const p = this._pipelines.get(sessionId)
    if (p === undefined || p.isClosed) return
    await p.enqueueChange()
  }

  /** remove 처리: drain 후 닫고 맵에서 제거 */
  async drainAndClose(sessionId: string): Promise<void> {
    const p = this._pipelines.get(sessionId)
    if (p === undefined) return
    await p.drainAndClose()
    this._pipelines.delete(sessionId)
  }

  /**
   * 핫리로드: 이후 ensurePipeline부터 새 config를 적용한다.
   * 이미 생성된 파이프라인은 drain까지 옛 config를 유지한다(SPEC §6.1 안전 적용).
   */
  updateConfig(next: DetectorConfig): void {
    this._detectorConfig = next
  }

  /**
   * gracefulShutdown용: shutdown.ts의 ShutdownDeps.sessions에 그대로 넘긴다.
   * SessionPipeline은 drainAndClose()를 가져 DrainableSession을 구조적으로 만족한다.
   */
  get sessions(): ReadonlyMap<string, DrainableSession> {
    return this._pipelines
  }

  /**
   * WatchSource.start()에 넘길 콜백 집합을 생성한다.
   *
   * 콜백은 동기(void)이므로 비동기 작업(enqueue/drainAndClose)은
   * `void p.catch(...)`로 floating promise를 안전하게 처리한다(세션 격리).
   */
  buildCallbacks(): WatchCallbacks {
    return {
      onSessionAppear: (sessionId, filePath) => {
        this.ensurePipeline(sessionId, filePath)
      },
      onSessionChange: (sessionId, filePath) => {
        // appear 누락 대비: ensure 후 enqueue
        this.ensurePipeline(sessionId, filePath)
        void this.enqueue(sessionId).catch((err: unknown) => {
          this._logger?.error('session-registry: enqueue 실패', {
            sessionId,
            error: String(err),
          })
        })
      },
      onSessionRemove: (sessionId, _filePath) => {
        void this.drainAndClose(sessionId).catch((err: unknown) => {
          this._logger?.error('session-registry: drainAndClose 실패', {
            sessionId,
            error: String(err),
          })
        })
      },
    }
  }
}
