/**
 * tests/hits-to-triples-sub-ac-4c.test.ts
 *
 * Sub-AC 4c: hitsToTriples unit tests.
 *
 * Covers:
 *   - output length equals input length (hits/triples same length)
 *   - order preserved across multiple hits
 *   - empty hits array returns empty arrays
 *   - hit with empty triples: retained (empty inner array) with excludeEmpty=false
 *   - hit with empty triples: excluded pairwise with excludeEmpty=true
 *   - multiple hits mixed: only non-empty retained when excludeEmpty=true
 *
 * No real FS, network, OS notifications, or API keys used.
 * All storage via in-memory EventLookup (makeEventLookupFromArray).
 */

import {
  hitsToTriples,
  makeEventLookupFromArray,
  buildTriplesForHits,
} from '../src/detect/hits-to-triples.js'
import type { DetectionHit } from '../src/detect/detection-pipeline.js'
import type { StoredEvent } from '../src/ingest/event-store.js'
import type { StructureGateResult } from '../src/contracts.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStoredEvent(uuid: string, tool?: string): StoredEvent {
  return {
    uuid,
    parentUuid: null,
    sessionId: 'sess-1',
    cwd: '/proj',
    agentScope: 'root',
    isSidechain: false,
    ts: Date.now(),
    byteOffset: 0,
    kind: tool !== undefined ? 'tool_use' : 'user',
    tool,
    input: tool !== undefined ? { file_path: '/proj/foo.ts', old_string: 'a', new_string: 'b' } : undefined,
    parseOk: true,
    ingestedAt: Date.now(),
  }
}

function makeHit(windowRefs: string[], triggerUuid = 'trigger-1'): DetectionHit {
  const gate: StructureGateResult = {
    sessionId: 'sess-1',
    agentScope: 'root',
    type: 'thrashing',
    subtype: 'edit_repeat',
    severity: 'warning',
    metrics: { editRepeat: windowRefs.length },
    windowRefs,
  }
  return { gate, triggerUuid, ts: Date.now() }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('hitsToTriples (Sub-AC 4c)', () => {
  // ── Empty hits array ───────────────────────────────────────────────────────
  test('empty hits array returns empty hits and triples', async () => {
    const store = makeEventLookupFromArray([])
    const result = await hitsToTriples([], store)
    expect(result.hits).toHaveLength(0)
    expect(result.triples).toHaveLength(0)
  })

  // ── Output length equals input length ─────────────────────────────────────
  test('output length equals input length for single hit with matching events', async () => {
    const ev1 = makeStoredEvent('uuid-1', 'Edit')
    const ev2 = makeStoredEvent('uuid-2', 'Edit')
    const store = makeEventLookupFromArray([ev1, ev2])
    const hit = makeHit(['uuid-1', 'uuid-2'])

    const result = await hitsToTriples([hit], store)
    expect(result.hits).toHaveLength(1)
    expect(result.triples).toHaveLength(1)
  })

  test('output length equals input length for multiple hits', async () => {
    const ev1 = makeStoredEvent('uuid-1', 'Edit')
    const ev2 = makeStoredEvent('uuid-2', 'Edit')
    const ev3 = makeStoredEvent('uuid-3', 'Edit')
    const store = makeEventLookupFromArray([ev1, ev2, ev3])

    const hit1 = makeHit(['uuid-1', 'uuid-2'], 'trigger-1')
    const hit2 = makeHit(['uuid-2', 'uuid-3'], 'trigger-2')
    const hit3 = makeHit(['uuid-1', 'uuid-3'], 'trigger-3')

    const result = await hitsToTriples([hit1, hit2, hit3], store)
    expect(result.hits).toHaveLength(3)
    expect(result.triples).toHaveLength(3)
  })

  // ── Order preserved ────────────────────────────────────────────────────────
  test('order is preserved across multiple hits', async () => {
    const evA = makeStoredEvent('uuid-a', 'Edit')
    const evB = makeStoredEvent('uuid-b', 'Bash')
    const evC = makeStoredEvent('uuid-c', 'Edit')
    const store = makeEventLookupFromArray([evA, evB, evC])

    const hitA = makeHit(['uuid-a'], 'trigger-a')
    const hitB = makeHit(['uuid-b'], 'trigger-b')
    const hitC = makeHit(['uuid-c'], 'trigger-c')

    const result = await hitsToTriples([hitA, hitB, hitC], store)

    // hits order preserved
    expect(result.hits[0]).toBe(hitA)
    expect(result.hits[1]).toBe(hitB)
    expect(result.hits[2]).toBe(hitC)

    // triples[i] corresponds to hits[i]
    expect(result.triples[0]).toHaveLength(1)
    expect(result.triples[0]![0]!.tool).toBe('Edit')

    expect(result.triples[1]).toHaveLength(1)
    expect(result.triples[1]![0]!.tool).toBe('Bash')

    expect(result.triples[2]).toHaveLength(1)
    expect(result.triples[2]![0]!.tool).toBe('Edit')
  })

  // ── Hit with empty triples: retained when excludeEmpty=false ──────────────
  test('hit with empty triples is retained (empty inner array) when excludeEmpty=false', async () => {
    // user-kind event → buildTriple returns null → triples = []
    const evUser = makeStoredEvent('uuid-user')  // kind='user', no tool
    const store = makeEventLookupFromArray([evUser])
    const hit = makeHit(['uuid-user'])

    const result = await hitsToTriples([hit], store, false)
    expect(result.hits).toHaveLength(1)
    expect(result.triples).toHaveLength(1)
    expect(result.triples[0]).toHaveLength(0)  // empty inner array
  })

  // ── Hit with empty triples: excluded pairwise when excludeEmpty=true ───────
  test('hit with empty triples is excluded pairwise when excludeEmpty=true', async () => {
    const evUser = makeStoredEvent('uuid-user')  // no tool → empty triples
    const store = makeEventLookupFromArray([evUser])
    const hit = makeHit(['uuid-user'])

    const result = await hitsToTriples([hit], store, true)
    expect(result.hits).toHaveLength(0)
    expect(result.triples).toHaveLength(0)
  })

  // ── Mixed: only non-empty retained when excludeEmpty=true ─────────────────
  test('mixed hits: only non-empty triples retained when excludeEmpty=true', async () => {
    const evTool = makeStoredEvent('uuid-tool', 'Edit')
    const evUser = makeStoredEvent('uuid-user')  // no tool → empty triples
    const store = makeEventLookupFromArray([evTool, evUser])

    const hitWithTriples = makeHit(['uuid-tool'], 'trigger-1')
    const hitEmpty = makeHit(['uuid-user'], 'trigger-2')

    const result = await hitsToTriples([hitWithTriples, hitEmpty], store, true)

    // Only hitWithTriples survives
    expect(result.hits).toHaveLength(1)
    expect(result.triples).toHaveLength(1)
    expect(result.hits[0]).toBe(hitWithTriples)
    expect(result.triples[0]).toHaveLength(1)

    // Length invariant: hits.length === triples.length
    expect(result.hits.length).toBe(result.triples.length)
  })

  // ── Length invariant always holds ─────────────────────────────────────────
  test('hits.length === triples.length invariant holds in all cases', async () => {
    const ev1 = makeStoredEvent('uuid-1', 'Edit')
    const ev2 = makeStoredEvent('uuid-2')  // no tool
    const ev3 = makeStoredEvent('uuid-3', 'Bash')
    const store = makeEventLookupFromArray([ev1, ev2, ev3])

    const hits = [
      makeHit(['uuid-1'], 'trigger-1'),
      makeHit(['uuid-2'], 'trigger-2'),
      makeHit(['uuid-3'], 'trigger-3'),
    ]

    // excludeEmpty=false: all 3 hits retained
    const r1 = await hitsToTriples(hits, store, false)
    expect(r1.hits.length).toBe(r1.triples.length)
    expect(r1.hits.length).toBe(3)

    // excludeEmpty=true: uuid-2 excluded (empty triples)
    const r2 = await hitsToTriples(hits, store, true)
    expect(r2.hits.length).toBe(r2.triples.length)
    expect(r2.hits.length).toBe(2)
  })

  // ── buildTriplesForHits sync variant also preserves length ────────────────
  test('buildTriplesForHits (sync) output length equals input length', () => {
    const ev1 = makeStoredEvent('uuid-1', 'Edit')
    const ev2 = makeStoredEvent('uuid-2', 'Edit')
    const store = makeEventLookupFromArray([ev1, ev2])

    const hits = [
      makeHit(['uuid-1'], 'trigger-1'),
      makeHit(['uuid-2'], 'trigger-2'),
    ]

    const triples = buildTriplesForHits(hits, store)
    expect(triples.length).toBe(hits.length)
    expect(triples.length).toBe(2)
  })

  // ── Unknown UUIDs produce empty triples ───────────────────────────────────
  test('windowRefs with unknown UUIDs produce empty triples for that hit', async () => {
    const store = makeEventLookupFromArray([])  // no events in store
    const hit = makeHit(['unknown-uuid-1', 'unknown-uuid-2'])

    const result = await hitsToTriples([hit], store)
    expect(result.hits).toHaveLength(1)
    expect(result.triples).toHaveLength(1)
    expect(result.triples[0]).toHaveLength(0)  // all UUIDs unknown → empty
  })

  // ── windowRefs empty → empty triples for that hit ─────────────────────────
  test('hit with empty windowRefs produces empty triples', async () => {
    const store = makeEventLookupFromArray([])
    const hit = makeHit([])  // no windowRefs

    const result = await hitsToTriples([hit], store)
    expect(result.hits).toHaveLength(1)
    expect(result.triples).toHaveLength(1)
    expect(result.triples[0]).toHaveLength(0)
  })

  // ── triples contain correct tool names ────────────────────────────────────
  test('triples contain correct tool names matching the events', async () => {
    const evEdit = makeStoredEvent('uuid-edit', 'Edit')
    const evBash = makeStoredEvent('uuid-bash', 'Bash')
    const store = makeEventLookupFromArray([evEdit, evBash])

    const hit = makeHit(['uuid-edit', 'uuid-bash'])
    const result = await hitsToTriples([hit], store)

    const triples = result.triples[0]!
    expect(triples.map(t => t.tool)).toEqual(['Edit', 'Bash'])
  })
})
