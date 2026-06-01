/**
 * notify/index.ts — LoopBreaker 알림 모듈 (M4)
 *
 * VerdictRouter + CooldownStore + NotifyDispatcher + Sinks
 */

export { buildNotificationPayload } from './build-notification-payload.js'
export type { PayloadMeta } from './build-notification-payload.js'

export { buildLowConfidencePayload, isJudgeErrorOrDeferred } from './build-low-confidence-payload.js'
export type { LowConfidencePayloadMeta } from './build-low-confidence-payload.js'

export { routeVerdict, routeJudgeError, routeMetaEvent } from './verdict-router.js'
export type { RouteDecision, SuppressedReason, DebounceState, GetDebounceState } from './verdict-router.js'

export { CooldownStore, ensureNotificationsTable, NOTIFICATIONS_TABLE_DDL } from './cooldown-store.js'

export { NotifyDispatcher } from './notify-dispatcher.js'
export type { DispatchResult, DispatchLogger } from './notify-dispatcher.js'

export { MetaNotifyOnce, metaNotifyOnce } from './meta-notify-once.js'
export type { MetaNotifyOnceResult } from './meta-notify-once.js'

export { MockNotifySink } from './sinks/mock-notify-sink.js'
export type { SentRecord } from './sinks/mock-notify-sink.js'

export { CliNotifySink } from './sinks/cli-notify-sink.js'
export { WebhookNotifySink } from './sinks/webhook-notify-sink.js'
export { DesktopNotifySink } from './sinks/desktop-notify-sink.js'

/**
 * 기본 export — 모듈 스텁 호환성 유지 (module-stubs.test.ts).
 * M4 notify 모듈의 버전 정보를 담는다.
 */
const notifyModule = {
  version: '0.4.0-m4',
  description: 'LoopBreaker notify module — VerdictRouter + NotifyDispatcher + Sinks',
} as const

export default notifyModule
