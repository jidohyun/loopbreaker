/**
 * src/notify/notify-dispatcher.ts
 *
 * NotifyDispatcher — 채널별 알림 발송 + 결과 가시화.
 *
 * SPEC §2.1 (7) 알림 발송:
 *   - 채널별 NotifySink.send() 호출
 *   - 한 채널 실패가 다른 채널·record를 막지 않음
 *   - 발송 결과(성공/실패/채널)를 카운터/로그로 가시화 (침묵 실패 금지)
 *
 * SPEC §4 장애처리:
 *   (a) judgeError/deferred → lowConfidenceNotify=true면 'low_confidence' 알림
 *   (b) 메타 이벤트 → 'meta' 알림 1회
 *   (c) 발송 실패는 잡아서 기록, 다음 sink로 진행
 */

import type { DetectionRecord, DetectorConfig, NotificationPayload, NotifyResult, NotifySink } from '../contracts.js'
import { NotificationPayloadSchema } from '../contracts.js'
import type { CooldownStore } from './cooldown-store.js'
import {
  routeJudgeError,
  routeMetaEvent,
  routeVerdict,
} from './verdict-router.js'

/** 발송 결과 요약 */
export interface DispatchResult {
  /** 라우팅 결과: 발송됨 여부 */
  readonly routed: boolean
  /** 억제 사유 (routed=false 시) */
  readonly suppressedReason?: string
  /** 채널별 발송 결과 */
  readonly channelResults: readonly NotifyResult[]
  /** 성공 채널 수 */
  readonly successCount: number
  /** 실패 채널 수 */
  readonly failCount: number
}

/**
 * 채널별 발송 결과 항목.
 * NotifyDispatchResult.perChannel 배열 원소.
 */
export interface PerChannelResult {
  /** 발송 채널 식별자 */
  readonly channel: 'desktop' | 'webhook' | 'cli' | 'mock'
  /** 발송 성공 여부 */
  readonly ok: boolean
  /** 실패 시 오류 메시지 */
  readonly error?: string
}

/**
 * NotifyDispatcher.dispatch() / dispatchMeta() 반환 타입.
 * Sub-AC 5c 정본: perChannel 배열 형식으로 채널별 결과를 제공.
 * DispatchResult의 channelResults를 perChannel 뷰로 래핑.
 */
export interface NotifyDispatchResult {
  /** 라우팅 결과: 발송됨 여부 */
  readonly routed: boolean
  /** 억제 사유 (routed=false 시) */
  readonly suppressedReason?: string
  /** 채널별 발송 결과 (perChannel 형식) */
  readonly perChannel: readonly PerChannelResult[]
  /** 성공 채널 수 */
  readonly successCount: number
  /** 실패 채널 수 */
  readonly failCount: number
}

/** 구조화 로거 인터페이스 (console.log 금지) */
export interface DispatchLogger {
  info(event: string, data?: Record<string, unknown>): void
  warn(event: string, data?: Record<string, unknown>): void
  error(event: string, data?: Record<string, unknown>): void
}

/** 기본 no-op 로거 */
const noopLogger: DispatchLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

/**
 * NotifyDispatcher — 채널별 알림 발송 조율자.
 *
 * VerdictRouter의 RouteDecision을 받아 NotifySink 목록에 발송.
 * 한 채널 실패 시 다른 채널 계속 진행.
 * 디바운스 상태 갱신은 발송 성공 후 CooldownStore에 기록.
 */
export class NotifyDispatcher {
  constructor(
    private readonly sinks: readonly NotifySink[],
    private readonly cooldown: CooldownStore,
    private readonly config: Pick<DetectorConfig,
      'decideThresh' | 'notifyDebounceMs' | 'lowConfidenceNotify'
    >,
    private readonly logger: DispatchLogger = noopLogger,
  ) {}

  /**
   * DetectionRecord를 소비해 알림 발송 여부를 판정하고 발송한다.
   *
   * @param record     M3 DetectionRecord (읽기 전용 소비)
   * @param sessionId  세션 ID
   * @param now        현재 시각 (epoch ms) — 테스트 결정론을 위해 주입 가능
   * @returns          DispatchResult
   */
  async dispatch(
    record: DetectionRecord,
    sessionId: string,
    now = Date.now(),
  ): Promise<DispatchResult> {
    // judgeError/deferred 케이스 처리
    if (record.judgeError === true || record.deferred === true) {
      if (!this.config.lowConfidenceNotify) {
        this.logger.info('dispatch.suppressed', {
          reason: 'judge_error_no_low_confidence',
          sessionId,
        })
        return this.suppressedResult('below_threshold')
      }

      const decision = routeJudgeError(
        record.final,
        sessionId,
        this.config.notifyDebounceMs,
        now,
        (key) => this.cooldown.getDebounceState(key),
      )

      if (!decision.shouldNotify) {
        this.logger.info('dispatch.suppressed', {
          reason: decision.suppressedReason,
          sessionId,
        })
        return this.suppressedResult(decision.suppressedReason)
      }

      return this.sendPayload(decision.payload!, now)
    }

    // 정상 판정 라우팅
    const decision = routeVerdict(
      record.final,
      sessionId,
      this.config.decideThresh,
      this.config.notifyDebounceMs,
      now,
      (key) => this.cooldown.getDebounceState(key),
    )

    if (!decision.shouldNotify) {
      this.logger.info('dispatch.suppressed', {
        reason: decision.suppressedReason,
        sessionId,
        kind: record.final.kind,
        confidence: record.final.confidence,
      })
      return this.suppressedResult(decision.suppressedReason)
    }

    return this.sendPayload(decision.payload!, now)
  }

  /**
   * 메타 이벤트 알림 발송 (비용상한 초과 등).
   *
   * SPEC §4: severity='meta', 디바운스로 1회만.
   */
  async dispatchMeta(
    sessionId: string,
    reason: string,
    now = Date.now(),
  ): Promise<DispatchResult> {
    const decision = routeMetaEvent(
      sessionId,
      reason,
      this.config.notifyDebounceMs,
      now,
      (key) => this.cooldown.getDebounceState(key),
    )

    if (!decision.shouldNotify) {
      this.logger.info('dispatch.meta.suppressed', { reason: decision.suppressedReason, sessionId })
      return this.suppressedResult(decision.suppressedReason)
    }

    return this.sendPayload(decision.payload!, now)
  }

  /**
   * 페이로드를 모든 sink로 발송한다.
   * 한 채널 실패가 다른 채널을 막지 않음.
   * 발송 성공 시 쿨다운 상태 갱신.
   */
  private async sendPayload(
    payload: NotificationPayload,
    now: number,
  ): Promise<DispatchResult> {
    // zod 검증 (방어적 프로그래밍)
    const parsed = NotificationPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      this.logger.error('dispatch.payload.invalid', {
        errors: parsed.error.flatten(),
        dedupeKey: payload.dedupeKey,
      })
      return this.suppressedResult('below_threshold')
    }

    const channelResults: NotifyResult[] = []

    // 채널별 발송 (병렬 — 한 채널 실패가 다른 채널을 막지 않음)
    const results = await Promise.allSettled(
      this.sinks.map((sink) => sink.send(payload)),
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        channelResults.push(result.value)
        if (!result.value.success) {
          this.logger.warn('dispatch.channel.failed', {
            channel: result.value.channel,
            error: result.value.error,
            dedupeKey: payload.dedupeKey,
          })
        } else {
          this.logger.info('dispatch.channel.success', {
            channel: result.value.channel,
            dedupeKey: payload.dedupeKey,
            severity: payload.severity,
          })
        }
      } else {
        // sink.send()가 throw한 경우 (방어적 처리)
        const errorMsg = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)

        channelResults.push({
          success: false,
          channel: 'mock', // 알 수 없는 채널
          error: errorMsg,
        })
        this.logger.error('dispatch.channel.threw', {
          error: errorMsg,
          dedupeKey: payload.dedupeKey,
        })
      }
    }

    const successCount = channelResults.filter((r) => r.success).length
    const failCount = channelResults.length - successCount

    // 하나라도 성공하면 쿨다운 갱신 (디바운스 키 기록)
    if (successCount > 0) {
      this.cooldown.recordSent(
        payload.dedupeKey,
        now,
        payload.sessionId,
        payload.kind,
      )
    }

    this.logger.info('dispatch.done', {
      dedupeKey: payload.dedupeKey,
      severity: payload.severity,
      successCount,
      failCount,
    })

    return {
      routed: true,
      channelResults,
      successCount,
      failCount,
    }
  }

  private suppressedResult(suppressedReason?: string): DispatchResult {
    return {
      routed: false,
      suppressedReason,
      channelResults: [],
      successCount: 0,
      failCount: 0,
    }
  }
}
