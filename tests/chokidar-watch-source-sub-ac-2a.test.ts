/**
 * chokidar-watch-source-sub-ac-2a.test.ts
 *
 * Sub-AC 2a: ChokidarWatchSource 클래스 스켈레톤 검증
 *
 * 검증 항목:
 *  1. 임시 디렉터리로 ChokidarWatchSource를 인스턴스화할 수 있다 (에러 없음)
 *  2. start(callbacks), close() 메서드가 존재한다
 *  3. 세 가지 콜백(onSessionAppear/onSessionChange/onSessionRemove) 등록 인터페이스가 동작한다
 *  4. close() 후 isStarted가 false가 된다
 *
 * CONSTRAINT:
 *  - chokidar·실제 fs 이벤트·네트워크를 사용하지 않는다.
 *  - jest.mock 대신 생성자 DI(_manager 파라미터)로 가짜 WatchManager를 주입한다.
 */

import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { ChokidarWatchSource, deriveSessionId, type IWatchManager } from '../src/watch/chokidar-watch-source.js'
import type { WatchCallbacks } from '../src/watch/watch-source.js'

// ---------------------------------------------------------------------------
// 가짜 WatchManager — chokidar를 전혀 사용하지 않는 인메모리 구현
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

function makeFakeManager(): IWatchManager & { fakeWatcher: FakeWatcher; startCalled: boolean; stopCalled: boolean } {
  const fakeWatcher = makeFakeWatcher()
  let startCalled = false
  let stopCalled = false

  const mgr = {
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
  return mgr
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

describe('ChokidarWatchSource (Sub-AC 2a)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopbreaker-test-watch-'))
  })

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('임시 디렉터리로 에러 없이 인스턴스화된다', () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)
    expect(src).toBeDefined()
    expect(src).toBeInstanceOf(ChokidarWatchSource)
  })

  it('start() 메서드가 존재한다', () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)
    expect(typeof src.start).toBe('function')
  })

  it('close() 메서드가 존재한다', () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)
    expect(typeof src.close).toBe('function')
  })

  it('start(callbacks) 호출 시 에러 없이 완료된다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)
    const callbacks: WatchCallbacks = {
      onSessionAppear: () => { /* noop */ },
      onSessionChange: () => { /* noop */ },
      onSessionRemove: () => { /* noop */ },
    }
    await expect(src.start(callbacks)).resolves.toBeUndefined()
  })

  it('start() 후 isStarted가 true이다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)
    const callbacks: WatchCallbacks = {
      onSessionAppear: () => { /* noop */ },
      onSessionChange: () => { /* noop */ },
      onSessionRemove: () => { /* noop */ },
    }
    await src.start(callbacks)
    expect(src.isStarted).toBe(true)
  })

  it('close() 후 isStarted가 false이다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)
    const callbacks: WatchCallbacks = {
      onSessionAppear: () => { /* noop */ },
      onSessionChange: () => { /* noop */ },
      onSessionRemove: () => { /* noop */ },
    }
    await src.start(callbacks)
    await src.close()
    expect(src.isStarted).toBe(false)
  })

  it('옵션 없이도 인스턴스화된다 (DI 없이 기본 WatchManager 사용 경로 검증)', () => {
    // 실제 WatchManager를 생성하지만 start()를 호출하지 않으므로 chokidar가 시작되지 않는다
    expect(() => new ChokidarWatchSource(tmpDir)).not.toThrow()
  })

  it('추가 옵션과 함께 인스턴스화된다', () => {
    const mgr = makeFakeManager()
    expect(() => new ChokidarWatchSource(tmpDir, { pollIntervalMs: 500, ignoreInitial: true }, mgr)).not.toThrow()
  })

  it('start() 후 watcher.on이 등록된다 (add/change/unlink)', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)
    const callbacks: WatchCallbacks = {
      onSessionAppear: () => { /* noop */ },
      onSessionChange: () => { /* noop */ },
      onSessionRemove: () => { /* noop */ },
    }
    await src.start(callbacks)
    expect(Object.keys(mgr.fakeWatcher.listeners)).toEqual(expect.arrayContaining(['add', 'change', 'unlink']))
  })

  it('add 이벤트 → onSessionAppear 콜백이 호출된다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)
    const appeared: Array<[string, string]> = []
    const callbacks: WatchCallbacks = {
      onSessionAppear: (sid, fp) => { appeared.push([sid, fp]) },
      onSessionChange: () => { /* noop */ },
      onSessionRemove: () => { /* noop */ },
    }
    await src.start(callbacks)
    mgr.fakeWatcher.emit('add', '/tmp/abc123.jsonl')
    expect(appeared).toEqual([['abc123', '/tmp/abc123.jsonl']])
  })

  it('change 이벤트 → onSessionChange 콜백이 호출된다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)
    const changed: Array<[string, string]> = []
    const callbacks: WatchCallbacks = {
      onSessionAppear: () => { /* noop */ },
      onSessionChange: (sid, fp) => { changed.push([sid, fp]) },
      onSessionRemove: () => { /* noop */ },
    }
    await src.start(callbacks)
    mgr.fakeWatcher.emit('change', '/tmp/session-xyz.jsonl')
    expect(changed).toEqual([['session-xyz', '/tmp/session-xyz.jsonl']])
  })

  it('unlink 이벤트 → onSessionRemove 콜백이 호출된다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)
    const removed: Array<[string, string]> = []
    const callbacks: WatchCallbacks = {
      onSessionAppear: () => { /* noop */ },
      onSessionChange: () => { /* noop */ },
      onSessionRemove: (sid, fp) => { removed.push([sid, fp]) },
    }
    await src.start(callbacks)
    mgr.fakeWatcher.emit('unlink', '/tmp/gone.jsonl')
    expect(removed).toEqual([['gone', '/tmp/gone.jsonl']])
  })

  it('.jsonl이 아닌 파일 이벤트는 콜백을 발화하지 않는다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)
    const appeared: string[] = []
    const callbacks: WatchCallbacks = {
      onSessionAppear: (sid) => { appeared.push(sid) },
      onSessionChange: () => { /* noop */ },
      onSessionRemove: () => { /* noop */ },
    }
    await src.start(callbacks)
    mgr.fakeWatcher.emit('add', '/tmp/notajsonl.txt')
    mgr.fakeWatcher.emit('add', '/tmp/noextension')
    expect(appeared).toHaveLength(0)
  })

  it('close() 후 이벤트가 발화돼도 콜백이 호출되지 않는다', async () => {
    const mgr = makeFakeManager()
    const src = new ChokidarWatchSource(tmpDir, {}, mgr)
    const appeared: string[] = []
    const callbacks: WatchCallbacks = {
      onSessionAppear: (sid) => { appeared.push(sid) },
      onSessionChange: () => { /* noop */ },
      onSessionRemove: () => { /* noop */ },
    }
    await src.start(callbacks)
    await src.close()
    // close 후 이벤트 발화 — 콜백이 null이므로 무시됨
    mgr.fakeWatcher.emit('add', '/tmp/late.jsonl')
    expect(appeared).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// deriveSessionId 유틸리티
// ---------------------------------------------------------------------------

describe('deriveSessionId', () => {
  it('.jsonl 파일에서 sessionId를 도출한다', () => {
    expect(deriveSessionId('/path/to/abc123.jsonl')).toBe('abc123')
  })

  it('복잡한 이름의 .jsonl 파일에서 sessionId를 도출한다', () => {
    expect(deriveSessionId('/home/user/.claude/projects/session-xyz.jsonl')).toBe('session-xyz')
  })

  it('확장자가 없는 파일명은 그대로 반환한다', () => {
    expect(deriveSessionId('/path/to/sessionfile')).toBe('sessionfile')
  })

  it('여러 점이 포함된 파일명에서 마지막 확장자만 제거한다', () => {
    expect(deriveSessionId('/path/to/session.v2.jsonl')).toBe('session.v2')
  })
})
