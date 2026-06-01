/**
 * tests/is-false-positive-repeat-sub-ac-2-4-3.test.ts
 *
 * Sub-AC 2.4.3: isFalsePositiveRepeat() 단위 테스트
 *
 * 검증 범위:
 *   (a) 서로 다른 deltaHash가 각각 threshold 미만이면 false를 반환한다
 *       (총합이 threshold 이상이어도 관계없음 — 오탐 방지)
 *   (b) 단일 deltaHash가 threshold 이상이면 true를 반환한다
 *   + 경계값·엣지케이스
 */

import { isFalsePositiveRepeat } from '../src/detect/triple-builder.js'

// ─── 헬퍼 ─────────────────────────────────────────────────────

/**
 * Map<argKey, Map<deltaHash, count>> 를 간단히 구성하는 헬퍼.
 * entries: [[argKey, [[deltaHash, count], ...]], ...]
 */
function makeMultiset(
  entries: ReadonlyArray<[string, ReadonlyArray<[string, number]>]>,
): Map<string, Map<string, number>> {
  const outer = new Map<string, Map<string, number>>()
  for (const [argKey, innerEntries] of entries) {
    const inner = new Map<string, number>()
    for (const [deltaHash, count] of innerEntries) {
      inner.set(deltaHash, count)
    }
    outer.set(argKey, inner)
  }
  return outer
}

// ─── (a) 서로 다른 delta 각각 threshold 미만 → false ──────────

describe('isFalsePositiveRepeat — (a) 분산된 delta, 각각 threshold 미만 → false', () => {
  it('delta 2개 각 1회, threshold=2 → false (각 delta count < threshold)', () => {
    const multiset = makeMultiset([
      ['Edit:/src/foo.ts:aabb0000aabb0000', [
        ['aabb0000aabb0000', 1],
        ['ccdd1111ccdd1111', 1],
      ]],
    ])
    expect(
      isFalsePositiveRepeat(multiset, 'Edit:/src/foo.ts:aabb0000aabb0000', 2),
    ).toBe(false)
  })

  it('delta 3개 각 2회, threshold=3 → false (각 delta count 2 < 3)', () => {
    const multiset = makeMultiset([
      ['Edit:/src/bar.ts:aaaa0000aaaa0000', [
        ['aaaa0000aaaa0000', 2],
        ['bbbb1111bbbb1111', 2],
        ['cccc2222cccc2222', 2],
      ]],
    ])
    // total = 6 >= threshold=3 이지만, 각 delta는 2 < 3
    expect(
      isFalsePositiveRepeat(multiset, 'Edit:/src/bar.ts:aaaa0000aaaa0000', 3),
    ).toBe(false)
  })

  it('delta 5개 각 4회, threshold=5 → false (총합 20 >= 5이나 각 delta 4 < 5)', () => {
    const multiset = makeMultiset([
      ['Edit:/src/baz.ts:1111000011110000', [
        ['1111000011110000', 4],
        ['2222000022220000', 4],
        ['3333000033330000', 4],
        ['4444000044440000', 4],
        ['5555000055550000', 4],
      ]],
    ])
    expect(
      isFalsePositiveRepeat(multiset, 'Edit:/src/baz.ts:1111000011110000', 5),
    ).toBe(false)
  })

  it('delta 2개 각 threshold-1 회 → false (threshold=10, 각 9회)', () => {
    const multiset = makeMultiset([
      ['Edit:/src/x.ts:deadbeefdeadbeef', [
        ['deadbeefdeadbeef', 9],
        ['cafecafecafecafe', 9],
      ]],
    ])
    expect(
      isFalsePositiveRepeat(multiset, 'Edit:/src/x.ts:deadbeefdeadbeef', 10),
    ).toBe(false)
  })
})

// ─── (b) 단일 delta threshold 이상 → true ─────────────────────

describe('isFalsePositiveRepeat — (b) 단일 delta ≥ threshold → true', () => {
  it('단일 delta count = threshold → true (경계값)', () => {
    const multiset = makeMultiset([
      ['Edit:/src/foo.ts:aabb0000aabb0000', [
        ['aabb0000aabb0000', 5],
      ]],
    ])
    expect(
      isFalsePositiveRepeat(multiset, 'Edit:/src/foo.ts:aabb0000aabb0000', 5),
    ).toBe(true)
  })

  it('단일 delta count > threshold → true', () => {
    const multiset = makeMultiset([
      ['Edit:/src/hot.ts:eeee1111eeee1111', [
        ['eeee1111eeee1111', 20],
      ]],
    ])
    expect(
      isFalsePositiveRepeat(multiset, 'Edit:/src/hot.ts:eeee1111eeee1111', 5),
    ).toBe(true)
  })

  it('delta 2개 중 하나가 threshold 이상 → true', () => {
    const multiset = makeMultiset([
      ['Edit:/src/mixed.ts:ffff2222ffff2222', [
        ['ffff2222ffff2222', 3],  // < threshold
        ['0000333300003333', 8],  // >= threshold (8)
      ]],
    ])
    expect(
      isFalsePositiveRepeat(multiset, 'Edit:/src/mixed.ts:ffff2222ffff2222', 8),
    ).toBe(true)
  })

  it('threshold=1, 단일 count=1 → true', () => {
    const multiset = makeMultiset([
      ['Edit:/src/one.ts:aaaa1111aaaa1111', [
        ['aaaa1111aaaa1111', 1],
      ]],
    ])
    expect(
      isFalsePositiveRepeat(multiset, 'Edit:/src/one.ts:aaaa1111aaaa1111', 1),
    ).toBe(true)
  })

  it('delta 5개 중 마지막 하나만 threshold 이상 → true', () => {
    const multiset = makeMultiset([
      ['Edit:/src/last.ts:a0a0a0a0a0a0a0a0', [
        ['a0a0a0a0a0a0a0a0', 2],
        ['b1b1b1b1b1b1b1b1', 2],
        ['c2c2c2c2c2c2c2c2', 2],
        ['d3d3d3d3d3d3d3d3', 2],
        ['e4e4e4e4e4e4e4e4', 10], // this one hits threshold
      ]],
    ])
    expect(
      isFalsePositiveRepeat(multiset, 'Edit:/src/last.ts:a0a0a0a0a0a0a0a0', 10),
    ).toBe(true)
  })
})

// ─── 엣지 케이스 ──────────────────────────────────────────────

describe('isFalsePositiveRepeat — 엣지 케이스', () => {
  it('존재하지 않는 argKey → false', () => {
    const multiset = makeMultiset([
      ['Edit:/src/other.ts:1234567890abcdef', [
        ['1234567890abcdef', 10],
      ]],
    ])
    expect(
      isFalsePositiveRepeat(multiset, 'Edit:/src/missing.ts:abcdef1234567890', 5),
    ).toBe(false)
  })

  it('빈 Map → false', () => {
    const multiset = new Map<string, Map<string, number>>()
    expect(
      isFalsePositiveRepeat(multiset, 'Edit:/src/foo.ts:abcd1234abcd1234', 1),
    ).toBe(false)
  })

  it('내부 맵이 비어있으면 → false', () => {
    const outer = new Map<string, Map<string, number>>()
    outer.set('Edit:/src/empty.ts:0000111100001111', new Map())
    expect(
      isFalsePositiveRepeat(outer, 'Edit:/src/empty.ts:0000111100001111', 1),
    ).toBe(false)
  })

  it('threshold=0, 어떤 count든 → true (count >= 0은 항상)', () => {
    const multiset = makeMultiset([
      ['Edit:/src/zero.ts:ffffeeeeffffe000', [
        ['ffffeeeeffffe000', 1],
      ]],
    ])
    expect(
      isFalsePositiveRepeat(multiset, 'Edit:/src/zero.ts:ffffeeeeffffe000', 0),
    ).toBe(true)
  })

  it('다른 argKey의 큰 카운트는 영향을 미치지 않는다', () => {
    const multiset = makeMultiset([
      ['Edit:/src/a.ts:aaaa0000aaaa0000', [
        ['aaaa0000aaaa0000', 100], // 다른 argKey
      ]],
      ['Edit:/src/b.ts:bbbb1111bbbb1111', [
        ['bbbb1111bbbb1111', 2],   // 조회 대상
      ]],
    ])
    expect(
      isFalsePositiveRepeat(multiset, 'Edit:/src/b.ts:bbbb1111bbbb1111', 5),
    ).toBe(false)
  })
})
