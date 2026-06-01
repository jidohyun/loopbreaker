/**
 * src/notify/sinks/mock-notify-sink.ts
 *
 * MockNotifySink — 테스트용 인메모리 NotifySink.
 *
 * 부수효과 없음:
 *   - 실제 OS 알림 발생 없음
 *   - 네트워크 요청 없음
 *   - 발송 기록만 인메모리 수집
 *
 * 모든 단위·통합 테스트는 이 구현만 사용한다.
 */

import type { NotificationPayload, NotifyResult, NotifySink } from '../../contracts.js'

/** MockNotifySink가 수집하는 발송 기록 */
export interface SentRecord {
  readonly payload: NotificationPayload
  readonly result: NotifyResult
  readonly sentAt: number
}

/**
 * MockNotifySink — 테스트용 NotifySink.
 *
 * send() 호출 시 실제 발송 없이 records 배열에 추가.
 * shouldFail=true로 설정하면 실패 시뮬레이션.
 */
export class MockNotifySink implements NotifySink {
  private readonly _records: SentRecord[] = []
  private _shouldFail = false
  private _failError = 'mock failure'

  /**
   * 알림 페이로드 발송 (실제 발송 없음 — 인메모리 수집).
   */
  async send(payload: NotificationPayload): Promise<NotifyResult> {
    const sentAt = Date.now()

    if (this._shouldFail) {
      const result: NotifyResult = {
        success: false,
        channel: 'mock',
        error: this._failError,
      }
      this._records.push({ payload, result, sentAt })
      return result
    }

    const result: NotifyResult = {
      success: true,
      channel: 'mock',
    }
    this._records.push({ payload, result, sentAt })
    return result
  }

  /** 수집된 발송 기록 (읽기 전용) */
  get records(): readonly SentRecord[] {
    return this._records
  }

  /** 수집된 발송 횟수 */
  get count(): number {
    return this._records.length
  }

  /** 마지막으로 수집된 발송 기록 */
  get last(): SentRecord | undefined {
    return this._records[this._records.length - 1]
  }

  /** 실패 시뮬레이션 ON/OFF */
  setFailMode(shouldFail: boolean, error = 'mock failure'): void {
    this._shouldFail = shouldFail
    this._failError = error
  }

  /** 수집된 기록 초기화 */
  reset(): void {
    this._records.length = 0
    this._shouldFail = false
    this._failError = 'mock failure'
  }
}
