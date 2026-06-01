/**
 * tests/semantic-stage-sub-ac-3a.test.ts
 *
 * Sub-AC 3a: computeCosineSimilarity 단위 테스트
 *
 * 검증 항목:
 *  1. 동일 벡터 → 1.0
 *  2. 직교 벡터 → 0.0
 *  3. 샘플 쌍 알려진 값 (45° 각도)
 *  4. 영벡터 → 0.0 (ZeroDivision 안전)
 *  5. 차원 불일치 → Error
 *  6. 음수 값 포함 벡터
 */

import { computeCosineSimilarity } from '../src/detect/semantic-stage.js'

describe('computeCosineSimilarity', () => {
  it('identical vectors → 1.0', () => {
    const v = [1, 2, 3]
    const result = computeCosineSimilarity(v, v)
    expect(result).toBeCloseTo(1.0, 10)
  })

  it('orthogonal vectors → 0.0', () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    const result = computeCosineSimilarity(a, b)
    expect(result).toBeCloseTo(0.0, 10)
  })

  it('45-degree sample pair → known value ≈ 0.7071', () => {
    // [1,0] and [1,1]/√2 → cos(45°) = 1/√2 ≈ 0.7071
    const a = [1, 0]
    const b = [1, 1]
    const result = computeCosineSimilarity(a, b)
    // cos = (1*1 + 0*1) / (1 * √2) = 1/√2
    expect(result).toBeCloseTo(1 / Math.SQRT2, 8)
  })

  it('another known value: [1,2] vs [2,4] (same direction) → 1.0', () => {
    const result = computeCosineSimilarity([1, 2], [2, 4])
    expect(result).toBeCloseTo(1.0, 10)
  })

  it('opposite vectors → -1.0', () => {
    const result = computeCosineSimilarity([1, 0], [-1, 0])
    expect(result).toBeCloseTo(-1.0, 10)
  })

  it('zero vector → 0.0 (safe, no divide-by-zero)', () => {
    const result = computeCosineSimilarity([0, 0, 0], [1, 2, 3])
    expect(result).toBe(0)
  })

  it('both zero vectors → 0.0', () => {
    const result = computeCosineSimilarity([0, 0], [0, 0])
    expect(result).toBe(0)
  })

  it('dimension mismatch throws Error', () => {
    expect(() => computeCosineSimilarity([1, 2], [1, 2, 3])).toThrow(
      /dimension mismatch/i,
    )
  })

  it('result is always clamped to [-1, 1]', () => {
    // floating-point won't normally exceed but ensure clamp logic is exercised
    const v = [0.9999999999999999]
    const result = computeCosineSimilarity(v, v)
    expect(result).toBeGreaterThanOrEqual(-1)
    expect(result).toBeLessThanOrEqual(1)
  })
})
