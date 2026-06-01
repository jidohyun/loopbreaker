/**
 * src/notify/build-low-confidence-payload.ts
 *
 * buildLowConfidencePayload — 순수함수.
 *
 * SPEC §4: judgeError/deferred DetectionRecord에 대해
 *   - config.lowConfidenceNotify === true  → severity='low_confidence' NotificationPayload 반환
 *   - config.lowConfidenceNotify === false → null 반환 (알림 안 함, 기본값)
 *
 * 부수효과 없음. 디바운스/쿨다운 판정은 VerdictRouter/NotifyDispatcher가 담당.
 */

import type { DetectionRecord, NotificationPayload } from '../contracts.js'
import { NotificationPayloadSchema } from '../contracts.js'

/** buildLowConfidencePayload 메타 인자 */
export interface LowConfidencePayloadMeta {
  /** 세션 ID */
  sessionId: string
  /** 현재 시각 (epoch ms, UTC). 테스트 결정론을 위해 주입. */
  nowMs: number
}

/**
 * buildLowConfidencePayload — 순수함수.
 *
 * judgeError=true 또는 deferred=true인 DetectionRecord를 받아:
 *   - lowConfidenceNotify === true  → severity='low_confidence' 알림 페이로드 반환
 *   - lowConfidenceNotify === false → null 반환 (알림 안 함)
 *
 * 반환된 페이로드는 zod 스키마 검증을 통과한 완전한 NotificationPayload이다.
 * dedupeKey = sessionId + '\x1f' + kind (SPEC §2.2(6)).
 *
 * @param record               DetectionRecord (judgeError/deferred 여부 확인에 사용; 불변 소비)
 * @param meta                 { sessionId, nowMs }
 * @param lowConfidenceNotify  SPEC §4 플래그. true이면 payload 반환, false이면 null.
 * @returns                    NotificationPayload | null
 */
export function buildLowConfidencePayload(
  record: Pick<DetectionRecord, 'final' | 'judgeError' | 'deferred'>,
  meta: LowConfidencePayloadMeta,
  lowConfidenceNotify: boolean,
): NotificationPayload | null {
  // SPEC §4: lowConfidenceNotify=false(기본) → 알림 안 함
  if (!lowConfidenceNotify) {
    return null
  }

  const verdict = record.final
  const { sessionId, nowMs } = meta

  // dedupeKey = sessionId + '\x1f' + kind (SPEC §2.2(6))
  const dedupeKey = `${sessionId}\x1f${verdict.kind}`

  const raw: NotificationPayload = {
    sessionId,
    kind: verdict.kind,
    subtype: verdict.subtype,
    confidence: verdict.confidence,
    reason: verdict.reason,
    evidence: verdict.evidence,
    ts: nowMs,
    // SPEC §4: judgeError/deferred 케이스는 항상 'low_confidence'
    severity: 'low_confidence',
    dedupeKey,
  }

  // zod parse — 필수 필드 존재·타입을 런타임에 검증 (실패 시 ZodError throw)
  return NotificationPayloadSchema.parse(raw) as NotificationPayload
}

/**
 * isJudgeErrorOrDeferred — 순수함수.
 *
 * DetectionRecord가 judgeError=true 또는 deferred=true인지 판정한다.
 * buildLowConfidencePayload 호출 전 가드로 사용.
 *
 * @param record  DetectionRecord (부분 타입)
 * @returns       true = judgeError/deferred 케이스
 */
export function isJudgeErrorOrDeferred(
  record: Pick<DetectionRecord, 'judgeError' | 'deferred'>,
): boolean {
  return record.judgeError === true || record.deferred === true
}
