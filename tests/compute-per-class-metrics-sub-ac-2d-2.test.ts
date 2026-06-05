// tests/compute-per-class-metrics-sub-ac-2d-2.test.ts
// Sub-AC 2d-2: computePerClassMetrics 단위 테스트
//
// 검증 대상:
//   - TP=0 케이스 (precision=1.0, recall=0, f1=0)
//   - FP=0 케이스 (precision=1.0, recall=정상 산출)
//   - 정상 케이스 (precision/recall/f1 정상 산출)
//   - 소표본 정성폴백 (positiveCount < minSupport → skipped=true)
//   - Wilson CI 범위 검증 [0, 1]
//   - 빈 혼동행렬 처리

import { buildConfusionMatrix, computePerClassMetrics } from '../src/eval/metrics.js'
import type { ConfusionMatrix } from '../src/eval/metrics.js'

// ---- 헬퍼: 고정 혼동행렬 직접 생성 ----
function makeConfusionMatrix(
  thrTp: number, thrFp: number, thrFn: number, thrTn: number,
  fsTp: number,  fsFp: number,  fsFn: number,  fsTn: number,
  noneTp: number, noneFp: number, noneFn: number, noneTn: number,
  total: number,
): ConfusionMatrix {
  return {
    perClass: {
      thrashing:     { tp: thrTp, fp: thrFp, fn: thrFn, tn: thrTn },
      false_success: { tp: fsTp,  fp: fsFp,  fn: fsFn,  tn: fsTn  },
      none:          { tp: noneTp, fp: noneFp, fn: noneFn, tn: noneTn },
    },
    confusionRaw: {
      thrashing:     { thrashing: 0, false_success: 0, none: 0 },
      false_success: { thrashing: 0, false_success: 0, none: 0 },
      none:          { thrashing: 0, false_success: 0, none: 0 },
    },
    totalSamples: total,
  }
}

describe('computePerClassMetrics', () => {
  // ---- 빈 혼동행렬 ----
  describe('empty confusion matrix (all zeros)', () => {
    const cm = buildConfusionMatrix([], [])

    it('returns 3 entries for all kinds', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      expect(result).toHaveLength(3)
    })

    it('has kind order: thrashing, false_success, none', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      expect(result[0]!.kind).toBe('thrashing')
      expect(result[1]!.kind).toBe('false_success')
      expect(result[2]!.kind).toBe('none')
    })

    it('all have positiveCount=0 and skipped=true with default minSupport=15', () => {
      const result = computePerClassMetrics(cm)
      for (const entry of result) {
        expect(entry.skipped).toBe(true)
        expect(entry.positiveCount).toBe(0)
        expect(entry.skippedReason).toContain('minSupport')
      }
    })

    it('with minSupport=0: precision=1.0, recall=1.0, f1=1.0 (both denominators=0)', () => {
      const result = computePerClassMetrics(cm, { minSupport: 0 })
      for (const entry of result) {
        expect(entry.skipped).toBe(false)
        expect(entry.precision).toBe(1.0) // tp+fp=0 → 1.0
        expect(entry.recall).toBe(1.0)    // tp+fn=0 → 1.0
        // f1 = 2*1*1/(1+1) = 1.0
        expect(entry.f1).toBeCloseTo(1.0, 6)
      }
    })
  })

  // ---- TP=0 케이스 ----
  describe('TP=0 케이스', () => {
    // thrashing: tp=0, fp=3, fn=5, tn=10
    // precision = 0/(0+3) = 0,  recall = 0/(0+5) = 0,  f1 = 0
    const cm = makeConfusionMatrix(
      0, 3, 5, 10,   // thrashing
      5, 0, 0, 13,   // false_success (정상)
      8, 1, 1, 8,    // none (정상)
      18,
    )

    it('thrashing precision=0, recall=0, f1=0 when TP=0', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const thr = result.find(e => e.kind === 'thrashing')!
      expect(thr.skipped).toBe(false)
      expect(thr.tp).toBe(0)
      expect(thr.fp).toBe(3)
      expect(thr.fn).toBe(5)
      expect(thr.precision).toBeCloseTo(0, 6)
      expect(thr.recall).toBeCloseTo(0, 6)
      expect(thr.f1).toBeCloseTo(0, 6)
    })

    it('Wilson CI for precision is valid [0,1] when TP=0', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const thr = result.find(e => e.kind === 'thrashing')!
      expect(thr.wilsonPrecisionLow).toBeGreaterThanOrEqual(0)
      expect(thr.wilsonPrecisionHigh).toBeLessThanOrEqual(1)
      expect(thr.wilsonPrecisionLow).toBeLessThanOrEqual(thr.wilsonPrecisionHigh!)
    })
  })

  // ---- FP=0 케이스 ----
  describe('FP=0 케이스', () => {
    // false_success: tp=8, fp=0, fn=2, tn=8
    // precision = 8/(8+0) = 1.0,  recall = 8/(8+2) = 0.8,  f1 = 2*1*0.8/(1+0.8) ≈ 0.8889
    const cm = makeConfusionMatrix(
      5, 1, 1, 11,   // thrashing
      8, 0, 2, 8,    // false_success
      7, 2, 1, 8,    // none
      18,
    )

    it('false_success precision=1.0 when FP=0', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const fs = result.find(e => e.kind === 'false_success')!
      expect(fs.skipped).toBe(false)
      expect(fs.tp).toBe(8)
      expect(fs.fp).toBe(0)
      expect(fs.fn).toBe(2)
      expect(fs.precision).toBeCloseTo(1.0, 6)
    })

    it('false_success recall=0.8 when FP=0, FN=2', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const fs = result.find(e => e.kind === 'false_success')!
      expect(fs.recall).toBeCloseTo(0.8, 6)
    })

    it('false_success f1 ≈ 0.8889', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const fs = result.find(e => e.kind === 'false_success')!
      // 2 * 1.0 * 0.8 / (1.0 + 0.8) = 1.6 / 1.8 ≈ 0.8889
      expect(fs.f1).toBeCloseTo(8 / 9, 4)
    })

    it('precision Wilson CI: low=high≈1 is plausible when no FP (high confidence)', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const fs = result.find(e => e.kind === 'false_success')!
      // tp+fp = 8, successes = 8 → estimate=1.0 but Wilson shrinks it
      expect(fs.wilsonPrecisionHigh).toBeLessThanOrEqual(1.0)
      expect(fs.wilsonPrecisionLow).toBeGreaterThanOrEqual(0)
    })
  })

  // ---- 정상 케이스 (일반적인 precision/recall/f1) ----
  describe('정상 케이스', () => {
    // 명확한 수치로 계산
    // thrashing: tp=6, fp=2, fn=3, tn=7 → P=0.75, R=0.667, F1=2*0.75*0.667/(0.75+0.667)
    // false_success: tp=4, fp=1, fn=2, tn=11 → P=0.8, R=0.667, F1=2*0.8*0.667/(0.8+0.667)
    // none: tp=7, fp=3, fn=1, tn=7 → P=0.7, R=0.875, F1=2*0.7*0.875/(0.7+0.875)
    const cm = makeConfusionMatrix(
      6, 2, 3, 7,    // thrashing: tp=6, fp=2, fn=3, tn=7
      4, 1, 2, 11,   // false_success: tp=4, fp=1, fn=2, tn=11
      7, 3, 1, 7,    // none: tp=7, fp=3, fn=1, tn=7
      18,
    )

    it('thrashing precision = 6/8 = 0.75', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const thr = result.find(e => e.kind === 'thrashing')!
      expect(thr.precision).toBeCloseTo(6 / 8, 6)
    })

    it('thrashing recall = 6/9 ≈ 0.6667', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const thr = result.find(e => e.kind === 'thrashing')!
      expect(thr.recall).toBeCloseTo(6 / 9, 6)
    })

    it('thrashing f1 = 2*(6/8)*(6/9)/((6/8)+(6/9))', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const thr = result.find(e => e.kind === 'thrashing')!
      const P = 6 / 8
      const R = 6 / 9
      const expected = (2 * P * R) / (P + R)
      expect(thr.f1).toBeCloseTo(expected, 6)
    })

    it('false_success precision = 4/5 = 0.8', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const fs = result.find(e => e.kind === 'false_success')!
      expect(fs.precision).toBeCloseTo(0.8, 6)
    })

    it('none recall = 7/8 = 0.875', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const none = result.find(e => e.kind === 'none')!
      expect(none.recall).toBeCloseTo(7 / 8, 6)
    })

    it('all Wilson CIs are in [0,1] and low <= high', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      for (const entry of result) {
        expect(entry.wilsonPrecisionLow).toBeGreaterThanOrEqual(0)
        expect(entry.wilsonPrecisionHigh).toBeLessThanOrEqual(1)
        expect(entry.wilsonPrecisionLow!).toBeLessThanOrEqual(entry.wilsonPrecisionHigh!)
        expect(entry.wilsonRecallLow).toBeGreaterThanOrEqual(0)
        expect(entry.wilsonRecallHigh).toBeLessThanOrEqual(1)
        expect(entry.wilsonRecallLow!).toBeLessThanOrEqual(entry.wilsonRecallHigh!)
      }
    })

    it('positiveCount = tp + fn for each class', () => {
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const thr = result.find(e => e.kind === 'thrashing')!
      const fs  = result.find(e => e.kind === 'false_success')!
      const none = result.find(e => e.kind === 'none')!
      expect(thr.positiveCount).toBe(6 + 3)   // 9
      expect(fs.positiveCount).toBe(4 + 2)    // 6
      expect(none.positiveCount).toBe(7 + 1)  // 8
    })
  })

  // ---- 소표본 정성폴백 ----
  describe('소표본 정성폴백 (positiveCount < minSupport)', () => {
    // positiveCount = tp + fn
    // thrashing: tp=2, fn=3 → positiveCount=5
    // false_success: tp=10, fn=5 → positiveCount=15 (경계값)
    // none: tp=20, fn=0 → positiveCount=20
    const cm = makeConfusionMatrix(
      2, 1, 3, 12,  // thrashing: positiveCount=5
      10, 2, 5, 1,  // false_success: positiveCount=15
      20, 0, 0, 1,  // none: positiveCount=20
      21,
    )

    it('thrashing is skipped when positiveCount=5 < minSupport=15 (default)', () => {
      const result = computePerClassMetrics(cm)
      const thr = result.find(e => e.kind === 'thrashing')!
      expect(thr.skipped).toBe(true)
      expect(thr.precision).toBeUndefined()
      expect(thr.recall).toBeUndefined()
      expect(thr.f1).toBeUndefined()
    })

    it('skippedReason contains positiveCount and minSupport', () => {
      const result = computePerClassMetrics(cm)
      const thr = result.find(e => e.kind === 'thrashing')!
      expect(thr.skippedReason).toContain('5')
      expect(thr.skippedReason).toContain('15')
    })

    it('thrashing still has Wilson CI even when skipped', () => {
      const result = computePerClassMetrics(cm)
      const thr = result.find(e => e.kind === 'thrashing')!
      expect(thr.wilsonPrecisionLow).toBeDefined()
      expect(thr.wilsonPrecisionHigh).toBeDefined()
      expect(thr.wilsonRecallLow).toBeDefined()
      expect(thr.wilsonRecallHigh).toBeDefined()
    })

    it('false_success is NOT skipped when positiveCount=15 === minSupport=15', () => {
      const result = computePerClassMetrics(cm)
      const fs = result.find(e => e.kind === 'false_success')!
      // positiveCount=15 is NOT < 15 → not skipped
      expect(fs.skipped).toBe(false)
      expect(fs.precision).toBeDefined()
      expect(fs.recall).toBeDefined()
      expect(fs.f1).toBeDefined()
    })

    it('none is NOT skipped when positiveCount=20 >= minSupport=15', () => {
      const result = computePerClassMetrics(cm)
      const none = result.find(e => e.kind === 'none')!
      expect(none.skipped).toBe(false)
    })

    it('custom minSupport=6 causes thrashing to be skipped but not false_success', () => {
      const result = computePerClassMetrics(cm, { minSupport: 6 })
      const thr = result.find(e => e.kind === 'thrashing')!
      const fs  = result.find(e => e.kind === 'false_success')!
      expect(thr.skipped).toBe(true)   // 5 < 6
      expect(fs.skipped).toBe(false)   // 15 >= 6
    })
  })

  // ---- buildConfusionMatrix 통합 케이스 ----
  describe('buildConfusionMatrix와 통합', () => {
    const gold = [
      'thrashing', 'thrashing', 'thrashing',
      'false_success', 'false_success',
      'none', 'none', 'none', 'none', 'none',
      'none', 'none', 'none', 'none', 'none',
      'none', 'none', 'none', 'none', 'none',
    ] as const

    const pred = [
      'thrashing', 'thrashing', 'none',           // thr: TP=2, FN=1
      'false_success', 'none',                     // fs:  TP=1, FN=1
      'none', 'none', 'none', 'none', 'none',      // none: TP=15 (all)
      'none', 'none', 'none', 'none', 'none',
      'none', 'none', 'none', 'none', 'none',
    ] as const

    it('thrashing positiveCount = 3 (tp=2 + fn=1)', () => {
      const cm = buildConfusionMatrix([...gold], [...pred])
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const thr = result.find(e => e.kind === 'thrashing')!
      expect(thr.positiveCount).toBe(3)
      expect(thr.tp).toBe(2)
      expect(thr.fn).toBe(1)
    })

    it('none recall = 1.0 (all 15 none predicted correctly)', () => {
      const cm = buildConfusionMatrix([...gold], [...pred])
      const result = computePerClassMetrics(cm, { minSupport: 1 })
      const none = result.find(e => e.kind === 'none')!
      expect(none.recall).toBeCloseTo(1.0, 6)
    })
  })
})
