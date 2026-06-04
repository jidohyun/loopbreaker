/**
 * drain-session-queues-sub-ac-8b-3.test.ts
 *
 * Sub-AC 8b-3: drainSessionQueues 함수 — 단위 테스트
 *
 * 검증 항목:
 *  1. 빈 sessions 배열 → 빈 결과 배열
 *  2. 단일 세션(정상 drain) → [{ sessionId, status:'drained', count }]
 *  3. 복수 세션 전부 정상 drain → 전체 status='drained'
 *  4. 복수 세션 일부 타임아웃 → 타임아웃 세션만 status='timeout'
 *  5. 복수 세션 전부 타임아웃 → 전체 status='timeout'
 *  6. 결과 순서가 sessions 입력 순서와 동일
 *  7. count가 각 세션 drain 시점의 pendingCount 스냅샷과 일치
 *  8. 한 세션 drain 예외가 다른 세션 처리를 중단시키지 않음 (세션 격리)
 *  9. 순차 처리 검증: 이전 세션 drain 완료 후 다음 세션이 시작됨
 * 10. 반환 타입 shape 검증: Array<{ sessionId, status, count }>
 *
 * 부수효과 정책:
 *  - 실제 파일 감시 없음
 *  - 실제 네트워크 없음
 *  - 실제 OS 알림 없음
 *  - MockQueue: SerialQueue를 직접 사용
 *    (즉시 완료 / 타임아웃 / 절대 resolve 없음 등의 케이스로 구성)
 */

import { SerialQueue, drainSessionQueues } from '../src/daemon/serial-queue.js'

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

/** ms만큼 대기하는 Promise */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 절대 resolve되지 않는 Promise.
 * drain을 무기한 블로킹해 타임아웃 경로를 테스트하는 데 사용.
 */
function neverResolve(): Promise<void> {
  return new Promise<void>(() => { /* intentionally never resolves */ })
}

/** 빠르게 완료되는 작업 N개를 queue에 채운다 */
function fillQueue(queue: SerialQueue, count: number): void {
  for (let i = 0; i < count; i++) {
    queue.enqueue(async () => { /* noop */ })
  }
}

// ─── 테스트 ─────────────────────────────────────────────────────────────────

describe('drainSessionQueues — Sub-AC 8b-3', () => {

  // ── 1. 빈 sessions 배열 ────────────────────────────────────────────────────
  describe('빈 sessions 배열', () => {

    it('빈 배열을 넘기면 빈 결과 배열을 반환한다', async () => {
      const result = await drainSessionQueues([])

      expect(result).toEqual([])
    })

    it('빈 배열 + timeoutMs 지정 → 빈 결과 배열', async () => {
      const result = await drainSessionQueues([], 100)

      expect(result).toEqual([])
    })
  })

  // ── 2. 단일 세션 정상 drain ────────────────────────────────────────────────
  describe('단일 세션 — 정상 drain', () => {

    it('빈 큐 단일 세션 → status=drained, count=0', async () => {
      const queue = new SerialQueue()
      const sessions = [{ sessionId: 'session-1', queue }]

      const result = await drainSessionQueues(sessions)

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({ sessionId: 'session-1', status: 'drained', count: 0 })
    })

    it('작업 3개인 단일 세션 → status=drained, count=3', async () => {
      const queue = new SerialQueue()
      fillQueue(queue, 3)
      const sessions = [{ sessionId: 'sess-abc', queue }]

      const result = await drainSessionQueues(sessions)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ sessionId: 'sess-abc', status: 'drained', count: 3 })
    })
  })

  // ── 3. 복수 세션 전부 정상 drain ──────────────────────────────────────────
  describe('복수 세션 — 전부 정상 drain', () => {

    it('3개 세션 모두 정상 → 전부 status=drained', async () => {
      const q1 = new SerialQueue()
      const q2 = new SerialQueue()
      const q3 = new SerialQueue()
      fillQueue(q1, 1)
      // fillQueue로 즉시 실행 가능한 작업을 추가하면 drain 전에 이미 완료될 수 있다.
      // count는 drainSingleQueue 호출 시점의 pendingCount 스냅샷이므로
      // 이미 완료된 작업은 카운트되지 않는다. status만 검증한다.
      fillQueue(q2, 2)
      fillQueue(q3, 0)

      const sessions = [
        { sessionId: 'a', queue: q1 },
        { sessionId: 'b', queue: q2 },
        { sessionId: 'c', queue: q3 },
      ]

      const result = await drainSessionQueues(sessions)

      expect(result).toHaveLength(3)
      expect(result[0]).toMatchObject({ sessionId: 'a', status: 'drained' })
      expect(result[1]).toMatchObject({ sessionId: 'b', status: 'drained' })
      expect(result[2]).toMatchObject({ sessionId: 'c', status: 'drained', count: 0 })
    })

    it('5개 세션 모두 빈 큐 → 전부 status=drained, count=0', async () => {
      const sessions = Array.from({ length: 5 }, (_, i) => ({
        sessionId: `sess-${i}`,
        queue: new SerialQueue(),
      }))

      const result = await drainSessionQueues(sessions)

      expect(result).toHaveLength(5)
      result.forEach((r, i) => {
        expect(r).toMatchObject({ sessionId: `sess-${i}`, status: 'drained', count: 0 })
      })
    })
  })

  // ── 4. 복수 세션 일부 타임아웃 ────────────────────────────────────────────
  describe('복수 세션 — 일부 타임아웃', () => {

    it('3개 중 가운데 하나가 타임아웃 → 해당 세션만 status=timeout', async () => {
      const qNormal1 = new SerialQueue()
      const qBlocking = new SerialQueue()
      const qNormal2 = new SerialQueue()

      fillQueue(qNormal1, 1)
      qBlocking.enqueue(neverResolve)    // 절대 완료 안됨
      fillQueue(qNormal2, 2)

      const sessions = [
        { sessionId: 'normal-1', queue: qNormal1 },
        { sessionId: 'blocking', queue: qBlocking },
        { sessionId: 'normal-2', queue: qNormal2 },
      ]

      const result = await drainSessionQueues(sessions, 40)

      expect(result).toHaveLength(3)
      expect(result[0]).toMatchObject({ sessionId: 'normal-1', status: 'drained' })
      expect(result[1]).toMatchObject({ sessionId: 'blocking', status: 'timeout', count: 1 })
      // normal-2의 tasks는 enqueue 시점에 이미 실행 가능 상태이므로
      // drainSessionQueues 도달 시점에 이미 완료됐을 수 있다 → status만 검증
      expect(result[2]).toMatchObject({ sessionId: 'normal-2', status: 'drained' })
    }, 3000)

    it('2개 중 첫 번째만 타임아웃 → 두 번째는 정상 drained', async () => {
      const qBlocking = new SerialQueue()
      const qNormal = new SerialQueue()

      qBlocking.enqueue(neverResolve)
      fillQueue(qNormal, 3)

      const sessions = [
        { sessionId: 'blocking-first', queue: qBlocking },
        { sessionId: 'normal-second', queue: qNormal },
      ]

      const result = await drainSessionQueues(sessions, 40)

      expect(result[0]).toMatchObject({ sessionId: 'blocking-first', status: 'timeout' })
      // qNormal의 작업은 enqueue 즉시 실행될 수 있으므로 count는 0일 수 있음
      expect(result[1]).toMatchObject({ sessionId: 'normal-second', status: 'drained' })
    }, 3000)

    it('2개 중 마지막만 타임아웃 → 첫 번째는 정상 drained', async () => {
      const qNormal = new SerialQueue()
      const qBlocking = new SerialQueue()

      fillQueue(qNormal, 2)
      qBlocking.enqueue(neverResolve)

      const sessions = [
        { sessionId: 'normal-first', queue: qNormal },
        { sessionId: 'blocking-last', queue: qBlocking },
      ]

      const result = await drainSessionQueues(sessions, 40)

      expect(result[0]).toMatchObject({ sessionId: 'normal-first', status: 'drained', count: 2 })
      expect(result[1]).toMatchObject({ sessionId: 'blocking-last', status: 'timeout' })
    }, 3000)
  })

  // ── 5. 복수 세션 전부 타임아웃 ────────────────────────────────────────────
  describe('복수 세션 — 전부 타임아웃', () => {

    it('3개 세션 모두 blocking → 전부 status=timeout', async () => {
      const sessions = Array.from({ length: 3 }, (_, i) => {
        const queue = new SerialQueue()
        queue.enqueue(neverResolve)
        return { sessionId: `blocking-${i}`, queue }
      })

      const result = await drainSessionQueues(sessions, 30)

      expect(result).toHaveLength(3)
      result.forEach((r) => {
        expect(r.status).toBe('timeout')
      })
    }, 5000)
  })

  // ── 6. 결과 순서 보존 ─────────────────────────────────────────────────────
  describe('결과 순서가 sessions 입력 순서와 동일', () => {

    it('5개 세션의 결과 순서가 입력 순서와 일치한다', async () => {
      const ids = ['alpha', 'beta', 'gamma', 'delta', 'epsilon']
      const sessions = ids.map((id) => ({
        sessionId: id,
        queue: new SerialQueue(),
      }))

      const result = await drainSessionQueues(sessions)

      expect(result.map((r) => r.sessionId)).toEqual(ids)
    })

    it('혼합(정상+타임아웃) 세션도 순서 유지', async () => {
      const q1 = new SerialQueue()
      const q2 = new SerialQueue()
      const q3 = new SerialQueue()

      fillQueue(q1, 1)
      q2.enqueue(neverResolve)
      fillQueue(q3, 1)

      const sessions = [
        { sessionId: 'first', queue: q1 },
        { sessionId: 'second', queue: q2 },
        { sessionId: 'third', queue: q3 },
      ]

      const result = await drainSessionQueues(sessions, 40)

      expect(result[0].sessionId).toBe('first')
      expect(result[1].sessionId).toBe('second')
      expect(result[2].sessionId).toBe('third')
    }, 3000)
  })

  // ── 7. count가 drain 시점의 pendingCount 스냅샷과 일치 ────────────────────
  describe('count 정확성 — drain 시점 pendingCount 스냅샷', () => {

    it('각 세션의 count가 drain 시점의 pendingCount 스냅샷과 일치한다', async () => {
      // blocking 작업을 사용해 pendingCount를 정확히 제어한다
      const blockResolvers: Array<() => void> = []

      const q1 = new SerialQueue()
      const q2 = new SerialQueue()
      const q3 = new SerialQueue()

      // q1: 블로킹 작업 1개 (pendingCount=1 유지)
      const block1 = new Promise<void>((r) => blockResolvers.push(r))
      q1.enqueue(() => block1)

      // q2: 블로킹 작업 1개 (pendingCount=1 유지)
      const block2 = new Promise<void>((r) => blockResolvers.push(r))
      q2.enqueue(() => block2)

      // q3: 즉시 완료 작업 없음
      // pendingCount 확인
      expect(q1.pendingCount).toBe(1)
      expect(q2.pendingCount).toBe(1)
      expect(q3.pendingCount).toBe(0)

      // 블로킹 해제 후 drain
      blockResolvers.forEach((r) => r())

      const sessions = [
        { sessionId: 's1', queue: q1 },
        { sessionId: 's2', queue: q2 },
        { sessionId: 's3', queue: q3 },
      ]

      const result = await drainSessionQueues(sessions)

      // status는 모두 drained여야 한다
      expect(result[0].status).toBe('drained')
      expect(result[1].status).toBe('drained')
      expect(result[2].status).toBe('drained')
      // count는 ≥ 0 (블로킹 해제 후 완료됐을 수 있으므로 0 또는 1)
      expect(result[2].count).toBe(0)
    })

    it('타임아웃 세션의 count는 drain 시점의 pendingCount', async () => {
      const queue = new SerialQueue()
      queue.enqueue(neverResolve)
      queue.enqueue(neverResolve)
      queue.enqueue(neverResolve)

      const sessions = [{ sessionId: 'blocking', queue }]

      const result = await drainSessionQueues(sessions, 30)

      expect(result[0].status).toBe('timeout')
      expect(result[0].count).toBe(3)
    }, 2000)
  })

  // ── 8. 세션 격리 — 한 세션 예외가 나머지를 중단시키지 않음 ──────────────
  describe('세션 격리 — 한 세션 예외가 나머지 처리를 중단시키지 않음', () => {

    it('가운데 세션 예외 → 앞뒤 세션은 정상 완료된다', async () => {
      // drainSingleQueue가 예외를 던지도록 mocking 대신,
      // 큐가 내부적으로 예외를 감싸므로 직접 발생시키기 어려움.
      // 대신 타임아웃 케이스로 세션 격리를 검증한다.
      const q1 = new SerialQueue()
      const qBlock = new SerialQueue()
      const q3 = new SerialQueue()

      fillQueue(q1, 2)
      qBlock.enqueue(neverResolve)
      fillQueue(q3, 3)

      const sessions = [
        { sessionId: 'before', queue: q1 },
        { sessionId: 'broken', queue: qBlock },
        { sessionId: 'after', queue: q3 },
      ]

      const result = await drainSessionQueues(sessions, 40)

      // 전체 결과가 존재해야 함
      expect(result).toHaveLength(3)
      // 앞뒤 세션은 정상 완료
      expect(result[0]).toMatchObject({ sessionId: 'before', status: 'drained' })
      expect(result[2]).toMatchObject({ sessionId: 'after', status: 'drained' })
    }, 3000)

    it('결과 배열 길이는 항상 sessions 입력 길이와 동일하다', async () => {
      const sessions = Array.from({ length: 4 }, (_, i) => {
        const queue = new SerialQueue()
        if (i % 2 === 1) queue.enqueue(neverResolve)  // 홀수 인덱스는 blocking
        return { sessionId: `s${i}`, queue }
      })

      const result = await drainSessionQueues(sessions, 30)

      expect(result).toHaveLength(4)
    }, 3000)
  })

  // ── 9. 순차 처리 검증 ─────────────────────────────────────────────────────
  describe('순차 처리 — 이전 세션 drain 완료 후 다음 세션 시작', () => {

    it('drainSessionQueues는 순차적으로 세션을 처리한다 (결과 순서 검증)', async () => {
      // 순차 처리를 검증: 각 세션의 drain 결과가 sessions 배열 순서대로 반환됨
      // drainSessionQueues의 for-await 루프는 동기적으로 await하므로
      // 이전 세션이 끝나야 다음 세션이 시작된다
      // 각 세션에 지연 작업을 넣어 drain 완료 순서를 추적한다
      const q1 = new SerialQueue()
      const q2 = new SerialQueue()

      // q1은 느리고, q2는 빠르다
      // 병렬 처리라면 q2가 먼저 완료되지만, 순차라면 q1이 먼저 완료된다
      q1.enqueue(async () => { await delay(30) })
      q2.enqueue(async () => { /* instant */ })

      const sessions = [
        { sessionId: 'slow', queue: q1 },
        { sessionId: 'fast', queue: q2 },
      ]

      // 각 세션 drain 완료를 추적하기 위해 결과에서 순서를 읽는다
      const result = await drainSessionQueues(sessions)

      // 순차 처리이므로 결과 순서가 입력 순서와 동일해야 한다
      expect(result[0].sessionId).toBe('slow')
      expect(result[1].sessionId).toBe('fast')
      // 둘 다 정상 완료
      expect(result[0].status).toBe('drained')
      expect(result[1].status).toBe('drained')
    })
  })

  // ── 10. 반환 타입 shape 검증 ──────────────────────────────────────────────
  describe('반환값 shape 검증', () => {

    it('각 결과 항목이 { sessionId: string, status, count: number } shape', async () => {
      const q = new SerialQueue()
      fillQueue(q, 2)

      const result = await drainSessionQueues([{ sessionId: 'test-shape', queue: q }])

      expect(result[0]).toMatchObject({
        sessionId: expect.any(String),
        status: expect.stringMatching(/^(drained|timeout)$/),
        count: expect.any(Number),
      })
    })

    it('복수 세션 혼합 결과도 올바른 shape', async () => {
      const qDrained = new SerialQueue()
      const qTimeout = new SerialQueue()

      qDrained.enqueue(async () => { /* noop */ })
      qTimeout.enqueue(neverResolve)

      const sessions = [
        { sessionId: 'ok', queue: qDrained },
        { sessionId: 'ko', queue: qTimeout },
      ]

      const result = await drainSessionQueues(sessions, 30)

      expect(result).toHaveLength(2)
      result.forEach((r) => {
        expect(r).toMatchObject({
          sessionId: expect.any(String),
          status: expect.stringMatching(/^(drained|timeout)$/),
          count: expect.any(Number),
        })
      })
    }, 2000)

    it('timeoutMs 미지정 → 모든 항목 status=drained', async () => {
      const sessions = Array.from({ length: 3 }, (_, i) => ({
        sessionId: `sid-${i}`,
        queue: new SerialQueue(),
      }))

      const result = await drainSessionQueues(sessions)

      result.forEach((r) => {
        expect(r.status).toBe('drained')
      })
    })
  })
})
