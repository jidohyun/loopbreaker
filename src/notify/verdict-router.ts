/**
 * src/notify/verdict-router.ts
 *
 * VerdictRouter — DetectionVerdict → RouteDecision (순수함수, 부수효과 없음)
 *
 * SPEC §2.1 (6) 라우팅 판정:
 *   (a) kind !== 'none'
 *   (b) confidence >= decideThresh
 *   (c) 디바운스 윈도우(notifyDebounceMs) 내 동일 (sessionId, kind) 미발송
 *   — 셋 다 충족 시에만 RouteDecision{shouldNotify:true}
 *
 * SPEC §2.2(6) 디바운스 불변식:
 *   dedupeKey = sessionId + '\x1f' + kind
 *   쿨다운 = 마지막 발송 ts + notifyDebounceMs
 */

import type { DetectionVerdict, DetectorConfig, NotificationPayload, NotificationSeverity } from '../contracts.js'
import { buildNotificationPayload } from './build-notification-payload.js'

/** 알림 억제 사유 */
export type SuppressedReason = 'below_threshold' | 'kind_none' | 'debounced'

/** VerdictRouter 판정 결과 */
export interface RouteDecision {
  /** 알림 발송 여부 */
  readonly shouldNotify: boolean
  /** 억제 사유 (shouldNotify=false 시 설정) */
  readonly suppressedReason?: SuppressedReason
  /** 발송할 알림 페이로드 (shouldNotify=true 시 설정) */
  readonly payload?: NotificationPayload
}

/** 디바운스 상태 조회 인터페이스 */
export interface DebounceState {
  /** 마지막 발송 ts (epoch ms). 없으면 undefined */
  lastSentTs: number | undefined
}

/** 디바운스 상태 조회 함수 타입 */
export type GetDebounceState = (dedupeKey: string) => DebounceState

/**
 * confidence → severity 매핑.
 * judgeError/deferred 처리는 NotifyDispatcher 레이어에서 수행.
 */
function mapSeverity(
  confidence: number,
  kind: 'thrashing' | 'false_success' | 'none' | 'meta',
): NotificationSeverity {
  if (kind === 'meta') return 'meta'
  if (confidence >= 0.85) return 'critical'
  if (confidence >= 0.5) return 'warning'
  return 'low_confidence'
}

/**
 * passesCooldown — 순수함수.
 *
 * 쿨다운 비활성(재알림 가능) 여부를 Boolean으로 반환한다.
 *
 * SPEC §2.2(6) 디바운스 불변식:
 *   - lastNotifiedAt === null  → 발송 이력 없음 → 통과(true)
 *   - 경과시간(nowMs - lastNotifiedAt) >= debounceWindowMs → 통과(true)
 *   - 경과시간 < debounceWindowMs → 억제(false)
 *
 * 경계값 정의:
 *   - exactly-at-window: (nowMs - lastNotifiedAt) === debounceWindowMs → true (통과)
 *   - just-before:       (nowMs - lastNotifiedAt) === debounceWindowMs - 1 → false (억제)
 *
 * @param lastNotifiedAt    마지막 발송 ts (epoch ms). 발송 이력 없으면 null.
 * @param debounceWindowMs  디바운스 윈도우 (ms). 0 이하이면 항상 통과.
 * @param nowMs             현재 시각 (epoch ms) — 테스트 결정론을 위해 주입.
 * @returns                 true = 쿨다운 비활성(발송 가능), false = 쿨다운 활성(억제)
 */
export function passesCooldown(
  lastNotifiedAt: number | null,
  debounceWindowMs: number,
  nowMs: number,
): boolean {
  if (lastNotifiedAt === null) return true
  if (debounceWindowMs <= 0) return true
  return nowMs - lastNotifiedAt >= debounceWindowMs
}

/**
 * meetsThreshold — 순수함수.
 *
 * SPEC §2.1(6) (a)(b) 두 조건만 판정 (디바운스 제외):
 *   (a) kind !== 'none'
 *   (b) confidence >= decideThresh
 *
 * @param verdict       M3 DetectionVerdict (읽기 전용)
 * @param decideThresh  신뢰도 임계값 (DetectorConfig.decideThresh)
 * @returns             두 조건 모두 충족하면 true, 아니면 false
 */
export function meetsThreshold(
  verdict: Pick<DetectionVerdict, 'kind' | 'confidence'>,
  decideThresh: number,
): boolean {
  return verdict.kind !== 'none' && verdict.confidence >= decideThresh
}

/**
 * VerdictRouter — 순수함수.
 *
 * DetectionVerdict + sessionId + 설정 + 디바운스 상태 → RouteDecision
 * 부수효과 없음. 디바운스 상태 갱신은 호출자(NotifyDispatcher)가 담당.
 *
 * @param verdict        M3 DetectionVerdict (읽기 전용 소비)
 * @param sessionId      세션 ID
 * @param decideThresh   최종 판정 신뢰도 임계 (DetectorConfig.decideThresh)
 * @param notifyDebounceMs 디바운스 윈도우 (ms)
 * @param now            현재 시각 (epoch ms) — 테스트 결정론을 위해 주입
 * @param getDebounce    디바운스 상태 조회 함수 (순수 조회, 갱신 없음)
 * @returns              RouteDecision
 */
export function routeVerdict(
  verdict: DetectionVerdict,
  sessionId: string,
  decideThresh: number,
  notifyDebounceMs: number,
  now: number,
  getDebounce: GetDebounceState,
): RouteDecision {
  // (a) kind === 'none' → 억제
  if (verdict.kind === 'none') {
    return { shouldNotify: false, suppressedReason: 'kind_none' }
  }

  // (b) confidence < decideThresh → 억제
  if (verdict.confidence < decideThresh) {
    return { shouldNotify: false, suppressedReason: 'below_threshold' }
  }

  // 디바운스 키 = sessionId + '\x1f' + kind
  const dedupeKey = `${sessionId}\x1f${verdict.kind}`

  // (c) 디바운스 윈도우 내 동일 키 발송 이력 → 억제
  const { lastSentTs } = getDebounce(dedupeKey)
  if (lastSentTs !== undefined && now - lastSentTs < notifyDebounceMs) {
    return { shouldNotify: false, suppressedReason: 'debounced' }
  }

  // 셋 다 통과 → 발송
  const payload: NotificationPayload = {
    sessionId,
    kind: verdict.kind,
    subtype: verdict.subtype,
    confidence: verdict.confidence,
    reason: verdict.reason,
    evidence: verdict.evidence,
    ts: now,
    severity: mapSeverity(verdict.confidence, verdict.kind),
    dedupeKey,
  }

  return { shouldNotify: true, payload }
}

/**
 * judgeError/deferred DetectionRecord에 대한 LOW_CONFIDENCE 라우팅.
 *
 * SPEC §4: lowConfidenceNotify=true 시 severity='low_confidence'로 알림.
 *
 * @param verdict          DetectionVerdict (kind='none', subtype='inconclusive' 인 경우)
 * @param sessionId        세션 ID
 * @param notifyDebounceMs 디바운스 윈도우 (ms)
 * @param now              현재 시각 (epoch ms)
 * @param getDebounce      디바운스 상태 조회 함수
 * @returns                RouteDecision
 */
export function routeJudgeError(
  verdict: DetectionVerdict,
  sessionId: string,
  notifyDebounceMs: number,
  now: number,
  getDebounce: GetDebounceState,
): RouteDecision {
  const dedupeKey = `${sessionId}\x1f${verdict.kind}`

  const { lastSentTs } = getDebounce(dedupeKey)
  if (lastSentTs !== undefined && now - lastSentTs < notifyDebounceMs) {
    return { shouldNotify: false, suppressedReason: 'debounced' }
  }

  const payload: NotificationPayload = {
    sessionId,
    kind: verdict.kind,
    subtype: verdict.subtype,
    confidence: verdict.confidence,
    reason: verdict.reason,
    evidence: verdict.evidence,
    ts: now,
    severity: 'low_confidence',
    dedupeKey,
  }

  return { shouldNotify: true, payload }
}

/** VerdictRouter.route() 입력 컨텍스트 */
export interface RouteContext {
  /** 세션 ID */
  sessionId: string
  /** 현재 시각 (epoch ms) — 테스트 결정론을 위해 주입 */
  nowMs: number
  /** 디바운스 상태 조회 함수 */
  getDebounce: GetDebounceState
}

/**
 * VerdictRouter — 클래스 형태의 통합 라우터.
 *
 * route(verdict, config, ctx) 는 meetsThreshold + passesCooldown +
 * buildNotificationPayload 를 조합하는 통합 순수함수이다.
 * 부수효과 없음. 상태 갱신은 호출자(NotifyDispatcher)가 담당.
 */
export class VerdictRouter {
  /**
   * 통합 라우팅 순수함수.
   *
   * SPEC §2.1(6) 세 조건:
   *   (a) kind !== 'none'
   *   (b) confidence >= config.decideThresh
   *   (c) passesCooldown(lastSentTs, config.notifyDebounceMs, ctx.nowMs)
   * 셋 다 충족 → shouldNotify:true + 완전한 NotificationPayload
   * 하나라도 미충족 → shouldNotify:false + suppressedReason
   *
   * @param verdict  M3 DetectionVerdict (읽기전용 소비)
   * @param config   DetectorConfig (decideThresh, notifyDebounceMs 사용)
   * @param ctx      세션ID + nowMs + 디바운스 조회함수
   */
  route(
    verdict: DetectionVerdict,
    config: Pick<DetectorConfig, 'decideThresh' | 'notifyDebounceMs'>,
    ctx: RouteContext,
  ): RouteDecision {
    // (a) kind === 'none' → 억제
    if (!meetsThreshold(verdict, config.decideThresh)) {
      // distinguish kind_none vs below_threshold
      if (verdict.kind === 'none') {
        return { shouldNotify: false, suppressedReason: 'kind_none' }
      }
      return { shouldNotify: false, suppressedReason: 'below_threshold' }
    }

    // (c) 디바운스 쿨다운
    const dedupeKey = `${ctx.sessionId}\x1f${verdict.kind}`
    const { lastSentTs } = ctx.getDebounce(dedupeKey)
    const lastNotifiedAt = lastSentTs !== undefined ? lastSentTs : null
    if (!passesCooldown(lastNotifiedAt, config.notifyDebounceMs, ctx.nowMs)) {
      return { shouldNotify: false, suppressedReason: 'debounced' }
    }

    // 셋 다 통과 → buildNotificationPayload 로 완전한 payload 구성
    const payload = buildNotificationPayload(
      { final: verdict },
      { sessionId: ctx.sessionId, nowMs: ctx.nowMs },
    )

    return { shouldNotify: true, payload }
  }
}

/**
 * 메타 알림 라우팅 (비용상한 초과 등 시스템 이벤트).
 *
 * SPEC §4: severity='meta' 알림 1회 (디바운스로 1회만).
 *
 * @param sessionId        세션 ID
 * @param reason           메타 이벤트 설명
 * @param notifyDebounceMs 디바운스 윈도우 (ms)
 * @param now              현재 시각 (epoch ms)
 * @param getDebounce      디바운스 상태 조회 함수
 * @returns                RouteDecision
 */
export function routeMetaEvent(
  sessionId: string,
  reason: string,
  notifyDebounceMs: number,
  now: number,
  getDebounce: GetDebounceState,
): RouteDecision {
  const dedupeKey = `${sessionId}\x1fmeta`

  const { lastSentTs } = getDebounce(dedupeKey)
  if (lastSentTs !== undefined && now - lastSentTs < notifyDebounceMs) {
    return { shouldNotify: false, suppressedReason: 'debounced' }
  }

  const payload: NotificationPayload = {
    sessionId,
    kind: 'meta',
    subtype: 'system_event',
    confidence: 1,
    reason,
    evidence: [],
    ts: now,
    severity: 'meta',
    dedupeKey,
  }

  return { shouldNotify: true, payload }
}
