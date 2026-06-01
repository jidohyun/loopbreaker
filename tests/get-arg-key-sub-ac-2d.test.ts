/**
 * tests/get-arg-key-sub-ac-2d.test.ts
 *
 * Sub-AC 2d: getArgKey(event: NormalizedEvent): string 디스패처 단위 테스트
 *
 * 검증 범위:
 *   - tool 패밀리별 대표 호출 1건씩 (Edit, Bash, Read, Glob, Grep, Write, mcp__*)
 *   - 알 수 없는(unknown) tool → default 핸들러 폴백, 형식 "{tool}:{16hex}"
 *   - 비 tool_use kind (user, assistant, tool_result, system, other) → '' 반환
 *   - tool 필드 없는 tool_use → '' 반환
 *   - getArgKey 결과 == normalizeArgKeyForTool(tool, input) 결과 일치 (위임 검증)
 *   - _internal에 getArgKey 노출 확인
 */

import { getArgKey, normalizeArgKeyForTool, _internal } from '../src/detect/triple-builder.js'
import type { NormalizedEvent } from '../src/contracts.js'

// ─── 테스트 픽스처 헬퍼 ─────────────────────────────────────────

function makeEvent(overrides: Partial<NormalizedEvent> & { kind: NormalizedEvent['kind'] }): NormalizedEvent {
  return {
    uuid: 'uuid-2d-001',
    parentUuid: null,
    sessionId: 'sess-2d',
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
  return makeEvent({ kind: 'tool_use', tool, input, ...opts })
}

// ─── 비 tool_use kind → '' 반환 ─────────────────────────────────

describe('getArgKey — non-tool_use events return empty string', () => {
  it('kind=user → ""', () => {
    expect(getArgKey(makeEvent({ kind: 'user', text: 'hello' }))).toBe('')
  })

  it('kind=assistant → ""', () => {
    expect(getArgKey(makeEvent({ kind: 'assistant', text: 'done' }))).toBe('')
  })

  it('kind=tool_result → ""', () => {
    expect(getArgKey(makeEvent({ kind: 'tool_result', resultClass: 'ok' }))).toBe('')
  })

  it('kind=system → ""', () => {
    expect(getArgKey(makeEvent({ kind: 'system', systemSubtype: 'turn_duration' }))).toBe('')
  })

  it('kind=other → ""', () => {
    expect(getArgKey(makeEvent({ kind: 'other' }))).toBe('')
  })

  it('kind=attachment → ""', () => {
    expect(getArgKey(makeEvent({ kind: 'attachment' }))).toBe('')
  })
})

// ─── tool 필드 누락 tool_use → '' 반환 ─────────────────────────

describe('getArgKey — tool_use without tool field returns empty string', () => {
  it('tool 필드가 undefined인 tool_use → ""', () => {
    const ev = makeEvent({ kind: 'tool_use', input: { command: 'ls' } })
    // tool 필드를 명시적으로 제거
    expect(getArgKey(ev)).toBe('')
  })

  it('tool 필드가 빈 문자열인 tool_use → ""', () => {
    const ev = makeToolUse('', { command: 'ls' })
    expect(getArgKey(ev)).toBe('')
  })
})

// ─── Edit 패밀리 ────────────────────────────────────────────────

describe('getArgKey — Edit family', () => {
  it('Edit: argKey가 "Edit:{path}:{16hex}" 형식이다', () => {
    const ev = makeToolUse('Edit', {
      file_path: '/project/src/foo.ts',
      old_string: 'const x = 1',
      new_string: 'const x = 2',
    })
    expect(getArgKey(ev)).toMatch(/^Edit:.*:[0-9a-f]{16}$/)
  })

  it('Edit: getArgKey == normalizeArgKeyForTool 결과', () => {
    const input = { file_path: '/project/src/foo.ts', old_string: 'a', new_string: 'b' }
    const ev = makeToolUse('Edit', input)
    expect(getArgKey(ev)).toBe(normalizeArgKeyForTool('Edit', input))
  })

  it('MultiEdit: argKey가 "Edit:{path}:{16hex}" 형식이다', () => {
    const ev = makeToolUse('MultiEdit', {
      file_path: '/project/src/bar.ts',
      old_string: 'x',
      new_string: 'y',
    })
    expect(getArgKey(ev)).toMatch(/^Edit:.*:[0-9a-f]{16}$/)
  })
})

// ─── Bash 패밀리 ────────────────────────────────────────────────

describe('getArgKey — Bash family', () => {
  it('Bash: argKey가 "Bash:{16hex}" 형식이다', () => {
    const ev = makeToolUse('Bash', { command: 'npm test' })
    expect(getArgKey(ev)).toMatch(/^Bash:[0-9a-f]{16}$/)
  })

  it('Bash: getArgKey == normalizeArgKeyForTool 결과', () => {
    const input = { command: 'npm run build' }
    const ev = makeToolUse('Bash', input)
    expect(getArgKey(ev)).toBe(normalizeArgKeyForTool('Bash', input))
  })

  it('Bash: 휘발성 인자(타임스탬프 차이)는 같은 argKey', () => {
    const ev1 = makeToolUse('Bash', { command: 'echo 1700000000000' })
    const ev2 = makeToolUse('Bash', { command: 'echo 1700000099999' })
    expect(getArgKey(ev1)).toBe(getArgKey(ev2))
  })
})

// ─── Read 패밀리 ────────────────────────────────────────────────

describe('getArgKey — Read family', () => {
  it('Read: argKey가 "Read:{16hex}" 형식이다', () => {
    const ev = makeToolUse('Read', { file_path: '/project/src/foo.ts' })
    expect(getArgKey(ev)).toMatch(/^Read:[0-9a-f]{16}$/)
  })

  it('Read: getArgKey == normalizeArgKeyForTool 결과', () => {
    const input = { file_path: '/project/src/utils.ts' }
    const ev = makeToolUse('Read', input)
    expect(getArgKey(ev)).toBe(normalizeArgKeyForTool('Read', input))
  })
})

// ─── Glob 패밀리 ────────────────────────────────────────────────

describe('getArgKey — Glob family', () => {
  it('Glob: argKey가 "Glob:{16hex}" 형식이다', () => {
    const ev = makeToolUse('Glob', { pattern: '**/*.ts' })
    expect(getArgKey(ev)).toMatch(/^Glob:[0-9a-f]{16}$/)
  })

  it('Glob: getArgKey == normalizeArgKeyForTool 결과', () => {
    const input = { pattern: 'src/**/*.test.ts' }
    const ev = makeToolUse('Glob', input)
    expect(getArgKey(ev)).toBe(normalizeArgKeyForTool('Glob', input))
  })
})

// ─── Grep 패밀리 ────────────────────────────────────────────────

describe('getArgKey — Grep family', () => {
  it('Grep: argKey가 "Grep:{16hex}" 형식이다', () => {
    const ev = makeToolUse('Grep', { pattern: 'TODO', path: '/project/src' })
    expect(getArgKey(ev)).toMatch(/^Grep:[0-9a-f]{16}$/)
  })

  it('Grep: getArgKey == normalizeArgKeyForTool 결과', () => {
    const input = { pattern: 'function\\s+\\w+' }
    const ev = makeToolUse('Grep', input)
    expect(getArgKey(ev)).toBe(normalizeArgKeyForTool('Grep', input))
  })
})

// ─── Write 패밀리 ───────────────────────────────────────────────

describe('getArgKey — Write family', () => {
  it('Write: argKey가 "Write:{path}:{16hex}" 형식이다', () => {
    const ev = makeToolUse('Write', { file_path: '/project/out.txt', content: 'hello' })
    expect(getArgKey(ev)).toMatch(/^Write:.*:[0-9a-f]{16}$/)
  })

  it('Write: getArgKey == normalizeArgKeyForTool 결과', () => {
    const input = { file_path: '/project/out.json', content: '{"key":"value"}' }
    const ev = makeToolUse('Write', input)
    expect(getArgKey(ev)).toBe(normalizeArgKeyForTool('Write', input))
  })
})

// ─── mcp__* 도구 ────────────────────────────────────────────────

describe('getArgKey — mcp__* tools (default handler)', () => {
  it('mcp__*: argKey가 "{tool}:{16hex}" 형식이다', () => {
    const ev = makeToolUse('mcp__github__create_issue', {
      title: 'Bug report',
      body: 'Something broke',
    })
    expect(getArgKey(ev)).toMatch(/^mcp__github__create_issue:[0-9a-f]{16}$/)
  })

  it('mcp__*: getArgKey == normalizeArgKeyForTool 결과', () => {
    const input = { channel: '#dev', text: 'hello' }
    const ev = makeToolUse('mcp__slack__send', input)
    expect(getArgKey(ev)).toBe(normalizeArgKeyForTool('mcp__slack__send', input))
  })
})

// ─── 알 수 없는(unknown) tool → default 폴백 ────────────────────

describe('getArgKey — unknown tool fallback', () => {
  it('미지 도구는 "{tool}:{16hex}" 형식으로 폴백한다', () => {
    const ev = makeToolUse('SomeFutureTool', { data: 'value' })
    expect(getArgKey(ev)).toMatch(/^SomeFutureTool:[0-9a-f]{16}$/)
  })

  it('미지 도구: getArgKey == normalizeArgKeyForTool 결과', () => {
    const input = { x: 1, y: 2 }
    const ev = makeToolUse('UnknownTool', input)
    expect(getArgKey(ev)).toBe(normalizeArgKeyForTool('UnknownTool', input))
  })

  it('빈 객체 input 미지 도구도 argKey를 반환한다', () => {
    const ev = makeToolUse('FutureTool', {})
    expect(getArgKey(ev)).toMatch(/^FutureTool:[0-9a-f]{16}$/)
  })
})

// ─── input 정규화 (비객체 input 처리) ──────────────────────────

describe('getArgKey — input normalization', () => {
  it('input이 undefined인 tool_use는 빈 객체로 처리한다', () => {
    const ev = makeEvent({ kind: 'tool_use', tool: 'Bash' })
    const key = getArgKey(ev)
    expect(typeof key).toBe('string')
    expect(key.startsWith('Bash:')).toBe(true)
  })

  it('input이 배열인 경우 빈 객체로 처리한다 (방어적)', () => {
    const ev = makeEvent({
      kind: 'tool_use',
      tool: 'Read',
      input: ['a', 'b'] as unknown as Record<string, unknown>,
    })
    const key = getArgKey(ev)
    expect(typeof key).toBe('string')
    expect(key.startsWith('Read:')).toBe(true)
  })

  it('input이 null인 경우 빈 객체로 처리한다', () => {
    const ev = makeEvent({
      kind: 'tool_use',
      tool: 'Grep',
      input: null as unknown as Record<string, unknown>,
    })
    const key = getArgKey(ev)
    expect(typeof key).toBe('string')
    expect(key.startsWith('Grep:')).toBe(true)
  })
})

// ─── 결정론성 ────────────────────────────────────────────────────

describe('getArgKey — determinism', () => {
  it('같은 이벤트는 항상 같은 argKey를 반환한다', () => {
    const ev = makeToolUse('Edit', {
      file_path: '/project/src/foo.ts',
      old_string: 'const x = 1',
      new_string: 'const x = 2',
    })
    expect(getArgKey(ev)).toBe(getArgKey(ev))
  })

  it('다른 tool 이름은 같은 input이라도 다른 argKey를 반환한다', () => {
    const input = { file_path: '/project/src/foo.ts' }
    const evRead = makeToolUse('Read', input)
    const evGlob = makeToolUse('Glob', input)
    expect(getArgKey(evRead)).not.toBe(getArgKey(evGlob))
  })
})

// ─── _internal 노출 확인 ────────────────────────────────────────

describe('_internal — getArgKey 노출', () => {
  it('_internal에 getArgKey가 존재한다', () => {
    expect(typeof _internal.getArgKey).toBe('function')
  })

  it('_internal.getArgKey는 top-level getArgKey와 동일하다', () => {
    const ev = makeToolUse('Bash', { command: 'npm test' })
    expect(_internal.getArgKey(ev)).toBe(getArgKey(ev))
  })
})
