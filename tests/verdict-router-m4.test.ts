/**
 * tests/verdict-router-m4.test.ts
 *
 * VerdictRouter 단위 테스트.
 *
 * SPEC §2.1(6) 라우팅 판정:
 *   (a) kind !== 'none'
 *   (b) confidence >= decideThresh
 *   (c) 디바운스 윈도우 내 동일 (sessionId, kind) 미발송
 *
 * 부수효과 없음 — 순수함수 테스트.
 */

import { describe, expect, it } from '@jest/globals'
import { routeVerdict, routeJudgeError, routeMetaEvent } from '../src/notify/verdict-router.js'
import type { DetectionVerdict } from '../src/contracts.js'
import type { DebounceState } from '../src/notify/verdict-router.js'

// ─── 픽스처 헬퍼 ─────────────────────────────────────────────────────────────

function makeVerdict(
  overrides: Partial<DetectionVerdict> = {},
): DetectionVerdict {
  return {
    kind: 'thrashing',
    subtype: 'argkey_repeat',
    confidence: 0.92,
    signals: { maxCosine: 0.95 },
    evidence: [{ uuid: 'uuid-1', ts: 1000, note: 'gate ref 1' }],
    reason: 'thrashing detected',
    ...overrides,
  }
}

/** 항상 발송 이력 없음을 반환하는 디바운스 조회 함수 */
const noDebounce = (_key: string): DebounceState => ({ lastSentTs: undefined })

/** 발송 이력이 있는 디바운스 조회 함수 */
const withDebounce = (ts: number) =>
  (_key: string): DebounceState => ({ lastSentTs: ts })

const SESSION = 'session-abc-123'
const DECIDE_THRESH = 0.7
const DEBOUNCE_MS = 60_000
const NOW = 1_000_000

// ─── 테스트 ────────────────────────────────────────────────────────────────────

describe('routeVerdict (VerdictRouter 순수함수)', () => {
  describe('(a) kind=none → 항상 억제', () => {
    it('kind=none 이면 shouldNotify=false, suppressedReason=kind_none', () => {
      const verdict = makeVerdict({ kind: 'none' })
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.shouldNotify).toBe(false)
      expect(decision.suppressedReason).toBe('kind_none')
      expect(decision.payload).toBeUndefined()
    })

    it('kind=none 이면 confidence가 높아도 억제된다', () => {
      const verdict = makeVerdict({ kind: 'none', confidence: 0.99 })
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.shouldNotify).toBe(false)
      expect(decision.suppressedReason).toBe('kind_none')
    })
  })

  describe('(b) confidence < decideThresh → 억제', () => {
    it('confidence 0.5 < decideThresh 0.7 → below_threshold', () => {
      const verdict = makeVerdict({ confidence: 0.5 })
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.shouldNotify).toBe(false)
      expect(decision.suppressedReason).toBe('below_threshold')
    })

    it('confidence 정확히 decideThresh 0.7 → 통과', () => {
      const verdict = makeVerdict({ confidence: 0.7 })
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.shouldNotify).toBe(true)
    })

    it('confidence 0.69 < decideThresh 0.7 → 억제', () => {
      const verdict = makeVerdict({ confidence: 0.69 })
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.shouldNotify).toBe(false)
      expect(decision.suppressedReason).toBe('below_threshold')
    })
  })

  describe('(c) 디바운스 윈도우 내 동일 키 → 억제', () => {
    it('직전 발송이 DEBOUNCE_MS 내이면 debounced로 억제', () => {
      const verdict = makeVerdict()
      const lastSentTs = NOW - (DEBOUNCE_MS - 1000) // 아직 윈도우 내
      const decision = routeVerdict(
        verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW,
        withDebounce(lastSentTs),
      )

      expect(decision.shouldNotify).toBe(false)
      expect(decision.suppressedReason).toBe('debounced')
    })

    it('직전 발송이 정확히 DEBOUNCE_MS 이전이면 통과 (경계값)', () => {
      const verdict = makeVerdict()
      const lastSentTs = NOW - DEBOUNCE_MS // now - last = DEBOUNCE_MS → NOT < → 통과
      const decision = routeVerdict(
        verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW,
        withDebounce(lastSentTs),
      )

      expect(decision.shouldNotify).toBe(true)
    })

    it('직전 발송이 DEBOUNCE_MS를 초과했으면 통과', () => {
      const verdict = makeVerdict()
      const lastSentTs = NOW - (DEBOUNCE_MS + 1000) // 윈도우 초과
      const decision = routeVerdict(
        verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW,
        withDebounce(lastSentTs),
      )

      expect(decision.shouldNotify).toBe(true)
    })
  })

  describe('모든 조건 통과 → 발송', () => {
    it('thrashing + confidence 0.92 + 디바운스 없음 → shouldNotify=true', () => {
      const verdict = makeVerdict({ kind: 'thrashing', confidence: 0.92 })
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.shouldNotify).toBe(true)
      expect(decision.suppressedReason).toBeUndefined()
      expect(decision.payload).toBeDefined()
    })

    it('false_success + confidence 0.85 + 디바운스 없음 → shouldNotify=true', () => {
      const verdict = makeVerdict({ kind: 'false_success', confidence: 0.85 })
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.shouldNotify).toBe(true)
      expect(decision.payload).toBeDefined()
    })
  })

  describe('NotificationPayload 구조 검증', () => {
    it('payload.sessionId = 입력 sessionId', () => {
      const verdict = makeVerdict()
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.payload!.sessionId).toBe(SESSION)
    })

    it('payload.kind = verdict.kind', () => {
      const verdict = makeVerdict({ kind: 'thrashing' })
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.payload!.kind).toBe('thrashing')
    })

    it('payload.confidence = verdict.confidence', () => {
      const verdict = makeVerdict({ confidence: 0.92 })
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.payload!.confidence).toBe(0.92)
    })

    it('payload.evidence = verdict.evidence', () => {
      const evidence = [{ uuid: 'ev-1', ts: 999, note: 'test note' }]
      const verdict = makeVerdict({ evidence })
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.payload!.evidence).toEqual(evidence)
    })

    it('payload.ts = now', () => {
      const verdict = makeVerdict()
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.payload!.ts).toBe(NOW)
    })

    it('payload.dedupeKey = sessionId + 0x1F + kind', () => {
      const verdict = makeVerdict({ kind: 'thrashing' })
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.payload!.dedupeKey).toBe(`${SESSION}\x1fthrashing`)
    })

    it('high confidence → severity=critical', () => {
      const verdict = makeVerdict({ confidence: 0.92 })
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.payload!.severity).toBe('critical')
    })

    it('medium confidence → severity=warning', () => {
      const verdict = makeVerdict({ confidence: 0.75 })
      const decision = routeVerdict(verdict, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, noDebounce)

      expect(decision.payload!.severity).toBe('warning')
    })
  })

  describe('디바운스 키 정확성', () => {
    it('다른 kind는 다른 디바운스 키를 사용한다', () => {
      const verdictThrashing = makeVerdict({ kind: 'thrashing' })
      const verdictFalseSuccess = makeVerdict({ kind: 'false_success' })

      let queriedKey: string | undefined
      const captureKey = (key: string): DebounceState => {
        queriedKey = key
        return { lastSentTs: undefined }
      }

      routeVerdict(verdictThrashing, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, captureKey)
      const thrashingKey = queriedKey

      routeVerdict(verdictFalseSuccess, SESSION, DECIDE_THRESH, DEBOUNCE_MS, NOW, captureKey)
      const falseSuccessKey = queriedKey

      expect(thrashingKey).toBe(`${SESSION}\x1fthrashing`)
      expect(falseSuccessKey).toBe(`${SESSION}\x1ffalse_success`)
      expect(thrashingKey).not.toBe(falseSuccessKey)
    })

    it('다른 sessionId는 다른 디바운스 키를 사용한다', () => {
      const verdict = makeVerdict()
      let queriedKey: string | undefined
      const captureKey = (key: string): DebounceState => {
        queriedKey = key
        return { lastSentTs: undefined }
      }

      routeVerdict(verdict, 'session-A', DECIDE_THRESH, DEBOUNCE_MS, NOW, captureKey)
      const keyA = queriedKey
      routeVerdict(verdict, 'session-B', DECIDE_THRESH, DEBOUNCE_MS, NOW, captureKey)
      const keyB = queriedKey

      expect(keyA).not.toBe(keyB)
    })
  })
})

describe('routeJudgeError (LOW_CONFIDENCE 라우팅)', () => {
  it('judgeError 판정을 low_confidence severity로 라우팅한다', () => {
    const verdict = makeVerdict({ kind: 'none', subtype: 'inconclusive', confidence: 0 })
    const decision = routeJudgeError(verdict, SESSION, DEBOUNCE_MS, NOW, noDebounce)

    expect(decision.shouldNotify).toBe(true)
    expect(decision.payload!.severity).toBe('low_confidence')
  })

  it('디바운스 내이면 억제된다', () => {
    const verdict = makeVerdict({ kind: 'none', subtype: 'inconclusive', confidence: 0 })
    const lastSentTs = NOW - 1000
    const decision = routeJudgeError(verdict, SESSION, DEBOUNCE_MS, NOW, withDebounce(lastSentTs))

    expect(decision.shouldNotify).toBe(false)
    expect(decision.suppressedReason).toBe('debounced')
  })
})

describe('routeMetaEvent (메타 알림)', () => {
  it('메타 이벤트를 severity=meta로 라우팅한다', () => {
    const decision = routeMetaEvent(SESSION, '일일 비용 상한 초과', DEBOUNCE_MS, NOW, noDebounce)

    expect(decision.shouldNotify).toBe(true)
    expect(decision.payload!.severity).toBe('meta')
    expect(decision.payload!.kind).toBe('meta')
    expect(decision.payload!.reason).toBe('일일 비용 상한 초과')
  })

  it('디바운스 내이면 억제된다 (1회만)', () => {
    const lastSentTs = NOW - 1000
    const decision = routeMetaEvent(SESSION, '비용상한', DEBOUNCE_MS, NOW, withDebounce(lastSentTs))

    expect(decision.shouldNotify).toBe(false)
    expect(decision.suppressedReason).toBe('debounced')
  })

  it('메타 dedupeKey는 sessionId + 0x1F + meta', () => {
    const decision = routeMetaEvent(SESSION, '메타', DEBOUNCE_MS, NOW, noDebounce)
    expect(decision.payload!.dedupeKey).toBe(`${SESSION}\x1fmeta`)
  })
})
