/**
 * daemon/serial-queue.ts — 범용 직렬 실행 큐
 *
 * SPEC §3.1 '세션별 직렬 큐': 동시 enqueue 시 이전 작업이 완료된 후
 * 다음 작업이 실행됨을 보장한다.
 *
 * - concurrency = 1 (Promise 체인 기반)
 * - maxQueueDepth: 초과 시 COALESCE(동일 키 중복 skip)
 * - 세션 격리: 한 작업의 예외가 큐 전체를 중단시키지 않음
 *
 * 구현 방식:
 *   enqueue마다 _chain 끝에 then()을 붙여 직렬화한다.
 *   _pending은 "대기 중(아직 shift 전) + 실행 중" 총 개수를 추적한다.
 *   COALESCE 판단은 _pending >= _maxDepth 로 수행한다.
 */

/** 큐에 적재되는 작업 단위 */
interface QueueEntry<T> {
  fn: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

/**
 * 범용 직렬 실행 큐.
 *
 * enqueue(fn)은 fn이 반환하는 Promise를 직렬화하여 실행한다.
 * 동시에 여러 enqueue가 호출되더라도 이전 작업이 완료된 후
 * 다음 작업이 시작된다.
 */
export class SerialQueue {
  /** 대기 중인 작업 목록 (shift 전까지 보관) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _queue: Array<QueueEntry<any>> = []

  /** 현재 실행 중인 Promise 체인 (직렬화 핵심) */
  private _chain: Promise<unknown> = Promise.resolve()

  /** 큐 깊이 상한 (초과 시 COALESCE) */
  private readonly _maxDepth: number

  /**
   * 대기 중 + 실행 중 총 작업 수.
   * enqueue 시 +1, 작업 완료(성공/실패) 시 -1.
   */
  private _pending = 0

  /** 큐가 닫혔는지 여부 (drainAndClose 이후) */
  private _closed = false

  constructor(maxDepth = 1000) {
    this._maxDepth = maxDepth
  }

  /**
   * 작업을 큐에 추가하고 실행 결과 Promise를 반환한다.
   *
   * - 큐가 닫혀 있으면 즉시 reject.
   * - maxDepth 초과 시 COALESCE: 새 작업을 skip하고 undefined resolve.
   * - 내부 Promise 체인에 연결되어 직렬 실행을 보장한다.
   */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    if (this._closed) {
      return Promise.reject(new Error('SerialQueue: 큐가 닫혔습니다 (drainAndClose 이후)'))
    }

    // COALESCE: 대기 중 + 실행 중 총 개수가 maxDepth 이상이면 skip
    if (this._pending >= this._maxDepth) {
      return Promise.resolve(undefined as unknown as T)
    }

    this._pending++

    return new Promise<T>((resolve, reject) => {
      this._queue.push({ fn, resolve, reject })

      // 체인 끝에 연결: 이전 작업 완료 후 실행
      this._chain = this._chain.then(() => {
        const entry = this._queue.shift()
        if (!entry) {
          // 이미 drain 등으로 처리됐을 경우 (방어 코드)
          return
        }

        return Promise.resolve()
          .then(() => entry.fn())
          .then(
            (result) => {
              this._pending--
              entry.resolve(result)
            },
            (err) => {
              this._pending--
              entry.reject(err)
            },
          )
      })
    })
  }

  /**
   * 현재 대기 중 + 실행 중인 작업 수를 반환한다.
   */
  get pendingCount(): number {
    return this._pending
  }

  /**
   * 큐가 닫혀 있는지 여부.
   */
  get isClosed(): boolean {
    return this._closed
  }

  /**
   * 현재 체인(대기 중 + 실행 중 작업)이 모두 완료될 때까지 기다린다.
   * SPEC §3.3 gracefulShutdown drain 순서.
   */
  async drain(): Promise<void> {
    // 현재 _chain을 캡처하고 대기한다.
    // 에러가 발생해도 drain 자체는 완료된다.
    await this._chain.catch(() => { /* drain 시 예외 무시 */ })
  }

  /**
   * 남은 작업을 모두 처리한 뒤 큐를 닫는다.
   * 닫힌 후 enqueue는 reject된다.
   */
  async drainAndClose(): Promise<void> {
    await this.drain()
    this._closed = true
  }
}

// ─── 독립 헬퍼 함수 ──────────────────────────────────────────────────────────

/**
 * drainSingleQueue — 단일 EventQueue(SerialQueue) 인스턴스를 받아
 * 큐가 빌 때까지 순차적으로 항목을 소비하고 완료 상태를 반환한다.
 *
 * SPEC §3.3 gracefulShutdown: 세션 파이프라인 큐를 drain할 때
 * 각 SessionPipeline의 내부 큐를 안전하게 비우는 데 사용된다.
 *
 * 설계:
 *   - 현재 실행 중·대기 중인 모든 작업(pendingCount)을 기준으로 카운트한다.
 *   - drain() 완료 시 더 이상 pending 항목이 없음이 보장된다.
 *   - 에러가 발생한 작업도 "소비된" 것으로 카운트한다(세션 격리 정책 계승).
 *   - 이미 닫힌 큐(isClosed=true)도 정상적으로 처리된다(count=0).
 *   - timeoutMs가 지정되면: 해당 시간 내 drain 완료 시 'drained',
 *     초과 시 'timeout'을 반환한다(큐는 닫히지 않음 — 최선 노력 원칙).
 *
 * @param queue      drain할 SerialQueue 인스턴스
 * @param timeoutMs  선택적 타임아웃(ms). 지정하지 않으면 타임아웃 없이 대기.
 * @returns          `{ status: 'drained', count: number }` 또는
 *                   `{ status: 'timeout', count: number }` (타임아웃 시)
 *                   count = drain 시작 시점의 pendingCount (스냅샷)
 */
export async function drainSingleQueue(
  queue: SerialQueue,
  timeoutMs?: number,
): Promise<{ status: 'drained' | 'timeout'; count: number }> {
  // drain 시작 전 pending 개수를 스냅샷한다.
  const count = queue.pendingCount

  if (timeoutMs === undefined) {
    // 타임아웃 없음: 기존 동작 그대로
    await queue.drain()
    return { status: 'drained', count }
  }

  // 타임아웃 경쟁: drain vs 타임아웃 타이머
  let timedOut = false
  const drainPromise = queue.drain()
  const timeoutPromise = new Promise<void>((resolve) =>
    setTimeout(() => {
      timedOut = true
      resolve()
    }, timeoutMs),
  )

  await Promise.race([drainPromise, timeoutPromise])

  return { status: timedOut ? 'timeout' : 'drained', count }
}

// ─── drainSessionQueues ───────────────────────────────────────────────────────

/** drainSessionQueues 단일 세션 결과 */
export interface SessionDrainResult {
  readonly sessionId: string
  readonly status: 'drained' | 'timeout'
  readonly count: number
}

/**
 * drainSessionQueues — 활성 세션 EventQueue 목록을 받아
 * 각 큐에 대해 drainSingleQueue를 순차 호출하고
 * 세션별 결과 배열을 반환한다.
 *
 * SPEC §3.3 gracefulShutdown 단계 2:
 *   "각 SessionPipeline의 큐 drain (진행 중 작업 완료까지 대기)"
 *
 * 설계:
 *   - 순차 처리: 한 세션 큐의 drain이 완료된 뒤 다음 세션으로 이동한다.
 *     (세션 간 순서 보장 + 리소스 제어)
 *   - 한 세션 drain에서 예외가 발생해도 나머지 세션을 계속 처리한다
 *     (세션 격리 원칙 계승). 예외 시 status='timeout'·count=0으로 기록.
 *   - timeoutMs가 지정되면 각 세션 큐에 동일한 타임아웃이 적용된다.
 *   - 빈 sessions 배열은 빈 결과 배열을 반환한다.
 *
 * @param sessions   drain할 세션 목록 (`{ sessionId, queue }` 쌍)
 * @param timeoutMs  선택적 타임아웃(ms). 지정 시 각 세션 큐에 동일하게 적용.
 * @returns          Array<SessionDrainResult> — sessions와 동일 순서
 */
export async function drainSessionQueues(
  sessions: ReadonlyArray<{ readonly sessionId: string; readonly queue: SerialQueue }>,
  timeoutMs?: number,
): Promise<SessionDrainResult[]> {
  const results: SessionDrainResult[] = []

  for (const { sessionId, queue } of sessions) {
    try {
      const drainResult = await drainSingleQueue(queue, timeoutMs)
      results.push({ sessionId, status: drainResult.status, count: drainResult.count })
    } catch (err) {
      // 예외가 발생해도 나머지 세션 처리를 계속한다 (세션 격리)
      results.push({ sessionId, status: 'timeout', count: 0 })
    }
  }

  return results
}
