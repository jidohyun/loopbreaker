/**
 * tests/cosine-similarity-sub-ac-3b.test.ts
 *
 * Sub-AC 3b: cosineSimilarity(a, b) 경계값 단위 테스트
 *
 * 검증 항목:
 *  1. 동일 벡터 → 1.0
 *  2. 직교 벡터 → 0.0
 *  3. 반대(반대 방향) 벡터 → -1.0
 *  4. 영벡터 → 0.0 (분모=0 안전 처리)
 *  5. 일반 45° 벡터 → 1/√2
 *  6. 다차원 벡터 동작
 *  7. 차원 불일치 → 에러 throw
 *  8. 스칼라 배수 벡터 → 1.0 (방향 동일, 크기 무관)
 *  9. 부동소수점 클램프: 결과가 항상 [-1, 1] 내
 * 10. 단일 원소 벡터
 */

import { cosineSimilarity } from '../src/detect/cosine-similarity.js'

describe('cosineSimilarity — boundary values', () => {
  it('identical vectors → 1.0', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0, 10)
  })

  it('orthogonal vectors → 0.0', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0, 10)
  })

  it('opposite vectors → -1.0', () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1.0, 10)
  })

  it('zero vector a → 0.0 (safe division by zero)', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
  })

  it('zero vector b → 0.0 (safe division by zero)', () => {
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0)
  })

  it('both zero vectors → 0.0', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0)
  })

  it('45-degree angle [1,0] vs [1,1] → 1/√2', () => {
    expect(cosineSimilarity([1, 0], [1, 1])).toBeCloseTo(1 / Math.SQRT2, 8)
  })

  it('scalar multiple → 1.0 (same direction, different magnitude)', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1.0, 10)
  })

  it('negative scalar multiple → -1.0', () => {
    expect(cosineSimilarity([1, 2, 3], [-2, -4, -6])).toBeCloseTo(-1.0, 10)
  })

  it('single-element vector: same sign → 1.0', () => {
    expect(cosineSimilarity([5], [3])).toBeCloseTo(1.0, 10)
  })

  it('single-element vector: opposite signs → -1.0', () => {
    expect(cosineSimilarity([5], [-3])).toBeCloseTo(-1.0, 10)
  })

  it('high-dimensional orthogonal vectors → 0.0', () => {
    const a = [1, 0, 0, 0, 0, 0, 0, 0]
    const b = [0, 0, 0, 0, 0, 0, 0, 1]
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 10)
  })

  it('high-dimensional identical vectors → 1.0', () => {
    const v = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10)
  })

  it('result is always in [-1, 1] range (clamp check)', () => {
    const pairs: [number[], number[]][] = [
      [[1, 0], [0, 1]],
      [[1, 2, 3], [1, 2, 3]],
      [[1, 0], [-1, 0]],
      [[0.5, 0.5], [0.5, -0.5]],
    ]
    for (const [a, b] of pairs) {
      const result = cosineSimilarity(a, b)
      expect(result).toBeGreaterThanOrEqual(-1)
      expect(result).toBeLessThanOrEqual(1)
    }
  })
})

describe('cosineSimilarity — error handling', () => {
  it('throws when vectors have different dimensions', () => {
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow()
  })

  it('error message mentions dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow(/dimension mismatch/i)
  })

  it('throws when a is empty and b is non-empty', () => {
    expect(() => cosineSimilarity([], [1])).toThrow()
  })

  it('empty vectors of same length → 0.0 (both zero)', () => {
    // length=0: loop does nothing, dot=0, normA=0, normB=0 → denom=0 → return 0
    expect(cosineSimilarity([], [])).toBe(0)
  })
})

describe('cosineSimilarity — known numeric values', () => {
  it('[3,4] vs [3,4] → 1.0 (Pythagorean triple magnitudes)', () => {
    expect(cosineSimilarity([3, 4], [3, 4])).toBeCloseTo(1.0, 10)
  })

  it('[3,4] vs [4,3] → 24/25 = 0.96', () => {
    // dot = 3*4 + 4*3 = 24, norm both = 5 → cos = 24/25
    expect(cosineSimilarity([3, 4], [4, 3])).toBeCloseTo(24 / 25, 8)
  })

  it('[1,1] vs [1,-1] → 0.0 (perpendicular)', () => {
    expect(cosineSimilarity([1, 1], [1, -1])).toBeCloseTo(0.0, 10)
  })
})
