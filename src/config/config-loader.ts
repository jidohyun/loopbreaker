// src/config/config-loader.ts
// ~/.loopbreaker/config.json 을 읽어 zod로 검증하는 설정 로더.
// 파일이 없으면 전체 기본값으로 구성한다 (모든 섹션이 default를 가지므로 { version: 1 } 만으로 충분).
// BLOCKER C3: DetectorConfig 평면 구조. 임계값은 코드 상수가 아니라 이 로더가 제공.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loopBreakerConfigSchema, type LoopBreakerConfig } from './config-schema.js'

/** 기본 설정 디렉터리 (~/.loopbreaker) */
export function defaultConfigDir(): string {
  return join(homedir(), '.loopbreaker')
}

/** 기본 설정 파일 경로 (~/.loopbreaker/config.json) */
export function defaultConfigPath(): string {
  return join(defaultConfigDir(), 'config.json')
}

/** 파일 부재를 나타내는 Node 에러인지 판별 */
function isFileNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  )
}

/**
 * 설정을 로드한다.
 * - configPath 파일이 있으면 JSON 파싱 후 zod 검증.
 * - 없으면 빈 설정({ version: 1 })을 zod 기본값으로 채워 반환.
 * - JSON 파싱 실패 / 스키마 위반은 상세 메시지와 함께 throw.
 *
 * @param configPath 설정 파일 경로 (기본: ~/.loopbreaker/config.json)
 * @returns 검증·기본값 적용된 불변 설정 객체
 */
export function loadConfig(configPath: string = defaultConfigPath()): LoopBreakerConfig {
  let raw: unknown

  try {
    const text = readFileSync(configPath, 'utf8')
    try {
      raw = JSON.parse(text)
    } catch (err) {
      throw new Error(
        `설정 파일 JSON 파싱 실패 (${configPath}): ${(err as Error).message}`,
      )
    }
  } catch (err) {
    if (isFileNotFound(err)) {
      // 파일 부재: 전체 기본값으로 구성 (모든 섹션 default 보유 → version만 채우면 됨)
      raw = { version: 1, detector: {}, privacy: {}, api: {}, watch: {}, webhook: {}, notify: {} }
    } else if (err instanceof Error && err.message.startsWith('설정 파일 JSON 파싱 실패')) {
      throw err
    } else {
      throw new Error(
        `설정 파일 읽기 실패 (${configPath}): ${(err as Error).message}`,
      )
    }
  }

  const result = loopBreakerConfigSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(`설정 검증 실패 (${configPath}):\n${issues}`)
  }

  return Object.freeze(result.data)
}
