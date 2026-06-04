/**
 * daemon/daemon-factory.ts — DaemonFactory
 *
 * SPEC §3.3 메인루프 조립 팩토리.
 *
 * 역할:
 *   - 외부에서 주입된 ApiClients(embedClient, judgeClient)를 내부 생성 없이
 *     그대로 보관하고 SessionPipeline에 전달한다.
 *   - 모든 외부 의존성(storage, apiClients, watchSource, lockHandle, configManager)을
 *     DI로 받는다 — 테스트에서 Mock/임시경로로 치환 가능.
 *
 * Sub-AC 4a 검증 포인트:
 *   factory.apiClients.embedClient === injectedEmbedClient  (참조 동일성)
 *   factory.apiClients.judgeClient === injectedJudgeClient  (참조 동일성)
 *
 * 설계 원칙:
 *   - 불변성: 입력 변경 금지, 새 객체 반환
 *   - console.log 금지 — 주입된 logger 사용
 *   - chokidar 직접 import 금지
 */

import type { EmbedClient } from '../api/embed-client.js'
import type { JudgeClient } from '../api/judge-client.js'
import type { DetectorConfig } from '../contracts.js'
import type { WatchSource } from '../watch/watch-source.js'
import type { LockHandle } from './lockfile.js'
import type { CloseableStorage } from './shutdown.js'
import type { ConfigManager } from '../config/config-manager.js'

// ─── 로거 인터페이스 ──────────────────────────────────────────────────────────

export interface DaemonFactoryLogger {
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
}

const noopLogger: DaemonFactoryLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

// ─── ApiClients 번들 ─────────────────────────────────────────────────────────

/**
 * 데몬이 사용하는 API 클라이언트 묶음.
 * createApiClients() 반환값과 동일한 구조.
 */
export interface DaemonApiClients {
  readonly embedClient: EmbedClient
  readonly judgeClient: JudgeClient
}

// ─── DaemonFactory 옵션 ──────────────────────────────────────────────────────

/**
 * DaemonFactory.create() 옵션.
 *
 * 모든 외부 의존성을 DI로 주입한다.
 * 테스트에서는 Mock 구현과 임시경로를 주입해 부수효과 없이 동작한다.
 */
export interface DaemonFactoryOptions {
  /** 평면 DetectorConfig (ConfigManager.getConfig() 반환값) */
  readonly detectorConfig: DetectorConfig
  /** API 클라이언트 묶음 (DI 최우선 — 내부 생성 금지) */
  readonly apiClients: DaemonApiClients
  /** 파일 감시 소스 (Mock or Chokidar) */
  readonly watchSource: WatchSource
  /** 스토리지 레이어 */
  readonly storage: CloseableStorage
  /** lockfile 핸들 */
  readonly lockHandle: LockHandle
  /** ConfigManager 인스턴스 */
  readonly configManager: ConfigManager
  /** 구조화 로거 (옵션) */
  readonly logger?: DaemonFactoryLogger
}

// ─── DaemonFactory ───────────────────────────────────────────────────────────

/**
 * LoopBreaker 데몬 메인루프 팩토리.
 *
 * 주입된 의존성을 보관하고 SessionPipeline 생성 시 전달한다.
 * Sub-AC 4a: apiClients 참조는 주입된 것과 동일(=== 보장).
 */
export class DaemonFactory {
  /** 주입된 DetectorConfig */
  readonly detectorConfig: DetectorConfig

  /**
   * 주입된 API 클라이언트 묶음.
   * embedClient/judgeClient는 주입된 인스턴스와 참조 동일성(===)을 보장한다.
   */
  readonly apiClients: DaemonApiClients

  /** 파일 감시 소스 */
  readonly watchSource: WatchSource

  /** 스토리지 레이어 */
  readonly storage: CloseableStorage

  /** lockfile 핸들 */
  readonly lockHandle: LockHandle

  /** ConfigManager */
  readonly configManager: ConfigManager

  private readonly _logger: DaemonFactoryLogger

  private constructor(opts: DaemonFactoryOptions) {
    this.detectorConfig = opts.detectorConfig
    // DI 최우선: 주입된 apiClients를 그대로 할당 — 내부 생성 없음
    this.apiClients = opts.apiClients
    this.watchSource = opts.watchSource
    this.storage = opts.storage
    this.lockHandle = opts.lockHandle
    this.configManager = opts.configManager
    this._logger = opts.logger ?? noopLogger

    this._logger.info('daemon-factory: 초기화 완료', {
      embedClientType: opts.apiClients.embedClient.constructor.name,
      judgeClientType: opts.apiClients.judgeClient.constructor.name,
    })
  }

  /**
   * DaemonFactory 인스턴스를 생성한다.
   *
   * 주입된 apiClients는 내부에서 절대 교체되지 않는다.
   * 테스트:  factory.apiClients.embedClient === myMock  → true
   */
  static create(opts: DaemonFactoryOptions): DaemonFactory {
    return new DaemonFactory(opts)
  }
}
