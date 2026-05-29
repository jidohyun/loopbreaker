/**
 * storage/index.ts — LoopBreaker 스토리지 모듈 스텁
 *
 * M0 토대: 실제 SQLite 읽기/쓰기 로직은 M1 이후에 구현.
 * 이 파일은 M1 파서 구현이 import 가능한 진입점 골격만 제공한다.
 * migrations.ts 및 vec-loader.ts는 별도 모듈로 관리한다.
 */

/** 스토리지 DB 종류 */
export type StorageDbKind = 'operational' | 'eval'

/** 스토리지 연결 옵션 인터페이스 (M1에서 구체화) */
export interface StorageOptions {
  readonly dbPath: string
  readonly kind: StorageDbKind
}

/** 스토리지 인스턴스 인터페이스 (M1에서 구현) */
export interface Storage {
  readonly kind: StorageDbKind
  open(options: StorageOptions): Promise<void>
  close(): Promise<void>
}

/**
 * storage 모듈 기본 export.
 * M0에서는 스텁만 제공한다.
 */
const storageStub = {
  version: '0.0.0-m0',
  description: 'LoopBreaker storage stub — M1에서 구현 예정',
} as const

export default storageStub
