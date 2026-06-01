/**
 * src/notify/sinks/webhook-notify-sink.ts
 *
 * WebhookNotifySink — HTTP POST 웹훅 채널.
 *
 * 설정에 webhookUrl이 있을 때만 활성화.
 * 테스트에서 사용 금지 (MockNotifySink 사용).
 */

import type { NotificationPayload, NotifyResult, NotifySink } from '../../contracts.js'

/** HTTP fetch 함수 인터페이스 (테스트 주입용) */
export type FetchFn = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
  },
) => Promise<{ ok: boolean; status: number; statusText: string }>

/**
 * WebhookNotifySink — HTTP POST 웹훅 채널.
 *
 * fetchFn을 주입하면 테스트에서 네트워크 없이 검증 가능.
 * 실제 환경에서는 Node.js 20+ 내장 fetch 사용.
 */
export class WebhookNotifySink implements NotifySink {
  private readonly fetchFn: FetchFn

  constructor(
    private readonly webhookUrl: string,
    fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? (globalThis.fetch as unknown as FetchFn)
  }

  async send(payload: NotificationPayload): Promise<NotifyResult> {
    try {
      const response = await this.fetchFn(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LoopBreaker-Severity': payload.severity,
          'X-LoopBreaker-Kind': payload.kind,
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        return {
          success: false,
          channel: 'webhook',
          error: `HTTP ${response.status}: ${response.statusText}`,
        }
      }

      return { success: true, channel: 'webhook' }
    } catch (err) {
      return {
        success: false,
        channel: 'webhook',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
