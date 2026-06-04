/**
 * tests/tail-reader-parseline-sub-ac-3b-1.test.ts
 *
 * Sub-AC 3b-1: TailReader 증분 read → parseLine 연결 단위 테스트
 *
 * 검증 항목:
 *   - TailReader의 증분 read가 반환한 청크가 parseLine에 올바르게 전달됨
 *     (증명 방법: parseLine이 처리한 결과인 ParseLineResult가 콜백으로 전달되는지 확인)
 *   - parseLine이 반환한 ParseLineResult가 콜백으로 전달됨
 *   - 파싱 성공 라인(parseOk=true) → 콜백에 정상 이벤트 전달
 *   - 파싱 실패 라인(JSON invalid) → parseOk=false로 콜백 전달, 파이프라인 계속
 *   - 빈 청크 → parseLine 호출 없음 (콜백 0회)
 *   - 부분 라인(개행 없이 끝남) → parseLine 호출 없음, 다음 청크에서 합산
 *   - 멀티 청크 경계에서 라인이 올바르게 분리됨
 *   - byteOffset이 각 라인별로 정확히 전달됨
 *   - mock FsAdapter + mock watcher 사용 (실제 fs/chokidar 없음)
 *
 * 테스트 원칙 (M5 최우선 계약):
 *   - 실제 파일시스템 감시(chokidar) 0
 *   - 실제 네트워크·OS알림 0
 *   - FsAdapter mock 주입으로 실제 fs.stat/createReadStream 없음
 *   - parseLine이 처리한 결과인 NormalizedEvent uuid/sessionId/parseOk를 콜백에서 검증
 *
 * 설계 노트:
 *   ESM 모듈은 읽기 전용이므로 jest.spyOn(parserModule, 'parseLine')이 불가능하다.
 *   대신, parseLine이 처리한 결과가 콜백에 정확히 전달되는지를 통해 연결을 검증한다.
 *   이 방식은 "parseLine이 청크 데이터를 받아 파싱하고 그 결과를 콜백으로 전달한다"는
 *   계약을 행동 기반(behavior-driven)으로 검증한다.
 */

import { describe, it, expect } from '@jest/globals'
import { EventEmitter } from 'node:events'
import type { FSWatcher } from 'chokidar'
import { TailReader } from '../src/ingest/tail-reader.js'
import type { FsAdapter, WatcherFactory } from '../src/ingest/tail-reader.js'
import type { ParseLineResult } from '../src/ingest/parser.js'

// ─── Mock 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * Mock ReadableStream — EventEmitter 기반.
 * TailReader 내부의 createReadStream() 반환값을 대체한다.
 */
class MockReadStream extends EventEmitter {
  emitData(chunks: Buffer[]): void {
    for (const chunk of chunks) {
      this.emit('data', chunk)
    }
    this.emit('end')
  }

  emitError(err: Error): void {
    this.emit('error', err)
  }
}

/**
 * Mock FSWatcher — EventEmitter 기반.
 * chokidar.watch()를 대체해 실제 파일 감시 없이 이벤트를 수동 트리거한다.
 */
class MockFSWatcher extends EventEmitter {
  closed = false

  async close(): Promise<void> {
    this.closed = true
  }

  triggerReady(): void {
    this.emit('ready')
  }

  triggerChange(path: string): void {
    this.emit('change', path)
  }
}

/**
 * Mock FsAdapter 생성 헬퍼.
 */
function makeMockFsAdapter(fileSize: number, stream: MockReadStream): FsAdapter {
  return {
    stat: (_path: string) => Promise.resolve({ size: fileSize }),
    createReadStream: (_path: string, _opts: { start: number; encoding: undefined }) =>
      stream as unknown as NodeJS.ReadableStream,
  }
}

/**
 * Mock WatcherFactory 생성 헬퍼.
 */
function makeMockWatcherFactory(watcher: MockFSWatcher): WatcherFactory {
  return (_path: string, _opts: unknown) => watcher as unknown as FSWatcher
}

/**
 * 1틱(setImmediate) 뒤에 청크를 발송한다.
 * TailReader 내부 스트림 리스너가 등록된 후 이벤트를 받을 수 있도록 한다.
 */
function emitAfterTick(stream: MockReadStream, chunks: Buffer[]): void {
  setImmediate(() => {
    stream.emitData(chunks)
  })
}

/** ms 대기 */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ─── 테스트 픽스처 ────────────────────────────────────────────────────────────

/** 최소 유효 JSONL 라인 생성 */
function makeJsonlLine(sessionId: string, uuid: string, tool = 'Bash'): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    parentUuid: null,
    sessionId,
    cwd: '/tmp/test',
    isSidechain: false,
    timestamp: '2024-01-01T00:00:00.000Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: `toolu_${uuid.slice(0, 8)}`,
          name: tool,
          input: { command: 'echo hello' },
        },
      ],
    },
  })
}

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('TailReader → parseLine 연결 단위 테스트 (Sub-AC 3b-1)', () => {

  // ── 1. 기본 연결: 청크 → parseLine 결과가 콜백으로 전달됨 ─────────────
  describe('기본 연결: 청크 → parseLine 결과 콜백', () => {

    it('단일 완성 라인 청크 → ParseLineResult 1건이 콜백으로 전달된다 (parseOk=true)', async () => {
      const line = makeJsonlLine('session-1', 'uuid-0001')
      const lineBytes = Buffer.from(line + '\n', 'utf8')

      const stream = new MockReadStream()
      const watcher = new MockFSWatcher()
      const fsAdapter = makeMockFsAdapter(lineBytes.length, stream)
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const collectedOffsets: number[] = []
      const reader = new TailReader('/test/session.jsonl', (result, byteOffset) => {
        collectedResults.push(result)
        collectedOffsets.push(byteOffset)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()
      watcher.triggerReady()
      emitAfterTick(stream, [lineBytes])
      await delay(50)

      // parseLine이 처리한 결과: 정확히 1건, parseOk=true, uuid/sessionId 일치
      expect(collectedResults).toHaveLength(1)
      expect(collectedResults[0]!.parseOk).toBe(true)
      expect(collectedResults[0]!.event.uuid).toBe('uuid-0001')
      expect(collectedResults[0]!.event.sessionId).toBe('session-1')
      // byteOffset은 라인 시작 위치
      expect(collectedOffsets[0]).toBe(0)

      await reader.close()
    })

    it('여러 라인이 있는 청크 → 각 라인마다 ParseLineResult가 순서대로 콜백으로 전달된다', async () => {
      const lines = [
        makeJsonlLine('session-2', 'uuid-0002'),
        makeJsonlLine('session-2', 'uuid-0003'),
        makeJsonlLine('session-2', 'uuid-0004'),
      ]
      const chunk = Buffer.from(lines.join('\n') + '\n', 'utf8')

      const stream = new MockReadStream()
      const watcher = new MockFSWatcher()
      const fsAdapter = makeMockFsAdapter(chunk.length, stream)
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const reader = new TailReader('/test/session.jsonl', (result) => {
        collectedResults.push(result)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()
      watcher.triggerReady()
      emitAfterTick(stream, [chunk])
      await delay(50)

      // 3개 라인 → ParseLineResult 3건
      expect(collectedResults).toHaveLength(3)
      expect(collectedResults.every(r => r.parseOk)).toBe(true)

      // 순서: uuid-0002, uuid-0003, uuid-0004
      expect(collectedResults[0]!.event.uuid).toBe('uuid-0002')
      expect(collectedResults[1]!.event.uuid).toBe('uuid-0003')
      expect(collectedResults[2]!.event.uuid).toBe('uuid-0004')

      await reader.close()
    })

    it('kind 정보가 parseLine 결과를 통해 콜백에 정확히 전달된다', async () => {
      // tool_use 라인 → kind='assistant' (tool_use content 포함)
      const line = makeJsonlLine('session-kind', 'uuid-kind-01', 'Read')
      const lineBuf = Buffer.from(line + '\n', 'utf8')

      const stream = new MockReadStream()
      const watcher = new MockFSWatcher()
      const fsAdapter = makeMockFsAdapter(lineBuf.length, stream)
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const reader = new TailReader('/test/session.jsonl', (result) => {
        collectedResults.push(result)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()
      watcher.triggerReady()
      emitAfterTick(stream, [lineBuf])
      await delay(50)

      expect(collectedResults).toHaveLength(1)
      expect(collectedResults[0]!.parseOk).toBe(true)
      // assistant 메시지 내 tool_use 블록 → kind='assistant'
      expect(collectedResults[0]!.event.kind).toBe('assistant')
      // tool 필드가 parseLine을 통해 올바르게 추출됨
      expect(collectedResults[0]!.event.tool).toBe('Read')

      await reader.close()
    })

  })

  // ── 2. 파싱 실패 처리 ───────────────────────────────────────────────────
  describe('파싱 실패 처리', () => {

    it('JSON.parse 실패 라인 → parseOk=false, parseError 있음, 콜백 1건 전달, 파이프라인 계속', async () => {
      const invalidLine = 'not-valid-json{{{{'
      const chunk = Buffer.from(invalidLine + '\n', 'utf8')

      const stream = new MockReadStream()
      const watcher = new MockFSWatcher()
      const fsAdapter = makeMockFsAdapter(chunk.length, stream)
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const reader = new TailReader('/test/session.jsonl', (result) => {
        collectedResults.push(result)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()
      watcher.triggerReady()
      emitAfterTick(stream, [chunk])
      await delay(50)

      // parseOk=false로 콜백 전달 (파이프라인 중단 없음)
      expect(collectedResults).toHaveLength(1)
      expect(collectedResults[0]!.parseOk).toBe(false)
      expect(collectedResults[0]!.parseError).toBeDefined()
      expect(typeof collectedResults[0]!.parseError).toBe('string')

      await reader.close()
    })

    it('유효 라인 + 파싱 실패 라인 + 유효 라인 혼합 → 3건 콜백, 실패만 parseOk=false, 순서 유지', async () => {
      const validLine1 = makeJsonlLine('session-3', 'uuid-0005')
      const invalidLine = '{ bad json }'
      const validLine2 = makeJsonlLine('session-3', 'uuid-0006')

      const chunk = Buffer.from(
        [validLine1, invalidLine, validLine2].join('\n') + '\n',
        'utf8',
      )

      const stream = new MockReadStream()
      const watcher = new MockFSWatcher()
      const fsAdapter = makeMockFsAdapter(chunk.length, stream)
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const reader = new TailReader('/test/session.jsonl', (result) => {
        collectedResults.push(result)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()
      watcher.triggerReady()
      emitAfterTick(stream, [chunk])
      await delay(50)

      // 3건 모두 콜백 전달 (파이프라인 중단 없음)
      expect(collectedResults).toHaveLength(3)
      // 순서: ok, fail, ok
      expect(collectedResults[0]!.parseOk).toBe(true)
      expect(collectedResults[0]!.event.uuid).toBe('uuid-0005')
      expect(collectedResults[1]!.parseOk).toBe(false)
      expect(collectedResults[1]!.parseError).toBeDefined()
      expect(collectedResults[2]!.parseOk).toBe(true)
      expect(collectedResults[2]!.event.uuid).toBe('uuid-0006')

      await reader.close()
    })

    it('모든 라인이 JSON.parse 실패인 경우에도 각 라인마다 parseOk=false 콜백이 전달된다', async () => {
      const lines = ['bad1', 'bad2', 'bad3']
      const chunk = Buffer.from(lines.join('\n') + '\n', 'utf8')

      const stream = new MockReadStream()
      const watcher = new MockFSWatcher()
      const fsAdapter = makeMockFsAdapter(chunk.length, stream)
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const reader = new TailReader('/test/session.jsonl', (result) => {
        collectedResults.push(result)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()
      watcher.triggerReady()
      emitAfterTick(stream, [chunk])
      await delay(50)

      expect(collectedResults).toHaveLength(3)
      expect(collectedResults.every(r => !r.parseOk)).toBe(true)
      expect(collectedResults.every(r => typeof r.parseError === 'string')).toBe(true)

      await reader.close()
    })

  })

  // ── 3. 빈 청크 / 부분 라인 처리 ────────────────────────────────────────
  describe('빈 청크 / 부분 라인 처리', () => {

    it('fileSize=0 → read skip, 콜백 0회', async () => {
      const stream = new MockReadStream()
      const watcher = new MockFSWatcher()
      const fsAdapter = makeMockFsAdapter(0, stream)
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const reader = new TailReader('/test/session.jsonl', (result) => {
        collectedResults.push(result)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()
      watcher.triggerReady()
      await delay(50)

      // fileSize=0이므로 createReadStream 호출 없음, 콜백 0회
      expect(collectedResults).toHaveLength(0)

      await reader.close()
    })

    it('개행 없이 끝나는 부분 라인 → 콜백 0회, partialLine에 보관됨', async () => {
      const partialContent = '{"type":"assistant","partial_incomplete":'
      const chunk = Buffer.from(partialContent, 'utf8')

      const stream = new MockReadStream()
      const watcher = new MockFSWatcher()
      const fsAdapter = makeMockFsAdapter(chunk.length, stream)
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const reader = new TailReader('/test/session.jsonl', (result) => {
        collectedResults.push(result)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()
      watcher.triggerReady()
      emitAfterTick(stream, [chunk])
      await delay(50)

      // 완성된 라인 없음 → 콜백 0회
      expect(collectedResults).toHaveLength(0)
      // partialLine에 보관됨
      expect(reader.partialLine).toBe(partialContent)

      await reader.close()
    })

    it('부분 라인 + 다음 청크에서 완성 → 두 번째 read 시 parseLine 결과가 콜백으로 전달됨', async () => {
      const line = makeJsonlLine('session-4', 'uuid-0007')
      const part1 = Buffer.from(line.slice(0, 20), 'utf8')
      const part2 = Buffer.from(line.slice(20) + '\n', 'utf8')
      const totalSize = part1.length + part2.length

      const stream1 = new MockReadStream()
      const stream2 = new MockReadStream()
      let readCount = 0

      const fsAdapter: FsAdapter = {
        stat: (_path: string) => {
          // 첫 번째 호출: 부분 라인 크기, 두 번째: 전체 크기
          if (readCount === 0) return Promise.resolve({ size: part1.length })
          return Promise.resolve({ size: totalSize })
        },
        createReadStream: (_path: string, _opts: { start: number; encoding: undefined }) => {
          readCount++
          return (readCount === 1 ? stream1 : stream2) as unknown as NodeJS.ReadableStream
        },
      }
      const watcher = new MockFSWatcher()
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const reader = new TailReader('/test/session.jsonl', (result) => {
        collectedResults.push(result)
      }, { fsAdapter, watcherFactory, usePolling: false, initialByteOffset: 0 })

      reader.start()

      // 첫 번째 read (ready): part1 (부분 라인)
      watcher.triggerReady()
      emitAfterTick(stream1, [part1])
      await delay(50)

      // 부분 라인만 있음 → 콜백 0회
      expect(collectedResults).toHaveLength(0)
      expect(reader.partialLine.length).toBeGreaterThan(0)

      // 두 번째 read (change): part2 (완성)
      watcher.triggerChange('/test/session.jsonl')
      emitAfterTick(stream2, [part2])
      await delay(50)

      // 완성된 라인 → ParseLineResult 1건
      expect(collectedResults).toHaveLength(1)
      expect(collectedResults[0]!.parseOk).toBe(true)
      expect(collectedResults[0]!.event.uuid).toBe('uuid-0007')

      await reader.close()
    })

  })

  // ── 4. 멀티 청크 경계 처리 ────────────────────────────────────────────
  describe('멀티 청크 경계 처리', () => {

    it('라인 경계에서 청크가 분리된 경우에도 올바르게 합산하여 ParseLineResult가 전달된다', async () => {
      const line1 = makeJsonlLine('session-5', 'uuid-0008')
      const line2 = makeJsonlLine('session-5', 'uuid-0009')

      const fullContent = line1 + '\n' + line2 + '\n'
      const fullBuf = Buffer.from(fullContent, 'utf8')
      const splitAt = Math.floor(fullBuf.length / 2)
      const chunk1 = fullBuf.subarray(0, splitAt)
      const chunk2 = fullBuf.subarray(splitAt)

      const stream = new MockReadStream()
      const watcher = new MockFSWatcher()
      const fsAdapter = makeMockFsAdapter(fullBuf.length, stream)
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const reader = new TailReader('/test/session.jsonl', (result) => {
        collectedResults.push(result)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()
      watcher.triggerReady()

      // 두 청크를 순서대로 같은 스트림에서 발송
      setImmediate(() => {
        stream.emit('data', chunk1)
        stream.emit('data', chunk2)
        stream.emit('end')
      })

      await delay(50)

      // 2개 라인이 올바르게 파싱됨
      expect(collectedResults).toHaveLength(2)
      expect(collectedResults[0]!.parseOk).toBe(true)
      expect(collectedResults[1]!.parseOk).toBe(true)
      expect(collectedResults[0]!.event.uuid).toBe('uuid-0008')
      expect(collectedResults[1]!.event.uuid).toBe('uuid-0009')

      await reader.close()
    })

    it('청크 경계가 JSON 키 중간에 있어도 올바르게 파싱된다', async () => {
      const line = makeJsonlLine('session-chunk', 'uuid-chunk-01')
      const lineBuf = Buffer.from(line + '\n', 'utf8')

      // 3개 청크로 분할 (JSON 내부에서 나뉨)
      const size = lineBuf.length
      const c1 = lineBuf.subarray(0, Math.floor(size / 3))
      const c2 = lineBuf.subarray(Math.floor(size / 3), Math.floor((size * 2) / 3))
      const c3 = lineBuf.subarray(Math.floor((size * 2) / 3))

      const stream = new MockReadStream()
      const watcher = new MockFSWatcher()
      const fsAdapter = makeMockFsAdapter(lineBuf.length, stream)
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const reader = new TailReader('/test/session.jsonl', (result) => {
        collectedResults.push(result)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()
      watcher.triggerReady()

      setImmediate(() => {
        stream.emit('data', c1)
        stream.emit('data', c2)
        stream.emit('data', c3)
        stream.emit('end')
      })

      await delay(50)

      // JSON 내부 청크 경계에도 올바르게 파싱됨
      expect(collectedResults).toHaveLength(1)
      expect(collectedResults[0]!.parseOk).toBe(true)
      expect(collectedResults[0]!.event.uuid).toBe('uuid-chunk-01')

      await reader.close()
    })

  })

  // ── 5. byteOffset 정확성 ────────────────────────────────────────────────
  describe('byteOffset 정확성', () => {

    it('각 라인의 콜백 byteOffset이 파일 내 시작 위치와 일치한다', async () => {
      const line1 = makeJsonlLine('session-6', 'uuid-0010')
      const line2 = makeJsonlLine('session-6', 'uuid-0011')

      const buf1 = Buffer.from(line1 + '\n', 'utf8')
      const buf2 = Buffer.from(line2 + '\n', 'utf8')
      const fullBuf = Buffer.concat([buf1, buf2])

      const stream = new MockReadStream()
      const watcher = new MockFSWatcher()
      const fsAdapter = makeMockFsAdapter(fullBuf.length, stream)
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedOffsets: number[] = []
      const reader = new TailReader('/test/session.jsonl', (_result, byteOffset) => {
        collectedOffsets.push(byteOffset)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()
      watcher.triggerReady()
      emitAfterTick(stream, [fullBuf])
      await delay(50)

      // 라인 1 offset=0, 라인 2 offset=buf1.length
      expect(collectedOffsets).toHaveLength(2)
      expect(collectedOffsets[0]).toBe(0)
      expect(collectedOffsets[1]).toBe(buf1.length)

      await reader.close()
    })

    it('initialByteOffset이 설정된 경우 콜백 byteOffset이 초기값부터 시작한다', async () => {
      const line = makeJsonlLine('session-7', 'uuid-0012')
      const lineBuf = Buffer.from(line + '\n', 'utf8')
      const initialOffset = 500

      const stream = new MockReadStream()
      const watcher = new MockFSWatcher()
      const fsAdapter: FsAdapter = {
        stat: (_path: string) => Promise.resolve({ size: initialOffset + lineBuf.length }),
        createReadStream: (_path: string, _opts: { start: number; encoding: undefined }) =>
          stream as unknown as NodeJS.ReadableStream,
      }
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedOffsets: number[] = []
      const reader = new TailReader('/test/session.jsonl', (_result, byteOffset) => {
        collectedOffsets.push(byteOffset)
      }, { fsAdapter, watcherFactory, usePolling: false, initialByteOffset: initialOffset })

      reader.start()
      watcher.triggerReady()
      emitAfterTick(stream, [lineBuf])
      await delay(50)

      // byteOffset은 initialOffset부터 시작
      expect(collectedOffsets).toHaveLength(1)
      expect(collectedOffsets[0]).toBe(initialOffset)

      await reader.close()
    })

    it('증분 읽기 후 reader.byteOffset이 완결 라인까지만 전진한다', async () => {
      const line = makeJsonlLine('session-offset', 'uuid-offset-01')
      const lineBuf = Buffer.from(line + '\n', 'utf8')
      const partialContent = '{"partial":'
      const partialBuf = Buffer.from(partialContent, 'utf8')
      const fullBuf = Buffer.concat([lineBuf, partialBuf])

      const stream = new MockReadStream()
      const watcher = new MockFSWatcher()
      const fsAdapter = makeMockFsAdapter(fullBuf.length, stream)
      const watcherFactory = makeMockWatcherFactory(watcher)

      const reader = new TailReader('/test/session.jsonl', () => undefined, {
        fsAdapter, watcherFactory, usePolling: false,
      })

      reader.start()
      watcher.triggerReady()
      emitAfterTick(stream, [fullBuf])
      await delay(50)

      // byteOffset은 완결 라인(lineBuf)까지만 전진, partialBuf 바이트는 미포함
      expect(reader.byteOffset).toBe(lineBuf.length)
      // partialLine에 미완성 부분 보관
      expect(reader.partialLine).toBe(partialContent)

      await reader.close()
    })

  })

  // ── 6. 'change' 이벤트 트리거 → 증분 읽기 ────────────────────────────
  describe("'change' 이벤트 트리거 → 증분 읽기", () => {

    it("'change' 이벤트가 발생하면 이전 오프셋 이후의 새 라인만 콜백으로 전달된다", async () => {
      const line1 = makeJsonlLine('session-8', 'uuid-0013')
      const line2 = makeJsonlLine('session-8', 'uuid-0014')
      const buf1 = Buffer.from(line1 + '\n', 'utf8')
      const buf2 = Buffer.from(line2 + '\n', 'utf8')

      const stream1 = new MockReadStream()
      const stream2 = new MockReadStream()
      let callIdx = 0

      const fsAdapter: FsAdapter = {
        stat: (_path: string) => {
          if (callIdx === 0) return Promise.resolve({ size: buf1.length })
          return Promise.resolve({ size: buf1.length + buf2.length })
        },
        createReadStream: (_path: string, _opts: { start: number; encoding: undefined }) => {
          callIdx++
          return (callIdx === 1 ? stream1 : stream2) as unknown as NodeJS.ReadableStream
        },
      }
      const watcher = new MockFSWatcher()
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const reader = new TailReader('/test/session.jsonl', (result) => {
        collectedResults.push(result)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()

      // 첫 번째 read (ready): line1만
      watcher.triggerReady()
      emitAfterTick(stream1, [buf1])
      await delay(50)

      expect(collectedResults).toHaveLength(1)
      expect(collectedResults[0]!.event.uuid).toBe('uuid-0013')

      // 두 번째 read (change): line2만 (오프셋 이후)
      watcher.triggerChange('/test/session.jsonl')
      emitAfterTick(stream2, [buf2])
      await delay(50)

      expect(collectedResults).toHaveLength(2)
      expect(collectedResults[1]!.event.uuid).toBe('uuid-0014')

      await reader.close()
    })

    it('연속 change 이벤트에서 각 증분 chunk가 순서대로 parseLine 결과를 콜백에 전달한다', async () => {
      const lines = Array.from({ length: 4 }, (_, i) =>
        makeJsonlLine('session-9', `uuid-seq-${String(i).padStart(4, '0')}`)
      )
      const bufs = lines.map(l => Buffer.from(l + '\n', 'utf8'))
      const sizes = bufs.reduce<number[]>((acc, buf) => {
        acc.push((acc[acc.length - 1] ?? 0) + buf.length)
        return acc
      }, [])

      const streams = bufs.map(() => new MockReadStream())
      let callIdx = 0

      const fsAdapter: FsAdapter = {
        stat: (_path: string) => Promise.resolve({ size: sizes[callIdx] ?? 0 }),
        createReadStream: (_path: string, _opts: { start: number; encoding: undefined }) => {
          const s = streams[callIdx]!
          return s as unknown as NodeJS.ReadableStream
        },
      }
      const watcher = new MockFSWatcher()
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const reader = new TailReader('/test/session.jsonl', (result) => {
        collectedResults.push(result)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()

      // 각 change 이벤트마다 1개 라인씩 발송
      for (let i = 0; i < lines.length; i++) {
        if (i === 0) {
          watcher.triggerReady()
        } else {
          watcher.triggerChange('/test/session.jsonl')
        }
        const stream = streams[i]!
        emitAfterTick(stream, [bufs[i]!])
        await delay(50)
        callIdx++
      }

      // 4개 라인 순서대로 콜백
      expect(collectedResults).toHaveLength(4)
      for (let i = 0; i < 4; i++) {
        expect(collectedResults[i]!.parseOk).toBe(true)
        expect(collectedResults[i]!.event.uuid).toBe(
          `uuid-seq-${String(i).padStart(4, '0')}`
        )
      }

      await reader.close()
    })

  })

  // ── 7. closed 상태에서 읽기 방지 ─────────────────────────────────────
  describe('closed 상태', () => {

    it('close() 후 change 이벤트가 발생해도 콜백이 추가로 호출되지 않는다', async () => {
      const line = makeJsonlLine('session-closed', 'uuid-closed-01')
      const lineBuf = Buffer.from(line + '\n', 'utf8')

      const stream1 = new MockReadStream()
      const stream2 = new MockReadStream()
      let callIdx = 0

      const fsAdapter: FsAdapter = {
        stat: (_path: string) => Promise.resolve({ size: lineBuf.length }),
        createReadStream: (_path: string, _opts: { start: number; encoding: undefined }) => {
          callIdx++
          return (callIdx === 1 ? stream1 : stream2) as unknown as NodeJS.ReadableStream
        },
      }
      const watcher = new MockFSWatcher()
      const watcherFactory = makeMockWatcherFactory(watcher)

      const collectedResults: ParseLineResult[] = []
      const reader = new TailReader('/test/session.jsonl', (result) => {
        collectedResults.push(result)
      }, { fsAdapter, watcherFactory, usePolling: false })

      reader.start()
      watcher.triggerReady()
      emitAfterTick(stream1, [lineBuf])
      await delay(50)

      // 첫 번째 read 완료
      expect(collectedResults).toHaveLength(1)

      // close 후 change 이벤트 → 읽기 방지
      await reader.close()

      // close 후 change를 직접 트리거해봐도 추가 콜백 없음
      watcher.triggerChange('/test/session.jsonl')
      await delay(50)

      expect(collectedResults).toHaveLength(1)
    })

  })

})
