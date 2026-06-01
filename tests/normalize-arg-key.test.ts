/**
 * tests/normalize-arg-key.test.ts
 *
 * Sub-AC 2a: normalizeArgKey 단위 테스트
 *
 * 검증 범위:
 *   - 파일경로 기반 도구(Edit, Read, Write)에서 canonical file_path 추출
 *   - path normalization: '..' 세그먼트 해소, trailing slash 제거, 중복 슬래시 정규화
 *   - 누락(missing) file_path → '<unknown_path>' 반환
 *   - 빈 문자열 file_path → '<unknown_path>' 반환
 *   - '..' 세그먼트가 있는 경로의 lexical 해소
 */

import { normalizeArgKey } from '../src/detect/triple-builder.js'

// ─── Happy path (Edit) ───────────────────────────────────────────

describe('normalizeArgKey — happy path', () => {
  it('절대경로를 그대로 반환한다', () => {
    const result = normalizeArgKey({ file_path: '/project/src/foo.ts' })
    expect(result).toBe('/project/src/foo.ts')
  })

  it('Read 도구 경로도 동일하게 정규화한다', () => {
    const result = normalizeArgKey({ file_path: '/home/user/project/bar.ts' })
    expect(result).toBe('/home/user/project/bar.ts')
  })

  it('Write 도구 경로도 정규화한다', () => {
    const result = normalizeArgKey({ file_path: '/output/file.json', content: 'data' })
    expect(result).toBe('/output/file.json')
  })

  it('중복 슬래시를 정규화한다', () => {
    const result = normalizeArgKey({ file_path: '/project//src//foo.ts' })
    expect(result).toBe('/project/src/foo.ts')
  })

  it('같은 경로는 항상 같은 결과를 반환한다 (결정론성)', () => {
    const args = { file_path: '/project/src/utils.ts' }
    expect(normalizeArgKey(args)).toBe(normalizeArgKey(args))
  })
})

// ─── 누락(missing) file_path ─────────────────────────────────────

describe('normalizeArgKey — missing file_path', () => {
  it('file_path 키가 없으면 <unknown_path>를 반환한다', () => {
    const result = normalizeArgKey({ old_string: 'a', new_string: 'b' })
    expect(result).toBe('<unknown_path>')
  })

  it('file_path 가 undefined이면 <unknown_path>를 반환한다', () => {
    const result = normalizeArgKey({ file_path: undefined })
    expect(result).toBe('<unknown_path>')
  })

  it('file_path 가 null이면 <unknown_path>를 반환한다', () => {
    const result = normalizeArgKey({ file_path: null })
    expect(result).toBe('<unknown_path>')
  })

  it('file_path 가 숫자이면 <unknown_path>를 반환한다', () => {
    const result = normalizeArgKey({ file_path: 42 })
    expect(result).toBe('<unknown_path>')
  })

  it('빈 args 객체이면 <unknown_path>를 반환한다', () => {
    const result = normalizeArgKey({})
    expect(result).toBe('<unknown_path>')
  })
})

// ─── 빈 문자열 file_path ─────────────────────────────────────────

describe('normalizeArgKey — empty string file_path', () => {
  it('빈 문자열 file_path는 <unknown_path>를 반환한다', () => {
    const result = normalizeArgKey({ file_path: '' })
    expect(result).toBe('<unknown_path>')
  })

  it('공백만 있는 문자열은 정규화된 경로로 반환된다 (공백 경로는 유효 문자열)', () => {
    // 공백 문자열은 빈 문자열이 아니므로 normalizePath()가 처리
    const result = normalizeArgKey({ file_path: ' ' })
    // node:path normalize(' ') → ' ' (공백은 유효 경로 문자)
    expect(result).toBe(' ')
  })
})

// ─── '..' 세그먼트 해소 ───────────────────────────────────────────

describe('normalizeArgKey — ".." 세그먼트 처리', () => {
  it('/a/b/../c를 /a/c로 해소한다', () => {
    const result = normalizeArgKey({ file_path: '/a/b/../c' })
    expect(result).toBe('/a/c')
  })

  it('/project/src/../../lib/utils.ts를 정규화한다', () => {
    const result = normalizeArgKey({ file_path: '/project/src/../../lib/utils.ts' })
    expect(result).toBe('/lib/utils.ts')
  })

  it('/a/./b/./c를 /a/b/c로 정규화한다 (단일점 제거)', () => {
    const result = normalizeArgKey({ file_path: '/a/./b/./c' })
    expect(result).toBe('/a/b/c')
  })

  it('복합: 중복 슬래시 + ".." 동시 처리', () => {
    const result = normalizeArgKey({ file_path: '/project//src/../lib/utils.ts' })
    expect(result).toBe('/project/lib/utils.ts')
  })

  it('경로 끝의 .. 처리: /a/b/c/.. → /a/b', () => {
    const result = normalizeArgKey({ file_path: '/a/b/c/..' })
    expect(result).toBe('/a/b')
  })
})

// ─── trailing slash 제거 ─────────────────────────────────────────

describe('normalizeArgKey — trailing slash 제거', () => {
  it('trailing slash를 제거한다', () => {
    const result = normalizeArgKey({ file_path: '/project/src/foo.ts/' })
    expect(result).toBe('/project/src/foo.ts')
  })

  it('디렉터리 경로의 trailing slash도 제거한다', () => {
    const result = normalizeArgKey({ file_path: '/project/src/' })
    expect(result).toBe('/project/src')
  })

  it('루트 "/" 는 그대로 유지한다', () => {
    const result = normalizeArgKey({ file_path: '/' })
    expect(result).toBe('/')
  })

  it('여러 개의 trailing slash를 제거한다', () => {
    const result = normalizeArgKey({ file_path: '/project/src///' })
    expect(result).toBe('/project/src')
  })
})

// ─── 상대경로 처리 ────────────────────────────────────────────────

describe('normalizeArgKey — 상대경로', () => {
  it('상대경로는 normalizePath()만 수행하고 반환한다', () => {
    // cwd 기준 절대화는 하지 않음 (동기 fs 필요) — lexical normalize만
    const result = normalizeArgKey({ file_path: 'src/foo.ts' })
    expect(result).toBe('src/foo.ts')
  })

  it('상대경로의 .. 세그먼트도 lexical 해소된다', () => {
    const result = normalizeArgKey({ file_path: 'src/../lib/utils.ts' })
    expect(result).toBe('lib/utils.ts')
  })
})

// ─── file_path 이외 필드 무시 검증 ───────────────────────────────

describe('normalizeArgKey — file_path 이외 필드 무시', () => {
  it('old_string/new_string 등 다른 필드가 있어도 file_path만 사용한다', () => {
    const result = normalizeArgKey({
      file_path: '/project/src/main.ts',
      old_string: 'const x = 1',
      new_string: 'const x = 2',
    })
    expect(result).toBe('/project/src/main.ts')
  })

  it('content 필드가 있어도 file_path만 사용한다', () => {
    const result = normalizeArgKey({
      file_path: '/project/output.json',
      content: '{"key": "value"}',
    })
    expect(result).toBe('/project/output.json')
  })
})
