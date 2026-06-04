/**
 * chokidar-watch-source-sub-ac-2d.test.ts
 *
 * Sub-AC 2d: ChokidarWatchSource의 chokidar 'unlink' 이벤트 어댑터 검증
 *
 * 검증 항목:
 *  - chokidar 'unlink' 파일 이벤트가 등록된 onSessionRemove 콜백으로 매핑된다.
 *  - 콜백은 정확히 1번 호출된다.
 *  - 콜백에 전달되는 절대 경로(filePath)가 실제 삭제된 파일 경로와 정확히 일치한다.
 *  - sessionId는 파일 경로에서 올바르게 도출된다(확장자 제거).
 *
 * 테스트 전략:
 *  - 실제 임시 디렉터리를 생성하고, 그 경로를 watchDir로 사용한다.
 *  - chokidar를 직접 사용하지 않고 생성자 DI(_manager 파라미터)로
 *    FakeWatchManager를 주입한다 (부수효과 0, 결정론적 동작).
 *  - FakeWatchManager의 fakeWatcher에서 'unlink' 이벤트를 수동으로 emit해
 *    실제 파일이 임시 디렉터리에서 삭제된 것처럼 시뮬레이션한다.
 *  - 핵심 케이스: 실제 파일을 tmpdir에 생성→삭제한 뒤 해당 경로로 'unlink'
 *    이벤트를 emit하고 콜백이 정확히 1번 호출되는지 검증한다.
 *
 * CONSTRAINT:
 *  - chokidar·실제 fs 이벤트 감시·네트워크를 사용하지 않는다.
 *  - 실제 ~/.claude, 실제 OS 알림, 실제 API 키를 요구하지 않는다.
 *  - jest.mock 대신 생성자 DI로 가짜 구현을 주입한다.
 */

import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import {
  ChokidarWatchSource,
  type IWatchManager,
} from '../src/watch/chokidar-watch-source.js'
import type { WatchCallbacks } from '../src/watch/watch-source.js'

// ---------------------------------------------------------------------------
// FakeWatcher — chokidar FSWatcher의 최소 인메모리 구현체
// ---------------------------------------------------------------------------

interface FakeWatcher {
  listeners: Record<string, Array<(filePath: string) => void>>
  on(event: string, listener: (filePath: string) => void): FakeWatcher
  emit(event: string, filePath: string): void
}

function makeFakeWatcher(): FakeWatcher {
  const listeners: Record<string, Array<(filePath: string) => void>> = {}
  return {
    listeners,
    on(event: string, listener: (filePath: string) => void) {
      listeners[event] = listeners[event] ?? []
      listeners[event]!.push(listener)
      return this
    },
    emit(event: string, filePath: string) {
      for (const fn of listeners[event] ?? []) fn(filePath)
    },
  }
}

// ---------------------------------------------------------------------------
// FakeWatchManager — IWatchManager의 인메모리 구현체
// ---------------------------------------------------------------------------

type FakeManager = IWatchManager & {
  readonly fakeWatcher: FakeWatcher
  readonly startCalled: boolean
  readonly stopCalled: boolean
}

function makeFakeManager(): FakeManager {
  const fakeWatcher = makeFakeWatcher()
  let startCalled = false
  let stopCalled = false

  return {
    fakeWatcher,
    get startCalled() { return startCalled },
    get stopCalled() { return stopCalled },
    async start(_patterns: readonly string[]): Promise<void> {
      startCalled = true
    },
    async stop(): Promise<void> {
      stopCalled = true
    },
    get handle() {
      return startCalled ? { watcher: fakeWatcher } : null
    },
  }
}

// ---------------------------------------------------------------------------
// Sub-AC 2d: 'unlink' 이벤트 → onSessionRemove 어댑터 검증
// ---------------------------------------------------------------------------

describe('ChokidarWatchSource — Sub-AC 2d: unlink 이벤트 어댑터', () => {
  let tmpDir: string

  beforeEach(() => {
    // 실제 임시 디렉터리를 생성해 절대 경로 검증에 사용한다
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopbreaker-sub-ac-2d-'))
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('onSessionRemove 콜백을 등록하고, unlink 이벤트 발생 시 정확히 1번 호출된다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)

    const onSessionRemove = jest.fn<(sessionId: string, filePath: string) => void>()
    const callbacks: WatchCallbacks = {
      onSessionAppear: jest.fn(),
      onSessionChange: jest.fn(),
      onSessionRemove,
    }

    await src.start(callbacks)

    // 임시 디렉터리 안의 파일 경로를 시뮬레이션한다
    const sessionFile = path.join(tmpDir, 'session-abc123.jsonl')

    // chokidar 'unlink' 이벤트를 수동으로 emit — 실제 파일 삭제 없이 경로만 사용
    mgr.fakeWatcher.emit('unlink', sessionFile)

    // 콜백이 정확히 1번 호출돼야 한다
    expect(onSessionRemove).toHaveBeenCalledTimes(1)
  })

  it('unlink 이벤트 시 콜백에 전달되는 filePath가 절대 경로와 정확히 일치한다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)

    const receivedPaths: string[] = []
    const callbacks: WatchCallbacks = {
      onSessionAppear: jest.fn(),
      onSessionChange: jest.fn(),
      onSessionRemove: (_sid, fp) => { receivedPaths.push(fp) },
    }

    await src.start(callbacks)

    const sessionFile = path.join(tmpDir, 'abc123.jsonl')
    mgr.fakeWatcher.emit('unlink', sessionFile)

    expect(receivedPaths).toHaveLength(1)
    // 절대 경로가 정확히 일치해야 한다
    expect(receivedPaths[0]).toBe(sessionFile)
    // 실제 os.tmpdir() 하위의 경로인지 확인
    expect(receivedPaths[0]).toContain(os.tmpdir())
  })

  it('unlink 이벤트 시 sessionId가 파일명에서 확장자를 제거한 값으로 올바르게 도출된다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)

    const receivedArgs: Array<[string, string]> = []
    const callbacks: WatchCallbacks = {
      onSessionAppear: jest.fn(),
      onSessionChange: jest.fn(),
      onSessionRemove: (sid, fp) => { receivedArgs.push([sid, fp]) },
    }

    await src.start(callbacks)

    const sessionFile = path.join(tmpDir, 'my-session-id.jsonl')
    mgr.fakeWatcher.emit('unlink', sessionFile)

    expect(receivedArgs).toHaveLength(1)
    const [sessionId, filePath] = receivedArgs[0]!
    // sessionId는 파일명에서 .jsonl 확장자를 제거한 값이어야 한다
    expect(sessionId).toBe('my-session-id')
    // filePath는 전달된 절대 경로 그대로여야 한다
    expect(filePath).toBe(sessionFile)
  })

  it('임시 디렉터리에 실제 파일을 생성하고 삭제한 뒤 해당 경로로 unlink 이벤트를 emit하면 콜백이 정확히 1번 정확한 절대 경로로 호출된다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)

    const onSessionRemove = jest.fn<(sessionId: string, filePath: string) => void>()
    const callbacks: WatchCallbacks = {
      onSessionAppear: jest.fn(),
      onSessionChange: jest.fn(),
      onSessionRemove,
    }

    await src.start(callbacks)

    // 실제 파일을 임시 디렉터리에 생성한다
    const sessionFile = path.join(tmpDir, 'deleted-session.jsonl')
    fs.writeFileSync(sessionFile, '{"type":"test"}\n', 'utf8')
    expect(fs.existsSync(sessionFile)).toBe(true)

    // 실제로 파일을 삭제한다
    fs.unlinkSync(sessionFile)
    expect(fs.existsSync(sessionFile)).toBe(false)

    // 삭제된 파일 경로로 'unlink' 이벤트를 emit한다
    mgr.fakeWatcher.emit('unlink', sessionFile)

    // 콜백이 정확히 1번, 정확한 절대 경로로 호출돼야 한다
    expect(onSessionRemove).toHaveBeenCalledTimes(1)
    expect(onSessionRemove).toHaveBeenCalledWith('deleted-session', sessionFile)
  })

  it('여러 .jsonl 파일에 대한 unlink 이벤트는 각각 별도의 콜백 호출을 생성한다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)

    const removed: Array<[string, string]> = []
    const callbacks: WatchCallbacks = {
      onSessionAppear: jest.fn(),
      onSessionChange: jest.fn(),
      onSessionRemove: (sid, fp) => { removed.push([sid, fp]) },
    }

    await src.start(callbacks)

    const file1 = path.join(tmpDir, 'session-alpha.jsonl')
    const file2 = path.join(tmpDir, 'session-beta.jsonl')

    mgr.fakeWatcher.emit('unlink', file1)
    mgr.fakeWatcher.emit('unlink', file2)

    expect(removed).toHaveLength(2)
    expect(removed[0]).toEqual(['session-alpha', file1])
    expect(removed[1]).toEqual(['session-beta', file2])
  })

  it('.jsonl이 아닌 파일에 대한 unlink 이벤트는 onSessionRemove를 호출하지 않는다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)

    const onSessionRemove = jest.fn<(sessionId: string, filePath: string) => void>()
    const callbacks: WatchCallbacks = {
      onSessionAppear: jest.fn(),
      onSessionChange: jest.fn(),
      onSessionRemove,
    }

    await src.start(callbacks)

    // .jsonl이 아닌 파일 경로들에 대한 unlink 이벤트
    mgr.fakeWatcher.emit('unlink', path.join(tmpDir, 'config.json'))
    mgr.fakeWatcher.emit('unlink', path.join(tmpDir, 'log.txt'))
    mgr.fakeWatcher.emit('unlink', path.join(tmpDir, 'noextension'))

    // onSessionRemove는 절대 호출되면 안 된다
    expect(onSessionRemove).not.toHaveBeenCalled()
  })

  it('close() 호출 후 unlink 이벤트가 발생해도 onSessionRemove가 호출되지 않는다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)

    const onSessionRemove = jest.fn<(sessionId: string, filePath: string) => void>()
    const callbacks: WatchCallbacks = {
      onSessionAppear: jest.fn(),
      onSessionChange: jest.fn(),
      onSessionRemove,
    }

    await src.start(callbacks)

    // close 전: 정상 작동 확인
    mgr.fakeWatcher.emit('unlink', path.join(tmpDir, 'before-close.jsonl'))
    expect(onSessionRemove).toHaveBeenCalledTimes(1)

    // close 후에는 콜백이 호출되면 안 된다
    await src.close()
    mgr.fakeWatcher.emit('unlink', path.join(tmpDir, 'after-close.jsonl'))
    expect(onSessionRemove).toHaveBeenCalledTimes(1) // 여전히 1번만
  })

  it('unlink 이벤트는 onSessionAppear 또는 onSessionChange를 호출하지 않는다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)

    const onSessionAppear = jest.fn<(sessionId: string, filePath: string) => void>()
    const onSessionChange = jest.fn<(sessionId: string, filePath: string) => void>()
    const callbacks: WatchCallbacks = {
      onSessionAppear,
      onSessionChange,
      onSessionRemove: jest.fn(),
    }

    await src.start(callbacks)

    mgr.fakeWatcher.emit('unlink', path.join(tmpDir, 'session.jsonl'))

    // unlink 이벤트는 appear/change 콜백을 발화하면 안 된다
    expect(onSessionAppear).not.toHaveBeenCalled()
    expect(onSessionChange).not.toHaveBeenCalled()
  })
})
