/**
 * tests/file-edit-false-positive-sub-ac-2-4-4.test.ts
 *
 * Sub-AC 2.4.4: editDelta 멀티셋 기반 오탐 방지 통합 테스트
 *
 * StructureGate.checkFileEdit 에 buildEditDeltaMultiset + isFalsePositiveRepeat 가
 * 통합되었음을 end-to-end로 검증한다.
 *
 * 검증 범위:
 *   (a) 같은 파일, fileEditWarn 이상 편집했으나 모든 deltaHash가 서로 다름
 *       → StructureGateResult 미발화 (false positive suppression)
 *   (b) 같은 파일 + 동일 deltaHash 반복 (fileEditWarn 이상)
 *       → StructureGateResult 발화 (thrashing 탐지)
 *   (c) 서로 다른 파일 경로 편집은 각자 독립적으로 카운트
 *   (d) metrics 필드(fileEditN, maxJaccard, windowRefs) 검증
 */

import { createStructureGate, createSessionState } from '../src/detect/structure-gate.js'
import type { NormalizedEvent, StructureGateResult } from '../src/contracts.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/**
 * Edit tool_use NormalizedEvent를 생성한다.
 * old_string / new_string을 지정해 editDelta 해시를 결정론적으로 제어.
 */
function makeEditEvent(opts: {
  uuid: string
  filePath: string
  oldString: string
  newString: string
  ts?: number
}): NormalizedEvent {
  return {
    uuid: opts.uuid,
    parentUuid: null,
    sessionId: 'test-session',
    cwd: '/project',
    agentScope: 'root',
    isSidechain: false,
    ts: opts.ts ?? 1_700_000_000_000,
    byteOffset: 0,
    kind: 'tool_use',
    tool: 'Edit',
    input: {
      file_path: opts.filePath,
      old_string: opts.oldString,
      new_string: opts.newString,
    },
  }
}

/** テスト用 DetectorConfig — fileEditWarn=3, fileEditCrit=5 で小さくする */
const TEST_CONFIG = {
  ...DEFAULT_DETECTOR_CONFIG,
  historySize: 30,
  fileEditWarn: 3,
  fileEditCrit: 5,
  WARNING: 10,
  CRITICAL: 20,
  errLoopWarn: 3,
  errLoopCrit: 5,
}

// ─── (a) 모든 delta 서로 다름 → 오탐, 미발화 ────────────────────────────────

describe('Sub-AC 2.4.4 (a): 모든 deltaHash가 서로 다르면 StructureGateResult 미발화', () => {
  it('fileEditWarn(3)회 편집, 각각 다른 old/new → null 반환', () => {
    const gate = createStructureGate(TEST_CONFIG)
    let state = createSessionState('sess', 'root', TEST_CONFIG.historySize)

    // 3회 편집: 각각 완전히 다른 old→new 변경 (delta가 서로 달라야 함)
    const edits = [
      { uuid: 'u1', old: 'const alpha = 1', new: 'const alpha = 2' },
      { uuid: 'u2', old: 'let beta = true', new: 'let beta = false' },
      { uuid: 'u3', old: 'function gamma() {}', new: 'function gamma() { return 1 }' },
    ]

    let lastResult: StructureGateResult | null = null
    for (const e of edits) {
      const event = makeEditEvent({
        uuid: e.uuid,
        filePath: '/src/foo.ts',
        oldString: e.old,
        newString: e.new,
      })
      const out = gate.process(event, state)
      state = out.nextState
      lastResult = out.result
    }

    // 모든 delta가 다르므로 thrashing이 아님 → null
    expect(lastResult).toBeNull()
  })

  it('fileEditCrit(5)회 편집이어도 모든 delta 다르면 → null 반환', () => {
    const gate = createStructureGate(TEST_CONFIG)
    let state = createSessionState('sess', 'root', TEST_CONFIG.historySize)

    // 5회 편집: 각각 완전히 다른 변경
    const edits = [
      { uuid: 'u1', old: 'x = 1', new: 'x = 2' },
      { uuid: 'u2', old: 'y = true', new: 'y = false' },
      { uuid: 'u3', old: 'z = "a"', new: 'z = "b"' },
      { uuid: 'u4', old: 'w = null', new: 'w = undefined' },
      { uuid: 'u5', old: 'v = []', new: 'v = [1, 2, 3]' },
    ]

    let lastResult: StructureGateResult | null = null
    for (const e of edits) {
      const event = makeEditEvent({
        uuid: e.uuid,
        filePath: '/src/bar.ts',
        oldString: e.old,
        newString: e.new,
      })
      const out = gate.process(event, state)
      state = out.nextState
      lastResult = out.result
    }

    // 각 delta가 다르므로 isFalsePositiveRepeat → false → 미발화
    expect(lastResult).toBeNull()
  })

  it('fileEditWarn 넘지 않는 횟수는 delta 동일해도 미발화', () => {
    const gate = createStructureGate(TEST_CONFIG)
    let state = createSessionState('sess', 'root', TEST_CONFIG.historySize)

    // fileEditWarn=3 미만 (2회만 편집)
    const edits = [
      { uuid: 'u1', old: 'const x = 1', new: 'const x = 2' },
      { uuid: 'u2', old: 'const x = 1', new: 'const x = 2' }, // 동일 delta 반복
    ]

    let lastResult: StructureGateResult | null = null
    for (const e of edits) {
      const event = makeEditEvent({
        uuid: e.uuid,
        filePath: '/src/small.ts',
        oldString: e.old,
        newString: e.new,
      })
      const out = gate.process(event, state)
      state = out.nextState
      lastResult = out.result
    }

    expect(lastResult).toBeNull()
  })
})

// ─── (b) 동일 deltaHash 반복 → 발화 ──────────────────────────────────────────

describe('Sub-AC 2.4.4 (b): 동일 deltaHash 반복 시 StructureGateResult 발화', () => {
  it('fileEditWarn(3)회 동일 old/new 반복 → warning 발화', () => {
    const gate = createStructureGate(TEST_CONFIG)
    let state = createSessionState('sess', 'root', TEST_CONFIG.historySize)

    // 3회 동일 old→new 편집 (동일 delta)
    let lastResult: StructureGateResult | null = null
    for (let i = 1; i <= 3; i++) {
      const event = makeEditEvent({
        uuid: `u${i}`,
        filePath: '/src/repeat.ts',
        oldString: 'const x = 1',
        newString: 'const x = 2',
      })
      const out = gate.process(event, state)
      state = out.nextState
      lastResult = out.result
    }

    // 동일 delta 3회 = fileEditWarn → warning
    expect(lastResult).not.toBeNull()
    expect(lastResult!.type).toBe('thrashing')
    expect(lastResult!.subtype).toBe('file_edit_loop')
    expect(lastResult!.severity).toBe('warning')
    expect(lastResult!.sessionId).toBe('sess')
    expect(lastResult!.agentScope).toBe('root')
    expect(lastResult!.windowRefs).toHaveLength(3)
  })

  it('fileEditCrit(5)회 동일 delta 반복 → critical 발화', () => {
    const gate = createStructureGate(TEST_CONFIG)
    let state = createSessionState('sess', 'root', TEST_CONFIG.historySize)

    let lastResult: StructureGateResult | null = null
    for (let i = 1; i <= 5; i++) {
      const event = makeEditEvent({
        uuid: `u${i}`,
        filePath: '/src/critical.ts',
        oldString: 'function foo() { return false }',
        newString: 'function foo() { return true }',
      })
      const out = gate.process(event, state)
      state = out.nextState
      lastResult = out.result
    }

    expect(lastResult).not.toBeNull()
    expect(lastResult!.severity).toBe('critical')
    expect(lastResult!.subtype).toBe('file_edit_loop')
    expect(lastResult!.windowRefs).toHaveLength(5)
  })

  it('공백만 다른 편집은 동일 delta로 처리되어 thrashing 탐지됨', () => {
    // collapseWS 정규화로 공백만 다른 편집은 같은 delta → 동일 argKey
    const gate = createStructureGate(TEST_CONFIG)
    let state = createSessionState('sess', 'root', TEST_CONFIG.historySize)

    // 공백 차이만 있는 3가지 변형 — 모두 동일 normalized delta 생성
    const variants = [
      { old: 'const x = 1', new: 'const x = 2' },
      { old: 'const  x = 1', new: 'const  x = 2' },   // 추가 공백
      { old: 'const x  = 1', new: 'const x  = 2' },   // 다른 위치 공백
    ]

    let lastResult: StructureGateResult | null = null
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i]!
      const event = makeEditEvent({
        uuid: `u${i + 1}`,
        filePath: '/src/whitespace.ts',
        oldString: v.old,
        newString: v.new,
      })
      const out = gate.process(event, state)
      state = out.nextState
      lastResult = out.result
    }

    // 공백 정규화로 동일 delta → thrashing 탐지
    expect(lastResult).not.toBeNull()
    expect(lastResult!.type).toBe('thrashing')
  })

  it('혼합: 처음엔 다른 delta, 나중에 동일 delta 반복 → 임계 넘으면 발화', () => {
    const gate = createStructureGate(TEST_CONFIG)
    let state = createSessionState('sess', 'root', TEST_CONFIG.historySize)

    // 처음 2회: 다른 delta
    // 이후 3회: 동일 delta (fileEditWarn=3 도달)
    const mixedEdits = [
      { uuid: 'u1', old: 'import A from "./a"', new: 'import B from "./b"' },
      { uuid: 'u2', old: 'export default C', new: 'export default D' },
      { uuid: 'u3', old: 'const val = 42', new: 'const val = 100' },
      { uuid: 'u4', old: 'const val = 42', new: 'const val = 100' },
      { uuid: 'u5', old: 'const val = 42', new: 'const val = 100' },
    ]

    let lastResult: StructureGateResult | null = null
    for (const e of mixedEdits) {
      const event = makeEditEvent({
        uuid: e.uuid,
        filePath: '/src/mixed.ts',
        oldString: e.old,
        newString: e.new,
      })
      const out = gate.process(event, state)
      state = out.nextState
      lastResult = out.result
    }

    // 동일 delta 3회 반복(u3/u4/u5)이 fileEditWarn(3) 이상 → 발화
    expect(lastResult).not.toBeNull()
    expect(lastResult!.type).toBe('thrashing')
  })
})

// ─── (c) 서로 다른 파일은 독립적으로 카운트 ──────────────────────────────────

describe('Sub-AC 2.4.4 (c): 서로 다른 파일 경로는 독립적으로 카운트', () => {
  it('두 파일 각각 fileEditWarn-1 회씩 동일 delta → 각자 미발화', () => {
    const gate = createStructureGate(TEST_CONFIG)
    let state = createSessionState('sess', 'root', TEST_CONFIG.historySize)

    // fileEditWarn=3, 각 파일 2회씩 편집
    const events = [
      makeEditEvent({ uuid: 'a1', filePath: '/src/a.ts', oldString: 'x=1', newString: 'x=2' }),
      makeEditEvent({ uuid: 'a2', filePath: '/src/a.ts', oldString: 'x=1', newString: 'x=2' }),
      makeEditEvent({ uuid: 'b1', filePath: '/src/b.ts', oldString: 'y=1', newString: 'y=2' }),
      makeEditEvent({ uuid: 'b2', filePath: '/src/b.ts', oldString: 'y=1', newString: 'y=2' }),
    ]

    let lastResult: StructureGateResult | null = null
    for (const event of events) {
      const out = gate.process(event, state)
      state = out.nextState
      lastResult = out.result
    }

    // 각 파일 2회 < fileEditWarn(3) → 미발화
    expect(lastResult).toBeNull()
  })

  it('한 파일만 임계 초과, 다른 파일은 독립적으로 카운트됨', () => {
    const gate = createStructureGate(TEST_CONFIG)
    let state = createSessionState('sess', 'root', TEST_CONFIG.historySize)

    // /src/hot.ts: 3회 동일 delta → 발화 대상
    // /src/cold.ts: 1회만 편집
    const events: NormalizedEvent[] = [
      makeEditEvent({ uuid: 'h1', filePath: '/src/hot.ts', oldString: 'a=1', newString: 'a=2' }),
      makeEditEvent({ uuid: 'h2', filePath: '/src/hot.ts', oldString: 'a=1', newString: 'a=2' }),
      makeEditEvent({ uuid: 'c1', filePath: '/src/cold.ts', oldString: 'z=99', newString: 'z=0' }),
      makeEditEvent({ uuid: 'h3', filePath: '/src/hot.ts', oldString: 'a=1', newString: 'a=2' }),
    ]

    const results: Array<StructureGateResult | null> = []
    for (const event of events) {
      const out = gate.process(event, state)
      state = out.nextState
      results.push(out.result)
    }

    // hot.ts 3회째 편집 시 발화
    const hotResult = results[3]
    expect(hotResult).not.toBeNull()
    expect(hotResult!.type).toBe('thrashing')
    expect(hotResult!.subtype).toBe('file_edit_loop')
  })
})

// ─── (d) metrics 검증 ────────────────────────────────────────────────────────

describe('Sub-AC 2.4.4 (d): StructureGateResult metrics 필드 검증', () => {
  it('발화된 결과에 fileEditN 과 maxJaccard 가 포함됨', () => {
    const gate = createStructureGate(TEST_CONFIG)
    let state = createSessionState('sess', 'root', TEST_CONFIG.historySize)

    let lastResult: StructureGateResult | null = null
    for (let i = 1; i <= 3; i++) {
      const event = makeEditEvent({
        uuid: `m${i}`,
        filePath: '/src/metrics.ts',
        oldString: 'const count = 0',
        newString: 'const count = 1',
      })
      const out = gate.process(event, state)
      state = out.nextState
      lastResult = out.result
    }

    expect(lastResult).not.toBeNull()
    expect(lastResult!.metrics).toHaveProperty('fileEditN')
    expect(lastResult!.metrics['fileEditN']).toBe(3)
    expect(lastResult!.metrics).toHaveProperty('maxJaccard')
    expect(typeof lastResult!.metrics['maxJaccard']).toBe('number')
    expect(lastResult!.metrics['maxJaccard']).toBeGreaterThan(0)
  })

  it('windowRefs는 해당 파일 편집 uuid 배열을 포함한다', () => {
    const gate = createStructureGate(TEST_CONFIG)
    let state = createSessionState('sess2', 'root', TEST_CONFIG.historySize)

    const uuids = ['ref-1', 'ref-2', 'ref-3']
    let finalResult: StructureGateResult | null = null
    for (const uuid of uuids) {
      const event = makeEditEvent({
        uuid,
        filePath: '/src/refs.ts',
        oldString: 'let flag = false',
        newString: 'let flag = true',
      })
      const out = gate.process(event, state)
      state = out.nextState
      finalResult = out.result
    }

    expect(finalResult).not.toBeNull()
    expect(finalResult!.windowRefs).toEqual(expect.arrayContaining(uuids))
  })

  it('non-tool_use 이벤트는 처리되지 않고 null 반환', () => {
    const gate = createStructureGate(TEST_CONFIG)
    const state = createSessionState('sess', 'root', TEST_CONFIG.historySize)

    const nonToolEvent: NormalizedEvent = {
      uuid: 'x1',
      parentUuid: null,
      sessionId: 'test-session',
      cwd: '/project',
      agentScope: 'root',
      isSidechain: false,
      ts: 1_700_000_000_000,
      byteOffset: 0,
      kind: 'assistant',
      text: 'hello',
    }

    const out = gate.process(nonToolEvent, state)
    expect(out.result).toBeNull()
    // state should be unchanged
    expect(out.nextState).toBe(state)
  })
})
