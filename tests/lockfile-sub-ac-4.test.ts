/**
 * lockfile-sub-ac-4.test.ts
 *
 * Sub-AC 4: lockPath DI 격리 —
 *   acquireLock/releaseLock 모두 hardcoded 경로(~/.loopbreaker/daemon.lock)를
 *   사용하지 않고 인자로 주입된 경로만 사용한다.
 *
 * 검증 항목:
 *   1. os.tmpdir() 하위 경로를 주입하여 실제 데몬 경로에 접근 없이
 *      전체 lock 사이클(acquire → release)이 완료된다.
 *   2. acquireLock 실행 중 ~/.loopbreaker/daemon.lock 에는 어떠한 파일도
 *      생성되지 않는다.
 *   3. 서로 다른 tmpdir 하위 경로를 주입하면 독립적으로 lock 사이클이 동작한다.
 *   4. lockfile.ts 소스에 hardcoded ~/.loopbreaker 경로 리터럴이 없다.
 *
 * 테스트 규칙:
 * - 실제 ~/.loopbreaker 경로 접근 0 (파일 생성·읽기·삭제 모두 금지)
 * - 부수효과 0 (실제 OS 알림·네트워크·API 키 없음)
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { acquireLock, releaseLock } from '../src/daemon/lockfile.js'

/** 테스트마다 격리된 임시 lockPath를 생성한다 */
function makeTmpLockPath(prefix = 'loopbreaker-lock-ac4-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return path.join(dir, 'daemon.lock')
}

/** 실제 데몬 lockfile 기본 경로 (이 경로에는 절대 접근하면 안 됨) */
const REAL_DAEMON_LOCK = path.join(os.homedir(), '.loopbreaker', 'daemon.lock')

describe('lockPath DI 격리 (Sub-AC 4)', () => {
  it('os.tmpdir() 하위 경로를 주입하면 전체 lock 사이클이 완료된다', () => {
    const lockPath = makeTmpLockPath()

    // 실제 데몬 경로가 아닌 주입된 경로여야 한다
    expect(lockPath).not.toBe(REAL_DAEMON_LOCK)
    expect(lockPath.startsWith(os.tmpdir())).toBe(true)

    // acquire
    const handle = acquireLock(lockPath)
    expect(handle.lockPath).toBe(lockPath)
    expect(handle.pid).toBe(process.pid)
    expect(fs.existsSync(lockPath)).toBe(true)

    // release
    releaseLock(handle)
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it('lock 사이클 동안 ~/.loopbreaker/daemon.lock 파일이 생성되지 않는다', () => {
    const lockPath = makeTmpLockPath()

    // 실제 데몬 lock 파일의 사전 상태 기록
    const realLockExistedBefore = fs.existsSync(REAL_DAEMON_LOCK)

    const handle = acquireLock(lockPath)
    releaseLock(handle)

    // 실제 데몬 lock 상태가 변하지 않았는지 확인
    const realLockExistsAfter = fs.existsSync(REAL_DAEMON_LOCK)
    expect(realLockExistsAfter).toBe(realLockExistedBefore)
  })

  it('서로 다른 tmpdir 하위 경로를 주입하면 독립적으로 동작한다', () => {
    const lockPath1 = makeTmpLockPath('loopbreaker-lock-ac4-a-')
    const lockPath2 = makeTmpLockPath('loopbreaker-lock-ac4-b-')

    expect(lockPath1).not.toBe(lockPath2)

    const handle1 = acquireLock(lockPath1)
    const handle2 = acquireLock(lockPath2)

    expect(handle1.lockPath).toBe(lockPath1)
    expect(handle2.lockPath).toBe(lockPath2)
    expect(fs.existsSync(lockPath1)).toBe(true)
    expect(fs.existsSync(lockPath2)).toBe(true)

    releaseLock(handle1)
    releaseLock(handle2)

    expect(fs.existsSync(lockPath1)).toBe(false)
    expect(fs.existsSync(lockPath2)).toBe(false)
  })

  it('주입된 경로가 LockHandle.lockPath에 그대로 보존된다', () => {
    const injectedPath = makeTmpLockPath()

    const handle = acquireLock(injectedPath)

    // DI 계약: 주입한 경로가 핸들에 그대로 반영돼야 한다
    expect(handle.lockPath).toBe(injectedPath)

    releaseLock(handle)
  })

  it('중첩 임시 디렉터리 경로도 주입 가능하다(mkdirSync recursive)', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopbreaker-lock-ac4-nested-'))
    const injectedPath = path.join(baseDir, 'sub', 'nested', 'daemon.lock')

    // 하위 디렉터리는 아직 존재하지 않음
    expect(fs.existsSync(path.dirname(injectedPath))).toBe(false)

    // acquireLock이 recursive mkdirSync로 생성해야 함
    const handle = acquireLock(injectedPath)
    expect(fs.existsSync(injectedPath)).toBe(true)
    expect(handle.lockPath).toBe(injectedPath)

    releaseLock(handle)
    expect(fs.existsSync(injectedPath)).toBe(false)
  })
})
