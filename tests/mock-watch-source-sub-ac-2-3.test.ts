/**
 * tests/mock-watch-source-sub-ac-2-3.test.ts
 *
 * Sub-AC 2.3: MockWatchSource (InMemoryWatchSource) 검증
 *
 * 검증 항목:
 *  1. src/watch/mock-watch-source.ts 에 chokidar import가 없음
 *  2. WatchSource 인터페이스를 만족함 (구조적 타입 체크)
 *  3. 세 콜백을 등록하고 각 triggerXxx() 메서드가 올바른 인자로 콜백을 호출함
 *  4. close() 이후 트리거가 콜백을 발화하지 않음
 *  5. 부수효과 없음: chokidar·실제 fs·네트워크 0
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { MockWatchSource } from '../src/watch/mock-watch-source.js'
import type { WatchCallbacks, WatchSource } from '../src/watch/watch-source.js'

const MOCK_SOURCE_PATH = resolve(
  new URL('..', import.meta.url).pathname,
  'src/watch/mock-watch-source.ts',
)

describe('MockWatchSource — Sub-AC 2.3', () => {
  // ── 격리 제약 검증 ────────────────────────────────────────────────────────
  describe('zero chokidar import constraint', () => {
    it('src/watch/mock-watch-source.ts contains no chokidar import', () => {
      const src = readFileSync(MOCK_SOURCE_PATH, 'utf8')
      expect(src).not.toMatch(/from ['"]chokidar['"]/)
      expect(src).not.toMatch(/require\(['"]chokidar['"]\)/)
      expect(src).not.toMatch(/import ['"]chokidar['"]/)
    })
  })

  // ── 구조적 타입 체크 ──────────────────────────────────────────────────────
  describe('WatchSource interface compliance', () => {
    it('MockWatchSource satisfies WatchSource interface', () => {
      const mock = new MockWatchSource()
      // TypeScript structural assignability: 컴파일·실행 모두 통과해야 함
      const source: WatchSource = mock
      expect(source).toBeDefined()
      expect(typeof source.start).toBe('function')
      expect(typeof source.close).toBe('function')
    })

    it('exposes triggerAppear / triggerChange / triggerRemove methods', () => {
      const mock = new MockWatchSource()
      expect(typeof mock.triggerAppear).toBe('function')
      expect(typeof mock.triggerChange).toBe('function')
      expect(typeof mock.triggerRemove).toBe('function')
    })
  })

  // ── 초기 상태 ─────────────────────────────────────────────────────────────
  describe('initial state', () => {
    it('starts unstarted, unclosed, with null callbacks', () => {
      const mock = new MockWatchSource()
      expect(mock.started).toBe(false)
      expect(mock.closed).toBe(false)
      expect(mock.callbacks).toBeNull()
    })
  })

  // ── 콜백 등록 및 트리거 ───────────────────────────────────────────────────
  describe('callback registration and triggering', () => {
    let mock: MockWatchSource
    let onSessionAppear: jest.Mock
    let onSessionChange: jest.Mock
    let onSessionRemove: jest.Mock

    beforeEach(async () => {
      mock = new MockWatchSource()
      onSessionAppear = jest.fn()
      onSessionChange = jest.fn()
      onSessionRemove = jest.fn()

      const callbacks: WatchCallbacks = {
        onSessionAppear,
        onSessionChange,
        onSessionRemove,
      }
      await mock.start(callbacks)
    })

    it('start() registers all three callbacks', () => {
      expect(mock.started).toBe(true)
      expect(mock.closed).toBe(false)
      expect(mock.callbacks).not.toBeNull()
      expect(mock.callbacks?.onSessionAppear).toBe(onSessionAppear)
      expect(mock.callbacks?.onSessionChange).toBe(onSessionChange)
      expect(mock.callbacks?.onSessionRemove).toBe(onSessionRemove)
    })

    it('triggerAppear() invokes onSessionAppear with supplied arguments', () => {
      mock.triggerAppear('sid-appear', '/tmp/appear.jsonl')
      expect(onSessionAppear).toHaveBeenCalledTimes(1)
      expect(onSessionAppear).toHaveBeenCalledWith('sid-appear', '/tmp/appear.jsonl')
      // Other callbacks not invoked
      expect(onSessionChange).not.toHaveBeenCalled()
      expect(onSessionRemove).not.toHaveBeenCalled()
    })

    it('triggerChange() invokes onSessionChange with supplied arguments', () => {
      mock.triggerChange('sid-change', '/tmp/change.jsonl')
      expect(onSessionChange).toHaveBeenCalledTimes(1)
      expect(onSessionChange).toHaveBeenCalledWith('sid-change', '/tmp/change.jsonl')
      // Other callbacks not invoked
      expect(onSessionAppear).not.toHaveBeenCalled()
      expect(onSessionRemove).not.toHaveBeenCalled()
    })

    it('triggerRemove() invokes onSessionRemove with supplied arguments', () => {
      mock.triggerRemove('sid-remove', '/tmp/remove.jsonl')
      expect(onSessionRemove).toHaveBeenCalledTimes(1)
      expect(onSessionRemove).toHaveBeenCalledWith('sid-remove', '/tmp/remove.jsonl')
      // Other callbacks not invoked
      expect(onSessionAppear).not.toHaveBeenCalled()
      expect(onSessionChange).not.toHaveBeenCalled()
    })

    it('multiple triggers accumulate correctly', () => {
      mock.triggerAppear('s1', '/tmp/s1.jsonl')
      mock.triggerAppear('s2', '/tmp/s2.jsonl')
      mock.triggerChange('s1', '/tmp/s1.jsonl')
      mock.triggerRemove('s2', '/tmp/s2.jsonl')

      expect(onSessionAppear).toHaveBeenCalledTimes(2)
      expect(onSessionChange).toHaveBeenCalledTimes(1)
      expect(onSessionRemove).toHaveBeenCalledTimes(1)

      expect(onSessionAppear).toHaveBeenNthCalledWith(1, 's1', '/tmp/s1.jsonl')
      expect(onSessionAppear).toHaveBeenNthCalledWith(2, 's2', '/tmp/s2.jsonl')
      expect(onSessionChange).toHaveBeenCalledWith('s1', '/tmp/s1.jsonl')
      expect(onSessionRemove).toHaveBeenCalledWith('s2', '/tmp/s2.jsonl')
    })
  })

  // ── close() 이후 침묵 보장 ────────────────────────────────────────────────
  describe('after close()', () => {
    it('no callbacks fire after close()', async () => {
      const mock = new MockWatchSource()
      const onSessionAppear = jest.fn()
      const onSessionChange = jest.fn()
      const onSessionRemove = jest.fn()

      await mock.start({ onSessionAppear, onSessionChange, onSessionRemove })
      await mock.close()

      // All triggers should be silent
      mock.triggerAppear('sid', '/tmp/x.jsonl')
      mock.triggerChange('sid', '/tmp/x.jsonl')
      mock.triggerRemove('sid', '/tmp/x.jsonl')

      expect(onSessionAppear).not.toHaveBeenCalled()
      expect(onSessionChange).not.toHaveBeenCalled()
      expect(onSessionRemove).not.toHaveBeenCalled()
    })

    it('close() sets closed=true and clears callbacks', async () => {
      const mock = new MockWatchSource()
      await mock.start({
        onSessionAppear: jest.fn(),
        onSessionChange: jest.fn(),
        onSessionRemove: jest.fn(),
      })
      await mock.close()
      expect(mock.closed).toBe(true)
      expect(mock.callbacks).toBeNull()
    })

    it('triggers before close() fire, triggers after close() do not', async () => {
      const mock = new MockWatchSource()
      const onSessionChange = jest.fn()
      await mock.start({
        onSessionAppear: jest.fn(),
        onSessionChange,
        onSessionRemove: jest.fn(),
      })

      mock.triggerChange('sid', '/tmp/x.jsonl') // fires
      await mock.close()
      mock.triggerChange('sid', '/tmp/x.jsonl') // silent

      expect(onSessionChange).toHaveBeenCalledTimes(1)
    })
  })

  // ── re-export 호환성 ──────────────────────────────────────────────────────
  describe('re-export compatibility from watch-source.ts', () => {
    it('MockWatchSource from watch-source.ts is same class', async () => {
      const { MockWatchSource: ReExported } = await import('../src/watch/watch-source.js')
      const a = new MockWatchSource()
      const b = new ReExported()
      // Both are instances of the same constructor
      expect(a.constructor).toBe(b.constructor)
    })
  })
})
