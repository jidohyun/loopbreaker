/**
 * drain-single-queue-sub-ac-8b-2.test.ts
 *
 * Sub-AC 8b-2: drainSingleQueue 타임아웃 경로 — 단위 테스트
 *
 * 검증 항목:
 *  1. timeoutMs 내 drain 완료 시 status='drained' 반환
 *  2. drain이 timeoutMs를 초과하면 status='timeout' 반환
 *  3. 타임아웃 후에도 count는 drain 시작 시점의 pendingCount 스냅샷
 *  4. 타임아웃 후 큐는 닫히지 않음 (isClosed=false 유지)
 *  5. 무한 지연 큐(항목을 절대 소비하지 않는 케이스)에서 timeout 반환
 *  6. timeoutMs=0(또는 매우 짧음)이면 즉시 timeout 반환
 *  7. timeoutMs를 지정하지 않으면 기존 'drained' 동작 유지(회귀 없음)
 *
 * 부수효과 정책:
 *  - 실제 파일 감시 없음
 *  - 실제 네트워크 없음
 *  - 실제 OS 알림 없음
 *  - MockQueue: SerialQueue를 직접 사용; 타임아웃 케이스는 절대 resolve되지
 *    않는 Promise를 enqueue해 drain이 완료되지 않도록 만든다.
 */

import { SerialQueue, drainSingleQueue } from '../src/daemon/serial-queue.js'

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

/** ms만큼 대기하는 Promise */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 절대 resolve되지 않는 Promise를 반환하는 fn.
 * drain을 무기한 블로킹해 타임아웃 경로를 테스트하는 데 사용한다.
 */
function neverResolve(): Promise<void> {
  return new Promise<void>(() => { /* intentionally never resolves */ })
}

// ─── 테스트 ─────────────────────────────────────────────────────────────────

describe('drainSingleQueue 타임아웃 경로 — Sub-AC 8b-2', () => {

  // ── 1. timeout 내 완료 → 'drained' ─────────────────────────────────────
  describe('timeoutMs 내 drain 완료 → status=drained', () => {

    it('빠르게 완료되는 큐 + 충분한 타임아웃 → status=drained', async () => {
      const queue = new SerialQueue()
      queue.enqueue(async () => { await delay(10) })

      const result = await drainSingleQueue(queue, 500)

      expect(result.status).toBe('drained')
      expect(result.count).toBe(1)
    })

    it('빈 큐 + 타임아웃 지정 → 즉시 drained', async () => {
      const queue = new SerialQueue()

      const result = await drainSingleQueue(queue, 200)

      expect(result.status).toBe('drained')
      expect(result.count).toBe(0)
    })

    it('3개 즉시 완료 작업 + 충분한 타임아웃 → status=drained, count=3', async () => {
      const queue = new SerialQueue()
      queue.enqueue(async () => { /* noop */ })
      queue.enqueue(async () => { /* noop */ })
      queue.enqueue(async () => { /* noop */ })

      const result = await drainSingleQueue(queue, 500)

      expect(result.status).toBe('drained')
      expect(result.count).toBe(3)
    })
  })

  // ── 2. 타임아웃 초과 → 'timeout' ──────────────────────────────────────────
  describe('drain이 timeoutMs 초과 → status=timeout', () => {

    it('무한 블로킹 큐 + 짧은 타임아웃 → status=timeout', async () => {
      const queue = new SerialQueue()
      // 절대 완료되지 않는 작업 enqueue
      queue.enqueue(neverResolve)

      const result = await drainSingleQueue(queue, 50)

      expect(result.status).toBe('timeout')
    }, 2000)

    it('100ms delay 작업 + 30ms 타임아웃 → status=timeout', async () => {
      const queue = new SerialQueue()
      queue.enqueue(() => delay(200))

      const result = await drainSingleQueue(queue, 30)

      expect(result.status).toBe('timeout')
    }, 2000)

    it('timeoutMs=1 이면 사실상 즉시 timeout', async () => {
      const queue = new SerialQueue()
      queue.enqueue(neverResolve)

      const result = await drainSingleQueue(queue, 1)

      expect(result.status).toBe('timeout')
    }, 2000)
  })

  // ── 3. timeout 시 count는 drain 시작 시점 pendingCount 스냅샷 ─────────────
  describe('timeout 시 count 정확성', () => {

    it('pending 2개인 블로킹 큐 타임아웃 → count=2', async () => {
      const queue = new SerialQueue()
      queue.enqueue(neverResolve)
      queue.enqueue(neverResolve)

      const result = await drainSingleQueue(queue, 30)

      expect(result.status).toBe('timeout')
      expect(result.count).toBe(2)
    }, 2000)

    it('pending 5개인 블로킹 큐 타임아웃 → count=5', async () => {
      const queue = new SerialQueue()
      for (let i = 0; i < 5; i++) {
        queue.enqueue(neverResolve)
      }

      const result = await drainSingleQueue(queue, 30)

      expect(result.status).toBe('timeout')
      expect(result.count).toBe(5)
    }, 2000)

    it('빈 큐 + 매우 짧은 타임아웃 → count=0 (비어있어 즉시 drained)', async () => {
      const queue = new SerialQueue()

      // 빈 큐는 즉시 drain되므로 timeout이 매우 짧아도 drained
      const result = await drainSingleQueue(queue, 1)

      // 빈 큐는 drain이 바로 완료되므로 drained (타임아웃 경쟁에서 이김)
      expect(result.count).toBe(0)
    }, 2000)
  })

  // ── 4. 타임아웃 후 큐는 닫히지 않음 ─────────────────────────────────────
  describe('타임아웃 후 큐 상태 보존', () => {

    it('타임아웃 후에도 isClosed=false (최선 노력 원칙)', async () => {
      const queue = new SerialQueue()
      queue.enqueue(neverResolve)

      const result = await drainSingleQueue(queue, 30)

      expect(result.status).toBe('timeout')
      expect(queue.isClosed).toBe(false)
    }, 2000)

    it('타임아웃 후에도 새 작업을 enqueue할 수 있다', async () => {
      const queue = new SerialQueue()
      queue.enqueue(neverResolve)

      await drainSingleQueue(queue, 30)

      // 큐가 닫히지 않았으므로 enqueue가 reject되지 않아야 한다
      // (실제로는 큐에 블로킹 작업이 남아 있어 나중에 실행될 것이지만,
      //  enqueue 자체는 가능해야 함)
      expect(() => {
        queue.enqueue(async () => { /* noop */ })
      }).not.toThrow()
    }, 2000)
  })

  // ── 5. timeoutMs 미지정 시 기존 동작 유지 (회귀 없음) ────────────────────
  describe('timeoutMs 미지정 → 기존 drained 동작 유지', () => {

    it('timeoutMs 없이 호출 → 항상 status=drained (회귀 없음)', async () => {
      const queue = new SerialQueue()
      queue.enqueue(async () => { await delay(20) })

      const result = await drainSingleQueue(queue)

      expect(result.status).toBe('drained')
    })

    it('timeoutMs=undefined 명시 → 항상 status=drained', async () => {
      const queue = new SerialQueue()
      queue.enqueue(async () => { /* noop */ })

      const result = await drainSingleQueue(queue, undefined)

      expect(result.status).toBe('drained')
    })
  })

  // ── 6. 실제 타임아웃 시간 검증 ───────────────────────────────────────────
  describe('타임아웃 시간 정확성', () => {

    it('50ms 타임아웃: 50ms~200ms 내에 반환된다', async () => {
      const queue = new SerialQueue()
      queue.enqueue(neverResolve)

      const start = Date.now()
      const result = await drainSingleQueue(queue, 50)
      const elapsed = Date.now() - start

      expect(result.status).toBe('timeout')
      // 최소 50ms는 기다려야 하고, 너무 오래 걸리면 안 됨
      expect(elapsed).toBeGreaterThanOrEqual(40) // 타이머 정밀도 허용
      expect(elapsed).toBeLessThan(300)
    }, 2000)
  })

  // ── 7. 반환 타입 형태 검증 ────────────────────────────────────────────────
  describe('반환값 shape 검증', () => {

    it('timeout 시 반환값 shape이 { status: "timeout", count: number }이다', async () => {
      const queue = new SerialQueue()
      queue.enqueue(neverResolve)

      const result = await drainSingleQueue(queue, 30)

      expect(result).toMatchObject({
        status: 'timeout',
        count: expect.any(Number),
      })
    }, 2000)

    it('drained 시 반환값 shape이 { status: "drained", count: number }이다', async () => {
      const queue = new SerialQueue()

      const result = await drainSingleQueue(queue, 200)

      expect(result).toMatchObject({
        status: 'drained',
        count: expect.any(Number),
      })
    })
  })
})
