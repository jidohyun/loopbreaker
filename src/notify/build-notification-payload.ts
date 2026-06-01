/**
 * src/notify/build-notification-payload.ts
 *
 * buildNotificationPayload — 순수함수.
 * DetectionRecord.final(DetectionVerdict) + 메타(sessionId, nowMs) →
 * 완전한 NotificationPayload (§7-2 #7 정본 필드 전체 포함).
 *
 * 부수효과 없음. 디바운스/쿨다운 판정은 VerdictRouter가 담당.
 */

import type { DetectionRecord, DetectionVerdict, NotificationPayload, NotificationSeverity } from '../contracts.js'
import { NotificationPayloadSchema } from '../contracts.js'

/** buildNotificationPayload 메타 인자 */
export interface PayloadMeta {
  /** 세션 ID */
  sessionId: string
  /** 현재 시각 (epoch ms, UTC). 테스트 결정론을 위해 주입. */
  nowMs: number
}

/**
 * confidence + kind → severity 매핑 (순수함수).
 * - kind === 'meta' → 'meta'
 * - confidence >= 0.85 → 'critical'
 * - confidence >= 0.5  → 'warning'
 * - otherwise          → 'low_confidence'
 */
function deriveSeverity(
  kind: DetectionVerdict['kind'] | 'meta',
  confidence: number,
): NotificationSeverity {
  if (kind === 'meta') return 'meta'
  if (confidence >= 0.85) return 'critical'
  if (confidence >= 0.5) return 'warning'
  return 'low_confidence'
}

/**
 * buildNotificationPayload — 순수함수.
 *
 * DetectionRecord.final(DetectionVerdict)을 받아
 * §7-2 #7 정본 필드(sessionId, kind, subtype, confidence, reason,
 * evidence, ts, severity, dedupeKey)를 모두 채운 NotificationPayload를 반환한다.
 *
 * - evidence는 DetectionVerdict.evidence를 그대로 포함(사람 호출용 근거).
 * - dedupeKey = sessionId + '\x1f' + kind (SPEC §2.2(6)).
 * - severity는 confidence + kind에서 도출.
 * - zod 스키마로 검증 후 반환 (parse-throw 패턴).
 *
 * @param record  DetectionRecord (final 필드를 소비; record 자체 불변)
 * @param meta    { sessionId, nowMs }
 * @returns       NotificationPayload (zod 검증 통과 보장)
 */
export function buildNotificationPayload(
  record: Pick<DetectionRecord, 'final'>,
  meta: PayloadMeta,
): NotificationPayload {
  const verdict = record.final
  const { sessionId, nowMs } = meta

  const dedupeKey = `${sessionId}\x1f${verdict.kind}`
  const severity = deriveSeverity(verdict.kind, verdict.confidence)

  const raw: NotificationPayload = {
    sessionId,
    kind: verdict.kind,
    subtype: verdict.subtype,
    confidence: verdict.confidence,
    reason: verdict.reason,
    evidence: verdict.evidence,
    ts: nowMs,
    severity,
    dedupeKey,
  }

  // zod parse — 필수 필드 존재·타입을 런타임에 검증 (실패 시 ZodError throw)
  return NotificationPayloadSchema.parse(raw) as NotificationPayload
}
