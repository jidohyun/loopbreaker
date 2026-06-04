/**
 * daemon/lockfile.ts — 단일 인스턴스 보증 (PID 기반 lockfile)
 *
 * SPEC §3.1: flock 또는 PID 기반 단일 인스턴스 보증.
 * - acquireLock(lockPath): lockfile 생성 후 LockHandle 반환.
 *   이미 점유 중(살아있는 PID)이면 Error를 throw.
 * - releaseLock(handle): lockfile 해제.
 * - stale lock 처리: PID가 기록된 lockfile이 있더라도 그 PID가
 *   살아있지 않으면 stale로 간주하고 덮어쓴다.
 *
 * 제약:
 * - console.log 금지
 * - 불변성: 입력 객체 변경 금지
 * - 테스트는 os.tmpdir() 하위 임시경로를 사용 (실제 ~/.loopbreaker 금지)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/** acquireLock 반환 핸들 */
export interface LockHandle {
  /** lockfile 절대 경로 */
  readonly lockPath: string
  /** 이 프로세스의 PID */
  readonly pid: number
}

/**
 * lockfile을 취득한다.
 *
 * 알고리즘:
 * 1. lockPath 디렉터리를 재귀 생성한다.
 * 2. lockfile이 있으면 PID를 읽어 프로세스가 살아있는지 확인한다.
 *    살아있으면 Error throw (단일 인스턴스 보증).
 *    죽었으면(stale) 덮어쓴다.
 * 3. 현재 PID를 lockfile에 쓴다.
 * 4. LockHandle을 반환한다.
 *
 * @param lockPath lockfile 절대 경로 (기본: ~/.loopbreaker/daemon.lock,
 *                 테스트는 os.tmpdir() 하위 임시경로를 주입)
 * @returns LockHandle
 * @throws Error if another live process holds the lock
 */
export function acquireLock(lockPath: string): LockHandle {
  if (!lockPath || lockPath.trim().length === 0) {
    throw new Error('acquireLock: lockPath must be a non-empty string')
  }

  // 디렉터리 보장
  const dir = path.dirname(lockPath)
  fs.mkdirSync(dir, { recursive: true })

  // 기존 lockfile 확인
  if (fs.existsSync(lockPath)) {
    const existing = _readPidFromLock(lockPath)
    if (existing !== null && _isProcessAlive(existing)) {
      throw new Error(
        `acquireLock: daemon is already running (PID=${existing}, lockPath=${lockPath})`,
      )
    }
    // stale lock — 덮어쓴다
  }

  const pid = process.pid
  fs.writeFileSync(lockPath, String(pid), { encoding: 'utf8' })

  return { lockPath, pid }
}

/**
 * lockfile을 해제한다.
 *
 * @param handle acquireLock이 반환한 LockHandle
 */
export function releaseLock(handle: LockHandle): void {
  try {
    if (fs.existsSync(handle.lockPath)) {
      const recorded = _readPidFromLock(handle.lockPath)
      // 자신의 PID가 기록된 경우에만 삭제 (다른 프로세스가 재취득한 경우 보호)
      if (recorded === handle.pid) {
        fs.unlinkSync(handle.lockPath)
      }
    }
  } catch {
    // releaseLock은 실패해도 데몬을 죽이지 않는다 (best-effort)
  }
}

// ---- 내부 헬퍼 ----

/**
 * lockfile에서 PID를 읽는다.
 * 읽기 실패 또는 파싱 실패 시 null 반환.
 */
function _readPidFromLock(lockPath: string): number | null {
  try {
    const content = fs.readFileSync(lockPath, { encoding: 'utf8' }).trim()
    const pid = parseInt(content, 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/**
 * 지정된 PID의 프로세스가 살아있는지 확인한다.
 * process.kill(pid, 0)은 신호를 보내지 않고 존재 여부만 확인.
 */
function _isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
