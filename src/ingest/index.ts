/**
 * ingest/index.ts — LoopBreaker JSONL 수집 모듈 스텁
 *
 * M0 토대: 실제 JSONL 파싱·저장 로직은 M1 이후에 구현.
 * 이 파일은 M1 파서 구현이 import 가능한 진입점 골격만 제공한다.
 */

/** 수집 상태 */
export type IngestStatus = 'idle' | 'running' | 'error'

/** 수집 옵션 인터페이스 (M1에서 구체화) */
export interface IngestOptions {
  readonly sessionPath: string
  readonly byteOffset?: number
}

/** 수집 결과 인터페이스 (M1에서 구현) */
export interface IngestResult {
  readonly status: IngestStatus
  readonly linesProcessed: number
  readonly bytesRead: number
}

/**
 * ingest 모듈 기본 export.
 * M0에서는 스텁만 제공한다.
 */
const ingestStub = {
  version: '0.0.0-m0',
  description: 'LoopBreaker ingest stub — M1에서 구현 예정',
} as const

export default ingestStub
