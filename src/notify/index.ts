/**
 * notify/index.ts — LoopBreaker 알림 모듈 스텁
 *
 * M0 토대: 실제 알림(macOS 네이티브/Slack 등) 로직은 M1 이후에 구현.
 * 이 파일은 M1 파서 구현이 import 가능한 진입점 골격만 제공한다.
 */

/** 알림 채널 종류 */
export type NotifyChannel = 'macos' | 'slack' | 'noop'

/** 알림 메시지 인터페이스 (M1에서 구체화) */
export interface NotifyMessage {
  readonly title: string
  readonly body: string
  readonly channel?: NotifyChannel
}

/** 알림 결과 인터페이스 (M1에서 구현) */
export interface NotifyResult {
  readonly success: boolean
  readonly channel: NotifyChannel
}

/**
 * notify 모듈 기본 export.
 * M0에서는 스텁만 제공한다.
 */
const notifyStub = {
  version: '0.0.0-m0',
  description: 'LoopBreaker notify stub — M1에서 구현 예정',
} as const

export default notifyStub
