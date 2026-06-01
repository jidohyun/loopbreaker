/**
 * src/notify/meta-notify-once.ts
 *
 * metaNotifyOnce — meta 이벤트를 정확히 1회만 발송하는 함수/클래스.
 *
 * SPEC §4: 비용상한 초과 등 메타상황 → severity='meta' 알림 1회
 *   (메타알림도 디바운스로 1회만).
 *
 * 설계:
 *   - Set<string>으로 발송 여부를 인메모리 추적
 *   - 동일 eventKey에 대해 두 번째 호출 시 발송 없이 즉시 반환
 *   - NotifyDispatcher.dispatchMeta()에 위임 (채널 발송·쿨다운 영속은 dispatcher 담당)
 *   - 순수 멱등 래퍼: 상태는 sent Set 뿐, 외부 I/O는 주입된 dispatcher에 위임
 */

import type { NotifyDispatcher } from './notify-dispatcher.js'
import type { DispatchResult } from './notify-dispatcher.js'

/** metaNotifyOnce 발송 결과 */
export interface MetaNotifyOnceResult {
  /** 실제 발송 시도 여부 (false = 이미 발송된 이벤트라 스킵) */
  readonly dispatched: boolean
  /** dispatched=true 시 dispatcher 결과 */
  readonly dispatchResult?: DispatchResult
}

/**
 * MetaNotifyOnce — meta 이벤트를 정확히 1회만 발송하는 클래스.
 *
 * 인스턴스 수명 동안 동일 eventKey는 최초 1회만 dispatcher에 전달된다.
 * NotifyDispatcher 자체도 디바운스 윈도우를 지키지만, 이 클래스는
 * 런타임 재시작 전까지 인메모리 Set으로 추가 방어층을 제공한다.
 *
 * @example
 * ```ts
 * const once = new MetaNotifyOnce(dispatcher)
 * await once.notify('session-1', 'cost_limit_exceeded')  // → dispatched: true
 * await once.notify('session-1', 'cost_limit_exceeded')  // → dispatched: false (skip)
 * await once.notify('session-1', 'other_event')          // → dispatched: true (다른 키)
 * ```
 */
export class MetaNotifyOnce {
  /** 발송 완료된 이벤트 키 Set */
  private readonly sent: Set<string> = new Set()

  constructor(private readonly dispatcher: Pick<NotifyDispatcher, 'dispatchMeta'>) {}

  /**
   * 메타 이벤트를 최초 1회만 발송한다.
   *
   * 이벤트 키 = `${sessionId}\x1f${eventKey}` (세션 격리 포함).
   * 이미 발송된 키이면 즉시 { dispatched: false }를 반환.
   * 미발송 키이면 dispatcher.dispatchMeta()를 호출하고 키를 Set에 등록.
   *
   * @param sessionId  세션 ID
   * @param eventKey   메타 이벤트 식별자 (예: 'cost_limit_exceeded')
   * @param now        현재 시각 (epoch ms) — 테스트 결정론을 위해 주입 가능
   */
  async notify(
    sessionId: string,
    eventKey: string,
    now = Date.now(),
  ): Promise<MetaNotifyOnceResult> {
    const key = `${sessionId}\x1f${eventKey}`

    if (this.sent.has(key)) {
      return { dispatched: false }
    }

    // 발송 전에 Set에 등록 (동시 호출 경쟁 방지 — 단일 스레드 JS에서는 충분)
    this.sent.add(key)

    const dispatchResult = await this.dispatcher.dispatchMeta(sessionId, eventKey, now)

    return { dispatched: true, dispatchResult }
  }

  /**
   * 발송 완료된 이벤트 키 수 (테스트/모니터링용).
   */
  get sentCount(): number {
    return this.sent.size
  }

  /**
   * 특정 (sessionId, eventKey) 조합이 이미 발송됐는지 확인.
   */
  hasSent(sessionId: string, eventKey: string): boolean {
    return this.sent.has(`${sessionId}\x1f${eventKey}`)
  }

  /**
   * 인메모리 상태 초기화 (테스트용).
   * DB 쿨다운 상태는 초기화하지 않는다.
   */
  reset(): void {
    this.sent.clear()
  }
}

/**
 * metaNotifyOnce — 독립 함수형 인터페이스.
 *
 * 클래스 인스턴스를 관리하기 어려운 컨텍스트에서
 * 외부 Set을 직접 주입해 사용하는 순수 함수 변형.
 *
 * @param sent         발송 여부를 추적하는 Set (호출자가 수명 관리)
 * @param dispatcher   NotifyDispatcher (dispatchMeta 메서드)
 * @param sessionId    세션 ID
 * @param eventKey     메타 이벤트 식별자
 * @param now          현재 시각 (epoch ms)
 */
export async function metaNotifyOnce(
  sent: Set<string>,
  dispatcher: Pick<NotifyDispatcher, 'dispatchMeta'>,
  sessionId: string,
  eventKey: string,
  now = Date.now(),
): Promise<MetaNotifyOnceResult> {
  const key = `${sessionId}\x1f${eventKey}`

  if (sent.has(key)) {
    return { dispatched: false }
  }

  sent.add(key)

  const dispatchResult = await dispatcher.dispatchMeta(sessionId, eventKey, now)

  return { dispatched: true, dispatchResult }
}
