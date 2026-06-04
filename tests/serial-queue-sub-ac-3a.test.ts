/**
 * serial-queue-sub-ac-3a.test.ts
 *
 * Sub-AC 3a: SerialQueue 클래스 단위 테스트
 *
 * 검증 항목:
 *  1. enqueue(fn)이 내부적으로 Promise 체인을 유지하며
 *     동시 호출 시 이전 작업 완료 후 다음 작업이 실행됨
 *  2. 실행 순서 배열이 enqueue 호출 순서와 일치
 *  3. 한 작업의 throw가 큐 전체를 중단시키지 않음 (세션 격리)
 *  4. maxDepth COALESCE — 초과 enqueue는 skip
 *  5. drainAndClose 이후 enqueue는 reject
 *  6. drain() 완료 후 모든 작업이 처리됨
 */

import { SerialQueue } from '../src/daemon/serial-queue.js'

// ─── 헬퍼 ──────────────────────────────────────────────

/** ms만큼 대기하는 Promise */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ─── 테스트 ─────────────────────────────────────────────

describe('SerialQueue — Sub-AC 3a', () => {

  // ── 1. 직렬 실행 보장 ──────────────────────────────────
  describe('직렬 실행 보장', () => {
    it('동시 enqueue 시 이전 작업 완료 후 다음 작업이 실행된다', async () => {
      const queue = new SerialQueue()
      const executionOrder: number[] = []

      // 3개의 작업을 동시에 enqueue — 각 작업은 짧은 지연 후 순서 기록
      const p1 = queue.enqueue(async () => {
        await delay(20)
        executionOrder.push(1)
      })
      const p2 = queue.enqueue(async () => {
        await delay(10)
        executionOrder.push(2)
      })
      const p3 = queue.enqueue(async () => {
        executionOrder.push(3)
      })

      await Promise.all([p1, p2, p3])

      // 지연 시간이 달라도 enqueue 순서 1→2→3이 보장되어야 한다
      expect(executionOrder).toEqual([1, 2, 3])
    })

    it('실행 순서 배열이 enqueue 호출 순서와 일치한다 (5개)', async () => {
      const queue = new SerialQueue()
      const order: number[] = []
      const delays = [30, 5, 15, 2, 20]

      const promises = delays.map((d, i) =>
        queue.enqueue(async () => {
          await delay(d)
          order.push(i)
        }),
      )

      await Promise.all(promises)

      expect(order).toEqual([0, 1, 2, 3, 4])
    })

    it('두 번째 작업은 첫 번째 작업이 완전히 끝난 뒤에 시작된다', async () => {
      const queue = new SerialQueue()
      let firstFinished = false

      const p1 = queue.enqueue(async () => {
        await delay(30)
        firstFinished = true
      })

      let secondStartedBeforeFirst = false
      const p2 = queue.enqueue(async () => {
        // 두 번째 작업이 시작될 때 첫 번째가 끝났는지 확인
        if (!firstFinished) secondStartedBeforeFirst = true
      })

      await Promise.all([p1, p2])

      expect(secondStartedBeforeFirst).toBe(false)
      expect(firstFinished).toBe(true)
    })
  })

  // ── 2. 반환값 전달 ─────────────────────────────────────
  describe('반환값 전달', () => {
    it('enqueue한 fn의 반환값이 Promise로 전달된다', async () => {
      const queue = new SerialQueue()
      const result = await queue.enqueue(async () => 42)
      expect(result).toBe(42)
    })

    it('여러 작업의 반환값이 각자 독립적으로 전달된다', async () => {
      const queue = new SerialQueue()
      const r1 = queue.enqueue(async () => 'a')
      const r2 = queue.enqueue(async () => 'b')
      const r3 = queue.enqueue(async () => 'c')

      expect(await Promise.all([r1, r2, r3])).toEqual(['a', 'b', 'c'])
    })
  })

  // ── 3. 세션 격리 (에러 격리) ───────────────────────────
  describe('세션 격리 — 한 작업 throw가 큐를 중단시키지 않는다', () => {
    it('중간 작업이 throw해도 후속 작업이 실행된다', async () => {
      const queue = new SerialQueue()
      const order: string[] = []

      const p1 = queue.enqueue(async () => {
        order.push('before-error')
      })

      const p2 = queue.enqueue(async () => {
        order.push('error-task')
        throw new Error('intentional error')
      })

      const p3 = queue.enqueue(async () => {
        order.push('after-error')
      })

      // p2는 reject되지만 p1, p3은 성공
      await p1
      await expect(p2).rejects.toThrow('intentional error')
      await p3

      expect(order).toEqual(['before-error', 'error-task', 'after-error'])
    })

    it('실패한 작업의 에러가 해당 Promise로만 전달된다', async () => {
      const queue = new SerialQueue()

      const failP = queue.enqueue(async () => {
        throw new Error('fail')
      })
      const successP = queue.enqueue(async () => 'ok')

      await expect(failP).rejects.toThrow('fail')
      await expect(successP).resolves.toBe('ok')
    })
  })

  // ── 4. maxDepth COALESCE ──────────────────────────────
  describe('maxDepth COALESCE', () => {
    it('maxDepth 초과 enqueue는 skip(undefined resolve)된다', async () => {
      // maxDepth=3: pending(대기 중+실행 중)이 3 이상이면 COALESCE.
      // 블로킹 작업 1개(실행 중) + 대기 2개 = pending 3 → 4번째는 skip.
      const blockingResolvers: Array<() => void> = []

      const queue = new SerialQueue(3)

      // 첫 작업: 수동으로 제어 (블로킹) → pending=1
      const firstDone = new Promise<void>((resolve) => {
        blockingResolvers.push(resolve)
      })
      queue.enqueue(() => firstDone) // pending=1

      // 대기 2개 적재 → pending=3
      const p2 = queue.enqueue(async () => 'queued-1')  // pending=2
      const p3 = queue.enqueue(async () => 'queued-2')  // pending=3

      // 4번째: pending=3 >= maxDepth=3 → COALESCE (skip)
      const p4 = queue.enqueue(async () => 'should-be-skipped')

      // 블로킹 해제
      blockingResolvers[0]()

      const [r2, r3, r4] = await Promise.all([p2, p3, p4])
      expect(r2).toBe('queued-1')
      expect(r3).toBe('queued-2')
      // p4는 COALESCE되어 undefined
      expect(r4).toBeUndefined()
    })

    it('pendingCount가 대기 중+실행 중 작업 수를 반환한다', async () => {
      const blockResolvers: Array<() => void> = []
      const queue = new SerialQueue()

      // 블로킹 작업으로 큐를 채운다 → pending=1 (실행 중)
      const block = new Promise<void>((r) => blockResolvers.push(r))
      queue.enqueue(() => block)

      // 대기 2개 추가 → pending=3
      queue.enqueue(async () => 'a')
      queue.enqueue(async () => 'b')

      // 실행 중 1 + 대기 2 = 3
      expect(queue.pendingCount).toBe(3)

      blockResolvers[0]()
      await queue.drain()
      expect(queue.pendingCount).toBe(0)
    })
  })

  // ── 5. drainAndClose ──────────────────────────────────
  describe('drainAndClose', () => {
    it('drainAndClose 이후 enqueue는 reject된다', async () => {
      const queue = new SerialQueue()
      await queue.drainAndClose()

      await expect(queue.enqueue(async () => 'x')).rejects.toThrow(
        'SerialQueue: 큐가 닫혔습니다',
      )
    })

    it('isClosed는 drainAndClose 후 true가 된다', async () => {
      const queue = new SerialQueue()
      expect(queue.isClosed).toBe(false)
      await queue.drainAndClose()
      expect(queue.isClosed).toBe(true)
    })

    it('drainAndClose는 진행 중인 작업 완료 후 닫힌다', async () => {
      const queue = new SerialQueue()
      const order: string[] = []

      queue.enqueue(async () => {
        await delay(20)
        order.push('task-1')
      })
      queue.enqueue(async () => {
        order.push('task-2')
      })

      await queue.drainAndClose()

      expect(order).toEqual(['task-1', 'task-2'])
      expect(queue.isClosed).toBe(true)
    })
  })

  // ── 6. drain() ────────────────────────────────────────
  describe('drain()', () => {
    it('drain() 완료 후 모든 작업이 처리된다', async () => {
      const queue = new SerialQueue()
      const results: number[] = []

      queue.enqueue(async () => { results.push(1) })
      queue.enqueue(async () => { results.push(2) })
      queue.enqueue(async () => { await delay(10); results.push(3) })

      await queue.drain()

      expect(results).toEqual([1, 2, 3])
    })

    it('빈 큐의 drain()은 즉시 완료된다', async () => {
      const queue = new SerialQueue()
      const start = Date.now()
      await queue.drain()
      expect(Date.now() - start).toBeLessThan(50)
    })
  })

  // ── 7. 순서 보장 — 엄격 직렬 검증 ───────────────────
  describe('엄격 직렬 보장 — 중첩 체인 내 실행 순서', () => {
    it('enqueue 안에서 추가 enqueue해도 외부 enqueue 순서를 깨지 않는다', async () => {
      const queue = new SerialQueue()
      const order: string[] = []

      queue.enqueue(async () => {
        order.push('outer-1-start')
        await delay(10)
        order.push('outer-1-end')
      })

      queue.enqueue(async () => {
        order.push('outer-2')
      })

      await queue.drain()

      // outer-1이 완전히 끝난 뒤 outer-2가 시작돼야 한다
      expect(order).toEqual(['outer-1-start', 'outer-1-end', 'outer-2'])
    })
  })
})
