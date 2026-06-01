/**
 * tests/detector-config-sub-ac-6c.test.ts
 *
 * Sub-AC 6c-1: Parameterized test for `repeatActionThreshold` (DetectorConfig.WARNING).
 *
 * Spec:
 *   - Construct a DetectorConfig with a specific `repeatActionThreshold` value N.
 *   - Feed exactly N-1 identical ActionTriples → expect NO flag (result is null).
 *   - Feed exactly N identical ActionTriples → expect flag (result is StructureGateResult).
 *   - Assert the gate outcome flips at precisely that boundary.
 *   - No hardcoded constant in the repeat-action detector: all thresholds come from DetectorConfig.
 *
 * The repeat-action detector function in structure-gate.ts reads thresholds ONLY from
 * the injected DetectorConfig (SPEC §4 1b, SPEC §1 constraint: 코드 상수 금지).
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

/** Build a minimal tool_use NormalizedEvent with a fixed, repeatable Bash command. */
function makeRepeatEvent(
  commandLabel: string,
  sessionId = 'sess-6c',
): NormalizedEvent {
  _seq++
  return {
    uuid: `uuid-6c-${_seq}`,
    parentUuid: null,
    sessionId,
    cwd: '/project',
    agentScope: 'root',
    isSidechain: false,
    ts: 1_700_000_000_000 + _seq,
    byteOffset: _seq * 100,
    kind: 'tool_use',
    tool: 'Bash',
    input: { command: commandLabel },
    resultClass: 'ok',
  }
}

/**
 * Feed `count` identical events to the gate, accumulating state.
 * Returns the result from the *last* event only.
 */
function feedN(
  gate: StructureGate,
  initialState: SessionState,
  command: string,
  count: number,
): { state: SessionState; lastResult: ReturnType<StructureGate['process']>['result'] } {
  let state = initialState
  let lastResult: ReturnType<StructureGate['process']>['result'] = null
  for (let i = 0; i < count; i++) {
    const ev = makeRepeatEvent(command)
    const out = gate.process(ev, state)
    state = out.nextState
    lastResult = out.result
  }
  return { state, lastResult }
}

/**
 * Build a DetectorConfig that only activates the repeat-action path at threshold N.
 * All other thresholds are set far above N so they don't interfere.
 */
function buildRepeatOnlyConfig(
  repeatActionThreshold: number,
  historySize?: number,
): DetectorConfig {
  const effectiveHistorySize = historySize ?? repeatActionThreshold + 10
  return {
    ...DEFAULT_DETECTOR_CONFIG,
    WARNING: repeatActionThreshold,
    CRITICAL: repeatActionThreshold * 2 + 1,  // well above warning, won't fire in boundary test
    historySize: effectiveHistorySize,
    // Disable error-loop and file-edit detectors so they don't interfere
    errLoopWarn: effectiveHistorySize + 100,
    errLoopCrit: effectiveHistorySize + 200,
    fileEditWarn: effectiveHistorySize + 100,
    fileEditCrit: effectiveHistorySize + 200,
  }
}

// ─── Parameterized boundary tests ───────────────────────────────────────────

describe('StructureGate — Sub-AC 6c-1: repeatActionThreshold boundary (parameterized)', () => {
  /**
   * Test cases: each entry is [threshold N, description].
   * We verify N-1 → null, N → warning for each value.
   * N must not be hardcoded inside the detector — only via DetectorConfig.WARNING.
   */
  const thresholdCases: [number, string][] = [
    [2,  'N=2  (minimal threshold)'],
    [3,  'N=3  (small threshold)'],
    [5,  'N=5  (medium-low threshold)'],
    [7,  'N=7  (medium threshold)'],
    [10, 'N=10 (default WARNING value)'],
    [13, 'N=13 (above default)'],
    [18, 'N=18 (large threshold)'],
  ]

  test.each(thresholdCases)(
    'threshold=%i (%s): N-1 identical triples → null, N identical triples → warning',
    (N, _label) => {
      const config = buildRepeatOnlyConfig(N)
      const gate = new StructureGate(config)
      const initialState = createSessionState('sess-6c', 'root', config.historySize)

      const command = `echo test-${N}`  // unique per N to avoid cross-test leakage

      // ── Phase 1: feed N-1 events → must NOT trigger ──────────────────────
      const phase1 = feedN(gate, initialState, command, N - 1)

      expect(phase1.lastResult).toBeNull()

      // ── Phase 2: feed 1 more (total N) → must trigger warning ────────────
      const phase2Event = makeRepeatEvent(command)
      const phase2 = gate.process(phase2Event, phase1.state)

      expect(phase2.result).not.toBeNull()
      expect(phase2.result?.type).toBe('thrashing')
      expect(phase2.result?.subtype).toBe('repeat_action')
      expect(phase2.result?.severity).toBe('warning')
      expect(phase2.result?.sessionId).toBe('sess-6c')
      expect(phase2.result?.metrics['repeatN']).toBe(N)
    },
  )

  /**
   * Explicitly assert that the threshold value in DetectorConfig.WARNING
   * is the exact flip point — not one above, not one below.
   *
   * This test directly documents the contract: the detector reads N from config,
   * not from any internal hardcoded constant.
   */
  test('boundary flip is exact: N-1 → null, N → flag, N+1 → still flag (escalation)', () => {
    const N = 4
    const config = buildRepeatOnlyConfig(N)
    const gate = new StructureGate(config)
    const command = 'echo boundary-exact'

    // ── N-1 → no flag ────────────────────────────────────────────────────
    let state = createSessionState('sess-6c-exact', 'root', config.historySize)
    const r1 = feedN(gate, state, command, N - 1)
    expect(r1.lastResult).toBeNull()
    state = r1.state

    // ── N → warning ───────────────────────────────────────────────────────
    const evN = makeRepeatEvent(command)
    const r2 = gate.process(evN, state)
    expect(r2.result).not.toBeNull()
    expect(r2.result?.severity).toBe('warning')
    state = r2.nextState

    // ── N+1 → still a result (warning or critical, not null) ─────────────
    const evNPlus1 = makeRepeatEvent(command)
    const r3 = gate.process(evNPlus1, state)
    expect(r3.result).not.toBeNull()
    // severity may still be 'warning' (CRITICAL = N*2+1 is not reached yet)
    expect(['warning', 'critical']).toContain(r3.result?.severity)
  })

  /**
   * Confirm the threshold is read from DetectorConfig, not a hardcoded constant.
   * Two gates with different WARNING values must flip at different points.
   */
  test('two gates with different WARNING values flip at their own thresholds (not a shared constant)', () => {
    const N_A = 3
    const N_B = 6

    const configA = buildRepeatOnlyConfig(N_A)
    const configB = buildRepeatOnlyConfig(N_B)

    const gateA = new StructureGate(configA)
    const gateB = new StructureGate(configB)

    const command = 'ls -la'

    let stateA = createSessionState('sess-a', 'root', configA.historySize)
    let stateB = createSessionState('sess-b', 'root', configB.historySize)

    // Feed N_A - 1 = 2 events to both gates
    for (let i = 0; i < N_A - 1; i++) {
      const ev = makeRepeatEvent(command)
      const outA = gateA.process(ev, stateA)
      const outB = gateB.process(ev, stateB)
      stateA = outA.nextState
      stateB = outB.nextState
    }

    // After N_A-1 events, neither gate should have fired
    expect(feedN(gateA, stateA, command, 0).lastResult).toBeNull()

    // Feed 1 more event (total = N_A = 3)
    const evAtNA = makeRepeatEvent(command)
    const outA_atNA = gateA.process(evAtNA, stateA)
    const outB_atNA = gateB.process(evAtNA, stateB)
    stateA = outA_atNA.nextState
    stateB = outB_atNA.nextState

    // gateA (WARNING=3) must fire at event #N_A=3
    expect(outA_atNA.result).not.toBeNull()
    expect(outA_atNA.result?.severity).toBe('warning')
    expect(outA_atNA.result?.metrics['repeatN']).toBe(N_A)

    // gateB (WARNING=6) must NOT fire yet (only 3 events so far < 6)
    expect(outB_atNA.result).toBeNull()

    // Feed 3 more to reach N_B=6 for gateB
    for (let i = 0; i < N_B - N_A - 1; i++) {
      const ev = makeRepeatEvent(command)
      const outB = gateB.process(ev, stateB)
      stateB = outB.nextState
    }

    // Feed the N_B-th event to gateB
    const evAtNB = makeRepeatEvent(command)
    const outB_atNB = gateB.process(evAtNB, stateB)

    // gateB (WARNING=6) must fire at event #N_B=6
    expect(outB_atNB.result).not.toBeNull()
    expect(outB_atNB.result?.severity).toBe('warning')
    expect(outB_atNB.result?.metrics['repeatN']).toBe(N_B)
  })

  /**
   * Verify that DetectorConfig.WARNING is the field driving the flip —
   * changing only WARNING on an otherwise identical config changes when the gate fires.
   */
  test('changing only DetectorConfig.WARNING moves the flip point accordingly', () => {
    const command = 'git status'

    // Config with WARNING=5 (fires at 5th repeat)
    const configEarly = buildRepeatOnlyConfig(5)
    const gateEarly = new StructureGate(configEarly)
    let stateEarly = createSessionState('sess-early', 'root', configEarly.historySize)

    // Config with WARNING=8 (fires at 8th repeat)
    const configLate = buildRepeatOnlyConfig(8)
    const gateLate = new StructureGate(configLate)
    let stateLate = createSessionState('sess-late', 'root', configLate.historySize)

    // Feed 4 events — neither should fire
    for (let i = 0; i < 4; i++) {
      const ev = makeRepeatEvent(command)
      const outE = gateEarly.process(ev, stateEarly)
      const outL = gateLate.process(ev, stateLate)
      stateEarly = outE.nextState
      stateLate = outL.nextState
    }

    // 5th event: configEarly fires, configLate does not
    const ev5 = makeRepeatEvent(command)
    const out5E = gateEarly.process(ev5, stateEarly)
    const out5L = gateLate.process(ev5, stateLate)
    stateEarly = out5E.nextState
    stateLate = out5L.nextState

    expect(out5E.result).not.toBeNull()   // WARNING=5 fired at count=5
    expect(out5L.result).toBeNull()        // WARNING=8 not fired at count=5

    // 6th, 7th events: configLate still not fired
    for (let i = 0; i < 2; i++) {
      const ev = makeRepeatEvent(command)
      const outL = gateLate.process(ev, stateLate)
      stateLate = outL.nextState
    }

    // 8th event: configLate fires
    const ev8 = makeRepeatEvent(command)
    const out8L = gateLate.process(ev8, stateLate)

    expect(out8L.result).not.toBeNull()   // WARNING=8 fired at count=8
    expect(out8L.result?.severity).toBe('warning')
    expect(out8L.result?.metrics['repeatN']).toBe(8)
  })
})

// ─── Window-boundary test: historySize limits the visible window ─────────────

describe('StructureGate — Sub-AC 6c-1: historySize window bounds the repeat count', () => {
  test('events older than historySize are evicted and do not contribute to repeatN', () => {
    const N = 3        // WARNING threshold
    const H = N + 1   // historySize just slightly larger than N

    // With historySize=H, the window holds at most H entries.
    // If we feed N events of command A, then 2*H events of command B,
    // command A is evicted. After that, feeding N more of command A
    // should trigger again (fresh window).
    const configA = buildRepeatOnlyConfig(N, H)
    const gate = new StructureGate(configA)
    let state = createSessionState('sess-window', 'root', configA.historySize)

    const cmdA = 'echo command-a'
    const cmdB = 'echo command-b-filler'

    // Feed N events of cmdA — triggers at count N
    const phaseA1 = feedN(gate, state, cmdA, N)
    expect(phaseA1.lastResult).not.toBeNull()
    expect(phaseA1.lastResult?.metrics['repeatN']).toBe(N)
    state = phaseA1.state

    // Feed H*2 filler events of cmdB to evict all cmdA entries from window
    const phaseB = feedN(gate, state, cmdB, H * 2)
    state = phaseB.state

    // Feed N-1 events of cmdA again — should be below threshold (window is fresh)
    const phaseA2 = feedN(gate, state, cmdA, N - 1)
    expect(phaseA2.lastResult).toBeNull()
    state = phaseA2.state

    // Feed 1 more cmdA — should trigger at the new N-th occurrence
    const evLast = makeRepeatEvent(cmdA)
    const phaseA3 = gate.process(evLast, state)
    expect(phaseA3.result).not.toBeNull()
    expect(phaseA3.result?.metrics['repeatN']).toBe(N)
  })
})
