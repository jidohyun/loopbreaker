/**
 * tests/compute-edit-delta-hash.test.ts
 *
 * computeEditDeltaHash() 단위 테스트
 *
 * Sub-AC 2 검증 범위:
 *   - 멀티셋 해시: 의미상 동일한 편집(공백/주석/줄바꿈만 다름) → 동일한 해시
 *   - 진짜 다른 편집(다른 토큰 변경) → 다른 해시 (오탐 방지)
 *   - 결정론적: 동일 입력은 항상 동일 출력
 *   - 반환 형식: SHA-256 hex 64자
 *   - 엣지 케이스: 빈 문자열, 공백 전용, 주석 전용
 */

import { computeEditDeltaHash } from '../src/detect/triple-builder.js'

// ─── 반환 형식 ────────────────────────────────────────────────────

describe('computeEditDeltaHash — 반환 형식', () => {
  it('SHA-256 hex 64자를 반환한다', () => {
    const hash = computeEditDeltaHash('const x = 1', 'const x = 2')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('항상 문자열을 반환한다', () => {
    expect(typeof computeEditDeltaHash('', '')).toBe('string')
  })
})

// ─── 결정론 ───────────────────────────────────────────────────────

describe('computeEditDeltaHash — 결정론적', () => {
  it('동일 입력은 항상 동일한 해시를 반환한다', () => {
    const h1 = computeEditDeltaHash('const x = 1', 'const x = 2')
    const h2 = computeEditDeltaHash('const x = 1', 'const x = 2')
    expect(h1).toBe(h2)
  })

  it('여러 번 호출해도 일관된 해시를 반환한다', () => {
    const input = { old: 'function foo() {}', new: 'function foo() { return 1 }' }
    const results = Array.from({ length: 5 }, () =>
      computeEditDeltaHash(input.old, input.new)
    )
    expect(new Set(results).size).toBe(1)
  })
})

// ─── 의미상 동일한 편집 → 같은 해시 ─────────────────────────────

describe('computeEditDeltaHash — 의미상 동일한 편집은 같은 해시', () => {
  it('공백만 다른 편집은 같은 해시를 생성한다', () => {
    const h1 = computeEditDeltaHash('const x = 1', 'const x = 2')
    const h2 = computeEditDeltaHash('const  x  =  1', 'const  x  =  2')
    expect(h1).toBe(h2)
  })

  it('줄바꿈(LF)만 다른 편집은 같은 해시를 생성한다', () => {
    const h1 = computeEditDeltaHash('a b c', 'a b d')
    const h2 = computeEditDeltaHash('a\nb\nc', 'a\nb\nd')
    expect(h1).toBe(h2)
  })

  it('CR+LF vs LF 줄바꿈 차이는 같은 해시를 생성한다', () => {
    const h1 = computeEditDeltaHash('a\nb\nc', 'a\nb\nd')
    const h2 = computeEditDeltaHash('a\r\nb\r\nc', 'a\r\nb\r\nd')
    expect(h1).toBe(h2)
  })

  it('탭 들여쓰기 vs 스페이스 들여쓰기 차이는 같은 해시를 생성한다', () => {
    const h1 = computeEditDeltaHash('  const x = 1', '  const x = 2')
    const h2 = computeEditDeltaHash('\tconst x = 1', '\tconst x = 2')
    expect(h1).toBe(h2)
  })

  it('들여쓰기 깊이만 다른 편집은 같은 해시를 생성한다', () => {
    const h1 = computeEditDeltaHash('  return x', '  return y')
    const h2 = computeEditDeltaHash('    return x', '    return y')
    expect(h1).toBe(h2)
  })

  it('줄 끝 공백만 다른 편집은 같은 해시를 생성한다', () => {
    const h1 = computeEditDeltaHash('const x = 1', 'const x = 2')
    const h2 = computeEditDeltaHash('const x = 1   ', 'const x = 2   ')
    expect(h1).toBe(h2)
  })

  it('줄 주석(// ...)만 다른 편집은 같은 해시를 생성한다', () => {
    // 주석 내용이 달라도 나머지 토큰 변경이 같으면 동일 해시
    const h1 = computeEditDeltaHash(
      'const x = 1 // old value',
      'const x = 2 // new value',
    )
    const h2 = computeEditDeltaHash(
      'const x = 1 // different comment',
      'const x = 2 // another comment',
    )
    expect(h1).toBe(h2)
  })

  it('블록 주석(/* ... */)만 다른 편집은 같은 해시를 생성한다', () => {
    const h1 = computeEditDeltaHash(
      '/* v1 */ const x = 1',
      '/* v1 */ const x = 2',
    )
    const h2 = computeEditDeltaHash(
      '/* v2 */ const x = 1',
      '/* v2 */ const x = 2',
    )
    expect(h1).toBe(h2)
  })

  it('토큰 순서(멀티셋)가 같으면 순서 무관 같은 해시를 생성한다', () => {
    // editDelta는 멀티셋(순서 무시) → add/remove 집합이 같으면 동일
    // "a b" → "b a"는 토큰 a를 제거하고 a를 추가, b를 제거하고 b를 추가
    // add/remove 집합이 비어있음 → 같은 해시
    const h1 = computeEditDeltaHash('a b', 'b a')
    const h2 = computeEditDeltaHash('x y', 'y x')
    // 두 경우 모두 delta가 비어있으므로 같은 해시
    expect(h1).toBe(h2)
  })

  it('실제 코드 - 공백 스타일만 다른 TypeScript 함수 수정은 같은 해시', () => {
    const h1 = computeEditDeltaHash(
      'export function run(): boolean {\n  return false\n}',
      'export function run(): boolean {\n  return true\n}',
    )
    const h2 = computeEditDeltaHash(
      'export function run(): boolean { return false }',
      'export function run(): boolean { return true }',
    )
    expect(h1).toBe(h2)
  })
})

// ─── 진짜 다른 편집 → 다른 해시 (오탐 방지) ──────────────────────

describe('computeEditDeltaHash — 진짜 다른 편집은 다른 해시', () => {
  it('변경되는 토큰이 다르면 다른 해시를 생성한다', () => {
    const h1 = computeEditDeltaHash('const x = 1', 'const x = 2')
    const h2 = computeEditDeltaHash('const x = 1', 'const x = 3')
    expect(h1).not.toBe(h2)
  })

  it('변경 대상 토큰 자체가 다르면 다른 해시를 생성한다', () => {
    // foo → bar 로 바꾸는 편집 vs baz → qux 로 바꾸는 편집
    const h1 = computeEditDeltaHash('const foo = 1', 'const bar = 1')
    const h2 = computeEditDeltaHash('const baz = 1', 'const qux = 1')
    expect(h1).not.toBe(h2)
  })

  it('추가되는 토큰이 다르면 다른 해시를 생성한다', () => {
    // 두 경우 모두 y를 z로 바꾸지만, 추가로 다른 토큰도 바뀜
    const h1 = computeEditDeltaHash('x + y', 'x * y')
    const h2 = computeEditDeltaHash('a + y', 'a / y')
    expect(h1).not.toBe(h2)
  })

  it('old/new를 바꾸면 다른 해시를 생성한다 (방향성 보존)', () => {
    const h1 = computeEditDeltaHash('const x = 1', 'const x = 2')
    const h2 = computeEditDeltaHash('const x = 2', 'const x = 1')
    expect(h1).not.toBe(h2)
  })

  it('추가 토큰이 있으면 다른 해시를 생성한다', () => {
    const h1 = computeEditDeltaHash('return x', 'return x + 1')
    const h2 = computeEditDeltaHash('return x', 'return x + 2')
    expect(h1).not.toBe(h2)
  })

  it('구조가 다른 편집은 다른 해시를 생성한다', () => {
    const h1 = computeEditDeltaHash('function foo() {}', 'function foo() { return 1 }')
    const h2 = computeEditDeltaHash('class Foo {}', 'class Foo { method() {} }')
    expect(h1).not.toBe(h2)
  })

  it('추가 토큰 수가 다르면 다른 해시를 생성한다', () => {
    const h1 = computeEditDeltaHash('a', 'a b')
    const h2 = computeEditDeltaHash('a', 'a b c')
    expect(h1).not.toBe(h2)
  })

  it('다른 파일을 편집하는 시나리오 — 토큰 변경이 달라 다른 해시', () => {
    // file_path는 computeEditDeltaHash 인수로 받지 않지만,
    // 서로 다른 코드 내용 → 다른 해시임을 확인
    const h1 = computeEditDeltaHash('export const VERSION = "1.0"', 'export const VERSION = "2.0"')
    const h2 = computeEditDeltaHash('export const NAME = "foo"', 'export const NAME = "bar"')
    expect(h1).not.toBe(h2)
  })
})

// ─── 미세변형 그룹화 시나리오 (핵심 오탐 방지) ────────────────────

describe('computeEditDeltaHash — 미세변형 그룹화로 오탐 방지', () => {
  it('실제 thrashing 시나리오: 같은 편집을 약간씩 달리 시도해도 같은 해시 그룹', () => {
    // 에이전트가 같은 버그를 고치면서 공백·주석만 달라지는 경우
    const attempt1 = computeEditDeltaHash(
      'if (x > 0) { return x }',
      'if (x > 0) { return -x }',
    )
    const attempt2 = computeEditDeltaHash(
      'if (x > 0) {\n  return x\n}',
      'if (x > 0) {\n  return -x\n}',
    )
    const attempt3 = computeEditDeltaHash(
      'if (x > 0) {\n    return x  // positive\n}',
      'if (x > 0) {\n    return -x  // negate\n}',
    )
    // 공백·줄바꿈·주석만 다르고 토큰 변경(return x → return -x)은 동일
    expect(attempt1).toBe(attempt2)
    expect(attempt2).toBe(attempt3)
  })

  it('같은 토큰을 다른 횟수로 추가하면 다른 그룹', () => {
    // 1개 추가 vs 2개 추가는 다른 변경
    const h1 = computeEditDeltaHash('a', 'a b')
    const h2 = computeEditDeltaHash('a', 'a b b')
    expect(h1).not.toBe(h2)
  })

  it('thrashing 탐지: 완전히 동일한 편집이 반복되면 항상 같은 해시 그룹', () => {
    const hashes = Array.from({ length: 3 }, () =>
      computeEditDeltaHash(
        'const result = oldFunction()',
        'const result = newFunction()',
      )
    )
    expect(new Set(hashes).size).toBe(1)
  })
})

// ─── 엣지 케이스 ─────────────────────────────────────────────────

describe('computeEditDeltaHash — 엣지 케이스', () => {
  it('빈 문자열 → 빈 문자열 편집은 결정론적 해시를 반환한다', () => {
    const h1 = computeEditDeltaHash('', '')
    const h2 = computeEditDeltaHash('', '')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('공백 전용 문자열은 빈 문자열과 동일한 해시를 반환한다', () => {
    // collapseWS 후 빈 문자열이 됨 → delta도 같아짐
    const h1 = computeEditDeltaHash('', '')
    const h2 = computeEditDeltaHash('   ', '   ')
    expect(h1).toBe(h2)
  })

  it('주석만 제거하는 편집(코드 변경 없음)은 no-op과 같은 해시', () => {
    // old: "const x = 1 // comment" → new: "const x = 1"
    // stripComments 후 두 경우 모두 "const x = 1" → delta 없음
    const hNoOp = computeEditDeltaHash('const x = 1', 'const x = 1')
    const hRemoveComment = computeEditDeltaHash(
      'const x = 1 // this is a comment',
      'const x = 1',
    )
    expect(hNoOp).toBe(hRemoveComment)
  })

  it('no-op 편집(old === new)은 항상 같은 해시 반환', () => {
    const code = 'export default function main() { return 42 }'
    const h = computeEditDeltaHash(code, code)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    // 항상 같은 hash
    expect(computeEditDeltaHash(code, code)).toBe(h)
  })

  it('old가 빈 문자열이면 순수 추가 편집으로 처리된다', () => {
    const h1 = computeEditDeltaHash('', 'const x = 1')
    const h2 = computeEditDeltaHash('', 'const x = 2')
    // 다른 토큰 추가 → 다른 해시
    expect(h1).not.toBe(h2)
  })

  it('new가 빈 문자열이면 순수 삭제 편집으로 처리된다', () => {
    const h1 = computeEditDeltaHash('const x = 1', '')
    const h2 = computeEditDeltaHash('const x = 2', '')
    // 다른 토큰 삭제 → 다른 해시
    expect(h1).not.toBe(h2)
  })

  it('추가와 삭제 방향이 다르면 다른 해시', () => {
    // "x 추가" vs "x 삭제"
    const hAdd = computeEditDeltaHash('', 'token')
    const hRemove = computeEditDeltaHash('token', '')
    expect(hAdd).not.toBe(hRemove)
  })
})
