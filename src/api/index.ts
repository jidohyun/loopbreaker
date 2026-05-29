/**
 * api/index.ts — LoopBreaker API 모듈 스텁
 *
 * M0 토대: 실제 HTTP/IPC API 로직은 M1 이후에 구현.
 * 이 파일은 M1 파서 구현이 import 가능한 진입점 골격만 제공한다.
 */

/** API 서버 상태 */
export type ApiStatus = 'stopped' | 'running' | 'error'

/** API 서버 옵션 인터페이스 (M1에서 구체화) */
export interface ApiOptions {
  readonly port?: number
  readonly host?: string
}

/** API 서버 인터페이스 (M1에서 구현) */
export interface ApiServer {
  readonly status: ApiStatus
  start(options?: ApiOptions): Promise<void>
  stop(): Promise<void>
}

/**
 * api 모듈 기본 export.
 * M0에서는 스텁만 제공한다.
 */
const apiStub = {
  version: '0.0.0-m0',
  description: 'LoopBreaker api stub — M1에서 구현 예정',
} as const

export default apiStub
