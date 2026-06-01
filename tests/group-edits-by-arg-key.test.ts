/**
 * tests/group-edits-by-arg-key.test.ts
 *
 * Sub-AC 3: groupEditsByArgKey 단위 테스트
 *
 * 검증 범위:
 *   - 동일 파일 경로의 여러 Edit 이벤트가 같은 그룹에 묶임 (내용과 무관)
 *   - 다른 파일 경로의 Edit 이벤트는 다른 그룹으로 분리
 *   - Edit/MultiEdit 이벤트만 처리 (Bash, Read 등 다른 tool은 무시)
 *   - tool_use 외 이벤트(user, assistant, tool_result 등)는 무시
 *   - 파일 경로 정규화: 중복 슬래시, trailing slash 등이 있어도 같은 그룹
 *   - 반환 Map key = 정규화된 파일 경로 (argKey의 delta 부분 아님)
 *   - 입력 순서 보존 (그룹 내 ActionTriple 순서)
 *   - 빈 입력 → 빈 Map
 *   - file_path 없는 Edit 이벤트 → '<unknown_path>' 그룹
 */

import { groupEditsByArgKey } from '../src/detect/triple-builder.js'
import type { NormalizedEvent } from '../src/contracts.js'

// ─── 픽스처 헬퍼 ──────────────────────────────────────────────

let _uuid = 0
function nextUuid(): string {
  return `uuid-${String(++_uuid).padStart(4, '0')}`
}

function makeEditEvent(
  filePath: string,
  oldStr: string,
  newStr: string,
  overrides: Partial<NormalizedEvent> = {},
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
    input: {
      file_path: filePath,
      old_string: oldStr,
      new_string: newStr,
    },
    ...overrides,
  }
}

function makeNonEditEvent(
  tool: string,
  input: Record<string, unknown> = {},
  overrides: Partial<NormalizedEvent> = {},
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
    tool,
    input,
    ...overrides,
  }
}

function makeNonToolEvent(
  kind: NormalizedEvent['kind'],
  overrides: Partial<NormalizedEvent> = {},
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
    kind,
    ...overrides,
  }
}

// ─── 기본 그룹화 ──────────────────────────────────────────────

describe('groupEditsByArgKey — 기본 그룹화', () => {
  it('빈 배열을 입력하면 빈 Map을 반환한다', () => {
    const result = groupEditsByArgKey([])
    expect(result.size).toBe(0)
  })

  it('단일 Edit 이벤트는 해당 파일 경로 키로 1개 그룹을 생성한다', () => {
    const ev = makeEditEvent('/project/src/foo.ts', 'const x = 1', 'const x = 2')
    const result = groupEditsByArgKey([ev])
    expect(result.size).toBe(1)
    expect(result.has('/project/src/foo.ts')).toBe(true)
    expect(result.get('/project/src/foo.ts')!.length).toBe(1)
  })

  it('동일 파일에 대한 여러 Edit 이벤트는 같은 그룹에 묶인다', () => {
    const ev1 = makeEditEvent('/project/src/foo.ts', 'const x = 1', 'const x = 2')
    const ev2 = makeEditEvent('/project/src/foo.ts', 'function bar() {}', 'function bar() { return 1 }')
    const ev3 = makeEditEvent('/project/src/foo.ts', 'let a = 0', 'let a = 1')

    const result = groupEditsByArgKey([ev1, ev2, ev3])
    expect(result.size).toBe(1)
    expect(result.get('/project/src/foo.ts')!.length).toBe(3)
  })

  it('다른 파일 경로는 다른 그룹으로 분리된다', () => {
    const ev1 = makeEditEvent('/project/src/foo.ts', 'a', 'b')
    const ev2 = makeEditEvent('/project/src/bar.ts', 'c', 'd')
    const ev3 = makeEditEvent('/project/src/baz.ts', 'e', 'f')

    const result = groupEditsByArgKey([ev1, ev2, ev3])
    expect(result.size).toBe(3)
    expect(result.has('/project/src/foo.ts')).toBe(true)
    expect(result.has('/project/src/bar.ts')).toBe(true)
    expect(result.has('/project/src/baz.ts')).toBe(true)
  })

  it('서로 다른 내용을 편집해도 동일 파일이면 같은 그룹 — 내용 무관', () => {
    const events = [
      makeEditEvent('/project/src/utils.ts', 'import A from "a"', 'import A from "b"'),
      makeEditEvent('/project/src/utils.ts', 'export const x = 1', 'export const x = 2'),
      makeEditEvent('/project/src/utils.ts', '// old comment', '// new comment'),
      makeEditEvent('/project/src/utils.ts', 'const arr = []', 'const arr: string[] = []'),
    ]

    const result = groupEditsByArgKey(events)
    expect(result.size).toBe(1)

    const group = result.get('/project/src/utils.ts')!
    expect(group.length).toBe(4)
  })
})

// ─── argKey 그룹화 키 검증 ────────────────────────────────────

describe('groupEditsByArgKey — 그룹화 키(argKey)가 파일 경로', () => {
  it('반환 Map의 key는 정규화된 파일 경로다 (Edit:{path}:{delta} 전체가 아님)', () => {
    const ev = makeEditEvent('/project/src/foo.ts', 'x=1', 'x=2')
    const result = groupEditsByArgKey([ev])

    // key는 파일 경로 그대로 (Edit: 접두사 없음, delta 부분 없음)
    const keys = [...result.keys()]
    expect(keys).toHaveLength(1)
    expect(keys[0]).toBe('/project/src/foo.ts')
    expect(keys[0]).not.toMatch(/^Edit:/)
  })

  it('그룹 내 ActionTriple의 argKey는 Edit:{path}:{16hex} 형식을 유지한다', () => {
    const ev = makeEditEvent('/project/src/foo.ts', 'x=1', 'x=2')
    const result = groupEditsByArgKey([ev])

    const triple = result.get('/project/src/foo.ts')![0]!
    expect(triple.argKey).toMatch(/^Edit:\/project\/src\/foo\.ts:[0-9a-f]{16}$/)
  })

  it('같은 파일 다른 내용: 그룹화 키는 같고 triple.argKey는 다를 수 있다', () => {
    const ev1 = makeEditEvent('/project/src/foo.ts', 'x = 1', 'x = 2')
    const ev2 = makeEditEvent('/project/src/foo.ts', 'y = 10', 'y = 20')

    const result = groupEditsByArgKey([ev1, ev2])
    const group = result.get('/project/src/foo.ts')!

    // 그룹화 키는 같으므로 1개 그룹
    expect(result.size).toBe(1)
    // 내용이 다르면 triple.argKey는 다를 수 있다
    // (오탐 방지: 같은 영역은 같은 argKey, 다른 영역은 다른 argKey)
    expect(group[0]!.tool).toBe('Edit')
    expect(group[1]!.tool).toBe('Edit')
  })
})

// ─── 경로 정규화 ──────────────────────────────────────────────

describe('groupEditsByArgKey — 파일 경로 정규화', () => {
  it('중복 슬래시가 있는 경로는 정규화 후 같은 그룹', () => {
    const ev1 = makeEditEvent('/project//src/foo.ts', 'a', 'b')
    const ev2 = makeEditEvent('/project/src/foo.ts', 'c', 'd')

    const result = groupEditsByArgKey([ev1, ev2])
    // 두 경로 모두 '/project/src/foo.ts'로 정규화됨
    expect(result.size).toBe(1)
    expect(result.get('/project/src/foo.ts')!.length).toBe(2)
  })

  it('trailing slash는 제거되어 같은 그룹', () => {
    const ev1 = makeEditEvent('/project/src/foo.ts/', 'a', 'b')
    const ev2 = makeEditEvent('/project/src/foo.ts', 'c', 'd')

    const result = groupEditsByArgKey([ev1, ev2])
    expect(result.size).toBe(1)
  })

  it('../ 세그먼트가 있어도 lexical 정규화 후 같은 그룹', () => {
    const ev1 = makeEditEvent('/project/src/../src/foo.ts', 'a', 'b')
    const ev2 = makeEditEvent('/project/src/foo.ts', 'c', 'd')

    const result = groupEditsByArgKey([ev1, ev2])
    expect(result.size).toBe(1)
  })
})

// ─── 비-Edit 이벤트 필터링 ────────────────────────────────────

describe('groupEditsByArgKey — 비-Edit 이벤트 무시', () => {
  it('Bash 이벤트는 무시된다', () => {
    const bash = makeNonEditEvent('Bash', { command: 'npm test' })
    const result = groupEditsByArgKey([bash])
    expect(result.size).toBe(0)
  })

  it('Read 이벤트는 무시된다', () => {
    const read = makeNonEditEvent('Read', { file_path: '/project/src/foo.ts' })
    const result = groupEditsByArgKey([read])
    expect(result.size).toBe(0)
  })

  it('Glob, Grep 이벤트는 무시된다', () => {
    const glob = makeNonEditEvent('Glob', { pattern: '**/*.ts' })
    const grep = makeNonEditEvent('Grep', { pattern: 'TODO' })
    const result = groupEditsByArgKey([glob, grep])
    expect(result.size).toBe(0)
  })

  it('Write 이벤트는 무시된다', () => {
    const write = makeNonEditEvent('Write', { file_path: '/project/out.txt', content: 'hello' })
    const result = groupEditsByArgKey([write])
    expect(result.size).toBe(0)
  })

  it('mcp__* 이벤트는 무시된다', () => {
    const mcp = makeNonEditEvent('mcp__github__create_issue', { title: 'bug' })
    const result = groupEditsByArgKey([mcp])
    expect(result.size).toBe(0)
  })

  it('tool_result, user, assistant, system 이벤트는 무시된다', () => {
    const events: NormalizedEvent[] = [
      makeNonToolEvent('tool_result', { resultClass: 'ok' }),
      makeNonToolEvent('user', { text: 'hello' }),
      makeNonToolEvent('assistant', { text: 'done' }),
      makeNonToolEvent('system', { systemSubtype: 'turn_duration' }),
    ]
    const result = groupEditsByArgKey(events)
    expect(result.size).toBe(0)
  })

  it('Edit 이벤트와 비-Edit 이벤트가 혼재하면 Edit만 그룹화한다', () => {
    const bash = makeNonEditEvent('Bash', { command: 'npm test' })
    const edit1 = makeEditEvent('/project/src/foo.ts', 'a', 'b')
    const read = makeNonEditEvent('Read', { file_path: '/project/src/foo.ts' })
    const edit2 = makeEditEvent('/project/src/foo.ts', 'c', 'd')
    const user = makeNonToolEvent('user', { text: 'hello' })
    const edit3 = makeEditEvent('/project/src/bar.ts', 'e', 'f')

    const result = groupEditsByArgKey([bash, edit1, read, edit2, user, edit3])
    expect(result.size).toBe(2)
    expect(result.get('/project/src/foo.ts')!.length).toBe(2)
    expect(result.get('/project/src/bar.ts')!.length).toBe(1)
  })
})

// ─── MultiEdit 지원 ───────────────────────────────────────────

describe('groupEditsByArgKey — MultiEdit 지원', () => {
  it('MultiEdit 이벤트도 Edit와 동일하게 파일 경로로 그룹화된다', () => {
    const multiEdit = {
      ...makeEditEvent('/project/src/foo.ts', 'a', 'b'),
      tool: 'MultiEdit' as const,
    }
    const result = groupEditsByArgKey([multiEdit])
    expect(result.size).toBe(1)
    expect(result.has('/project/src/foo.ts')).toBe(true)
  })

  it('Edit와 MultiEdit을 같은 파일에 적용하면 같은 그룹', () => {
    const edit = makeEditEvent('/project/src/foo.ts', 'x=1', 'x=2')
    const multiEdit = {
      ...makeEditEvent('/project/src/foo.ts', 'y=10', 'y=20'),
      tool: 'MultiEdit' as const,
    }
    const result = groupEditsByArgKey([edit, multiEdit])
    expect(result.size).toBe(1)
    expect(result.get('/project/src/foo.ts')!.length).toBe(2)
  })
})

// ─── ActionTriple 구조 및 순서 보존 ──────────────────────────

describe('groupEditsByArgKey — ActionTriple 구조 및 순서 보존', () => {
  it('그룹 내 ActionTriple의 tool 필드는 "Edit"다', () => {
    const ev = makeEditEvent('/project/src/foo.ts', 'a', 'b')
    const result = groupEditsByArgKey([ev])
    const triple = result.get('/project/src/foo.ts')![0]!
    expect(triple.tool).toBe('Edit')
  })

  it('그룹 내 ActionTriple의 ref.uuid, ref.ts가 원본 이벤트와 일치한다', () => {
    const ev = makeEditEvent('/project/src/foo.ts', 'a', 'b')
    const result = groupEditsByArgKey([ev])
    const triple = result.get('/project/src/foo.ts')![0]!
    expect(triple.ref.uuid).toBe(ev.uuid)
    expect(triple.ref.ts).toBe(ev.ts)
  })

  it('입력 이벤트 순서가 그룹 내 triple 순서로 보존된다', () => {
    const uuids = ['uuid-a', 'uuid-b', 'uuid-c']
    const events = uuids.map((uuid, i) =>
      makeEditEvent('/project/src/foo.ts', `old-${i}`, `new-${i}`, { uuid })
    )
    const result = groupEditsByArgKey(events)
    const group = result.get('/project/src/foo.ts')!
    expect(group.map(t => t.ref.uuid)).toEqual(uuids)
  })

  it('여러 파일의 이벤트가 섞여도 각 파일 그룹의 순서가 보존된다', () => {
    const ev1 = makeEditEvent('/a.ts', 'x1', 'y1', { uuid: 'ev1', ts: 1000 })
    const ev2 = makeEditEvent('/b.ts', 'x2', 'y2', { uuid: 'ev2', ts: 2000 })
    const ev3 = makeEditEvent('/a.ts', 'x3', 'y3', { uuid: 'ev3', ts: 3000 })
    const ev4 = makeEditEvent('/b.ts', 'x4', 'y4', { uuid: 'ev4', ts: 4000 })

    const result = groupEditsByArgKey([ev1, ev2, ev3, ev4])
    expect(result.get('/a.ts')!.map(t => t.ref.uuid)).toEqual(['ev1', 'ev3'])
    expect(result.get('/b.ts')!.map(t => t.ref.uuid)).toEqual(['ev2', 'ev4'])
  })
})

// ─── file_path 없는 이벤트 방어 ──────────────────────────────

describe('groupEditsByArgKey — file_path 없는 이벤트', () => {
  it('file_path가 없는 Edit 이벤트는 <unknown_path> 그룹에 들어간다', () => {
    const ev: NormalizedEvent = {
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
      input: { old_string: 'a', new_string: 'b' }, // file_path 없음
    }
    const result = groupEditsByArgKey([ev])
    expect(result.size).toBe(1)
    expect(result.has('<unknown_path>')).toBe(true)
  })

  it('input이 없는 Edit 이벤트도 <unknown_path> 그룹에 들어간다', () => {
    const ev: NormalizedEvent = {
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
      // input 없음
    }
    const result = groupEditsByArgKey([ev])
    expect(result.size).toBe(1)
    expect(result.has('<unknown_path>')).toBe(true)
  })
})

// ─── 규모 테스트 (같은 파일 N회 편집) ─────────────────────────

describe('groupEditsByArgKey — 동일 파일 반복 편집 탐지 시나리오', () => {
  it('같은 파일을 10회 편집하면 그룹 크기가 10이다', () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEditEvent('/project/src/hotspot.ts', `old-${i}`, `new-${i}`)
    )
    const result = groupEditsByArgKey(events)
    expect(result.size).toBe(1)
    expect(result.get('/project/src/hotspot.ts')!.length).toBe(10)
  })

  it('3개 파일에 각각 5회씩 편집하면 3개 그룹이 각 5개 triple을 가진다', () => {
    const files = ['/a.ts', '/b.ts', '/c.ts']
    const events = files.flatMap(fp =>
      Array.from({ length: 5 }, (_, i) =>
        makeEditEvent(fp, `old-${i}`, `new-${i}`)
      )
    )
    const result = groupEditsByArgKey(events)
    expect(result.size).toBe(3)
    for (const fp of files) {
      expect(result.get(fp)!.length).toBe(5)
    }
  })
})
