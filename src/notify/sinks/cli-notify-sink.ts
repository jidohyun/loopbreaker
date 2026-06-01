/**
 * src/notify/sinks/cli-notify-sink.ts
 *
 * CliNotifySink — CLI stderr/stdout 출력 채널.
 *
 * 테스트에서 사용 금지 (MockNotifySink 사용).
 * stderr에 구조화된 알림을 출력한다.
 */

import type { NotificationPayload, NotifyResult, NotifySink } from '../../contracts.js'

/** CLI 출력 함수 인터페이스 (테스트에서 주입 가능) */
export type CliWriter = (line: string) => void

/**
 * CliNotifySink — CLI status 채널.
 *
 * 실제 프로덕션 환경에서 stderr에 알림을 출력한다.
 * writer를 주입하면 테스트에서도 사용 가능 (but MockNotifySink 선호).
 */
export class CliNotifySink implements NotifySink {
  private readonly writer: CliWriter

  constructor(writer?: CliWriter) {
    // 기본값: process.stderr.write (console.error 금지)
    this.writer = writer ?? ((line: string) => process.stderr.write(line + '\n'))
  }

  async send(payload: NotificationPayload): Promise<NotifyResult> {
    try {
      const icon = payload.severity === 'critical' ? '🚨' :
                   payload.severity === 'warning'  ? '⚠️' :
                   payload.severity === 'meta'     ? 'ℹ️' : '🔍'

      const lines = [
        `${icon} [LoopBreaker] ${payload.severity.toUpperCase()} — ${payload.kind}/${payload.subtype}`,
        `   session: ${payload.sessionId}`,
        `   confidence: ${(payload.confidence * 100).toFixed(1)}%`,
        `   reason: ${payload.reason}`,
        `   ts: ${new Date(payload.ts).toISOString()}`,
      ]

      if (payload.evidence.length > 0) {
        lines.push(`   evidence: ${payload.evidence.length} item(s)`)
        for (const ev of payload.evidence.slice(0, 3)) {
          lines.push(`     - [${ev.uuid}] ${ev.note}`)
        }
      }

      this.writer(lines.join('\n'))

      return { success: true, channel: 'cli' }
    } catch (err) {
      return {
        success: false,
        channel: 'cli',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
