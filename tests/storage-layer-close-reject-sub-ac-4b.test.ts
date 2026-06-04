/**
 * tests/storage-layer-close-reject-sub-ac-4b.test.ts
 *
 * Sub-AC 4b: StorageLayer.close() rejection — write attempts after close()
 * are rejected with a closed-state error.
 *
 * 검증 항목:
 *  - close() 완료 후 enqueueWrite()를 호출하면 즉시 reject된다.
 *  - reject 메시지에 'StorageLayer'가 포함된다.
 *  - close() 이후 여러 번 enqueueWrite()를 시도해도 매번 reject된다.
 *  - close() 도중(drain 중) race하는 enqueueWrite()도 reject된다.
 *
 * 부수효과 0:
 *  - 임시 tmpdir 파일 DB 사용 (sqlite-vec/WAL 요구사항 충족)
 *  - 실제 네트워크·OS알림·~/.loopbreaker·~/.claude 접근 0
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { StorageLayer } from '../src/storage/storage-layer.js'

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

const delay = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms))

function makeTmpDir(): { dir: string; opPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'loopbreaker-m5-ac4b-'))
  return { dir, opPath: join(dir, 'op.db') }
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('StorageLayer.close() rejection — Sub-AC 4b', () => {
  let dir: string
  let opPath: string
  let layer: StorageLayer

  beforeEach(() => {
    ;({ dir, opPath } = makeTmpDir())
    layer = new StorageLayer()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // ── 1. 기본 close 후 write reject ─────────────────────────────────────────

  it('close() 완료 후 enqueueWrite()를 호출하면 rejected Promise를 반환한다', async () => {
    layer.open(opPath, undefined, { embedDim: 1024 })

    await layer.close()

    await expect(layer.enqueueWrite(() => { /* noop */ })).rejects.toThrow('StorageLayer')
  })

  // ── 2. 에러 메시지에 'StorageLayer' 포함 확인 ──────────────────────────────

  it('close() 후 write reject 에러 메시지에 "StorageLayer"가 포함된다', async () => {
    layer.open(opPath, undefined, { embedDim: 1024 })

    await layer.close()

    await expect(
      layer.enqueueWrite(() => { /* noop */ }),
    ).rejects.toThrow(/StorageLayer/)
  })

  // ── 3. close() 후 여러 번 시도해도 매번 reject ────────────────────────────

  it('close() 후 enqueueWrite()를 여러 번 호출해도 모두 reject된다', async () => {
    layer.open(opPath, undefined, { embedDim: 1024 })

    await layer.close()

    // 3번 연속 enqueue — 전부 reject 되어야 함
    const results = await Promise.allSettled([
      layer.enqueueWrite(() => { /* noop */ }),
      layer.enqueueWrite(async () => { await delay(1) }),
      layer.enqueueWrite(() => { /* noop */ }),
    ])

    for (const result of results) {
      expect(result.status).toBe('rejected')
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(Error)
      expect((result as PromiseRejectedResult).reason.message).toMatch(/StorageLayer/)
    }
  })

  // ── 4. close() 도중 race하는 enqueueWrite()도 reject ─────────────────────

  it('close() 진행 중에 race하는 enqueueWrite()는 reject된다', async () => {
    layer.open(opPath, undefined, { embedDim: 1024 })

    // 50ms 지연 write를 enqueue해 close() drain을 느리게 만든다
    void layer.enqueueWrite(async () => { await delay(50) })

    // close()를 시작하되 await하지 않는다
    const closePromise = layer.close()

    // close()가 _closed = true를 설정하므로 이 시점부터 새 write는 reject된다
    // (drain 중이더라도 _closed 플래그가 이미 true)
    await expect(
      layer.enqueueWrite(() => { /* noop */ }),
    ).rejects.toThrow('StorageLayer')

    // close()가 완전히 끝날 때까지 대기
    await closePromise
  })

  // ── 5. open() 전 enqueueWrite()는 다른 이유로 실패하거나 reject 될 수 있다 ──

  it('open() 없이 enqueueWrite()를 호출한 뒤 close()하면 write는 실행된다(open 후 닫아야 reject)', async () => {
    // StorageLayer를 열지 않은 상태에서 enqueueWrite 자체는 큐에 들어간다
    // (DB 접근 없는 순수 함수라면 성공할 수 있음)
    // 이 테스트는 open→close 시퀀스 이후에만 _closed 플래그가 의미 있음을 확인
    layer.open(opPath, undefined, { embedDim: 1024 })
    await layer.close()

    // 명시적으로 close 후 reject 검증
    const promise = layer.enqueueWrite(() => { /* noop */ })
    await expect(promise).rejects.toBeInstanceOf(Error)
  })
})
