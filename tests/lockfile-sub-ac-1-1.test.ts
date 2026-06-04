/**
 * lockfile-sub-ac-1-1.test.ts
 *
 * Sub-AC 1.1: acquireLock(lockPath) 함수 —
 *   지정된 임시경로에 lockfile을 생성하고 LockHandle을 반환한다.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopbreaker-lock-test-'))
  return path.join(dir, 'daemon.lock')
}

describe('acquireLock (Sub-AC 1.1)', () => {
  it('임시경로에 lockfile을 생성하고 LockHandle을 반환한다', () => {
    const lockPath = makeTmpLockPath()

    const handle = acquireLock(lockPath)

    // 파일이 실제로 생성됐는지 확인
    expect(fs.existsSync(lockPath)).toBe(true)

    // handle이 올바른 구조를 가지는지 확인
    expect(handle).toBeDefined()
    expect(handle.lockPath).toBe(lockPath)
    expect(handle.pid).toBe(process.pid)

    // 파일 내용이 PID인지 확인
    const content = fs.readFileSync(lockPath, { encoding: 'utf8' }).trim()
    expect(content).toBe(String(process.pid))

    // 정리
    releaseLock(handle)
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it('중첩 디렉터리도 자동 생성된다', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopbreaker-lock-nested-'))
    const lockPath = path.join(baseDir, 'sub', 'dir', 'daemon.lock')

    const handle = acquireLock(lockPath)

    expect(fs.existsSync(lockPath)).toBe(true)
    expect(handle.lockPath).toBe(lockPath)

    releaseLock(handle)
  })

  it('이미 살아있는 PID가 lockfile을 점유하면 Error를 throw한다', () => {
    const lockPath = makeTmpLockPath()

    // 현재 PID(살아있음)를 lockfile에 직접 기록
    const dir = path.dirname(lockPath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(lockPath, String(process.pid), { encoding: 'utf8' })

    expect(() => acquireLock(lockPath)).toThrow(/already running/)

    // 정리
    fs.unlinkSync(lockPath)
  })

  it('stale lockfile(죽은 PID)이 있으면 덮어쓰고 성공한다', () => {
    const lockPath = makeTmpLockPath()

    // 절대 존재할 수 없는 PID (99999999)를 stale lock으로 기록
    const dir = path.dirname(lockPath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(lockPath, '99999999', { encoding: 'utf8' })

    // stale이므로 성공해야 한다
    const handle = acquireLock(lockPath)
    expect(handle.pid).toBe(process.pid)

    releaseLock(handle)
  })

  it('빈 lockPath는 Error를 throw한다', () => {
    expect(() => acquireLock('')).toThrow()
    expect(() => acquireLock('   ')).toThrow()
  })

  it('releaseLock은 다른 프로세스 PID가 기록된 경우 삭제하지 않는다', () => {
    const lockPath = makeTmpLockPath()

    const handle = acquireLock(lockPath)

    // 다른 PID로 덮어쓰기 (다른 프로세스가 재취득한 상황 시뮬레이션)
    fs.writeFileSync(lockPath, '1', { encoding: 'utf8' })

    // 내 handle로 releaseLock 호출해도 파일이 남아야 함
    releaseLock(handle)
    expect(fs.existsSync(lockPath)).toBe(true)

    // 정리
    fs.unlinkSync(lockPath)
  })
})
