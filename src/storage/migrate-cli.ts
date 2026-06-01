// src/storage/migrate-cli.ts
// 마이그레이션 CLI 진입점.
// 사용: node dist/storage/migrate-cli.js <op|eval> [dbPath]
//   - op   : 운영 DB(loopbreaker.db) — sqlite-vec 로드 후 vec_embeddings 생성
//   - eval : 평가 DB(loopbreaker-eval.db) — vec 불필요
// 운영/평가 DB는 서로 다른 파일에 분리 생성한다 (BLOCKER 표준 g).

import Database from 'better-sqlite3'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { DbKind } from '../contracts.js'
import { runMigrations } from './migrations.js'
import { loadSqliteVec } from './vec-loader.js'
import { loadConfig, defaultConfigDir } from '../config/config-loader.js'

const APP_VERSION = '0.1.0'

/** DbKind별 기본 DB 파일명 */
function defaultDbFile(kind: DbKind): string {
  return kind === 'op' ? 'loopbreaker.db' : 'loopbreaker-eval.db'
}

/**
 * 한 종류의 DB에 마이그레이션을 적용한다.
 * - WAL 모드 활성화.
 * - op DB는 sqlite-vec 확장을 먼저 로드 (vec_embeddings 가상 테이블에 필요).
 * - embedDim은 설정에서 가져와 vec_embeddings DDL 생성에 사용 (BLOCKER B1).
 *
 * @returns 적용 후 schema_version
 */
export function migrate(kind: DbKind, dbPath: string, embedDim: number): void {
  const db = new Database(dbPath)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    if (kind === 'op') {
      // vec_embeddings 가상 테이블 생성에 sqlite-vec 확장이 필요
      loadSqliteVec(db)
    }
    runMigrations(db, kind, APP_VERSION, embedDim)
  } finally {
    db.close()
  }
}

/** CLI 인자를 파싱해 마이그레이션을 실행한다. */
export function main(argv: readonly string[]): void {
  const kindArg = argv[0]
  if (kindArg !== 'op' && kindArg !== 'eval') {
    throw new Error(
      `사용법: migrate-cli <op|eval> [dbPath]\n받은 인자: ${kindArg ?? '(없음)'}`,
    )
  }
  const kind: DbKind = kindArg

  const config = loadConfig()
  const embedDim = config.detector.embedDim

  const dir = defaultConfigDir()
  mkdirSync(dir, { recursive: true })
  const dbPath = argv[1] ?? join(dir, defaultDbFile(kind))

  migrate(kind, dbPath, embedDim)
  // eslint-disable-next-line no-console -- CLI 진입점의 사용자 피드백은 stdout 허용
  process.stdout.write(`[loopbreaker] ${kind} DB 마이그레이션 완료: ${dbPath}\n`)
}

// 직접 실행 시에만 main 호출 (테스트 import 시엔 실행 안 함)
const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith('migrate-cli.js')
if (invokedDirectly) {
  try {
    main(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`[loopbreaker] 마이그레이션 실패: ${(err as Error).message}\n`)
    process.exit(1)
  }
}
