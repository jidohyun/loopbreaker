/**
 * tests/passes-cooldown-sub-ac-2-4b.test.ts
 *
 * Sub-AC 2.4b: passesCooldown(lastNotifiedAt, debounceWindowMs, nowMs) 순수함수
 * 쿨다운 비활성(재알림 가능) 여부를 Boolean으로 반환.
 *
 * 경계값 케이스:
 *   - lastNotifiedAt === null → 항상 통과
 *   - exactly-at-window      → 통과
 *   - just-before-window     → 억제
 *   - well within window     → 억제
 *   - well past window       → 통과
 *   - debounceWindowMs <= 0  → 항상 통과
 */

import { passesCooldown } from '../src/notify/verdict-router.js'

describe('passesCooldown — 순수함수', () => {
  const NOW = 1_000_000
  const WINDOW = 60_000 // 60초

  // ── null 케이스 ──────────────────────────────────────────
  it('lastNotifiedAt === null → 발송 이력 없음 → 통과(true)', () => {
    expect(passesCooldown(null, WINDOW, NOW)).toBe(true)
  })

  it('lastNotifiedAt === null, window=0 → 통과(true)', () => {
    expect(passesCooldown(null, 0, NOW)).toBe(true)
  })

  // ── exactly-at-window 경계값 ─────────────────────────────
  it('경과시간 === debounceWindowMs (exactly-at-window) → 통과(true)', () => {
    const lastNotifiedAt = NOW - WINDOW // 정확히 window만큼 지남
    expect(passesCooldown(lastNotifiedAt, WINDOW, NOW)).toBe(true)
  })

  // ── just-before-window 경계값 ────────────────────────────
  it('경과시간 === debounceWindowMs - 1 (just-before) → 억제(false)', () => {
    const lastNotifiedAt = NOW - WINDOW + 1 // 1ms 부족
    expect(passesCooldown(lastNotifiedAt, WINDOW, NOW)).toBe(false)
  })

  // ── 일반 억제 케이스 ──────────────────────────────────────
  it('경과시간 < debounceWindowMs → 억제(false)', () => {
    const lastNotifiedAt = NOW - WINDOW / 2 // 절반만 지남
    expect(passesCooldown(lastNotifiedAt, WINDOW, NOW)).toBe(false)
  })

  it('lastNotifiedAt === nowMs (방금 발송) → 억제(false)', () => {
    expect(passesCooldown(NOW, WINDOW, NOW)).toBe(false)
  })

  it('lastNotifiedAt가 nowMs보다 1ms 이전 → 억제(false)', () => {
    expect(passesCooldown(NOW - 1, WINDOW, NOW)).toBe(false)
  })

  // ── 일반 통과 케이스 ──────────────────────────────────────
  it('경과시간 > debounceWindowMs → 통과(true)', () => {
    const lastNotifiedAt = NOW - WINDOW - 1 // window 초과
    expect(passesCooldown(lastNotifiedAt, WINDOW, NOW)).toBe(true)
  })

  it('경과시간이 window의 두 배 → 통과(true)', () => {
    const lastNotifiedAt = NOW - WINDOW * 2
    expect(passesCooldown(lastNotifiedAt, WINDOW, NOW)).toBe(true)
  })

  // ── debounceWindowMs 특수값 ───────────────────────────────
  it('debounceWindowMs === 0 → 항상 통과(true)', () => {
    // window가 0이면 쿨다운 없음
    expect(passesCooldown(NOW, 0, NOW)).toBe(true)
  })

  it('debounceWindowMs < 0 → 항상 통과(true)', () => {
    expect(passesCooldown(NOW, -1, NOW)).toBe(true)
  })

  it('debounceWindowMs === 1 (최소 윈도우), 경과=0ms → 억제(false)', () => {
    expect(passesCooldown(NOW, 1, NOW)).toBe(false)
  })

  it('debounceWindowMs === 1 (최소 윈도우), 경과=1ms → 통과(true)', () => {
    expect(passesCooldown(NOW - 1, 1, NOW)).toBe(true)
  })

  // ── 타입 결정론 확인 ──────────────────────────────────────
  it('반환값은 항상 boolean (true)', () => {
    const result = passesCooldown(null, WINDOW, NOW)
    expect(typeof result).toBe('boolean')
    expect(result).toBe(true)
  })

  it('반환값은 항상 boolean (false)', () => {
    const result = passesCooldown(NOW, WINDOW, NOW)
    expect(typeof result).toBe('boolean')
    expect(result).toBe(false)
  })
})
