// tests/wilson-interval-sub-ac-2a.test.ts
// Sub-AC 2a: wilsonInterval 단위 테스트.
// 경계값(0/0, 1/1, 15/30 등)과 95% CI 수치 검증.

import { wilsonInterval } from '../src/eval/metrics.js'

describe('wilsonInterval', () => {
  // ---- 경계값 테스트 ----

  describe('경계값 — total=0 (무정보 사전)', () => {
    it('total=0이면 estimate=0, low=0, high=1 반환', () => {
      const result = wilsonInterval(0, 0)
      expect(result.estimate).toBe(0)
      expect(result.low).toBe(0)
      expect(result.high).toBe(1)
      expect(result.total).toBe(0)
      expect(result.successes).toBe(0)
    })
  })

  describe('경계값 — successes=0 (완전 실패)', () => {
    it('0/10: estimate=0, low>=0', () => {
      const result = wilsonInterval(0, 10)
      expect(result.estimate).toBe(0)
      expect(result.low).toBeGreaterThanOrEqual(0)
      expect(result.high).toBeLessThan(0.4) // 상한은 제한적
      expect(result.high).toBeGreaterThan(0) // 그러나 0보다 큼 (Wilson CI)
    })
  })

  describe('경계값 — successes=total (완전 성공)', () => {
    it('1/1: estimate=1, high=1, low>0', () => {
      const result = wilsonInterval(1, 1)
      expect(result.estimate).toBe(1)
      expect(result.high).toBe(1)
      expect(result.low).toBeGreaterThan(0) // Wilson은 0보다 큰 하한
      expect(result.low).toBeLessThan(1)
    })

    it('10/10: estimate=1, high=1, low>0.6', () => {
      const result = wilsonInterval(10, 10)
      expect(result.estimate).toBe(1)
      expect(result.high).toBe(1)
      expect(result.low).toBeGreaterThan(0.6)
    })
  })

  // ---- 대칭성 테스트 ----

  describe('대칭성 — p + (1-p) = 1', () => {
    it('15/30과 15/30은 동일 (p=0.5)', () => {
      const result = wilsonInterval(15, 30)
      // p=0.5이면 CI는 중앙 대칭
      const midpoint = (result.low + result.high) / 2
      expect(midpoint).toBeCloseTo(result.estimate, 5)
    })

    it('10/30 과 20/30은 대칭 CI를 가짐', () => {
      const r1 = wilsonInterval(10, 30) // p=1/3
      const r2 = wilsonInterval(20, 30) // p=2/3
      // r1.low ≈ 1 - r2.high, r1.high ≈ 1 - r2.low
      expect(r1.low).toBeCloseTo(1 - r2.high, 5)
      expect(r1.high).toBeCloseTo(1 - r2.low, 5)
    })
  })

  // ---- 수치 검증 — 알려진 95% CI 값 ----

  describe('수치 검증 (z=1.96, 95% CI)', () => {
    it('15/30 (p=0.5): CI는 약 [0.32, 0.68]', () => {
      const result = wilsonInterval(15, 30)
      expect(result.estimate).toBeCloseTo(0.5, 5)
      // Wilson interval for p=0.5, n=30: approx [0.318, 0.682]
      expect(result.low).toBeGreaterThan(0.30)
      expect(result.low).toBeLessThan(0.36)
      expect(result.high).toBeGreaterThan(0.64)
      expect(result.high).toBeLessThan(0.70)
    })

    it('7/30 (p≈0.233): CI 하한>0, 상한<0.45', () => {
      const result = wilsonInterval(7, 30)
      expect(result.estimate).toBeCloseTo(7 / 30, 5)
      expect(result.low).toBeGreaterThan(0)
      expect(result.high).toBeLessThan(0.45)
    })

    it('1/100 (소수): CI 하한>0', () => {
      const result = wilsonInterval(1, 100)
      expect(result.estimate).toBeCloseTo(0.01, 5)
      expect(result.low).toBeGreaterThanOrEqual(0)
      expect(result.high).toBeLessThan(0.06)
    })

    it('99/100 (다수): CI 상한<=1', () => {
      const result = wilsonInterval(99, 100)
      expect(result.estimate).toBeCloseTo(0.99, 5)
      expect(result.high).toBeLessThanOrEqual(1)
      expect(result.low).toBeGreaterThan(0.94)
    })

    it('정확한 수치 검증 — 5/20', () => {
      // p=0.25, n=20, z=1.96
      // z² = 3.8416
      // denom = 1 + 3.8416/20 = 1.19208
      // center = (0.25 + 3.8416/40) / 1.19208 = (0.25 + 0.09604) / 1.19208 ≈ 0.29027
      // margin = 1.96 * sqrt(0.25*0.75/20 + 3.8416/1600) / 1.19208
      //        = 1.96 * sqrt(0.009375 + 0.0024010) / 1.19208
      //        = 1.96 * sqrt(0.0117760) / 1.19208
      //        ≈ 1.96 * 0.10852 / 1.19208 ≈ 0.17853
      // low ≈ 0.29027 - 0.17853 ≈ 0.11174 → ~0.112
      // high ≈ 0.29027 + 0.17853 ≈ 0.46880 → ~0.469
      const result = wilsonInterval(5, 20)
      expect(result.estimate).toBeCloseTo(0.25, 5)
      expect(result.low).toBeCloseTo(0.112, 2)
      expect(result.high).toBeCloseTo(0.469, 2)
    })
  })

  // ---- z값 변경 테스트 ----

  describe('z값 변경 — 90% CI (z=1.645)', () => {
    it('z=1.645이면 CI가 z=1.96보다 좁음', () => {
      const ci95 = wilsonInterval(15, 30, 1.96)
      const ci90 = wilsonInterval(15, 30, 1.645)
      const width95 = ci95.high - ci95.low
      const width90 = ci90.high - ci90.low
      expect(width90).toBeLessThan(width95)
    })
  })

  describe('z값 변경 — 99% CI (z=2.576)', () => {
    it('z=2.576이면 CI가 z=1.96보다 넓음', () => {
      const ci95 = wilsonInterval(15, 30, 1.96)
      const ci99 = wilsonInterval(15, 30, 2.576)
      const width95 = ci95.high - ci95.low
      const width99 = ci99.high - ci99.low
      expect(width99).toBeGreaterThan(width95)
    })
  })

  // ---- CI 범위 보장 ----

  describe('CI 범위 보장 [0, 1]', () => {
    it('low >= 0, high <= 1 보장 (다양한 입력)', () => {
      const cases: [number, number][] = [
        [0, 1],
        [1, 1],
        [0, 100],
        [100, 100],
        [1, 2],
        [50, 100],
        [3, 7],
      ]
      for (const [s, t] of cases) {
        const r = wilsonInterval(s, t)
        expect(r.low).toBeGreaterThanOrEqual(0)
        expect(r.high).toBeLessThanOrEqual(1)
        expect(r.low).toBeLessThanOrEqual(r.high)
        expect(r.estimate).toBeCloseTo(s / t, 10)
      }
    })
  })

  // ---- 에러 케이스 ----

  describe('에러 케이스', () => {
    it('successes > total이면 RangeError', () => {
      expect(() => wilsonInterval(11, 10)).toThrow(RangeError)
    })

    it('successes < 0이면 RangeError', () => {
      expect(() => wilsonInterval(-1, 10)).toThrow(RangeError)
    })

    it('total < 0이면 RangeError', () => {
      expect(() => wilsonInterval(0, -1)).toThrow(RangeError)
    })
  })

  // ---- minSupport 시나리오 검증 ----

  describe('SPEC §6 소표본 시나리오 (양성<15)', () => {
    it('7건 양성 — CI는 넓음 (정성폴백 대상)', () => {
      const result = wilsonInterval(7, 30)
      const width = result.high - result.low
      // 소표본이므로 CI가 넓어야 함
      expect(width).toBeGreaterThan(0.25)
    })

    it('15건 양성 (minSupport 경계) — CI 산출 가능', () => {
      const result = wilsonInterval(15, 30)
      expect(result.estimate).toBeCloseTo(0.5, 5)
      expect(result.low).toBeGreaterThan(0)
      expect(result.high).toBeLessThan(1)
    })

    it('0건 양성/30건 — CI 하한=0 (Wilson 보정 포함)', () => {
      const result = wilsonInterval(0, 30)
      expect(result.estimate).toBe(0)
      expect(result.low).toBe(0)
      expect(result.high).toBeGreaterThan(0) // Wilson은 0보다 큰 상한
    })
  })
})
