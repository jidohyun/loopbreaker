/**
 * tests/storage-layer-write-queue-fifo-sub-ac-3b.test.ts
 *
 * Sub-AC 3b: StorageLayer 단일 writer 큐 FIFO 완료 순서 검증
 *
 * 검증 항목:
 *  - 서로 다른 지연(delay)을 가진 N개의 비동기 write를 병렬로 enqueue한다.
 *  - resolve 순서가 enqueue 순서(FIFO)와 동일함을 검증한다.
 *  - 빠른 작업이 늦게 enqueue된 경우에도 순서가 역전되지 않음을 assert한다.
 *
 * 부수효과 0:
 *  - 실제 DB 없이 enqueueWrite만 사용 (DB open 불필요)
 *  - 실제 네트워크·OS알림·~/.loopbreaker·~/.claude 접근 0
 */

import { StorageLayer } from '../src/storage/storage-layer.js'

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

/** ms 지연 후 resolve하는 Promise */
const delay = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms))

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('StorageLayer.enqueueWrite — Sub-AC 3b: FIFO 완료 순서 검증', () => {

  // ── 1. 기본 FIFO 순서 ────────────────────────────────────────────────────
  describe('기본 FIFO 순서', () => {
    it('서로 다른 지연을 가진 3개의 write가 enqueue 순서대로 완료된다', async () => {
      const storage = new StorageLayer()
      const completionOrder: number[] = []

      // 병렬 enqueue — 지연이 역순(긴 것 먼저)이어도 완료 순서는 enqueue 순서여야 한다
      const p0 = storage.enqueueWrite(async () => {
        await delay(30)
        completionOrder.push(0)
      })
      const p1 = storage.enqueueWrite(async () => {
        await delay(10)
        completionOrder.push(1)
      })
      const p2 = storage.enqueueWrite(async () => {
        completionOrder.push(2)
      })

      await Promise.all([p0, p1, p2])

      expect(completionOrder).toEqual([0, 1, 2])
    })

    it('빠른 작업이 늦게 enqueue되어도 먼저 enqueue된 느린 작업보다 앞서지 않는다', async () => {
      const storage = new StorageLayer()
      const completionOrder: number[] = []

      // index 0: 느린 작업 (50ms) — 먼저 enqueue
      // index 1: 매우 빠른 작업 (0ms) — 나중에 enqueue
      // FIFO이면 결과는 [0, 1]이어야 한다 (0이 더 느려도)
      const p0 = storage.enqueueWrite(async () => {
        await delay(50)
        completionOrder.push(0)
      })
      const p1 = storage.enqueueWrite(async () => {
        completionOrder.push(1)
      })

      await Promise.all([p0, p1])

      expect(completionOrder).toEqual([0, 1])
    })
  })

  // ── 2. N=5 병렬 enqueue FIFO ────────────────────────────────────────────
  describe('N=5 병렬 enqueue', () => {
    it('5개의 write가 enqueue 순서대로 완료된다 (지연 역순)', async () => {
      const storage = new StorageLayer()
      const completionOrder: number[] = []

      // 지연 시간을 역순으로 배치 — 느린 것이 먼저 enqueue됨
      // 순수 비동기라면 완료 순서가 역전될 것이나, FIFO 큐이므로 [0,1,2,3,4]여야 한다
      const delays = [40, 30, 20, 10, 0]

      const promises = delays.map((d, i) =>
        storage.enqueueWrite(async () => {
          await delay(d)
          completionOrder.push(i)
        }),
      )

      await Promise.all(promises)

      expect(completionOrder).toEqual([0, 1, 2, 3, 4])
    })

    it('5개의 write가 enqueue 순서대로 완료된다 (지연 랜덤)', async () => {
      const storage = new StorageLayer()
      const completionOrder: number[] = []

      // 고정된 "랜덤" 지연 — 순서가 섞여 있어도 FIFO 보장
      const delays = [15, 5, 25, 0, 10]

      const promises = delays.map((d, i) =>
        storage.enqueueWrite(async () => {
          await delay(d)
          completionOrder.push(i)
        }),
      )

      await Promise.all(promises)

      expect(completionOrder).toEqual([0, 1, 2, 3, 4])
    })
  })

  // ── 3. resolve 순서 (Promise 해소 시점) ────────────────────────────────
  describe('resolve 순서 검증', () => {
    it('각 Promise의 resolve 시점이 enqueue 순서와 일치한다', async () => {
      const storage = new StorageLayer()
      const resolveOrder: number[] = []

      // 각 Promise가 resolve될 때 순서를 기록
      const promises = [30, 10, 20].map((d, i) => {
        return storage.enqueueWrite(async () => {
          await delay(d)
        }).then(() => {
          resolveOrder.push(i)
        })
      })

      await Promise.all(promises)

      // resolve(then 콜백) 호출 순서도 enqueue 순서여야 한다
      expect(resolveOrder).toEqual([0, 1, 2])
    })

    it('동기 fn을 포함한 혼합 write도 enqueue 순서를 유지한다', async () => {
      const storage = new StorageLayer()
      const completionOrder: number[] = []

      // 동기 fn (지연 없음)과 비동기 fn 혼합
      const p0 = storage.enqueueWrite(async () => {
        await delay(20)
        completionOrder.push(0)
      })
      const p1 = storage.enqueueWrite(async () => {
        // 동기적으로 즉시 완료
        completionOrder.push(1)
      })
      const p2 = storage.enqueueWrite(async () => {
        await delay(5)
        completionOrder.push(2)
      })
      const p3 = storage.enqueueWrite(async () => {
        completionOrder.push(3)
      })

      await Promise.all([p0, p1, p2, p3])

      expect(completionOrder).toEqual([0, 1, 2, 3])
    })
  })

  // ── 4. 순서 역전 없음 — 명시적 assert ──────────────────────────────────
  describe('순서 역전 없음 — 명시적 assert', () => {
    it('빠른 작업이 늦게 enqueue된 케이스에서 순서 역전이 없다', async () => {
      const storage = new StorageLayer()
      const completionOrder: number[] = []

      // index 0(100ms), index 1(0ms), index 2(50ms) — 비동기 경쟁 시 순서가 달라질 것
      // 직렬 큐이므로 결과는 반드시 [0, 1, 2]
      const p0 = storage.enqueueWrite(async () => {
        await delay(100)
        completionOrder.push(0)
      })
      const p1 = storage.enqueueWrite(async () => {
        completionOrder.push(1)
      })
      const p2 = storage.enqueueWrite(async () => {
        await delay(50)
        completionOrder.push(2)
      })

      await Promise.all([p0, p1, p2])

      // 절대로 역전되지 않아야 한다
      expect(completionOrder[0]).toBe(0)
      expect(completionOrder[1]).toBe(1)
      expect(completionOrder[2]).toBe(2)
      expect(completionOrder).toEqual([0, 1, 2])
    })

    it('N=10 대규모 병렬 enqueue에서도 FIFO가 유지된다', async () => {
      const storage = new StorageLayer()
      const completionOrder: number[] = []

      // 역순 지연: index 0이 가장 느리고 index 9가 가장 빠름
      const N = 10
      const promises = Array.from({ length: N }, (_, i) =>
        storage.enqueueWrite(async () => {
          await delay((N - i) * 5) // index 0 → 50ms, index 9 → 5ms
          completionOrder.push(i)
        }),
      )

      await Promise.all(promises)

      // 직렬 큐이므로 모든 순서가 보존되어야 한다
      expect(completionOrder).toEqual(Array.from({ length: N }, (_, i) => i))
    })
  })

  // ── 5. drainWriteQueue 후 FIFO 완료 확인 ──────────────────────────────
  describe('drainWriteQueue와 FIFO 순서', () => {
    it('drain 후 모든 write가 enqueue 순서대로 완료되어 있다', async () => {
      const storage = new StorageLayer()
      const completionOrder: number[] = []

      // 병렬 enqueue 후 drain으로 대기
      storage.enqueueWrite(async () => { await delay(20); completionOrder.push(0) })
      storage.enqueueWrite(async () => { completionOrder.push(1) })
      storage.enqueueWrite(async () => { await delay(10); completionOrder.push(2) })

      await storage.drainWriteQueue()

      expect(completionOrder).toEqual([0, 1, 2])
    })
  })
})
