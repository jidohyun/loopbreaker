/**
 * watch/index.ts — LoopBreaker 파일 감시 모듈 스텁
 *
 * M0 토대: 실제 JSONL 파일 감시 로직은 M1 이후에 구현.
 * 이 파일은 M1 파서 구현이 import 가능한 진입점 골격만 제공한다.
 */

/** 감시 상태 */
export type WatchStatus = 'idle' | 'watching' | 'error'

/** 감시 옵션 인터페이스 (M1에서 구체화) */
export interface WatchOptions {
  readonly sessionPath: string
  readonly pollIntervalMs?: number
}

/** 감시 인스턴스 인터페이스 (M1에서 구현) */
export interface Watcher {
  readonly status: WatchStatus
  start(options: WatchOptions): Promise<void>
  stop(): Promise<void>
}

/**
 * watch 모듈 기본 export.
 * M0에서는 스텁만 제공한다.
 */
const watchStub = {
  version: '0.0.0-m0',
  description: 'LoopBreaker watch stub — M1에서 구현 예정',
} as const

export default watchStub
