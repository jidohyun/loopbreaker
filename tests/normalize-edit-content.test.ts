/**
 * tests/normalize-edit-content.test.ts
 *
 * normalizeEditContent() 단위 테스트
 *
 * Sub-AC 1 검증 범위:
 *   - 공백만 다른 입력 → 동일한 정규화 출력
 *   - 줄바꿈만 다른 입력 → 동일한 정규화 출력
 *   - 탭·CR·혼합 공백 → 동일한 정규화 출력
 *   - 선행/후행 공백 트림
 *   - 내용이 다른 입력 → 다른 정규화 출력 (오탐 방지)
 *   - 빈 문자열·공백 전용 문자열 엣지 케이스
 */

import { normalizeEditContent } from '../src/detect/triple-builder.js'

// ─── 공백 정규화 ─────────────────────────────────────────────

describe('normalizeEditContent — 공백 정규화', () => {
  it('연속 스페이스를 단일 스페이스로 붕괴한다', () => {
    expect(normalizeEditContent('const  x  =  1')).toBe(normalizeEditContent('const x = 1'))
  })

  it('탭 문자를 스페이스로 정규화한다', () => {
    expect(normalizeEditContent('const\tx\t=\t1')).toBe(normalizeEditContent('const x = 1'))
  })

  it('혼합 공백(스페이스+탭)을 정규화한다', () => {
    expect(normalizeEditContent('const \t x = 1')).toBe(normalizeEditContent('const x = 1'))
  })

  it('선행 공백을 트림한다', () => {
    expect(normalizeEditContent('   hello')).toBe('hello')
  })

  it('후행 공백을 트림한다', () => {
    expect(normalizeEditContent('hello   ')).toBe('hello')
  })

  it('양쪽 공백을 모두 트림한다', () => {
    expect(normalizeEditContent('  \t  hello world  \t  ')).toBe('hello world')
  })
})

// ─── 줄바꿈 정규화 ────────────────────────────────────────────

describe('normalizeEditContent — 줄바꿈 정규화', () => {
  it('줄바꿈(LF)만 다른 입력은 동일한 출력을 생성한다', () => {
    expect(normalizeEditContent('a\nb')).toBe(normalizeEditContent('a b'))
  })

  it('연속 줄바꿈을 단일 스페이스로 붕괴한다', () => {
    expect(normalizeEditContent('a\n\n\nb')).toBe(normalizeEditContent('a b'))
  })

  it('CR+LF(Windows 줄바꿈)를 정규화한다', () => {
    expect(normalizeEditContent('a\r\nb')).toBe(normalizeEditContent('a b'))
  })

  it('CR 단독 줄바꿈을 정규화한다', () => {
    expect(normalizeEditContent('a\rb')).toBe(normalizeEditContent('a b'))
  })

  it('줄바꿈·탭·스페이스 혼합을 정규화한다', () => {
    const messy = 'function foo() {\n  return 1\n}'
    const clean = 'function foo() { return 1 }'
    expect(normalizeEditContent(messy)).toBe(normalizeEditContent(clean))
  })

  it('들여쓰기 변경만 있는 두 입력은 동일한 출력을 생성한다', () => {
    const twoSpaceIndent = 'if (x) {\n  doSomething()\n}'
    const fourSpaceIndent = 'if (x) {\n    doSomething()\n}'
    expect(normalizeEditContent(twoSpaceIndent)).toBe(normalizeEditContent(fourSpaceIndent))
  })
})

// ─── 실제 코드 편집 시나리오 ──────────────────────────────────

describe('normalizeEditContent — 실제 코드 편집 시나리오', () => {
  it('공백만 다른 TypeScript 코드 스니펫은 동일하게 정규화된다', () => {
    // 토큰 사이 연속 공백만 다른 경우 — 토큰 내부 공백(괄호 내부 등)은 별개
    const v1 = 'const result = await fetch(url)'
    const v2 = 'const  result  =  await  fetch(url)'
    expect(normalizeEditContent(v1)).toBe(normalizeEditContent(v2))
  })

  it('줄바꿈 스타일만 다른 함수 정의는 동일하게 정규화된다', () => {
    const unix = 'export function run() {\n  return true\n}'
    const windows = 'export function run() {\r\n  return true\r\n}'
    expect(normalizeEditContent(unix)).toBe(normalizeEditContent(windows))
  })

  it('들여쓰기 방식만 다른 블록은 동일하게 정규화된다', () => {
    const spaces = '  const x = 1\n  const y = 2'
    const tabs = '\tconst x = 1\n\tconst y = 2'
    expect(normalizeEditContent(spaces)).toBe(normalizeEditContent(tabs))
  })
})

// ─── 내용이 다른 입력 — 오탐 방지 ────────────────────────────

describe('normalizeEditContent — 내용이 다른 입력은 다른 출력', () => {
  it('다른 토큰을 가진 입력은 다른 출력을 생성한다', () => {
    expect(normalizeEditContent('const x = 1')).not.toBe(normalizeEditContent('const x = 2'))
  })

  it('다른 변수명을 가진 입력은 다른 출력을 생성한다', () => {
    expect(normalizeEditContent('const foo = true')).not.toBe(normalizeEditContent('const bar = true'))
  })

  it('구조가 다른 코드는 다른 출력을 생성한다', () => {
    expect(normalizeEditContent('function foo() {}')).not.toBe(normalizeEditContent('const foo = () => {}'))
  })
})

// ─── 엣지 케이스 ─────────────────────────────────────────────

describe('normalizeEditContent — 엣지 케이스', () => {
  it('빈 문자열은 빈 문자열을 반환한다', () => {
    expect(normalizeEditContent('')).toBe('')
  })

  it('공백만 있는 문자열은 빈 문자열을 반환한다', () => {
    expect(normalizeEditContent('   ')).toBe('')
    expect(normalizeEditContent('\t\t\t')).toBe('')
    expect(normalizeEditContent('\n\n\n')).toBe('')
  })

  it('공백만 다른 두 문자열은 빈 문자열로 동일 정규화된다', () => {
    expect(normalizeEditContent('   ')).toBe(normalizeEditContent('\n\n'))
  })

  it('단일 단어는 그대로 반환한다', () => {
    expect(normalizeEditContent('hello')).toBe('hello')
  })

  it('정규화 결과의 앞뒤에 공백이 없다', () => {
    const result = normalizeEditContent('  foo  bar  ')
    expect(result.startsWith(' ')).toBe(false)
    expect(result.endsWith(' ')).toBe(false)
  })

  it('정규화 결과에 연속 공백이 없다', () => {
    const result = normalizeEditContent('a   b   c')
    expect(result).not.toMatch(/\s{2,}/)
  })
})
