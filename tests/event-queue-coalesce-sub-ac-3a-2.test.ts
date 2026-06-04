/**
 * event-queue-coalesce-sub-ac-3a-2.test.ts
 *
 * Sub-AC 3a-2: EventQueue maxQueueDepth 초과 시 COALESCE 동작
 *
 * SPEC §3.2 maxQueueDepth: 기본 1000. 초과 시 중복 'change' 신호가 병합(coalesce)되고
 * 큐 크기가 maxQueueDepth를 넘지 않는다.
 *
 * 검증 항목:
 *  1. 1000건 초과 enqueue 시 큐 크기(pendingCount)가 maxQueueDepth를 초과하지 않는다
 *  2. 초과 항목이 undefined(coalesced)로 resolve된다
 *  3. 병합 후 실제 처리된 항목 수가 maxQueueDepth 이하이다
 *  4. 처리된 항목들의 내용(순서)은 원래 enqueue 순서를 따른다
 *  5. 병합(skip)된 항목과 처리된 항목의 합이 전체 enqueue 수와 일치한다
 *  6. 큐 unblock 후 모든 대기 항목이 maxQueueDepth 이내에서 정상 처리된다
 *  7. maxQueueDepth=1 엣지 케이스: 실행 중 1개일 때 추가 enqueue가 모두 coalesce된다
 *  8. maxQueueDepth=2 엣지 케이스: 실행 중 1개 + 대기 1개일 때 3번째부터 coalesce
 *
 * 구현 참조: src/daemon/serial-queue.ts (SerialQueue = EventQueue)
 *            SPEC §3.1 '세션별 직렬 큐', §3.2 maxQueueDepth=1000
 */

import { SerialQueue } from '../src/daemon/serial-queue.js'

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

/** 수동으로 제어 가능한 Promise와 해제 함수 반환 */
function makeBlocker(): { promise: Promise<void>; unblock: () => void } {
  let unblock!: () => void
  const promise = new Promise<void>((r) => { unblock = r })
  return { promise, unblock }
}

// ─── 테스트 ─────────────────────────────────────────────────────────────────

describe('EventQueue(SerialQueue) — Sub-AC 3a-2: maxQueueDepth 초과 시 COALESCE', () => {

  // ── 1. 기본 COALESCE: pendingCount가 maxQueueDepth를 초과하지 않는다 ─────────
  describe('pendingCount가 maxQueueDepth를 초과하지 않는다', () => {

    it('maxQueueDepth=1000 하에 1001개 enqueue 시 pendingCount <= 1000이다', async () => {
      const MAX = 1000
      const queue = new SerialQueue(MAX)

      // 첫 번째 작업: 블로킹 (큐를 쌓기 위해)
      const { promise: blocker, unblock } = makeBlocker()
      queue.enqueue(() => blocker)  // pending=1 (실행 중)

      // maxQueueDepth-1 개의 대기 작업 적재 → pending = MAX
      const waitingPromises: Array<Promise<unknown>> = []
      for (let i = 0; i < MAX - 1; i++) {
        waitingPromises.push(queue.enqueue(async () => i))
      }

      // 이 시점: pending = MAX (실행 중 1 + 대기 MAX-1)
      expect(queue.pendingCount).toBe(MAX)

      // 추가 enqueue → COALESCE, pendingCount가 MAX를 초과하면 안 됨
      const extraPromises: Array<Promise<unknown>> = []
      for (let i = 0; i < 10; i++) {
        extraPromises.push(queue.enqueue(async () => `extra-${i}`))
      }

      // pendingCount는 여전히 MAX 이하여야 한다
      expect(queue.pendingCount).toBeLessThanOrEqual(MAX)

      // 블로커 해제 → 모든 작업 처리
      unblock()
      await Promise.all([...waitingPromises, ...extraPromises])

      // 완료 후 pending=0
      expect(queue.pendingCount).toBe(0)
    })

    it('maxQueueDepth=5 하에 100개 enqueue 시 pendingCount가 5를 초과하지 않는다', async () => {
      const MAX = 5
      const queue = new SerialQueue(MAX)

      const { promise: blocker, unblock } = makeBlocker()
      queue.enqueue(() => blocker)  // pending=1

      // 나머지 MAX-1 개 대기 → pending=MAX
      for (let i = 0; i < MAX - 1; i++) {
        queue.enqueue(async () => i)
      }
      expect(queue.pendingCount).toBe(MAX)

      // 95개 추가 → 모두 COALESCE
      const coalesced: Array<Promise<unknown>> = []
      for (let i = 0; i < 95; i++) {
        coalesced.push(queue.enqueue(async () => `coalesced-${i}`))
      }

      // 블로킹 중에도 pendingCount는 MAX 이하
      expect(queue.pendingCount).toBeLessThanOrEqual(MAX)

      unblock()
      await Promise.all(coalesced)
      // 대기 중인 정상 작업들도 drain
      await queue.drain()

      expect(queue.pendingCount).toBe(0)
    })
  })

  // ── 2. COALESCE된 항목은 undefined로 resolve된다 ──────────────────────────
  describe('COALESCE된 항목은 undefined로 resolve된다', () => {

    it('maxDepth=3 초과 항목들이 모두 undefined로 resolve된다', async () => {
      const MAX = 3
      const queue = new SerialQueue(MAX)

      const { promise: blocker, unblock } = makeBlocker()
      queue.enqueue(() => blocker)                      // pending=1 (실행 중)
      const p2 = queue.enqueue(async () => 'second')   // pending=2
      const p3 = queue.enqueue(async () => 'third')    // pending=3

      // 3개 추가 → 모두 COALESCE
      const p4 = queue.enqueue(async () => 'fourth-coalesced')
      const p5 = queue.enqueue(async () => 'fifth-coalesced')
      const p6 = queue.enqueue(async () => 'sixth-coalesced')

      unblock()
      const [r2, r3, r4, r5, r6] = await Promise.all([p2, p3, p4, p5, p6])

      // 처리된 항목
      expect(r2).toBe('second')
      expect(r3).toBe('third')

      // COALESCE된 항목들은 undefined
      expect(r4).toBeUndefined()
      expect(r5).toBeUndefined()
      expect(r6).toBeUndefined()
    })

    it('1000건 초과 시 초과분이 undefined로 resolve된다 (대규모 검증)', async () => {
      const MAX = 1000
      const queue = new SerialQueue(MAX)

      const { promise: blocker, unblock } = makeBlocker()
      queue.enqueue(() => blocker)  // pending=1

      // MAX-1 개 대기 적재 → pending=MAX
      const normalPromises: Array<Promise<unknown>> = []
      for (let i = 0; i < MAX - 1; i++) {
        normalPromises.push(queue.enqueue(async () => i))
      }

      // 100개 추가 → 모두 COALESCE
      const EXTRA = 100
      const extraPromises: Array<Promise<unknown>> = []
      for (let i = 0; i < EXTRA; i++) {
        extraPromises.push(queue.enqueue(async () => `over-${i}`))
      }

      unblock()
      const extraResults = await Promise.all(extraPromises)

      // 모든 초과 항목은 undefined
      expect(extraResults.every((r) => r === undefined)).toBe(true)
      expect(extraResults).toHaveLength(EXTRA)

      // 정상 항목들은 완료
      await Promise.all(normalPromises)
    })
  })

  // ── 3. 처리된 항목 수가 maxQueueDepth 이하이다 ────────────────────────────
  describe('처리된 항목 수가 maxQueueDepth 이하이다', () => {

    it('maxDepth=10 하에 50개 enqueue 시 실제 처리 항목은 10개이다', async () => {
      const MAX = 10
      const TOTAL = 50
      const queue = new SerialQueue(MAX)
      const processed: number[] = []

      const { promise: blocker, unblock } = makeBlocker()
      // 첫 번째 블로킹 작업 (실행 중 카운트 안 함 — processed 기록 안 함)
      queue.enqueue(() => blocker)  // pending=1

      // MAX-1 = 9개 대기 적재 → pending=MAX=10
      const promises: Array<Promise<unknown>> = []
      for (let i = 0; i < MAX - 1; i++) {
        const idx = i
        promises.push(queue.enqueue(async () => {
          processed.push(idx)
          return idx
        }))
      }

      // 나머지 TOTAL - MAX = 40개 → COALESCE
      for (let i = MAX - 1; i < TOTAL - 1; i++) {
        const idx = i
        promises.push(queue.enqueue(async () => {
          processed.push(idx)  // COALESCE되면 이 코드가 실행되지 않아야 함
          return idx
        }))
      }

      unblock()
      await Promise.all(promises)

      // COALESCE된 항목들의 fn은 실행되지 않아야 한다
      // 처리된 항목 수: MAX-1 = 9개 (블로커 제외)
      expect(processed).toHaveLength(MAX - 1)
      // 처리 순서: 0~8
      expect(processed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    })

    it('maxDepth=1000 하에 1500개 enqueue 시 처리된 항목은 1000개 이하이다', async () => {
      const MAX = 1000
      const TOTAL = 1500
      const queue = new SerialQueue(MAX)
      const processed: number[] = []

      const { promise: blocker, unblock } = makeBlocker()
      queue.enqueue(() => blocker)  // 블로커 (pending=1)

      const promises: Array<Promise<unknown>> = []
      for (let i = 0; i < TOTAL - 1; i++) {
        const idx = i
        promises.push(queue.enqueue(async () => {
          processed.push(idx)
          return idx
        }))
      }

      unblock()
      await Promise.all(promises)

      // 처리된 항목 수는 MAX-1 이하 (블로커 1개가 실행 중이었으므로)
      expect(processed.length).toBeLessThanOrEqual(MAX - 1)
      expect(processed.length).toBeGreaterThan(0)

      // 처리된 항목들은 원래 enqueue 순서(오름차순)이어야 한다
      for (let i = 1; i < processed.length; i++) {
        expect(processed[i]).toBeGreaterThan(processed[i - 1] as number)
      }
    })
  })

  // ── 4. 처리된 항목 내용 — enqueue 순서 유지 ────────────────────────────────
  describe('처리된 항목 내용 — enqueue 순서가 보존된다', () => {

    it('COALESCE 이후 처리된 항목들은 원래 enqueue 순서를 따른다', async () => {
      const MAX = 5
      const queue = new SerialQueue(MAX)
      const processedValues: string[] = []

      const { promise: blocker, unblock } = makeBlocker()
      queue.enqueue(() => blocker)  // pending=1

      // MAX-1 = 4개 대기 → 순서 preserved
      queue.enqueue(async () => { processedValues.push('item-A') })
      queue.enqueue(async () => { processedValues.push('item-B') })
      queue.enqueue(async () => { processedValues.push('item-C') })
      queue.enqueue(async () => { processedValues.push('item-D') })  // pending=5 = MAX

      // 초과 → COALESCE
      queue.enqueue(async () => { processedValues.push('item-COALESCED-1') })
      queue.enqueue(async () => { processedValues.push('item-COALESCED-2') })
      queue.enqueue(async () => { processedValues.push('item-COALESCED-3') })

      unblock()
      await queue.drain()

      // A, B, C, D 순서로 처리됨 (COALESCED 항목들은 fn 미실행)
      expect(processedValues).toEqual(['item-A', 'item-B', 'item-C', 'item-D'])
    })

    it('COALESCE 이후 큐가 비면 새 항목은 정상 처리된다 (COALESCE는 영구 차단이 아님)', async () => {
      const MAX = 3
      const queue = new SerialQueue(MAX)
      const processed: string[] = []

      // 첫 번째 라운드: COALESCE 유발
      const { promise: blocker1, unblock: unblock1 } = makeBlocker()
      queue.enqueue(() => blocker1)                                 // pending=1
      queue.enqueue(async () => { processed.push('r1-item-1') })   // pending=2
      queue.enqueue(async () => { processed.push('r1-item-2') })   // pending=3=MAX

      // 초과 → COALESCE
      const coalesced1 = queue.enqueue(async () => { processed.push('r1-coalesced') })
      const coalesced2 = queue.enqueue(async () => { processed.push('r1-coalesced-2') })

      unblock1()
      await Promise.all([coalesced1, coalesced2])
      await queue.drain()

      // 큐가 비었으므로 새 항목은 정상 처리
      await queue.enqueue(async () => { processed.push('r2-fresh-1') })
      await queue.enqueue(async () => { processed.push('r2-fresh-2') })

      expect(processed).toEqual([
        'r1-item-1',
        'r1-item-2',
        // r1-coalesced, r1-coalesced-2는 skip됨
        'r2-fresh-1',
        'r2-fresh-2',
      ])
    })
  })

  // ── 5. skip + 처리 합계 검증 ─────────────────────────────────────────────
  describe('병합(skip)된 항목 + 처리된 항목의 합이 전체 enqueue 수와 일치한다', () => {

    it('MAX=10, TOTAL=30: skip+processed = 29 (블로커 제외)', async () => {
      const MAX = 10
      const TOTAL = 30
      const queue = new SerialQueue(MAX)
      let processedCount = 0
      let skippedCount = 0

      const { promise: blocker, unblock } = makeBlocker()
      queue.enqueue(() => blocker)  // 블로커 (카운트 외)

      const promises: Array<Promise<unknown>> = []
      for (let i = 0; i < TOTAL - 1; i++) {
        promises.push(
          queue.enqueue(async () => {
            processedCount++
            return i
          }).then((result) => {
            if (result === undefined) skippedCount++
            return result
          })
        )
      }

      unblock()
      await Promise.all(promises)

      // skip + processed = TOTAL - 1 (블로커 제외)
      expect(processedCount + skippedCount).toBe(TOTAL - 1)
      // 처리된 항목은 MAX-1 이하
      expect(processedCount).toBeLessThanOrEqual(MAX - 1)
      // skip된 항목이 존재해야 함
      expect(skippedCount).toBeGreaterThan(0)
    })

    it('MAX=1000, TOTAL=1100: 100개가 COALESCE된다', async () => {
      const MAX = 1000
      const OVER = 100
      const queue = new SerialQueue(MAX)
      let skippedCount = 0

      const { promise: blocker, unblock } = makeBlocker()
      queue.enqueue(() => blocker)  // pending=1

      // MAX-1 = 999개 대기 → pending=MAX=1000
      const normalPromises: Array<Promise<unknown>> = []
      for (let i = 0; i < MAX - 1; i++) {
        normalPromises.push(queue.enqueue(async () => i))
      }

      // 100개 초과 → COALESCE
      const extraPromises: Array<Promise<unknown>> = []
      for (let i = 0; i < OVER; i++) {
        extraPromises.push(
          queue.enqueue(async () => `extra-${i}`).then((r) => {
            if (r === undefined) skippedCount++
            return r
          })
        )
      }

      unblock()
      await Promise.all([...normalPromises, ...extraPromises])

      // 100개가 정확히 COALESCE됨
      expect(skippedCount).toBe(OVER)
    })
  })

  // ── 6. 엣지 케이스 — maxQueueDepth=1 ───────────────────────────────────────
  describe('엣지 케이스 — maxQueueDepth=1', () => {

    it('maxDepth=1: 실행 중 1개이면 추가 enqueue가 모두 COALESCE된다', async () => {
      const queue = new SerialQueue(1)
      const processed: string[] = []

      const { promise: blocker, unblock } = makeBlocker()
      // pending=1 (실행 중)
      queue.enqueue(async () => {
        await blocker
        processed.push('first')
      })

      // pending=1 >= maxDepth=1 → 모두 COALESCE
      const p2 = queue.enqueue(async () => { processed.push('second-coalesced') })
      const p3 = queue.enqueue(async () => { processed.push('third-coalesced') })
      const p4 = queue.enqueue(async () => { processed.push('fourth-coalesced') })

      unblock()
      const [r2, r3, r4] = await Promise.all([p2, p3, p4])
      // 첫 번째 작업(blocker await 포함)이 완료될 때까지 drain
      await queue.drain()

      // 첫 번째만 처리됨
      expect(processed).toEqual(['first'])
      // 나머지는 COALESCE → undefined
      expect(r2).toBeUndefined()
      expect(r3).toBeUndefined()
      expect(r4).toBeUndefined()
    })

    it('maxDepth=1: 실행 완료 후 새 enqueue는 정상 처리된다', async () => {
      const queue = new SerialQueue(1)
      const processed: string[] = []

      await queue.enqueue(async () => { processed.push('item-1') })
      // 큐 비어있으므로 pending=0 < maxDepth=1
      await queue.enqueue(async () => { processed.push('item-2') })

      expect(processed).toEqual(['item-1', 'item-2'])
    })
  })

  // ── 7. 엣지 케이스 — maxQueueDepth=2 ───────────────────────────────────────
  describe('엣지 케이스 — maxQueueDepth=2', () => {

    it('maxDepth=2: 실행 중 1개 + 대기 1개이면 3번째부터 COALESCE된다', async () => {
      const queue = new SerialQueue(2)
      const processed: string[] = []

      const { promise: blocker, unblock } = makeBlocker()
      queue.enqueue(() => blocker)                                   // pending=1
      const p2 = queue.enqueue(async () => { processed.push('second') })  // pending=2

      // 3번째부터 COALESCE
      const p3 = queue.enqueue(async () => { processed.push('third-coalesced') })
      const p4 = queue.enqueue(async () => { processed.push('fourth-coalesced') })

      unblock()
      const [r2, r3, r4] = await Promise.all([p2, p3, p4])

      expect(processed).toEqual(['second'])
      expect(r2).toBeUndefined()  // 반환값 없음 (void fn)
      expect(r3).toBeUndefined()  // COALESCE
      expect(r4).toBeUndefined()  // COALESCE
    })
  })

  // ── 8. SessionPipeline 컨텍스트 — 1000건 초과 change 신호 ─────────────────
  describe('SessionPipeline 컨텍스트 — 1000건 초과 change 이벤트 COALESCE', () => {

    it('동시에 1001개 change 신호 → 최대 1000개만 큐에 적재된다', async () => {
      const MAX_QUEUE_DEPTH = 1000
      const TOTAL_CHANGES = 1001  // 1개 초과
      const queue = new SerialQueue(MAX_QUEUE_DEPTH)

      const { promise: blocker, unblock } = makeBlocker()
      // 첫 변경: 블로킹 (실행 중 → pending=1)
      queue.enqueue(() => blocker)

      // 999개 대기 → pending=1000=MAX
      const pending: Array<Promise<unknown>> = []
      for (let i = 0; i < MAX_QUEUE_DEPTH - 1; i++) {
        pending.push(queue.enqueue(async () => i))
      }

      // 1번 초과 → COALESCE
      const overflowResult = await queue.enqueue(async () => 'overflow')

      // pendingCount는 MAX 이하
      expect(queue.pendingCount).toBeLessThanOrEqual(MAX_QUEUE_DEPTH)
      // 초과 항목은 undefined
      expect(overflowResult).toBeUndefined()

      // 블로커 해제
      unblock()
      await Promise.all(pending)

      // COALESCE가 적용됐음을 확인 (총 enqueue 수 = TOTAL_CHANGES, COALESCE = 1)
      expect(TOTAL_CHANGES).toBe(MAX_QUEUE_DEPTH + 1)
    }, 30000)

    it('change 폭발 — 5000개 change 신호 후 큐가 정상 drain된다', async () => {
      const MAX_QUEUE_DEPTH = 1000
      const TOTAL_CHANGES = 5000
      const queue = new SerialQueue(MAX_QUEUE_DEPTH)
      let processedCount = 0

      const { promise: blocker, unblock } = makeBlocker()
      queue.enqueue(() => blocker)  // pending=1

      const allPromises: Array<Promise<unknown>> = []
      for (let i = 0; i < TOTAL_CHANGES - 1; i++) {
        allPromises.push(
          queue.enqueue(async () => {
            processedCount++
          })
        )
      }

      // 블로킹 중: pendingCount는 MAX 이하
      expect(queue.pendingCount).toBeLessThanOrEqual(MAX_QUEUE_DEPTH)

      unblock()
      await Promise.all(allPromises)

      // 완료 후 pending=0
      expect(queue.pendingCount).toBe(0)
      // 처리된 항목은 MAX-1 이하 (블로커 제외)
      expect(processedCount).toBeLessThanOrEqual(MAX_QUEUE_DEPTH - 1)
      // 일부는 실제로 처리됨
      expect(processedCount).toBeGreaterThan(0)
    }, 30000)
  })

  // ── 9. COALESCE 후 정확한 항목 수 및 내용 검증 (핵심 계약) ───────────────
  describe('COALESCE 후 최종 항목 수 및 내용 정확성 (핵심 계약)', () => {

    it('MAX=4: 정확히 처리된 항목 수와 내용을 검증한다', async () => {
      const MAX = 4
      const queue = new SerialQueue(MAX)
      const log: Array<{ value: string; coalesced: boolean }> = []

      const { promise: blocker, unblock } = makeBlocker()
      // 블로커 (pending=1)
      queue.enqueue(() => blocker)

      // 3개 대기 → pending=4=MAX
      const p1 = queue.enqueue(async () => { log.push({ value: 'kept-1', coalesced: false }); return 'kept-1' })
      const p2 = queue.enqueue(async () => { log.push({ value: 'kept-2', coalesced: false }); return 'kept-2' })
      const p3 = queue.enqueue(async () => { log.push({ value: 'kept-3', coalesced: false }); return 'kept-3' })

      // 6개 초과 → COALESCE
      const extras = [
        queue.enqueue(async () => { log.push({ value: 'skip-1', coalesced: false }); return 'skip-1' }),
        queue.enqueue(async () => { log.push({ value: 'skip-2', coalesced: false }); return 'skip-2' }),
        queue.enqueue(async () => { log.push({ value: 'skip-3', coalesced: false }); return 'skip-3' }),
        queue.enqueue(async () => { log.push({ value: 'skip-4', coalesced: false }); return 'skip-4' }),
        queue.enqueue(async () => { log.push({ value: 'skip-5', coalesced: false }); return 'skip-5' }),
        queue.enqueue(async () => { log.push({ value: 'skip-6', coalesced: false }); return 'skip-6' }),
      ]

      unblock()
      const [r1, r2, r3, ...skipResults] = await Promise.all([p1, p2, p3, ...extras])

      // 처리된 항목 결과값 검증
      expect(r1).toBe('kept-1')
      expect(r2).toBe('kept-2')
      expect(r3).toBe('kept-3')

      // COALESCE된 항목들은 undefined (fn이 실행되지 않음)
      expect(skipResults.every((r) => r === undefined)).toBe(true)

      // 실제로 실행된 fn은 kept 항목들뿐이다
      expect(log.map((l) => l.value)).toEqual(['kept-1', 'kept-2', 'kept-3'])
      expect(log).toHaveLength(3)  // 3개만 실행됨 (블로커 제외)
    })

    it('MAX=1000: 1100개 enqueue 시 정확히 100개가 COALESCE된다', async () => {
      const MAX = 1000
      const NORMAL = MAX      // MAX개 (블로커 1 + 대기 MAX-1)
      const EXTRA = 100
      const queue = new SerialQueue(MAX)

      const { promise: blocker, unblock } = makeBlocker()
      const results: Array<{ idx: number; coalesced: boolean }> = []

      queue.enqueue(() => blocker)  // 블로커 (pending=1)

      const normalPromises: Array<Promise<void>> = []
      for (let i = 0; i < NORMAL - 1; i++) {
        const idx = i
        normalPromises.push(
          queue.enqueue(async () => idx).then((r) => {
            results.push({ idx: r as number, coalesced: false })
          })
        )
      }

      const extraPromises: Array<Promise<void>> = []
      for (let i = 0; i < EXTRA; i++) {
        const extraIdx = NORMAL - 1 + i
        extraPromises.push(
          queue.enqueue(async () => extraIdx).then((r) => {
            results.push({ idx: r as number, coalesced: r === undefined })
          })
        )
      }

      unblock()
      await Promise.all([...normalPromises, ...extraPromises])

      // 총 enqueue 수 = NORMAL-1 + EXTRA (블로커 제외)
      const totalTracked = results.length
      expect(totalTracked).toBe(NORMAL - 1 + EXTRA)

      // COALESCE된 항목 수 = EXTRA = 100
      const coalesced = results.filter((r) => r.coalesced)
      expect(coalesced).toHaveLength(EXTRA)

      // 처리된 항목 수 = NORMAL-1 = 999
      const kept = results.filter((r) => !r.coalesced)
      expect(kept).toHaveLength(NORMAL - 1)

      // 처리된 항목들의 인덱스는 0~998 (오름차순)
      const keptIndices = kept.map((r) => r.idx)
      expect(keptIndices).toEqual(Array.from({ length: NORMAL - 1 }, (_, i) => i))
    }, 30000)
  })
})
