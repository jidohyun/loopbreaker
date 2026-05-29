/**
 * detect/index.ts — LoopBreaker 탐지 모듈 스텁
 *
 * M0 토대: 실제 탐지 로직(thrashing / false_success)은 M1 이후에 구현.
 * 이 파일은 M1 탐지 구현이 import 가능한 진입점 골격만 제공한다.
 */

/** 탐지 모듈 버전 */
export const DETECT_VERSION = '0.0.0-m0' as const

/** 탐지 모듈 설명 */
export const DETECT_DESCRIPTION =
  'LoopBreaker detect stub — M1에서 구현 예정' as const

/**
 * detect 모듈 기본 export.
 * M0에서는 스텁만 제공한다.
 */
const detectStub = {
  version: DETECT_VERSION,
  description: DETECT_DESCRIPTION,
} as const

export default detectStub
