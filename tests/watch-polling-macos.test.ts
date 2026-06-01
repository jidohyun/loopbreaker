/**
 * watch-polling-macos.test.ts — Sub-AC 6b 단위 테스트
 *
 * macOS(darwin) 플랫폼에서 chokidar에 usePolling: true와 interval: N이
 * 전달되는지 검증하고, 비-darwin 플랫폼에서는 usePolling: false임을
 * process.platform 목킹으로 검증한다.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

// ESM 환경에서 chokidar를 직접 목킹하는 대신,
// createWatcher 내부에서 사용하는 isMacOS()와 chokidar.watch 호출을
// 스파이/process.platform 조작으로 검증한다.
import chokidar from 'chokidar'
import { createWatcher, isMacOS } from '../src/watch/index.js'

describe('isMacOS() — 플랫폼 감지 (Sub-AC 6b)', () => {
  let originalPlatform: NodeJS.Platform

  beforeEach(() => {
    originalPlatform = process.platform
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    })
  })

  it('process.platform이 darwin일 때 true를 반환한다', () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    })
    expect(isMacOS()).toBe(true)
  })

  it('process.platform이 linux일 때 false를 반환한다', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      writable: true,
      configurable: true,
    })
    expect(isMacOS()).toBe(false)
  })

  it('process.platform이 win32일 때 false를 반환한다', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      writable: true,
      configurable: true,
    })
    expect(isMacOS()).toBe(false)
  })

  it('process.platform이 freebsd일 때 false를 반환한다', () => {
    Object.defineProperty(process, 'platform', {
      value: 'freebsd',
      writable: true,
      configurable: true,
    })
    expect(isMacOS()).toBe(false)
  })
})

describe('createWatcher — macOS 폴링 백업 (Sub-AC 6b)', () => {
  let originalPlatform: NodeJS.Platform
  let watchSpy: ReturnType<typeof jest.spyOn>

  beforeEach(() => {
    originalPlatform = process.platform
    // chokidar.watch 호출을 스파이로 감시 (실제 동작은 그대로 유지)
    watchSpy = jest.spyOn(chokidar, 'watch')
  })

  afterEach(async () => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    })
    watchSpy.mockRestore()
  })

  describe('darwin 플랫폼: usePolling=true, interval=N이 chokidar에 전달된다', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      })
    })

    it('기본 pollIntervalMs(1000)로 usePolling=true가 chokidar에 전달된다', async () => {
      const handle = createWatcher([])

      expect(watchSpy).toHaveBeenCalledTimes(1)
      const calledOptions = watchSpy.mock.calls[0]?.[1] as Record<string, unknown>
      expect(calledOptions?.['usePolling']).toBe(true)
      expect(calledOptions?.['interval']).toBe(1000)

      await handle.close()
    })

    it('pollIntervalMs=500 옵션이 interval로 chokidar에 전달된다', async () => {
      const handle = createWatcher([], { pollIntervalMs: 500 })

      expect(watchSpy).toHaveBeenCalledTimes(1)
      const calledOptions = watchSpy.mock.calls[0]?.[1] as Record<string, unknown>
      expect(calledOptions?.['usePolling']).toBe(true)
      expect(calledOptions?.['interval']).toBe(500)

      await handle.close()
    })

    it('options.usePolling=false를 명시하면 darwin에서도 usePolling=false가 된다 (명시값 우선)', async () => {
      const handle = createWatcher([], { usePolling: false })

      expect(watchSpy).toHaveBeenCalledTimes(1)
      const calledOptions = watchSpy.mock.calls[0]?.[1] as Record<string, unknown>
      expect(calledOptions?.['usePolling']).toBe(false)

      await handle.close()
    })
  })

  describe('비-darwin 플랫폼: usePolling=false가 chokidar에 전달된다', () => {
    it('process.platform="linux"일 때 usePolling=false가 chokidar에 전달된다', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      })

      const handle = createWatcher([])

      expect(watchSpy).toHaveBeenCalledTimes(1)
      const calledOptions = watchSpy.mock.calls[0]?.[1] as Record<string, unknown>
      expect(calledOptions?.['usePolling']).toBe(false)

      await handle.close()
    })

    it('process.platform="win32"일 때 usePolling=false가 chokidar에 전달된다', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })

      const handle = createWatcher([])

      expect(watchSpy).toHaveBeenCalledTimes(1)
      const calledOptions = watchSpy.mock.calls[0]?.[1] as Record<string, unknown>
      expect(calledOptions?.['usePolling']).toBe(false)

      await handle.close()
    })

    it('linux에서 options.usePolling=true를 명시하면 usePolling=true가 된다 (명시값 우선)', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      })

      const handle = createWatcher([], { usePolling: true, pollIntervalMs: 2000 })

      expect(watchSpy).toHaveBeenCalledTimes(1)
      const calledOptions = watchSpy.mock.calls[0]?.[1] as Record<string, unknown>
      expect(calledOptions?.['usePolling']).toBe(true)
      expect(calledOptions?.['interval']).toBe(2000)

      await handle.close()
    })
  })

  describe('플랫폼 독립 동작 검증', () => {
    it('darwin에서 createWatcher가 WatcherHandle 인터페이스를 반환한다', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      })

      const handle = createWatcher([])

      expect(handle).toHaveProperty('watcher')
      expect(handle).toHaveProperty('patterns')
      expect(handle).toHaveProperty('close')
      expect(typeof handle.close).toBe('function')
      expect(handle.patterns).toContain('~/.claude/projects/**')

      await handle.close()
    })

    it('linux에서 createWatcher가 WatcherHandle 인터페이스를 반환한다', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      })

      const handle = createWatcher([])

      expect(handle).toHaveProperty('watcher')
      expect(handle).toHaveProperty('patterns')
      expect(handle).toHaveProperty('close')
      expect(typeof handle.close).toBe('function')
      expect(handle.patterns).toContain('~/.claude/projects/**')

      await handle.close()
    })
  })
})
