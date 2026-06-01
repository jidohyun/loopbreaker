/**
 * tests/normalize-arg-key-sub-ac-2c.test.ts
 *
 * Sub-AC 2c: normalizeArgKeyForTool 단위 테스트
 *
 * 검증 범위:
 *   - Grep: pattern 필드로 argKey 생성, 형식 "Grep:{16hex}"
 *   - Glob: pattern 필드로 argKey 생성, 형식 "Glob:{16hex}"
 *   - Agent: stableStringify 해시, 형식 "Agent:{16hex}"
 *   - 기타 비파일/비배시 도구(mcp__*, Task, WebFetch 등): default 핸들러
 *   - 각 도구의 happy path + missing/empty 인자 엣지 케이스
 *
 * SPEC §4 §1a 규칙:
 *   - Read/Glob/Grep: tool + ":" + sha256(normPath(file_path ?? pattern))[:16]
 *   - default (Agent, mcp__*, 미지 도구): tool + ":" + sha256(stableStringify(input))[:16]
 */

import { normalizeArgKeyForTool, _internal } from '../src/detect/triple-builder.js'

// ─── 헬퍼 ──────────────────────────────────────────────────────

const HEX16 = /^[0-9a-f]{16}$/

// ─── Grep ────────────────────────────────────────────────────────

describe('normalizeArgKeyForTool — Grep', () => {
  // happy path
  it('pattern 필드로 argKey를 생성한다', () => {
    const key = normalizeArgKeyForTool('Grep', { pattern: 'TODO', path: '/project/src' })
    expect(key).toMatch(/^Grep:[0-9a-f]{16}$/)
  })

  it('같은 pattern은 항상 같은 argKey를 반환한다 (결정론성)', () => {
    const key1 = normalizeArgKeyForTool('Grep', { pattern: 'function\\s+\\w+', path: '/src' })
    const key2 = normalizeArgKeyForTool('Grep', { pattern: 'function\\s+\\w+', path: '/src' })
    expect(key1).toBe(key2)
  })

  it('다른 pattern은 다른 argKey를 반환한다', () => {
    const key1 = normalizeArgKeyForTool('Grep', { pattern: 'TODO' })
    const key2 = normalizeArgKeyForTool('Grep', { pattern: 'FIXME' })
    expect(key1).not.toBe(key2)
  })

  it('argKey 형식은 "Grep:{16hex}"이다', () => {
    const key = normalizeArgKeyForTool('Grep', { pattern: '.*\\.ts$' })
    const [prefix, hash] = key.split(':')
    expect(prefix).toBe('Grep')
    expect(hash).toMatch(HEX16)
  })

  it('path 필드가 달라도 pattern이 같으면 argKey가 같다 (path는 volatile, pattern이 기준)', () => {
    // SPEC §4 §1a: Read|Glob|Grep은 file_path ?? pattern을 기준으로 hash
    // Grep input에 file_path가 없으면 pattern을 사용
    const key1 = normalizeArgKeyForTool('Grep', { pattern: 'console\\.log', path: '/src' })
    const key2 = normalizeArgKeyForTool('Grep', { pattern: 'console\\.log', path: '/lib' })
    // argKeyReadFamily: file_path ?? pattern → file_path 없으므로 pattern 기준
    expect(key1).toBe(key2)
  })

  it('file_path가 있으면 file_path가 기준이 된다', () => {
    const keyWithFilePath = normalizeArgKeyForTool('Grep', { pattern: 'TODO', file_path: '/project/src/foo.ts' })
    const keyWithoutFilePath = normalizeArgKeyForTool('Grep', { pattern: 'TODO' })
    // file_path가 있으면 normPath(file_path)가 기준 — pattern이 같아도 키가 달라진다
    expect(keyWithFilePath).not.toBe(keyWithoutFilePath)
  })

  // missing/empty 엣지 케이스
  it('pattern이 없고 file_path도 없으면 stableStringify 기반 argKey를 반환한다', () => {
    const key = normalizeArgKeyForTool('Grep', {})
    expect(key).toMatch(/^Grep:[0-9a-f]{16}$/)
  })

  it('pattern이 undefined이면 stableStringify 폴백으로 argKey를 반환한다', () => {
    const key = normalizeArgKeyForTool('Grep', { pattern: undefined })
    expect(key).toMatch(/^Grep:[0-9a-f]{16}$/)
  })

  it('pattern이 빈 문자열이면 정규화된 argKey를 반환한다 (빈 값도 결정론적)', () => {
    const key1 = normalizeArgKeyForTool('Grep', { pattern: '' })
    const key2 = normalizeArgKeyForTool('Grep', { pattern: '' })
    expect(key1).toBe(key2)
    expect(key1).toMatch(/^Grep:[0-9a-f]{16}$/)
  })

  it('input이 빈 객체여도 argKey를 반환한다', () => {
    const key = normalizeArgKeyForTool('Grep', {})
    expect(typeof key).toBe('string')
    expect(key.startsWith('Grep:')).toBe(true)
  })
})

// ─── Glob ────────────────────────────────────────────────────────

describe('normalizeArgKeyForTool — Glob', () => {
  // happy path
  it('pattern 필드로 argKey를 생성한다', () => {
    const key = normalizeArgKeyForTool('Glob', { pattern: '**/*.ts' })
    expect(key).toMatch(/^Glob:[0-9a-f]{16}$/)
  })

  it('같은 pattern은 항상 같은 argKey를 반환한다 (결정론성)', () => {
    const key1 = normalizeArgKeyForTool('Glob', { pattern: 'src/**/*.test.ts' })
    const key2 = normalizeArgKeyForTool('Glob', { pattern: 'src/**/*.test.ts' })
    expect(key1).toBe(key2)
  })

  it('다른 pattern은 다른 argKey를 반환한다', () => {
    const key1 = normalizeArgKeyForTool('Glob', { pattern: '**/*.ts' })
    const key2 = normalizeArgKeyForTool('Glob', { pattern: '**/*.js' })
    expect(key1).not.toBe(key2)
  })

  it('argKey 형식은 "Glob:{16hex}"이다', () => {
    const key = normalizeArgKeyForTool('Glob', { pattern: '**/*.json' })
    const [prefix, hash] = key.split(':')
    expect(prefix).toBe('Glob')
    expect(hash).toMatch(HEX16)
  })

  it('Glob과 Grep은 같은 pattern이라도 다른 argKey를 반환한다', () => {
    const keyGlob = normalizeArgKeyForTool('Glob', { pattern: '*.ts' })
    const keyGrep = normalizeArgKeyForTool('Grep', { pattern: '*.ts' })
    expect(keyGlob).not.toBe(keyGrep)
    expect(keyGlob).toMatch(/^Glob:/)
    expect(keyGrep).toMatch(/^Grep:/)
  })

  it('Glob과 Read는 같은 경로라도 다른 argKey를 반환한다', () => {
    const keyGlob = normalizeArgKeyForTool('Glob', { pattern: '/project/src/foo.ts' })
    const keyRead = normalizeArgKeyForTool('Read', { file_path: '/project/src/foo.ts' })
    expect(keyGlob).not.toBe(keyRead)
  })

  // missing/empty 엣지 케이스
  it('pattern이 없으면 stableStringify 폴백으로 argKey를 반환한다', () => {
    const key = normalizeArgKeyForTool('Glob', {})
    expect(key).toMatch(/^Glob:[0-9a-f]{16}$/)
  })

  it('pattern이 undefined이면 argKey를 반환한다', () => {
    const key = normalizeArgKeyForTool('Glob', { pattern: undefined })
    expect(key).toMatch(/^Glob:[0-9a-f]{16}$/)
  })

  it('pattern이 빈 문자열이면 결정론적 argKey를 반환한다', () => {
    const key1 = normalizeArgKeyForTool('Glob', { pattern: '' })
    const key2 = normalizeArgKeyForTool('Glob', { pattern: '' })
    expect(key1).toBe(key2)
    expect(key1).toMatch(/^Glob:[0-9a-f]{16}$/)
  })

  it('path 필드가 추가로 있어도 pattern 기준으로 동일 argKey', () => {
    // Glob input에 file_path가 없으면 pattern 기준
    const key1 = normalizeArgKeyForTool('Glob', { pattern: '**/*.ts' })
    const key2 = normalizeArgKeyForTool('Glob', { pattern: '**/*.ts', path: '/some/dir' })
    expect(key1).toBe(key2)
  })
})

// ─── Agent ───────────────────────────────────────────────────────

describe('normalizeArgKeyForTool — Agent', () => {
  // happy path
  it('Agent 입력으로 argKey를 생성한다', () => {
    const key = normalizeArgKeyForTool('Agent', {
      description: 'Run tests',
      prompt: 'Run the test suite and report failures',
    })
    expect(key).toMatch(/^Agent:[0-9a-f]{16}$/)
  })

  it('같은 Agent 입력은 같은 argKey를 반환한다 (결정론성)', () => {
    const input = { description: 'Code review', prompt: 'Review the diff for bugs' }
    const key1 = normalizeArgKeyForTool('Agent', input)
    const key2 = normalizeArgKeyForTool('Agent', input)
    expect(key1).toBe(key2)
  })

  it('다른 Agent 입력은 다른 argKey를 반환한다', () => {
    const key1 = normalizeArgKeyForTool('Agent', { prompt: 'Run tests' })
    const key2 = normalizeArgKeyForTool('Agent', { prompt: 'Build project' })
    expect(key1).not.toBe(key2)
  })

  it('argKey 형식은 "Agent:{16hex}"이다', () => {
    const key = normalizeArgKeyForTool('Agent', { prompt: 'hello' })
    const [prefix, hash] = key.split(':')
    expect(prefix).toBe('Agent')
    expect(hash).toMatch(HEX16)
  })

  it('키 순서가 달라도 같은 내용이면 같은 argKey (stableStringify 정렬)', () => {
    // stableStringify는 키를 정렬하므로 순서가 달라도 동일 결과
    const key1 = normalizeArgKeyForTool('Agent', { a: 1, b: 2 })
    const key2 = normalizeArgKeyForTool('Agent', { b: 2, a: 1 })
    expect(key1).toBe(key2)
  })

  it('큰 payload도 sha256:<hex> 축약 후 fingerprint로 argKey 생성', () => {
    // payload가 LARGE_PAYLOAD_THRESHOLD(256바이트)를 넘으면 sha256:<hex>로 축약
    const largeInput = { prompt: 'x'.repeat(500) }
    const key = normalizeArgKeyForTool('Agent', largeInput)
    expect(key).toMatch(/^Agent:[0-9a-f]{16}$/)
  })

  // missing/empty 엣지 케이스
  it('빈 객체 입력에도 argKey를 반환한다', () => {
    const key = normalizeArgKeyForTool('Agent', {})
    expect(key).toMatch(/^Agent:[0-9a-f]{16}$/)
  })

  it('null값 필드가 있어도 argKey를 반환한다', () => {
    const key = normalizeArgKeyForTool('Agent', { prompt: null })
    expect(key).toMatch(/^Agent:[0-9a-f]{16}$/)
  })

  it('undefined값 필드가 있어도 argKey를 반환한다', () => {
    const key = normalizeArgKeyForTool('Agent', { prompt: undefined })
    expect(key).toMatch(/^Agent:[0-9a-f]{16}$/)
  })

  it('숫자/불리언 값이 포함된 입력에도 argKey를 반환한다', () => {
    const key = normalizeArgKeyForTool('Agent', { count: 3, enabled: true })
    expect(key).toMatch(/^Agent:[0-9a-f]{16}$/)
  })
})

// ─── 기타 비파일/비배시 도구 ─────────────────────────────────────

describe('normalizeArgKeyForTool — 기타 비파일/비배시 도구', () => {
  // Task 도구
  it('Task 도구에 대해 "{tool}:{16hex}" 형식 argKey를 생성한다', () => {
    const key = normalizeArgKeyForTool('Task', { description: 'Fix bug', status: 'in_progress' })
    expect(key).toMatch(/^Task:[0-9a-f]{16}$/)
  })

  it('Task 도구의 같은 입력은 같은 argKey', () => {
    const input = { id: 'task-001', status: 'done' }
    expect(normalizeArgKeyForTool('Task', input)).toBe(normalizeArgKeyForTool('Task', input))
  })

  // WebFetch 도구
  it('WebFetch 도구에 대해 "{tool}:{16hex}" 형식 argKey를 생성한다', () => {
    const key = normalizeArgKeyForTool('WebFetch', { url: 'https://example.com', method: 'GET' })
    expect(key).toMatch(/^WebFetch:[0-9a-f]{16}$/)
  })

  it('WebFetch 같은 URL은 같은 argKey', () => {
    const key1 = normalizeArgKeyForTool('WebFetch', { url: 'https://example.com' })
    const key2 = normalizeArgKeyForTool('WebFetch', { url: 'https://example.com' })
    expect(key1).toBe(key2)
  })

  it('WebFetch 다른 URL은 다른 argKey', () => {
    const key1 = normalizeArgKeyForTool('WebFetch', { url: 'https://example.com' })
    const key2 = normalizeArgKeyForTool('WebFetch', { url: 'https://other.com' })
    expect(key1).not.toBe(key2)
  })

  // WebSearch 도구
  it('WebSearch 도구에 대해 argKey를 생성한다', () => {
    const key = normalizeArgKeyForTool('WebSearch', { query: 'TypeScript generics' })
    expect(key).toMatch(/^WebSearch:[0-9a-f]{16}$/)
  })

  // mcp__* 네임스페이스 도구
  it('mcp__* 도구에 대해 "{tool}:{16hex}" 형식 argKey를 생성한다', () => {
    const key = normalizeArgKeyForTool('mcp__github__create_issue', {
      title: 'Bug report',
      body: 'Something broke',
    })
    expect(key).toMatch(/^mcp__github__create_issue:[0-9a-f]{16}$/)
  })

  it('같은 mcp 입력은 같은 argKey', () => {
    const key1 = normalizeArgKeyForTool('mcp__slack__send', { channel: '#dev', text: 'hello' })
    const key2 = normalizeArgKeyForTool('mcp__slack__send', { channel: '#dev', text: 'hello' })
    expect(key1).toBe(key2)
  })

  it('다른 mcp 입력은 다른 argKey', () => {
    const key1 = normalizeArgKeyForTool('mcp__slack__send', { channel: '#dev', text: 'hello' })
    const key2 = normalizeArgKeyForTool('mcp__slack__send', { channel: '#dev', text: 'world' })
    expect(key1).not.toBe(key2)
  })

  // 미지(unknown) 도구
  it('미지(unknown) 도구 이름에도 argKey를 생성한다', () => {
    const key = normalizeArgKeyForTool('SomeFutureTool', { data: 'value' })
    expect(key).toMatch(/^SomeFutureTool:[0-9a-f]{16}$/)
  })

  // empty/missing 엣지 케이스
  it('빈 객체 입력에도 argKey를 반환한다 (default 핸들러)', () => {
    const key = normalizeArgKeyForTool('Task', {})
    expect(key).toMatch(/^Task:[0-9a-f]{16}$/)
  })

  it('null 값이 포함된 입력에도 argKey를 반환한다', () => {
    const key = normalizeArgKeyForTool('WebFetch', { url: null })
    expect(key).toMatch(/^WebFetch:[0-9a-f]{16}$/)
  })

  it('undefined 값이 포함된 입력에도 argKey를 반환한다', () => {
    const key = normalizeArgKeyForTool('WebSearch', { query: undefined })
    expect(key).toMatch(/^WebSearch:[0-9a-f]{16}$/)
  })

  it('다른 도구 이름이면 같은 입력이라도 다른 argKey', () => {
    const input = { data: 'same' }
    const key1 = normalizeArgKeyForTool('ToolA', input)
    const key2 = normalizeArgKeyForTool('ToolB', input)
    expect(key1).not.toBe(key2)
  })
})

// ─── Grep, Glob, Agent, 기타 간 상호 분리성 확인 ─────────────────

describe('normalizeArgKeyForTool — 도구 간 분리성', () => {
  it('Grep과 Glob은 같은 pattern이라도 다른 prefix를 가진다', () => {
    const pattern = '**/*.ts'
    const grepKey = normalizeArgKeyForTool('Grep', { pattern })
    const globKey = normalizeArgKeyForTool('Glob', { pattern })
    expect(grepKey.startsWith('Grep:')).toBe(true)
    expect(globKey.startsWith('Glob:')).toBe(true)
    expect(grepKey).not.toBe(globKey)
  })

  it('Agent와 Task는 같은 입력이라도 다른 argKey', () => {
    const input = { prompt: 'do work' }
    const agentKey = normalizeArgKeyForTool('Agent', input)
    const taskKey = normalizeArgKeyForTool('Task', input)
    expect(agentKey.startsWith('Agent:')).toBe(true)
    expect(taskKey.startsWith('Task:')).toBe(true)
    expect(agentKey).not.toBe(taskKey)
  })

  it('Grep과 Agent는 도구 prefix로 구분된다', () => {
    const grepKey = normalizeArgKeyForTool('Grep', { pattern: 'test' })
    const agentKey = normalizeArgKeyForTool('Agent', { pattern: 'test' })
    expect(grepKey.startsWith('Grep:')).toBe(true)
    expect(agentKey.startsWith('Agent:')).toBe(true)
    expect(grepKey).not.toBe(agentKey)
  })

  it('Read와 Glob은 같은 경로여도 다른 argKey', () => {
    const readKey = normalizeArgKeyForTool('Read', { file_path: '/src/foo.ts' })
    const globKey = normalizeArgKeyForTool('Glob', { pattern: '/src/foo.ts' })
    expect(readKey.startsWith('Read:')).toBe(true)
    expect(globKey.startsWith('Glob:')).toBe(true)
    expect(readKey).not.toBe(globKey)
  })
})

// ─── _internal.normalizeArgKeyForTool 노출 확인 ──────────────────

describe('_internal — normalizeArgKeyForTool 노출', () => {
  it('_internal에 normalizeArgKeyForTool가 존재한다', () => {
    expect(typeof _internal.normalizeArgKeyForTool).toBe('function')
  })

  it('_internal.normalizeArgKeyForTool은 top-level normalizeArgKeyForTool과 동일하다', () => {
    const key1 = normalizeArgKeyForTool('Grep', { pattern: 'hello' })
    const key2 = _internal.normalizeArgKeyForTool('Grep', { pattern: 'hello' })
    expect(key1).toBe(key2)
  })
})

// ─── Grep/Glob 경로 정규화 통합 확인 ─────────────────────────────

describe('normalizeArgKeyForTool — Grep/Glob 경로 정규화', () => {
  it('Grep: ".." 세그먼트가 있는 pattern도 정규화된 argKey를 반환한다', () => {
    // normPath()가 적용되므로 같은 logical path는 같은 결과
    const key1 = normalizeArgKeyForTool('Grep', { file_path: '/a/b/../c.ts' })
    const key2 = normalizeArgKeyForTool('Grep', { file_path: '/a/c.ts' })
    expect(key1).toBe(key2)
  })

  it('Glob: 중복 슬래시 pattern은 정규화된 argKey를 반환한다', () => {
    const key1 = normalizeArgKeyForTool('Glob', { pattern: '/src//lib//*.ts' })
    const key2 = normalizeArgKeyForTool('Glob', { pattern: '/src/lib/*.ts' })
    // normPath는 pattern에 직접 적용됨
    expect(key1).toBe(key2)
  })

  it('Grep: 같은 논리 경로지만 trailing slash 차이는 흡수된다', () => {
    const key1 = normalizeArgKeyForTool('Grep', { file_path: '/project/src/' })
    const key2 = normalizeArgKeyForTool('Grep', { file_path: '/project/src' })
    expect(key1).toBe(key2)
  })
})
