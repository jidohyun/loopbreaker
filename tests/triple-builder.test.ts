/**
 * tests/triple-builder.test.ts
 *
 * buildTriple() 단위 테스트
 *
 * 검증 범위:
 *   - 지원하는 tool 이벤트(Edit, Bash, Read, Glob, Grep, Write, mcp__*)에서 ActionTriple 생성
 *   - null 반환 케이스 (tool_use 아닌 kind, tool 필드 없음)
 *   - argKey 정규화: 미세변형 그룹화(같은 편집 의도 → 같은 argKey)
 *   - Bash 휘발성 인자 마스킹 → 타임스탬프/포트 차이에도 같은 argKey
 *   - contracts ActionTriple 타입 구조 일치
 */

import { buildTriple, _internal } from '../src/detect/triple-builder.js'
import type { NormalizedEvent } from '../src/contracts.js'

// ─── 테스트 픽스처 ─────────────────────────────────────────────

function makeEvent(overrides: Partial<NormalizedEvent> & { kind: NormalizedEvent['kind'] }): NormalizedEvent {
  return {
    uuid: 'uuid-001',
    parentUuid: null,
    sessionId: 'sess-001',
    cwd: '/project',
    agentScope: 'root',
    isSidechain: false,
    ts: 1700000000000,
    byteOffset: 0,
    ...overrides,
  }
}

function makeToolUse(
  tool: string,
  input: Record<string, unknown>,
  opts: Partial<NormalizedEvent> = {},
): NormalizedEvent {
  return makeEvent({
    kind: 'tool_use',
    tool,
    input,
    ...opts,
  })
}

// ─── null 반환 케이스 ────────────────────────────────────────────

describe('buildTriple — null 반환', () => {
  it('kind=user 이벤트는 null을 반환한다', () => {
    const ev = makeEvent({ kind: 'user', text: 'hello' })
    expect(buildTriple(ev)).toBeNull()
  })

  it('kind=assistant 이벤트는 null을 반환한다', () => {
    const ev = makeEvent({ kind: 'assistant', text: 'done' })
    expect(buildTriple(ev)).toBeNull()
  })

  it('kind=tool_result 이벤트는 null을 반환한다', () => {
    const ev = makeEvent({ kind: 'tool_result', resultClass: 'ok' })
    expect(buildTriple(ev)).toBeNull()
  })

  it('kind=system 이벤트는 null을 반환한다', () => {
    const ev = makeEvent({ kind: 'system', systemSubtype: 'turn_duration' })
    expect(buildTriple(ev)).toBeNull()
  })

  it('kind=other 이벤트는 null을 반환한다', () => {
    const ev = makeEvent({ kind: 'other' })
    expect(buildTriple(ev)).toBeNull()
  })

  it('tool_use인데 tool 필드가 없으면 null을 반환한다', () => {
    const ev = makeEvent({ kind: 'tool_use', input: { command: 'ls' } })
    // tool 필드를 undefined로 — 타입 우회
    expect(buildTriple(ev)).toBeNull()
  })
})

// ─── ActionTriple 구조 검증 ──────────────────────────────────────

describe('buildTriple — ActionTriple 구조', () => {
  it('Edit 이벤트에서 ActionTriple을 반환하고 모든 필드가 존재한다', () => {
    const ev = makeToolUse('Edit', {
      file_path: '/project/src/foo.ts',
      old_string: 'const x = 1',
      new_string: 'const x = 2',
    })
    const triple = buildTriple(ev)
    expect(triple).not.toBeNull()
    expect(typeof triple!.tool).toBe('string')
    expect(typeof triple!.argKey).toBe('string')
    expect(typeof triple!.resultClass).toBe('string')
    expect(typeof triple!.ref.uuid).toBe('string')
    expect(typeof triple!.ref.ts).toBe('number')
  })

  it('ref.uuid, ref.ts가 이벤트의 uuid, ts와 일치한다', () => {
    const ev = makeToolUse('Read', { file_path: '/project/src/bar.ts' }, { uuid: 'uuid-abc', ts: 9999 })
    const triple = buildTriple(ev)
    expect(triple!.ref.uuid).toBe('uuid-abc')
    expect(triple!.ref.ts).toBe(9999)
  })

  it('tool_use에 resultClass가 없으면 "unknown"을 사용한다', () => {
    const ev = makeToolUse('Read', { file_path: '/foo.ts' })
    const triple = buildTriple(ev)
    expect(triple!.resultClass).toBe('unknown')
  })

  it('tool_use에 resultClass가 있으면 그것을 사용한다', () => {
    const ev = makeToolUse('Read', { file_path: '/foo.ts' }, { resultClass: 'error' })
    const triple = buildTriple(ev)
    expect(triple!.resultClass).toBe('error')
  })

  it('반환된 triple은 동결(frozen)되어 있다', () => {
    const ev = makeToolUse('Bash', { command: 'npm test' })
    const triple = buildTriple(ev)!
    expect(Object.isFrozen(triple)).toBe(true)
    expect(Object.isFrozen(triple.ref)).toBe(true)
  })
})

// ─── Edit argKey 미세변형 그룹화 ─────────────────────────────────

describe('buildTriple — Edit argKey 정규화', () => {
  it('같은 파일에 의미상 동일한 편집은 같은 argKey를 생성한다 (공백만 다름)', () => {
    const base = makeToolUse('Edit', {
      file_path: '/project/src/foo.ts',
      old_string: 'const x = 1',
      new_string: 'const x = 2',
    })
    const withExtraSpace = makeToolUse('Edit', {
      file_path: '/project/src/foo.ts',
      old_string: 'const  x  =  1',  // 여분 공백
      new_string: 'const  x  =  2',  // 여분 공백
    })
    expect(buildTriple(base)!.argKey).toBe(buildTriple(withExtraSpace)!.argKey)
  })

  it('같은 파일에 다른 내용을 편집하면 argKey가 달라진다', () => {
    const edit1 = makeToolUse('Edit', {
      file_path: '/project/src/foo.ts',
      old_string: 'const x = 1',
      new_string: 'const x = 2',
    })
    const edit2 = makeToolUse('Edit', {
      file_path: '/project/src/foo.ts',
      old_string: 'function bar() {}',
      new_string: 'function bar() { return 1 }',
    })
    expect(buildTriple(edit1)!.argKey).not.toBe(buildTriple(edit2)!.argKey)
  })

  it('다른 파일을 편집하면 argKey가 달라진다', () => {
    const edit1 = makeToolUse('Edit', {
      file_path: '/project/src/foo.ts',
      old_string: 'x = 1',
      new_string: 'x = 2',
    })
    const edit2 = makeToolUse('Edit', {
      file_path: '/project/src/bar.ts',
      old_string: 'x = 1',
      new_string: 'x = 2',
    })
    expect(buildTriple(edit1)!.argKey).not.toBe(buildTriple(edit2)!.argKey)
  })

  it('Edit argKey는 "Edit:{path}:{16hex}" 형식이다', () => {
    const ev = makeToolUse('Edit', {
      file_path: '/project/src/foo.ts',
      old_string: 'a',
      new_string: 'b',
    })
    const argKey = buildTriple(ev)!.argKey
    expect(argKey).toMatch(/^Edit:.*:[0-9a-f]{16}$/)
  })

  it('MultiEdit도 Edit와 같은 정규화 규칙을 사용한다', () => {
    const edit = makeToolUse('Edit', {
      file_path: '/project/src/foo.ts',
      old_string: 'const x = 1',
      new_string: 'const x = 2',
    })
    const multiEdit = makeToolUse('MultiEdit', {
      file_path: '/project/src/foo.ts',
      old_string: 'const x = 1',
      new_string: 'const x = 2',
    })
    // tool 이름이 다르므로 같은 argKey가 아니어도 되지만, Edit: 접두사로 시작
    expect(buildTriple(edit)!.argKey).toMatch(/^Edit:/)
    expect(buildTriple(multiEdit)!.argKey).toMatch(/^Edit:/)
    // 파일+내용이 같으면 동일 지문
    expect(buildTriple(edit)!.argKey).toBe(buildTriple(multiEdit)!.argKey)
  })
})

// ─── Bash argKey 휘발성 마스킹 ──────────────────────────────────

describe('buildTriple — Bash argKey 정규화', () => {
  it('타임스탬프가 다른 같은 명령은 같은 argKey를 생성한다', () => {
    const cmd1 = makeToolUse('Bash', { command: 'echo 1700000000000' })
    const cmd2 = makeToolUse('Bash', { command: 'echo 1700000099999' })
    expect(buildTriple(cmd1)!.argKey).toBe(buildTriple(cmd2)!.argKey)
  })

  it('포트만 다른 같은 명령은 같은 argKey를 생성한다', () => {
    const cmd1 = makeToolUse('Bash', { command: 'curl http://localhost:3000/health' })
    const cmd2 = makeToolUse('Bash', { command: 'curl http://localhost:4000/health' })
    expect(buildTriple(cmd1)!.argKey).toBe(buildTriple(cmd2)!.argKey)
  })

  it('/tmp 경로가 다른 같은 명령은 같은 argKey를 생성한다', () => {
    const cmd1 = makeToolUse('Bash', { command: 'cat /tmp/abc123.log' })
    const cmd2 = makeToolUse('Bash', { command: 'cat /tmp/def456.log' })
    expect(buildTriple(cmd1)!.argKey).toBe(buildTriple(cmd2)!.argKey)
  })

  it('다른 명령은 다른 argKey를 생성한다', () => {
    const cmd1 = makeToolUse('Bash', { command: 'npm test' })
    const cmd2 = makeToolUse('Bash', { command: 'npm run build' })
    expect(buildTriple(cmd1)!.argKey).not.toBe(buildTriple(cmd2)!.argKey)
  })

  it('Bash argKey는 "Bash:{16hex}" 형식이다', () => {
    const ev = makeToolUse('Bash', { command: 'npm test' })
    const argKey = buildTriple(ev)!.argKey
    expect(argKey).toMatch(/^Bash:[0-9a-f]{16}$/)
  })
})

// ─── Read/Glob/Grep argKey ────────────────────────────────────────

describe('buildTriple — Read/Glob/Grep argKey', () => {
  it('Read: 같은 파일 경로는 같은 argKey', () => {
    const r1 = makeToolUse('Read', { file_path: '/project/src/foo.ts' })
    const r2 = makeToolUse('Read', { file_path: '/project/src/foo.ts' })
    expect(buildTriple(r1)!.argKey).toBe(buildTriple(r2)!.argKey)
  })

  it('Read: 다른 파일 경로는 다른 argKey', () => {
    const r1 = makeToolUse('Read', { file_path: '/project/src/foo.ts' })
    const r2 = makeToolUse('Read', { file_path: '/project/src/bar.ts' })
    expect(buildTriple(r1)!.argKey).not.toBe(buildTriple(r2)!.argKey)
  })

  it('Grep: pattern으로 argKey 생성', () => {
    const g = makeToolUse('Grep', { pattern: 'TODO', path: '/project/src' })
    const argKey = buildTriple(g)!.argKey
    expect(argKey).toMatch(/^Grep:[0-9a-f]{16}$/)
  })

  it('Glob: pattern으로 argKey 생성', () => {
    const g = makeToolUse('Glob', { pattern: '**/*.ts' })
    const argKey = buildTriple(g)!.argKey
    expect(argKey).toMatch(/^Glob:[0-9a-f]{16}$/)
  })

  it('Read/Glob/Grep 다른 tool은 같은 경로라도 다른 argKey', () => {
    const r = makeToolUse('Read', { file_path: '/project/src/foo.ts' })
    const g = makeToolUse('Glob', { pattern: '/project/src/foo.ts' })
    expect(buildTriple(r)!.argKey).not.toBe(buildTriple(g)!.argKey)
  })
})

// ─── Write argKey ────────────────────────────────────────────────

describe('buildTriple — Write argKey', () => {
  it('같은 파일 + 내용이면 같은 argKey', () => {
    const w1 = makeToolUse('Write', { file_path: '/project/out.txt', content: 'hello world' })
    const w2 = makeToolUse('Write', { file_path: '/project/out.txt', content: 'hello world' })
    expect(buildTriple(w1)!.argKey).toBe(buildTriple(w2)!.argKey)
  })

  it('내용이 다르면 다른 argKey', () => {
    const w1 = makeToolUse('Write', { file_path: '/project/out.txt', content: 'hello world' })
    const w2 = makeToolUse('Write', { file_path: '/project/out.txt', content: 'goodbye world' })
    expect(buildTriple(w1)!.argKey).not.toBe(buildTriple(w2)!.argKey)
  })

  it('Write argKey는 "Write:{path}:{16hex}" 형식이다', () => {
    const ev = makeToolUse('Write', { file_path: '/project/out.txt', content: 'data' })
    expect(buildTriple(ev)!.argKey).toMatch(/^Write:.*:[0-9a-f]{16}$/)
  })
})

// ─── 기타(mcp__*) argKey ─────────────────────────────────────────

describe('buildTriple — 기타 tool argKey', () => {
  it('mcp__server__tool_name 형식의 도구도 argKey를 생성한다', () => {
    const ev = makeToolUse('mcp__github__create_issue', {
      title: 'Bug report',
      body: 'Something broke',
    })
    const triple = buildTriple(ev)!
    expect(triple).not.toBeNull()
    expect(triple.argKey).toMatch(/^mcp__github__create_issue:[0-9a-f]{16}$/)
  })

  it('같은 mcp 입력은 같은 argKey', () => {
    const ev1 = makeToolUse('mcp__slack__send_message', { channel: '#general', text: 'hello' })
    const ev2 = makeToolUse('mcp__slack__send_message', { channel: '#general', text: 'hello' })
    expect(buildTriple(ev1)!.argKey).toBe(buildTriple(ev2)!.argKey)
  })

  it('다른 mcp 입력은 다른 argKey', () => {
    const ev1 = makeToolUse('mcp__slack__send_message', { channel: '#general', text: 'hello' })
    const ev2 = makeToolUse('mcp__slack__send_message', { channel: '#general', text: 'world' })
    expect(buildTriple(ev1)!.argKey).not.toBe(buildTriple(ev2)!.argKey)
  })
})

// ─── _internal 유틸리티 단위 테스트 ──────────────────────────────

describe('_internal utilities', () => {
  describe('collapseWS', () => {
    it('연속 공백을 하나로 붕괴한다', () => {
      expect(_internal.collapseWS('a  b   c')).toBe('a b c')
    })
    it('탭과 줄바꿈도 처리한다', () => {
      expect(_internal.collapseWS('a\t\tb\n\nc')).toBe('a b c')
    })
    it('양쪽 트림', () => {
      expect(_internal.collapseWS('  hello  ')).toBe('hello')
    })
  })

  describe('stripComments', () => {
    it('// 주석을 제거한다', () => {
      const result = _internal.stripComments('const x = 1 // comment\nconst y = 2')
      expect(result).not.toContain('comment')
      expect(result).toContain('const y = 2')
    })
    it('/* */ 주석을 제거한다', () => {
      const result = _internal.stripComments('/* block */ const x = 1')
      expect(result).not.toContain('block')
      expect(result).toContain('const x = 1')
    })
  })

  describe('editDelta', () => {
    it('같은 old/new는 같은 delta를 반환한다', () => {
      const d1 = _internal.editDelta('const x = 1', 'const x = 2')
      const d2 = _internal.editDelta('const x = 1', 'const x = 2')
      expect(d1).toBe(d2)
    })
    it('공백만 다른 old/new는 같은 delta를 반환한다 (collapseWS 효과)', () => {
      // editDelta는 내부에서 tokenize(collapseWS(s))를 사용
      // 연속 공백 → 단일 공백으로 붕괴 후 동일 토큰 분해
      const d1 = _internal.editDelta('const x 1', 'const x 2')
      const d2 = _internal.editDelta('const  x  1', 'const  x  2')
      expect(d1).toBe(d2)
    })
    it('완전히 다른 편집은 다른 delta를 반환한다', () => {
      const d1 = _internal.editDelta('foo', 'bar')
      const d2 = _internal.editDelta('baz', 'qux')
      expect(d1).not.toBe(d2)
    })
  })

  describe('maskVolatile', () => {
    it('UUID를 마스킹한다', () => {
      const result = _internal.maskVolatile('run-123e4567-e89b-12d3-a456-426614174000')
      expect(result).toContain('<HASH>')
      expect(result).not.toContain('123e4567')
    })
    it('10자리 이상 숫자를 마스킹한다', () => {
      const result = _internal.maskVolatile('ts=1700000000000')
      expect(result).toContain('<N>')
    })
    it('/tmp 경로를 마스킹한다', () => {
      const result = _internal.maskVolatile('cat /tmp/file123.log')
      expect(result).toContain('<TMP>')
    })
    it(':포트를 마스킹한다', () => {
      const result = _internal.maskVolatile('http://localhost:3000/api')
      expect(result).toContain(':<PORT>')
    })
    it('sleep N을 마스킹한다', () => {
      const result = _internal.maskVolatile('sleep 5 && echo done')
      expect(result).toContain('sleep <N>')
    })
    it('일반 텍스트는 마스킹하지 않는다', () => {
      const result = _internal.maskVolatile('npm test')
      expect(result).toBe('npm test')
    })
  })

  describe('normPath', () => {
    it('중복 슬래시를 정규화한다', () => {
      const p = _internal.normPath('/project//src//foo.ts')
      expect(p).toBe('/project/src/foo.ts')
    })
    it('비문자열 입력은 <unknown_path> 반환', () => {
      expect(_internal.normPath(null)).toBe('<unknown_path>')
      expect(_internal.normPath(undefined)).toBe('<unknown_path>')
      expect(_internal.normPath(42)).toBe('<unknown_path>')
    })
  })

  describe('fingerprint', () => {
    it('항상 16자 hex를 반환한다', () => {
      const fp = _internal.fingerprint('hello world')
      expect(fp).toMatch(/^[0-9a-f]{16}$/)
    })
    it('같은 입력은 같은 지문을 반환한다', () => {
      expect(_internal.fingerprint('abc')).toBe(_internal.fingerprint('abc'))
    })
    it('다른 입력은 다른 지문을 반환한다 (충돌 없음 확인)', () => {
      expect(_internal.fingerprint('abc')).not.toBe(_internal.fingerprint('xyz'))
    })
  })
})

// ─── 엣지 케이스 ─────────────────────────────────────────────────

describe('buildTriple — 엣지 케이스', () => {
  it('input이 없는 tool_use는 빈 객체로 처리하고 argKey를 생성한다', () => {
    const ev = makeEvent({ kind: 'tool_use', tool: 'SomeTool' })
    const triple = buildTriple(ev)
    expect(triple).not.toBeNull()
    expect(typeof triple!.argKey).toBe('string')
    expect(triple!.argKey.length).toBeGreaterThan(0)
  })

  it('input이 배열인 경우에도 처리한다 (방어적)', () => {
    const ev = makeEvent({ kind: 'tool_use', tool: 'Bash', input: ['cmd', 'arg'] as unknown as Record<string, unknown> })
    const triple = buildTriple(ev)
    expect(triple).not.toBeNull()
  })

  it('Edit에 file_path 없으면 <unknown_path>로 대체', () => {
    const ev = makeToolUse('Edit', { old_string: 'a', new_string: 'b' })
    const triple = buildTriple(ev)!
    expect(triple.argKey).toContain('<unknown_path>')
  })

  it('tool="Edit" tool=null은 null 반환', () => {
    const ev = makeEvent({ kind: 'tool_use' })  // tool 없음
    expect(buildTriple(ev)).toBeNull()
  })
})
