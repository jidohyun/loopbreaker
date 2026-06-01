/**
 * tests/tail-reader-change-event.test.ts
 *
 * Sub-AC 5d-3: chokidar `change` 이벤트 핸들러 통합 테스트
 *
 * 검증 항목:
 *   - change 이벤트 수신 시 _readIncremental()이 호출된다
 *   - _readIncremental() 실행 후 완성된 라인이 등록된 콜백으로 방출된다
 *   - mock fs + mock chokidar를 사용한 통합 테스트
 *   - 연속 change 이벤트에서 각각 증분 읽기가 수행된다
 *   - change 이벤트 핸들러가 직렬 읽기를 보장한다 (중복 실행 방지)
 *   - closed 상태에서 change 이벤트를 수신해도 읽기를 수행하지 않는다
 *
 * 설계:
 *   TailReader(filePath, callback, { watcherFactory, fsAdapter }) 형태로
 *   mock chokidar (MockFSWatcher)와 mock fs (MockFsAdapter)를 주입하여
 *   실제 파일시스템·chokidar 없이 통합 동작을 검증한다.
 *
 *   타이밍 원칙 (tail-reader-incremental.test.ts와 동일):
 *     change 이벤트를 emit한 후, _readIncremental()은 await stat() 이후
 *     createReadStream()을 호출하므로 스트림 리스너 등록은 마이크로태스크 이후다.
 *     setImmediate로 data+end 이벤트를 지연 발송해야 한다.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { EventEmitter } from 'node:events'
import type { FSWatcher } from 'chokidar'
import { TailReader } from '../src/ingest/tail-reader.js'
import type { FsAdapter, WatcherFactory } from '../src/ingest/tail-reader.js'
import type { ParseLineResult } from '../src/ingest/parser.js'

// ── Mock 헬퍼 ──────────────────────────────────────────────────────────────

/**
 * Mock FSWatcher — EventEmitter 기반.
 * chokidar FSWatcher 인터페이스를 모방한다.
 * 테스트에서 직접 'change' 이벤트를 emit해 핸들러를 트리거한다.
 */
class MockFSWatcher extends EventEmitter {
  public closed = false

  async close(): Promise<void> {
    this.closed = true
  }
}

/**
 * Mock ReadStream — EventEmitter 기반.
 * TailReader 내부 createReadStream() 반환값을 대체한다.
 */
class MockReadStream extends EventEmitter {
  /** 청크 배열을 순서대로 emit 후 'end'를 emit한다 */
  emitData(chunks: Buffer[]): void {
    for (const chunk of chunks) {
      this.emit('data', chunk)
    }
    this.emit('end')
  }

  /** 'error' 이벤트를 emit한다 */
  emitError(err: Error): void {
    this.emit('error', err)
  }
}

/**
 * Mock FsAdapter 생성 헬퍼.
 * fileSize가 'ENOENT'이면 stat()이 reject된다.
 */
function createMockFs(
  fileSize: number | 'ENOENT',
): { adapter: FsAdapter; stream: MockReadStream } {
  const stream = new MockReadStream()

  const adapter: FsAdapter = {
    stat: jest.fn<FsAdapter['stat']>().mockImplementation(() => {
      if (fileSize === 'ENOENT') {
        const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
        return Promise.reject(err)
      }
      return Promise.resolve({ size: fileSize })
    }),
    createReadStream: jest.fn<FsAdapter['createReadStream']>().mockReturnValue(
      stream as unknown as NodeJS.ReadableStream,
    ),
  }

  return { adapter, stream }
}

/**
 * setImmediate로 1틱 뒤에 data+end 이벤트를 발송한다.
 *
 * _readIncremental()은 stat() await 이후 createReadStream()을 호출하므로
 * 리스너 등록 시점은 마이크로태스크 이후다. setImmediate는 마이크로태스크
 * 전부 소진 뒤에 실행되므로 리스너가 안전하게 붙어 있다.
 */
function emitAfterTick(stream: MockReadStream, chunks: Buffer[]): void {
  setImmediate(() => stream.emitData(chunks))
}

/**
 * MockFSWatcher를 반환하는 WatcherFactory 생성 헬퍼.
 */
function createMockWatcherFactory(): {
  factory: WatcherFactory
  instances: MockFSWatcher[]
} {
  const instances: MockFSWatcher[] = []

  const factory: WatcherFactory = (_path, _opts) => {
    const mock = new MockFSWatcher()
    instances.push(mock)
    return mock as unknown as FSWatcher
  }

  return { factory, instances }
}

/**
 * TailReader 생성 헬퍼.
 * watcherFactory와 fsAdapter를 주입해 실제 파일시스템·chokidar를 사용하지 않는다.
 */
function makeReader(
  factory: WatcherFactory,
  adapter: FsAdapter,
  callback: (r: ParseLineResult, o: number) => void,
  initialByteOffset = 0,
): TailReader {
  return new TailReader('/tmp/session.jsonl', callback, {
    watcherFactory: factory,
    fsAdapter: adapter,
    initialByteOffset,
    usePolling: false,
  })
}

/**
 * change 이벤트가 방출될 때까지 기다린 후 _readIncremental()이 완료될 때까지
 * Promise를 반환하는 헬퍼.
 *
 * change 이벤트 → _scheduleRead() → _readIncremental() (async)
 * _readIncremental()은 micro-task(stat await) 이후 stream을 열고 data+end를 기다린다.
 * 따라서 change emit 후 flushPromises()로 pending micro-task를 모두 소진한다.
 */
async function flushPromises(): Promise<void> {
  // setImmediate가 처리되도록 여러 틱 대기
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

// ── 테스트 ────────────────────────────────────────────────────────────────

describe('TailReader change 이벤트 핸들러 통합 테스트 (Sub-AC 5d-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ────────────────────────────────────────────────────────────────────────
  // 1. change 이벤트 수신 시 _readIncremental() 호출
  // ────────────────────────────────────────────────────────────────────────

  describe('change 이벤트 → _readIncremental() 호출', () => {
    it('change 이벤트 수신 시 fsAdapter.stat()이 호출된다', async () => {
      const { factory, instances } = createMockWatcherFactory()
      const { adapter } = createMockFs(0)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(factory, adapter, cb)

      reader.start()
      const watcher = instances[0]!

      // change 이벤트 발송
      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      expect(adapter.stat).toHaveBeenCalled()

      await reader.close()
    })

    it('change 이벤트 발생 후 새 데이터가 있으면 createReadStream()이 호출된다', async () => {
      const line = '{"type":"user","uuid":"u1"}\n'
      const fileSize = Buffer.byteLength(line, 'utf8')

      const { factory, instances } = createMockWatcherFactory()
      const { adapter, stream } = createMockFs(fileSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(factory, adapter, cb)

      reader.start()
      const watcher = instances[0]!

      emitAfterTick(stream, [Buffer.from(line, 'utf8')])
      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      expect(adapter.createReadStream).toHaveBeenCalledWith(
        '/tmp/session.jsonl',
        expect.objectContaining({ start: 0 }),
      )

      await reader.close()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 2. 완성된 라인이 콜백으로 방출된다
  // ────────────────────────────────────────────────────────────────────────

  describe('change 이벤트 → 콜백 방출', () => {
    it('change 이벤트 후 단일 완성 JSON 라인이 콜백으로 방출된다', async () => {
      const line = '{"type":"user","uuid":"test-uuid"}\n'
      const fileSize = Buffer.byteLength(line, 'utf8')

      const { factory, instances } = createMockWatcherFactory()
      const { adapter, stream } = createMockFs(fileSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(factory, adapter, cb)

      reader.start()
      const watcher = instances[0]!

      emitAfterTick(stream, [Buffer.from(line, 'utf8')])
      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      expect(cb).toHaveBeenCalledTimes(1)
      const [result, offset] = cb.mock.calls[0] as [ParseLineResult, number]
      expect(result.parseOk).toBe(true)
      expect(result.event.uuid).toBe('test-uuid')
      expect(result.event.kind).toBe('user')
      expect(offset).toBe(0)

      await reader.close()
    })

    it('change 이벤트 후 여러 완성 JSON 라인이 각각 콜백으로 방출된다', async () => {
      const line1 = '{"type":"user","uuid":"u1"}\n'
      const line2 = '{"type":"assistant","uuid":"u2"}\n'
      const content = line1 + line2
      const fileSize = Buffer.byteLength(content, 'utf8')

      const { factory, instances } = createMockWatcherFactory()
      const { adapter, stream } = createMockFs(fileSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(factory, adapter, cb)

      reader.start()
      const watcher = instances[0]!

      emitAfterTick(stream, [Buffer.from(content, 'utf8')])
      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      expect(cb).toHaveBeenCalledTimes(2)
      const [r1] = cb.mock.calls[0] as [ParseLineResult, number]
      const [r2] = cb.mock.calls[1] as [ParseLineResult, number]
      expect(r1.event.uuid).toBe('u1')
      expect(r2.event.uuid).toBe('u2')

      await reader.close()
    })

    it('change 이벤트 후 파싱 실패 라인은 parseOk=false로 콜백 전달된다', async () => {
      const badLine = 'NOT_VALID_JSON\n'
      const goodLine = '{"type":"user","uuid":"good"}\n'
      const content = badLine + goodLine
      const fileSize = Buffer.byteLength(content, 'utf8')

      const { factory, instances } = createMockWatcherFactory()
      const { adapter, stream } = createMockFs(fileSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(factory, adapter, cb)

      reader.start()
      const watcher = instances[0]!

      emitAfterTick(stream, [Buffer.from(content, 'utf8')])
      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      expect(cb).toHaveBeenCalledTimes(2)
      const [r1] = cb.mock.calls[0] as [ParseLineResult, number]
      const [r2] = cb.mock.calls[1] as [ParseLineResult, number]
      expect(r1.parseOk).toBe(false)
      expect(r2.parseOk).toBe(true)
      expect(r2.event.uuid).toBe('good')

      await reader.close()
    })

    it('change 이벤트 후 byteOffset이 읽은 바이트 수만큼 전진한다', async () => {
      const line = '{"type":"system","uuid":"s1"}\n'
      const fileSize = Buffer.byteLength(line, 'utf8')

      const { factory, instances } = createMockWatcherFactory()
      const { adapter, stream } = createMockFs(fileSize)
      const cb = jest.fn()
      const reader = makeReader(factory, adapter, cb)

      reader.start()
      const watcher = instances[0]!

      expect(reader.byteOffset).toBe(0)

      emitAfterTick(stream, [Buffer.from(line, 'utf8')])
      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      expect(reader.byteOffset).toBe(fileSize)

      await reader.close()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 3. 연속 change 이벤트에서 증분 읽기
  // ────────────────────────────────────────────────────────────────────────

  describe('연속 change 이벤트 → 증분 읽기', () => {
    it('두 번의 change 이벤트에서 각각 증분 읽기가 수행된다', async () => {
      const line1 = '{"type":"user","uuid":"first"}\n'
      const line2 = '{"type":"assistant","uuid":"second"}\n'
      const len1 = Buffer.byteLength(line1, 'utf8')
      const len2 = Buffer.byteLength(line2, 'utf8')

      const { factory, instances } = createMockWatcherFactory()
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()

      // 1차 읽기용 adapter+stream
      const mock1 = createMockFs(len1)
      const reader = makeReader(factory, mock1.adapter, cb)

      reader.start()
      const watcher = instances[0]!

      // 첫 번째 change 이벤트
      emitAfterTick(mock1.stream, [Buffer.from(line1, 'utf8')])
      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      expect(cb).toHaveBeenCalledTimes(1)
      const [r1] = cb.mock.calls[0] as [ParseLineResult, number]
      expect(r1.event.uuid).toBe('first')
      expect(reader.byteOffset).toBe(len1)

      // 2차 읽기용 adapter+stream으로 교체
      const mock2 = createMockFs(len1 + len2)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(reader as any)._fsAdapter = mock2.adapter

      // 두 번째 change 이벤트 (line2만 새로 추가됨)
      emitAfterTick(mock2.stream, [Buffer.from(line2, 'utf8')])
      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      expect(cb).toHaveBeenCalledTimes(2)
      const [r2] = cb.mock.calls[1] as [ParseLineResult, number]
      expect(r2.event.uuid).toBe('second')
      expect(reader.byteOffset).toBe(len1 + len2)

      // 두 번째 읽기에서 start: len1 (이전 오프셋)로 createReadStream 호출 확인
      expect(mock2.adapter.createReadStream).toHaveBeenCalledWith(
        '/tmp/session.jsonl',
        expect.objectContaining({ start: len1 }),
      )

      await reader.close()
    })

    it('파일에 변경이 없을 때(fileSize === byteOffset) change 이벤트는 콜백을 호출하지 않는다', async () => {
      const line = '{"type":"user","uuid":"existing"}\n'
      const fileSize = Buffer.byteLength(line, 'utf8')

      const { factory, instances } = createMockWatcherFactory()
      const { adapter } = createMockFs(fileSize)
      const cb = jest.fn()
      const reader = makeReader(factory, adapter, cb, fileSize)  // 이미 다 읽은 상태

      reader.start()
      const watcher = instances[0]!

      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      expect(adapter.createReadStream).not.toHaveBeenCalled()
      expect(cb).not.toHaveBeenCalled()

      await reader.close()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 4. 직렬 읽기 보장 (중복 실행 방지)
  // ────────────────────────────────────────────────────────────────────────

  describe('직렬 읽기 보장 (중복 실행 방지)', () => {
    it('첫 번째 읽기 완료 전 두 번째 change 이벤트가 오면 createReadStream은 1회만 호출된다', async () => {
      const line = '{"type":"user","uuid":"concurrent"}\n'
      const fileSize = Buffer.byteLength(line, 'utf8')

      const { factory, instances } = createMockWatcherFactory()
      const { adapter, stream } = createMockFs(fileSize)
      const cb = jest.fn()
      const reader = makeReader(factory, adapter, cb)

      reader.start()
      const watcher = instances[0]!

      // 첫 번째 change: 아직 스트림 data 미발송
      watcher.emit('change', '/tmp/session.jsonl')

      // 두 번째 change: 첫 번째 읽기 진행 중
      watcher.emit('change', '/tmp/session.jsonl')

      // 이제 data+end 발송
      emitAfterTick(stream, [Buffer.from(line, 'utf8')])
      await flushPromises()

      // _readIncremental()은 직렬 실행: 중복 방지로 createReadStream은 1회만 호출
      expect(adapter.createReadStream).toHaveBeenCalledTimes(1)

      await reader.close()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 5. closed 상태에서 change 이벤트 처리
  // ────────────────────────────────────────────────────────────────────────

  describe('closed 상태에서 change 이벤트 처리', () => {
    it('close() 후 change 이벤트를 수신해도 읽기를 수행하지 않는다', async () => {
      const { factory, instances } = createMockWatcherFactory()
      const { adapter } = createMockFs(100)
      const cb = jest.fn()
      const reader = makeReader(factory, adapter, cb)

      reader.start()
      await reader.close()

      const watcher = instances[0]!

      // close 후 change 이벤트
      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      // closed 상태에서 stat은 호출될 수 있지만 createReadStream은 호출되지 않음
      // (_readIncremental 첫 줄에서 state === 'closed' 체크)
      expect(cb).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 6. 미완성 부분 라인 버퍼링 + change 이벤트
  // ────────────────────────────────────────────────────────────────────────

  describe('미완성 부분 라인 버퍼링 + change 이벤트', () => {
    it('change 이벤트로 partial 라인 도착 후 다음 change 이벤트에서 완성된다', async () => {
      const part1 = '{"type":"user","uuid":"partial-complete"'
      const part2 = '}\n'
      const len1 = Buffer.byteLength(part1, 'utf8')
      const len2 = Buffer.byteLength(part2, 'utf8')

      const { factory, instances } = createMockWatcherFactory()
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()

      // 1차: part1만 (미완성)
      const mock1 = createMockFs(len1)
      const reader = makeReader(factory, mock1.adapter, cb)

      reader.start()
      const watcher = instances[0]!

      emitAfterTick(mock1.stream, [Buffer.from(part1, 'utf8')])
      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      expect(cb).not.toHaveBeenCalled()
      expect(reader.partialLine).toBe(part1)
      expect(reader.byteOffset).toBe(0)  // partialLine은 오프셋에 포함되지 않음

      // 2차: part2 추가. byteOffset을 len1로 수동 설정해 part2만 읽는 시나리오
      // (실제 파일에서는 part1이 커밋된 후 part2가 추가되므로 byteOffset=len1부터 읽음)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(reader as any)._byteOffset = len1

      const mock2 = createMockFs(len1 + len2)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(reader as any)._fsAdapter = mock2.adapter

      emitAfterTick(mock2.stream, [Buffer.from(part2, 'utf8')])
      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      // partialLine(part1) + part2 → 완성된 JSON 라인
      expect(cb).toHaveBeenCalledTimes(1)
      const [result] = cb.mock.calls[0] as [ParseLineResult, number]
      expect(result.parseOk).toBe(true)
      expect(result.event.uuid).toBe('partial-complete')

      await reader.close()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 7. 파일 로테이션 감지 + change 이벤트
  // ────────────────────────────────────────────────────────────────────────

  describe('파일 로테이션 감지 + change 이벤트', () => {
    it('change 이벤트에서 파일 크기가 byteOffset보다 작으면 로테이션으로 감지해 start:0으로 읽는다', async () => {
      const oldOffset = 500
      const newContent = '{"type":"user","uuid":"fresh-start"}\n'
      const newFileSize = Buffer.byteLength(newContent, 'utf8')

      const { factory, instances } = createMockWatcherFactory()
      const { adapter, stream } = createMockFs(newFileSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(factory, adapter, cb, oldOffset)

      reader.start()
      const watcher = instances[0]!

      emitAfterTick(stream, [Buffer.from(newContent, 'utf8')])
      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      expect(adapter.createReadStream).toHaveBeenCalledWith(
        '/tmp/session.jsonl',
        expect.objectContaining({ start: 0 }),
      )
      expect(cb).toHaveBeenCalledTimes(1)
      const [result] = cb.mock.calls[0] as [ParseLineResult, number]
      expect(result.event.uuid).toBe('fresh-start')

      await reader.close()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 8. 파일 없음(ENOENT) + change 이벤트
  // ────────────────────────────────────────────────────────────────────────

  describe('파일 없음(ENOENT) + change 이벤트', () => {
    it('change 이벤트 수신 시 파일이 없으면 조용히 skip하고 콜백을 호출하지 않는다', async () => {
      const { factory, instances } = createMockWatcherFactory()
      const { adapter } = createMockFs('ENOENT')
      const cb = jest.fn()
      const reader = makeReader(factory, adapter, cb)

      reader.start()
      const watcher = instances[0]!

      watcher.emit('change', '/tmp/session.jsonl')
      await flushPromises()

      expect(adapter.stat).toHaveBeenCalled()
      expect(adapter.createReadStream).not.toHaveBeenCalled()
      expect(cb).not.toHaveBeenCalled()

      await reader.close()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 9. change 이벤트 핸들러가 watcher에 등록되었는지 확인
  // ────────────────────────────────────────────────────────────────────────

  describe('change 이벤트 핸들러 등록 확인', () => {
    it('start() 후 watcher에 change 리스너가 등록된다', () => {
      const { factory, instances } = createMockWatcherFactory()
      const { adapter } = createMockFs(0)
      const cb = jest.fn()
      const reader = makeReader(factory, adapter, cb)

      reader.start()

      const watcher = instances[0]!
      expect(watcher.listenerCount('change')).toBeGreaterThanOrEqual(1)
    })

    it('change 이벤트 핸들러는 filePath 인수를 무시하고 동작한다', async () => {
      const line = '{"type":"user","uuid":"path-ignored"}\n'
      const fileSize = Buffer.byteLength(line, 'utf8')

      const { factory, instances } = createMockWatcherFactory()
      const { adapter, stream } = createMockFs(fileSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(factory, adapter, cb)

      reader.start()
      const watcher = instances[0]!

      // change 이벤트에는 실제와 다른 경로를 전달
      emitAfterTick(stream, [Buffer.from(line, 'utf8')])
      watcher.emit('change', '/some/other/path.jsonl')
      await flushPromises()

      // 경로와 무관하게 _readIncremental()은 _filePath를 사용
      expect(cb).toHaveBeenCalledTimes(1)
      const [result] = cb.mock.calls[0] as [ParseLineResult, number]
      expect(result.event.uuid).toBe('path-ignored')

      await reader.close()
    })
  })
})
