/**
 * daemon/index.ts — LoopBreaker 데몬 모듈 스텁
 *
 * M0 토대: 실제 탐지/judge/알림 로직은 M1 이후에 구현.
 * 이 파일은 M1 파서 구현이 import 가능한 진입점 골격만 제공한다.
 */

/** 데몬 상태 */
export type DaemonStatus = 'stopped' | 'running' | 'error'

/** 데몬 인스턴스 인터페이스 (M1에서 구현) */
export interface Daemon {
  readonly status: DaemonStatus
  start(): Promise<void>
  stop(): Promise<void>
}

/**
 * 데몬 모듈 기본 export.
 * M0에서는 스텁만 제공한다.
 */
const daemonStub = {
  version: '0.0.0-m0',
  description: 'LoopBreaker daemon stub — M1에서 구현 예정',
} as const

export default daemonStub
