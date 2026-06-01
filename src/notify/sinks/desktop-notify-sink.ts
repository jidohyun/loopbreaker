/**
 * src/notify/sinks/desktop-notify-sink.ts
 *
 * DesktopNotifySink — node-notifier OS 데스크톱 알림 채널.
 *
 * node-notifier import는 이 파일 내부에 격리됨.
 * 다른 모듈/테스트가 transitively 로드해 알림을 쏘지 않도록
 * dynamic import를 사용한다.
 *
 * 테스트에서 사용 금지 (MockNotifySink 사용).
 * DI로 주입되며, 데몬/통합 테스트는 항상 MockNotifySink를 주입.
 */

import type { NotificationPayload, NotifyResult, NotifySink } from '../../contracts.js'

/** node-notifier notify 함수 시그니처 */
export type NotifierFn = (
  options: {
    title: string
    message: string
    sound?: boolean
    wait?: boolean
  },
  callback?: (err: Error | null, response: string) => void,
) => void

/**
 * NotifierAdapter — node-notifier를 감싸는 DI 인터페이스.
 *
 * 테스트에서 MockNotifierAdapter를 주입해 실제 OS 알림 없이 동작 검증.
 * 프로덕션에서는 생성자에 아무것도 주입하지 않으면 node-notifier를 dynamic import로 로드.
 */
export interface NotifierAdapter {
  notify(
    options: { title: string; message: string; sound?: boolean; wait?: boolean },
    callback?: (err: Error | null, response: string) => void,
  ): void
}

/**
 * DesktopNotifySink — OS 데스크톱 알림 채널 (node-notifier).
 *
 * 생성자에서 NotifierAdapter를 DI로 주입받는다.
 * - 주입 없으면: node-notifier를 dynamic import로 lazy 로드 (프로덕션)
 * - 주입 있으면: 주입된 어댑터 사용 (테스트에서 mock 교체 가능)
 */
export class DesktopNotifySink implements NotifySink {
  /** DI로 주입된 notifier 어댑터 (optional; 없으면 lazy 로드) */
  private readonly injectedAdapter: NotifierAdapter | null

  /** lazy 로드된 node-notifier 어댑터 캐시 */
  private lazyAdapter: NotifierAdapter | null = null

  constructor(notifierAdapter?: NotifierAdapter) {
    this.injectedAdapter = notifierAdapter ?? null
  }

  async send(payload: NotificationPayload): Promise<NotifyResult> {
    try {
      const adapter = await this.resolveAdapter()
      const title = this.buildTitle(payload)
      const message = this.buildMessage(payload)

      await new Promise<void>((resolve, reject) => {
        adapter.notify(
          { title, message, sound: payload.severity === 'critical' },
          (err) => {
            if (err != null) reject(err)
            else resolve()
          },
        )
      })

      return { success: true, channel: 'desktop' }
    } catch (err) {
      return {
        success: false,
        channel: 'desktop',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  private async resolveAdapter(): Promise<NotifierAdapter> {
    if (this.injectedAdapter !== null) return this.injectedAdapter
    if (this.lazyAdapter !== null) return this.lazyAdapter

    // Dynamic import로 node-notifier 격리 (프로덕션 전용)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import('node-notifier') as any
    const notifierObj = mod.default ?? mod
    this.lazyAdapter = {
      notify: (opts, cb) => {
        const fn: NotifierFn = (notifierObj.notify ?? notifierObj).bind(notifierObj)
        fn(opts, cb)
      },
    }
    return this.lazyAdapter
  }

  private buildTitle(payload: NotificationPayload): string {
    const icon =
      payload.severity === 'critical' ? '🚨' :
      payload.severity === 'warning'  ? '⚠️' :
      payload.severity === 'meta'     ? 'ℹ️' : '🔍'
    return `${icon} LoopBreaker: ${payload.kind}/${payload.subtype}`
  }

  private buildMessage(payload: NotificationPayload): string {
    const lines = [
      `신뢰도: ${(payload.confidence * 100).toFixed(1)}%`,
      `이유: ${payload.reason.slice(0, 120)}`,
    ]
    if (payload.evidence.length > 0) {
      lines.push(`근거: ${payload.evidence.length}건`)
    }
    return lines.join('\n')
  }
}
