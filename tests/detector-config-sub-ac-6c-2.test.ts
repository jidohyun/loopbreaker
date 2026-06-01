/**
 * tests/detector-config-sub-ac-6c-2.test.ts
 *
 * Sub-AC 6c-2: Parameterized test for `sameErrorThreshold` (DetectorConfig.errLoopWarn /
 * errLoopCrit).
 *
 * Spec:
 *   - Construct a DetectorConfig with a specific `sameErrorThreshold` value N.
 *   - Feed exactly N-1 events sharing the same (tool, argKey) pair AND resultClass='error'
 *     → expect NO flag (result is null).
 *   - Feed exactly N such events → expect flag (StructureGateResult with subtype='repeat_error').
 *   - Assert the gate outcome flips at precisely that boundary with no hardcoded constant
 *     in the same-error-convergence detector function.
 *   - All thresholds are read exclusively from DetectorConfig (SPEC §4 1b, §1 constraint:
 *     코드 상수 금지).
 *
 * Relationship to Sub-AC 6c-1:
 *   6c-1 tested the repeat-action (tool,argKey) path driven by DetectorConfig.WARNING.
 *   6c-2 tests the same-error-convergence path driven by DetectorConfig.errLoopWarn /
 *   errLoopCrit independently, with resultClass='error' events.
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
 * Build a minimal tool_use NormalizedEvent with resultClass='error'.
 * The same commandLabel produces the same argKey (same Bash fingerprint).
 */
function makeErrorEvent(
  commandLabel: string,
  sessionId = 'sess-6c2',
): NormalizedEvent {
  _seq++
  return {
    uuid: `uuid-6c2-${_seq}`,
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
    resultClass: 'error',
  }
}

/**
 * Feed `count` identical error events to the gate, accumulating state.
 * Returns the state and result from the *last* event only.
 */
function feedErrorN(
  gate: StructureGate,
  initialState: SessionState,
  command: string,
  count: number,
): { state: SessionState; lastResult: ReturnType<StructureGate['process']>['result'] } {
  let state = initialState
  let lastResult: ReturnType<StructureGate['process']>['result'] = null
  for (let i = 0; i < count; i++) {
    const ev = makeErrorEvent(command)
    const out = gate.process(ev, state)
    state = out.nextState
    lastResult = out.result
  }
  return { state, lastResult }
}

/**
 * Build a DetectorConfig where only the error-loop path activates at threshold N.
 *
 * Strategy:
 *   - errLoopWarn = N  (the threshold under test)
 *   - errLoopCrit = N * 3  (well above N, won't fire in boundary test)
 *   - WARNING / CRITICAL set far above N so the repeat-action path doesn't interfere
 *   - fileEditWarn / fileEditCrit far above N so file-edit path doesn't interfere
 *   - historySize large enough to hold all events
 */
function buildErrorOnlyConfig(
  sameErrorThreshold: number,
  historySize?: number,
): DetectorConfig {
  const effectiveHistorySize = historySize ?? sameErrorThreshold + 20
  return {
    ...DEFAULT_DETECTOR_CONFIG,
    // Error-loop detector thresholds under test
    errLoopWarn: sameErrorThreshold,
    errLoopCrit: sameErrorThreshold * 3 + 1,   // well above warning, won't fire in boundary test
    historySize: effectiveHistorySize,
    // Disable repeat-action and file-edit detectors so they don't interfere
    WARNING: effectiveHistorySize + 100,
    CRITICAL: effectiveHistorySize + 200,
    fileEditWarn: effectiveHistorySize + 100,
    fileEditCrit: effectiveHistorySize + 200,
  }
}

// ─── Parameterized boundary tests ───────────────────────────────────────────

describe('StructureGate — Sub-AC 6c-2: sameErrorThreshold (errLoopWarn) boundary (parameterized)', () => {
  /**
   * Test cases: each entry is [N, description].
   * For each N we verify: N-1 error events → null, N error events → flag.
   * N must not be hardcoded inside the detector — only via DetectorConfig.errLoopWarn.
   */
  const errorThresholdCases: [number, string][] = [
    [2, 'N=2  (minimal threshold)'],
    [3, 'N=3  (default errLoopWarn value)'],
    [4, 'N=4  (above default)'],
    [5, 'N=5  (default errLoopCrit value)'],
    [7, 'N=7  (medium threshold)'],
    [10, 'N=10 (larger threshold)'],
  ]

  test.each(errorThresholdCases)(
    'errLoopWarn=%i (%s): N-1 error triples → null, N error triples → repeat_error warning',
    (N, _label) => {
      const config = buildErrorOnlyConfig(N)
      const gate = new StructureGate(config)
      const initialState = createSessionState('sess-6c2', 'root', config.historySize)

      // Use a unique command per N to prevent cross-test leakage
      const command = `npm test --threshold-${N}`

      // ── Phase 1: feed N-1 error events → must NOT trigger ──────────────
      const phase1 = feedErrorN(gate, initialState, command, N - 1)

      expect(phase1.lastResult).toBeNull()

      // ── Phase 2: feed 1 more (total N) → must trigger warning ──────────
      const phase2Event = makeErrorEvent(command)
      const phase2 = gate.process(phase2Event, phase1.state)

      expect(phase2.result).not.toBeNull()
      expect(phase2.result?.type).toBe('thrashing')
      expect(phase2.result?.subtype).toBe('repeat_error')
      expect(phase2.result?.severity).toBe('warning')
      expect(phase2.result?.sessionId).toBe('sess-6c2')
      expect(phase2.result?.metrics['errLoopN']).toBe(N)
    },
  )

  /**
   * Explicitly assert that errLoopWarn is the exact flip point.
   * N-1 → null, N → flag, N+1 → still flag.
   */
  test('boundary flip is exact: N-1 → null, N → warning, N+1 → still a flag', () => {
    const N = 4
    const config = buildErrorOnlyConfig(N)
    const gate = new StructureGate(config)
    const command = 'tsc --noEmit'

    // ── N-1 → no flag ───────────────────────────────────────────────────
    let state = createSessionState('sess-6c2-exact', 'root', config.historySize)
    const r1 = feedErrorN(gate, state, command, N - 1)
    expect(r1.lastResult).toBeNull()
    state = r1.state

    // ── N → warning ────────────────────────────────────────────────────
    const evN = makeErrorEvent(command)
    const r2 = gate.process(evN, state)
    expect(r2.result).not.toBeNull()
    expect(r2.result?.subtype).toBe('repeat_error')
    expect(r2.result?.severity).toBe('warning')
    expect(r2.result?.metrics['errLoopN']).toBe(N)
    state = r2.nextState

    // ── N+1 → still a result (warning or critical, not null) ───────────
    const evNPlus1 = makeErrorEvent(command)
    const r3 = gate.process(evNPlus1, state)
    expect(r3.result).not.toBeNull()
    expect(['warning', 'critical']).toContain(r3.result?.severity)
    expect(r3.result?.subtype).toBe('repeat_error')
  })

  /**
   * errLoopCrit boundary: feeding errLoopCrit error events escalates to critical.
   */
  test('errLoopCrit boundary: N_crit error events escalate to critical severity', () => {
    const N_warn = 3
    const N_crit = 6
    const config: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      errLoopWarn: N_warn,
      errLoopCrit: N_crit,
      historySize: N_crit + 10,
      WARNING: N_crit + 100,
      CRITICAL: N_crit + 200,
      fileEditWarn: N_crit + 100,
      fileEditCrit: N_crit + 200,
    }
    const gate = new StructureGate(config)
    const command = 'jest --coverage'

    // Feed N_warn - 1 → null
    let state = createSessionState('sess-6c2-crit', 'root', config.historySize)
    const r1 = feedErrorN(gate, state, command, N_warn - 1)
    expect(r1.lastResult).toBeNull()
    state = r1.state

    // Feed 1 more (total N_warn) → warning
    const evWarn = makeErrorEvent(command)
    const r2 = gate.process(evWarn, state)
    expect(r2.result?.severity).toBe('warning')
    state = r2.nextState

    // Feed up to N_crit - 1 → still warning
    const r3 = feedErrorN(gate, state, command, N_crit - N_warn - 1)
    expect(r3.lastResult?.severity).toBe('warning')
    state = r3.state

    // Feed the N_crit-th event → must escalate to critical
    const evCrit = makeErrorEvent(command)
    const r4 = gate.process(evCrit, state)
    expect(r4.result).not.toBeNull()
    expect(r4.result?.subtype).toBe('repeat_error')
    expect(r4.result?.severity).toBe('critical')
    expect(r4.result?.metrics['errLoopN']).toBe(N_crit)
  })

  /**
   * Confirm the threshold is read from DetectorConfig, not a hardcoded constant.
   * Two gates with different errLoopWarn values must flip at their own thresholds.
   */
  test('two gates with different errLoopWarn values flip at their own thresholds (not a shared constant)', () => {
    const N_A = 2
    const N_B = 5

    const configA = buildErrorOnlyConfig(N_A)
    const configB = buildErrorOnlyConfig(N_B)

    const gateA = new StructureGate(configA)
    const gateB = new StructureGate(configB)

    const command = 'make build'

    let stateA = createSessionState('sess-6c2-a', 'root', configA.historySize)
    let stateB = createSessionState('sess-6c2-b', 'root', configB.historySize)

    // Feed N_A - 1 = 1 error events to both
    for (let i = 0; i < N_A - 1; i++) {
      const ev = makeErrorEvent(command)
      const outA = gateA.process(ev, stateA)
      const outB = gateB.process(ev, stateB)
      stateA = outA.nextState
      stateB = outB.nextState
    }

    // Feed the N_A-th event → gateA must fire, gateB must not
    const evAtNA = makeErrorEvent(command)
    const outA_atNA = gateA.process(evAtNA, stateA)
    const outB_atNA = gateB.process(evAtNA, stateB)
    stateA = outA_atNA.nextState
    stateB = outB_atNA.nextState

    // gateA (errLoopWarn=N_A) fires at event #N_A
    expect(outA_atNA.result).not.toBeNull()
    expect(outA_atNA.result?.subtype).toBe('repeat_error')
    expect(outA_atNA.result?.severity).toBe('warning')
    expect(outA_atNA.result?.metrics['errLoopN']).toBe(N_A)

    // gateB (errLoopWarn=N_B) must NOT fire yet (only N_A events so far < N_B)
    expect(outB_atNA.result).toBeNull()

    // Feed more to reach N_B for gateB (already have N_A events, need N_B - N_A more)
    for (let i = 0; i < N_B - N_A - 1; i++) {
      const ev = makeErrorEvent(command)
      const outB = gateB.process(ev, stateB)
      stateB = outB.nextState
    }

    // Feed the N_B-th event → gateB must fire
    const evAtNB = makeErrorEvent(command)
    const outB_atNB = gateB.process(evAtNB, stateB)

    expect(outB_atNB.result).not.toBeNull()
    expect(outB_atNB.result?.subtype).toBe('repeat_error')
    expect(outB_atNB.result?.severity).toBe('warning')
    expect(outB_atNB.result?.metrics['errLoopN']).toBe(N_B)
  })

  /**
   * Verify that ok-resultClass events with the same (tool, argKey) do NOT
   * contribute to errLoopN — only error events are counted.
   */
  test('ok-resultClass events do not contribute to errLoopN; only error events trigger repeat_error', () => {
    const N = 3
    const config = buildErrorOnlyConfig(N)
    const gate = new StructureGate(config)
    const command = 'cargo build'

    let state = createSessionState('sess-6c2-ok', 'root', config.historySize)

    // Feed N ok-resultClass events with the same command
    for (let i = 0; i < N; i++) {
      const ev: NormalizedEvent = {
        uuid: `uuid-ok-${_seq++}`,
        parentUuid: null,
        sessionId: 'sess-6c2-ok',
        cwd: '/project',
        agentScope: 'root',
        isSidechain: false,
        ts: 1_700_000_000_000 + _seq,
        byteOffset: _seq * 100,
        kind: 'tool_use',
        tool: 'Bash',
        input: { command },
        resultClass: 'ok',
      }
      const out = gate.process(ev, state)
      // ok events must NOT trigger repeat_error
      expect(out.result?.subtype ?? null).not.toBe('repeat_error')
      state = out.nextState
    }

    // Now feed N error events — these should trigger at the N-th one
    const r = feedErrorN(gate, state, command, N - 1)
    expect(r.lastResult).toBeNull()  // N-1 error events (count within window for errors)
    state = r.state

    const evFinal = makeErrorEvent(command)
    const finalOut = gate.process(evFinal, state)
    expect(finalOut.result).not.toBeNull()
    expect(finalOut.result?.subtype).toBe('repeat_error')
    expect(finalOut.result?.metrics['errLoopN']).toBe(N)
  })

  /**
   * Verify that changing only errLoopWarn moves the flip point.
   * Two configs identical in all fields except errLoopWarn behave differently.
   */
  test('changing only errLoopWarn moves the flip point; unrelated fields do not affect it', () => {
    const command = 'python -m pytest'

    const configEarly = buildErrorOnlyConfig(3)   // fires at 3rd error
    const configLate = buildErrorOnlyConfig(6)    // fires at 6th error

    const gateEarly = new StructureGate(configEarly)
    const gateLate = new StructureGate(configLate)

    let stateEarly = createSessionState('sess-6c2-early', 'root', configEarly.historySize)
    let stateLate = createSessionState('sess-6c2-late', 'root', configLate.historySize)

    // Feed 2 error events — neither should fire (both thresholds > 2)
    for (let i = 0; i < 2; i++) {
      const ev = makeErrorEvent(command)
      const outE = gateEarly.process(ev, stateEarly)
      const outL = gateLate.process(ev, stateLate)
      stateEarly = outE.nextState
      stateLate = outL.nextState
    }

    // 3rd error event: configEarly fires, configLate does not
    const ev3 = makeErrorEvent(command)
    const out3E = gateEarly.process(ev3, stateEarly)
    const out3L = gateLate.process(ev3, stateLate)
    stateEarly = out3E.nextState
    stateLate = out3L.nextState

    expect(out3E.result).not.toBeNull()          // errLoopWarn=3 fired
    expect(out3E.result?.subtype).toBe('repeat_error')
    expect(out3L.result).toBeNull()               // errLoopWarn=6 not fired yet

    // Feed 3 more events to reach 6 total for configLate (already at 3)
    for (let i = 0; i < 2; i++) {
      const ev = makeErrorEvent(command)
      const outL = gateLate.process(ev, stateLate)
      stateLate = outL.nextState
    }

    // 6th error event: configLate fires
    const ev6 = makeErrorEvent(command)
    const out6L = gateLate.process(ev6, stateLate)

    expect(out6L.result).not.toBeNull()          // errLoopWarn=6 fires
    expect(out6L.result?.subtype).toBe('repeat_error')
    expect(out6L.result?.severity).toBe('warning')
    expect(out6L.result?.metrics['errLoopN']).toBe(6)
  })

  /**
   * Verify that error events for DIFFERENT (tool, argKey) pairs do NOT
   * accumulate together — errLoopN is per-pair, not global.
   */
  test('error events for different argKey pairs are counted independently (per-pair accumulation)', () => {
    const N = 3
    const config = buildErrorOnlyConfig(N)
    const gate = new StructureGate(config)

    let state = createSessionState('sess-6c2-pairs', 'root', config.historySize)

    const commandA = 'go build ./...'
    const commandB = 'go test ./...'

    // Feed N-1 errors for commandA and N-1 errors for commandB (interleaved)
    for (let i = 0; i < N - 1; i++) {
      const evA = makeErrorEvent(commandA)
      const outA = gate.process(evA, state)
      // Should not trigger (different pairs counted separately)
      state = outA.nextState

      const evB = makeErrorEvent(commandB)
      const outB = gate.process(evB, state)
      state = outB.nextState
    }

    // After N-1 errors for each pair, neither should have triggered
    // (N-1 = 2 errors each, threshold = 3)
    // Feed one more for commandA (total N=3 for commandA)
    const evAFinal = makeErrorEvent(commandA)
    const outAFinal = gate.process(evAFinal, state)

    expect(outAFinal.result).not.toBeNull()
    expect(outAFinal.result?.subtype).toBe('repeat_error')
    expect(outAFinal.result?.metrics['errLoopN']).toBe(N)
    state = outAFinal.nextState

    // CommandB should still be at N-1 errors and not trigger
    // (reset test: commandC fresh pair should also need N errors before triggering)
    const commandC = 'docker compose up'
    const rC = feedErrorN(gate, state, commandC, N - 1)
    expect(rC.lastResult).toBeNull()
  })
})

// ─── Window-boundary test: historySize limits errLoopN ───────────────────────

describe('StructureGate — Sub-AC 6c-2: historySize window evicts old error events', () => {
  test('error events older than historySize are evicted and do not contribute to errLoopN', () => {
    const N = 3        // errLoopWarn threshold
    const H = N + 1   // historySize just slightly larger than N

    const config = buildErrorOnlyConfig(N, H)
    const gate = new StructureGate(config)
    let state = createSessionState('sess-6c2-window', 'root', config.historySize)

    const cmdA = 'curl -f http://localhost'
    const cmdB = 'ping -c 1 example.com'

    // Feed N error events for cmdA — triggers at count N
    const phaseA1 = feedErrorN(gate, state, cmdA, N)
    expect(phaseA1.lastResult).not.toBeNull()
    expect(phaseA1.lastResult?.subtype).toBe('repeat_error')
    expect(phaseA1.lastResult?.metrics['errLoopN']).toBe(N)
    state = phaseA1.state

    // Feed H*2 filler events for cmdB to evict all cmdA entries from the window
    const phaseB = feedErrorN(gate, state, cmdB, H * 2)
    state = phaseB.state

    // Feed N-1 error events for cmdA again — should be below threshold (window is fresh)
    const phaseA2 = feedErrorN(gate, state, cmdA, N - 1)
    expect(phaseA2.lastResult).toBeNull()
    state = phaseA2.state

    // Feed 1 more cmdA error → should trigger at the new N-th occurrence
    const evLast = makeErrorEvent(cmdA)
    const phaseA3 = gate.process(evLast, state)
    expect(phaseA3.result).not.toBeNull()
    expect(phaseA3.result?.subtype).toBe('repeat_error')
    expect(phaseA3.result?.metrics['errLoopN']).toBe(N)
  })
})
