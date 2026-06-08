// src/daemon/daemon-entry.ts
//
// 데몬 프로덕션 실행 엔트리포인트.
// CLI(`loopbreaker start --foreground`) 또는 launchd가 호출한다.
//
// 책임: config 로드 → 프로덕션 부품(ChokidarWatchSource·실제 NotifySink·
//   createApiClients) 조립 → Daemon.start() → 시그널 대기 → graceful stop.
//
// 부수효과 격리(M5/M6 원칙): 이 파일은 프로덕션 실행 전용이며 테스트 대상이 아니다.
//   buildProductionDaemon은 순수 조립 함수로 export해 단위 테스트(Mock 주입)는 가능하되,
//   runDaemon(시그널 대기·process 종속)은 import 시 실행되지 않는다(isMain 가드).

import { homedir } from 'node:os'
import { join } from 'node:path'
import { Daemon, type DaemonOptions, type DaemonLogger } from './daemon.js'
import { ConfigManager } from '../config/config-manager.js'
import { defaultConfigDir } from '../config/config-loader.js'
import { ChokidarWatchSource } from '../watch/chokidar-watch-source.js'
import { createApiClients } from '../api/api-clients.js'
import { CliNotifySink } from '../notify/sinks/cli-notify-sink.js'
import { DesktopNotifySink } from '../notify/sinks/desktop-notify-sink.js'
import { WebhookNotifySink } from '../notify/sinks/webhook-notify-sink.js'
import type { NotifySink } from '../contracts.js'

/** 기본 op DB 경로 (~/.loopbreaker/loopbreaker.db) */
export function defaultOpDbPath(): string {
  return join(defaultConfigDir(), 'loopbreaker.db')
}

/** 기본 eval DB 경로 (~/.loopbreaker/loopbreaker-eval.db) */
export function defaultEvalDbPath(): string {
  return join(defaultConfigDir(), 'loopbreaker-eval.db')
}

/** 기본 lockfile 경로 (~/.loopbreaker/daemon.lock) */
export function defaultLockPath(): string {
  return join(defaultConfigDir(), 'daemon.lock')
}

/** ~ 확장 (sessionGlob 등 홈 경로 처리) */
function expandHome(p: string): string {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

/** config.notify.notifyChannels 기준으로 프로덕션 NotifySink 배열 구성 */
function buildSinks(
  channels: readonly ('desktop' | 'webhook' | 'cli')[],
  webhookUrl: string | undefined,
  logger?: DaemonLogger,
): NotifySink[] {
  const sinks: NotifySink[] = []
  for (const ch of channels) {
    if (ch === 'cli') sinks.push(new CliNotifySink())
    else if (ch === 'desktop') sinks.push(new DesktopNotifySink())
    else if (ch === 'webhook') {
      if (webhookUrl !== undefined && webhookUrl.length > 0) {
        sinks.push(new WebhookNotifySink(webhookUrl))
      } else {
        logger?.warn('daemon-entry: webhook 채널이 활성이나 webhookUrl 미설정 — 스킵')
      }
    }
  }
  // 최소 1개 보장: 채널이 비면 CLI로 폴백.
  if (sinks.length === 0) sinks.push(new CliNotifySink())
  return sinks
}

/** buildProductionDaemon 옵션 (경로 오버라이드 가능 — 테스트/CLI용) */
export interface BuildProductionDaemonOptions {
  readonly configPath?: string
  readonly opDbPath?: string
  readonly evalDbPath?: string
  readonly lockPath?: string
  readonly logger?: DaemonLogger
}

/**
 * config를 읽어 프로덕션 부품을 조립한 Daemon을 반환한다.
 * 순수 조립 함수 — start()를 호출하지 않는다(호출자 책임).
 */
export function buildProductionDaemon(opts: BuildProductionDaemonOptions = {}): Daemon {
  const logger = opts.logger
  const configManager = ConfigManager.create(
    opts.configPath !== undefined ? { configPath: opts.configPath } : {},
  )
  const loopConfig = configManager.getLoopBreakerConfig()
  const detectorConfig = configManager.getConfig()

  // 프로덕션 WatchSource (chokidar, sessionGlob 감시)
  const watchSource = new ChokidarWatchSource(expandHome(loopConfig.watch.sessionGlob))

  // 프로덕션 API 클라이언트 (키 없으면 Mock 폴백 — api-clients 책임)
  const apiClients = createApiClients({
    embedModelId: detectorConfig.embedModelId,
    judgeModelId: detectorConfig.judgeModelId,
    ...(process.env['ANTHROPIC_API_KEY'] !== undefined
      ? { apiKey: process.env['ANTHROPIC_API_KEY'] }
      : {}),
  })

  // 알림 채널 (평면 DetectorConfig.notifyChannels — toDetectorConfig가 매핑)
  const sinks = buildSinks(detectorConfig.notifyChannels, detectorConfig.webhookUrl, logger)

  const daemonOptions: DaemonOptions = {
    paths: {
      opDbPath: opts.opDbPath ?? defaultOpDbPath(),
      ...(opts.evalDbPath !== undefined
        ? { evalDbPath: opts.evalDbPath }
        : { evalDbPath: defaultEvalDbPath() }),
      lockPath: opts.lockPath ?? defaultLockPath(),
    },
    configManager,
    watchSource,
    sinks,
    apiClients,
    ...(logger !== undefined ? { logger } : {}),
  }

  return new Daemon(daemonOptions)
}

/**
 * 데몬을 기동하고 SIGINT/SIGTERM까지 foreground로 대기한다.
 * launchd 또는 `loopbreaker start --foreground`가 호출.
 *
 * Daemon.start()가 자체 시그널 핸들러로 stop을 호출하므로,
 * 여기서는 프로세스가 종료되지 않도록 keep-alive만 유지한다.
 */
export async function runDaemon(opts: BuildProductionDaemonOptions = {}): Promise<void> {
  const logger: DaemonLogger = opts.logger ?? {
    info: (msg, extra) => process.stdout.write(`[INFO] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}\n`),
    warn: (msg, extra) => process.stderr.write(`[WARN] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}\n`),
    error: (msg, extra) => process.stderr.write(`[ERROR] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}\n`),
  }
  const daemon = buildProductionDaemon({ ...opts, logger })
  await daemon.start()
  logger.info('loopbreaker daemon: foreground 실행 중 (SIGTERM/SIGINT로 종료)')

  // keep-alive: Daemon.start()가 등록한 시그널 핸들러가 stop을 호출하면
  // 이벤트 루프가 비고 프로세스가 자연 종료된다. 그때까지 대기.
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (!daemon.isRunning) {
        clearInterval(check)
        resolve()
      }
    }, 500)
  })
  logger.info('loopbreaker daemon: 종료됨')
}

/** import 시 실행 금지 가드 — 직접 실행(node daemon-entry.js)일 때만 main */
function isMain(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  return import.meta.url === `file://${entry}`
}

if (isMain()) {
  runDaemon().catch((err: unknown) => {
    process.stderr.write(`[FATAL] loopbreaker daemon: ${String(err)}\n`)
    process.exitCode = 1
  })
}
