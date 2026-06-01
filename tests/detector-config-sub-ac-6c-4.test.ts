/**
 * tests/detector-config-sub-ac-6c-4.test.ts
 *
 * Sub-AC 6c-4: Parameterized test for `historySize` (sliding window boundary).
 *
 * Spec (exact AC text):
 *   Construct a DetectorConfig with a small `historySize` value W and a threshold T,
 *   feed T events that would trigger detection but spaced so the oldest falls outside
 *   the window (expect no flag), then feed events fully within the window (expect flag),
 *   asserting the window cutoff derives solely from the injected `historySize` with
 *   no hardcoded fallback.
 *
 * Test strategy:
 *   For each (W, T) pair:
 *     Phase A — "oldest outside window":
 *       Feed (W - T + 1) filler events THEN (T - 1) target events.
 *       Window now holds (W entries): only (T - 1) target entries remain (1 oldest target
 *       was pushed out by subsequent filler+target).
 *       Alternatively, simpler: feed T target events then (W - T + 1) fillers to push
 *       the first target out, then check that feeding T-1 fresh targets doesn't trigger.
 *       We use the clearest construction:
 *         1. Feed 1 target event (will be evicted).
 *         2. Feed (W - 1) filler events to fill the rest of the window.
 *            After this, the 1st target is evicted (window size = W, holds W-1 fillers + nothing target).
 *            Wait — the window holds the last W events. After step 2, window = [1 target] + [W-1 fillers].
 *            The 1st target is still in the window. We need to push it out.
 *         Correct construction:
 *         1. Feed 1 target event (sits at position 0).
 *         2. Feed W filler events.  Now window = [filler×W]; the 1 target is evicted.
 *         3. Feed T-1 more target events. Window = [filler×(W-(T-1)), target×(T-1)].
 *            Total targets in window = T-1 < T → NO flag.
 *         4. Feed 1 more target event. Window = [filler×(W-T), target×T] → T targets → FLAG.
 *
 *   Phase A verifies: T events that would normally trigger do NOT trigger because
 *   the oldest one was evicted from the W-sized window.
 *   Phase B verifies: once all T events are within the window, the flag fires.
 *
 *   The test uses ONLY config.historySize (injected W); no test constant replicates
 *   that value independently — the window cutoff is proved to be config-driven.
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

/** Build a tool_use NormalizedEvent for a Bash command (repeatable same argKey). */
function makeBashEvent(
  command: string,
  sessionId = 'sess-6c4',
  resultClass: NormalizedEvent['resultClass'] = 'ok',
): NormalizedEvent {
  _seq++
  return {
    uuid: `uuid-6c4-${_seq}`,
    parentUuid: null,
    sessionId,
    cwd: '/project',
    agentScope: 'root',
    isSidechain: false,
    ts: 1_700_000_000_000 + _seq,
    byteOffset: _seq * 100,
    kind: 'tool_use',
    tool: 'Bash',
    input: { command },
    resultClass,
  }
}

/** Build a distinct filler event that will NOT match the target argKey. */
function makeFillerEvent(idx: number, sessionId = 'sess-6c4'): NormalizedEvent {
  // Unique command per filler so each has a distinct argKey
  return makeBashEvent(`echo filler_unique_command_${idx}_irrelevant`, sessionId, 'ok')
}

/**
 * Build a target event — all targets use the SAME command so they share argKey.
 * This means repeated targets count as "same action repeated" (repeatN).
 */
function makeTargetEvent(sessionId = 'sess-6c4'): NormalizedEvent {
  return makeBashEvent('npm run build --watch', sessionId, 'ok')
}

/**
 * Feed events to the gate, accumulating state.
 * Returns final state and last result.
 */
function feedEvents(
  gate: StructureGate,
  initialState: SessionState,
  events: NormalizedEvent[],
): { state: SessionState; lastResult: ReturnType<StructureGate['process']>['result'] } {
  let state = initialState
  let lastResult: ReturnType<StructureGate['process']>['result'] = null
  for (const ev of events) {
    const out = gate.process(ev, state)
    state = out.nextState
    lastResult = out.result
  }
  return { state, lastResult }
}

/**
 * Build a DetectorConfig where only repeat-action fires at threshold T,
 * with historySize = W.
 *
 * All other detectors (errLoop, fileEdit) are set far above W to avoid interference.
 */
function buildHistorySizeConfig(W: number, T: number): DetectorConfig {
  return {
    ...DEFAULT_DETECTOR_CONFIG,
    historySize: W,
    // repeat-action detector: fires at exactly T repeats
    WARNING: T,
    CRITICAL: T * 3 + 1,   // well above T, won't fire during boundary test
    // errLoop detector: disabled (set far above W so it never fires)
    errLoopWarn: W + 100,
    errLoopCrit: W + 200,
    // fileEdit detector: disabled (set far above W so it never fires)
    fileEditWarn: W + 100,
    fileEditCrit: W + 200,
  }
}

// ─── Parameterized historySize boundary tests ────────────────────────────────

/**
 * Test cases: [W (historySize), T (threshold), description].
 * W > T so T events can fit in the window.
 * We choose W = T + 2 so there's room for fillers.
 */
const cases: [number, number, string][] = [
  [5,  3, 'W=5  T=3 (small window)'],
  [7,  3, 'W=7  T=3'],
  [8,  4, 'W=8  T=4'],
  [10, 5, 'W=10 T=5'],
  [12, 5, 'W=12 T=5 (wider window)'],
  [15, 7, 'W=15 T=7'],
  [6,  4, 'W=6  T=4 (tight window: W = T+2)'],
]

describe('StructureGate — Sub-AC 6c-4: historySize sliding window boundary (parameterized)', () => {
  /**
   * Core AC scenario for each (W, T):
   *
   * Construction:
   *   1. Feed 1 target event  (will later be evicted).
   *   2. Feed W filler events → window now holds [filler×W]; the first target is evicted.
   *   3. Feed T-1 target events → window = [filler×(W-(T-1)), target×(T-1)].
   *      Targets in window = T-1 < T → expect NO flag.
   *   4. Feed 1 more target event → targets in window = T → expect FLAG.
   *
   * This directly tests that the window cutoff comes from config.historySize (= W),
   * not a hardcoded fallback.
   */
  test.each(cases)(
    'historySize=%i threshold=%i (%s): oldest target evicted → no flag; T targets in window → flag',
    (W, T, _label) => {
      const config = buildHistorySizeConfig(W, T)
      const gate = new StructureGate(config)
      const sessionId = `sess-6c4-${W}-${T}`

      // Verify config.historySize is exactly W — no hardcoded override
      expect(gate.getConfig().historySize).toBe(W)
      expect(gate.getConfig().WARNING).toBe(T)

      let state = createSessionState(sessionId, 'root', config.historySize)

      // Step 1: Feed 1 target event (this will be evicted in step 2)
      const { state: stateAfter1 } = feedEvents(gate, state, [makeTargetEvent(sessionId)])
      state = stateAfter1

      // Step 2: Feed W filler events → window = [filler×W], first target evicted
      const fillers = Array.from({ length: W }, (_, i) => makeFillerEvent(i, sessionId))
      const { state: stateAfterFillers } = feedEvents(gate, state, fillers)
      state = stateAfterFillers

      // Step 3: Feed T-1 target events → targets in window = T-1 < T → NO flag expected
      const targetsBeforeThreshold = Array.from({ length: T - 1 }, () => makeTargetEvent(sessionId))
      const phase3 = feedEvents(gate, state, targetsBeforeThreshold)
      state = phase3.state

      // The last result from T-1 targets should not have flagged repeat_action
      // (it might be null, or might have flagged file_edit if any, but repeat_action must not fire)
      const phase3Result = phase3.lastResult
      const isRepeatActionFlagged =
        phase3Result !== null &&
        phase3Result.subtype === 'repeat_action'
      expect(isRepeatActionFlagged).toBe(false)

      // Step 4: Feed 1 more target event → targets in window = T → FLAG expected
      const finalTarget = makeTargetEvent(sessionId)
      const phase4 = gate.process(finalTarget, state)

      expect(phase4.result).not.toBeNull()
      expect(phase4.result?.type).toBe('thrashing')
      expect(phase4.result?.subtype).toBe('repeat_action')
      expect(phase4.result?.severity).toBe('warning')
      expect(phase4.result?.sessionId).toBe(sessionId)
      expect(phase4.result?.metrics['repeatN']).toBe(T)
    },
  )

  /**
   * Exact boundary: verify the window evicts the (W+1)-th oldest event.
   * Use W=5, T=3: feed target, then W fillers (evicts target), then T-1 targets (below threshold),
   * then 1 target → triggers at exactly T.
   */
  test('exact boundary: window of size W evicts event at position W+1', () => {
    const W = 5
    const T = 3
    const config = buildHistorySizeConfig(W, T)
    const gate = new StructureGate(config)
    const sessionId = 'sess-6c4-exact'

    // Sanity: config carries our injected W, not a hardcoded default
    expect(gate.getConfig().historySize).toBe(W)

    let state = createSessionState(sessionId, 'root', config.historySize)

    // Feed 1 target (position 0 → will be evicted after W more events)
    const r0 = gate.process(makeTargetEvent(sessionId), state)
    state = r0.nextState
    expect(r0.result).toBeNull()  // 1 repeat, below T=3

    // Feed W fillers → the initial target is now outside the window
    for (let i = 0; i < W; i++) {
      const out = gate.process(makeFillerEvent(i + 1000, sessionId), state)
      state = out.nextState
    }

    // Feed T-1=2 more targets → they are in the window, but count=2 < T=3 → no flag
    for (let i = 0; i < T - 1; i++) {
      const out = gate.process(makeTargetEvent(sessionId), state)
      state = out.nextState
      // None of these should flag repeat_action
      expect(out.result?.subtype ?? null).not.toBe('repeat_action')
    }

    // Feed 1 more target → count=T=3 targets now in window → flag fires
    const final = gate.process(makeTargetEvent(sessionId), state)
    expect(final.result).not.toBeNull()
    expect(final.result?.subtype).toBe('repeat_action')
    expect(final.result?.severity).toBe('warning')
    expect(final.result?.metrics['repeatN']).toBe(T)
  })

  /**
   * Two gates, identical config except historySize (W_A < W_B), same threshold T.
   * Feed T target events separated by exactly W_A fillers between first and last.
   *
   * Gate A (small W_A): first target is evicted → count stays below T → NO flag on last target.
   * Gate B (large W_B): first target is NOT evicted → count reaches T → FLAG on last target.
   *
   * This proves the window cutoff comes from config.historySize, not a shared constant.
   */
  test('two gates with different historySize values evict at different points', () => {
    const T = 3
    const W_A = T + 1   // small window: W_A = 4; first target evicted after 4 events
    const W_B = T * 4   // large window: W_B = 12; first target stays

    const configA = buildHistorySizeConfig(W_A, T)
    const configB = buildHistorySizeConfig(W_B, T)

    const gateA = new StructureGate(configA)
    const gateB = new StructureGate(configB)

    expect(gateA.getConfig().historySize).toBe(W_A)
    expect(gateB.getConfig().historySize).toBe(W_B)

    const sessionA = 'sess-6c4-wa'
    const sessionB = 'sess-6c4-wb'

    let stateA = createSessionState(sessionA, 'root', configA.historySize)
    let stateB = createSessionState(sessionB, 'root', configB.historySize)

    // Step 1: Feed first target to both gates
    const t1 = makeTargetEvent()
    const outA1 = gateA.process({ ...t1, sessionId: sessionA, uuid: t1.uuid + '-a' }, stateA)
    const outB1 = gateB.process({ ...t1, sessionId: sessionB, uuid: t1.uuid + '-b' }, stateB)
    stateA = outA1.nextState
    stateB = outB1.nextState

    // Step 2: Feed W_A filler events to both gates.
    // This evicts the first target from gateA's window (W_A events fill it),
    // but it stays in gateB's larger window (W_B > W_A).
    for (let i = 0; i < W_A; i++) {
      const f = makeFillerEvent(i + 2000)
      const outA = gateA.process({ ...f, sessionId: sessionA, uuid: f.uuid + '-a' }, stateA)
      const outB = gateB.process({ ...f, sessionId: sessionB, uuid: f.uuid + '-b' }, stateB)
      stateA = outA.nextState
      stateB = outB.nextState
    }

    // Step 3: Feed T-1 more targets to both gates.
    // GateA: first target was evicted; only T-1 targets in window → no flag yet.
    // GateB: first target retained; total = T-1+1 = T targets in window → might fire at T.
    //   But we feed T-1 MORE, so GateB has T-1 new + 1 original = T → might fire here.
    // We feed T-2 to keep gateB also not fired on step 3 (total for B: 1 + T-2 = T-1 < T)
    // Then 1 final target:
    //   GateA: T-1+1 = T total, but first was evicted → only T-1+1-1=T-1 in window...
    //
    // Simpler: feed exactly 1 more target (T-2=1 when T=3) to reach T-1 total in gateB
    // then the final target tips gateB to T.

    // Feed T-2 more targets (reaches T-1 total for B since it has 1 original)
    for (let i = 0; i < T - 2; i++) {
      const t = makeTargetEvent()
      const outA = gateA.process({ ...t, sessionId: sessionA, uuid: t.uuid + '-a' }, stateA)
      const outB = gateB.process({ ...t, sessionId: sessionB, uuid: t.uuid + '-b' }, stateB)
      stateA = outA.nextState
      stateB = outB.nextState
      // Neither should have fired repeat_action yet
      expect(outA.result?.subtype ?? null).not.toBe('repeat_action')
      expect(outB.result?.subtype ?? null).not.toBe('repeat_action')
    }

    // Final target:
    // GateA window: [W_A fillers(T-2 targets overlap)] + recent targets
    //   First target was evicted (after W_A fillers pushed it out), so gateA has
    //   T-2 + 1 = T-1 targets in window → NO flag for gateA
    // GateB window: first target still in, T-2 additional = T-1 total, +1 = T → FLAG for gateB
    const tFinal = makeTargetEvent()
    const outAFinal = gateA.process({ ...tFinal, sessionId: sessionA, uuid: tFinal.uuid + '-a' }, stateA)
    const outBFinal = gateB.process({ ...tFinal, sessionId: sessionB, uuid: tFinal.uuid + '-b' }, stateB)

    // GateA: evicted first target → only T-1 targets visible → no flag
    expect(outAFinal.result?.subtype ?? null).not.toBe('repeat_action')

    // GateB: first target retained → T targets visible → flag
    expect(outBFinal.result).not.toBeNull()
    expect(outBFinal.result?.subtype).toBe('repeat_action')
    expect(outBFinal.result?.metrics['repeatN']).toBe(T)
  })

  /**
   * Verify config.historySize=DEFAULT (30) works correctly at its own boundary.
   * Feed DEFAULT-1 fillers between targets so the first target is always evicted.
   * With T=5: feed 1 target, then 30 fillers, then 4 targets → no flag.
   * Then 1 more target → flag.
   */
  test('default historySize=30 boundary: eviction after 30 events', () => {
    const W = 30  // DEFAULT_DETECTOR_CONFIG.historySize
    const T = 5
    const config = buildHistorySizeConfig(W, T)
    const gate = new StructureGate(config)

    // config.historySize must be 30, not some hardcoded value overriding it
    expect(gate.getConfig().historySize).toBe(W)

    const sessionId = 'sess-6c4-default'
    let state = createSessionState(sessionId, 'root', config.historySize)

    // Feed 1 target (will be evicted)
    const r0 = gate.process(makeTargetEvent(sessionId), state)
    state = r0.nextState

    // Feed W fillers → evict the initial target
    for (let i = 0; i < W; i++) {
      const out = gate.process(makeFillerEvent(i + 3000, sessionId), state)
      state = out.nextState
    }

    // Feed T-1=4 targets → count in window = T-1 → no flag
    for (let i = 0; i < T - 1; i++) {
      const out = gate.process(makeTargetEvent(sessionId), state)
      state = out.nextState
      expect(out.result?.subtype ?? null).not.toBe('repeat_action')
    }

    // Feed 1 more target → count = T → flag
    const final = gate.process(makeTargetEvent(sessionId), state)
    expect(final.result).not.toBeNull()
    expect(final.result?.subtype).toBe('repeat_action')
    expect(final.result?.metrics['repeatN']).toBe(T)
  })

  /**
   * Non-interference: historySize only gates window size, not threshold.
   * A large historySize with small T should still fire at T (window keeps all events).
   */
  test('large historySize does not block detection: T events all in window → flag', () => {
    const W = 100  // very large window
    const T = 3
    const config = buildHistorySizeConfig(W, T)
    const gate = new StructureGate(config)

    expect(gate.getConfig().historySize).toBe(W)

    const sessionId = 'sess-6c4-large-w'
    let state = createSessionState(sessionId, 'root', config.historySize)

    // Feed T-1 targets → no flag
    for (let i = 0; i < T - 1; i++) {
      const out = gate.process(makeTargetEvent(sessionId), state)
      state = out.nextState
      expect(out.result?.subtype ?? null).not.toBe('repeat_action')
    }

    // Feed the T-th target → flag fires
    const final = gate.process(makeTargetEvent(sessionId), state)
    expect(final.result).not.toBeNull()
    expect(final.result?.subtype).toBe('repeat_action')
    expect(final.result?.severity).toBe('warning')
    expect(final.result?.metrics['repeatN']).toBe(T)
  })

  /**
   * Small historySize = T exactly: only T events fit in window.
   * Feed T-1 targets then 1 filler → filler evicts 1 target → window has T-2 targets.
   * Feed T-1 more targets → count = T-1 → no flag.
   * Feed 1 more target → count = T → flag.
   *
   * Note: when W=T, feeding T targets and then 1 filler makes window = [T-1 targets, 1 filler]
   * so repeatN = T-1 < T → no flag on next target if it's target number T.
   * Actually W=T: window = last T events. If we feed: [t, t, ..., t] (T times) → repeatN=T → flag.
   * This verifies historySize=T works correctly.
   */
  test('historySize=T exactly: T events fit in window → flag fires at T', () => {
    const T = 4
    const W = T  // window size equals threshold
    const config = buildHistorySizeConfig(W, T)
    const gate = new StructureGate(config)

    expect(gate.getConfig().historySize).toBe(W)
    expect(gate.getConfig().WARNING).toBe(T)

    const sessionId = 'sess-6c4-w-equals-t'
    let state = createSessionState(sessionId, 'root', config.historySize)

    // Feed T-1 targets → window has T-1 targets → no flag
    for (let i = 0; i < T - 1; i++) {
      const out = gate.process(makeTargetEvent(sessionId), state)
      state = out.nextState
      expect(out.result?.subtype ?? null).not.toBe('repeat_action')
    }

    // Feed T-th target → window has T targets (fills exactly) → flag
    const final = gate.process(makeTargetEvent(sessionId), state)
    expect(final.result).not.toBeNull()
    expect(final.result?.subtype).toBe('repeat_action')
    expect(final.result?.metrics['repeatN']).toBe(T)
  })

  /**
   * Verify that replacing historySize in DetectorConfig is the ONLY way to change
   * the eviction point — no hardcoded fallback exists.
   *
   * If the gate had a hardcoded fallback (e.g., Math.max(historySize, DEFAULT)),
   * then setting historySize < DEFAULT would not change behavior.
   * We use W=3 < DEFAULT(30): first target must be evicted after only 3 events,
   * proving no hardcoded floor is applied.
   */
  test('no hardcoded fallback: historySize=3 evicts after 3 events (< default 30)', () => {
    const W = 3   // well below DEFAULT_DETECTOR_CONFIG.historySize (30)
    const T = 2   // threshold low enough to be reachable in small window
    const config = buildHistorySizeConfig(W, T)
    const gate = new StructureGate(config)

    // If there's a hardcoded floor at 30, getConfig().historySize would still be 3
    // but the actual window would behave as if size=30. We verify eviction at W=3.
    expect(gate.getConfig().historySize).toBe(W)

    const sessionId = 'sess-6c4-no-floor'
    let state = createSessionState(sessionId, 'root', config.historySize)

    // Feed 1 target (will be evicted after W=3 total events)
    const r0 = gate.process(makeTargetEvent(sessionId), state)
    state = r0.nextState
    expect(r0.result).toBeNull()  // 1 < T=2 → no flag

    // Feed W=3 fillers → the 1 target is evicted (window now holds 3 fillers)
    for (let i = 0; i < W; i++) {
      const out = gate.process(makeFillerEvent(i + 4000, sessionId), state)
      state = out.nextState
    }

    // Feed T-1=1 target → count in window = 1 < T=2 → NO flag
    const r1 = gate.process(makeTargetEvent(sessionId), state)
    state = r1.nextState
    expect(r1.result?.subtype ?? null).not.toBe('repeat_action')

    // Feed 1 more target → count in window = T=2 → FLAG
    // (if hardcoded floor=30 existed, the original evicted target would still be visible
    //  and the count would be 3, but we'd still fire — however the test that the evicted
    //  target doesn't count is what matters)
    const r2 = gate.process(makeTargetEvent(sessionId), state)
    expect(r2.result).not.toBeNull()
    expect(r2.result?.subtype).toBe('repeat_action')
    expect(r2.result?.metrics['repeatN']).toBe(T)

    // Extra: confirm that if historySize were 30 (default), the original target
    // would NOT have been evicted and the count would be higher (> T).
    // We verify this by creating a second gate with W=30 and same T:
    const configWithDefault = buildHistorySizeConfig(30, T)
    const gateDefault = new StructureGate(configWithDefault)
    let stateDefault = createSessionState('sess-default-compare', 'root', configWithDefault.historySize)

    // Replay: 1 target + W(=3) fillers + 1 target
    const evTarget1 = makeTargetEvent('sess-default-compare')
    const d0 = gateDefault.process(evTarget1, stateDefault)
    stateDefault = d0.nextState

    for (let i = 0; i < W; i++) {
      const f = makeFillerEvent(i + 5000, 'sess-default-compare')
      const out = gateDefault.process(f, stateDefault)
      stateDefault = out.nextState
    }

    // With W=30, the first target is still in the window after only 3 fillers
    const evTarget2 = makeTargetEvent('sess-default-compare')
    const d1 = gateDefault.process(evTarget2, stateDefault)
    // With historySize=30: 1st target still visible + this new target = count=2 = T → flag
    // This fires at T=2 too, because BOTH targets are in the large window
    // The key difference is that with W=3, the first target WAS evicted after 3 fillers,
    // so feeding target after W fillers + 1 target resets count to 1, then 2.
    // With W=30, the first target is NOT evicted after 3 fillers — it stays.
    // Both paths reach flag at T=2, but through different counts:
    //   W=3: count builds to 2 over 2 *fresh* targets (first was evicted)
    //   W=30: count builds to 2 as soon as target#2 arrives (target#1 still in window)
    // The test above (r1.result is null) confirmed W=3 evicted target#1 correctly.
    expect(d1.result).not.toBeNull()
    expect(d1.result?.subtype).toBe('repeat_action')
  })
})
