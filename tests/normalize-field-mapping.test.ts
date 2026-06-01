/**
 * tests/normalize-field-mapping.test.ts
 *
 * Sub-AC 3a: normalize() 필드 매핑 단위 테스트.
 *
 * Claude Code JSONL 원시키 → NormalizedEvent contracts 컬럼명 매핑 검증.
 * SPEC §4 + §1-1 C5 BLOCKER 규칙:
 *   - cwd (project_path 아님)
 *   - agentScope + isSidechain (is_subagent 아님)
 *   - kind (role+event_type 아님)
 *   - tool (tool_name 아님)
 *   - input (normalized_args_digest 아님)
 *   - resultClass (result_digest 아님)
 *   - toolUseId (tool_use의 id)
 *
 * 각 fixture는 실제 Claude Code JSONL 형식을 반영한 알려진 입력.
 */

import { normalize } from '../src/ingest/parser.js'
import type { NormalizedEvent } from '../src/contracts.js'

// ── 공통 fixture 헬퍼 ───────────────────────────────────────────────────────

/** 최소 user 레코드 fixture (Claude Code JSONL 원시키 사용) */
const makeUserRecord = () => ({
  type: 'user',
  uuid: 'uuid-user-001',
  parentUuid: 'uuid-parent-000',
  timestamp: '2024-01-15T10:00:00.000Z',
  sessionId: 'sess-abc123',
  cwd: '/home/user/my-project',
  gitBranch: 'main',
  version: 1,
  isSidechain: false,
  message: {
    role: 'user',
    content: [{ type: 'text', text: 'Hello world' }],
  },
})

/** assistant + tool_use 레코드 fixture */
const makeToolUseRecord = () => ({
  type: 'assistant',
  uuid: 'uuid-asst-002',
  parentUuid: 'uuid-user-001',
  timestamp: '2024-01-15T10:00:01.000Z',
  sessionId: 'sess-abc123',
  cwd: '/home/user/my-project',
  gitBranch: 'main',
  version: 1,
  isSidechain: false,
  message: {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'tool-id-001',
        name: 'Read',
        input: { file_path: '/src/index.ts' },
      },
    ],
  },
})

/** user + tool_result 레코드 fixture */
const makeToolResultRecord = () => ({
  type: 'user',
  uuid: 'uuid-result-003',
  parentUuid: 'uuid-asst-002',
  timestamp: '2024-01-15T10:00:02.000Z',
  sessionId: 'sess-abc123',
  cwd: '/home/user/my-project',
  gitBranch: 'main',
  version: 1,
  isSidechain: false,
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool-id-001',
        content: 'file contents here',
      },
    ],
  },
})

/** sidechain 서브에이전트 레코드 fixture */
const makeSidechainRecord = () => ({
  type: 'assistant',
  uuid: 'uuid-side-004',
  parentUuid: null,
  timestamp: '2024-01-15T10:00:03.000Z',
  sessionId: 'sess-abc123',
  cwd: '/home/user/my-project',
  isSidechain: true,
  message: {
    role: 'assistant',
    content: 'sidechain response',
  },
})

/** system 레코드 fixture */
const makeSystemRecord = () => ({
  type: 'system',
  uuid: 'uuid-sys-005',
  parentUuid: null,
  timestamp: '2024-01-15T10:00:00.500Z',
  sessionId: 'sess-abc123',
  cwd: '/home/user/my-project',
  subtype: 'init',
  isSidechain: false,
})

/** is_error=true (error) tool_result fixture */
const makeErrorToolResultRecord = () => ({
  type: 'user',
  uuid: 'uuid-err-006',
  parentUuid: 'uuid-asst-002',
  timestamp: '2024-01-15T10:00:04.000Z',
  sessionId: 'sess-abc123',
  cwd: '/home/user/my-project',
  isSidechain: false,
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool-id-001',
        is_error: true,
        content: 'File not found',
      },
    ],
  },
})

// ── 테스트: 기본 봉투 필드 매핑 ────────────────────────────────────────────

describe('normalize() — 기본 봉투 필드 매핑 (C5 BLOCKER)', () => {
  let event: NormalizedEvent

  beforeEach(() => {
    event = normalize(makeUserRecord(), 0, undefined, JSON.stringify(makeUserRecord()))
  })

  test('uuid: raw.uuid → event.uuid 매핑', () => {
    expect(event.uuid).toBe('uuid-user-001')
  })

  test('parentUuid: raw.parentUuid → event.parentUuid 매핑', () => {
    expect(event.parentUuid).toBe('uuid-parent-000')
  })

  test('sessionId: raw.sessionId → event.sessionId 매핑', () => {
    expect(event.sessionId).toBe('sess-abc123')
  })

  test('cwd: raw.cwd → event.cwd 매핑 (project_path 아님, C5 BLOCKER)', () => {
    expect(event.cwd).toBe('/home/user/my-project')
    // NormalizedEvent에 project_path 필드가 없음을 확인
    expect(event).not.toHaveProperty('project_path')
  })

  test('isSidechain: raw.isSidechain → event.isSidechain 매핑 (is_subagent 아님, C5 BLOCKER)', () => {
    expect(event.isSidechain).toBe(false)
    // is_subagent 필드가 없음을 확인
    expect(event).not.toHaveProperty('is_subagent')
  })

  test('ts: raw.timestamp(ISO) → event.ts(epoch ms) 변환', () => {
    expect(event.ts).toBe(Date.parse('2024-01-15T10:00:00.000Z'))
    expect(typeof event.ts).toBe('number')
  })

  test('byteOffset: 전달된 byteOffset → event.byteOffset 매핑', () => {
    const ev = normalize(makeUserRecord(), 1024, undefined, 'line')
    expect(ev.byteOffset).toBe(1024)
  })
})

// ── 테스트: kind 매핑 (role+event_type 아님, C5 BLOCKER) ───────────────────

describe('normalize() — kind 필드 매핑 (C5 BLOCKER)', () => {
  test('type="user" → kind="user"', () => {
    const ev = normalize(makeUserRecord())
    expect(ev.kind).toBe('user')
    expect(ev).not.toHaveProperty('role')
    expect(ev).not.toHaveProperty('event_type')
  })

  test('type="assistant" → kind="assistant"', () => {
    const ev = normalize(makeToolUseRecord())
    expect(ev.kind).toBe('assistant')
  })

  test('type="system" → kind="system"', () => {
    const ev = normalize(makeSystemRecord())
    expect(ev.kind).toBe('system')
  })

  test('알 수 없는 type → kind="other" (중단 금지)', () => {
    const unknownRecord = {
      type: 'unknown_future_type',
      uuid: 'uuid-unknown',
      timestamp: '2024-01-15T10:00:00.000Z',
      sessionId: 'sess-x',
      cwd: '/tmp',
      isSidechain: false,
    }
    const ev = normalize(unknownRecord)
    expect(ev.kind).toBe('other')
  })
})

// ── 테스트: agentScope 도출 (isSidechain + 서브에이전트 경로, C5 BLOCKER) ──

describe('normalize() — agentScope 필드 도출 (C5 BLOCKER)', () => {
  test('isSidechain=false + sourcePath 없음 → agentScope="root"', () => {
    const ev = normalize(makeUserRecord())
    expect(ev.agentScope).toBe('root')
  })

  test('isSidechain=true + sourcePath 없음 → agentScope="sidechain"', () => {
    const ev = normalize(makeSidechainRecord())
    expect(ev.agentScope).toBe('sidechain')
    expect(ev.isSidechain).toBe(true)
  })

  test('서브에이전트 경로(subagents/[id]/agent-*.jsonl) → agentScope에 id 포함', () => {
    const sourcePath = '/home/user/.claude/projects/proj/subagents/agent-sub-01/agent-20240115.jsonl'
    const ev = normalize(makeUserRecord(), 0, sourcePath)
    expect(ev.agentScope).toBe('agent-sub-01')
    expect(ev.agentScope).not.toBe('root')
  })

  test('agentScope 필드가 존재하고 string 타입이다', () => {
    const ev = normalize(makeUserRecord())
    expect(typeof ev.agentScope).toBe('string')
    // is_subagent 필드 없음 확인 (C5 BLOCKER)
    expect(ev).not.toHaveProperty('is_subagent')
  })
})

// ── 테스트: tool_use 블록 → tool + input + toolUseId 매핑 (C5 BLOCKER) ────

describe('normalize() — tool_use 블록 필드 매핑 (C5 BLOCKER)', () => {
  let event: NormalizedEvent

  beforeEach(() => {
    event = normalize(makeToolUseRecord())
  })

  test('content[].name → event.tool 매핑 (tool_name 아님, C5 BLOCKER)', () => {
    expect(event.tool).toBe('Read')
    expect(event).not.toHaveProperty('tool_name')
  })

  test('content[].input → event.input 매핑 (normalized_args_digest 아님, C5 BLOCKER)', () => {
    expect(event.input).toEqual({ file_path: '/src/index.ts' })
    expect(event).not.toHaveProperty('normalized_args_digest')
    expect(event).not.toHaveProperty('input_json')
  })

  test('content[].id → event.toolUseId 매핑', () => {
    expect(event.toolUseId).toBe('tool-id-001')
  })

  test('tool_use 레코드는 tool/input/toolUseId가 모두 정의되어 있다', () => {
    expect(event.tool).toBeDefined()
    expect(event.input).toBeDefined()
    expect(event.toolUseId).toBeDefined()
  })
})

// ── 테스트: tool_result 블록 → resultClass + toolUseId 매핑 (C5 BLOCKER) ──

/**
 * NOTE: Claude Code JSONL에서 tool_result는 두 가지 형태로 나타난다:
 *   A) type='user', message.content=[{type:'tool_result', ...}] — user 메시지 내 블록
 *   B) type='tool_result', message={type:'tool_result', ...} — 직접 tool_result 레코드
 *
 * 형태 A에서는 kind='user'로 도출되고, toolUseId는 tool_use 블록에서만 추출된다.
 * 형태 B에서는 kind='tool_result'로 도출되고, toolUseId가 tool_use_id에서 추출된다.
 * resultClass는 두 형태 모두에서 추출된다.
 */

/**
 * tool_result fixture: tool_use_id를 포함하는 user 메시지 내 tool_result 블록.
 * toolUseId 매핑 검증용으로 tool_use 블록과 tool_result 블록을 함께 포함.
 *
 * 파서 동작:
 *   - content 배열을 순회하며 tool_use → toolUseId, tool_result → resultClass 추출
 *   - kind='user' 레코드에서 finalToolUseId = toolUseId (tool_use 블록 기준)
 *   - tool_result.tool_use_id는 resultClass 계산에만 사용 (별도 경로 없음)
 */
const makeUserWithBothBlocks = () => ({
  type: 'user',
  uuid: 'uuid-both-007',
  parentUuid: null,
  timestamp: '2024-01-15T10:00:05.000Z',
  sessionId: 'sess-abc123',
  cwd: '/home/user/my-project',
  isSidechain: false,
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tool-id-ref',
        content: 'ok result',
      },
    ],
  },
})

describe('normalize() — tool_result 블록 필드 매핑 (C5 BLOCKER)', () => {
  test('user 메시지 내 tool_result → resultClass="ok" 매핑', () => {
    const ev = normalize(makeToolResultRecord())
    // user 메시지 내 tool_result 블록에서 resultClass 추출
    expect(ev.resultClass).toBe('ok')
    expect(ev).not.toHaveProperty('result_digest')
  })

  test('is_error=true → resultClass="error"', () => {
    const ev = normalize(makeErrorToolResultRecord())
    expect(ev.resultClass).toBe('error')
  })

  test('user 메시지 내 tool_result → resultClass가 정의되어 있다', () => {
    const ev = normalize(makeToolResultRecord())
    expect(ev.resultClass).toBeDefined()
  })

  test('user 메시지 내 단독 tool_result → resultClass="ok" 매핑', () => {
    const ev = normalize(makeUserWithBothBlocks())
    expect(ev.resultClass).toBe('ok')
  })

  test('result_class/result_digest 금지 필드가 없다 (C5 BLOCKER)', () => {
    const ev = normalize(makeToolResultRecord())
    expect(ev).not.toHaveProperty('result_class')
    expect(ev).not.toHaveProperty('result_digest')
  })

  test('tool_use 블록의 id → event.toolUseId 매핑 (C5 BLOCKER)', () => {
    // tool_use 레코드에서 toolUseId 매핑 확인 (contracts 정본: toolUseId)
    const ev = normalize(makeToolUseRecord())
    expect(ev.toolUseId).toBe('tool-id-001')
    expect(ev).not.toHaveProperty('tool_use_id')
  })
})

// ── 테스트: 선택 필드 처리 ─────────────────────────────────────────────────

describe('normalize() — 선택 필드 처리', () => {
  test('parentUuid=null → event.parentUuid=null', () => {
    const ev = normalize(makeSidechainRecord())
    expect(ev.parentUuid).toBeNull()
  })

  test('uuid 없는 레코드 → 합성 uuid 부여 (synth- 접두어)', () => {
    const record = {
      type: 'user',
      timestamp: '2024-01-15T10:00:00.000Z',
      sessionId: 'sess-x',
      cwd: '/tmp',
      isSidechain: false,
    }
    const ev = normalize(record, 100, undefined, JSON.stringify(record))
    expect(ev.uuid).toMatch(/^synth-/)
  })

  test('cwd 없는 레코드 → event.cwd=""(빈 문자열)', () => {
    const record = {
      type: 'user',
      uuid: 'uuid-no-cwd',
      timestamp: '2024-01-15T10:00:00.000Z',
      sessionId: 'sess-x',
      isSidechain: false,
    }
    const ev = normalize(record)
    expect(ev.cwd).toBe('')
  })

  test('timestamp 없는 레코드 → event.ts는 number(현재 시각 폴백)', () => {
    const before = Date.now()
    const record = {
      type: 'user',
      uuid: 'uuid-no-ts',
      sessionId: 'sess-x',
      cwd: '/tmp',
      isSidechain: false,
    }
    const ev = normalize(record)
    const after = Date.now()
    expect(typeof ev.ts).toBe('number')
    expect(ev.ts).toBeGreaterThanOrEqual(before)
    expect(ev.ts).toBeLessThanOrEqual(after)
  })

  test('system.subtype → event.systemSubtype 매핑', () => {
    const ev = normalize(makeSystemRecord())
    expect(ev.systemSubtype).toBe('init')
  })

  test('tool 없는 레코드 → event.tool=undefined', () => {
    const ev = normalize(makeUserRecord())
    expect(ev.tool).toBeUndefined()
  })

  test('tool_result 없는 레코드 → event.resultClass=undefined', () => {
    const ev = normalize(makeUserRecord())
    expect(ev.resultClass).toBeUndefined()
  })
})

// ── 테스트: 전체 NormalizedEvent 필수 필드 존재 확인 ────────────────────────

describe('normalize() — NormalizedEvent 필수 필드 완전성', () => {
  const requiredFields: Array<keyof NormalizedEvent> = [
    'uuid',
    'parentUuid',
    'sessionId',
    'cwd',
    'agentScope',
    'isSidechain',
    'ts',
    'byteOffset',
    'kind',
  ]

  test('user 레코드: 모든 필수 필드가 존재한다', () => {
    const ev = normalize(makeUserRecord())
    for (const field of requiredFields) {
      expect(ev).toHaveProperty(field)
    }
  })

  test('tool_use 레코드: 모든 필수 필드가 존재한다', () => {
    const ev = normalize(makeToolUseRecord())
    for (const field of requiredFields) {
      expect(ev).toHaveProperty(field)
    }
  })

  test('system 레코드: 모든 필수 필드가 존재한다', () => {
    const ev = normalize(makeSystemRecord())
    for (const field of requiredFields) {
      expect(ev).toHaveProperty(field)
    }
  })

  test('C5 BLOCKER 금지 필드가 NormalizedEvent에 없다', () => {
    const ev = normalize(makeUserRecord())
    // C5 BLOCKER: 다음 필드명은 contracts 정본에서 금지된 이름
    expect(ev).not.toHaveProperty('project_path')
    expect(ev).not.toHaveProperty('is_subagent')
    expect(ev).not.toHaveProperty('event_type')
    expect(ev).not.toHaveProperty('tool_name')
    expect(ev).not.toHaveProperty('normalized_args_digest')
    expect(ev).not.toHaveProperty('input_json')
    expect(ev).not.toHaveProperty('result_digest')
  })
})

// ── 테스트: 버전 가드 (알 수 없는 버전도 허용) ──────────────────────────────

describe('normalize() — 버전 가드 (중단 금지)', () => {
  test('version=1 레코드 → 정상 처리', () => {
    const ev = normalize(makeUserRecord())
    expect(ev.uuid).toBe('uuid-user-001')
  })

  test('version=99(미지 버전) 레코드 → 중단 없이 정상 처리', () => {
    const record = { ...makeUserRecord(), version: 99 }
    expect(() => normalize(record)).not.toThrow()
    const ev = normalize(record)
    expect(ev.kind).toBe('user')
  })

  test('version 필드 없는 레코드 → 중단 없이 정상 처리', () => {
    const { version: _v, ...record } = makeUserRecord()
    expect(() => normalize(record)).not.toThrow()
  })
})
