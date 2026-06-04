/**
 * serial-queue-sub-ac-3c.test.ts
 *
 * Sub-AC 3c: 동시성 충돌 없음 검증
 *
 * 공유 카운터/배열에 동시 write를 발행했을 때:
 *  - 직렬 큐 없이 실행하면 레이스 컨디션이 발생한다 (대조 케이스)
 *  - SerialQueue를 통하면 모든 write가 성공하고 최종 상태가 정확하다
 *
 * 검증 항목:
 *  1. 대조 케이스: 직렬 큐 없이 동시 async write → 레이스로 최종값 오염
 *  2. SerialQueue: 동시 enqueue → 모든 write 성공, 최종값 정확
 *  3. 공유 배열 동시 push: 큐 없이는 순서 보장 없음, 큐로는 순서 보장
 *  4. 읽기-수정-쓰기(read-modify-write) 패턴: 큐 없이는 lost update, 큐로는 없음
 *  5. 고부하(100 concurrent): 큐를 통하면 모두 성공, 카운터 정확
 */

import { SerialQueue } from '../src/daemon/serial-queue.js'

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

/** ms만큼 대기하는 Promise */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 직렬 큐 없이 N개의 async 함수를 동시에 실행한다.
 * Promise.all로 모두 발사 → 실제 동시 실행.
 */
async function runConcurrentlyWithoutQueue(
  tasks: Array<() => Promise<void>>,
): Promise<void> {
  await Promise.all(tasks.map((fn) => fn()))
}

/**
 * SerialQueue를 통해 N개의 async 함수를 직렬로 실행한다.
 */
async function runSeriallyWithQueue(
  tasks: Array<() => Promise<void>>,
): Promise<void> {
  const queue = new SerialQueue()
  await Promise.all(tasks.map((fn) => queue.enqueue(fn)))
}

// ─── 테스트 ─────────────────────────────────────────────────────────────────

describe('SerialQueue — Sub-AC 3c: 동시성 충돌 없음 검증', () => {

  // ── 1. 대조 케이스: 직렬 큐 없이 레이스 컨디션 발생 확인 ─────────────────
  describe('대조 케이스 — 직렬 큐 없이 실행하면 레이스 컨디션이 발생한다', () => {

    it('읽기-수정-쓰기 패턴: 큐 없이 동시 실행 시 lost update가 발생한다', async () => {
      // 공유 카운터를 "읽고 → 대기 → 쓰기" 패턴으로 10번 증가시킨다.
      // 직렬 실행 시 최종값은 10이어야 하지만,
      // 동시 실행 시 read-modify-write 사이에 다른 task가 끼어들어
      // lost update가 발생한다.
      const shared = { counter: 0 }

      const tasks = Array.from({ length: 10 }, () => async () => {
        const current = shared.counter   // read
        await delay(1)                   // yield — 다른 task에게 실행 기회
        shared.counter = current + 1    // write (stale read 기반)
      })

      await runConcurrentlyWithoutQueue(tasks)

      // 동시 실행 시 모든 task가 counter=0을 읽고 1로 쓰기 때문에
      // 최종값이 10보다 훨씬 작다 (레이스 컨디션).
      // 이 expect가 통과함 = 레이스가 실제로 발생함을 증명한다.
      expect(shared.counter).toBeLessThan(10)
    })

    it('읽기-수정-쓰기 패턴: SerialQueue 사용 시 lost update 없음', async () => {
      const shared = { counter: 0 }

      const tasks = Array.from({ length: 10 }, () => async () => {
        const current = shared.counter
        await delay(1)
        shared.counter = current + 1
      })

      await runSeriallyWithQueue(tasks)

      // 직렬 실행이므로 counter는 정확히 10이어야 한다.
      expect(shared.counter).toBe(10)
    })
  })

  // ── 2. 공유 카운터: 직렬 큐로 모든 증가 성공 ─────────────────────────────
  describe('공유 카운터 — SerialQueue로 모든 write가 성공한다', () => {

    it('20개 동시 enqueue → 카운터가 정확히 20이 된다', async () => {
      const queue = new SerialQueue()
      const shared = { count: 0 }

      const promises = Array.from({ length: 20 }, () =>
        queue.enqueue(async () => {
          const prev = shared.count
          await delay(0)          // microtask yield — 동시성 압박
          shared.count = prev + 1
        }),
      )

      await Promise.all(promises)

      expect(shared.count).toBe(20)
    })

    it('50개 동시 enqueue → 카운터가 정확히 50이 된다', async () => {
      const queue = new SerialQueue()
      const shared = { count: 0 }

      const promises = Array.from({ length: 50 }, () =>
        queue.enqueue(async () => {
          const prev = shared.count
          await delay(0)
          shared.count = prev + 1
        }),
      )

      await Promise.all(promises)

      expect(shared.count).toBe(50)
    })
  })

  // ── 3. 공유 배열 동시 push ─────────────────────────────────────────────────
  describe('공유 배열 동시 push', () => {

    it('큐 없이 동시 push: 결과는 쌓이지만 순서가 보장되지 않는다', async () => {
      const shared: number[] = []

      const tasks = Array.from({ length: 5 }, (_, i) => async () => {
        await delay(5 - i)   // 늦게 enqueue된 작업일수록 더 빨리 끝남
        shared.push(i)
      })

      await runConcurrentlyWithoutQueue(tasks)

      // 결과 수는 5개가 맞지만 순서는 enqueue 순서(0,1,2,3,4)가 아니다.
      expect(shared).toHaveLength(5)
      // delay(5,4,3,2,1) 이므로 완료 순서는 4,3,2,1,0 — 역순이 된다.
      expect(shared).toEqual([4, 3, 2, 1, 0])
    })

    it('SerialQueue로 push: enqueue 순서 0→1→2→3→4가 보장된다', async () => {
      const queue = new SerialQueue()
      const shared: number[] = []

      const promises = Array.from({ length: 5 }, (_, i) =>
        queue.enqueue(async () => {
          await delay(5 - i)   // 같은 지연 — 직렬이면 무관
          shared.push(i)
        }),
      )

      await Promise.all(promises)

      // 직렬 실행이므로 enqueue 순서가 보장된다.
      expect(shared).toEqual([0, 1, 2, 3, 4])
    })
  })

  // ── 4. 읽기-수정-쓰기: lost update 상세 검증 ─────────────────────────────
  describe('읽기-수정-쓰기 패턴 — SerialQueue로 lost update 없음', () => {

    it('복합 객체 필드 업데이트: 모든 필드가 정확하게 누적된다', async () => {
      const queue = new SerialQueue()
      const state = { sum: 0, product: 1, history: [] as number[] }

      const values = [2, 3, 4, 5]

      const promises = values.map((v) =>
        queue.enqueue(async () => {
          const prevSum = state.sum
          const prevProd = state.product
          await delay(1)               // yield
          state.sum = prevSum + v
          state.product = prevProd * v
          state.history.push(v)
        }),
      )

      await Promise.all(promises)

      // 직렬 실행: 2+3+4+5=14, 2*3*4*5=120, history 순서 보장
      expect(state.sum).toBe(14)
      expect(state.product).toBe(120)
      expect(state.history).toEqual([2, 3, 4, 5])
    })

    it('누산기 패턴: Map 카운트가 정확하다', async () => {
      const queue = new SerialQueue()
      const counts = new Map<string, number>()

      const keys = ['a', 'b', 'a', 'c', 'b', 'a']

      const promises = keys.map((key) =>
        queue.enqueue(async () => {
          const prev = counts.get(key) ?? 0
          await delay(1)
          counts.set(key, prev + 1)
        }),
      )

      await Promise.all(promises)

      expect(counts.get('a')).toBe(3)
      expect(counts.get('b')).toBe(2)
      expect(counts.get('c')).toBe(1)
    })
  })

  // ── 5. 고부하 (100 concurrent) ────────────────────────────────────────────
  describe('고부하 — 100개 동시 enqueue', () => {

    it('100개 동시 enqueue: 카운터가 정확히 100이 된다', async () => {
      const queue = new SerialQueue()
      const shared = { count: 0 }

      const promises = Array.from({ length: 100 }, () =>
        queue.enqueue(async () => {
          const prev = shared.count
          // await 없이 즉시 쓰기 — 직렬이 아니면 이 패턴은 안전하지 않음
          shared.count = prev + 1
        }),
      )

      await Promise.all(promises)
      expect(shared.count).toBe(100)
    }, 10_000)

    it('100개 동시 enqueue + delay(0): 카운터가 정확히 100이 된다', async () => {
      const queue = new SerialQueue()
      const shared = { count: 0 }

      const promises = Array.from({ length: 100 }, () =>
        queue.enqueue(async () => {
          const prev = shared.count
          await delay(0)
          shared.count = prev + 1
        }),
      )

      await Promise.all(promises)
      expect(shared.count).toBe(100)
    }, 10_000)

    it('100개 동시 enqueue: 실행 순서가 enqueue 순서와 일치한다', async () => {
      const queue = new SerialQueue()
      const order: number[] = []

      const promises = Array.from({ length: 100 }, (_, i) =>
        queue.enqueue(async () => {
          order.push(i)
        }),
      )

      await Promise.all(promises)

      const expected = Array.from({ length: 100 }, (_, i) => i)
      expect(order).toEqual(expected)
    }, 10_000)
  })

  // ── 6. 세션 격리: 한 세션 큐 예외가 다른 큐를 오염시키지 않음 ────────────
  describe('세션 격리 — 두 큐의 공유 상태 오염 없음', () => {

    it('큐 A의 예외가 큐 B의 공유 카운터 write를 방해하지 않는다', async () => {
      const queueA = new SerialQueue()
      const queueB = new SerialQueue()

      const sharedA = { count: 0 }
      const sharedB = { count: 0 }

      // 큐 A: 중간에 예외 발생
      const tasksA = [
        queueA.enqueue(async () => { sharedA.count++ }),
        queueA.enqueue(async () => { throw new Error('A session error') }),
        queueA.enqueue(async () => { sharedA.count++ }),
      ]

      // 큐 B: 독립 실행, 예외 없음
      const tasksB = Array.from({ length: 5 }, () =>
        queueB.enqueue(async () => { sharedB.count++ }),
      )

      // A의 예외를 무시하고 B는 정상 완료
      await Promise.allSettled(tasksA)
      await Promise.all(tasksB)

      // A는 예외가 있지만 나머지 2개 write는 성공
      expect(sharedA.count).toBe(2)
      // B는 5개 모두 성공
      expect(sharedB.count).toBe(5)
    })
  })
})
