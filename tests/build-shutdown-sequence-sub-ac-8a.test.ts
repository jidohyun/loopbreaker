/**
 * tests/build-shutdown-sequence-sub-ac-8a.test.ts
 *
 * Sub-AC 8a: buildShutdownSequence 순수 함수 검증
 *
 * 검증 항목:
 *   1. 반환 배열 길이 = 4
 *   2. 단계 이름이 올바른 순서로 나열됨
 *   3. 각 단계의 run()이 올바른 의존성 메서드를 호출함
 *   4. WatchSource.close → sessions.drainAndClose → storage.close → releaseLock 순서 보장
 *   5. 순수 함수 — buildShutdownSequence 자체는 어떤 I/O도 수행하지 않음
 *   6. 실제 I/O 없음 (모든 의존성 mock)
 *
 * 제약:
 *   - 실제 파일 감시 / 네트워크 / OS 알림 / ~/.loopbreaker 경로 없음
 *   - 모든 의존성은 jest.fn() mock으로 주입
 */

import { jest, describe, it, expect } from '@jest/globals'
import {
  buildShutdownSequence,
  runShutdown,
  type ShutdownDeps,
  type DrainableSession,
  type CloseableStorage,
  type ShutdownStep,
} from '../src/daemon/shutdown.js'
import type { WatchSource, WatchCallbacks } from '../src/watch/watch-source.js'
import type { LockHandle } from '../src/daemon/lockfile.js'

// ─── mock 팩토리 ──────────────────────────────────────────────────────────────

function makeMockWatchSource(): WatchSource & {
  close: ReturnType<typeof jest.fn>
  start: ReturnType<typeof jest.fn>
} {
  return {
    start: jest.fn<(callbacks: WatchCallbacks) => Promise<void>>().mockResolvedValue(undefined),
    close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
}

function makeMockSession(): DrainableSession & {
  drainAndClose: ReturnType<typeof jest.fn>
} {
  return {
    drainAndClose: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
}

function makeMockStorage(): CloseableStorage & {
  close: ReturnType<typeof jest.fn>
} {
  return {
    close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
}

function makeLockHandle(lockPath = '/tmp/test-daemon.lock', pid = 12345): LockHandle {
  return { lockPath, pid }
}

function makeReleaseLock(): ReturnType<typeof jest.fn> {
  return jest.fn<(handle: LockHandle) => void>()
}

// 세션 맵을 포함한 전체 deps 빌더
function makeDeps(overrides: Partial<ShutdownDeps> = {}) {
  const watchSource = makeMockWatchSource()
  const session1 = makeMockSession()
  const session2 = makeMockSession()
  const sessions = new Map<string, DrainableSession>([
    ['session-aaa', session1],
    ['session-bbb', session2],
  ])
  const storage = makeMockStorage()
  const lockHandle = makeLockHandle()
  const releaseLock = makeReleaseLock()

  const deps: ShutdownDeps = {
    watchSource,
    sessions,
    storage,
    lockHandle,
    releaseLock: releaseLock as (handle: LockHandle) => void,
    ...overrides,
  }

  return {
    deps,
    watchSource,
    session1,
    session2,
    sessions,
    storage,
    releaseLock,
    lockHandle,
  }
}

// ─── 테스트 스위트 ────────────────────────────────────────────────────────────

describe('buildShutdownSequence (Sub-AC 8a)', () => {
  // ── 1. 반환 형태 검증 ────────────────────────────────────────────────────────

  describe('반환 배열 구조', () => {
    it('항상 정확히 4개의 ShutdownStep을 반환한다', () => {
      const { deps } = makeDeps()
      const steps = buildShutdownSequence(deps)
      expect(steps).toHaveLength(4)
    })

    it('각 step은 name(string)과 run(function) 속성을 갖는다', () => {
      const { deps } = makeDeps()
      const steps = buildShutdownSequence(deps)
      for (const step of steps) {
        expect(typeof step.name).toBe('string')
        expect(step.name.length).toBeGreaterThan(0)
        expect(typeof step.run).toBe('function')
      }
    })

    it('buildShutdownSequence 호출 자체는 어떤 mock도 호출하지 않는다 (순수 함수)', () => {
      const { deps, watchSource, session1, session2, storage, releaseLock } = makeDeps()
      buildShutdownSequence(deps)

      // 순수 함수: 호출만으로 어떤 I/O도 발생하지 않아야 한다
      expect(watchSource.close).not.toHaveBeenCalled()
      expect(watchSource.start).not.toHaveBeenCalled()
      expect(session1.drainAndClose).not.toHaveBeenCalled()
      expect(session2.drainAndClose).not.toHaveBeenCalled()
      expect(storage.close).not.toHaveBeenCalled()
      expect(releaseLock).not.toHaveBeenCalled()
    })
  })

  // ── 2. 단계 이름 및 순서 ─────────────────────────────────────────────────────

  describe('단계 이름 및 순서', () => {
    it('첫 번째 단계 이름은 watchSource.close를 포함한다', () => {
      const { deps } = makeDeps()
      const steps = buildShutdownSequence(deps)
      expect(steps[0]!.name).toMatch(/watchSource\.close/i)
    })

    it('두 번째 단계 이름은 sessions drain을 포함한다', () => {
      const { deps } = makeDeps()
      const steps = buildShutdownSequence(deps)
      expect(steps[1]!.name).toMatch(/session|drain/i)
    })

    it('세 번째 단계 이름은 storage.close를 포함한다', () => {
      const { deps } = makeDeps()
      const steps = buildShutdownSequence(deps)
      expect(steps[2]!.name).toMatch(/storage\.close/i)
    })

    it('네 번째 단계 이름은 releaseLock을 포함한다', () => {
      const { deps } = makeDeps()
      const steps = buildShutdownSequence(deps)
      expect(steps[3]!.name).toMatch(/releaseLock|lock/i)
    })

    it('단계 이름 배열이 정확히 순서대로 나열된다', () => {
      const { deps } = makeDeps()
      const steps = buildShutdownSequence(deps)
      const names = steps.map((s) => s.name)
      expect(names[0]).toBe('watchSource.close')
      expect(names[1]).toBe('sessions.drainAndClose')
      expect(names[2]).toBe('storage.close')
      expect(names[3]).toBe('releaseLock')
    })
  })

  // ── 3. 각 단계 run() 동작 검증 ─────────────────────────────────────────────

  describe('단계별 run() 동작', () => {
    it('[step 0] run()이 watchSource.close()를 호출한다', async () => {
      const { deps, watchSource } = makeDeps()
      const steps = buildShutdownSequence(deps)

      await steps[0]!.run()

      expect(watchSource.close).toHaveBeenCalledTimes(1)
    })

    it('[step 0] run() 호출 시 sessions·storage·releaseLock은 호출되지 않는다', async () => {
      const { deps, session1, session2, storage, releaseLock } = makeDeps()
      const steps = buildShutdownSequence(deps)

      await steps[0]!.run()

      expect(session1.drainAndClose).not.toHaveBeenCalled()
      expect(session2.drainAndClose).not.toHaveBeenCalled()
      expect(storage.close).not.toHaveBeenCalled()
      expect(releaseLock).not.toHaveBeenCalled()
    })

    it('[step 1] run()이 모든 세션의 drainAndClose()를 호출한다', async () => {
      const { deps, session1, session2 } = makeDeps()
      const steps = buildShutdownSequence(deps)

      await steps[1]!.run()

      expect(session1.drainAndClose).toHaveBeenCalledTimes(1)
      expect(session2.drainAndClose).toHaveBeenCalledTimes(1)
    })

    it('[step 1] run() 호출 시 watchSource·storage·releaseLock은 호출되지 않는다', async () => {
      const { deps, watchSource, storage, releaseLock } = makeDeps()
      const steps = buildShutdownSequence(deps)

      await steps[1]!.run()

      expect(watchSource.close).not.toHaveBeenCalled()
      expect(storage.close).not.toHaveBeenCalled()
      expect(releaseLock).not.toHaveBeenCalled()
    })

    it('[step 1] 세션이 없을 때도 run()이 정상 완료된다', async () => {
      const { deps } = makeDeps()
      const emptySessions = new Map<string, DrainableSession>()
      const depsEmpty: ShutdownDeps = { ...deps, sessions: emptySessions }
      const steps = buildShutdownSequence(depsEmpty)

      await expect(steps[1]!.run()).resolves.toBeUndefined()
    })

    it('[step 2] run()이 storage.close()를 호출한다', async () => {
      const { deps, storage } = makeDeps()
      const steps = buildShutdownSequence(deps)

      await steps[2]!.run()

      expect(storage.close).toHaveBeenCalledTimes(1)
    })

    it('[step 2] run() 호출 시 watchSource·sessions·releaseLock은 호출되지 않는다', async () => {
      const { deps, watchSource, session1, session2, releaseLock } = makeDeps()
      const steps = buildShutdownSequence(deps)

      await steps[2]!.run()

      expect(watchSource.close).not.toHaveBeenCalled()
      expect(session1.drainAndClose).not.toHaveBeenCalled()
      expect(session2.drainAndClose).not.toHaveBeenCalled()
      expect(releaseLock).not.toHaveBeenCalled()
    })

    it('[step 3] run()이 releaseLock()을 올바른 lockHandle로 호출한다', async () => {
      const { deps, releaseLock, lockHandle } = makeDeps()
      const steps = buildShutdownSequence(deps)

      await steps[3]!.run()

      expect(releaseLock).toHaveBeenCalledTimes(1)
      expect(releaseLock).toHaveBeenCalledWith(lockHandle)
    })

    it('[step 3] run() 호출 시 watchSource·sessions·storage는 호출되지 않는다', async () => {
      const { deps, watchSource, session1, session2, storage } = makeDeps()
      const steps = buildShutdownSequence(deps)

      await steps[3]!.run()

      expect(watchSource.close).not.toHaveBeenCalled()
      expect(session1.drainAndClose).not.toHaveBeenCalled()
      expect(session2.drainAndClose).not.toHaveBeenCalled()
      expect(storage.close).not.toHaveBeenCalled()
    })
  })

  // ── 4. 순서 보장 (직렬 실행) ─────────────────────────────────────────────────

  describe('전체 순서 보장', () => {
    it('steps를 순서대로 실행하면 4개 의존성이 정확한 순서로 호출된다', async () => {
      const callOrder: string[] = []

      const watchSource: WatchSource = {
        start: jest.fn<(callbacks: WatchCallbacks) => Promise<void>>().mockResolvedValue(undefined),
        close: jest.fn<() => Promise<void>>().mockImplementation(async () => {
          callOrder.push('watchSource.close')
        }),
      }

      const session: DrainableSession = {
        drainAndClose: jest.fn<() => Promise<void>>().mockImplementation(async () => {
          callOrder.push('session.drainAndClose')
        }),
      }

      const sessions = new Map<string, DrainableSession>([['sid-1', session]])

      const storage: CloseableStorage = {
        close: jest.fn<() => Promise<void>>().mockImplementation(async () => {
          callOrder.push('storage.close')
        }),
      }

      const lockHandle = makeLockHandle()
      const releaseLock = jest.fn<(handle: LockHandle) => void>().mockImplementation((handle) => {
        callOrder.push(`releaseLock:${handle.lockPath}`)
      })

      const deps: ShutdownDeps = {
        watchSource,
        sessions,
        storage,
        lockHandle,
        releaseLock,
      }
      const steps = buildShutdownSequence(deps)

      // 직렬 실행
      for (const step of steps) {
        await step.run()
      }

      expect(callOrder).toEqual([
        'watchSource.close',
        'session.drainAndClose',
        'storage.close',
        `releaseLock:${lockHandle.lockPath}`,
      ])
    })

    it('runShutdown()으로 실행해도 동일한 순서가 보장된다', async () => {
      const callOrder: string[] = []

      const watchSource: WatchSource = {
        start: jest.fn<(callbacks: WatchCallbacks) => Promise<void>>().mockResolvedValue(undefined),
        close: jest.fn<() => Promise<void>>().mockImplementation(async () => {
          callOrder.push('watchSource.close')
        }),
      }
      const session: DrainableSession = {
        drainAndClose: jest.fn<() => Promise<void>>().mockImplementation(async () => {
          callOrder.push('session.drainAndClose')
        }),
      }
      const sessions = new Map<string, DrainableSession>([['sid-1', session]])
      const storage: CloseableStorage = {
        close: jest.fn<() => Promise<void>>().mockImplementation(async () => {
          callOrder.push('storage.close')
        }),
      }
      const lockHandle = makeLockHandle()
      const releaseLock = jest.fn<(handle: LockHandle) => void>().mockImplementation(() => {
        callOrder.push('releaseLock')
      })

      const deps: ShutdownDeps = { watchSource, sessions, storage, lockHandle, releaseLock }
      const steps = buildShutdownSequence(deps)
      const errors = await runShutdown(steps)

      expect(errors).toHaveLength(0)
      expect(callOrder).toEqual([
        'watchSource.close',
        'session.drainAndClose',
        'storage.close',
        'releaseLock',
      ])
    })
  })

  // ── 5. 복수 세션 처리 ────────────────────────────────────────────────────────

  describe('복수 세션 처리', () => {
    it('3개 세션이 있을 때 세션 drain 단계에서 모두 drainAndClose()가 호출된다', async () => {
      const sessions = new Map<string, DrainableSession>()
      const mocks: Array<DrainableSession & { drainAndClose: ReturnType<typeof jest.fn> }> = []

      for (let i = 0; i < 3; i++) {
        const m = makeMockSession()
        sessions.set(`session-${i}`, m)
        mocks.push(m)
      }

      const { deps } = makeDeps()
      const depsWithSessions: ShutdownDeps = { ...deps, sessions }
      const steps = buildShutdownSequence(depsWithSessions)

      await steps[1]!.run()

      for (const m of mocks) {
        expect(m.drainAndClose).toHaveBeenCalledTimes(1)
      }
    })
  })

  // ── 6. 불변성 — 입력 변경 없음 ──────────────────────────────────────────────

  describe('불변성', () => {
    it('buildShutdownSequence가 sessions Map을 변경하지 않는다', () => {
      const { deps } = makeDeps()
      const originalSize = deps.sessions.size

      buildShutdownSequence(deps)

      expect(deps.sessions.size).toBe(originalSize)
    })

    it('동일 deps로 buildShutdownSequence를 2번 호출하면 독립적인 배열이 반환된다', () => {
      const { deps } = makeDeps()
      const steps1 = buildShutdownSequence(deps)
      const steps2 = buildShutdownSequence(deps)

      expect(steps1).not.toBe(steps2)
      expect(steps1).toHaveLength(4)
      expect(steps2).toHaveLength(4)
    })
  })

  // ── 7. runShutdown — 단계 실패 격리 ─────────────────────────────────────────

  describe('runShutdown — 단계 실패 격리', () => {
    it('한 단계가 throw해도 나머지 단계가 계속 실행된다', async () => {
      const callOrder: string[] = []

      const failingStep: ShutdownStep = {
        name: 'fail-step',
        run: async () => {
          callOrder.push('fail')
          throw new Error('intentional error')
        },
      }
      const succeedStep: ShutdownStep = {
        name: 'succeed-step',
        run: async () => {
          callOrder.push('succeed')
        },
      }

      const errors = await runShutdown([failingStep, succeedStep])

      // 실패 단계 이후에도 succeed 단계가 실행됨
      expect(callOrder).toEqual(['fail', 'succeed'])
      // 오류가 수집됨
      expect(errors).toHaveLength(1)
      expect(errors[0]!.message).toBe('intentional error')
    })

    it('모든 단계가 성공하면 빈 에러 배열을 반환한다', async () => {
      const { deps } = makeDeps()
      const steps = buildShutdownSequence(deps)
      const errors = await runShutdown(steps)

      expect(errors).toHaveLength(0)
    })

    it('여러 단계가 실패하면 모든 오류가 수집된다', async () => {
      const failSteps: ShutdownStep[] = [
        { name: 'fail-1', run: async () => { throw new Error('error-1') } },
        { name: 'fail-2', run: async () => { throw new Error('error-2') } },
        { name: 'ok', run: async () => { /* no-op */ } },
      ]

      const errors = await runShutdown(failSteps)

      expect(errors).toHaveLength(2)
      expect(errors.map((e) => e.message)).toEqual(['error-1', 'error-2'])
    })
  })

  // ── 8. LockHandle DI 검증 ────────────────────────────────────────────────────

  describe('LockHandle DI 주입', () => {
    it('다른 lockPath/pid를 가진 LockHandle이 releaseLock에 정확히 전달된다', async () => {
      const customHandle: LockHandle = { lockPath: '/custom/path/daemon.lock', pid: 99999 }
      const releaseLock = jest.fn<(handle: LockHandle) => void>()

      const { deps } = makeDeps({
        lockHandle: customHandle,
        releaseLock: releaseLock as (handle: LockHandle) => void,
      })
      const steps = buildShutdownSequence(deps)

      await steps[3]!.run()

      expect(releaseLock).toHaveBeenCalledWith(customHandle)
    })
  })
})
