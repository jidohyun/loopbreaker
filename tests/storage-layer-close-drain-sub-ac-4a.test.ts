/**
 * tests/storage-layer-close-drain-sub-ac-4a.test.ts
 *
 * Sub-AC 4a: StorageLayer.close() drain — pending write queue completes
 * before DB closes.
 *
 * 검증 항목:
 *  - N개의 비동기 write를 enqueue한 직후 close()를 동시에 호출해도
 *    모든 write가 DB에 커밋된 뒤 connection이 닫힌다.
 *  - close() 이후 DB에 직접 접근하면 에러가 발생한다(opDb getter가 throw).
 *  - 동기 write + 비동기 write 혼합에서도 drain 보장.
 *  - 빈 큐에서 close()를 호출하면 즉시 성공한다.
 *
 * 부수효과 0:
 *  - 임시 tmpdir 파일 DB 사용 (sqlite-vec/WAL 요구사항 충족)
 *  - 실제 네트워크·OS알림·~/.loopbreaker·~/.claude 접근 0
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { StorageLayer } from '../src/storage/storage-layer.js'

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

/** ms 지연 후 resolve하는 Promise */
const delay = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms))

/** 임시 디렉토리와 op DB 경로를 생성한다. */
function makeTmpDir(): { dir: string; opPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loopbreaker-m5-ac4a-'))
  return { dir, opPath: join(dir, 'op.db') }
}

/**
 * 테스트용 단순 카운터 테이블을 생성하고 값을 읽는 헬퍼.
 * StorageLayer가 내부적으로 migrations를 실행하므로 기존 테이블과
 * 충돌하지 않도록 별도 테이블명 사용.
 */
function setupCounterTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _test_counter (
      id    INTEGER PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO _test_counter (id, value) VALUES (1, 0);
  `)
}

function incrementCounter(db: Database.Database): void {
  db.prepare('UPDATE _test_counter SET value = value + 1 WHERE id = 1').run()
}

function readCounter(db: Database.Database): number {
  const row = db.prepare('SELECT value FROM _test_counter WHERE id = 1').get() as
    | { value: number }
    | undefined
  return row?.value ?? 0
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('StorageLayer.close() drain — Sub-AC 4a', () => {
  let dir: string
  let opPath: string
  let layer: StorageLayer

  beforeEach(() => {
    ;({ dir, opPath } = makeTmpDir())
    layer = new StorageLayer()
  })

  afterEach(() => {
    // 테스트가 close() 안 하면 여기서 강제 정리
    try {
      // 이미 닫힌 경우 opDb getter가 throw하므로 무시
      const db = layer.opDb
      db.close()
    } catch {
      /* already closed */
    }
    rmSync(dir, { recursive: true, force: true })
  })

  // ── 1. 기본 drain-then-close ────────────────────────────────────────────

  it('N개 비동기 write enqueue 직후 close() 호출 시 모든 write가 DB에 커밋된다', async () => {
    layer.open(opPath, undefined, { embedDim: 1024 })
    const db = layer.opDb
    setupCounterTable(db)

    const N = 5

    // N개의 비동기 write를 enqueue — 각각 짧은 지연 포함
    const writePromises = Array.from({ length: N }, (_, i) =>
      layer.enqueueWrite(async () => {
        await delay(10 + i * 5) // 10ms, 15ms, 20ms, 25ms, 30ms
        incrementCounter(db)
      }),
    )

    // close()를 write enqueue 직후(완료 대기 없이) 동시에 호출
    const closePromise = layer.close()

    // close()와 write Promise 모두 기다린다
    await Promise.all([...writePromises, closePromise])

    // close() 이후 DB를 새로 열어 커밋된 값을 확인
    const verifyDb = new Database(opPath, { readonly: true })
    try {
      const count = readCounter(verifyDb)
      expect(count).toBe(N)
    } finally {
      verifyDb.close()
    }
  })

  // ── 2. 동기 + 비동기 혼합 write drain ──────────────────────────────────

  it('동기·비동기 혼합 write를 enqueue한 뒤 close()가 모두 커밋 후 종료한다', async () => {
    layer.open(opPath, undefined, { embedDim: 1024 })
    const db = layer.opDb
    setupCounterTable(db)

    // 동기 write × 3 + 비동기 write × 2 혼합
    const p0 = layer.enqueueWrite(() => { incrementCounter(db) })               // 동기
    const p1 = layer.enqueueWrite(async () => { await delay(20); incrementCounter(db) }) // 비동기
    const p2 = layer.enqueueWrite(() => { incrementCounter(db) })               // 동기
    const p3 = layer.enqueueWrite(async () => { await delay(10); incrementCounter(db) }) // 비동기
    const p4 = layer.enqueueWrite(() => { incrementCounter(db) })               // 동기

    // close() 동시 호출
    const closePromise = layer.close()

    await Promise.all([p0, p1, p2, p3, p4, closePromise])

    const verifyDb = new Database(opPath, { readonly: true })
    try {
      expect(readCounter(verifyDb)).toBe(5)
    } finally {
      verifyDb.close()
    }
  })

  // ── 3. close() 후 opDb getter가 throw ──────────────────────────────────

  it('close() 완료 후 opDb에 접근하면 에러가 발생한다', async () => {
    layer.open(opPath, undefined, { embedDim: 1024 })

    await layer.close()

    expect(() => layer.opDb).toThrow('StorageLayer')
  })

  // ── 4. 빈 큐에서 close()는 즉시 성공한다 ──────────────────────────────

  it('enqueue 없이 close()를 호출하면 즉시 성공한다', async () => {
    layer.open(opPath, undefined, { embedDim: 1024 })

    // 아무 write도 enqueue하지 않고 close 호출
    await expect(layer.close()).resolves.toBeUndefined()

    // DB가 닫혔는지 확인
    expect(() => layer.opDb).toThrow('StorageLayer')
  })

  // ── 5. 대용량 N=20 write drain ──────────────────────────────────────────

  it('N=20 비동기 write 모두 close() drain 후 DB에 반영된다', async () => {
    layer.open(opPath, undefined, { embedDim: 1024 })
    const db = layer.opDb
    setupCounterTable(db)

    const N = 20

    // N개 모두 비동기 write (지연 역순 — 빠른 것이 뒤에 enqueue)
    const promises = Array.from({ length: N }, (_, i) =>
      layer.enqueueWrite(async () => {
        await delay((N - i) * 2) // i=0 → 40ms, i=19 → 2ms
        incrementCounter(db)
      }),
    )

    // close()를 모든 enqueue 직후 호출
    const closePromise = layer.close()

    await Promise.all([...promises, closePromise])

    const verifyDb = new Database(opPath, { readonly: true })
    try {
      expect(readCounter(verifyDb)).toBe(N)
    } finally {
      verifyDb.close()
    }
  })

  // ── 6. write 중 에러가 나도 나머지 write가 drain된다 ──────────────────

  it('write 중 에러가 발생해도 이후 write는 계속 drain되고 close()가 완료된다', async () => {
    layer.open(opPath, undefined, { embedDim: 1024 })
    const db = layer.opDb
    setupCounterTable(db)

    // 첫 번째 write는 에러
    const p0 = layer.enqueueWrite(async () => {
      await delay(5)
      throw new Error('intentional write error')
    })

    // 이후 두 개의 write는 정상
    const p1 = layer.enqueueWrite(() => { incrementCounter(db) })
    const p2 = layer.enqueueWrite(async () => { await delay(5); incrementCounter(db) })

    // close() 동시 호출
    const closePromise = layer.close()

    // p0은 reject되어야 하므로 별도 처리
    await expect(p0).rejects.toThrow('intentional write error')
    await Promise.all([p1, p2, closePromise])

    const verifyDb = new Database(opPath, { readonly: true })
    try {
      // p0이 실패했으므로 카운터는 2 (p1 + p2)
      expect(readCounter(verifyDb)).toBe(2)
    } finally {
      verifyDb.close()
    }
  })
})
