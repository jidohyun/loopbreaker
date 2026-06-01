/**
 * open-file-at-offset.ts — 바이트 오프셋 기반 파일 스트림 열기
 *
 * 지정된 바이트 오프셋에서 파일을 열고 ReadStream을 반환한다.
 * 오프셋이 파일 크기를 초과하면 에러를 던진다.
 *
 * 제약:
 *   - 불변성: 함수는 순수(side-effect 없음), 파일시스템 읽기만.
 *   - 에러 처리: 오프셋 초과, 파일 없음 등 명시적 에러.
 *   - console.log 금지.
 */

import fs from 'node:fs'
import { z } from 'zod'

// ---- 입력 검증 스키마 ----

const OpenFileAtOffsetSchema = z.object({
  filePath: z.string().min(1, 'filePath must not be empty'),
  byteOffset: z.number().int().nonnegative('byteOffset must be >= 0'),
})

export type OpenFileAtOffsetOptions = z.infer<typeof OpenFileAtOffsetSchema>

// ---- 에러 타입 ----

export class OffsetExceedsFileSizeError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly byteOffset: number,
    public readonly fileSize: number,
  ) {
    super(
      `byteOffset ${byteOffset} exceeds file size ${fileSize} for "${filePath}"`,
    )
    this.name = 'OffsetExceedsFileSizeError'
  }
}

export class FileNotFoundError extends Error {
  constructor(public readonly filePath: string) {
    super(`File not found: "${filePath}"`)
    this.name = 'FileNotFoundError'
  }
}

// ---- 구현 ----

/**
 * 지정된 바이트 오프셋에서 파일을 열고 ReadStream을 반환한다.
 *
 * @param filePath  읽을 파일 경로
 * @param byteOffset  스트림 시작 바이트 오프셋 (0 이상 정수)
 * @returns fs.ReadStream — 오프셋부터 EOF까지 스트리밍
 * @throws {FileNotFoundError} 파일이 존재하지 않을 때
 * @throws {OffsetExceedsFileSizeError} 오프셋이 파일 크기를 초과할 때
 * @throws {z.ZodError} 입력 검증 실패 시
 */
export function openFileAtOffset(
  filePath: string,
  byteOffset: number,
): fs.ReadStream {
  // 입력 검증
  const validated = OpenFileAtOffsetSchema.parse({ filePath, byteOffset })

  // 파일 존재 및 크기 확인 (statSync — 동기, 경량)
  let stat: fs.Stats
  try {
    stat = fs.statSync(validated.filePath)
  } catch (cause) {
    throw new FileNotFoundError(validated.filePath)
  }

  const fileSize = stat.size

  // 오프셋 초과 검사: offset > fileSize 이면 에러
  // offset === fileSize 는 EOF 위치 → 빈 스트림이지만 허용 (append-only 파일 tail 시 정상)
  if (validated.byteOffset > fileSize) {
    throw new OffsetExceedsFileSizeError(
      validated.filePath,
      validated.byteOffset,
      fileSize,
    )
  }

  // ReadStream 생성: start 옵션으로 오프셋 지정
  return fs.createReadStream(validated.filePath, {
    start: validated.byteOffset,
  })
}
