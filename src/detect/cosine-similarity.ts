/**
 * src/detect/cosine-similarity.ts
 *
 * 코사인 유사도 계산 유틸리티.
 * SPEC §4 STAGE 2: 임베딩 벡터 간 의미적 유사도 측정에 사용된다.
 *
 * 외부 의존성 없음. 순수 수학 함수.
 */

/**
 * 두 벡터 간 코사인 유사도를 계산한다.
 *
 * 공식: cos(θ) = (a · b) / (‖a‖ · ‖b‖)
 *
 * 경계값:
 *   - 동일 벡터 → 1.0
 *   - 직교 벡터 → 0.0
 *   - 반대 벡터 → -1.0
 *   - 영벡터(zero vector) → 0.0 (분모가 0인 경우 안전 처리)
 *
 * 부동소수점 오차로 [-1, 1] 범위를 벗어날 수 있으므로 클램프한다.
 *
 * @param a 첫 번째 벡터 (number[])
 * @param b 두 번째 벡터 (number[], a와 동일 차원이어야 함)
 * @returns 코사인 유사도 [-1, 1]. 영벡터 입력 시 0.0 반환.
 * @throws {Error} 두 벡터의 차원(길이)이 다를 때
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: a.length=${a.length}, b.length=${b.length}`,
    )
  }

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0

  // 부동소수점 오차로 [-1, 1] 범위를 벗어날 수 있으므로 클램프
  return Math.max(-1, Math.min(1, dot / denom))
}
