/**
 * tests/build-edit-delta-multiset.test.ts
 *
 * buildEditDeltaMultiset() 단위 테스트 — Sub-AC 2.4.2
 *
 * 검증 범위:
 *   - 같은 argKey의 동일 deltaHash → 카운트 증가
 *   - 같은 argKey의 다른 deltaHash → 별도 내부 항목
 *   - Edit/MultiEdit 이외 tool은 무시
 *   - 빈 배열 → 빈 Map
 *   - 올바르지 않은 argKey 형식 트리플은 조용히 무시
 *   - 결정론성: 동일 입력 → 동일 출력
 *   - 입력 배열 불변성
 */

import { buildEditDeltaMultiset, buildTriple } from '../src/detect/triple-builder.js'
import type { ActionTriple, NormalizedEvent } from '../src/contracts.js'

// ─── 헬퍼: ActionTriple 직접 생성 ────────────────────────────

let _seq = 0
function nextUuid(): string {
  return `uuid-${String(++_seq).padStart(4, '0')}`
}

/** Edit argKey 형식: "Edit:{filePath}:{16hex}" */
function makeEditTriple(
  filePath: string,
  deltaHash: string,
  resultClass: ActionTriple['resultClass'] = 'ok',
  uuid = nextUuid(),
): ActionTriple {
  return Object.freeze({
    tool: 'Edit',
    argKey: `Edit:${filePath}:${deltaHash}`,
    resultClass,
    ref: Object.freeze({ uuid, ts: Date.now() }),
  })
}

function makeMultiEditTriple(
  filePath: string,
  deltaHash: string,
  resultClass: ActionTriple['resultClass'] = 'ok',
  uuid = nextUuid(),
): ActionTriple {
  return Object.freeze({
    tool: 'MultiEdit',
    argKey: `MultiEdit:${filePath}:${deltaHash}`,
    resultClass,
    ref: Object.freeze({ uuid, ts: Date.now() }),
  })
}

function makeNonEditTriple(
  tool: string,
  argKey: string,
  uuid = nextUuid(),
): ActionTriple {
  return Object.freeze({
    tool,
    argKey,
    resultClass: 'ok' as const,
    ref: Object.freeze({ uuid, ts: Date.now() }),
  })
}

// ─── buildTriple 로 실제 argKey 생성하는 헬퍼 ────────────────

function makeEditEvent(
  filePath: string,
  oldStr: string,
  newStr: string,
): NormalizedEvent {
  return {
    uuid: nextUuid(),
    parentUuid: null,
    sessionId: 'sess-test',
    cwd: '/project',
    agentScope: 'root',
    isSidechain: false,
    ts: Date.now(),
    byteOffset: 0,
    kind: 'tool_use',
    tool: 'Edit',
    input: { file_path: filePath, old_string: oldStr, new_string: newStr },
  }
}

// ─── 빈 입력 ──────────────────────────────────────────────────

describe('buildEditDeltaMultiset — 빈 입력', () => {
  it('빈 배열을 입력하면 빈 Map을 반환한다', () => {
    const result = buildEditDeltaMultiset([])
    expect(result.size).toBe(0)
  })

  it('Edit/MultiEdit이 없는 배열은 빈 Map을 반환한다', () => {
    const triples = [
      makeNonEditTriple('Bash', 'Bash:deadbeef12345678'),
      makeNonEditTriple('Read', 'Read:cafebabe12345678'),
      makeNonEditTriple('Grep', 'Grep:abcd1234abcd1234'),
    ]
    const result = buildEditDeltaMultiset(triples)
    expect(result.size).toBe(0)
  })
})

// ─── 단일 트리플 ──────────────────────────────────────────────

describe('buildEditDeltaMultiset — 단일 Edit 트리플', () => {
  it('단일 Edit 트리플은 외부 맵 1개, 내부 맵 1개(카운트 1)를 생성한다', () => {
    const triple = makeEditTriple('/src/foo.ts', 'abcd1234abcd1234')
    const result = buildEditDeltaMultiset([triple])

    expect(result.size).toBe(1)
    const inner = result.get('Edit:/src/foo.ts:abcd1234abcd1234')
    expect(inner).toBeDefined()
    expect(inner!.size).toBe(1)
    expect(inner!.get('abcd1234abcd1234')).toBe(1)
  })

  it('단일 MultiEdit 트리플도 동일하게 처리된다', () => {
    const triple = makeMultiEditTriple('/src/bar.ts', '1234567890abcdef')
    const result = buildEditDeltaMultiset([triple])

    expect(result.size).toBe(1)
    const inner = result.get('MultiEdit:/src/bar.ts:1234567890abcdef')
    expect(inner).toBeDefined()
    expect(inner!.get('1234567890abcdef')).toBe(1)
  })
})

// ─── 핵심: 동일 argKey 동일 deltaHash → 카운트 증가 ────────────

describe('buildEditDeltaMultiset — 동일 argKey+deltaHash → 카운트 누적', () => {
  it('동일 argKey를 2회 추가하면 내부 카운트가 2가 된다', () => {
    const argKey = 'Edit:/src/foo.ts:aabb1122aabb1122'
    const deltaHash = 'aabb1122aabb1122'
    const triples = [
      makeEditTriple('/src/foo.ts', deltaHash),
      makeEditTriple('/src/foo.ts', deltaHash),
    ]
    const result = buildEditDeltaMultiset(triples)

    expect(result.size).toBe(1)
    const inner = result.get(argKey)!
    expect(inner.size).toBe(1)
    expect(inner.get(deltaHash)).toBe(2)
  })

  it('동일 argKey를 5회 추가하면 카운트가 5가 된다', () => {
    const deltaHash = 'deadbeefdeadbeef'
    const triples = Array.from({ length: 5 }, () =>
      makeEditTriple('/src/hotspot.ts', deltaHash),
    )
    const result = buildEditDeltaMultiset(triples)

    expect(result.size).toBe(1)
    const inner = result.get('Edit:/src/hotspot.ts:deadbeefdeadbeef')!
    expect(inner.get(deltaHash)).toBe(5)
  })

  it('동일 파일 동일 delta 편집이 반복되면 thrashing 탐지에 충분한 카운트가 쌓인다', () => {
    const deltaHash = 'cafecafecafecafe'
    const N = 8
    const triples = Array.from({ length: N }, () =>
      makeEditTriple('/src/loop.ts', deltaHash),
    )
    const result = buildEditDeltaMultiset(triples)

    const inner = result.get(`Edit:/src/loop.ts:${deltaHash}`)!
    expect(inner.get(deltaHash)).toBe(N)
  })
})

// ─── 핵심: 동일 argKey 다른 deltaHash → 별도 항목 ───────────────

describe('buildEditDeltaMultiset — 같은 argKey 내 다른 deltaHash → 별도 항목', () => {
  it('같은 파일 다른 delta는 서로 다른 argKey → 외부 맵에 별도로 존재한다', () => {
    // Edit argKey에 file_path가 포함되고 deltaHash도 포함되므로,
    // 같은 파일 다른 delta → 서로 다른 argKey → 외부 맵 별도 항목
    const delta1 = 'aaaa0000aaaa0000'
    const delta2 = 'bbbb1111bbbb1111'
    const triples = [
      makeEditTriple('/src/foo.ts', delta1),
      makeEditTriple('/src/foo.ts', delta2),
    ]
    const result = buildEditDeltaMultiset(triples)

    // 두 argKey가 서로 다름 → 외부 맵 size = 2
    expect(result.size).toBe(2)

    const inner1 = result.get(`Edit:/src/foo.ts:${delta1}`)!
    const inner2 = result.get(`Edit:/src/foo.ts:${delta2}`)!
    expect(inner1).toBeDefined()
    expect(inner2).toBeDefined()

    expect(inner1.get(delta1)).toBe(1)
    expect(inner2.get(delta2)).toBe(1)
  })

  it('같은 파일 3가지 다른 delta → 외부 맵 3개 항목', () => {
    const deltas = ['1111000011110000', '2222000022220000', '3333000033330000']
    const triples = deltas.map(d => makeEditTriple('/src/multi.ts', d))
    const result = buildEditDeltaMultiset(triples)

    expect(result.size).toBe(3)
    for (const d of deltas) {
      const inner = result.get(`Edit:/src/multi.ts:${d}`)!
      expect(inner.get(d)).toBe(1)
    }
  })

  it('두 delta 각 2회씩 → 외부 맵 2개 항목 각 카운트 2', () => {
    const delta1 = 'cccc0000cccc0000'
    const delta2 = 'dddd1111dddd1111'
    const triples = [
      makeEditTriple('/src/foo.ts', delta1),
      makeEditTriple('/src/foo.ts', delta2),
      makeEditTriple('/src/foo.ts', delta1),
      makeEditTriple('/src/foo.ts', delta2),
    ]
    const result = buildEditDeltaMultiset(triples)

    expect(result.size).toBe(2)
    expect(result.get(`Edit:/src/foo.ts:${delta1}`)!.get(delta1)).toBe(2)
    expect(result.get(`Edit:/src/foo.ts:${delta2}`)!.get(delta2)).toBe(2)
  })
})

// ─── 다른 파일 간 독립성 ──────────────────────────────────────

describe('buildEditDeltaMultiset — 다른 파일 간 독립성', () => {
  it('다른 파일의 동일 deltaHash는 서로 다른 외부 키에 독립적으로 기록된다', () => {
    const deltaHash = 'eeee1111eeee1111'
    const triples = [
      makeEditTriple('/src/a.ts', deltaHash),
      makeEditTriple('/src/b.ts', deltaHash),
      makeEditTriple('/src/a.ts', deltaHash),
    ]
    const result = buildEditDeltaMultiset(triples)

    expect(result.size).toBe(2)
    expect(result.get(`Edit:/src/a.ts:${deltaHash}`)!.get(deltaHash)).toBe(2)
    expect(result.get(`Edit:/src/b.ts:${deltaHash}`)!.get(deltaHash)).toBe(1)
  })
})

// ─── 실제 buildTriple 통합 ────────────────────────────────────

describe('buildEditDeltaMultiset — buildTriple 통합: 실제 argKey 생성', () => {
  it('공백만 다른 편집은 동일 argKey → 같은 카운터에 합산된다', () => {
    // 의미상 동일 편집(공백만 다름) → 같은 argKey → 같은 deltaHash
    const ev1 = makeEditEvent('/src/ws.ts', 'const x = 1', 'const x = 2')
    const ev2 = makeEditEvent('/src/ws.ts', 'const  x  =  1', 'const  x  =  2')

    const t1 = buildTriple(ev1)!
    const t2 = buildTriple(ev2)!

    // argKey가 같아야 함 (collapseWS 정규화)
    expect(t1.argKey).toBe(t2.argKey)

    const result = buildEditDeltaMultiset([t1, t2])
    expect(result.size).toBe(1)

    const inner = result.get(t1.argKey)!
    expect(inner.size).toBe(1)
    // 두 트리플이 같은 deltaHash → 카운트 2
    const [, count] = [...inner.entries()][0]!
    expect(count).toBe(2)
  })

  it('실제로 다른 편집은 다른 argKey → 별도 외부 항목으로 구분된다', () => {
    const ev1 = makeEditEvent('/src/diff.ts', 'const x = 1', 'const x = 2')
    const ev2 = makeEditEvent('/src/diff.ts', 'const y = 10', 'const y = 20')

    const t1 = buildTriple(ev1)!
    const t2 = buildTriple(ev2)!

    // argKey가 달라야 함
    expect(t1.argKey).not.toBe(t2.argKey)

    const result = buildEditDeltaMultiset([t1, t2])
    expect(result.size).toBe(2)
  })

  it('주석만 다른 편집 3회 → 동일 argKey, 카운트 3', () => {
    const ev1 = makeEditEvent('/src/comment.ts', 'return x // old', 'return y // new')
    const ev2 = makeEditEvent('/src/comment.ts', 'return x // v1', 'return y // v2')
    const ev3 = makeEditEvent('/src/comment.ts', 'return x /* old */', 'return y /* new */')

    const t1 = buildTriple(ev1)!
    const t2 = buildTriple(ev2)!
    const t3 = buildTriple(ev3)!

    // 모두 같은 argKey
    expect(t1.argKey).toBe(t2.argKey)
    expect(t2.argKey).toBe(t3.argKey)

    const result = buildEditDeltaMultiset([t1, t2, t3])
    expect(result.size).toBe(1)

    const inner = result.get(t1.argKey)!
    const [, count] = [...inner.entries()][0]!
    expect(count).toBe(3)
  })
})

// ─── non-Edit 필터링 ──────────────────────────────────────────

describe('buildEditDeltaMultiset — non-Edit 트리플 무시', () => {
  it('Bash 트리플은 무시된다', () => {
    const result = buildEditDeltaMultiset([
      makeNonEditTriple('Bash', 'Bash:aabbccddaabbccdd'),
    ])
    expect(result.size).toBe(0)
  })

  it('Read, Glob, Grep, Write 트리플은 무시된다', () => {
    const triples = [
      makeNonEditTriple('Read', 'Read:1234567890abcdef'),
      makeNonEditTriple('Glob', 'Glob:fedcba0987654321'),
      makeNonEditTriple('Grep', 'Grep:1111222233334444'),
      makeNonEditTriple('Write', 'Write:/foo.ts:5555666677778888'),
    ]
    const result = buildEditDeltaMultiset(triples)
    expect(result.size).toBe(0)
  })

  it('Edit/non-Edit 혼합 입력에서 Edit 트리플만 처리한다', () => {
    const deltaHash = 'abcdef0123456789'
    const triples: ActionTriple[] = [
      makeNonEditTriple('Bash', 'Bash:aabbccddaabbccdd'),
      makeEditTriple('/src/foo.ts', deltaHash),
      makeNonEditTriple('Read', 'Read:1234567890abcdef'),
      makeEditTriple('/src/foo.ts', deltaHash),
    ]
    const result = buildEditDeltaMultiset(triples)

    expect(result.size).toBe(1)
    expect(result.get(`Edit:/src/foo.ts:${deltaHash}`)!.get(deltaHash)).toBe(2)
  })
})

// ─── 잘못된 argKey 형식 방어 ──────────────────────────────────

describe('buildEditDeltaMultiset — 잘못된 argKey 형식 무시', () => {
  it('16hex 아닌 suffix를 가진 Edit 트리플은 무시된다', () => {
    const badTriple: ActionTriple = Object.freeze({
      tool: 'Edit',
      argKey: 'Edit:/foo.ts:not-a-hex!', // 잘못된 형식
      resultClass: 'ok',
      ref: Object.freeze({ uuid: 'u1', ts: 1000 }),
    })
    const result = buildEditDeltaMultiset([badTriple])
    expect(result.size).toBe(0)
  })

  it('콜론이 없는 argKey를 가진 Edit 트리플은 무시된다', () => {
    const badTriple: ActionTriple = Object.freeze({
      tool: 'Edit',
      argKey: 'Editnocolon',
      resultClass: 'ok',
      ref: Object.freeze({ uuid: 'u2', ts: 1000 }),
    })
    const result = buildEditDeltaMultiset([badTriple])
    expect(result.size).toBe(0)
  })

  it('16hex보다 짧은 suffix는 무시된다', () => {
    const shortHash: ActionTriple = Object.freeze({
      tool: 'Edit',
      argKey: 'Edit:/foo.ts:abcd', // 4자 (너무 짧음)
      resultClass: 'ok',
      ref: Object.freeze({ uuid: 'u3', ts: 1000 }),
    })
    const result = buildEditDeltaMultiset([shortHash])
    expect(result.size).toBe(0)
  })

  it('유효한 트리플과 잘못된 형식 트리플이 혼재 시 유효한 것만 처리된다', () => {
    const validDelta = 'ccccddddccccdddd'
    const validTriple = makeEditTriple('/src/valid.ts', validDelta)
    const badTriple: ActionTriple = Object.freeze({
      tool: 'Edit',
      argKey: 'Edit:/bad.ts:xyz',
      resultClass: 'ok',
      ref: Object.freeze({ uuid: 'bad-u', ts: 1000 }),
    })
    const result = buildEditDeltaMultiset([validTriple, badTriple])

    expect(result.size).toBe(1)
    expect(result.get(`Edit:/src/valid.ts:${validDelta}`)!.get(validDelta)).toBe(1)
  })
})

// ─── 결정론성 ────────────────────────────────────────────────

describe('buildEditDeltaMultiset — 결정론적', () => {
  it('동일 입력은 항상 동일한 구조를 반환한다', () => {
    const deltaHash = 'abcd1234abcd1234'
    const triples = [
      makeEditTriple('/src/foo.ts', deltaHash),
      makeEditTriple('/src/foo.ts', deltaHash),
    ]

    const r1 = buildEditDeltaMultiset(triples)
    const r2 = buildEditDeltaMultiset(triples)

    expect(r1.size).toBe(r2.size)
    for (const [key, inner1] of r1) {
      const inner2 = r2.get(key)
      expect(inner2).toBeDefined()
      for (const [dh, count] of inner1) {
        expect(inner2!.get(dh)).toBe(count)
      }
    }
  })
})

// ─── 입력 불변성 ──────────────────────────────────────────────

describe('buildEditDeltaMultiset — 입력 배열 불변성', () => {
  it('입력 배열을 수정하지 않는다', () => {
    const deltaHash = 'f0f0f0f0f0f0f0f0'
    const triples = [
      makeEditTriple('/src/a.ts', deltaHash),
      makeEditTriple('/src/b.ts', deltaHash),
    ]
    const originalLength = triples.length
    const originalFirst = triples[0]

    buildEditDeltaMultiset(triples)

    expect(triples.length).toBe(originalLength)
    expect(triples[0]).toBe(originalFirst)
  })
})
