/**
 * tests/watch-source-sub-ac-1.test.ts
 *
 * Sub-AC 1: WatchSource 인터페이스 검증
 *  - zero chokidar imports (패키지 레벨)
 *  - TypeScript 인터페이스가 컴파일되고 구조적 타입 체크 통과
 *  - MockWatchSource가 WatchSource를 만족하는지 검증
 *  - 콜백이 올바르게 트리거되는지 검증
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import {
  MockWatchSource,
  type WatchCallbacks,
  type WatchSource,
} from '../src/watch/watch-source.js'

const WATCH_SOURCE_PATH = resolve(
  new URL('..', import.meta.url).pathname,
  'src/watch/watch-source.ts',
)

describe('WatchSource interface — Sub-AC 1', () => {
  describe('zero chokidar import constraint', () => {
    it('src/watch/watch-source.ts contains no chokidar import', () => {
      const src = readFileSync(WATCH_SOURCE_PATH, 'utf8')
      // No import of 'chokidar' anywhere in the file
      expect(src).not.toMatch(/from ['"]chokidar['"]/)
      expect(src).not.toMatch(/require\(['"]chokidar['"]\)/)
      expect(src).not.toMatch(/import ['"]chokidar['"]/)
    })
  })

  describe('TypeScript structural type check', () => {
    it('MockWatchSource satisfies WatchSource interface', () => {
      // Structural assignability check at runtime — if this compiles and runs,
      // TypeScript accepted the assignment.
      const mock = new MockWatchSource()
      // Assign to WatchSource typed variable — TypeScript enforces the contract.
      const source: WatchSource = mock
      expect(source).toBeDefined()
      expect(typeof source.start).toBe('function')
      expect(typeof source.close).toBe('function')
    })

    it('WatchCallbacks type has all three callback properties', () => {
      const noop = () => {}
      // Structural check: if TypeScript accepted this object as WatchCallbacks, it's valid.
      const callbacks: WatchCallbacks = {
        onSessionAppear: noop,
        onSessionChange: noop,
        onSessionRemove: noop,
      }
      expect(typeof callbacks.onSessionAppear).toBe('function')
      expect(typeof callbacks.onSessionChange).toBe('function')
      expect(typeof callbacks.onSessionRemove).toBe('function')
    })
  })

  describe('MockWatchSource lifecycle', () => {
    it('starts in unstarted state', () => {
      const mock = new MockWatchSource()
      expect(mock.started).toBe(false)
      expect(mock.closed).toBe(false)
      expect(mock.callbacks).toBeNull()
    })

    it('start() registers callbacks and sets started=true', async () => {
      const mock = new MockWatchSource()
      const callbacks: WatchCallbacks = {
        onSessionAppear: jest.fn(),
        onSessionChange: jest.fn(),
        onSessionRemove: jest.fn(),
      }
      await mock.start(callbacks)
      expect(mock.started).toBe(true)
      expect(mock.closed).toBe(false)
      expect(mock.callbacks).toBe(callbacks)
    })

    it('close() clears callbacks and sets closed=true', async () => {
      const mock = new MockWatchSource()
      const callbacks: WatchCallbacks = {
        onSessionAppear: jest.fn(),
        onSessionChange: jest.fn(),
        onSessionRemove: jest.fn(),
      }
      await mock.start(callbacks)
      await mock.close()
      expect(mock.closed).toBe(true)
      expect(mock.callbacks).toBeNull()
    })
  })

  describe('MockWatchSource manual triggers', () => {
    let mock: MockWatchSource
    let onSessionAppear: jest.Mock
    let onSessionChange: jest.Mock
    let onSessionRemove: jest.Mock

    beforeEach(async () => {
      mock = new MockWatchSource()
      onSessionAppear = jest.fn()
      onSessionChange = jest.fn()
      onSessionRemove = jest.fn()
      await mock.start({ onSessionAppear, onSessionChange, onSessionRemove })
    })

    it('triggerAppear() calls onSessionAppear with correct args', () => {
      mock.triggerAppear('sid-1', '/tmp/session.jsonl')
      expect(onSessionAppear).toHaveBeenCalledTimes(1)
      expect(onSessionAppear).toHaveBeenCalledWith('sid-1', '/tmp/session.jsonl')
    })

    it('triggerChange() calls onSessionChange with correct args', () => {
      mock.triggerChange('sid-2', '/tmp/session.jsonl')
      expect(onSessionChange).toHaveBeenCalledTimes(1)
      expect(onSessionChange).toHaveBeenCalledWith('sid-2', '/tmp/session.jsonl')
    })

    it('triggerRemove() calls onSessionRemove with correct args', () => {
      mock.triggerRemove('sid-3', '/tmp/session.jsonl')
      expect(onSessionRemove).toHaveBeenCalledTimes(1)
      expect(onSessionRemove).toHaveBeenCalledWith('sid-3', '/tmp/session.jsonl')
    })

    it('no callbacks fire after close()', async () => {
      await mock.close()
      mock.triggerAppear('sid-1', '/tmp/session.jsonl')
      mock.triggerChange('sid-1', '/tmp/session.jsonl')
      mock.triggerRemove('sid-1', '/tmp/session.jsonl')
      expect(onSessionAppear).not.toHaveBeenCalled()
      expect(onSessionChange).not.toHaveBeenCalled()
      expect(onSessionRemove).not.toHaveBeenCalled()
    })

    it('multiple triggers fire callbacks multiple times', () => {
      mock.triggerAppear('sid-1', '/tmp/a.jsonl')
      mock.triggerAppear('sid-2', '/tmp/b.jsonl')
      mock.triggerChange('sid-1', '/tmp/a.jsonl')
      expect(onSessionAppear).toHaveBeenCalledTimes(2)
      expect(onSessionChange).toHaveBeenCalledTimes(1)
    })
  })
})
