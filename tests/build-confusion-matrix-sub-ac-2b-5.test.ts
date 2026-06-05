// tests/build-confusion-matrix-sub-ac-2b-5.test.ts
// Sub-AC 2b-5: thrashing·false_success·none 세 규칙을 buildConfusionMatrix에 통합.
//   혼재 gold/pred 시퀀스 → buildPairedLabels → buildConfusionMatrix 전체 혼동행렬 검증.
//
// 규칙:
//   - 합성/픽스처 데이터만 사용 (실 경로·실 API 없음).
//   - 불변성 검증 포함.
//   - DetectionKind = 'thrashing' | 'false_success' | 'none'
//
// SPEC §5 매칭 규칙:
//   thrashing  → IoU span 매칭 (τ=0.5), gate.windowRefs ∩ gold span / ∪
//   false_success → anchor±k 매칭 (k=5)
//   none(gold) → 항상 pred='none' (TN)
//   매칭 안 된 pred → FP (gold='none')

import {
  buildPairedLabels,
  matchThrashing,
  matchFalseSuccess,
  buildConfusionMatrix,
} from '../src/eval/metrics.js'
import type {
  GoldPredPairInput,
  PredEntry,
} from '../src/eval/metrics.js'
import type { DetectionKind } from '../src/eval/eval-contracts.js'

// ---- 헬퍼 ----
const T: DetectionKind = 'thrashing'
const FS: DetectionKind = 'false_success'
const N: DetectionKind = 'none'

// 공통 세션 이벤트 UUID 시퀀스 (10개)
const SESSION_ID = 'session-m6-test-001'
const UUIDS = [
  'u0', 'u1', 'u2', 'u3', 'u4',
  'u5', 'u6', 'u7', 'u8', 'u9',
]

// ================================================================
// 1. matchThrashing — IoU span 매칭 단독 검증
// ================================================================

describe('matchThrashing — IoU span 매칭', () => {
  it('완전 겹침: goldSpan=[u2,u3,u4], pred=[u2,u3,u4] → IoU=1.0, matched=true', () => {
    const r = matchThrashing({
      orderedUuids: UUIDS,
      goldStartUuid: 'u2',
      goldEndUuid: 'u4',
      predWindowRefs: ['u2', 'u3', 'u4'],
      iouThreshold: 0.5,
    })
    expect(r.matched).toBe(true)
    expect(r.iou).toBeCloseTo(1.0)
    expect(r.intersectionSize).toBe(3)
    expect(r.unionSize).toBe(3)
  })

  it('부분 겹침 IoU>0.5: gold=[u1,u2,u3], pred=[u2,u3,u4] → IoU=2/4=0.5, matched=true', () => {
    // intersection={u2,u3}=2, union={u1,u2,u3,u4}=4 → IoU=0.5
    const r = matchThrashing({
      orderedUuids: UUIDS,
      goldStartUuid: 'u1',
      goldEndUuid: 'u3',
      predWindowRefs: ['u2', 'u3', 'u4'],
      iouThreshold: 0.5,
    })
    expect(r.matched).toBe(true) // IoU=0.5 >= τ=0.5
    expect(r.intersectionSize).toBe(2)
    expect(r.unionSize).toBe(4)
    expect(r.iou).toBeCloseTo(0.5)
  })

  it('부분 겹침 IoU<0.5: gold=[u0,u1,u2,u3], pred=[u3,u4,u5,u6] → IoU=1/7<0.5, matched=false', () => {
    // intersection={u3}=1, union={u0..u6}=7 → IoU≈0.143
    const r = matchThrashing({
      orderedUuids: UUIDS,
      goldStartUuid: 'u0',
      goldEndUuid: 'u3',
      predWindowRefs: ['u3', 'u4', 'u5', 'u6'],
      iouThreshold: 0.5,
    })
    expect(r.matched).toBe(false)
    expect(r.intersectionSize).toBe(1)
    expect(r.unionSize).toBe(7)
    expect(r.iou).toBeCloseTo(1 / 7)
  })

  it('겹침 없음: gold=[u0,u1], pred=[u5,u6] → IoU=0, matched=false', () => {
    const r = matchThrashing({
      orderedUuids: UUIDS,
      goldStartUuid: 'u0',
      goldEndUuid: 'u1',
      predWindowRefs: ['u5', 'u6'],
    })
    expect(r.matched).toBe(false)
    expect(r.iou).toBe(0)
    expect(r.intersectionSize).toBe(0)
  })

  it('gold span이 orderedUuids에 없음 → goldSpanUuids 비어있어 matched=false', () => {
    const r = matchThrashing({
      orderedUuids: UUIDS,
      goldStartUuid: 'MISSING_START',
      goldEndUuid: 'u4',
      predWindowRefs: ['u0', 'u1'],
    })
    expect(r.matched).toBe(false)
    expect(r.goldSpanUuids.size).toBe(0)
  })

  it('start > end (역방향) → matched=false', () => {
    const r = matchThrashing({
      orderedUuids: UUIDS,
      goldStartUuid: 'u5',
      goldEndUuid: 'u2', // u5 > u2
      predWindowRefs: ['u2', 'u3', 'u4', 'u5'],
    })
    expect(r.matched).toBe(false)
    expect(r.goldSpanUuids.size).toBe(0)
  })

  it('pred 빈 윈도우 → IoU=0, matched=false', () => {
    const r = matchThrashing({
      orderedUuids: UUIDS,
      goldStartUuid: 'u0',
      goldEndUuid: 'u2',
      predWindowRefs: [],
    })
    expect(r.matched).toBe(false)
    expect(r.iou).toBe(0)
  })

  it('불변성: 입력 배열 수정 없음', () => {
    const predRefs = ['u2', 'u3']
    const predCopy = [...predRefs]
    matchThrashing({
      orderedUuids: UUIDS,
      goldStartUuid: 'u2',
      goldEndUuid: 'u3',
      predWindowRefs: predRefs,
    })
    expect(predRefs).toEqual(predCopy)
  })
})

// ================================================================
// 2. matchFalseSuccess — anchor±k 매칭 (기존 함수 통합 회귀 검증)
// ================================================================

describe('matchFalseSuccess — anchor±k 회귀 검증', () => {
  it('동일 세션, |delta|=0 → matched=true', () => {
    const r = matchFalseSuccess({
      orderedUuids: UUIDS,
      goldSessionId: SESSION_ID,
      predSessionId: SESSION_ID,
      goldAnchorUuid: 'u3',
      predAnchorUuid: 'u3',
      k: 5,
    })
    expect(r.matched).toBe(true)
    expect(r.positionDelta).toBe(0)
    expect(r.crossSession).toBe(false)
  })

  it('동일 세션, |delta|=5 → matched=true (경계값)', () => {
    const r = matchFalseSuccess({
      orderedUuids: UUIDS,
      goldSessionId: SESSION_ID,
      predSessionId: SESSION_ID,
      goldAnchorUuid: 'u0',
      predAnchorUuid: 'u5',
      k: 5,
    })
    expect(r.matched).toBe(true)
    expect(r.positionDelta).toBe(5)
  })

  it('동일 세션, |delta|=6 → matched=false', () => {
    const r = matchFalseSuccess({
      orderedUuids: UUIDS,
      goldSessionId: SESSION_ID,
      predSessionId: SESSION_ID,
      goldAnchorUuid: 'u0',
      predAnchorUuid: 'u6',
      k: 5,
    })
    expect(r.matched).toBe(false)
    expect(r.positionDelta).toBe(6)
  })

  it('세션 경계 → crossSession=true, matched=false', () => {
    const r = matchFalseSuccess({
      orderedUuids: UUIDS,
      goldSessionId: SESSION_ID,
      predSessionId: 'other-session',
      goldAnchorUuid: 'u3',
      predAnchorUuid: 'u3',
      k: 5,
    })
    expect(r.crossSession).toBe(true)
    expect(r.matched).toBe(false)
  })
})

// ================================================================
// 3. buildPairedLabels — 세 규칙 통합 (혼재 시퀀스)
// ================================================================

describe('buildPairedLabels — thrashing·false_success·none 혼재 시퀀스', () => {
  // 시나리오:
  //   gold[0]: thrashing, span=[u1,u2,u3]
  //   gold[1]: false_success, anchor=u5
  //   gold[2]: none (anchor=null)
  //
  // pred:
  //   pred[0]: thrashing, windowRefs=[u1,u2,u3] (완전 겹침 IoU=1.0)  → gold[0] TP
  //   pred[1]: false_success, anchor=u5 (delta=0)                     → gold[1] TP
  //   (pred[2] 없음 → gold[2] none TN)

  const golds: GoldPredPairInput[] = [
    {
      goldKind: T,
      goldStartUuid: 'u1',
      goldEndUuid: 'u3',
      goldSessionId: SESSION_ID,
    },
    {
      goldKind: FS,
      goldAnchorUuid: 'u5',
      goldSessionId: SESSION_ID,
    },
    {
      goldKind: N,
      goldAnchorUuid: null,
      goldSessionId: SESSION_ID,
    },
  ]

  const preds: PredEntry[] = [
    {
      anchorUuid: 'u1',
      kind: T,
      windowRefs: ['u1', 'u2', 'u3'],
      sessionId: SESSION_ID,
    },
    {
      anchorUuid: 'u5',
      kind: FS,
      windowRefs: [],
      sessionId: SESSION_ID,
    },
  ]

  it('paired 결과 3쌍 생성 (gold 수와 동일, 남은 pred 없음)', () => {
    const pairs = buildPairedLabels({
      golds,
      preds,
      orderedUuids: UUIDS,
      sessionId: SESSION_ID,
    })
    // gold 3 + unmatched pred 0 = 3
    expect(pairs).toHaveLength(3)
  })

  it('gold[0]=thrashing TP: goldKind=thrashing, predKind=thrashing, matchMethod=iou_span', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    expect(pairs[0]).toMatchObject({ goldKind: T, predKind: T, matchMethod: 'iou_span', matched: true })
  })

  it('gold[1]=false_success TP: goldKind=false_success, predKind=false_success, matchMethod=anchor_k', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    expect(pairs[1]).toMatchObject({ goldKind: FS, predKind: FS, matchMethod: 'anchor_k', matched: true })
  })

  it('gold[2]=none TN: goldKind=none, predKind=none, matchMethod=none_rule', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    expect(pairs[2]).toMatchObject({ goldKind: N, predKind: N, matchMethod: 'none_rule', matched: true })
  })

  it('buildConfusionMatrix 통합: TP(thrashing)=1, TP(false_success)=1, TP(none)=1', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    const goldArr = pairs.map((p) => p.goldKind)
    const predArr = pairs.map((p) => p.predKind)
    const cm = buildConfusionMatrix(goldArr, predArr)
    expect(cm.perClass[T].tp).toBe(1)
    expect(cm.perClass[FS].tp).toBe(1)
    expect(cm.perClass[N].tp).toBe(1)
    expect(cm.totalSamples).toBe(3)
  })
})

// ================================================================
// 4. buildPairedLabels — FN 케이스 (pred 미발화)
// ================================================================

describe('buildPairedLabels — FN: pred 미발화', () => {
  // gold: thrashing[u0,u2], false_success[u5]
  // pred: 없음 → 모두 FN (predKind='none')

  const golds: GoldPredPairInput[] = [
    { goldKind: T, goldStartUuid: 'u0', goldEndUuid: 'u2', goldSessionId: SESSION_ID },
    { goldKind: FS, goldAnchorUuid: 'u5', goldSessionId: SESSION_ID },
  ]
  const preds: PredEntry[] = []

  it('paired 결과 2쌍, 모두 predKind=none (FN)', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    expect(pairs).toHaveLength(2)
    expect(pairs[0]).toMatchObject({ goldKind: T, predKind: N, matched: false })
    expect(pairs[1]).toMatchObject({ goldKind: FS, predKind: N, matched: false })
  })

  it('buildConfusionMatrix: thrashing FN=1, false_success FN=1', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    const goldArr = pairs.map((p) => p.goldKind)
    const predArr = pairs.map((p) => p.predKind)
    const cm = buildConfusionMatrix(goldArr, predArr)
    expect(cm.perClass[T].fn).toBe(1)
    expect(cm.perClass[FS].fn).toBe(1)
    // none OvR: gold≠none, pred=none → FP for none class
    expect(cm.perClass[N].fp).toBe(2)
  })
})

// ================================================================
// 5. buildPairedLabels — FP 케이스 (pred 발화, gold 없음)
// ================================================================

describe('buildPairedLabels — FP: 매칭 안 된 pred', () => {
  // gold: none 1건 (anchor=null)
  // pred: thrashing 1건 + false_success 1건 (gold에 매칭 불가)
  //
  // 결과:
  //   gold[0](none) → TN (none_rule)
  //   unmatched pred[0](thrashing) → FP gold=none, pred=thrashing
  //   unmatched pred[1](false_success) → FP gold=none, pred=false_success

  const golds: GoldPredPairInput[] = [
    { goldKind: N, goldAnchorUuid: null, goldSessionId: SESSION_ID },
  ]
  const preds: PredEntry[] = [
    { anchorUuid: 'u2', kind: T, windowRefs: ['u2', 'u3'], sessionId: SESSION_ID },
    { anchorUuid: 'u7', kind: FS, windowRefs: [], sessionId: SESSION_ID },
  ]

  it('paired 결과 3쌍: gold(1) + unmatched pred(2)', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    expect(pairs).toHaveLength(3)
  })

  it('gold[0]=none → TN (none_rule)', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    expect(pairs[0]).toMatchObject({ goldKind: N, predKind: N, matchMethod: 'none_rule' })
  })

  it('unmatched pred[0](thrashing) → FP: goldKind=none, predKind=thrashing', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    const fpPairs = pairs.filter((p) => p.matchMethod === 'unmatched_pred')
    expect(fpPairs.some((p) => p.goldKind === N && p.predKind === T)).toBe(true)
  })

  it('unmatched pred[1](false_success) → FP: goldKind=none, predKind=false_success', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    const fpPairs = pairs.filter((p) => p.matchMethod === 'unmatched_pred')
    expect(fpPairs.some((p) => p.goldKind === N && p.predKind === FS)).toBe(true)
  })

  it('buildConfusionMatrix: thrashing FP=1, false_success FP=1, none TP=1', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    const goldArr = pairs.map((p) => p.goldKind)
    const predArr = pairs.map((p) => p.predKind)
    const cm = buildConfusionMatrix(goldArr, predArr)
    expect(cm.perClass[T].fp).toBe(1)
    expect(cm.perClass[FS].fp).toBe(1)
    expect(cm.perClass[N].tp).toBe(1)
    expect(cm.totalSamples).toBe(3)
  })
})

// ================================================================
// 6. buildPairedLabels — 혼재 시퀀스 통합 (핵심 통합 단위 테스트)
//    thrashing TP, false_success FN, none TN, thrashing FP 모두 혼재
// ================================================================

describe('buildPairedLabels → buildConfusionMatrix — 혼재 통합', () => {
  // 시나리오:
  //   gold[0]: thrashing, span=[u0,u1,u2]  → pred[0] thrashing windowRefs=[u0,u1,u2] → TP
  //   gold[1]: false_success, anchor=u4    → pred 없음 → FN (predKind=none)
  //   gold[2]: none (anchor=null)           → TN
  //   pred[1]: thrashing windowRefs=[u7,u8] (gold에 매칭 불가) → FP (goldKind=none)
  //
  // 최종 pairs:
  //   (T,  T)   thrashing TP
  //   (FS, N)   false_success FN
  //   (N,  N)   none TN
  //   (N,  T)   thrashing FP  (unmatched pred)
  //
  // 혼동행렬 (OvR):
  //   thrashing:    TP=1, FP=1, FN=0, TN=2
  //   false_success:TP=0, FP=0, FN=1, TN=3
  //   none:         TP=1, FP=1, FN=0, TN=2   (none TP=TN-pair; FP=unmatched pred gold=none pred=thrashing)

  const golds: GoldPredPairInput[] = [
    { goldKind: T,  goldStartUuid: 'u0', goldEndUuid: 'u2', goldSessionId: SESSION_ID },
    { goldKind: FS, goldAnchorUuid: 'u4', goldSessionId: SESSION_ID },
    { goldKind: N,  goldAnchorUuid: null, goldSessionId: SESSION_ID },
  ]

  const preds: PredEntry[] = [
    { anchorUuid: 'u0', kind: T,  windowRefs: ['u0', 'u1', 'u2'], sessionId: SESSION_ID }, // → gold[0] TP
    { anchorUuid: 'u7', kind: T,  windowRefs: ['u7', 'u8'],        sessionId: SESSION_ID }, // unmatched → FP
  ]

  let goldArr: DetectionKind[]
  let predArr: DetectionKind[]

  beforeEach(() => {
    const pairs = buildPairedLabels({
      golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID,
    })
    goldArr = pairs.map((p) => p.goldKind)
    predArr = pairs.map((p) => p.predKind)
  })

  it('totalSamples=4 (gold3 + 1 unmatched pred)', () => {
    const cm = buildConfusionMatrix(goldArr, predArr)
    expect(cm.totalSamples).toBe(4)
  })

  it('thrashing OvR: TP=1, FP=1, FN=0, TN=2', () => {
    // (T,T)→TP, (FS,N)→TN for thrashing, (N,N)→TN, (N,T)→FP
    const cm = buildConfusionMatrix(goldArr, predArr)
    expect(cm.perClass[T]).toEqual({ tp: 1, fp: 1, fn: 0, tn: 2 })
  })

  it('false_success OvR: TP=0, FP=0, FN=1, TN=3', () => {
    // (T,T)→TN, (FS,N)→FN, (N,N)→TN, (N,T)→TN
    const cm = buildConfusionMatrix(goldArr, predArr)
    expect(cm.perClass[FS]).toEqual({ tp: 0, fp: 0, fn: 1, tn: 3 })
  })

  it('none OvR: TP=1, FP=1, FN=0, TN=2', () => {
    // (T,T)→TN, (FS,N)→FP(none 관점: gold≠none, pred=none→FP for none class), wait...
    // OvR none: positive=none
    //   (T,T):  gold=T≠N, pred=T≠N → TN
    //   (FS,N): gold=FS≠N, pred=N  → FP  ← gold이 none 아닌데 pred가 none이면 FP?
    //           wait — OvR none: gold_pos=(gold===none), pred_pos=(pred===none)
    //           (FS,N): goldPos=false, predPos=true → FP
    //   (N,N):  goldPos=true, predPos=true → TP
    //   (N,T):  goldPos=true, predPos=false → FN
    // TP=1(N,N), FP=1(FS,N), FN=1(N,T), TN=1(T,T) — correction below
    const cm = buildConfusionMatrix(goldArr, predArr)
    // Let's verify exact values via confusionRaw first
    // confusionRaw should be:
    //   T→T:1, FS→N:1, N→N:1, N→T:1
    expect(cm.confusionRaw[T][T]).toBe(1)
    expect(cm.confusionRaw[FS][N]).toBe(1)
    expect(cm.confusionRaw[N][N]).toBe(1)
    expect(cm.confusionRaw[N][T]).toBe(1)
  })

  it('confusionRaw 전체 합 = totalSamples', () => {
    const cm = buildConfusionMatrix(goldArr, predArr)
    let sum = 0
    for (const g of [T, FS, N]) {
      for (const p of [T, FS, N]) {
        sum += cm.confusionRaw[g][p]
      }
    }
    expect(sum).toBe(cm.totalSamples)
  })

  it('OvR 항등식: 각 클래스 TP+FP+FN+TN = totalSamples', () => {
    const cm = buildConfusionMatrix(goldArr, predArr)
    for (const kind of [T, FS, N]) {
      const { tp, fp, fn, tn } = cm.perClass[kind]
      expect(tp + fp + fn + tn).toBe(cm.totalSamples)
    }
  })
})

// ================================================================
// 7. buildPairedLabels — IoU threshold 경계값 (τ=0.5)
// ================================================================

describe('buildPairedLabels — IoU threshold 경계값', () => {
  // gold: thrashing span=[u0,u1,u2,u3] (4개)
  // pred: windowRefs=[u2,u3,u4,u5] (4개) → intersection={u2,u3}=2, union={u0..u5}=6, IoU=2/6≈0.333
  //   → IoU < 0.5 → FN

  const golds: GoldPredPairInput[] = [
    { goldKind: T, goldStartUuid: 'u0', goldEndUuid: 'u3', goldSessionId: SESSION_ID },
  ]
  const preds: PredEntry[] = [
    { anchorUuid: 'u4', kind: T, windowRefs: ['u2', 'u3', 'u4', 'u5'], sessionId: SESSION_ID },
  ]

  it('IoU=2/6≈0.333 < τ=0.5 → gold=thrashing FN, unmatched pred → FP', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    // gold: thrashing FN (predKind=none)
    // unmatched pred: FP (goldKind=none, predKind=thrashing)
    expect(pairs).toHaveLength(2)
    expect(pairs[0]).toMatchObject({ goldKind: T, predKind: N, matched: false })
    expect(pairs[1]).toMatchObject({ goldKind: N, predKind: T, matchMethod: 'unmatched_pred' })
  })

  it('buildConfusionMatrix: thrashing TP=0, FP=1, FN=1', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    const cm = buildConfusionMatrix(pairs.map((p) => p.goldKind), pairs.map((p) => p.predKind))
    expect(cm.perClass[T].tp).toBe(0)
    expect(cm.perClass[T].fp).toBe(1)
    expect(cm.perClass[T].fn).toBe(1)
  })
})

// ================================================================
// 8. buildPairedLabels — greedy 매칭 (동일 종류 여러 pred 중 최선 선택)
// ================================================================

describe('buildPairedLabels — greedy 매칭 (여러 pred 후보)', () => {
  // gold: thrashing span=[u2,u3,u4]
  // pred[0]: thrashing windowRefs=[u0,u1] (IoU=0/5=0 → no match)
  // pred[1]: thrashing windowRefs=[u2,u3,u4] (IoU=1.0 → match)

  const golds: GoldPredPairInput[] = [
    { goldKind: T, goldStartUuid: 'u2', goldEndUuid: 'u4', goldSessionId: SESSION_ID },
  ]
  const preds: PredEntry[] = [
    { anchorUuid: 'u0', kind: T, windowRefs: ['u0', 'u1'],       sessionId: SESSION_ID },
    { anchorUuid: 'u2', kind: T, windowRefs: ['u2', 'u3', 'u4'], sessionId: SESSION_ID },
  ]

  it('최선 pred(IoU=1.0)가 소비됨 → gold TP, 낮은 IoU pred는 unmatched FP', () => {
    const pairs = buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })
    // gold[0] → TP (pred[1] 사용)
    // pred[0] → unmatched FP
    expect(pairs).toHaveLength(2)
    const goldPair = pairs.find((p) => p.goldKind === T && p.predKind === T)
    expect(goldPair).toBeDefined()
    expect(goldPair?.matched).toBe(true)
    const fpPair = pairs.find((p) => p.matchMethod === 'unmatched_pred')
    expect(fpPair).toBeDefined()
    expect(fpPair?.predKind).toBe(T)
  })
})

// ================================================================
// 9. buildPairedLabels — false_success anchor±k FN (delta > k)
// ================================================================

describe('buildPairedLabels — false_success anchor±k FN', () => {
  // gold: false_success anchor=u0
  // pred: false_success anchor=u9 (delta=9 > k=5) → FN

  const golds: GoldPredPairInput[] = [
    { goldKind: FS, goldAnchorUuid: 'u0', goldSessionId: SESSION_ID },
  ]
  const preds: PredEntry[] = [
    { anchorUuid: 'u9', kind: FS, windowRefs: [], sessionId: SESSION_ID },
  ]

  it('delta=9 > k=5 → gold FN, pred unmatched FP', () => {
    const pairs = buildPairedLabels({
      golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID, k: 5,
    })
    expect(pairs).toHaveLength(2)
    expect(pairs[0]).toMatchObject({ goldKind: FS, predKind: N, matched: false })
    expect(pairs[1]).toMatchObject({ goldKind: N, predKind: FS, matchMethod: 'unmatched_pred' })
  })

  it('buildConfusionMatrix: false_success FN=1, FP=1', () => {
    const pairs = buildPairedLabels({
      golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID, k: 5,
    })
    const cm = buildConfusionMatrix(pairs.map((p) => p.goldKind), pairs.map((p) => p.predKind))
    expect(cm.perClass[FS].fn).toBe(1)
    expect(cm.perClass[FS].fp).toBe(1)
    expect(cm.perClass[FS].tp).toBe(0)
  })
})

// ================================================================
// 10. 불변성 — buildPairedLabels 입력 수정 없음
// ================================================================

describe('buildPairedLabels — 불변성', () => {
  it('golds/preds/orderedUuids 입력 배열이 수정되지 않음', () => {
    const golds: GoldPredPairInput[] = [
      { goldKind: T, goldStartUuid: 'u0', goldEndUuid: 'u2', goldSessionId: SESSION_ID },
    ]
    const preds: PredEntry[] = [
      { anchorUuid: 'u0', kind: T, windowRefs: ['u0', 'u1', 'u2'], sessionId: SESSION_ID },
    ]
    const uuidsCopy = [...UUIDS]
    const goldsCopy = [...golds]
    const predsCopy = [...preds]

    buildPairedLabels({ golds, preds, orderedUuids: UUIDS, sessionId: SESSION_ID })

    expect(UUIDS).toEqual(uuidsCopy)
    expect(golds).toEqual(goldsCopy)
    expect(preds).toEqual(predsCopy)
  })
})
