// src/config/config-loader.ts
// ~/.loopbreaker/config.json 을 읽어 zod로 검증하는 설정 로더.
// 파일이 없으면 전체 기본값으로 구성한다 (모든 섹션이 default를 가지므로 { version: 1 } 만으로 충분).
// BLOCKER C3: DetectorConfig 평면 구조. 임계값은 코드 상수가 아니라 이 로더가 제공.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loopBreakerConfigSchema, type LoopBreakerConfig } from './config-schema.js'
import { DEFAULT_DETECTOR_CONFIG, type DetectorConfig } from '../contracts.js'

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

/**
 * 중첩 LoopBreakerConfig를 평면 DetectorConfig로 변환하는 어댑터.
 *
 * 매핑 규칙 (SPEC §6.1, BLOCKER C3):
 *   - config.detector.* → DetectorConfig 구조 게이트 임계값 / 모델 설정 / 의미 게이트 임계값
 *   - config.notify.notifyDebounceMs → DetectorConfig.notifyDebounceMs
 *   - config.detector.notifyChannels → DetectorConfig.notifyChannels
 *   - config.detector.webhookUrl → DetectorConfig.webhookUrl
 *   - config.detector.lowConfidenceNotify → DetectorConfig.lowConfidenceNotify
 *
 * 안전 원칙:
 *   - DEFAULT_DETECTOR_CONFIG의 모든 기본값을 변경하지 않는다.
 *   - config 파일에 명시된 안전 필드만 덮어쓴다.
 *   - 반환 객체는 새 객체로 생성 (불변성, 원본 config 미변경).
 *
 * @param config loadConfig()가 반환한 검증된 LoopBreakerConfig
 * @returns 평면화된 DetectorConfig (DEFAULT_DETECTOR_CONFIG 기반, config로 오버라이드)
 */
export function toDetectorConfig(config: LoopBreakerConfig): DetectorConfig {
  const d = config.detector
  const n = config.notify

  // DEFAULT_DETECTOR_CONFIG를 기반으로 명시된 필드만 덮어쓴다.
  // notifyDebounceMs는 config.notify.notifyDebounceMs에서 매핑한다
  // (config.detector에도 notifyDebounceMs가 있으면 detector 값 우선).
  const notifyDebounceMs =
    d.notifyDebounceMs !== DEFAULT_DETECTOR_CONFIG.notifyDebounceMs
      ? d.notifyDebounceMs
      : n.notifyDebounceMs !== DEFAULT_DETECTOR_CONFIG.notifyDebounceMs
        ? n.notifyDebounceMs
        : DEFAULT_DETECTOR_CONFIG.notifyDebounceMs

  return {
    // ---- 구조 게이트 임계값 (config.detector → flat) ----
    WARNING: d.WARNING,
    CRITICAL: d.CRITICAL,
    circuitBreaker: d.circuitBreaker,
    historySize: d.historySize,
    errLoopWarn: d.errLoopWarn,
    errLoopCrit: d.errLoopCrit,
    fileEditWarn: d.fileEditWarn,
    fileEditCrit: d.fileEditCrit,

    // ---- 의미 게이트 임계값 (config.detector → flat) ----
    simThresh: d.simThresh,
    decideThresh: d.decideThresh,

    // ---- 가짜성공 프로브 임계값 (config.detector → flat) ----
    selfApprovalMs: d.selfApprovalMs,
    selfApprovalCriticalMs: d.selfApprovalCriticalMs,

    // ---- judge 설정 (config.detector → flat) ----
    judgeSelfConsistencyN: d.judgeSelfConsistencyN,
    judgePositionSwaps: d.judgePositionSwaps,

    // ---- 모델 설정 (config.detector → flat, 위험필드) ----
    embedModelId: d.embedModelId,
    judgeModelId: d.judgeModelId,
    embedDim: d.embedDim,

    // ---- 알림 설정 (config.detector + config.notify → flat) ----
    notifyDebounceMs,
    notifyChannels: d.notifyChannels,
    webhookUrl: d.webhookUrl,
    lowConfidenceNotify: d.lowConfidenceNotify,
  }
}
