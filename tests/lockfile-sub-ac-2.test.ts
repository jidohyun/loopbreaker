/**
 * lockfile-sub-ac-2.test.ts
 *
 * Sub-AC 2: acquireLock(lockPath) 중복 획득 거부 —
 *   이미 lock이 점유된 경로에 대해 두 번째 acquireLock 호출이
 *   Error를 throw한다.
 *
 * 테스트 규칙:
 * - 실제 ~/.loopbreaker 경로 금지 — os.tmpdir() 하위 임시경로만 사용
 * - 부수효과 0 (실제 OS 알림·네트워크·API 키 없음)
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { acquireLock, releaseLock } from '../src/daemon/lockfile.js'

function makeTmpLockPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopbreaker-lock-ac2-'))
  return path.join(dir, 'daemon.lock')
}

describe('acquireLock 중복 획득 거부 (Sub-AC 2)', () => {
  it('동일 경로에 두 번째 acquireLock 호출은 Error를 throw한다', () => {
    const lockPath = makeTmpLockPath()

    // 첫 번째 획득 — 성공해야 함
    const handle = acquireLock(lockPath)
    expect(handle).toBeDefined()
    expect(handle.lockPath).toBe(lockPath)
    expect(handle.pid).toBe(process.pid)

    // 두 번째 획득 — 같은 경로, 살아있는 현재 PID가 기록돼 있으므로 거부돼야 함
    expect(() => acquireLock(lockPath)).toThrow(/already running/)

    // 정리
    releaseLock(handle)
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it('releaseLock 후에는 동일 경로 재획득이 허용된다', () => {
    const lockPath = makeTmpLockPath()

    const handle1 = acquireLock(lockPath)
    releaseLock(handle1)

    // 해제 후 재획득은 성공해야 함
    const handle2 = acquireLock(lockPath)
    expect(handle2.lockPath).toBe(lockPath)
    expect(handle2.pid).toBe(process.pid)

    releaseLock(handle2)
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it('서로 다른 경로는 독립적으로 획득 가능하다', () => {
    const lockPath1 = makeTmpLockPath()
    const lockPath2 = makeTmpLockPath()

    const handle1 = acquireLock(lockPath1)
    const handle2 = acquireLock(lockPath2)

    expect(handle1.lockPath).toBe(lockPath1)
    expect(handle2.lockPath).toBe(lockPath2)

    releaseLock(handle1)
    releaseLock(handle2)
  })
})
