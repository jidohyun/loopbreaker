#!/usr/bin/env node
// src/cli/index.ts
//
// LoopBreaker CLI 진입점 (SPEC §6.2 명령 표면).
//
// 명령:
//   loopbreaker start [--foreground]   데몬 기동 (--foreground=직접 실행, 아니면 launchd load)
//   loopbreaker stop                   데몬 정지 (launchd unload)
//   loopbreaker status [--json]        데몬 상태·세션 수·최근 탐지 (ops.db read-only)
//   loopbreaker doctor                 권한·경로·DB·설정 건강검진
//   loopbreaker version                버전 출력
//   loopbreaker help                   도움말
//
// 부수효과 격리: import 시 실행되지 않는다(isMain 가드). 각 명령은 호출 시에만
//   데몬 기동/launchd/DB 접근을 수행한다. 테스트는 dispatch(argv, io)를 Mock io로 호출.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import Database from 'better-sqlite3'
import { defaultConfigDir, defaultConfigPath } from '../config/config-loader.js'
import {
  runDaemon,
  defaultOpDbPath,
  defaultLockPath,
} from '../daemon/daemon-entry.js'

const APP_VERSION = '0.1.0'

/** CLI 입출력 추상화 (테스트 Mock 주입용) */
export interface CliIO {
  out(s: string): void
  err(s: string): void
}

const defaultIo: CliIO = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
}

const HELP = `loopbreaker — Claude Code 세션 thrashing/false_success 탐지 미들웨어

사용법:
  loopbreaker <command> [options]

명령:
  start [--foreground]   데몬 기동 (--foreground: 직접 실행, 기본: 안내 출력)
  stop                   데몬 정지 안내
  status [--json]        데몬 상태·세션 수·최근 탐지 (ops.db read-only 조회)
  doctor                 권한·경로·DB·설정 건강검진
  version                버전 출력
  help                   이 도움말

설정: ${defaultConfigPath()}
운영 DB: ${defaultOpDbPath()}
`

/** status: ops.db를 read-only로 열어 요약 출력 */
function cmdStatus(argv: readonly string[], io: CliIO): number {
  const asJson = argv.includes('--json')
  const opDbPath = defaultOpDbPath()
  const lockPath = defaultLockPath()
  const running = existsSync(lockPath)

  let sessionCount = 0
  let detectionCount = 0
  let recent: Array<{ kind: string; subtype: string; created_at: number }> = []

  if (existsSync(opDbPath)) {
    // read-only 연결로 운영 DB 조회 (WAL 비차단). 실패해도 status는 출력.
    let db: Database.Database | null = null
    try {
      db = new Database(opDbPath, { readonly: true })
      const sc = db.prepare('SELECT COUNT(DISTINCT session_id) AS n FROM events').get() as
        | { n: number }
        | undefined
      sessionCount = sc?.n ?? 0
      const dc = db.prepare('SELECT COUNT(*) AS n FROM detections').get() as
        | { n: number }
        | undefined
      detectionCount = dc?.n ?? 0
      recent = db
        .prepare(
          'SELECT kind, subtype, created_at FROM detections ORDER BY created_at DESC LIMIT 5',
        )
        .all() as Array<{ kind: string; subtype: string; created_at: number }>
    } catch (err) {
      io.err(`[status] DB 조회 실패: ${String(err)}\n`)
    } finally {
      db?.close()
    }
  }

  const summary = {
    running,
    lockPath,
    opDbPath,
    dbExists: existsSync(opDbPath),
    sessionCount,
    detectionCount,
    recentDetections: recent,
  }

  if (asJson) {
    io.out(JSON.stringify(summary, null, 2) + '\n')
  } else {
    io.out(`loopbreaker status\n`)
    io.out(`  데몬: ${running ? '실행 중 (lockfile 존재)' : '정지 (lockfile 없음)'}\n`)
    io.out(`  운영 DB: ${summary.dbExists ? opDbPath : '(없음)'}\n`)
    io.out(`  세션 수: ${sessionCount}\n`)
    io.out(`  누적 탐지: ${detectionCount}\n`)
    if (recent.length > 0) {
      io.out(`  최근 탐지:\n`)
      for (const d of recent) {
        io.out(`    - ${d.kind}/${d.subtype} (${new Date(d.created_at).toISOString()})\n`)
      }
    }
  }
  return 0
}

/** doctor: 권한·경로·DB·설정 건강검진 (SPEC §6.4) */
function cmdDoctor(io: CliIO): number {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = []

  const configDir = defaultConfigDir()
  checks.push({
    name: '설정 디렉터리',
    ok: existsSync(configDir),
    detail: configDir,
  })

  const configPath = defaultConfigPath()
  checks.push({
    name: 'config.json',
    ok: existsSync(configPath),
    detail: existsSync(configPath) ? configPath : '(없음 — 기본값 사용)',
  })

  const claudeDir = join(homedir(), '.claude', 'projects')
  checks.push({
    name: '~/.claude/projects 읽기',
    ok: existsSync(claudeDir),
    detail: claudeDir,
  })

  const opDbPath = defaultOpDbPath()
  checks.push({
    name: '운영 DB',
    ok: existsSync(opDbPath),
    detail: existsSync(opDbPath) ? opDbPath : '(아직 생성 안 됨 — 첫 기동 시 생성)',
  })

  const apiKey = process.env['ANTHROPIC_API_KEY']
  checks.push({
    name: 'ANTHROPIC_API_KEY',
    ok: apiKey !== undefined && apiKey.length > 0,
    detail: apiKey ? '설정됨' : '(미설정 — judge 단계는 Mock 폴백)',
  })

  io.out('loopbreaker doctor\n')
  let allOk = true
  for (const c of checks) {
    const mark = c.ok ? '✅' : '⚠️ '
    if (!c.ok) allOk = false
    io.out(`  ${mark} ${c.name}: ${c.detail}\n`)
  }
  io.out(allOk ? '\n전 항목 정상.\n' : '\n일부 항목 주의 — 위 ⚠️ 확인.\n')
  return allOk ? 0 : 1
}

/** start: --foreground면 직접 실행, 아니면 안내 */
async function cmdStart(argv: readonly string[], io: CliIO): Promise<number> {
  if (argv.includes('--foreground')) {
    await runDaemon()
    return 0
  }
  io.out(
    'loopbreaker start: launchd 기반 백그라운드 기동은 setup으로 plist 설치 후 사용하세요.\n' +
      '지금 바로 포그라운드로 실행하려면: loopbreaker start --foreground\n',
  )
  return 0
}

/**
 * argv를 받아 명령을 디스패치한다. process.argv.slice(2) 형태를 받는다.
 * @returns 종료 코드 (0=성공)
 */
export async function dispatch(argv: readonly string[], io: CliIO = defaultIo): Promise<number> {
  const cmd = argv[0]
  const rest = argv.slice(1)

  switch (cmd) {
    case 'start':
      return cmdStart(rest, io)
    case 'stop':
      io.out('loopbreaker stop: 포그라운드 실행은 SIGTERM/Ctrl-C로 종료하세요.\n')
      return 0
    case 'status':
      return cmdStatus(rest, io)
    case 'doctor':
      return cmdDoctor(io)
    case 'version':
    case '--version':
    case '-v':
      io.out(`loopbreaker ${APP_VERSION}\n`)
      return 0
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      io.out(HELP)
      return 0
    default:
      io.err(`알 수 없는 명령: ${cmd}\n\n`)
      io.out(HELP)
      return 1
  }
}

/** import 시 실행 금지 가드 */
function isMain(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  return import.meta.url === `file://${entry}`
}

if (isMain()) {
  dispatch(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((err: unknown) => {
      process.stderr.write(`[FATAL] ${String(err)}\n`)
      process.exitCode = 1
    })
}
