/**
 * tests/topo-sort.test.ts
 *
 * Sub-AC 4b: topoSortByParentUuid() 단위 테스트.
 *
 * 검증 항목:
 *   1. 체인 A→B→C: 부모가 자식보다 앞에 위치
 *   2. 분리된 루트: 독립 노드가 독립적으로 처리됨
 *   3. 빈 배열 → 빈 배열 반환
 *   4. 단일 이벤트 → 그대로 반환
 *   5. 역순 입력 → 올바른 위상 순서로 정렬
 *   6. 고아(부모가 집합 외부) → 독립 루트로 처리 (중단 금지)
 *   7. 순환 참조 → 중단 없이 잔여 노드 append
 *   8. 형제 노드 → byteOffset 순으로 정렬
 *   9. parentUuid=null → 루트로 처리
 */

import { topoSortByParentUuid } from '../src/ingest/parser.js'
import type { NormalizedEvent } from '../src/contracts.js'

// ── 픽스처 헬퍼 ───────────────────────────────────────────────────────────────

function makeEvent(
  overrides: Partial<NormalizedEvent> & { uuid: string },
): NormalizedEvent {
  return {
    parentUuid: null,
    sessionId: 'sess-test',
    cwd: '/tmp/project',
    agentScope: 'root',
    isSidechain: false,
    ts: 1000,
    byteOffset: 0,
    kind: 'user',
    ...overrides,
  }
}

// ── 테스트: 빈 / 단일 ─────────────────────────────────────────────────────────

describe('topoSortByParentUuid() — 기본 케이스', () => {
  test('빈 배열 → 빈 배열 반환', () => {
    expect(topoSortByParentUuid([])).toEqual([])
  })

  test('단일 이벤트 → 그대로 반환', () => {
    const ev = makeEvent({ uuid: 'A', byteOffset: 0 })
    const result = topoSortByParentUuid([ev])
    expect(result).toHaveLength(1)
    expect(result[0]!.uuid).toBe('A')
  })
})

// ── 테스트: 체인 A→B→C ───────────────────────────────────────────────────────

describe('topoSortByParentUuid() — 체인 A→B→C', () => {
  /**
   * A (root, parentUuid=null)
   * └─ B (parentUuid=A)
   *    └─ C (parentUuid=B)
   *
   * 올바른 위상 순서: A, B, C
   */

  const A = makeEvent({ uuid: 'A', parentUuid: null, byteOffset: 0, ts: 1000 })
  const B = makeEvent({ uuid: 'B', parentUuid: 'A', byteOffset: 10, ts: 2000 })
  const C = makeEvent({ uuid: 'C', parentUuid: 'B', byteOffset: 20, ts: 3000 })

  test('정순 입력(A,B,C) → A,B,C 순서 보존', () => {
    const result = topoSortByParentUuid([A, B, C])
    expect(result.map((e) => e.uuid)).toEqual(['A', 'B', 'C'])
  })

  test('역순 입력(C,B,A) → A,B,C 위상 순서로 정렬', () => {
    const result = topoSortByParentUuid([C, B, A])
    expect(result.map((e) => e.uuid)).toEqual(['A', 'B', 'C'])
  })

  test('임의 순서 입력(B,C,A) → A,B,C 위상 순서로 정렬', () => {
    const result = topoSortByParentUuid([B, C, A])
    expect(result.map((e) => e.uuid)).toEqual(['A', 'B', 'C'])
  })

  test('부모는 항상 자식보다 앞에 위치한다', () => {
    const result = topoSortByParentUuid([C, B, A])
    const uuids = result.map((e) => e.uuid)
    const idxA = uuids.indexOf('A')
    const idxB = uuids.indexOf('B')
    const idxC = uuids.indexOf('C')
    expect(idxA).toBeLessThan(idxB)
    expect(idxB).toBeLessThan(idxC)
  })

  test('결과 배열 길이는 입력과 동일하다', () => {
    const result = topoSortByParentUuid([A, B, C])
    expect(result).toHaveLength(3)
  })
})

// ── 테스트: 분리된 루트 (detached root) ──────────────────────────────────────

describe('topoSortByParentUuid() — 분리된 루트', () => {
  /**
   * X (독립 루트, parentUuid=null)
   * A (root, parentUuid=null)
   * └─ B (parentUuid=A)
   *
   * X는 A/B와 연결되지 않은 독립 노드.
   * 위상 순서: X와 A는 루트(순서 자유), B는 A 뒤
   */

  const X = makeEvent({ uuid: 'X', parentUuid: null, byteOffset: 5, ts: 500 })
  const A = makeEvent({ uuid: 'A', parentUuid: null, byteOffset: 0, ts: 1000 })
  const B = makeEvent({ uuid: 'B', parentUuid: 'A', byteOffset: 10, ts: 2000 })

  test('분리된 루트 X는 결과에 포함된다', () => {
    const result = topoSortByParentUuid([X, A, B])
    expect(result.map((e) => e.uuid)).toContain('X')
  })

  test('B는 항상 A 뒤에 위치한다', () => {
    const result = topoSortByParentUuid([B, X, A])
    const uuids = result.map((e) => e.uuid)
    const idxA = uuids.indexOf('A')
    const idxB = uuids.indexOf('B')
    expect(idxA).toBeLessThan(idxB)
  })

  test('결과 배열에 모든 노드가 포함된다', () => {
    const result = topoSortByParentUuid([X, A, B])
    expect(result).toHaveLength(3)
    const uuids = result.map((e) => e.uuid)
    expect(uuids).toContain('X')
    expect(uuids).toContain('A')
    expect(uuids).toContain('B')
  })

  test('루트들(X, A)은 자식(B)보다 앞에 위치한다', () => {
    const result = topoSortByParentUuid([B, X, A])
    const uuids = result.map((e) => e.uuid)
    const idxB = uuids.indexOf('B')
    // X와 A는 모두 B보다 앞이어야 함
    expect(uuids.indexOf('A')).toBeLessThan(idxB)
  })
})

// ── 테스트: 고아 노드 (부모가 집합 외부) ─────────────────────────────────────

describe('topoSortByParentUuid() — 고아 노드 처리 (중단 금지)', () => {
  test('부모가 집합에 없는 고아 → 독립 루트로 처리, 중단 없음', () => {
    const orphan = makeEvent({ uuid: 'orphan', parentUuid: 'ghost-parent', byteOffset: 0 })
    expect(() => topoSortByParentUuid([orphan])).not.toThrow()
    const result = topoSortByParentUuid([orphan])
    expect(result).toHaveLength(1)
    expect(result[0]!.uuid).toBe('orphan')
  })

  test('고아와 정상 체인이 혼재 → 모두 결과에 포함', () => {
    const orphan = makeEvent({ uuid: 'orphan', parentUuid: 'missing', byteOffset: 0 })
    const A = makeEvent({ uuid: 'A', parentUuid: null, byteOffset: 5 })
    const B = makeEvent({ uuid: 'B', parentUuid: 'A', byteOffset: 10 })

    const result = topoSortByParentUuid([orphan, B, A])
    expect(result).toHaveLength(3)
    const uuids = result.map((e) => e.uuid)
    expect(uuids).toContain('orphan')
    expect(uuids).toContain('A')
    expect(uuids).toContain('B')
    // A는 B보다 앞
    expect(uuids.indexOf('A')).toBeLessThan(uuids.indexOf('B'))
  })
})

// ── 테스트: 순환 참조 (cycle) ────────────────────────────────────────────────

describe('topoSortByParentUuid() — 순환 참조 (중단 금지)', () => {
  test('2-노드 사이클 → 중단 없이 모든 노드 반환', () => {
    // A.parentUuid=B, B.parentUuid=A (사이클)
    const A = makeEvent({ uuid: 'A', parentUuid: 'B', byteOffset: 0 })
    const B = makeEvent({ uuid: 'B', parentUuid: 'A', byteOffset: 10 })

    expect(() => topoSortByParentUuid([A, B])).not.toThrow()
    const result = topoSortByParentUuid([A, B])
    expect(result).toHaveLength(2)
  })

  test('사이클 + 정상 루트 혼재 → 모든 노드 포함', () => {
    const root = makeEvent({ uuid: 'root', parentUuid: null, byteOffset: 0 })
    const cycleA = makeEvent({ uuid: 'cycleA', parentUuid: 'cycleB', byteOffset: 10 })
    const cycleB = makeEvent({ uuid: 'cycleB', parentUuid: 'cycleA', byteOffset: 20 })

    const result = topoSortByParentUuid([cycleA, cycleB, root])
    expect(result).toHaveLength(3)
    // root는 사이클 노드보다 앞 (inDegree=0이므로 먼저 처리됨)
    expect(result[0]!.uuid).toBe('root')
  })
})

// ── 테스트: 형제 노드 byteOffset 정렬 ────────────────────────────────────────

describe('topoSortByParentUuid() — 형제 노드 byteOffset 정렬', () => {
  /**
   * A (root)
   * ├─ B1 (byteOffset=20)
   * ├─ B2 (byteOffset=10)  ← 더 작은 offset
   * └─ B3 (byteOffset=30)
   *
   * 형제들은 byteOffset 오름차순으로 정렬되어야 함: B2, B1, B3
   */

  test('같은 부모의 형제는 byteOffset 순으로 정렬된다', () => {
    const A = makeEvent({ uuid: 'A', parentUuid: null, byteOffset: 0 })
    const B1 = makeEvent({ uuid: 'B1', parentUuid: 'A', byteOffset: 20 })
    const B2 = makeEvent({ uuid: 'B2', parentUuid: 'A', byteOffset: 10 })
    const B3 = makeEvent({ uuid: 'B3', parentUuid: 'A', byteOffset: 30 })

    const result = topoSortByParentUuid([B1, B3, B2, A])
    const uuids = result.map((e) => e.uuid)

    expect(uuids[0]).toBe('A')
    // 형제들은 byteOffset 순: B2(10), B1(20), B3(30)
    expect(uuids.slice(1)).toEqual(['B2', 'B1', 'B3'])
  })
})

// ── 테스트: 입력 불변성 ───────────────────────────────────────────────────────

describe('topoSortByParentUuid() — 입력 불변성', () => {
  test('입력 배열을 변경하지 않는다 (immutable)', () => {
    const A = makeEvent({ uuid: 'A', parentUuid: null, byteOffset: 0 })
    const B = makeEvent({ uuid: 'B', parentUuid: 'A', byteOffset: 10 })
    const C = makeEvent({ uuid: 'C', parentUuid: 'B', byteOffset: 20 })
    const original = [C, B, A]
    const originalOrder = original.map((e) => e.uuid)

    topoSortByParentUuid(original)

    // 원본 배열이 변경되지 않아야 함
    expect(original.map((e) => e.uuid)).toEqual(originalOrder)
  })

  test('새로운 배열을 반환한다 (참조가 다름)', () => {
    const A = makeEvent({ uuid: 'A', parentUuid: null, byteOffset: 0 })
    const input = [A]
    const result = topoSortByParentUuid(input)
    expect(result).not.toBe(input)
  })
})
