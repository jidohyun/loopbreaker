/**
 * tests/detector-config-sub-ac-6c-3.test.ts
 *
 * Sub-AC 6c-3: Parameterized test for `sameFileEditThreshold`
 * (DetectorConfig.fileEditWarn / fileEditCrit).
 *
 * Spec:
 *   - Construct a DetectorConfig with a specific `sameFileEditThreshold` value N
 *     (mapped to fileEditWarn).
 *   - Feed exactly N-1 Edit events targeting the same file → expect NO flag (result is null).
 *   - Feed exactly N such events → expect flag (StructureGateResult with
 *     subtype='file_edit_loop').
 *   - Assert the gate outcome flips at precisely that boundary with no hardcoded constant
 *     in the same-file-edit detector function.
 *   - All thresholds are read exclusively from DetectorConfig (SPEC §4 1c, §1 constraint:
 *     코드 상수 금지).
 *
 * Relationship to Sub-AC 6c-1 / 6c-2:
 *   6c-1 tested repeatActionThreshold (DetectorConfig.WARNING).
 *   6c-2 tested sameErrorThreshold (DetectorConfig.errLoopWarn).
 *   6c-3 tests sameFileEditThreshold (DetectorConfig.fileEditWarn / fileEditCrit).
 */

import {
  type DetectorConfig,
  DEFAULT_DETECTOR_CONFIG,
} from '../src/contracts.js'
import type { NormalizedEvent } from '../src/contracts.js'
import {
  StructureGate,
  createSessionState,
  type SessionState,
} from '../src/detect/structure-gate.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

let _seq = 0

/**
 * Build a minimal tool_use NormalizedEvent for an Edit on a specific file.
 * The old_string / new_string share significant token overlap so Jaccard >= 0.1
 * (ensuring the file-edit detector does NOT suppress due to "completely different regions").
 */
function makeEditEvent(
  filePath: string,
  variant = 'default',
  sessionId = 'sess-6c3',
): NormalizedEvent {
  _seq++
  // Use similar content so Jaccard is well above the 0.1 suppression threshold
  const baseContent = `function foo() { return ${variant}; }`
  return {
    uuid: `uuid-6c3-${_seq}`,
    parentUuid: null,
    sessionId,
    cwd: '/project',
    agentScope: 'root',
    isSidechain: false,
    ts: 1_700_000_000_000 + _seq,
    byteOffset: _seq * 100,
    kind: 'tool_use',
    tool: 'Edit',
    input: {
      file_path: filePath,
      old_string: baseContent,
      new_string: `function foo() { return ${variant}_updated; }`,
    },
    resultClass: 'ok',
  }
}

/**
 * Feed `count` Edit events targeting `filePath` to the gate, accumulating state.
 * Returns the state and result from the *last* event only.
 */
function feedFileEditsN(
  gate: StructureGate,
  initialState: SessionState,
  filePath: string,
  count: number,
): { state: SessionState; lastResult: ReturnType<StructureGate['process']>['result'] } {
  let state = initialState
  let lastResult: ReturnType<StructureGate['process']>['result'] = null
  for (let i = 0; i < count; i++) {
    const ev = makeEditEvent(filePath, `v${i}`)
    const out = gate.process(ev, state)
    state = out.nextState
    lastResult = out.result
  }
  return { state, lastResult }
}

/**
 * Build a DetectorConfig where only the file-edit path activates at threshold N
 * (fileEditWarn = N). All other thresholds are set far above N so they don't interfere.
 */
function buildFileEditOnlyConfig(
  sameFileEditThreshold: number,
  historySize?: number,
): DetectorConfig {
  const effectiveHistorySize = historySize ?? sameFileEditThreshold + 20
  return {
    ...DEFAULT_DETECTOR_CONFIG,
    // File-edit detector thresholds under test
    fileEditWarn: sameFileEditThreshold,
    fileEditCrit: sameFileEditThreshold * 3 + 1, // well above warning, won't fire in boundary test
    historySize: effectiveHistorySize,
    // Disable repeat-action and error-loop detectors so they don't interfere
    WARNING: effectiveHistorySize + 100,
    CRITICAL: effectiveHistorySize + 200,
    errLoopWarn: effectiveHistorySize + 100,
    errLoopCrit: effectiveHistorySize + 200,
  }
}

// ─── Parameterized boundary tests ───────────────────────────────────────────

describe('StructureGate — Sub-AC 6c-3: sameFileEditThreshold (fileEditWarn) boundary (parameterized)', () => {
  /**
   * Test cases: each entry is [N, description].
   * For each N we verify: N-1 edit events on same file → null, N edit events → flag.
   * N must not be hardcoded inside the detector — only via DetectorConfig.fileEditWarn.
   */
  const fileEditThresholdCases: [number, string][] = [
    [2, 'N=2  (minimal threshold)'],
    [3, 'N=3  (small threshold)'],
    [4, 'N=4  (below default fileEditWarn)'],
    [5, 'N=5  (default fileEditWarn value)'],
    [6, 'N=6  (above default)'],
    [8, 'N=8  (default fileEditCrit value)'],
    [10, 'N=10 (larger threshold)'],
  ]

  test.each(fileEditThresholdCases)(
    'fileEditWarn=%i (%s): N-1 same-file edits → null, N same-file edits → file_edit_loop warning',
    (N, _label) => {
      const config = buildFileEditOnlyConfig(N)
      const gate = new StructureGate(config)
      const initialState = createSessionState('sess-6c3', 'root', config.historySize)

      // Use a unique file path per N to avoid cross-test leakage
      const filePath = `/project/src/module-${N}.ts`

      // ── Phase 1: feed N-1 edit events → must NOT trigger ──────────────
      const phase1 = feedFileEditsN(gate, initialState, filePath, N - 1)

      expect(phase1.lastResult).toBeNull()

      // ── Phase 2: feed 1 more (total N) → must trigger warning ─────────
      const phase2Event = makeEditEvent(filePath, `final`)
      const phase2 = gate.process(phase2Event, phase1.state)

      expect(phase2.result).not.toBeNull()
      expect(phase2.result?.type).toBe('thrashing')
      expect(phase2.result?.subtype).toBe('file_edit_loop')
      expect(phase2.result?.severity).toBe('warning')
      expect(phase2.result?.sessionId).toBe('sess-6c3')
      expect(phase2.result?.metrics['fileEditN']).toBe(N)
    },
  )

  /**
   * Explicitly assert that fileEditWarn is the exact flip point.
   * N-1 → null, N → warning, N+1 → still a flag.
   */
  test('boundary flip is exact: N-1 → null, N → warning, N+1 → still a flag', () => {
    const N = 4
    const config = buildFileEditOnlyConfig(N)
    const gate = new StructureGate(config)
    const filePath = '/project/src/exact-boundary.ts'

    // ── N-1 → no flag ───────────────────────────────────────────────────
    let state = createSessionState('sess-6c3-exact', 'root', config.historySize)
    const r1 = feedFileEditsN(gate, state, filePath, N - 1)
    expect(r1.lastResult).toBeNull()
    state = r1.state

    // ── N → warning ────────────────────────────────────────────────────
    const evN = makeEditEvent(filePath, 'nth')
    const r2 = gate.process(evN, state)
    expect(r2.result).not.toBeNull()
    expect(r2.result?.subtype).toBe('file_edit_loop')
    expect(r2.result?.severity).toBe('warning')
    expect(r2.result?.metrics['fileEditN']).toBe(N)
    state = r2.nextState

    // ── N+1 → still a result (warning or critical, not null) ───────────
    const evNPlus1 = makeEditEvent(filePath, 'nth-plus-one')
    const r3 = gate.process(evNPlus1, state)
    expect(r3.result).not.toBeNull()
    expect(['warning', 'critical']).toContain(r3.result?.severity)
    expect(r3.result?.subtype).toBe('file_edit_loop')
  })

  /**
   * fileEditCrit boundary: feeding fileEditCrit edit events escalates to critical.
   */
  test('fileEditCrit boundary: N_crit same-file edits escalate to critical severity', () => {
    const N_warn = 3
    const N_crit = 6
    const config: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      fileEditWarn: N_warn,
      fileEditCrit: N_crit,
      historySize: N_crit + 10,
      WARNING: N_crit + 100,
      CRITICAL: N_crit + 200,
      errLoopWarn: N_crit + 100,
      errLoopCrit: N_crit + 200,
    }
    const gate = new StructureGate(config)
    const filePath = '/project/src/escalation.ts'

    // Feed N_warn - 1 → null
    let state = createSessionState('sess-6c3-crit', 'root', config.historySize)
    const r1 = feedFileEditsN(gate, state, filePath, N_warn - 1)
    expect(r1.lastResult).toBeNull()
    state = r1.state

    // Feed 1 more (total N_warn) → warning
    const evWarn = makeEditEvent(filePath, 'warn')
    const r2 = gate.process(evWarn, state)
    expect(r2.result?.severity).toBe('warning')
    state = r2.nextState

    // Feed up to N_crit - 1 → still warning
    const r3 = feedFileEditsN(gate, state, filePath, N_crit - N_warn - 1)
    expect(r3.lastResult?.severity).toBe('warning')
    state = r3.state

    // Feed the N_crit-th event → must escalate to critical
    const evCrit = makeEditEvent(filePath, 'crit')
    const r4 = gate.process(evCrit, state)
    expect(r4.result).not.toBeNull()
    expect(r4.result?.subtype).toBe('file_edit_loop')
    expect(r4.result?.severity).toBe('critical')
    expect(r4.result?.metrics['fileEditN']).toBe(N_crit)
  })

  /**
   * Confirm the threshold is read from DetectorConfig, not a hardcoded constant.
   * Two gates with different fileEditWarn values must flip at their own thresholds.
   */
  test('two gates with different fileEditWarn values flip at their own thresholds (not a shared constant)', () => {
    const N_A = 3
    const N_B = 6

    const configA = buildFileEditOnlyConfig(N_A)
    const configB = buildFileEditOnlyConfig(N_B)

    const gateA = new StructureGate(configA)
    const gateB = new StructureGate(configB)

    const filePath = '/project/src/shared-target.ts'

    let stateA = createSessionState('sess-6c3-a', 'root', configA.historySize)
    let stateB = createSessionState('sess-6c3-b', 'root', configB.historySize)

    // Feed N_A - 1 edit events to both — neither should fire
    for (let i = 0; i < N_A - 1; i++) {
      const ev = makeEditEvent(filePath, `shared-${i}`)
      const outA = gateA.process(ev, stateA)
      const outB = gateB.process(ev, stateB)
      stateA = outA.nextState
      stateB = outB.nextState
    }

    // Feed the N_A-th event: gateA must fire, gateB must not
    const evAtNA = makeEditEvent(filePath, `at-na`)
    const outA_atNA = gateA.process(evAtNA, stateA)
    const outB_atNA = gateB.process(evAtNA, stateB)
    stateA = outA_atNA.nextState
    stateB = outB_atNA.nextState

    // gateA (fileEditWarn=N_A) fires at edit #N_A
    expect(outA_atNA.result).not.toBeNull()
    expect(outA_atNA.result?.subtype).toBe('file_edit_loop')
    expect(outA_atNA.result?.severity).toBe('warning')
    expect(outA_atNA.result?.metrics['fileEditN']).toBe(N_A)

    // gateB (fileEditWarn=N_B) must NOT fire yet (only N_A edits so far < N_B)
    expect(outB_atNA.result).toBeNull()

    // Feed more edits to reach N_B for gateB (already have N_A, need N_B - N_A more)
    for (let i = 0; i < N_B - N_A - 1; i++) {
      const ev = makeEditEvent(filePath, `extra-${i}`)
      const outB = gateB.process(ev, stateB)
      stateB = outB.nextState
    }

    // Feed the N_B-th event: gateB must fire
    const evAtNB = makeEditEvent(filePath, `at-nb`)
    const outB_atNB = gateB.process(evAtNB, stateB)

    expect(outB_atNB.result).not.toBeNull()
    expect(outB_atNB.result?.subtype).toBe('file_edit_loop')
    expect(outB_atNB.result?.severity).toBe('warning')
    expect(outB_atNB.result?.metrics['fileEditN']).toBe(N_B)
  })

  /**
   * Verify that changing only fileEditWarn moves the flip point; other fields unchanged.
   * Two configs identical except fileEditWarn must behave differently.
   */
  test('changing only fileEditWarn moves the flip point; unrelated fields do not affect it', () => {
    const filePath = '/project/src/config-sensitivity.ts'

    const configEarly = buildFileEditOnlyConfig(3) // fires at 3rd edit
    const configLate = buildFileEditOnlyConfig(6)  // fires at 6th edit

    const gateEarly = new StructureGate(configEarly)
    const gateLate = new StructureGate(configLate)

    let stateEarly = createSessionState('sess-6c3-early', 'root', configEarly.historySize)
    let stateLate = createSessionState('sess-6c3-late', 'root', configLate.historySize)

    // Feed 2 edit events — neither should fire (both thresholds > 2)
    for (let i = 0; i < 2; i++) {
      const ev = makeEditEvent(filePath, `initial-${i}`)
      const outE = gateEarly.process(ev, stateEarly)
      const outL = gateLate.process(ev, stateLate)
      stateEarly = outE.nextState
      stateLate = outL.nextState
    }

    // 3rd edit: configEarly fires, configLate does not
    const ev3 = makeEditEvent(filePath, 'third')
    const out3E = gateEarly.process(ev3, stateEarly)
    const out3L = gateLate.process(ev3, stateLate)
    stateEarly = out3E.nextState
    stateLate = out3L.nextState

    expect(out3E.result).not.toBeNull()           // fileEditWarn=3 fired
    expect(out3E.result?.subtype).toBe('file_edit_loop')
    expect(out3L.result).toBeNull()                // fileEditWarn=6 not fired yet

    // Feed 2 more events to reach 5 total for configLate (already at 3)
    for (let i = 0; i < 2; i++) {
      const ev = makeEditEvent(filePath, `mid-${i}`)
      const outL = gateLate.process(ev, stateLate)
      stateLate = outL.nextState
    }

    // 6th edit: configLate fires
    const ev6 = makeEditEvent(filePath, 'sixth')
    const out6L = gateLate.process(ev6, stateLate)

    expect(out6L.result).not.toBeNull()           // fileEditWarn=6 fires
    expect(out6L.result?.subtype).toBe('file_edit_loop')
    expect(out6L.result?.severity).toBe('warning')
    expect(out6L.result?.metrics['fileEditN']).toBe(6)
  })

  /**
   * Verify that edits targeting DIFFERENT file paths do NOT accumulate together —
   * fileEditN is per-file, not global.
   */
  test('edits to different file paths are counted independently (per-file accumulation)', () => {
    const N = 3
    const config = buildFileEditOnlyConfig(N)
    const gate = new StructureGate(config)

    let state = createSessionState('sess-6c3-paths', 'root', config.historySize)

    const fileA = '/project/src/alpha.ts'
    const fileB = '/project/src/beta.ts'

    // Feed N-1 edits for fileA and N-1 edits for fileB (interleaved)
    for (let i = 0; i < N - 1; i++) {
      const evA = makeEditEvent(fileA, `a-${i}`)
      const outA = gate.process(evA, state)
      state = outA.nextState

      const evB = makeEditEvent(fileB, `b-${i}`)
      const outB = gate.process(evB, state)
      state = outB.nextState
    }

    // After N-1 edits to each file, neither should have triggered (counted separately)
    // Feed one more for fileA (total N=3 for fileA) → must trigger
    const evAFinal = makeEditEvent(fileA, 'a-final')
    const outAFinal = gate.process(evAFinal, state)

    expect(outAFinal.result).not.toBeNull()
    expect(outAFinal.result?.subtype).toBe('file_edit_loop')
    expect(outAFinal.result?.metrics['fileEditN']).toBe(N)
    state = outAFinal.nextState

    // fileB should still be at N-1 edits — confirm a fresh file also needs N edits
    const fileC = '/project/src/gamma.ts'
    const rC = feedFileEditsN(gate, state, fileC, N - 1)
    expect(rC.lastResult?.subtype ?? null).not.toBe('file_edit_loop')
  })
})

// ─── Window-boundary test: historySize limits fileEditN ──────────────────────

describe('StructureGate — Sub-AC 6c-3: historySize window evicts old edit events', () => {
  test('edit events older than historySize are evicted and do not contribute to fileEditN', () => {
    const N = 3        // fileEditWarn threshold
    const H = N + 1   // historySize just slightly larger than N

    const config = buildFileEditOnlyConfig(N, H)
    const gate = new StructureGate(config)
    let state = createSessionState('sess-6c3-window', 'root', config.historySize)

    const fileA = '/project/src/window-test.ts'
    const fileB = '/project/src/filler.ts'

    // Feed N edit events for fileA — triggers at count N
    const phaseA1 = feedFileEditsN(gate, state, fileA, N)
    expect(phaseA1.lastResult).not.toBeNull()
    expect(phaseA1.lastResult?.subtype).toBe('file_edit_loop')
    expect(phaseA1.lastResult?.metrics['fileEditN']).toBe(N)
    state = phaseA1.state

    // Feed H*2 filler edits for fileB to evict all fileA entries from window
    const phaseB = feedFileEditsN(gate, state, fileB, H * 2)
    state = phaseB.state

    // Feed N-1 edit events for fileA again — should be below threshold (window is fresh)
    const phaseA2 = feedFileEditsN(gate, state, fileA, N - 1)
    expect(phaseA2.lastResult?.subtype ?? null).not.toBe('file_edit_loop')
    state = phaseA2.state

    // Feed 1 more fileA edit → should trigger at the new N-th occurrence
    const evLast = makeEditEvent(fileA, 'after-eviction')
    const phaseA3 = gate.process(evLast, state)
    expect(phaseA3.result).not.toBeNull()
    expect(phaseA3.result?.subtype).toBe('file_edit_loop')
    expect(phaseA3.result?.metrics['fileEditN']).toBe(N)
  })
})

// ─── Jaccard suppression guard ────────────────────────────────────────────────

describe('StructureGate — Sub-AC 6c-3: Jaccard suppression does not affect same-region edits', () => {
  test('edits with similar old/new content (Jaccard >= 0.1) are counted and trigger at N', () => {
    const N = 3
    const config = buildFileEditOnlyConfig(N)
    const gate = new StructureGate(config)
    const filePath = '/project/src/jaccard-check.ts'

    // All edits share very similar content (same function body with minor tweaks)
    // This ensures Jaccard >= 0.1 and the detector does NOT suppress
    let state = createSessionState('sess-6c3-jaccard', 'root', config.historySize)
    const phase1 = feedFileEditsN(gate, state, filePath, N - 1)
    expect(phase1.lastResult).toBeNull()
    state = phase1.state

    const evN = makeEditEvent(filePath, 'similar-final')
    const result = gate.process(evN, state)
    expect(result.result).not.toBeNull()
    expect(result.result?.subtype).toBe('file_edit_loop')
    expect(result.result?.metrics['fileEditN']).toBe(N)
  })
})
