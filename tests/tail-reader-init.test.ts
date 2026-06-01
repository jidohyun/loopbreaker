/**
 * tail-reader-init.test.ts — Sub-AC 5d-1: TailReader 생성자 및 초기화 단위 테스트
 *
 * 검증 항목:
 *   - 파일 경로와 콜백을 받아 초기 오프셋을 0으로 설정
 *   - chokidar watcher를 생성하는 초기화 로직 (mock chokidar 주입)
 *   - start() 시 watcher 생성 및 이벤트 바인딩
 *   - initialByteOffset 옵션 주입
 *   - usePolling/pollIntervalMs 옵션 전달
 *   - watcherFactory 미제공 시 실 chokidar 대신 mock 사용 검증
 *   - close() 호출 시 watcher 정리
 *   - 잘못된 파일 경로 입력 → zod 검증 오류
 */

import { jest, describe, it, expect } from '@jest/globals'
import type { FSWatcher } from 'chokidar'
import { EventEmitter } from 'node:events'
import { TailReader } from '../src/ingest/tail-reader.js'
import type { TailReaderOptions, WatcherFactory } from '../src/ingest/tail-reader.js'

// ---- Mock FSWatcher 팩토리 ----

/**
 * 테스트용 Mock FSWatcher.
 * EventEmitter 기반으로 chokidar FSWatcher 인터페이스를 모방한다.
 */
class MockFSWatcher extends EventEmitter {
  public closed = false
  public watchedPath: string | null = null
  public watchOptions: Record<string, unknown> | null = null

  async close(): Promise<void> {
    this.closed = true
  }
}

/**
 * Mock WatcherFactory: MockFSWatcher를 생성하고 인자를 기록한다.
 */
function createMockFactory(): {
  factory: WatcherFactory
  instances: MockFSWatcher[]
  lastPath: () => string | null
  lastOptions: () => Record<string, unknown> | null
} {
  const instances: MockFSWatcher[] = []

  const factory: WatcherFactory = (path, options) => {
    const mock = new MockFSWatcher()
    mock.watchedPath = path
    mock.watchOptions = options as unknown as Record<string, unknown>
    instances.push(mock)
    return mock as unknown as FSWatcher
  }

  return {
    factory,
    instances,
    lastPath: () => instances[instances.length - 1]?.watchedPath ?? null,
    lastOptions: () => instances[instances.length - 1]?.watchOptions ?? null,
  }
}

// ---- 테스트 ----

describe('TailReader 생성자 및 초기화 (Sub-AC 5d-1)', () => {
  describe('생성자 기본 동작', () => {
    it('파일 경로와 콜백을 받아 초기 byteOffset을 0으로 설정한다', () => {
      const { factory } = createMockFactory()
      const cb = jest.fn()
      const reader = new TailReader('/tmp/session.jsonl', cb, { watcherFactory: factory })

      expect(reader.byteOffset).toBe(0)
      expect(reader.filePath).toBe('/tmp/session.jsonl')
      expect(reader.state).toBe('idle')
    })

    it('초기 상태는 idle이며 watcher는 null이다', () => {
      const { factory } = createMockFactory()
      const reader = new TailReader('/tmp/test.jsonl', jest.fn(), { watcherFactory: factory })

      expect(reader.state).toBe('idle')
      expect(reader.watcher).toBeNull()
    })

    it('partialLine 초기값은 빈 문자열이다', () => {
      const { factory } = createMockFactory()
      const reader = new TailReader('/tmp/test.jsonl', jest.fn(), { watcherFactory: factory })

      expect(reader.partialLine).toBe('')
    })

    it('initialByteOffset 옵션을 주입하면 해당 오프셋으로 초기화한다', () => {
      const { factory } = createMockFactory()
      const reader = new TailReader('/tmp/test.jsonl', jest.fn(), {
        watcherFactory: factory,
        initialByteOffset: 1024,
      })

      expect(reader.byteOffset).toBe(1024)
    })

    it('initialByteOffset을 생략하면 0으로 초기화한다', () => {
      const { factory } = createMockFactory()
      const reader = new TailReader('/tmp/test.jsonl', jest.fn(), { watcherFactory: factory })

      expect(reader.byteOffset).toBe(0)
    })

    it('빈 문자열 파일 경로는 zod 검증 오류를 발생시킨다', () => {
      const { factory } = createMockFactory()
      expect(() => new TailReader('', jest.fn(), { watcherFactory: factory })).toThrow()
    })
  })

  describe('start() — chokidar watcher 생성', () => {
    it('start() 호출 시 watcherFactory가 파일 경로와 함께 호출된다', () => {
      const { factory, lastPath, instances } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()

      expect(instances).toHaveLength(1)
      expect(lastPath()).toBe('/tmp/session.jsonl')
    })

    it('start() 호출 후 상태가 watching으로 변경된다', () => {
      const { factory } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()

      expect(reader.state).toBe('watching')
    })

    it('start() 호출 후 watcher 인스턴스가 설정된다', () => {
      const { factory } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()

      expect(reader.watcher).not.toBeNull()
    })

    it('watcherFactory에 persistent=true 옵션이 전달된다', () => {
      const { factory, lastOptions } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()

      expect(lastOptions()?.['persistent']).toBe(true)
    })

    it('pollIntervalMs 옵션이 watcherFactory에 interval로 전달된다', () => {
      const { factory, lastOptions } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), {
        watcherFactory: factory,
        pollIntervalMs: 500,
      })

      reader.start()

      expect(lastOptions()?.['interval']).toBe(500)
    })

    it('usePolling=true 옵션이 watcherFactory에 전달된다', () => {
      const { factory, lastOptions } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), {
        watcherFactory: factory,
        usePolling: true,
      })

      reader.start()

      expect(lastOptions()?.['usePolling']).toBe(true)
    })

    it('usePolling=false 옵션이 watcherFactory에 전달된다', () => {
      const { factory, lastOptions } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), {
        watcherFactory: factory,
        usePolling: false,
      })

      reader.start()

      expect(lastOptions()?.['usePolling']).toBe(false)
    })

    it('awaitWriteFinish 옵션이 watcherFactory에 전달된다', () => {
      const { factory, lastOptions } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()

      const awaitWriteFinish = lastOptions()?.['awaitWriteFinish'] as Record<string, unknown> | undefined
      expect(awaitWriteFinish).toBeDefined()
      expect(awaitWriteFinish?.['stabilityThreshold']).toBe(200)
      expect(awaitWriteFinish?.['pollInterval']).toBe(100)
    })

    it('start()를 두 번 호출해도 watcher는 1개만 생성된다 (중복 방지)', () => {
      const { factory, instances } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()
      reader.start()

      expect(instances).toHaveLength(1)
    })

    it('change 이벤트 핸들러가 watcher에 등록된다', () => {
      const { factory, instances } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()

      const mock = instances[0]!
      expect(mock.listenerCount('change')).toBeGreaterThanOrEqual(1)
    })

    it('ready 이벤트 핸들러가 watcher에 등록된다', () => {
      const { factory, instances } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()

      const mock = instances[0]!
      expect(mock.listenerCount('ready')).toBeGreaterThanOrEqual(1)
    })

    it('error 이벤트 핸들러가 watcher에 등록된다', () => {
      const { factory, instances } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()

      const mock = instances[0]!
      expect(mock.listenerCount('error')).toBeGreaterThanOrEqual(1)
    })
  })

  describe('close() — 리소스 정리', () => {
    it('close() 호출 후 상태가 closed로 변경된다', async () => {
      const { factory } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()
      await reader.close()

      expect(reader.state).toBe('closed')
    })

    it('close() 호출 후 watcher.close()가 호출된다', async () => {
      const { factory, instances } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()
      await reader.close()

      expect(instances[0]?.closed).toBe(true)
    })

    it('close() 호출 후 watcher가 null로 설정된다', async () => {
      const { factory } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()
      await reader.close()

      expect(reader.watcher).toBeNull()
    })

    it('start() 없이 close()를 호출해도 에러가 발생하지 않는다', async () => {
      const { factory } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      await expect(reader.close()).resolves.toBeUndefined()
      expect(reader.state).toBe('closed')
    })

    it('close()를 두 번 호출해도 에러가 발생하지 않는다 (멱등성)', async () => {
      const { factory } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()
      await reader.close()
      await expect(reader.close()).resolves.toBeUndefined()
    })
  })

  describe('updateOffset()', () => {
    it('updateOffset()으로 바이트 오프셋을 외부에서 업데이트할 수 있다', () => {
      const { factory } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.updateOffset(2048)

      expect(reader.byteOffset).toBe(2048)
    })

    it('updateOffset(0)으로 오프셋을 리셋할 수 있다', () => {
      const { factory } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), {
        watcherFactory: factory,
        initialByteOffset: 1024,
      })

      reader.updateOffset(0)

      expect(reader.byteOffset).toBe(0)
    })

    it('음수 오프셋은 zod 검증 오류를 발생시킨다', () => {
      const { factory } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      expect(() => reader.updateOffset(-1)).toThrow()
    })
  })

  describe('watcher 이벤트 → 콜백 연결', () => {
    it('watcher error 이벤트 발생 시 parseOk=false인 결과로 콜백이 호출된다', () => {
      const { factory, instances } = createMockFactory()
      const cb = jest.fn()
      const reader = new TailReader('/tmp/session.jsonl', cb, { watcherFactory: factory })

      reader.start()

      const mock = instances[0]!
      mock.emit('error', new Error('watcher test error'))

      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ parseOk: false }),
        expect.any(Number),
      )
    })

    it('watcher error 이벤트의 parseError에 에러 메시지가 포함된다', () => {
      const { factory, instances } = createMockFactory()
      const cb = jest.fn()
      const reader = new TailReader('/tmp/session.jsonl', cb, { watcherFactory: factory })

      reader.start()

      const mock = instances[0]!
      mock.emit('error', new Error('disk not found'))

      const [result] = cb.mock.calls[0] as [{ parseOk: boolean; parseError: string }]
      expect(result.parseError).toContain('disk not found')
    })
  })

  describe('옵션 기본값 검증', () => {
    it('pollIntervalMs 기본값은 1000ms이다', () => {
      const { factory, lastOptions } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()

      expect(lastOptions()?.['interval']).toBe(1000)
    })

    it('ignoreInitial 기본값은 false이다 (기존 파일 내용 처리)', () => {
      const { factory, lastOptions } = createMockFactory()
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), { watcherFactory: factory })

      reader.start()

      expect(lastOptions()?.['ignoreInitial']).toBe(false)
    })
  })

  describe('TailReaderOptions 인터페이스', () => {
    it('모든 옵션을 생략해도 기본값으로 정상 생성된다', () => {
      const { factory } = createMockFactory()
      const options: TailReaderOptions = { watcherFactory: factory }
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), options)

      expect(reader.byteOffset).toBe(0)
      expect(reader.state).toBe('idle')
    })

    it('모든 옵션을 지정해도 정상 생성된다', () => {
      const { factory } = createMockFactory()
      const options: TailReaderOptions = {
        initialByteOffset: 512,
        pollIntervalMs: 250,
        usePolling: true,
        watcherFactory: factory,
      }
      const reader = new TailReader('/tmp/session.jsonl', jest.fn(), options)

      expect(reader.byteOffset).toBe(512)
      reader.start()
      expect(reader.state).toBe('watching')
    })
  })
})
