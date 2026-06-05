// tests/none-prediction-rule-sub-ac-2b-4.test.ts
// Sub-AC 2b-4: 미발화(none) 예측 규칙 독립 함수 + FN/TN/FP 케이스 독립 테스트.
//
// 규칙:
//   - 합성/픽스처 데이터만 사용 (실 경로·실 API 없음).
//   - resolveNonePrediction / findUnmatchedPredAnchors 독립 함수 검증.
//   - FN (gold≠none, pred=none): 미발화로 인한 False Negative.
//   - TN (gold=none, pred=none): 올바른 미발화 (True Negative).
//   - FP (gold=none, pred≠none): 오탐 (False Positive).

import {
  resolveNonePrediction,
  findUnmatchedPredAnchors,
} from '../src/eval/metrics.js'
import type { DetectionKind } from '../src/eval/eval-contracts.js'

// ---- 헬퍼 ----
const T: DetectionKind = 'thrashing'
const FS: DetectionKind = 'false_success'
const N: DetectionKind = 'none'

// ================================================================
// 1. FN 케이스 — gold에 이벤트가 있으나 pred가 none (미발화)
// ================================================================

describe('resolveNonePrediction — FN (gold≠none, pred=none 미발화)', () => {
  // 시나리오: gold=thrashing, predByAnchor에 해당 anchor 없음(구조게이트 미통과)
  it('gold=thrashing, anchor 미발화 → predKind=none, isMiss=true, cellLabel=fn', () => {
    const predByAnchor = new Map<string, DetectionKind>()
    // anchor-uuid-001 은 발화되지 않음 (빈 맵)
    const result = resolveNonePrediction({
      goldAnchorUuid: 'anchor-uuid-001',
      predByAnchor,
      goldKind: T,
    })
    expect(result.predKind).toBe('none')
    expect(result.isMiss).toBe(true)
    expect(result.cellLabel).toBe('fn')
  })

  it('gold=false_success, anchor 미발화 → predKind=none, isMiss=true, cellLabel=fn', () => {
    const predByAnchor = new Map<string, DetectionKind>()
    const result = resolveNonePrediction({
      goldAnchorUuid: 'anchor-uuid-002',
      predByAnchor,
      goldKind: FS,
    })
    expect(result.predKind).toBe('none')
    expect(result.isMiss).toBe(true)
    expect(result.cellLabel).toBe('fn')
  })

  it('다른 anchor는 발화했으나 gold anchor는 미발화 → FN', () => {
    // anchor-uuid-003 은 발화, anchor-uuid-004 는 미발화
    const predByAnchor = new Map<string, DetectionKind>([
      ['anchor-uuid-003', T],
    ])
    const result = resolveNonePrediction({
      goldAnchorUuid: 'anchor-uuid-004',
      predByAnchor,
      goldKind: T,
    })
    expect(result.predKind).toBe('none')
    expect(result.isMiss).toBe(true)
    expect(result.cellLabel).toBe('fn')
  })

  it('FN: isMiss=true이면 predKind는 항상 none', () => {
    const predByAnchor = new Map<string, DetectionKind>()
    const result = resolveNonePrediction({
      goldAnchorUuid: 'anchor-uuid-005',
      predByAnchor,
      goldKind: T,
    })
    expect(result.isMiss).toBe(true)
    expect(result.predKind).toBe('none')
  })
})

// ================================================================
// 2. TN 케이스 — gold가 none이고 pred도 none (올바른 미탐지)
// ================================================================

describe('resolveNonePrediction — TN (gold=none, pred=none)', () => {
  // 시나리오: gold=none (anchor 없음), predByAnchor도 비어 있음
  it('goldAnchorUuid=null → predKind=none, isMiss=false, cellLabel=tn', () => {
    const predByAnchor = new Map<string, DetectionKind>()
    const result = resolveNonePrediction({
      goldAnchorUuid: null,
      predByAnchor,
      goldKind: N,
    })
    expect(result.predKind).toBe('none')
    expect(result.isMiss).toBe(false)
    expect(result.cellLabel).toBe('tn')
  })

  it('goldAnchorUuid=null이면 predByAnchor 내용과 무관하게 TN', () => {
    // predByAnchor에 다른 anchor가 있어도 gold=none anchor 없으면 TN
    const predByAnchor = new Map<string, DetectionKind>([
      ['some-other-anchor', T],
    ])
    const result = resolveNonePrediction({
      goldAnchorUuid: null,
      predByAnchor,
      goldKind: N,
    })
    expect(result.predKind).toBe('none')
    expect(result.isMiss).toBe(false)
    expect(result.cellLabel).toBe('tn')
  })

  it('gold=none anchor가 있으나 발화 안 됨(미발화) → TN (정상 미발화)', () => {
    // gold anchor uuid를 갖고 있지만 predByAnchor에 없음 → isMiss=true, cellLabel=tn
    const predByAnchor = new Map<string, DetectionKind>()
    const result = resolveNonePrediction({
      goldAnchorUuid: 'anchor-none-001',
      predByAnchor,
      goldKind: N, // gold=none
    })
    expect(result.predKind).toBe('none')
    expect(result.isMiss).toBe(true) // 구조게이트 미통과 — 하지만 gold도 none이므로 TN
    expect(result.cellLabel).toBe('tn')
  })

  it('TN: isMiss=false이고 cellLabel=tn (goldAnchorUuid null 경우)', () => {
    const result = resolveNonePrediction({
      goldAnchorUuid: null,
      predByAnchor: new Map(),
      goldKind: N,
    })
    expect(result.cellLabel).toBe('tn')
    expect(result.isMiss).toBe(false)
  })
})

// ================================================================
// 3. FP 케이스 — gold가 none인데 pred에 이벤트가 있음 (오탐)
// ================================================================

describe('resolveNonePrediction — FP (gold=none, pred≠none)', () => {
  // 시나리오: gold=none, 하지만 predByAnchor에 해당 anchor가 발화됨
  it('gold=none, anchor 발화(pred=thrashing) → predKind=thrashing, cellLabel=fp', () => {
    const predByAnchor = new Map<string, DetectionKind>([
      ['anchor-fp-001', T],
    ])
    const result = resolveNonePrediction({
      goldAnchorUuid: 'anchor-fp-001',
      predByAnchor,
      goldKind: N,
    })
    expect(result.predKind).toBe(T)
    expect(result.isMiss).toBe(false)
    expect(result.cellLabel).toBe('fp')
  })

  it('gold=none, anchor 발화(pred=false_success) → predKind=false_success, cellLabel=fp', () => {
    const predByAnchor = new Map<string, DetectionKind>([
      ['anchor-fp-002', FS],
    ])
    const result = resolveNonePrediction({
      goldAnchorUuid: 'anchor-fp-002',
      predByAnchor,
      goldKind: N,
    })
    expect(result.predKind).toBe(FS)
    expect(result.isMiss).toBe(false)
    expect(result.cellLabel).toBe('fp')
  })

  it('FP: isMiss=false (발화했으므로 miss 아님)', () => {
    const predByAnchor = new Map<string, DetectionKind>([
      ['anchor-fp-003', T],
    ])
    const result = resolveNonePrediction({
      goldAnchorUuid: 'anchor-fp-003',
      predByAnchor,
      goldKind: N,
    })
    expect(result.isMiss).toBe(false)
    expect(result.cellLabel).toBe('fp')
  })
})

// ================================================================
// 4. findUnmatchedPredAnchors — FP 후보 탐지 (gold=none 세션에서 pred 발화)
// ================================================================

describe('findUnmatchedPredAnchors — FP 후보 탐지', () => {
  it('모든 pred anchor가 gold에 매칭 → 빈 배열 반환', () => {
    const predAnchors = new Map<string, DetectionKind>([
      ['anchor-a', T],
      ['anchor-b', FS],
    ])
    const goldAnchors = new Set(['anchor-a', 'anchor-b'])
    const result = findUnmatchedPredAnchors(predAnchors, goldAnchors)
    expect(result).toHaveLength(0)
  })

  it('pred에 gold에 없는 anchor → FP 후보 반환', () => {
    const predAnchors = new Map<string, DetectionKind>([
      ['anchor-matched', T],
      ['anchor-fp', FS],  // gold에 없음
    ])
    const goldAnchors = new Set(['anchor-matched'])
    const result = findUnmatchedPredAnchors(predAnchors, goldAnchors)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ anchorUuid: 'anchor-fp', predKind: FS })
  })

  it('gold anchor가 없는 세션에서 pred 발화 전부 → 모두 FP 후보', () => {
    const predAnchors = new Map<string, DetectionKind>([
      ['anchor-x', T],
      ['anchor-y', FS],
      ['anchor-z', T],
    ])
    const goldAnchors = new Set<string>() // gold 없음 (none 세션)
    const result = findUnmatchedPredAnchors(predAnchors, goldAnchors)
    expect(result).toHaveLength(3)
    const uuids = result.map((r) => r.anchorUuid)
    expect(uuids).toContain('anchor-x')
    expect(uuids).toContain('anchor-y')
    expect(uuids).toContain('anchor-z')
  })

  it('pred 맵이 비어 있으면 FP 후보 없음', () => {
    const predAnchors = new Map<string, DetectionKind>()
    const goldAnchors = new Set(['anchor-a'])
    const result = findUnmatchedPredAnchors(predAnchors, goldAnchors)
    expect(result).toHaveLength(0)
  })

  it('불변성: 입력 맵/집합 수정 없음', () => {
    const predAnchors = new Map<string, DetectionKind>([['anchor-p', T]])
    const goldAnchors = new Set<string>()
    const predSize = predAnchors.size
    const goldSize = goldAnchors.size
    findUnmatchedPredAnchors(predAnchors, goldAnchors)
    expect(predAnchors.size).toBe(predSize)
    expect(goldAnchors.size).toBe(goldSize)
  })
})

// ================================================================
// 5. TP 케이스 — gold와 pred 일치 (검증용 대조군)
// ================================================================

describe('resolveNonePrediction — TP (gold=pred, 정확한 탐지)', () => {
  it('gold=thrashing, pred=thrashing → cellLabel=tp', () => {
    const predByAnchor = new Map<string, DetectionKind>([
      ['anchor-tp-001', T],
    ])
    const result = resolveNonePrediction({
      goldAnchorUuid: 'anchor-tp-001',
      predByAnchor,
      goldKind: T,
    })
    expect(result.predKind).toBe(T)
    expect(result.isMiss).toBe(false)
    expect(result.cellLabel).toBe('tp')
  })

  it('gold=false_success, pred=false_success → cellLabel=tp', () => {
    const predByAnchor = new Map<string, DetectionKind>([
      ['anchor-tp-002', FS],
    ])
    const result = resolveNonePrediction({
      goldAnchorUuid: 'anchor-tp-002',
      predByAnchor,
      goldKind: FS,
    })
    expect(result.predKind).toBe(FS)
    expect(result.isMiss).toBe(false)
    expect(result.cellLabel).toBe('tp')
  })
})

// ================================================================
// 6. misclassified 케이스 — gold≠none, pred≠none, pred≠gold
// ================================================================

describe('resolveNonePrediction — misclassified (gold≠none, pred≠none, pred≠gold)', () => {
  it('gold=thrashing, pred=false_success → cellLabel=misclassified', () => {
    const predByAnchor = new Map<string, DetectionKind>([
      ['anchor-mc-001', FS],
    ])
    const result = resolveNonePrediction({
      goldAnchorUuid: 'anchor-mc-001',
      predByAnchor,
      goldKind: T,
    })
    expect(result.predKind).toBe(FS)
    expect(result.isMiss).toBe(false)
    expect(result.cellLabel).toBe('misclassified')
  })

  it('gold=false_success, pred=thrashing → cellLabel=misclassified', () => {
    const predByAnchor = new Map<string, DetectionKind>([
      ['anchor-mc-002', T],
    ])
    const result = resolveNonePrediction({
      goldAnchorUuid: 'anchor-mc-002',
      predByAnchor,
      goldKind: FS,
    })
    expect(result.predKind).toBe(T)
    expect(result.isMiss).toBe(false)
    expect(result.cellLabel).toBe('misclassified')
  })
})

// ================================================================
// 7. 불변성 — 입력 수정 없음
// ================================================================

describe('resolveNonePrediction — 불변성', () => {
  it('predByAnchor Map이 수정되지 않음', () => {
    const predByAnchor = new Map<string, DetectionKind>([['anchor-imm', T]])
    const sizeBefore = predByAnchor.size
    resolveNonePrediction({
      goldAnchorUuid: 'anchor-imm',
      predByAnchor,
      goldKind: T,
    })
    expect(predByAnchor.size).toBe(sizeBefore)
  })

  it('새 객체를 반환 (동일 참조 아님)', () => {
    const predByAnchor = new Map<string, DetectionKind>([['anchor-obj', T]])
    const r1 = resolveNonePrediction({
      goldAnchorUuid: 'anchor-obj',
      predByAnchor,
      goldKind: T,
    })
    const r2 = resolveNonePrediction({
      goldAnchorUuid: 'anchor-obj',
      predByAnchor,
      goldKind: T,
    })
    expect(r1).not.toBe(r2)
    expect(r1).toEqual(r2)
  })
})
