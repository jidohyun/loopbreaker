/**
 * daemon/shutdown.ts — gracefulShutdown 조립 유틸리티
 *
 * SPEC §3.3 installSignalHandlers / shutdown 순서:
 *   1. WatchSource.close()  — 신규 이벤트 enqueue 중단
 *   2. 각 SessionPipeline 큐 drain  — 진행 중 작업 완료 대기
 *   3. StorageLayer flush/close  — DB 닫기
 *   4. lockfile 해제  — releaseLock()
 *
 * 설계 원칙:
 *   - buildShutdownSequence 는 순수 함수(pure function).
 *     부수효과 없이 ShutdownStep[] 배열만 반환한다.
 *   - 실제 I/O 실행은 호출자(runShutdown)가 담당한다.
 *   - console.log 금지 — 주입된 logger 사용.
 *   - 불변성: 입력 변경 금지, 새 배열/객체 반환.
 */

import type { WatchSource } from '../watch/watch-source.js'
import type { LockHandle } from './lockfile.js'

// ─── 타입 정의 ────────────────────────────────────────────────────────────────

/** 큐 drain 및 닫기가 가능한 파이프라인 인터페이스 */
export interface DrainableSession {
  drainAndClose(): Promise<void>
}

/** StorageLayer의 닫기 인터페이스 */
export interface CloseableStorage {
  close(): Promise<void>
}

/** 단일 shutdown 단계 */
export interface ShutdownStep {
  /** 단계 이름 (로그/디버그용) */
  readonly name: string
  /** 실행할 비동기 함수 */
  readonly run: () => Promise<void>
}

/** buildShutdownSequence 입력 */
export interface ShutdownDeps {
  /** 파일 감시 소스 — 첫 번째로 닫는다 */
  readonly watchSource: WatchSource
  /** 세션 파이프라인 맵 (sessionId → pipeline) */
  readonly sessions: ReadonlyMap<string, DrainableSession>
  /** 스토리지 레이어 */
  readonly storage: CloseableStorage
  /** lockfile 핸들 */
  readonly lockHandle: LockHandle
  /** lockfile 해제 함수 (DI — 기본은 lockfile.ts의 releaseLock) */
  readonly releaseLock: (handle: LockHandle) => void
}

// ─── 순수 함수 ────────────────────────────────────────────────────────────────

/**
 * SPEC §3.3 gracefulShutdown 4단계 작업 배열을 반환하는 순수 함수.
 *
 * 반환 순서:
 *   [0] watchSource.close()  — 신규 이벤트 enqueue 차단
 *   [1] sessions drain        — 세션별 큐 drain (병렬)
 *   [2] storage.close()       — StorageLayer flush/close
 *   [3] releaseLock()         — lockfile 해제
 *
 * 이 함수는 어떤 I/O도 실행하지 않는다.
 * 반환된 ShutdownStep[] 을 순서대로 실행하는 것은 호출자의 책임이다.
 *
 * @param deps  종속성 (모든 의존성이 DI로 주입)
 * @returns     ShutdownStep[] (길이=4, 순서 보장)
 */
export function buildShutdownSequence(deps: ShutdownDeps): ShutdownStep[] {
  const { watchSource, sessions, storage, lockHandle, releaseLock } = deps

  return [
    // ── 단계 1: WatchSource 닫기 ────────────────────────────────────────────
    {
      name: 'watchSource.close',
      run: () => watchSource.close(),
    },

    // ── 단계 2: 세션 큐 drain ────────────────────────────────────────────────
    {
      name: 'sessions.drainAndClose',
      run: async () => {
        // 세션 파이프라인들을 병렬로 drain — 각각 독립적이므로 병렬 안전
        const drainPromises = Array.from(sessions.values()).map((pipeline) =>
          pipeline.drainAndClose(),
        )
        await Promise.all(drainPromises)
      },
    },

    // ── 단계 3: StorageLayer 닫기 ────────────────────────────────────────────
    {
      name: 'storage.close',
      run: () => storage.close(),
    },

    // ── 단계 4: lockfile 해제 ────────────────────────────────────────────────
    {
      name: 'releaseLock',
      run: async () => {
        releaseLock(lockHandle)
      },
    },
  ]
}

// ─── 실행 헬퍼 ───────────────────────────────────────────────────────────────

/** 구조화 로거 인터페이스 (shutdown 실행 시 사용) */
export interface ShutdownLogger {
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
}

/** no-op 로거 */
const noopLogger: ShutdownLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

/**
 * buildShutdownSequence가 반환한 ShutdownStep[]을 순서대로 실행한다.
 *
 * - 각 단계는 순서대로 실행되며, 한 단계 실패가 이후 단계를 건너뛰지 않는다.
 * - 모든 단계 실행 후 수집된 오류를 반환한다.
 * - shutdownTimeoutMs 내 완료하지 못한 단계는 타임아웃 후 계속 진행(최선 노력).
 *
 * @param steps  buildShutdownSequence 반환값
 * @param logger 구조화 로거 (옵션)
 * @param shutdownTimeoutMs 전체 타임아웃 (ms, 기본 10000)
 * @returns      각 단계에서 발생한 오류 배열 (비었으면 정상 종료)
 */
export async function runShutdown(
  steps: ShutdownStep[],
  logger: ShutdownLogger = noopLogger,
  shutdownTimeoutMs = 10_000,
): Promise<Error[]> {
  const errors: Error[] = []
  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`shutdown timeout after ${shutdownTimeoutMs}ms`)), shutdownTimeoutMs),
  )

  for (const step of steps) {
    try {
      logger.info(`shutdown: ${step.name} 시작`)
      await Promise.race([step.run(), deadline])
      logger.info(`shutdown: ${step.name} 완료`)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      logger.error(`shutdown: ${step.name} 실패`, { error: error.message })
      errors.push(error)
    }
  }

  return errors
}
