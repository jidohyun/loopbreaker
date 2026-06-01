/**
 * watch/index.ts — LoopBreaker 파일 감시 모듈
 *
 * M1 구현: chokidar로 ~/.claude/projects/**를 재귀 감시.
 * macOS fs.watch 누락 대응을 위한 폴링 백업 포함.
 *
 * 주의: chokidar v4+ 는 glob 지원이 제거되었다.
 *   patterns 배열의 '/**' 같은 후미 glob 접미사는 resolveWatchPath()가
 *   자동으로 제거하여 디렉터리 경로로 변환한 뒤 chokidar에 전달한다.
 *   원본 패턴 문자열은 WatcherHandle.patterns 에 그대로 보존된다.
 */

import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'

/** 감시 상태 */
export type WatchStatus = 'idle' | 'watching' | 'error'

/** 감시 옵션 인터페이스 */
export interface WatchOptions {
  readonly sessionPath: string
  readonly pollIntervalMs?: number
}

/** createWatcher 옵션 */
export interface CreateWatcherOptions {
  /**
   * 감시할 glob 패턴 목록.
   * 기본값: ['~/.claude/projects/**']
   */
  readonly patterns?: readonly string[]
  /**
   * 폴링 간격(ms). usePolling=true 시 사용.
   * macOS fs.watch 누락 대응.
   * 기본값: 1000
   */
  readonly pollIntervalMs?: number
  /**
   * usePolling 강제 활성화 여부.
   * 기본값: false (chokidar가 자동 감지)
   */
  readonly usePolling?: boolean
  /**
   * 감시 시작 후 기존 파일 add 이벤트를 무시할지.
   * 기본값: true (live tail 목적이므로 기존 파일 스캔 불필요)
   */
  readonly ignoreInitial?: boolean
}

/** createWatcher 반환 타입 */
export interface WatcherHandle {
  /** 실제 chokidar FSWatcher 인스턴스 */
  readonly watcher: FSWatcher
  /** 감시 중인 glob 패턴 목록 (원본 문자열 보존) */
  readonly patterns: readonly string[]
  /** 감시 중지 */
  close(): Promise<void>
}

/** 감시 인스턴스 인터페이스 (하위 호환) */
export interface Watcher {
  readonly status: WatchStatus
  start(options: WatchOptions): Promise<void>
  stop(): Promise<void>
}

/**
 * 현재 플랫폼이 macOS인지 반환한다.
 * process.platform 목킹 테스트를 위해 별도 함수로 분리.
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin'
}

/**
 * glob 패턴 문자열에서 chokidar에 전달할 실제 디렉터리/파일 경로를 추출한다.
 *
 * chokidar v4+ 부터 glob 지원이 제거되었으므로, '/**', '/*', '/*.jsonl' 같은
 * 후미 glob 접미사를 제거하고 디렉터리 경로만 반환한다.
 *
 * 변환 예:
 *   '~/.claude/projects/**'    → '<HOME>/.claude/projects'
 *   '/tmp/foo/ ** /*.jsonl'   → '/tmp/foo'  (spaces added to avoid JSDoc issue)
 *   '/tmp/exact-dir'          → '/tmp/exact-dir' (그대로)
 *   '/tmp/exact-file.jsonl'   → '/tmp/exact-file.jsonl' (그대로)
 *
 * @internal 단위 테스트를 위해 export
 */
export function resolveWatchPath(pattern: string): string {
  // 홈 디렉터리 ~ 확장
  const expanded = pattern.startsWith('~/')
    ? pattern.replace(/^~/, process.env['HOME'] ?? '~')
    : pattern

  // 패턴에 glob 문자가 없으면 그대로 반환
  const hasGlob = /[*?{]/.test(expanded)
  if (!hasGlob) return expanded

  // 마지막 '/' 이전 경로를 기준 디렉터리로 사용
  const lastSlash = expanded.lastIndexOf('/')
  if (lastSlash <= 0) return expanded

  const base = expanded.slice(0, lastSlash)

  // base에도 glob이 포함된 경우 재귀적으로 제거
  if (/[*?{]/.test(base)) {
    return resolveWatchPath(base)
  }

  return base
}

/**
 * chokidar 기반 파일 감시 인스턴스를 생성한다.
 *
 * - ~/.claude/projects/ 를 재귀 감시 (기본값, depth=99)
 * - subagents/[id]/agent-*.jsonl 포함 (재귀 감시로 커버)
 * - macOS fs.watch 누락 대응: darwin 플랫폼에서 자동으로 usePolling=true 설정
 * - ignoreInitial=true: 기존 파일은 무시, 새 변경만 감지
 *
 * @param paths - 감시할 glob 패턴 또는 디렉터리/파일 경로 배열.
 *                빈 배열이면 기본 패턴(~/.claude/projects/**) 사용.
 * @param options - 추가 감시 옵션
 * @returns WatcherHandle (watcher, patterns, close 포함)
 */
export function createWatcher(
  paths: readonly string[],
  options: CreateWatcherOptions = {},
): WatcherHandle {
  const {
    pollIntervalMs = 1000,
    ignoreInitial = true,
  } = options

  // macOS(darwin)에서는 fs.watch 이벤트 누락 방지를 위해 폴링 백업 사용.
  // options.usePolling이 명시적으로 주어지면 그 값을 우선 사용.
  const usePolling: boolean =
    options.usePolling !== undefined ? options.usePolling : isMacOS()

  // 빈 배열이면 기본 패턴(~/.claude/projects/**)을 사용
  const resolvedPatterns: readonly string[] =
    paths.length > 0 ? paths : ['~/.claude/projects/**']

  // chokidar v4+: glob 미지원 → 패턴에서 실제 디렉터리 경로로 변환
  const watchPaths = resolvedPatterns.map(resolveWatchPath)

  const watcher = chokidar.watch(watchPaths, {
    persistent: true,
    ignoreInitial,
    usePolling,
    interval: pollIntervalMs,
    // 재귀 감시: depth=99로 무제한 중첩 서브디렉터리 감시
    depth: 99,
    // 심볼릭 링크 추적
    followSymlinks: true,
    // 원자적 쓰기 대기
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  })

  return {
    watcher,
    patterns: resolvedPatterns,
    close: () => watcher.close(),
  }
}

/**
 * WatchManager — chokidar watcher 생명주기 관리자.
 *
 * start() 호출로 watcher를 활성화하고, stop() 호출로 watcher를 닫아
 * 이후 이벤트를 더 이상 발행하지 않도록 한다.
 *
 * Sub-AC 6d 계약:
 *   - start() 전에는 status='idle', watcher 없음.
 *   - start() 후 status='watching', chokidar watcher 활성화.
 *   - stop() 후 status='idle', watcher closed (이벤트 발행 중지).
 *   - 이미 watching 중 start() 재호출 시 기존 watcher를 먼저 닫고 새로 생성.
 *   - stop() 이 idle 상태에서 호출되면 no-op.
 */
export class WatchManager {
  private _status: WatchStatus = 'idle'
  private _handle: WatcherHandle | null = null
  private readonly _options: CreateWatcherOptions

  constructor(options: CreateWatcherOptions = {}) {
    this._options = options
  }

  /** 현재 감시 상태 */
  get status(): WatchStatus {
    return this._status
  }

  /** 현재 활성 WatcherHandle (없으면 null) */
  get handle(): WatcherHandle | null {
    return this._handle
  }

  /**
   * watcher를 시작한다.
   * 이미 watching 상태이면 기존 watcher를 닫고 새로 시작한다.
   *
   * @param patterns - 감시할 glob 패턴 목록. 기본값: ['~/.claude/projects/**']
   */
  async start(patterns: readonly string[] = []): Promise<void> {
    // 이미 watching 중이면 기존 watcher 정리
    if (this._handle !== null) {
      await this._handle.close()
      this._handle = null
    }

    try {
      const handle = createWatcher(patterns, this._options)
      this._handle = handle
      this._status = 'watching'
    } catch (err) {
      this._status = 'error'
      throw err
    }
  }

  /**
   * watcher를 중지한다.
   * idle 상태에서 호출 시 no-op.
   */
  async stop(): Promise<void> {
    if (this._handle === null) {
      return
    }

    await this._handle.close()
    this._handle = null
    this._status = 'idle'
  }
}

/**
 * watch 모듈 기본 export (하위 호환용).
 */
const watchStub = {
  version: '0.0.0-m0',
  description: 'LoopBreaker watch — chokidar 기반 실시간 파일 감시',
} as const

export default watchStub
