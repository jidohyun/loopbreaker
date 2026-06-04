/**
 * event-queue-serial-sub-ac-3a-1.test.ts
 *
 * Sub-AC 3a-1: EventQueue 직렬 실행 보장
 *
 * SPEC §3.1 '세션별 직렬 큐': concurrency=1 설정 하에 enqueue 호출이
 * 동시에 여러 번 들어와도 핸들러가 항상 순차(직렬)로 실행됨을 검증한다.
 *
 * 검증 항목:
 *  1. 실행 순서 보장 — 핸들러가 enqueue 순서대로 실행된다
 *  2. 동시 실행 없음 — activeCount가 항상 0 또는 1이다 (동시 2이상 불가)
 *  3. 이전 핸들러 완료 후 다음 핸들러 시작 — 중첩 실행 불가
 *  4. 지연 시간이 서로 달라도 enqueue 순서가 완전히 보장된다
 *  5. 예외가 발생해도 후속 핸들러가 정상 실행된다 (직렬 보장 유지)
 *
 * 구현 참조: src/daemon/serial-queue.ts (SerialQueue = EventQueue)
 *            src/daemon/session-pipeline.ts (SessionPipeline이 SerialQueue 사용)
 */

import { SerialQueue } from '../src/daemon/serial-queue.js'

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

/** ms만큼 대기하는 Promise */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ─── 테스트 ─────────────────────────────────────────────────────────────────

describe('EventQueue(SerialQueue) — Sub-AC 3a-1: concurrency=1 직렬 실행 보장', () => {

  // ── 1. 핸들러 실행 순서 보장 ────────────────────────────────────────────────
  describe('핸들러 실행 순서 — enqueue 호출 순서와 정확히 일치', () => {

    it('세 핸들러가 동시에 enqueue돼도 실행 순서는 1→2→3이다', async () => {
      const queue = new SerialQueue()  // concurrency=1 (기본값)
      const executionOrder: number[] = []

      // 지연 시간이 역순이어도 enqueue 순서를 따른다
      const p1 = queue.enqueue(async () => { await delay(30); executionOrder.push(1) })
      const p2 = queue.enqueue(async () => { await delay(10); executionOrder.push(2) })
      const p3 = queue.enqueue(async () => { await delay(20); executionOrder.push(3) })

      await Promise.all([p1, p2, p3])

      expect(executionOrder).toEqual([1, 2, 3])
    })

    it('10개 핸들러: 랜덤 지연에도 enqueue 순서(0~9)가 보장된다', async () => {
      const queue = new SerialQueue()
      const order: number[] = []
      // 지연: [20,5,15,1,30,2,25,8,12,3] — 완료 순서는 직렬이 아니면 뒤섞임
      const delays = [20, 5, 15, 1, 30, 2, 25, 8, 12, 3]

      const promises = delays.map((d, i) =>
        queue.enqueue(async () => {
          await delay(d)
          order.push(i)
        }),
      )

      await Promise.all(promises)

      expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })

    it('동시에 enqueue된 핸들러들이 FIFO(선입선출) 순서를 따른다', async () => {
      const queue = new SerialQueue()
      const log: string[] = []

      // 모두 동일한 틱(tick)에 enqueue — 비동기 실행이더라도 순서 보장
      const promises = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((name) =>
        queue.enqueue(async () => {
          await delay(0)  // microtask yield
          log.push(name)
        }),
      )

      await Promise.all(promises)

      expect(log).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon'])
    })
  })

  // ── 2. 동시 실행 없음 — activeCount가 항상 0 또는 1 ────────────────────────
  describe('동시 실행 없음 — 동시에 활성 핸들러가 2개 이상이 되지 않는다', () => {

    it('activeCount가 항상 0 또는 1이다 (동시 실행 절대 불가)', async () => {
      const queue = new SerialQueue()
      let activeCount = 0
      let maxActiveCount = 0    // 관찰된 최대 동시 활성 수
      let concurrencyViolation = false  // 2개 이상 동시 실행 감지

      const N = 15
      const promises = Array.from({ length: N }, (_, i) =>
        queue.enqueue(async () => {
          activeCount++
          if (activeCount > 1) {
            concurrencyViolation = true   // 동시 실행 감지
          }
          maxActiveCount = Math.max(maxActiveCount, activeCount)

          // 서로 다른 지연으로 실행 — 직렬이 아니면 겹침 발생
          await delay(i % 3 === 0 ? 10 : 2)

          activeCount--
        }),
      )

      await Promise.all(promises)

      // 동시 실행이 없어야 한다
      expect(concurrencyViolation).toBe(false)
      // 최대 동시 실행은 1개여야 한다 (concurrency=1)
      expect(maxActiveCount).toBe(1)
      // 완료 후 activeCount는 0이어야 한다
      expect(activeCount).toBe(0)
    })

    it('실행 중인 핸들러가 완전히 끝난 뒤에만 다음 핸들러가 시작된다', async () => {
      const queue = new SerialQueue()
      const timeline: Array<{ event: 'start' | 'end'; index: number }> = []

      const N = 5
      const promises = Array.from({ length: N }, (_, i) =>
        queue.enqueue(async () => {
          timeline.push({ event: 'start', index: i })
          await delay(10)
          timeline.push({ event: 'end', index: i })
        }),
      )

      await Promise.all(promises)

      // 타임라인 패턴 검증: start(i) 다음 end(i) 다음 start(i+1)
      // 즉, 이전 핸들러의 end가 다음 핸들러의 start보다 반드시 앞서야 한다
      for (let i = 0; i < N - 1; i++) {
        const endOfCurrent = timeline.findIndex(
          (e) => e.event === 'end' && e.index === i,
        )
        const startOfNext = timeline.findIndex(
          (e) => e.event === 'start' && e.index === i + 1,
        )
        // end(i)가 start(i+1)보다 앞에 있어야 한다
        expect(endOfCurrent).toBeLessThan(startOfNext)
      }

      // 전체 타임라인은 start-end 쌍이 N개씩 완전히 중첩되지 않는다
      expect(timeline).toHaveLength(N * 2)
    })

    it('단일 핸들러가 실행 중일 때 다음 핸들러는 대기 상태이다', async () => {
      const queue = new SerialQueue()
      let firstHandlerRunning = false
      let secondStartedWhileFirstRunning = false

      // 첫 번째 핸들러: 명시적으로 오래 실행
      const p1 = queue.enqueue(async () => {
        firstHandlerRunning = true
        await delay(50)
        firstHandlerRunning = false
      })

      // 두 번째 핸들러: 시작 시 첫 번째가 완전히 끝났는지 확인
      const p2 = queue.enqueue(async () => {
        if (firstHandlerRunning) {
          secondStartedWhileFirstRunning = true
        }
      })

      await Promise.all([p1, p2])

      // 두 번째 핸들러가 시작될 때 첫 번째는 이미 끝난 상태여야 한다
      expect(secondStartedWhileFirstRunning).toBe(false)
      expect(firstHandlerRunning).toBe(false)
    })
  })

  // ── 3. 지연 독립성 — 어떤 지연 패턴이어도 직렬 보장 ───────────────────────
  describe('지연 독립성 — 지연 패턴에 관계없이 순서가 보장된다', () => {

    it('긴 작업→짧은 작업→긴 작업 패턴에서도 enqueue 순서가 보장된다', async () => {
      const queue = new SerialQueue()
      const order: string[] = []

      await Promise.all([
        queue.enqueue(async () => { await delay(40); order.push('long-1') }),
        queue.enqueue(async () => { await delay(2);  order.push('short') }),
        queue.enqueue(async () => { await delay(30); order.push('long-2') }),
      ])

      expect(order).toEqual(['long-1', 'short', 'long-2'])
    })

    it('모든 핸들러가 동기(await 없음)여도 순서가 보장된다', async () => {
      const queue = new SerialQueue()
      const order: number[] = []

      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          queue.enqueue(async () => { order.push(i) }),
        ),
      )

      expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    })
  })

  // ── 4. 예외 발생 시 직렬 보장 유지 ────────────────────────────────────────
  describe('예외 발생 후에도 직렬 실행 보장이 유지된다', () => {

    it('예외 핸들러 이후 핸들러들이 정상 직렬 실행된다', async () => {
      const queue = new SerialQueue()
      const order: string[] = []
      let activeCount = 0
      let concurrencyViolation = false

      const pOk1 = queue.enqueue(async () => {
        activeCount++
        if (activeCount > 1) concurrencyViolation = true
        order.push('ok-1')
        await delay(10)
        activeCount--
      })

      const pErr = queue.enqueue(async () => {
        activeCount++
        if (activeCount > 1) concurrencyViolation = true
        order.push('error')
        await delay(5)
        activeCount--
        throw new Error('intentional')
      })

      const pOk2 = queue.enqueue(async () => {
        activeCount++
        if (activeCount > 1) concurrencyViolation = true
        order.push('ok-2')
        await delay(8)
        activeCount--
      })

      const pOk3 = queue.enqueue(async () => {
        activeCount++
        if (activeCount > 1) concurrencyViolation = true
        order.push('ok-3')
        activeCount--
      })

      await pOk1
      await expect(pErr).rejects.toThrow('intentional')
      await pOk2
      await pOk3

      // 순서 보장
      expect(order).toEqual(['ok-1', 'error', 'ok-2', 'ok-3'])
      // 예외 발생 후에도 동시 실행 없음
      expect(concurrencyViolation).toBe(false)
      expect(activeCount).toBe(0)
    })

    it('연속 예외가 발생해도 직렬 순서와 동시 실행 없음이 유지된다', async () => {
      const queue = new SerialQueue()
      const starts: number[] = []
      const ends: number[] = []
      let activeCount = 0
      let maxActive = 0

      const tasks = Array.from({ length: 6 }, (_, i) =>
        queue.enqueue(async () => {
          activeCount++
          maxActive = Math.max(maxActive, activeCount)
          starts.push(i)
          await delay(5)
          ends.push(i)
          activeCount--
          if (i % 2 === 1) throw new Error(`error-${i}`)  // 홀수 인덱스에서 예외
        }),
      )

      await Promise.allSettled(tasks)

      // 시작 순서와 종료 순서가 모두 0→5로 일치 (직렬)
      expect(starts).toEqual([0, 1, 2, 3, 4, 5])
      expect(ends).toEqual([0, 1, 2, 3, 4, 5])
      // 동시 실행 없음
      expect(maxActive).toBe(1)
      expect(activeCount).toBe(0)
    })
  })

  // ── 5. SessionPipeline 컨텍스트 — change 이벤트 직렬 처리 시뮬레이션 ───────
  describe('SessionPipeline 컨텍스트 시뮬레이션 — change 이벤트 직렬 처리', () => {

    it('여러 change 이벤트가 동시 도착해도 핸들러가 직렬 처리된다', async () => {
      // SessionPipeline.enqueueChange()가 내부 SerialQueue에 위임하는 패턴을
      // 동등하게 시뮬레이션한다. 실제 파일 I/O 없이 로직만 검증.
      const queue = new SerialQueue()   // = SessionPipeline 내부 _queue
      const processedChanges: number[] = []
      let activeHandlers = 0
      let concurrencyViolation = false

      // 10개의 'change' 이벤트가 거의 동시에 도착
      const changeEvents = Array.from({ length: 10 }, (_, i) => i)

      const promises = changeEvents.map((changeId) =>
        queue.enqueue(async () => {
          // _processChange() 역할
          activeHandlers++
          if (activeHandlers > 1) concurrencyViolation = true

          // 비동기 I/O 시뮬레이션 (파일 읽기, DB 쓰기 등)
          await delay(changeId % 3 === 0 ? 15 : 5)

          processedChanges.push(changeId)
          activeHandlers--
        }),
      )

      await Promise.all(promises)

      // 처리 순서: change 도착 순서와 동일
      expect(processedChanges).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
      // 동시 처리 없음 (SPEC §3.1 concurrency=1)
      expect(concurrencyViolation).toBe(false)
      expect(activeHandlers).toBe(0)
    })

    it('COALESCE: maxDepth=3 하에 4번째 change는 skip된다 (직렬 보장 유지)', async () => {
      // SPEC §3.2 maxQueueDepth 초과 시 COALESCE — 실행 중 1개 + 대기 2개 = 3
      // 4번째 change는 skip되어 undefined로 resolve된다.
      const queue = new SerialQueue(3)
      const processed: string[] = []

      let unblockFirst!: () => void
      const firstBlocked = new Promise<void>((r) => { unblockFirst = r })

      // 첫 번째: 블로킹 (pending=1, running)
      const p1 = queue.enqueue(async () => {
        await firstBlocked
        processed.push('change-1')
      })

      // 두 번째, 세 번째: 대기 (pending=2, 3)
      const p2 = queue.enqueue(async () => { processed.push('change-2') })
      const p3 = queue.enqueue(async () => { processed.push('change-3') })

      // 네 번째: COALESCE (pending=3 >= maxDepth=3)
      const p4 = queue.enqueue(async () => { processed.push('change-4-should-skip') })

      // 블로킹 해제
      unblockFirst()
      await Promise.all([p1, p2, p3, p4])

      // 1, 2, 3만 처리되고 4는 skip
      expect(processed).toEqual(['change-1', 'change-2', 'change-3'])
      // p4는 COALESCE로 undefined 반환
      expect(await p4).toBeUndefined()
    })

    it('drainAndClose 후 새 change enqueue는 거부된다 (세션 종료)', async () => {
      const queue = new SerialQueue()
      const processed: string[] = []

      await queue.enqueue(async () => { processed.push('last-change') })
      await queue.drainAndClose()

      // 세션이 닫힌 후 새 change는 reject
      await expect(
        queue.enqueue(async () => { processed.push('after-close') }),
      ).rejects.toThrow('SerialQueue: 큐가 닫혔습니다')

      // 마지막 change만 처리됨
      expect(processed).toEqual(['last-change'])
    })
  })
})
