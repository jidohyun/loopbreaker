// tests/build-confusion-matrix-sub-ac-2b-1.test.ts
// Sub-AC 2b-1: buildConfusionMatrix 기본 골격 — TP/FP/FN/TN 집계 단위 테스트.
//
// 규칙:
//   - 합성/픽스처 데이터만 사용 (실 경로·실 API 없음).
//   - 불변성 검증 포함.
//   - DetectionKind = 'thrashing' | 'false_success' | 'none'

import { buildConfusionMatrix } from '../src/eval/metrics.js'
import type { DetectionKind } from '../src/eval/eval-contracts.js'

// ---- 헬퍼 ----

const T = 'thrashing' as DetectionKind
const FS = 'false_success' as DetectionKind
const N = 'none' as DetectionKind

// ================================================================
// 1. 빈 입력
// ================================================================

describe('buildConfusionMatrix — 빈 입력', () => {
  it('빈 배열이면 모든 셀이 0이고 totalSamples=0', () => {
    const result = buildConfusionMatrix([], [])
    expect(result.totalSamples).toBe(0)
    for (const kind of ['thrashing', 'false_success', 'none'] as DetectionKind[]) {
      expect(result.perClass[kind]).toEqual({ tp: 0, fp: 0, fn: 0, tn: 0 })
    }
  })
})

// ================================================================
// 2. 단순 perfect prediction (thrashing only)
// ================================================================

describe('buildConfusionMatrix — perfect prediction (thrashing)', () => {
  const gold: DetectionKind[] = [T, T, N, N]
  const pred: DetectionKind[] = [T, T, N, N]

  it('thrashing OvR: TP=2, FP=0, FN=0, TN=2', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.perClass[T]).toEqual({ tp: 2, fp: 0, fn: 0, tn: 2 })
  })

  it('none OvR: TP=2, FP=0, FN=0, TN=2', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.perClass[N]).toEqual({ tp: 2, fp: 0, fn: 0, tn: 2 })
  })

  it('false_success OvR: TP=0, FP=0, FN=0, TN=4', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.perClass[FS]).toEqual({ tp: 0, fp: 0, fn: 0, tn: 4 })
  })

  it('totalSamples=4', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.totalSamples).toBe(4)
  })
})

// ================================================================
// 3. 오분류 포함 — thrashing FP/FN
// ================================================================

describe('buildConfusionMatrix — 오분류 포함', () => {
  // gold: [T, T, N, N, FS]
  // pred: [T, N, T, N, FS]
  //
  // 쌍별:
  //   (T,T)  → thrashing TP
  //   (T,N)  → thrashing FN, none FP
  //   (N,T)  → none FN, thrashing FP
  //   (N,N)  → none TP
  //   (FS,FS)→ false_success TP

  const gold: DetectionKind[] = [T, T, N, N, FS]
  const pred: DetectionKind[] = [T, N, T, N, FS]

  it('thrashing OvR: TP=1, FP=1, FN=1, TN=2', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.perClass[T]).toEqual({ tp: 1, fp: 1, fn: 1, tn: 2 })
  })

  it('none OvR: TP=1, FP=1, FN=1, TN=2', () => {
    // 쌍별 none OvR 분석:
    //   (T,T)  : gold≠N, pred≠N → TN
    //   (T,N)  : gold≠N, pred=N → FP  ← T를 N으로 잘못 예측
    //   (N,T)  : gold=N,  pred≠N → FN  ← N을 T로 잘못 예측
    //   (N,N)  : gold=N,  pred=N → TP
    //   (FS,FS): gold≠N, pred≠N → TN
    // 합계: TP=1, FP=1, FN=1, TN=2
    const r = buildConfusionMatrix(gold, pred)
    expect(r.perClass[N]).toEqual({ tp: 1, fp: 1, fn: 1, tn: 2 })
  })

  it('false_success OvR: TP=1, FP=0, FN=0, TN=4', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.perClass[FS]).toEqual({ tp: 1, fp: 0, fn: 0, tn: 4 })
  })

  it('totalSamples=5', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.totalSamples).toBe(5)
  })
})

// ================================================================
// 4. confusionRaw 멀티클래스 원시 행렬 검증
// ================================================================

describe('buildConfusionMatrix — confusionRaw', () => {
  const gold: DetectionKind[] = [T, T, FS, N]
  const pred: DetectionKind[] = [T, FS, FS, T]

  it('confusionRaw[thrashing][thrashing]=1', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.confusionRaw[T][T]).toBe(1)
  })

  it('confusionRaw[thrashing][false_success]=1 (thrashing를 false_success로 오분류)', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.confusionRaw[T][FS]).toBe(1)
  })

  it('confusionRaw[false_success][false_success]=1', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.confusionRaw[FS][FS]).toBe(1)
  })

  it('confusionRaw[none][thrashing]=1 (none를 thrashing으로 오분류)', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.confusionRaw[N][T]).toBe(1)
  })

  it('confusionRaw 모든 셀 합 = totalSamples', () => {
    const r = buildConfusionMatrix(gold, pred)
    let sum = 0
    for (const g of ['thrashing', 'false_success', 'none'] as DetectionKind[]) {
      for (const p of ['thrashing', 'false_success', 'none'] as DetectionKind[]) {
        sum += r.confusionRaw[g][p]
      }
    }
    expect(sum).toBe(r.totalSamples)
  })
})

// ================================================================
// 5. OvR 항등식: TP+FP+FN+TN = totalSamples (모든 클래스)
// ================================================================

describe('buildConfusionMatrix — OvR 항등식', () => {
  const gold: DetectionKind[] = [T, T, FS, N, N, FS, T, N]
  const pred: DetectionKind[] = [T, FS, FS, N, T, N, T, N]

  it('각 클래스의 TP+FP+FN+TN = totalSamples', () => {
    const r = buildConfusionMatrix(gold, pred)
    for (const kind of ['thrashing', 'false_success', 'none'] as DetectionKind[]) {
      const { tp, fp, fn, tn } = r.perClass[kind]
      expect(tp + fp + fn + tn).toBe(r.totalSamples)
    }
  })
})

// ================================================================
// 6. 탐지 미발화 = pred 'none' 처리
// ================================================================

describe('buildConfusionMatrix — 탐지 미발화(pred none)', () => {
  // gold: thrashing 3건, pred: 전부 none (구조게이트 미통과)
  const gold: DetectionKind[] = [T, T, T]
  const pred: DetectionKind[] = [N, N, N]

  it('thrashing OvR: TP=0, FP=0, FN=3, TN=0', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.perClass[T]).toEqual({ tp: 0, fp: 0, fn: 3, tn: 0 })
  })

  it('none OvR: TP=0, FP=3, FN=0, TN=0', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.perClass[N]).toEqual({ tp: 0, fp: 3, fn: 0, tn: 0 })
  })
})

// ================================================================
// 7. 길이 불일치 — RangeError
// ================================================================

describe('buildConfusionMatrix — 길이 불일치', () => {
  it('gold.length !== pred.length → RangeError', () => {
    expect(() => buildConfusionMatrix([T, N], [T])).toThrow(RangeError)
  })

  it('에러 메시지에 gold/pred 길이 포함', () => {
    expect(() => buildConfusionMatrix([T, N, FS], [T])).toThrow(/gold\.length.*3.*pred\.length.*1/)
  })
})

// ================================================================
// 8. 불변성 — 입력 배열 수정 없음
// ================================================================

describe('buildConfusionMatrix — 불변성', () => {
  it('입력 배열이 수정되지 않음', () => {
    const gold: DetectionKind[] = [T, FS, N]
    const pred: DetectionKind[] = [T, N, N]
    const goldCopy = [...gold]
    const predCopy = [...pred]
    buildConfusionMatrix(gold, pred)
    expect(gold).toEqual(goldCopy)
    expect(pred).toEqual(predCopy)
  })
})

// ================================================================
// 9. 단일 클래스 전체 (thrashing만)
// ================================================================

describe('buildConfusionMatrix — 단일 클래스 전체', () => {
  const gold: DetectionKind[] = [T, T, T]
  const pred: DetectionKind[] = [T, T, T]

  it('thrashing OvR: TP=3, FP=0, FN=0, TN=0', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.perClass[T]).toEqual({ tp: 3, fp: 0, fn: 0, tn: 0 })
  })

  it('false_success OvR: TP=0, FP=0, FN=0, TN=3', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.perClass[FS]).toEqual({ tp: 0, fp: 0, fn: 0, tn: 3 })
  })
})

// ================================================================
// 10. 세 클래스 균형 분포 — exact match
// ================================================================

describe('buildConfusionMatrix — 균형 분포 perfect prediction', () => {
  const gold: DetectionKind[] = [T, T, FS, FS, N, N]
  const pred: DetectionKind[] = [T, T, FS, FS, N, N]

  it('thrashing OvR: TP=2, FP=0, FN=0, TN=4', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.perClass[T]).toEqual({ tp: 2, fp: 0, fn: 0, tn: 4 })
  })

  it('false_success OvR: TP=2, FP=0, FN=0, TN=4', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.perClass[FS]).toEqual({ tp: 2, fp: 0, fn: 0, tn: 4 })
  })

  it('none OvR: TP=2, FP=0, FN=0, TN=4', () => {
    const r = buildConfusionMatrix(gold, pred)
    expect(r.perClass[N]).toEqual({ tp: 2, fp: 0, fn: 0, tn: 4 })
  })
})
