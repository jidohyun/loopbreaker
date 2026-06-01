/**
 * open-file-at-offset.test.ts
 *
 * openFileAtOffset 함수 단위 테스트.
 *
 * 검증 항목:
 *   - 정상: 오프셋 0에서 전체 파일 스트림 반환
 *   - 정상: 중간 오프셋에서 스트림 반환 (오프셋 이후 데이터만 읽힘)
 *   - 정상: 오프셋 === 파일 크기 (EOF 위치) → 빈 스트림 허용
 *   - 에러: 오프셋 > 파일 크기 → OffsetExceedsFileSizeError
 *   - 에러: 존재하지 않는 파일 → FileNotFoundError
 *   - 에러: 입력 검증 실패 (음수 오프셋, 빈 경로)
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from '@jest/globals'
import { ZodError } from 'zod'
import {
  FileNotFoundError,
  OffsetExceedsFileSizeError,
  openFileAtOffset,
} from '../src/ingest/open-file-at-offset.js'

// ---- 헬퍼 ----

/** 임시 파일에 내용을 쓰고 경로를 반환한다 */
function writeTempFile(content: string): string {
  const tmpDir = os.tmpdir()
  const filePath = path.join(tmpDir, `loopbreaker-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}

/** ReadStream에서 모든 데이터를 읽어 Buffer로 반환한다 */
function readStreamToBuffer(stream: fs.ReadStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

// ---- 테스트 ----

describe('openFileAtOffset', () => {
  const tmpFiles: string[] = []

  function createTempFile(content: string): string {
    const p = writeTempFile(content)
    tmpFiles.push(p)
    return p
  }

  afterEach(() => {
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f) } catch { /* ignore */ }
    }
    tmpFiles.length = 0
  })

  // ---- 정상 케이스 ----

  it('오프셋 0에서 파일 전체를 읽는다', async () => {
    const content = '{"type":"say","uuid":"abc"}\n{"type":"tool_use","uuid":"def"}\n'
    const filePath = createTempFile(content)

    const stream = openFileAtOffset(filePath, 0)
    const buf = await readStreamToBuffer(stream)

    expect(buf.toString('utf8')).toBe(content)
  })

  it('중간 오프셋에서 시작하면 오프셋 이후 데이터만 읽힌다', async () => {
    const line1 = '{"type":"say","uuid":"aaa"}\n'
    const line2 = '{"type":"tool_use","uuid":"bbb"}\n'
    const content = line1 + line2
    const filePath = createTempFile(content)

    const offset = Buffer.byteLength(line1, 'utf8')
    const stream = openFileAtOffset(filePath, offset)
    const buf = await readStreamToBuffer(stream)

    expect(buf.toString('utf8')).toBe(line2)
  })

  it('오프셋이 파일 크기와 같으면 빈 스트림을 반환한다 (EOF tail 허용)', async () => {
    const content = 'hello'
    const filePath = createTempFile(content)
    const fileSize = Buffer.byteLength(content, 'utf8')

    const stream = openFileAtOffset(filePath, fileSize)
    const buf = await readStreamToBuffer(stream)

    expect(buf.length).toBe(0)
  })

  it('반환값은 fs.ReadStream 인스턴스이다', async () => {
    const filePath = createTempFile('data')
    const stream = openFileAtOffset(filePath, 0)
    expect(stream).toBeInstanceOf(fs.ReadStream)
    // destroy()가 완전히 완료될 때까지 기다려 dangling open을 방지
    await new Promise<void>((resolve) => {
      stream.destroy()
      stream.on('close', resolve)
      stream.on('error', () => resolve()) // 에러도 close로 이어지므로 안전
    })
  })

  // ---- 에러 케이스 ----

  it('오프셋이 파일 크기를 초과하면 OffsetExceedsFileSizeError를 던진다', () => {
    const content = 'hello'
    const filePath = createTempFile(content)
    const fileSize = Buffer.byteLength(content, 'utf8')

    expect(() => openFileAtOffset(filePath, fileSize + 1)).toThrow(OffsetExceedsFileSizeError)
  })

  it('OffsetExceedsFileSizeError에 filePath/byteOffset/fileSize가 포함된다', () => {
    const content = 'hello'
    const filePath = createTempFile(content)
    const fileSize = Buffer.byteLength(content, 'utf8')
    const badOffset = fileSize + 100

    let err: OffsetExceedsFileSizeError | undefined
    try {
      openFileAtOffset(filePath, badOffset)
    } catch (e) {
      if (e instanceof OffsetExceedsFileSizeError) err = e
    }

    expect(err).toBeDefined()
    expect(err!.filePath).toBe(filePath)
    expect(err!.byteOffset).toBe(badOffset)
    expect(err!.fileSize).toBe(fileSize)
    expect(err!.name).toBe('OffsetExceedsFileSizeError')
    expect(err!.message).toContain(String(badOffset))
    expect(err!.message).toContain(String(fileSize))
  })

  it('존재하지 않는 파일이면 FileNotFoundError를 던진다', () => {
    const nonExistent = '/tmp/__loopbreaker_nonexistent_file_xyz__.jsonl'
    expect(() => openFileAtOffset(nonExistent, 0)).toThrow(FileNotFoundError)
  })

  it('FileNotFoundError에 filePath가 포함된다', () => {
    const nonExistent = '/tmp/__loopbreaker_nonexistent_file_xyz__.jsonl'
    let err: FileNotFoundError | undefined
    try {
      openFileAtOffset(nonExistent, 0)
    } catch (e) {
      if (e instanceof FileNotFoundError) err = e
    }
    expect(err).toBeDefined()
    expect(err!.filePath).toBe(nonExistent)
    expect(err!.name).toBe('FileNotFoundError')
  })

  it('음수 오프셋이면 ZodError를 던진다', () => {
    const filePath = createTempFile('data')
    expect(() => openFileAtOffset(filePath, -1)).toThrow(ZodError)
  })

  it('빈 filePath이면 ZodError를 던진다', () => {
    expect(() => openFileAtOffset('', 0)).toThrow(ZodError)
  })

  it('소수점 오프셋이면 ZodError를 던진다', () => {
    const filePath = createTempFile('data')
    expect(() => openFileAtOffset(filePath, 1.5)).toThrow(ZodError)
  })

  // ---- 바이트 오프셋 정확도 ----

  it('멀티바이트 문자(UTF-8)를 포함한 파일에서 바이트 오프셋이 정확히 동작한다', async () => {
    // 한글 3바이트/글자 — 파일 생성 후 스트림 소비를 완료한 뒤 cleanup
    const line1 = '{"text":"안녕"}\n'   // UTF-8: 각 한글 3바이트 = 12 + 기타
    const line2 = '{"text":"world"}\n'
    const content = line1 + line2

    // 직접 파일 생성 및 cleanup (공유 tmpFiles 배열과 경쟁을 완전히 피함)
    const tmpDir = os.tmpdir()
    const filePath = path.join(tmpDir, `lb-utf8-${Date.now()}.jsonl`)
    fs.writeFileSync(filePath, content, 'utf8')

    try {
      const offset = Buffer.byteLength(line1, 'utf8')
      const buf = await readStreamToBuffer(openFileAtOffset(filePath, offset))
      expect(buf.toString('utf8')).toBe(line2)
    } finally {
      try { fs.unlinkSync(filePath) } catch { /* ignore */ }
    }
  })

  it('큰 오프셋(파일 크기 - 1)에서 마지막 바이트만 읽는다', async () => {
    const content = 'ABCDE'
    const filePath = createTempFile(content)
    const fileSize = Buffer.byteLength(content, 'utf8')

    const stream = openFileAtOffset(filePath, fileSize - 1)
    const buf = await readStreamToBuffer(stream)

    expect(buf.toString('utf8')).toBe('E')
  })
})
