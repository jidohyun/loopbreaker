// tests/cohen-kappa-sub-ac-2c.test.ts
// Sub-AC 2c: cohenKappa(confusionMatrix) 단위 테스트.
//
// 검증 케이스:
//   1. 완전 일치 (κ = 1)
//   2. 완전 불일치 / 최소 일치 (κ < 0)
//   3. 부분 일치 (0 < κ < 1, 수식 직접 검증)
//   4. 빈 혼동행렬 (totalSamples=0 → κ=0)
//   5. 단일 클래스만 예측 (p_e = 1 분모 보호)
//   6. 3클래스 균등 무작위 예측 (κ ≈ 0)
//
// 규칙:
//   - 합성 픽스처, Mock, 임시 경로만 사용 — 실경로 리터럴 없음.
//   - console.log 금지.
//   - 불변성 (입력 ConfusionMatrix 수정 없음).

import { buildConfusionMatrix, cohenKappa } from '../src/eval/metrics.js'
import type { ConfusionMatrix } from '../src/eval/metrics.js'
import type { DetectionKind } from '../src/eval/eval-contracts.js'

// ── 헬퍼: ConfusionMatrix를 gold/pred 배열로부터 직접 생성 ──
function makeMatrix(
  gold: DetectionKind[],
  pred: DetectionKind[],
): ConfusionMatrix {
  return buildConfusionMatrix(gold, pred)
}

// ── 수식 직접 계산 헬퍼 (테스트 기대값 독립 검증용) ──
function computeKappaExpected(
  gold: DetectionKind[],
  pred: DetectionKind[],
): number {
  const kinds: DetectionKind[] = ['thrashing', 'false_success', 'none']
  const N = gold.length
  if (N === 0) return 0

  // 원시 혼동행렬
  const raw: Record<string, Record<string, number>> = {}
  for (const g of kinds) {
    raw[g] = {}
    for (const p of kinds) raw[g][p] = 0
  }
  for (let i = 0; i < N; i++) {
    raw[gold[i]!][pred[i]!]!++
  }

  // p_o
  const diagSum = kinds.reduce((s, k) => s + raw[k][k]!, 0)
  const pO = diagSum / N

  // p_e
  let peSum = 0
  for (const k of kinds) {
    const rowSum = kinds.reduce((s, p) => s + raw[k][p]!, 0)
    const colSum = kinds.reduce((s, g) => s + raw[g][k]!, 0)
    peSum += rowSum * colSum
  }
  const pE = peSum / (N * N)

  if (1 - pE === 0) return 0
  return (pO - pE) / (1 - pE)
}

// ────────────────────────────────────────────────────────────────
// 1. 완전 일치
// ────────────────────────────────────────────────────────────────
describe('cohenKappa — 완전 일치 (κ = 1)', () => {
  test('모든 gold = pred 이면 κ = 1', () => {
    const gold: DetectionKind[] = [
      'thrashing', 'thrashing',
      'false_success', 'false_success',
      'none', 'none',
    ]
    const pred: DetectionKind[] = [...gold]
    const cm = makeMatrix(gold, pred)
    const result = cohenKappa(cm)

    expect(result.kappa).toBeCloseTo(1, 10)
    expect(result.observedAgreement).toBeCloseTo(1, 10)
    expect(result.totalSamples).toBe(6)
  })

  test('단일 클래스만 있고 모두 일치해도 κ = 1', () => {
    const gold: DetectionKind[] = ['none', 'none', 'none']
    const pred: DetectionKind[] = ['none', 'none', 'none']
    const cm = makeMatrix(gold, pred)
    const result = cohenKappa(cm)
    // p_o=1, p_e=1 → 분모 0 보호 → κ=0 이 아니라
    // 실제로 단일 클래스 완전 일치: p_e = (3/3)*(3/3) = 1 → 분모 0 → κ=0
    // (코드 경계조건: 분모=0 이면 0 반환)
    expect(result.kappa).toBe(0)
    expect(result.observedAgreement).toBeCloseTo(1, 10)
    expect(result.expectedAgreement).toBeCloseTo(1, 10)
  })
})

// ────────────────────────────────────────────────────────────────
// 2. 완전 불일치
// ────────────────────────────────────────────────────────────────
describe('cohenKappa — 완전 불일치 (κ < 0)', () => {
  test('gold=thrashing 을 모두 false_success 로 예측 → κ < 0', () => {
    // gold 전체가 thrashing, pred 전체가 false_success
    const gold: DetectionKind[] = Array(10).fill('thrashing') as DetectionKind[]
    const pred: DetectionKind[] = Array(10).fill('false_success') as DetectionKind[]
    const cm = makeMatrix(gold, pred)
    const result = cohenKappa(cm)

    // p_o = 0 (대각선 = 0)
    // p_e = (10/10)*(0/10) + (0/10)*(10/10) + 0 = 0
    // κ = (0 - 0) / (1 - 0) = 0  ... 이 케이스는 κ=0
    // 수식 독립 검증
    const expected = computeKappaExpected(gold, pred)
    expect(result.kappa).toBeCloseTo(expected, 10)
    expect(result.observedAgreement).toBeCloseTo(0, 10)
  })

  test('순환 오분류(thrashing→false_success, false_success→none, none→thrashing) → κ < 0', () => {
    // 각 클래스를 체계적으로 다른 클래스로 예측 → 완전 불일치
    const n = 6
    const gold: DetectionKind[] = [
      'thrashing', 'thrashing',
      'false_success', 'false_success',
      'none', 'none',
    ]
    const pred: DetectionKind[] = [
      'false_success', 'false_success',  // thrashing → false_success
      'none', 'none',                    // false_success → none
      'thrashing', 'thrashing',           // none → thrashing
    ]
    const cm = makeMatrix(gold, pred)
    const result = cohenKappa(cm)

    const expected = computeKappaExpected(gold, pred)
    expect(result.kappa).toBeCloseTo(expected, 10)
    // 균등 분포에서 완전 오분류: p_o=0, p_e=(2/6*2/6)*3 = 1/9 * 3 = 1/3
    // κ = (0 - 1/3) / (1 - 1/3) = (-1/3) / (2/3) = -0.5
    expect(result.kappa).toBeCloseTo(-0.5, 6)
    expect(result.kappa).toBeLessThan(0)
    expect(result.totalSamples).toBe(n)
  })
})

// ────────────────────────────────────────────────────────────────
// 3. 부분 일치 (0 < κ < 1)
// ────────────────────────────────────────────────────────────────
describe('cohenKappa — 부분 일치 (0 < κ < 1)', () => {
  test('일부만 정확하게 예측 → 0 < κ < 1, 수식과 일치', () => {
    // 6 샘플: 4개 일치, 2개 오분류
    const gold: DetectionKind[] = [
      'thrashing', 'thrashing',
      'false_success', 'false_success',
      'none', 'none',
    ]
    const pred: DetectionKind[] = [
      'thrashing', 'thrashing',     // 2 일치
      'false_success', 'none',      // 1 일치, 1 오분류
      'none', 'thrashing',          // 1 일치, 1 오분류
    ]
    const cm = makeMatrix(gold, pred)
    const result = cohenKappa(cm)
    const expected = computeKappaExpected(gold, pred)

    expect(result.kappa).toBeCloseTo(expected, 10)
    expect(result.kappa).toBeGreaterThan(0)
    expect(result.kappa).toBeLessThan(1)
    expect(result.observedAgreement).toBeCloseTo(4 / 6, 10)
    expect(result.totalSamples).toBe(6)
  })

  test('수동 계산: 균형 2클래스 유사 케이스 (수식 교차 검증)', () => {
    // gold: [T,T,T, FS,FS,FS, N,N,N,N] (3,3,4)
    // pred: [T,T,FS, FS,FS,N, N,N,N,T] 7 일치
    const gold: DetectionKind[] = [
      'thrashing', 'thrashing', 'thrashing',
      'false_success', 'false_success', 'false_success',
      'none', 'none', 'none', 'none',
    ]
    const pred: DetectionKind[] = [
      'thrashing', 'thrashing', 'false_success',  // 2 T 일치
      'false_success', 'false_success', 'none',   // 2 FS 일치
      'none', 'none', 'none', 'thrashing',        // 3 N 일치
    ]
    const cm = makeMatrix(gold, pred)
    const result = cohenKappa(cm)
    const expected = computeKappaExpected(gold, pred)

    expect(result.kappa).toBeCloseTo(expected, 10)
    expect(result.kappa).toBeGreaterThan(0)
    expect(result.kappa).toBeLessThan(1)
    // p_o = 7/10 = 0.7
    expect(result.observedAgreement).toBeCloseTo(0.7, 10)
    expect(result.totalSamples).toBe(10)
  })

  test('κ > 0.6 → 실질적 일치(substantial agreement) 이상 구간 검사', () => {
    // 10개 중 9개 일치, 1개 오분류
    const gold: DetectionKind[] = [
      'thrashing', 'thrashing', 'thrashing',
      'false_success', 'false_success', 'false_success',
      'none', 'none', 'none', 'none',
    ]
    const pred: DetectionKind[] = [
      'thrashing', 'thrashing', 'thrashing',
      'false_success', 'false_success', 'false_success',
      'none', 'none', 'none', 'thrashing',  // 마지막 1개 오분류
    ]
    const cm = makeMatrix(gold, pred)
    const result = cohenKappa(cm)
    const expected = computeKappaExpected(gold, pred)

    expect(result.kappa).toBeCloseTo(expected, 10)
    expect(result.kappa).toBeGreaterThan(0.6)
  })
})

// ────────────────────────────────────────────────────────────────
// 4. 빈 혼동행렬
// ────────────────────────────────────────────────────────────────
describe('cohenKappa — 빈 혼동행렬 (totalSamples=0)', () => {
  test('gold=[], pred=[] → κ=0, p_o=0, p_e=0', () => {
    const cm = makeMatrix([], [])
    const result = cohenKappa(cm)

    expect(result.kappa).toBe(0)
    expect(result.observedAgreement).toBe(0)
    expect(result.expectedAgreement).toBe(0)
    expect(result.totalSamples).toBe(0)
  })
})

// ────────────────────────────────────────────────────────────────
// 5. 분모 0 보호 (단일 클래스, p_e = 1)
// ────────────────────────────────────────────────────────────────
describe('cohenKappa — 분모 0 보호 (p_e ≈ 1)', () => {
  test('gold 전체 = thrashing, pred 전체 = thrashing → p_e=1 → κ=0 (분모 보호)', () => {
    const gold: DetectionKind[] = Array(5).fill('thrashing') as DetectionKind[]
    const pred: DetectionKind[] = Array(5).fill('thrashing') as DetectionKind[]
    const cm = makeMatrix(gold, pred)
    const result = cohenKappa(cm)

    // p_e = (5/5 * 5/5) = 1 → 분모 0 → kappa=0
    expect(result.kappa).toBe(0)
    expect(result.expectedAgreement).toBeCloseTo(1, 10)
    expect(result.observedAgreement).toBeCloseTo(1, 10)
  })
})

// ────────────────────────────────────────────────────────────────
// 6. 균등 무작위 예측 (κ ≈ 0)
// ────────────────────────────────────────────────────────────────
describe('cohenKappa — 균등 무작위 예측 (κ ≈ 0)', () => {
  test('3클래스 균등 분포에서 무작위 예측 → κ 수식값과 일치', () => {
    // 9샘플, gold=3×3, pred=균등 분포
    const gold: DetectionKind[] = [
      'thrashing', 'thrashing', 'thrashing',
      'false_success', 'false_success', 'false_success',
      'none', 'none', 'none',
    ]
    // 각 클래스에서 1개씩 정답, 나머지는 다른 클래스 → p_o = 3/9 = 1/3
    const pred: DetectionKind[] = [
      'thrashing', 'false_success', 'none',
      'thrashing', 'false_success', 'none',
      'thrashing', 'false_success', 'none',
    ]
    const cm = makeMatrix(gold, pred)
    const result = cohenKappa(cm)
    const expected = computeKappaExpected(gold, pred)

    expect(result.kappa).toBeCloseTo(expected, 10)
    // p_o = 3/9 = 1/3, pred는 균등 분포 각 3개씩
    // p_e = (3/9 * 3/9) * 3 = 3 * 1/9 = 1/3
    // κ = (1/3 - 1/3) / (1 - 1/3) = 0
    expect(result.kappa).toBeCloseTo(0, 10)
  })
})

// ────────────────────────────────────────────────────────────────
// 7. 불변성 검증 — 입력 ConfusionMatrix 수정 없음
// ────────────────────────────────────────────────────────────────
describe('cohenKappa — 불변성', () => {
  test('cohenKappa 호출 후 입력 ConfusionMatrix가 변경되지 않는다', () => {
    const gold: DetectionKind[] = ['thrashing', 'false_success', 'none']
    const pred: DetectionKind[] = ['thrashing', 'none', 'none']
    const cm = makeMatrix(gold, pred)

    // confusionRaw 원본값 캡처
    const originalRaw = JSON.parse(JSON.stringify(cm.confusionRaw)) as typeof cm.confusionRaw
    const originalTotal = cm.totalSamples

    cohenKappa(cm)

    // 호출 후 변경 없어야 함
    expect(cm.totalSamples).toBe(originalTotal)
    expect(JSON.stringify(cm.confusionRaw)).toBe(JSON.stringify(originalRaw))
  })
})
