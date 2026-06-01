/**
 * tests/verdict-router-route-integration.test.ts
 *
 * VerdictRouter.route(verdict, config, ctx) 통합 순수함수 단위 테스트.
 *
 * Sub-AC 2.4d: meetsThreshold + passesCooldown + buildNotificationPayload 를
 * 조합해 shouldNotify:true + 완전한 NotificationPayload 를 포함한 RouteDecision
 * 을 반환하고, 세 조건 모두 충족 / 하나라도 미충족(shouldNotify:false) 케이스
 * 를 포함한다.
 *
 * 부수효과 없음 — 순수함수 테스트. 실제 OS 알림·네트워크 없음.
 */

import { describe, expect, it } from '@jest/globals'
import { VerdictRouter } from '../src/notify/verdict-router.js'
import type { DetectionVerdict } from '../src/contracts.js'
import type { DebounceState, RouteContext } from '../src/notify/verdict-router.js'

// ─── 픽스처 헬퍼 ─────────────────────────────────────────────────────────────

function makeVerdict(overrides: Partial<DetectionVerdict> = {}): DetectionVerdict {
  return {
    kind: 'thrashing',
    subtype: 'argkey_repeat',
    confidence: 0.92,
    signals: { maxCosine: 0.95 },
    evidence: [{ uuid: 'uuid-1', ts: 1000, note: 'test evidence' }],
    reason: 'thrashing detected',
    ...overrides,
  }
}

const noDebounce = (_key: string): DebounceState => ({ lastSentTs: undefined })
const withDebounce = (ts: number) => (_key: string): DebounceState => ({ lastSentTs: ts })

const SESSION = 'session-test-001'
const NOW = 2_000_000

const CONFIG = {
  decideThresh: 0.7,
  notifyDebounceMs: 60_000,
}

function makeCtx(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    sessionId: SESSION,
    nowMs: NOW,
    getDebounce: noDebounce,
    ...overrides,
  }
}

const router = new VerdictRouter()

// ─── 테스트 ────────────────────────────────────────────────────────────────────

describe('VerdictRouter.route() — 통합 순수함수', () => {
  // ── 모든 조건 충족 → shouldNotify:true + 완전한 payload ──────────────────────

  describe('세 조건 모두 충족 → shouldNotify:true', () => {
    it('thrashing + high confidence + 디바운스 없음 → shouldNotify=true', () => {
      const verdict = makeVerdict({ kind: 'thrashing', confidence: 0.92 })
      const decision = router.route(verdict, CONFIG, makeCtx())

      expect(decision.shouldNotify).toBe(true)
      expect(decision.suppressedReason).toBeUndefined()
      expect(decision.payload).toBeDefined()
    })

    it('false_success + confidence at threshold → shouldNotify=true', () => {
      const verdict = makeVerdict({ kind: 'false_success', confidence: 0.7 })
      const decision = router.route(verdict, CONFIG, makeCtx())

      expect(decision.shouldNotify).toBe(true)
      expect(decision.payload).toBeDefined()
    })

    it('payload에 sessionId가 포함된다', () => {
      const verdict = makeVerdict()
      const decision = router.route(verdict, CONFIG, makeCtx())

      expect(decision.payload!.sessionId).toBe(SESSION)
    })

    it('payload에 evidence가 동반된다 (사람 호출용)', () => {
      const evidence = [{ uuid: 'ev-1', ts: 500, note: '근거 항목' }]
      const verdict = makeVerdict({ evidence })
      const decision = router.route(verdict, CONFIG, makeCtx())

      expect(decision.payload!.evidence).toEqual(evidence)
    })

    it('payload.ts = ctx.nowMs', () => {
      const verdict = makeVerdict()
      const decision = router.route(verdict, CONFIG, makeCtx({ nowMs: NOW }))

      expect(decision.payload!.ts).toBe(NOW)
    })

    it('payload.dedupeKey = sessionId + 0x1F + kind', () => {
      const verdict = makeVerdict({ kind: 'thrashing' })
      const decision = router.route(verdict, CONFIG, makeCtx())

      expect(decision.payload!.dedupeKey).toBe(`${SESSION}\x1fthrashing`)
    })

    it('payload.severity = critical (confidence >= 0.85)', () => {
      const verdict = makeVerdict({ confidence: 0.92 })
      const decision = router.route(verdict, CONFIG, makeCtx())

      expect(decision.payload!.severity).toBe('critical')
    })

    it('payload.severity = warning (0.5 <= confidence < 0.85)', () => {
      const verdict = makeVerdict({ confidence: 0.75 })
      const decision = router.route(verdict, CONFIG, makeCtx())

      expect(decision.payload!.severity).toBe('warning')
    })

    it('디바운스 윈도우 정확히 초과 시 통과 (경계값)', () => {
      const lastSentTs = NOW - CONFIG.notifyDebounceMs  // elapsed == debounceMs → pass
      const verdict = makeVerdict()
      const decision = router.route(verdict, CONFIG, makeCtx({ getDebounce: withDebounce(lastSentTs) }))

      expect(decision.shouldNotify).toBe(true)
    })
  })

  // ── 조건 (a) 미충족: kind=none → kind_none ───────────────────────────────────

  describe('조건 (a) 미충족: kind=none → kind_none 억제', () => {
    it('kind=none 이면 shouldNotify=false, suppressedReason=kind_none', () => {
      const verdict = makeVerdict({ kind: 'none', confidence: 0.99 })
      const decision = router.route(verdict, CONFIG, makeCtx())

      expect(decision.shouldNotify).toBe(false)
      expect(decision.suppressedReason).toBe('kind_none')
      expect(decision.payload).toBeUndefined()
    })
  })

  // ── 조건 (b) 미충족: confidence < decideThresh → below_threshold ──────────

  describe('조건 (b) 미충족: confidence < decideThresh → below_threshold 억제', () => {
    it('confidence 0.5 < 0.7 → below_threshold', () => {
      const verdict = makeVerdict({ confidence: 0.5 })
      const decision = router.route(verdict, CONFIG, makeCtx())

      expect(decision.shouldNotify).toBe(false)
      expect(decision.suppressedReason).toBe('below_threshold')
      expect(decision.payload).toBeUndefined()
    })

    it('confidence 0.69 < 0.7 → below_threshold', () => {
      const verdict = makeVerdict({ confidence: 0.69 })
      const decision = router.route(verdict, CONFIG, makeCtx())

      expect(decision.shouldNotify).toBe(false)
      expect(decision.suppressedReason).toBe('below_threshold')
    })
  })

  // ── 조건 (c) 미충족: 디바운스 윈도우 내 재알림 → debounced ─────────────────

  describe('조건 (c) 미충족: 디바운스 윈도우 내 → debounced 억제', () => {
    it('직전 발송이 윈도우 내이면 shouldNotify=false, suppressedReason=debounced', () => {
      const lastSentTs = NOW - (CONFIG.notifyDebounceMs - 1000)  // still in window
      const verdict = makeVerdict()
      const decision = router.route(verdict, CONFIG, makeCtx({ getDebounce: withDebounce(lastSentTs) }))

      expect(decision.shouldNotify).toBe(false)
      expect(decision.suppressedReason).toBe('debounced')
      expect(decision.payload).toBeUndefined()
    })

    it('직전 발송이 1ms 전이면 debounced', () => {
      const lastSentTs = NOW - 1
      const verdict = makeVerdict()
      const decision = router.route(verdict, CONFIG, makeCtx({ getDebounce: withDebounce(lastSentTs) }))

      expect(decision.shouldNotify).toBe(false)
      expect(decision.suppressedReason).toBe('debounced')
    })
  })

  // ── NotificationPayload 필드 완전성 검증 (§7-2 #7 정본) ───────────────────

  describe('NotificationPayload 완전성 — §7-2 #7 정본 필드', () => {
    it('payload에 kind, subtype, confidence, reason, evidence, ts, severity, dedupeKey 모두 존재', () => {
      const verdict = makeVerdict({
        kind: 'false_success',
        subtype: 'self_approval',
        confidence: 0.88,
        reason: 'self approval detected',
        evidence: [{ uuid: 'e1', ts: 100, note: 'note1' }],
      })
      const decision = router.route(verdict, CONFIG, makeCtx())

      const p = decision.payload!
      expect(p.sessionId).toBe(SESSION)
      expect(p.kind).toBe('false_success')
      expect(p.subtype).toBe('self_approval')
      expect(p.confidence).toBe(0.88)
      expect(p.reason).toBe('self approval detected')
      expect(p.evidence).toEqual([{ uuid: 'e1', ts: 100, note: 'note1' }])
      expect(typeof p.ts).toBe('number')
      expect(['critical', 'warning', 'low_confidence', 'meta']).toContain(p.severity)
      expect(typeof p.dedupeKey).toBe('string')
    })
  })
})
