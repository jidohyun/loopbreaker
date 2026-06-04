/**
 * drain-single-queue-sub-ac-8b-1.test.ts
 *
 * Sub-AC 8b-1: drainSingleQueue 함수 — 단위 테스트
 *
 * 검증 항목:
 *  1. MockQueue(즉시 비워지는 케이스) — 정상 drain 경로
 *  2. 빈 큐(pendingCount=0) — count=0으로 즉시 완료
 *  3. 작업 N개 적재 후 drain — count=N, 모든 작업 완료
 *  4. status는 항상 'drained'
 *  5. drain 완료 후 pendingCount=0 보장
 *  6. 이미 닫힌 큐(isClosed=true) — count=0, 정상 완료
 *  7. 일부 작업이 throw해도 drainSingleQueue가 reject되지 않음 (세션 격리)
 *  8. drain 시점의 pendingCount가 count에 정확히 반영됨
 *
 * 부수효과 정책:
 *  - 실제 파일 감시 없음
 *  - 실제 네트워크 없음
 *  - 실제 OS 알림 없음
 *  - MockQueue: SerialQueue를 직접 사용 (즉시 resolve되는 fn만 enqueue)
 */

import { SerialQueue, drainSingleQueue } from '../src/daemon/serial-queue.js'

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

/** ms만큼 대기하는 Promise */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ─── 테스트 ─────────────────────────────────────────────────────────────────

describe('drainSingleQueue — Sub-AC 8b-1', () => {

  // ── 1. 빈 큐: count=0, 즉시 완료 ──────────────────────────────────────────
  describe('빈 큐 (MockQueue — 즉시 비워지는 케이스)', () => {

    it('빈 SerialQueue를 drain하면 status="drained", count=0을 반환한다', async () => {
      const queue = new SerialQueue()

      const result = await drainSingleQueue(queue)

      expect(result.status).toBe('drained')
      expect(result.count).toBe(0)
    })

    it('빈 큐 drain은 즉시 완료된다 (50ms 미만)', async () => {
      const queue = new SerialQueue()

      const start = Date.now()
      await drainSingleQueue(queue)
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(50)
    })

    it('반환값 shape이 { status: "drained", count: number }이다', async () => {
      const queue = new SerialQueue()
      const result = await drainSingleQueue(queue)

      expect(result).toMatchObject({ status: 'drained', count: expect.any(Number) })
    })
  })

  // ── 2. 작업 N개 적재 후 drain ─────────────────────────────────────────────
  describe('작업 N개 적재 후 drain — count=N, 모든 작업 완료', () => {

    it('즉시 완료되는 작업 3개: count=3, 모두 실행됨', async () => {
      const queue = new SerialQueue()
      const executed: number[] = []

      // enqueue 전에 drainSingleQueue를 호출하면 race가 생기므로,
      // 먼저 작업을 적재한 뒤 drainSingleQueue를 호출한다.
      queue.enqueue(async () => { executed.push(1) })
      queue.enqueue(async () => { executed.push(2) })
      queue.enqueue(async () => { executed.push(3) })

      const result = await drainSingleQueue(queue)

      expect(result.status).toBe('drained')
      expect(result.count).toBe(3)
      expect(executed).toEqual([1, 2, 3])
    })

    it('즉시 완료되는 작업 5개: count=5, 실행 순서 1→5 보장', async () => {
      const queue = new SerialQueue()
      const order: number[] = []

      for (let i = 1; i <= 5; i++) {
        const captured = i
        queue.enqueue(async () => { order.push(captured) })
      }

      const result = await drainSingleQueue(queue)

      expect(result.status).toBe('drained')
      expect(result.count).toBe(5)
      expect(order).toEqual([1, 2, 3, 4, 5])
    })

    it('delay가 있는 작업 2개: drain 완료 후 모두 실행됨', async () => {
      const queue = new SerialQueue()
      const done: string[] = []

      queue.enqueue(async () => { await delay(20); done.push('a') })
      queue.enqueue(async () => { done.push('b') })

      const result = await drainSingleQueue(queue)

      expect(result.status).toBe('drained')
      expect(done).toEqual(['a', 'b'])
    })
  })

  // ── 3. drain 완료 후 pendingCount=0 보장 ──────────────────────────────────
  describe('drain 완료 후 상태 검증', () => {

    it('drain 완료 후 queue.pendingCount가 0이다', async () => {
      const queue = new SerialQueue()

      queue.enqueue(async () => { await delay(10) })
      queue.enqueue(async () => { /* noop */ })

      await drainSingleQueue(queue)

      expect(queue.pendingCount).toBe(0)
    })

    it('drain 완료 후 isClosed는 false (drainSingleQueue는 큐를 닫지 않음)', async () => {
      const queue = new SerialQueue()
      queue.enqueue(async () => { /* noop */ })

      await drainSingleQueue(queue)

      // drainSingleQueue는 drain()만 호출하고 close하지 않으므로
      // isClosed는 그대로 false여야 한다.
      expect(queue.isClosed).toBe(false)
    })

    it('drain 이후 새 작업을 enqueue하고 다시 drain할 수 있다', async () => {
      const queue = new SerialQueue()
      const log: string[] = []

      queue.enqueue(async () => { log.push('first-batch') })
      await drainSingleQueue(queue)

      // 큐가 닫히지 않았으므로 추가 작업 enqueue 가능
      queue.enqueue(async () => { log.push('second-batch') })
      await drainSingleQueue(queue)

      expect(log).toEqual(['first-batch', 'second-batch'])
    })
  })

  // ── 4. 이미 닫힌 큐 ────────────────────────────────────────────────────────
  describe('이미 닫힌 큐 (isClosed=true)', () => {

    it('drainAndClose 이후의 큐를 drainSingleQueue해도 정상 완료된다', async () => {
      const queue = new SerialQueue()
      await queue.drainAndClose()

      // 닫힌 큐도 drain()은 가능 (내부 _chain이 resolved 상태)
      const result = await drainSingleQueue(queue)

      expect(result.status).toBe('drained')
      expect(result.count).toBe(0)
    })
  })

  // ── 5. 세션 격리: 일부 작업 throw ────────────────────────────────────────
  describe('세션 격리 — 일부 작업 throw해도 drainSingleQueue가 reject되지 않음', () => {

    it('중간 작업 throw 시 drainSingleQueue는 resolve된다 (세션 격리)', async () => {
      const queue = new SerialQueue()
      const log: string[] = []

      // 에러 작업의 Promise를 수집하되, await는 하지 않는다
      queue.enqueue(async () => { log.push('before') })
      const failP = queue.enqueue(async () => { throw new Error('intentional') })
      queue.enqueue(async () => { log.push('after') })

      // drainSingleQueue 자체는 reject되어선 안 된다
      await expect(drainSingleQueue(queue)).resolves.toMatchObject({
        status: 'drained',
      })

      // 에러 작업의 Promise는 개별적으로 reject
      await expect(failP).rejects.toThrow('intentional')

      // 에러 전후 작업은 정상 실행
      expect(log).toEqual(['before', 'after'])
    })

    it('모든 작업이 throw해도 drainSingleQueue는 resolve된다', async () => {
      const queue = new SerialQueue()

      // 모든 Promise를 allSettled로 처리
      const p1 = queue.enqueue(async () => { throw new Error('err1') })
      const p2 = queue.enqueue(async () => { throw new Error('err2') })

      const drainResult = await drainSingleQueue(queue)

      expect(drainResult.status).toBe('drained')

      // 개별 에러 확인 (drainSingleQueue 완료 후)
      await expect(p1).rejects.toThrow('err1')
      await expect(p2).rejects.toThrow('err2')
    })
  })

  // ── 6. count 정확성 ─────────────────────────────────────────────────────
  describe('count 정확성 — drain 시점의 pendingCount 반영', () => {

    it('drain 호출 시점의 pendingCount가 count에 정확히 반영된다', async () => {
      // 블로킹 작업으로 큐를 채우고 pendingCount를 확인한 뒤 drain
      const blockResolvers: Array<() => void> = []
      const queue = new SerialQueue()

      const block1 = new Promise<void>((r) => blockResolvers.push(r))
      queue.enqueue(() => block1)   // 실행 중
      queue.enqueue(async () => { /* wait */ })  // 대기 중
      queue.enqueue(async () => { /* wait */ })  // 대기 중

      // pendingCount=3 상태에서 drain 호출
      expect(queue.pendingCount).toBe(3)

      // 블로킹 해제 후 drain
      blockResolvers[0]()
      const result = await drainSingleQueue(queue)

      expect(result.status).toBe('drained')
      // count는 drainSingleQueue 호출 시점의 스냅샷 (3)
      expect(result.count).toBe(3)
    })

    it('단일 작업 큐: count=1을 반환한다', async () => {
      const queue = new SerialQueue()
      queue.enqueue(async () => { /* noop */ })

      const result = await drainSingleQueue(queue)

      expect(result.count).toBe(1)
    })

    it('10개 작업 큐: count=10을 반환한다', async () => {
      const queue = new SerialQueue()
      for (let i = 0; i < 10; i++) {
        queue.enqueue(async () => { /* noop */ })
      }

      const result = await drainSingleQueue(queue)

      expect(result.count).toBe(10)
    })
  })
})
