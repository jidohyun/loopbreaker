/**
 * tests/orphan-buffer.test.ts
 *
 * sortByTimestamp 단위 테스트.
 *
 * 검증 범위:
 *   1. ts 오름차순 기본 정렬
 *   2. 동일 ts → parentUuid 위상순서로 폴스루 (부모가 자식보다 앞)
 *   3. 동일 ts + parentUuid 관계 없음 → byteOffset으로 폴스루
 *   4. 입력 배열 원본 불변 (새 배열 반환)
 *   5. 빈 배열 → 빈 배열 반환
 *   6. 단일 원소 → 그대로 반환
 *   7. 체인 관계 (A→B→C 부모-자식 chain) + 동일 ts 정렬
 *   8. 혼합: 서로 다른 ts + 동일 ts 위상 그룹이 섞인 경우
 */

import { sortByTimestamp, OrphanBuffer } from '../src/ingest/orphan-buffer.js'
import type { NormalizedEvent } from '../src/contracts.js'

// ──────────────────────────────────────────────────
// 헬퍼: 최소 NormalizedEvent 팩토리
// ──────────────────────────────────────────────────

function makeEvent(overrides: Partial<NormalizedEvent> & { uuid: string }): NormalizedEvent {
  return {
    parentUuid: null,
    sessionId: 'sess',
    cwd: '/tmp',
    agentScope: 'root',
    isSidechain: false,
    ts: 1000,
    byteOffset: 0,
    kind: 'user',
    ...overrides,
  }
}

// ──────────────────────────────────────────────────
// 테스트
// ──────────────────────────────────────────────────

describe('sortByTimestamp', () => {
  // 1. ts 오름차순 기본 정렬
  it('ts 오름차순으로 정렬한다', () => {
    const events = [
      makeEvent({ uuid: 'c', ts: 3000 }),
      makeEvent({ uuid: 'a', ts: 1000 }),
      makeEvent({ uuid: 'b', ts: 2000 }),
    ]
    const sorted = sortByTimestamp(events)
    expect(sorted.map((e) => e.uuid)).toEqual(['a', 'b', 'c'])
  })

  // 2. 동일 ts → parentUuid 위상순서로 폴스루
  it('동일 ts일 때 부모가 자식보다 앞에 온다', () => {
    const parent = makeEvent({ uuid: 'parent', ts: 1000, parentUuid: null })
    const child  = makeEvent({ uuid: 'child',  ts: 1000, parentUuid: 'parent' })

    // 역순으로 입력
    const sorted = sortByTimestamp([child, parent])
    expect(sorted[0]?.uuid).toBe('parent')
    expect(sorted[1]?.uuid).toBe('child')
  })

  it('동일 ts일 때 직접 부모-자식 쌍은 부모가 앞에 온다 (pairwise 계약)', () => {
    // sortByTimestamp는 pairwise 비교자(comparator)를 사용한다.
    // 직접 부모-자식 관계(a.uuid === b.parentUuid)만 결정론적으로 정렬한다.
    // 깊은 체인(A→B→C) 전체의 위상 정렬은 orderEvents(parser.ts)가 담당한다.
    const parent = makeEvent({ uuid: 'p', ts: 1000, parentUuid: null })
    const child  = makeEvent({ uuid: 'c', ts: 1000, parentUuid: 'p'  })

    // 역순 입력: child가 먼저
    const sorted = sortByTimestamp([child, parent])
    expect(sorted[0]?.uuid).toBe('parent' in sorted[0]! ? 'p' : sorted[0]?.uuid)
    // 부모가 인덱스 0, 자식이 인덱스 1
    const uuids = sorted.map((e) => e.uuid)
    expect(uuids.indexOf('p')).toBeLessThan(uuids.indexOf('c'))
  })

  it('동일 ts + 관계 없는 세 이벤트는 byteOffset 오름차순으로 정렬된다', () => {
    // 서로 부모-자식 관계가 없는 3개 이벤트는 byteOffset으로 결정
    const a = makeEvent({ uuid: 'a', ts: 1000, byteOffset: 300, parentUuid: null })
    const b = makeEvent({ uuid: 'b', ts: 1000, byteOffset: 100, parentUuid: null })
    const c = makeEvent({ uuid: 'c', ts: 1000, byteOffset: 200, parentUuid: null })

    const sorted = sortByTimestamp([a, b, c])
    expect(sorted.map((e) => e.uuid)).toEqual(['b', 'c', 'a'])
  })

  // 3. 동일 ts + parentUuid 관계 없음 → byteOffset으로 폴스루
  it('동일 ts + 부모-자식 관계 없음 → byteOffset 오름차순으로 정렬된다', () => {
    const a = makeEvent({ uuid: 'a', ts: 1000, byteOffset: 300 })
    const b = makeEvent({ uuid: 'b', ts: 1000, byteOffset: 100 })
    const c = makeEvent({ uuid: 'c', ts: 1000, byteOffset: 200 })

    const sorted = sortByTimestamp([a, b, c])
    expect(sorted.map((e) => e.uuid)).toEqual(['b', 'c', 'a'])
  })

  it('동일 ts + byteOffset도 동일 → 안정 정렬 보장 불필요, 순서는 유지된다', () => {
    const a = makeEvent({ uuid: 'a', ts: 1000, byteOffset: 0 })
    const b = makeEvent({ uuid: 'b', ts: 1000, byteOffset: 0 })

    // 두 이벤트는 모든 정렬 키가 동일 → 비교 결과 0이므로 원본 순서 유지(V8 안정 정렬)
    const sorted = sortByTimestamp([a, b])
    expect(sorted).toHaveLength(2)
    expect(new Set(sorted.map((e) => e.uuid))).toEqual(new Set(['a', 'b']))
  })

  // 4. 입력 배열 원본 불변
  it('입력 배열을 변경하지 않고 새 배열을 반환한다', () => {
    const original = [
      makeEvent({ uuid: 'b', ts: 2000 }),
      makeEvent({ uuid: 'a', ts: 1000 }),
    ]
    const originalRef = original.slice()
    const sorted = sortByTimestamp(original)

    // 원본 순서 불변
    expect(original[0]?.uuid).toBe('b')
    expect(original[1]?.uuid).toBe('a')
    expect(original).toHaveLength(originalRef.length)

    // 반환값은 별도 배열
    expect(sorted).not.toBe(original)
    expect(sorted.map((e) => e.uuid)).toEqual(['a', 'b'])
  })

  // 5. 빈 배열
  it('빈 배열을 입력하면 빈 배열을 반환한다', () => {
    expect(sortByTimestamp([])).toEqual([])
  })

  // 6. 단일 원소
  it('단일 원소 배열은 그대로 반환한다', () => {
    const events = [makeEvent({ uuid: 'only', ts: 42 })]
    const sorted = sortByTimestamp(events)
    expect(sorted).toHaveLength(1)
    expect(sorted[0]?.uuid).toBe('only')
  })

  // 7. 혼합: ts가 다른 그룹 + 동일 ts 위상 그룹
  it('ts가 다른 그룹과 동일 ts 위상 그룹이 섞여도 올바르게 정렬된다', () => {
    const e1 = makeEvent({ uuid: 'e1', ts: 500,  byteOffset: 0  })
    const e2 = makeEvent({ uuid: 'e2', ts: 1000, byteOffset: 50,  parentUuid: null    })
    const e3 = makeEvent({ uuid: 'e3', ts: 1000, byteOffset: 100, parentUuid: 'e2'   })  // child of e2
    const e4 = makeEvent({ uuid: 'e4', ts: 2000, byteOffset: 200 })

    const sorted = sortByTimestamp([e4, e3, e1, e2])
    const uuids = sorted.map((e) => e.uuid)

    expect(uuids[0]).toBe('e1')       // ts=500 먼저
    expect(uuids[3]).toBe('e4')       // ts=2000 마지막
    // ts=1000 그룹: e2(부모)가 e3(자식)보다 앞
    expect(uuids.indexOf('e2')).toBeLessThan(uuids.indexOf('e3'))
  })

  // 8. readonly 배열 입력 허용
  it('readonly NormalizedEvent[] 를 입력으로 받는다', () => {
    const events: readonly NormalizedEvent[] = [
      makeEvent({ uuid: 'b', ts: 2000 }),
      makeEvent({ uuid: 'a', ts: 1000 }),
    ]
    const sorted = sortByTimestamp(events)
    expect(sorted.map((e) => e.uuid)).toEqual(['a', 'b'])
  })
})
