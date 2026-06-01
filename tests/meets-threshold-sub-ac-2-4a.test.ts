/**
 * tests/meets-threshold-sub-ac-2-4a.test.ts
 *
 * meetsThreshold 순수함수 단위 테스트.
 *
 * Sub-AC 2.4a: meetsThreshold(verdict, decideThresh)
 *   — kind!=='none' AND confidence>=decideThresh 두 조건을 Boolean으로 반환.
 *   — 경계값(equal/below/above) + kind==='none' 케이스 포함.
 *
 * 부수효과 없음 (순수함수). 실제 OS 알림·네트워크 발생 없음.
 */

import { describe, expect, it } from '@jest/globals'
import { meetsThreshold } from '../src/notify/verdict-router.js'

// ─── 픽스처 헬퍼 ─────────────────────────────────────────────────────────────

function makeInput(
  kind: 'thrashing' | 'false_success' | 'none',
  confidence: number,
) {
  return { kind, confidence } as const
}

const THRESH = 0.7

// ─── 테스트 ────────────────────────────────────────────────────────────────────

describe('meetsThreshold — 순수함수 (Sub-AC 2.4a)', () => {
  // ── (a) kind=none 케이스 ──────────────────────────────────────────────────

  describe('(a) kind=none → 항상 false', () => {
    it('kind=none, confidence=0 → false', () => {
      expect(meetsThreshold(makeInput('none', 0), THRESH)).toBe(false)
    })

    it('kind=none, confidence=1.0 (최고) → false', () => {
      expect(meetsThreshold(makeInput('none', 1.0), THRESH)).toBe(false)
    })

    it('kind=none, confidence=decideThresh(경계값) → false', () => {
      expect(meetsThreshold(makeInput('none', THRESH), THRESH)).toBe(false)
    })

    it('kind=none, confidence>decideThresh → false (threshold 통과해도 kind=none이면 항상 false)', () => {
      expect(meetsThreshold(makeInput('none', 0.99), THRESH)).toBe(false)
    })
  })

  // ── (b) confidence 경계값 케이스 ─────────────────────────────────────────

  describe('(b) confidence 경계값 — kind=thrashing', () => {
    it('confidence 정확히 decideThresh(0.7) → true (equal → 통과)', () => {
      expect(meetsThreshold(makeInput('thrashing', THRESH), THRESH)).toBe(true)
    })

    it('confidence decideThresh-epsilon(0.699) → false (below)', () => {
      expect(meetsThreshold(makeInput('thrashing', 0.699), THRESH)).toBe(false)
    })

    it('confidence decideThresh+epsilon(0.701) → true (above)', () => {
      expect(meetsThreshold(makeInput('thrashing', 0.701), THRESH)).toBe(true)
    })

    it('confidence=0 → false', () => {
      expect(meetsThreshold(makeInput('thrashing', 0), THRESH)).toBe(false)
    })

    it('confidence=1.0 → true', () => {
      expect(meetsThreshold(makeInput('thrashing', 1.0), THRESH)).toBe(true)
    })
  })

  describe('(b) confidence 경계값 — kind=false_success', () => {
    it('confidence 정확히 decideThresh → true', () => {
      expect(meetsThreshold(makeInput('false_success', THRESH), THRESH)).toBe(true)
    })

    it('confidence below decideThresh → false', () => {
      expect(meetsThreshold(makeInput('false_success', 0.5), THRESH)).toBe(false)
    })

    it('confidence above decideThresh → true', () => {
      expect(meetsThreshold(makeInput('false_success', 0.9), THRESH)).toBe(true)
    })
  })

  // ── 다양한 decideThresh 경계값 ────────────────────────────────────────────

  describe('다양한 decideThresh 값', () => {
    it('decideThresh=0 이면 confidence=0도 통과 (kind!==none)', () => {
      expect(meetsThreshold(makeInput('thrashing', 0), 0)).toBe(true)
    })

    it('decideThresh=1.0 이면 confidence=1.0만 통과', () => {
      expect(meetsThreshold(makeInput('thrashing', 1.0), 1.0)).toBe(true)
      expect(meetsThreshold(makeInput('thrashing', 0.999), 1.0)).toBe(false)
    })

    it('decideThresh=0.5 경계값: confidence=0.5 → true, confidence=0.49 → false', () => {
      expect(meetsThreshold(makeInput('thrashing', 0.5), 0.5)).toBe(true)
      expect(meetsThreshold(makeInput('thrashing', 0.49), 0.5)).toBe(false)
    })
  })

  // ── 반환 타입은 boolean ───────────────────────────────────────────────────

  describe('반환값은 순수 boolean', () => {
    it('true 케이스의 반환값은 true (=== true)', () => {
      const result = meetsThreshold(makeInput('thrashing', 0.9), THRESH)
      expect(result).toBe(true)
      expect(typeof result).toBe('boolean')
    })

    it('false 케이스의 반환값은 false (=== false)', () => {
      const result = meetsThreshold(makeInput('none', 0.9), THRESH)
      expect(result).toBe(false)
      expect(typeof result).toBe('boolean')
    })
  })
})
