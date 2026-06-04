/**
 * lockfile-sub-ac-3.test.ts
 *
 * Sub-AC 3: releaseLock(handle) 함수 —
 *   acquireLock이 반환한 핸들로 lock을 해제하고 lockfile을 삭제한다.
 *
 * 검증 항목:
 *   1. acquireLock 후 releaseLock 호출 시 파일이 제거된다.
 *   2. releaseLock 이후 동일 경로에 acquireLock이 다시 성공한다.
 *   3. 이미 삭제된 lockfile에 releaseLock을 호출해도 에러가 발생하지 않는다(best-effort).
 *   4. 다른 프로세스 PID가 기록된 경우 삭제하지 않는다(보호).
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopbreaker-lock-ac3-'))
  return path.join(dir, 'daemon.lock')
}

describe('releaseLock (Sub-AC 3)', () => {
  it('acquireLock 후 releaseLock 호출 시 lockfile이 제거된다', () => {
    const lockPath = makeTmpLockPath()

    const handle = acquireLock(lockPath)

    // lockfile이 생성됐는지 확인
    expect(fs.existsSync(lockPath)).toBe(true)

    releaseLock(handle)

    // lockfile이 삭제됐는지 확인
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it('releaseLock 이후 동일 경로에 acquireLock이 다시 성공한다', () => {
    const lockPath = makeTmpLockPath()

    // 첫 번째 획득
    const handle1 = acquireLock(lockPath)
    expect(handle1.lockPath).toBe(lockPath)
    expect(handle1.pid).toBe(process.pid)

    // 해제
    releaseLock(handle1)
    expect(fs.existsSync(lockPath)).toBe(false)

    // 동일 경로 재획득 — 성공해야 한다
    const handle2 = acquireLock(lockPath)
    expect(handle2.lockPath).toBe(lockPath)
    expect(handle2.pid).toBe(process.pid)
    expect(fs.existsSync(lockPath)).toBe(true)

    // 정리
    releaseLock(handle2)
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it('이미 삭제된 lockfile에 releaseLock을 호출해도 에러가 발생하지 않는다', () => {
    const lockPath = makeTmpLockPath()

    const handle = acquireLock(lockPath)

    // 먼저 파일을 직접 삭제
    fs.unlinkSync(lockPath)
    expect(fs.existsSync(lockPath)).toBe(false)

    // best-effort: 이미 없어도 에러 없이 종료해야 함
    expect(() => releaseLock(handle)).not.toThrow()
  })

  it('다른 프로세스 PID가 기록된 경우 파일을 삭제하지 않는다', () => {
    const lockPath = makeTmpLockPath()

    const handle = acquireLock(lockPath)

    // 다른 PID(1=init/launchd)로 덮어쓰기 — 다른 프로세스가 재취득한 상황
    fs.writeFileSync(lockPath, '1', { encoding: 'utf8' })

    // 내 handle로 releaseLock 호출해도 파일이 남아야 함
    releaseLock(handle)
    expect(fs.existsSync(lockPath)).toBe(true)

    // 정리
    fs.unlinkSync(lockPath)
  })

  it('연속 releaseLock 호출(이중 해제)은 에러 없이 처리된다', () => {
    const lockPath = makeTmpLockPath()

    const handle = acquireLock(lockPath)
    releaseLock(handle)

    // 두 번째 releaseLock — 이미 파일이 없으므로 no-op
    expect(() => releaseLock(handle)).not.toThrow()
    expect(fs.existsSync(lockPath)).toBe(false)
  })
})
