/**
 * tests/tail-reader-rotation.test.ts
 *
 * Sub-AC 5d-4: 파일 교체(로테이션) 감지 및 오프셋 리셋
 *
 * 검증 항목:
 *   - 파일 크기가 현재 오프셋보다 작아진 경우를 로테이션으로 판단
 *   - 로테이션 감지 시 byteOffset을 0으로 리셋
 *   - 로테이션 감지 시 partialLine 버퍼도 초기화
 *   - 리셋 후 처음부터 재파싱 (createReadStream start:0)
 *   - 로테이션 후 새 데이터가 콜백으로 방출됨
 *   - 파일 크기 == byteOffset이면 로테이션이 아님 (no-op)
 *   - 파일 크기 > byteOffset이면 로테이션이 아님 (정상 증분)
 *   - 완전히 비어진 파일(size=0)도 로테이션으로 처리
 *   - 로테이션 감지 후 연속 읽기에서 다시 정상 증분이 이뤄짐
 *   - partialLine이 있는 상태에서 로테이션 발생 시 stale 데이터 제거
 *
 * 전략: TailReaderOptions.fsAdapter 주입으로 실제 파일시스템 없이 mock fs로 테스트.
 *
 * 타이밍 원칙:
 *   _readIncremental()은 await stat() 이후 createReadStream()을 호출하므로
 *   스트림 리스너 등록 시점은 마이크로태스크 이후다.
 *   emitAfterTick()으로 setImmediate 이후에 data+end를 발송해야 한다.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { EventEmitter } from 'node:events'
import type { FSWatcher } from 'chokidar'
import { TailReader } from '../src/ingest/tail-reader.js'
import type { FsAdapter, WatcherFactory } from '../src/ingest/tail-reader.js'
import type { ParseLineResult } from '../src/ingest/parser.js'

// ── Mock 헬퍼 ──────────────────────────────────────────────────────────────

/**
 * Mock ReadStream — EventEmitter 기반.
 * TailReader 내부의 createReadStream() 반환값을 대체한다.
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

/** 최소 MockFSWatcher — chokidar 없이 WatcherFactory 주입용 */
class MockFSWatcher extends EventEmitter {
  async close(): Promise<void> {}
}

/** noop WatcherFactory 생성 헬퍼 */
function createNoopWatcherFactory(): WatcherFactory {
  return (_path, _opts) => new MockFSWatcher() as unknown as FSWatcher
}

/**
 * FsAdapter + MockReadStream 픽스처를 생성한다.
 *
 * @param fileSize 파일 크기(bytes). 'ENOENT'이면 stat()이 reject된다.
 */
function createMockFs(
  fileSize: number | 'ENOENT',
): { adapter: FsAdapter; stream: MockReadStream } {
  const stream = new MockReadStream()

  const adapter: FsAdapter = {
    stat: jest.fn<FsAdapter['stat']>().mockImplementation(() => {
      if (typeof fileSize === 'string') {
        const err = Object.assign(new Error(`${fileSize}: no such file`), { code: fileSize })
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
 * 전부 소진 뒤 실행되므로 리스너가 안전하게 붙어 있다.
 */
function emitAfterTick(stream: MockReadStream, chunks: Buffer[]): void {
  setImmediate(() => stream.emitData(chunks))
}

/**
 * TailReader private _readIncremental()을 직접 호출한다.
 * TypeScript private 접근 제한을 테스트 목적으로 우회한다.
 */
function callReadIncremental(reader: TailReader): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (reader as any)._readIncremental()
}

/** TailReader 기본 생성 헬퍼 */
function makeReader(
  adapter: FsAdapter,
  cb: (r: ParseLineResult, o: number) => void,
  initialByteOffset = 0,
): TailReader {
  return new TailReader('/tmp/rotation-test.jsonl', cb, {
    watcherFactory: createNoopWatcherFactory(),
    fsAdapter: adapter,
    initialByteOffset,
    usePolling: false,
  })
}

// ── 테스트 ────────────────────────────────────────────────────────────────

describe('TailReader 파일 로테이션 감지 및 오프셋 리셋 (Sub-AC 5d-4)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ────────────────────────────────────────────────────────────────────────
  // 1. 로테이션 감지 조건: fileSize < byteOffset
  // ────────────────────────────────────────────────────────────────────────

  describe('로테이션 감지 조건 (fileSize < byteOffset)', () => {
    it('파일 크기가 현재 오프셋보다 작으면 로테이션으로 판단하고 byteOffset을 0으로 리셋한다', async () => {
      const oldOffset = 500
      const newContent = '{"type":"user","uuid":"after-rotation"}\n'
      const newContentLen = Buffer.byteLength(newContent, 'utf8')
      // newFileSize가 oldOffset보다 작아야 로테이션 조건 충족
      // 실제 스트림에서 읽히는 바이트는 newContent 길이와 같아야 함
      const newFileSize = newContentLen  // stat이 보고하는 크기 = 실제 내용 크기

      const { adapter, stream } = createMockFs(newFileSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(adapter, cb, oldOffset)

      expect(reader.byteOffset).toBe(oldOffset)

      emitAfterTick(stream, [Buffer.from(newContent, 'utf8')])
      await callReadIncremental(reader)

      // 로테이션 후 byteOffset이 0에서 재개되어 새 파일 내용만큼 전진
      expect(reader.byteOffset).toBe(newContentLen)
    })

    it('로테이션 감지 후 createReadStream은 start:0으로 호출된다', async () => {
      const oldOffset = 1000
      const newFileSize = 50

      const { adapter, stream } = createMockFs(newFileSize)
      const cb = jest.fn()
      const reader = makeReader(adapter, cb, oldOffset)

      emitAfterTick(stream, [Buffer.from('{"type":"system"}\n', 'utf8')])
      await callReadIncremental(reader)

      expect(adapter.createReadStream).toHaveBeenCalledWith(
        '/tmp/rotation-test.jsonl',
        expect.objectContaining({ start: 0 }),
      )
    })

    it('완전히 비어진 파일(size=0)도 로테이션으로 처리한다', async () => {
      const oldOffset = 300
      const newFileSize = 0  // 완전 빈 파일

      const { adapter } = createMockFs(newFileSize)
      const cb = jest.fn()
      const reader = makeReader(adapter, cb, oldOffset)

      await callReadIncremental(reader)

      // size=0이면 리셋 후 EOF와 같으므로 createReadStream은 호출되지 않음
      expect(reader.byteOffset).toBe(0)
      expect(adapter.createReadStream).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 2. 로테이션 시 partialLine 버퍼 초기화
  // ────────────────────────────────────────────────────────────────────────

  describe('로테이션 시 partialLine 버퍼 초기화', () => {
    it('로테이션 발생 시 기존 partialLine이 초기화된다', async () => {
      const oldOffset = 500
      const newFileSize = 80

      const { adapter, stream } = createMockFs(newFileSize)
      const cb = jest.fn()
      const reader = makeReader(adapter, cb, oldOffset)

      // 이전 읽기에서 남은 stale partialLine 주입
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(reader as any)._partialLine = '{"type":"user","uuid":"stale-partial"'

      expect(reader.partialLine).toBe('{"type":"user","uuid":"stale-partial"')

      emitAfterTick(stream, [Buffer.from('{"type":"system","uuid":"fresh"}\n', 'utf8')])
      await callReadIncremental(reader)

      // 로테이션 후 partialLine이 초기화되어 빈 문자열
      expect(reader.partialLine).toBe('')
    })

    it('partialLine이 빈 상태에서 로테이션 발생해도 안전하다', async () => {
      const oldOffset = 200
      const newContent = '{"type":"user","uuid":"clean"}\n'
      const newContentLen = Buffer.byteLength(newContent, 'utf8')
      // stat이 보고하는 크기와 실제 스트림 내용 길이를 맞춤
      const newFileSize = newContentLen

      const { adapter, stream } = createMockFs(newFileSize)
      const cb = jest.fn()
      const reader = makeReader(adapter, cb, oldOffset)

      expect(reader.partialLine).toBe('')

      emitAfterTick(stream, [Buffer.from(newContent, 'utf8')])
      await callReadIncremental(reader)

      expect(reader.partialLine).toBe('')
      expect(reader.byteOffset).toBe(newContentLen)
    })

    it('로테이션 후 stale partialLine이 새 파일 내용과 합산되지 않는다', async () => {
      const stalePart = '{"type":"user","uuid":"stale-will-corrupt"'
      const newLine = '{"type":"assistant","uuid":"new-valid"}\n'
      const newFileSize = Buffer.byteLength(newLine, 'utf8')

      const { adapter, stream } = createMockFs(newFileSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(adapter, cb, 500)  // 이전에 더 많이 읽었음

      // stale partialLine 주입
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(reader as any)._partialLine = stalePart

      emitAfterTick(stream, [Buffer.from(newLine, 'utf8')])
      await callReadIncremental(reader)

      // stale partial이 아닌 새 파일 내용만 파싱되어야 함
      expect(cb).toHaveBeenCalledTimes(1)
      const [result] = cb.mock.calls[0] as [ParseLineResult, number]
      expect(result.parseOk).toBe(true)
      expect(result.event.uuid).toBe('new-valid')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 3. 로테이션이 아닌 경우 (정상 증분 / no-op)
  // ────────────────────────────────────────────────────────────────────────

  describe('로테이션이 아닌 경우', () => {
    it('파일 크기 == byteOffset이면 로테이션이 아니며 byteOffset은 그대로 유지된다', async () => {
      const offset = 200
      const { adapter } = createMockFs(offset)
      const cb = jest.fn()
      const reader = makeReader(adapter, cb, offset)

      await callReadIncremental(reader)

      expect(reader.byteOffset).toBe(offset)
      expect(adapter.createReadStream).not.toHaveBeenCalled()
    })

    it('파일 크기 > byteOffset이면 로테이션이 아니며 start:byteOffset으로 증분 읽기한다', async () => {
      const currentOffset = 100
      const newLine = '{"type":"user","uuid":"normal-increment"}\n'
      const totalSize = currentOffset + Buffer.byteLength(newLine, 'utf8')

      const { adapter, stream } = createMockFs(totalSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(adapter, cb, currentOffset)

      emitAfterTick(stream, [Buffer.from(newLine, 'utf8')])
      await callReadIncremental(reader)

      // 정상 증분 읽기: start는 currentOffset
      expect(adapter.createReadStream).toHaveBeenCalledWith(
        '/tmp/rotation-test.jsonl',
        expect.objectContaining({ start: currentOffset }),
      )
      expect(reader.byteOffset).toBe(totalSize)
    })

    it('파일 크기가 1바이트라도 byteOffset보다 크면 로테이션으로 처리하지 않는다', async () => {
      const currentOffset = 50
      const fileSize = 51  // 1 byte 더 큼

      const { adapter, stream } = createMockFs(fileSize)
      const cb = jest.fn()
      const reader = makeReader(adapter, cb, currentOffset)

      emitAfterTick(stream, [Buffer.from('\n', 'utf8')])
      await callReadIncremental(reader)

      expect(adapter.createReadStream).toHaveBeenCalledWith(
        '/tmp/rotation-test.jsonl',
        expect.objectContaining({ start: currentOffset }),
      )
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 4. 로테이션 후 재파싱 및 콜백 방출
  // ────────────────────────────────────────────────────────────────────────

  describe('로테이션 후 처음부터 재파싱 및 콜백 방출', () => {
    it('로테이션 후 새 파일 내용이 콜백으로 방출된다', async () => {
      const oldOffset = 500
      const newContent = '{"type":"user","uuid":"rotated-content"}\n'
      const newFileSize = Buffer.byteLength(newContent, 'utf8')

      const { adapter, stream } = createMockFs(newFileSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(adapter, cb, oldOffset)

      emitAfterTick(stream, [Buffer.from(newContent, 'utf8')])
      await callReadIncremental(reader)

      expect(cb).toHaveBeenCalledTimes(1)
      const [result] = cb.mock.calls[0] as [ParseLineResult, number]
      expect(result.parseOk).toBe(true)
      expect(result.event.uuid).toBe('rotated-content')
    })

    it('로테이션 후 여러 라인이 처음부터 모두 파싱된다', async () => {
      const oldOffset = 1000
      const line1 = '{"type":"user","uuid":"new1"}\n'
      const line2 = '{"type":"assistant","uuid":"new2"}\n'
      const newContent = line1 + line2
      const newFileSize = Buffer.byteLength(newContent, 'utf8')

      const { adapter, stream } = createMockFs(newFileSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(adapter, cb, oldOffset)

      emitAfterTick(stream, [Buffer.from(newContent, 'utf8')])
      await callReadIncremental(reader)

      expect(cb).toHaveBeenCalledTimes(2)
      const uuids = (cb.mock.calls as [ParseLineResult, number][]).map(([r]) => r.event.uuid)
      expect(uuids).toEqual(['new1', 'new2'])
      expect(reader.byteOffset).toBe(newFileSize)
    })

    it('로테이션 후 첫 번째 라인 콜백에 byteOffset=0이 전달된다', async () => {
      const oldOffset = 999
      const line = '{"type":"system","uuid":"s1"}\n'
      const newFileSize = Buffer.byteLength(line, 'utf8')

      const { adapter, stream } = createMockFs(newFileSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(adapter, cb, oldOffset)

      emitAfterTick(stream, [Buffer.from(line, 'utf8')])
      await callReadIncremental(reader)

      const [, offset] = cb.mock.calls[0] as [ParseLineResult, number]
      expect(offset).toBe(0)
    })

    it('로테이션 후 파싱 실패 라인도 parseOk=false로 처리하고 계속 진행한다', async () => {
      const oldOffset = 700
      const badLine = 'INVALID_JSON_AFTER_ROTATION\n'
      const goodLine = '{"type":"user","uuid":"ok-after-bad"}\n'
      const newContent = badLine + goodLine
      const newFileSize = Buffer.byteLength(newContent, 'utf8')

      const { adapter, stream } = createMockFs(newFileSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(adapter, cb, oldOffset)

      emitAfterTick(stream, [Buffer.from(newContent, 'utf8')])
      await callReadIncremental(reader)

      expect(cb).toHaveBeenCalledTimes(2)
      const [r1] = cb.mock.calls[0] as [ParseLineResult, number]
      const [r2] = cb.mock.calls[1] as [ParseLineResult, number]
      expect(r1.parseOk).toBe(false)
      expect(r2.parseOk).toBe(true)
      expect(r2.event.uuid).toBe('ok-after-bad')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 5. 로테이션 후 연속 증분 읽기
  // ────────────────────────────────────────────────────────────────────────

  describe('로테이션 후 연속 증분 읽기', () => {
    it('로테이션 후 다음 읽기는 이전 로테이션 오프셋 끝에서 시작한다', async () => {
      const oldOffset = 800
      const firstNewLine = '{"type":"user","uuid":"r1"}\n'
      const secondNewLine = '{"type":"assistant","uuid":"r2"}\n'
      const len1 = Buffer.byteLength(firstNewLine, 'utf8')
      const len2 = Buffer.byteLength(secondNewLine, 'utf8')

      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()

      // 1차 읽기: 로테이션 발생 (oldOffset=800 > len1)
      const mock1 = createMockFs(len1)
      const reader = makeReader(mock1.adapter, cb, oldOffset)

      emitAfterTick(mock1.stream, [Buffer.from(firstNewLine, 'utf8')])
      await callReadIncremental(reader)

      expect(reader.byteOffset).toBe(len1)

      // 2차 읽기: 정상 증분 (파일에 line2 추가)
      const mock2 = createMockFs(len1 + len2)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(reader as any)._fsAdapter = mock2.adapter

      emitAfterTick(mock2.stream, [Buffer.from(secondNewLine, 'utf8')])
      await callReadIncremental(reader)

      // 2차 읽기는 로테이션 없이 정상 증분으로 start:len1에서 시작
      expect(mock2.adapter.createReadStream).toHaveBeenCalledWith(
        '/tmp/rotation-test.jsonl',
        expect.objectContaining({ start: len1 }),
      )
      expect(cb).toHaveBeenCalledTimes(2)
      expect(reader.byteOffset).toBe(len1 + len2)
    })

    it('로테이션이 두 번 연속 발생해도 각각 올바르게 처리한다', async () => {
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()

      const line1 = '{"type":"user","uuid":"rot1"}\n'
      const len1 = Buffer.byteLength(line1, 'utf8')

      // 1차: 초기 오프셋 1000에서 len1 크기 파일 → 로테이션
      const mock1 = createMockFs(len1)
      const reader = makeReader(mock1.adapter, cb, 1000)

      emitAfterTick(mock1.stream, [Buffer.from(line1, 'utf8')])
      await callReadIncremental(reader)

      expect(reader.byteOffset).toBe(len1)

      // 2차: 오프셋 len1에서 더 작은 크기 파일 → 재로테이션
      const line2 = '{"type":"assistant","uuid":"rot2"}\n'
      const len2 = Buffer.byteLength(line2, 'utf8')
      // len2 < len1이므로 로테이션
      if (len2 < len1) {
        const mock2 = createMockFs(len2)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(reader as any)._fsAdapter = mock2.adapter

        emitAfterTick(mock2.stream, [Buffer.from(line2, 'utf8')])
        await callReadIncremental(reader)

        expect(mock2.adapter.createReadStream).toHaveBeenCalledWith(
          '/tmp/rotation-test.jsonl',
          expect.objectContaining({ start: 0 }),
        )
        expect(reader.byteOffset).toBe(len2)
      }
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 6. byteOffset 리셋 정확성
  // ────────────────────────────────────────────────────────────────────────

  describe('byteOffset 리셋 정확성', () => {
    it('로테이션 후 byteOffset은 새 파일의 읽은 완성 바이트 수와 일치한다', async () => {
      const oldOffset = 9999
      const newLine = '{"type":"user","uuid":"precise-offset"}\n'
      const expectedOffset = Buffer.byteLength(newLine, 'utf8')

      const { adapter, stream } = createMockFs(expectedOffset)
      const cb = jest.fn()
      const reader = makeReader(adapter, cb, oldOffset)

      emitAfterTick(stream, [Buffer.from(newLine, 'utf8')])
      await callReadIncremental(reader)

      expect(reader.byteOffset).toBe(expectedOffset)
    })

    it('로테이션 후 미완성 partial 라인이 있으면 byteOffset은 완성 부분만 전진한다', async () => {
      const oldOffset = 500
      const completeLine = '{"type":"user","uuid":"complete"}\n'
      const partialData = '{"type":"assistant","uuid":"partial"'
      const newContent = completeLine + partialData
      const completeLen = Buffer.byteLength(completeLine, 'utf8')
      const newFileSize = Buffer.byteLength(newContent, 'utf8')

      const { adapter, stream } = createMockFs(newFileSize)
      const cb = jest.fn()
      const reader = makeReader(adapter, cb, oldOffset)

      // stale partial 있는 상태에서 로테이션
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(reader as any)._partialLine = 'stale'

      emitAfterTick(stream, [Buffer.from(newContent, 'utf8')])
      await callReadIncremental(reader)

      // byteOffset은 완성 라인만큼만 전진 (partial 제외)
      expect(reader.byteOffset).toBe(completeLen)
      // 새 partialLine은 rotationless 상태에서 파싱된 값
      expect(reader.partialLine).toBe(partialData)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 7. 경계 케이스: byteOffset=0에서 fileSize=0
  // ────────────────────────────────────────────────────────────────────────

  describe('경계 케이스', () => {
    it('byteOffset=0이고 fileSize=0이면 로테이션 없이 no-op 처리된다', async () => {
      const { adapter } = createMockFs(0)
      const cb = jest.fn()
      const reader = makeReader(adapter, cb, 0)

      await callReadIncremental(reader)

      expect(reader.byteOffset).toBe(0)
      expect(adapter.createReadStream).not.toHaveBeenCalled()
      expect(cb).not.toHaveBeenCalled()
    })

    it('byteOffset=1이고 fileSize=0이면 로테이션으로 처리하고 byteOffset을 0으로 리셋한다', async () => {
      const { adapter } = createMockFs(0)
      const cb = jest.fn()
      const reader = makeReader(adapter, cb, 1)

      await callReadIncremental(reader)

      // 리셋 후 size=0이므로 EOF → createReadStream 호출 없음
      expect(reader.byteOffset).toBe(0)
      expect(adapter.createReadStream).not.toHaveBeenCalled()
    })

    it('매우 큰 byteOffset에서 매우 작은 파일로 로테이션해도 정확히 처리된다', async () => {
      const hugeOffset = Number.MAX_SAFE_INTEGER - 1
      const newLine = '{"type":"user","uuid":"huge-rotation"}\n'
      const newFileSize = Buffer.byteLength(newLine, 'utf8')

      const { adapter, stream } = createMockFs(newFileSize)
      const cb = jest.fn<(r: ParseLineResult, o: number) => void>()
      const reader = makeReader(adapter, cb, hugeOffset)

      emitAfterTick(stream, [Buffer.from(newLine, 'utf8')])
      await callReadIncremental(reader)

      expect(reader.byteOffset).toBe(newFileSize)
      expect(adapter.createReadStream).toHaveBeenCalledWith(
        '/tmp/rotation-test.jsonl',
        expect.objectContaining({ start: 0 }),
      )
    })
  })
})
