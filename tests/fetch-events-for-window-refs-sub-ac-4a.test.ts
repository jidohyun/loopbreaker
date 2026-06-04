/**
 * tests/fetch-events-for-window-refs-sub-ac-4a.test.ts
 *
 * Sub-AC 4a: fetchEventsForWindowRefs 단위 테스트
 *
 * 검증 항목:
 *   1. 비어있지 않은 UUID 목록 → 해당 UUID의 StoredEvent 배열 반환 (순서 보존)
 *   2. 알 수 없는 UUID → 빈 배열 반환
 *   3. 빈 UUID 목록 → 빈 배열 반환
 *   4. 일부 알려진 UUID + 일부 미지 UUID → 알려진 것만 반환
 *   5. makeEventLookupFromArray 헬퍼 보조 테스트
 */

import type { StoredEvent } from '../src/ingest/event-store.js'
import {
  fetchEventsForWindowRefs,
  makeEventLookupFromArray,
  buildTriplesForHit,
  buildTriplesForHits,
} from '../src/detect/hits-to-triples.js'
import type { DetectionHit } from '../src/detect/detection-pipeline.js'

// ─── 테스트 픽스처 헬퍼 ───────────────────────────────────────────────────────

function makeStoredEvent(
  uuid: string,
  kind: StoredEvent['kind'] = 'tool_use',
  tool?: string,
): StoredEvent {
  return Object.freeze({
    uuid,
    parentUuid: null,
    sessionId: 'test-session',
    cwd: '/project',
    agentScope: 'root',
    isSidechain: false,
    ts: Date.now(),
    byteOffset: 0,
    kind,
    parseOk: true,
    ingestedAt: Date.now(),
    ...(tool !== undefined ? { tool, input: { file_path: '/project/src/foo.ts' } } : {}),
  } as StoredEvent)
}

function makeDetectionHit(windowRefs: string[]): DetectionHit {
  return {
    gate: {
      type: 'thrashing',
      subtype: 'repeat_action',
      severity: 'warning',
      sessionId: 'test-session',
      agentScope: 'root',
      windowRefs,
      metrics: { repeatN: windowRefs.length },
    },
    triggerUuid: windowRefs[windowRefs.length - 1] ?? 'unknown',
    ts: Date.now(),
  }
}

// ─── fetchEventsForWindowRefs ─────────────────────────────────────────────────

describe('fetchEventsForWindowRefs', () => {
  test('비어있지 않은 UUID 목록 → 해당 StoredEvent 배열 반환', () => {
    const ev1 = makeStoredEvent('uuid-1')
    const ev2 = makeStoredEvent('uuid-2')
    const ev3 = makeStoredEvent('uuid-3')
    const allEvents = [ev1, ev2, ev3]
    const store = makeEventLookupFromArray(allEvents)

    const result = fetchEventsForWindowRefs(['uuid-1', 'uuid-3'], store)

    expect(result).toHaveLength(2)
    expect(result[0]).toBe(ev1)
    expect(result[1]).toBe(ev3)
  })

  test('비어있지 않은 UUID 목록 → windowRefs 순서를 보존한다', () => {
    const ev1 = makeStoredEvent('uuid-1')
    const ev2 = makeStoredEvent('uuid-2')
    const ev3 = makeStoredEvent('uuid-3')
    const store = makeEventLookupFromArray([ev1, ev2, ev3])

    // 역순으로 요청해도 windowRefs 순서대로 반환
    const result = fetchEventsForWindowRefs(['uuid-3', 'uuid-1'], store)

    expect(result).toHaveLength(2)
    expect(result[0]).toBe(ev3)
    expect(result[1]).toBe(ev1)
  })

  test('알 수 없는 UUID → 빈 배열 반환', () => {
    const ev1 = makeStoredEvent('uuid-known')
    const store = makeEventLookupFromArray([ev1])

    const result = fetchEventsForWindowRefs(['uuid-unknown-1', 'uuid-unknown-2'], store)

    expect(result).toHaveLength(0)
    expect(Array.from(result)).toEqual([])
  })

  test('빈 UUID 목록 → 빈 배열 반환', () => {
    const ev1 = makeStoredEvent('uuid-1')
    const store = makeEventLookupFromArray([ev1])

    const result = fetchEventsForWindowRefs([], store)

    expect(result).toHaveLength(0)
    expect(Array.from(result)).toEqual([])
  })

  test('빈 UUID 목록 → store를 전혀 호출하지 않는다', () => {
    let storeCalled = false
    const store = (_uuids: readonly string[]) => {
      storeCalled = true
      return [] as StoredEvent[]
    }

    fetchEventsForWindowRefs([], store)

    expect(storeCalled).toBe(false)
  })

  test('일부 알려진 UUID + 일부 미지 UUID → 알려진 것만 반환', () => {
    const ev1 = makeStoredEvent('uuid-known-1')
    const ev2 = makeStoredEvent('uuid-known-2')
    const store = makeEventLookupFromArray([ev1, ev2])

    const result = fetchEventsForWindowRefs(
      ['uuid-unknown', 'uuid-known-1', 'uuid-missing', 'uuid-known-2'],
      store,
    )

    expect(result).toHaveLength(2)
    expect(result[0]).toBe(ev1)
    expect(result[1]).toBe(ev2)
  })

  test('반환값은 동결(freeze)된 배열이다 (불변성)', () => {
    const ev1 = makeStoredEvent('uuid-1')
    const store = makeEventLookupFromArray([ev1])

    const result = fetchEventsForWindowRefs(['uuid-1'], store)

    // 배열 자체가 freeze되거나, 최소한 원본 이벤트는 변경되지 않아야 한다
    expect(() => {
      ;(result as StoredEvent[])[0] = makeStoredEvent('mutated')
    }).toThrow()
  })
})

// ─── makeEventLookupFromArray ─────────────────────────────────────────────────

describe('makeEventLookupFromArray', () => {
  test('배열에서 UUID→StoredEvent 맵을 올바르게 구성한다', () => {
    const ev1 = makeStoredEvent('uuid-a')
    const ev2 = makeStoredEvent('uuid-b')
    const store = makeEventLookupFromArray([ev1, ev2])

    const result = store(['uuid-a', 'uuid-b'])
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(ev1)
    expect(result[1]).toBe(ev2)
  })

  test('빈 배열로 생성하면 모든 UUID에 대해 빈 결과 반환', () => {
    const store = makeEventLookupFromArray([])

    const result = store(['uuid-any'])
    expect(result).toHaveLength(0)
  })

  test('동일 UUID가 중복될 때 마지막 값이 우선한다', () => {
    const ev1 = makeStoredEvent('uuid-dup')
    const ev2 = { ...makeStoredEvent('uuid-dup'), cwd: '/other' } as StoredEvent
    const store = makeEventLookupFromArray([ev1, ev2])

    const result = store(['uuid-dup'])
    expect(result).toHaveLength(1)
    // 마지막에 삽입된 ev2가 ev1을 덮어쓴다
    expect(result[0]?.cwd).toBe('/other')
  })
})

// ─── buildTriplesForHit ───────────────────────────────────────────────────────

describe('buildTriplesForHit', () => {
  test('tool_use 이벤트는 ActionTriple을 생성한다', () => {
    const ev1 = makeStoredEvent('uuid-tool-1', 'tool_use', 'Edit')
    const ev2 = makeStoredEvent('uuid-tool-2', 'tool_use', 'Bash')
    const store = makeEventLookupFromArray([ev1, ev2])
    const hit = makeDetectionHit(['uuid-tool-1', 'uuid-tool-2'])

    const triples = buildTriplesForHit(hit, store)

    expect(triples.length).toBeGreaterThan(0)
    for (const triple of triples) {
      expect(triple).toHaveProperty('tool')
      expect(triple).toHaveProperty('argKey')
      expect(triple).toHaveProperty('resultClass')
      expect(triple).toHaveProperty('ref')
    }
  })

  test('tool_use 이외 이벤트는 null → triple 제외', () => {
    const evUser = makeStoredEvent('uuid-user', 'user')
    const evAssist = makeStoredEvent('uuid-assistant', 'assistant')
    const store = makeEventLookupFromArray([evUser, evAssist])
    const hit = makeDetectionHit(['uuid-user', 'uuid-assistant'])

    const triples = buildTriplesForHit(hit, store)

    // user/assistant 이벤트는 buildTriple이 null 반환 → 제외
    expect(triples).toHaveLength(0)
  })

  test('windowRefs가 비어있으면 빈 triples 반환', () => {
    const store = makeEventLookupFromArray([])
    const hit = makeDetectionHit([])

    const triples = buildTriplesForHit(hit, store)

    expect(triples).toHaveLength(0)
  })

  test('미지 UUID는 조용히 건너뛴다', () => {
    const ev1 = makeStoredEvent('uuid-known', 'tool_use', 'Edit')
    const store = makeEventLookupFromArray([ev1])
    const hit = makeDetectionHit(['uuid-unknown', 'uuid-known'])

    const triples = buildTriplesForHit(hit, store)

    // uuid-known만 매칭되어 triple 1개
    expect(triples).toHaveLength(1)
    expect(triples[0]?.ref.uuid).toBe('uuid-known')
  })
})

// ─── buildTriplesForHits ──────────────────────────────────────────────────────

describe('buildTriplesForHits', () => {
  test('결과 배열 길이가 hits.length와 항상 동일하다 (runM3Pipeline 길이 계약)', () => {
    const ev1 = makeStoredEvent('uuid-1', 'tool_use', 'Edit')
    const ev2 = makeStoredEvent('uuid-2', 'tool_use', 'Bash')
    const store = makeEventLookupFromArray([ev1, ev2])
    const hits = [
      makeDetectionHit(['uuid-1']),
      makeDetectionHit(['uuid-2']),
      makeDetectionHit(['uuid-unknown']),
    ]

    const triples = buildTriplesForHits(hits, store)

    expect(triples).toHaveLength(hits.length)
    expect(triples).toHaveLength(3)
  })

  test('빈 hits 배열 → 빈 결과', () => {
    const store = makeEventLookupFromArray([])

    const triples = buildTriplesForHits([], store)

    expect(triples).toHaveLength(0)
  })

  test('각 hit의 triples는 독립적으로 구성된다', () => {
    const ev1 = makeStoredEvent('uuid-1', 'tool_use', 'Edit')
    const ev2 = makeStoredEvent('uuid-2', 'tool_use', 'Bash')
    const store = makeEventLookupFromArray([ev1, ev2])
    const hits = [
      makeDetectionHit(['uuid-1']),
      makeDetectionHit(['uuid-2']),
    ]

    const triples = buildTriplesForHits(hits, store)

    expect(triples[0]).toHaveLength(1)
    expect(triples[1]).toHaveLength(1)
    expect(triples[0]?.[0]?.tool).toBe('Edit')
    expect(triples[1]?.[0]?.tool).toBe('Bash')
  })

  test('tool_use 없는 hit의 triples는 빈 배열(길이 계약은 유지)', () => {
    const evUser = makeStoredEvent('uuid-user', 'user')
    const evTool = makeStoredEvent('uuid-tool', 'tool_use', 'Read')
    const store = makeEventLookupFromArray([evUser, evTool])
    const hits = [
      makeDetectionHit(['uuid-user']),   // tool_use 아님 → triples=[]
      makeDetectionHit(['uuid-tool']),   // tool_use → triples=[triple]
    ]

    const triples = buildTriplesForHits(hits, store)

    // 길이 계약: hits.length === triples.length
    expect(triples).toHaveLength(2)
    // 첫 번째는 비어있음
    expect(triples[0]).toHaveLength(0)
    // 두 번째는 1개
    expect(triples[1]).toHaveLength(1)
  })
})
