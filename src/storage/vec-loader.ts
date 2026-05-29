// src/storage/vec-loader.ts
// sqlite-vec 익스텐션 로더.
// import.meta.resolve을 직접 사용하지 않고 플랫폼별 경로를 계산해서 로드.
// Jest ESM 환경에서 import.meta.resolve 미지원 문제 우회.

import { arch, platform } from 'node:process'
import { createRequire } from 'node:module'
import type Database from 'better-sqlite3'

/**
 * sqlite-vec 익스텐션을 DB에 로드한다.
 * import.meta.resolve을 사용하지 않고 require.resolve을 이용해서
 * Jest ESM VM 모듈 환경에서도 동작하도록 한다.
 *
 * BLOCKER B1: sqlite-vec는 운영 DB의 vec_embeddings 가상 테이블에 필요.
 */
export function loadSqliteVec(db: Database.Database): void {
  const suffix = platform === 'win32' ? 'dll' : platform === 'darwin' ? 'dylib' : 'so'
  const packageName = `sqlite-vec-${platform === 'win32' ? 'windows' : platform}-${arch}`
  const extensionFile = `vec0.${suffix}`

  try {
    // require.resolve을 사용해서 패키지 경로 탐색 (ESM 호환)
    const require = createRequire(import.meta.url)
    const libPath = require.resolve(`${packageName}/${extensionFile}`)
    db.loadExtension(libPath)
  } catch (err) {
    throw new Error(
      `sqlite-vec 익스텐션 로드 실패 (${packageName}/${extensionFile}): ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
}

/**
 * sqlite-vec 익스텐션 경로를 반환한다.
 * 운영용: import.meta.resolve을 직접 사용 (표준 ESM 환경).
 */
export function getSqliteVecPath(): string {
  const suffix = platform === 'win32' ? 'dll' : platform === 'darwin' ? 'dylib' : 'so'
  const packageName = `sqlite-vec-${platform === 'win32' ? 'windows' : platform}-${arch}`
  const extensionFile = `vec0.${suffix}`

  const require = createRequire(import.meta.url)
  return require.resolve(`${packageName}/${extensionFile}`)
}
