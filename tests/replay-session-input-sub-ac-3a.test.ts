// tests/replay-session-input-sub-ac-3a.test.ts
//
// Sub-AC 3a: replaySession 입력 처리 단계 단위 테스트.
//
// 검증 목표:
//   - 합성 JSONL 픽스처(문자열 배열 및 파일 경로 주입)로 parseLine 호출 횟수·순서·반환값 검증
//   - 부수효과 0: 파일시스템/실경로 리터럴 없음, Mock readLines 주입
//   - 빈 라인 필터링 동작
//   - 파싱 실패 라인 격리 (전체 중단 금지)
//   - byteOffset 누적 계산 정확성
//
// 제약:
//   - 실경로(~/.claude, ~/.dohyun 등) 리터럴 금지
//   - @anthropic-ai/sdk 금지
//   - 파일시스템 직접 접근 금지 (픽스처는 string[] 인라인 또는 Mock readLines)

import { parseLine } from '../src/ingest/parser.js'
import { processReplayInput } from '../src/eval/replay-session.js'

// ============================================================
// § 합성 픽스처 JSONL 라인
// ============================================================

const SESSION_ID = 'session-replay-test-01'
const CWD = '/tmp/synthetic-proj'

/** 유효한 합성 JSONL 라인 5개 */
const VALID_LINES: readonly string[] = [
  JSON.stringify({
    type: 'user',
    uuid: 'rp-u1',
    parentUuid: null,
    sessionId: SESSION_ID,
    cwd: CWD,
    timestamp: '2026-05-01T10:00:00.000Z',
    isSidechain: false,
    message: { role: 'user', content: 'Hello' },
  }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'rp-a1',
    parentUuid: 'rp-u1',
    sessionId: SESSION_ID,
    cwd: CWD,
    timestamp: '2026-05-01T10:00:01.000Z',
    isSidechain: false,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu-rp-1', name: 'Read', input: { file_path: 'a.ts' } }],
    },
  }),
  JSON.stringify({
    type: 'user',
    uuid: 'rp-r1',
    parentUuid: 'rp-a1',
    sessionId: SESSION_ID,
    cwd: CWD,
    timestamp: '2026-05-01T10:00:02.000Z',
    isSidechain: false,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu-rp-1', content: 'content here' }],
    },
  }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'rp-a2',
    parentUuid: 'rp-r1',
    sessionId: SESSION_ID,
    cwd: CWD,
    timestamp: '2026-05-01T10:00:03.000Z',
    isSidechain: false,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu-rp-2', name: 'Edit', input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' } }],
    },
  }),
  JSON.stringify({
    type: 'user',
    uuid: 'rp-r2',
    parentUuid: 'rp-a2',
    sessionId: SESSION_ID,
    cwd: CWD,
    timestamp: '2026-05-01T10:00:04.000Z',
    isSidechain: false,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu-rp-2', content: '' }],
    },
  }),
]

const INVALID_LINE = '{ this is not valid json }'
const PARTIAL_JSON = '{"type":"user","uuid":"rp-broken"'  // 잘린 JSON

// ============================================================
// § 헬퍼: byteOffset 누적 검증용
// ============================================================

function computeExpectedByteOffsets(lines: string[]): number[] {
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += Buffer.byteLength(line + '\n', 'utf8')
  }
  return offsets
}

// ============================================================
// § 테스트 스위트
// ============================================================

describe('processReplayInput — Sub-AC 3a 입력 처리 단계', () => {

  // ─── 기본 동작 ───────────────────────────────────────────

  test('string[] 입력: parseLine이 라인 수만큼 호출된다', () => {
    const result = processReplayInput([...VALID_LINES])

    expect(result.parseResults).toHaveLength(VALID_LINES.length)
    expect(result.rawLines).toHaveLength(VALID_LINES.length)
  })

  test('string[] 입력: 모든 라인이 parseOk=true로 파싱된다', () => {
    const result = processReplayInput([...VALID_LINES])

    for (const pr of result.parseResults) {
      expect(pr.parseOk).toBe(true)
    }
  })

  test('string[] 입력: events 배열 길이가 parseOk=true 라인 수와 일치한다', () => {
    const result = processReplayInput([...VALID_LINES])

    expect(result.events).toHaveLength(VALID_LINES.length)
    expect(result.parseFailCount).toBe(0)
  })

  // ─── UUID·순서 검증 ───────────────────────────────────────

  test('parseLine 반환값 순서가 입력 라인 순서와 동일하다', () => {
    const result = processReplayInput([...VALID_LINES])

    // 각 parseResult.event.uuid가 입력 라인의 uuid와 순서대로 일치
    const expectedUuids = ['rp-u1', 'rp-a1', 'rp-r1', 'rp-a2', 'rp-r2']
    const actualUuids = result.parseResults.map((pr) => pr.event.uuid)
    expect(actualUuids).toEqual(expectedUuids)
  })

  test('events 배열 순서가 입력 라인 순서와 동일하다', () => {
    const result = processReplayInput([...VALID_LINES])

    const expectedUuids = ['rp-u1', 'rp-a1', 'rp-r1', 'rp-a2', 'rp-r2']
    const actualUuids = result.events.map((e) => e.uuid)
    expect(actualUuids).toEqual(expectedUuids)
  })

  // ─── parseLine 반환값 검증 ────────────────────────────────

  test('parseLine 반환값이 직접 parseLine 호출 결과와 동일하다', () => {
    const result = processReplayInput([...VALID_LINES])

    // 동일한 입력으로 직접 parseLine 호출 결과와 비교
    let offset = 0
    for (let i = 0; i < VALID_LINES.length; i++) {
      const line = VALID_LINES[i]!
      const direct = parseLine(line, offset, '<inline>')
      const fromProcess = result.parseResults[i]!

      expect(fromProcess.parseOk).toBe(direct.parseOk)
      expect(fromProcess.event.uuid).toBe(direct.event.uuid)
      expect(fromProcess.event.sessionId).toBe(direct.event.sessionId)
      expect(fromProcess.event.kind).toBe(direct.event.kind)
      expect(fromProcess.event.byteOffset).toBe(direct.event.byteOffset)

      offset += Buffer.byteLength(line + '\n', 'utf8')
    }
  })

  test('byteOffset이 라인별로 정확히 누적된다', () => {
    const lines = [...VALID_LINES]
    const result = processReplayInput(lines)
    const expectedOffsets = computeExpectedByteOffsets(lines)

    for (let i = 0; i < result.parseResults.length; i++) {
      expect(result.parseResults[i]!.event.byteOffset).toBe(expectedOffsets[i])
    }
  })

  // ─── 파싱 실패 격리 ───────────────────────────────────────

  test('파싱 실패 라인은 parseOk=false이고 전체 파이프라인이 중단되지 않는다', () => {
    const linesWithBroken = [VALID_LINES[0]!, INVALID_LINE, VALID_LINES[1]!]
    const result = processReplayInput(linesWithBroken)

    expect(result.parseResults).toHaveLength(3)
    expect(result.parseResults[0]!.parseOk).toBe(true)
    expect(result.parseResults[1]!.parseOk).toBe(false)
    expect(result.parseResults[2]!.parseOk).toBe(true)
  })

  test('파싱 실패 라인은 events 배열에 포함되지 않는다', () => {
    const linesWithBroken = [VALID_LINES[0]!, INVALID_LINE, VALID_LINES[1]!]
    const result = processReplayInput(linesWithBroken)

    // events는 parseOk=true인 2개만
    expect(result.events).toHaveLength(2)
    expect(result.events[0]!.uuid).toBe('rp-u1')
    expect(result.events[1]!.uuid).toBe('rp-a1')
  })

  test('parseFailCount가 파싱 실패 수를 정확히 집계한다', () => {
    const linesWithBroken = [VALID_LINES[0]!, INVALID_LINE, PARTIAL_JSON, VALID_LINES[1]!]
    const result = processReplayInput(linesWithBroken)

    expect(result.parseFailCount).toBe(2)
    expect(result.events).toHaveLength(2)
  })

  // ─── 빈 라인 필터링 ───────────────────────────────────────

  test('빈 라인은 rawLines에서 제거된다', () => {
    const linesWithBlanks = [
      VALID_LINES[0]!,
      '',           // 완전 빈 라인
      '   ',        // 공백만 있는 라인
      VALID_LINES[1]!,
      '\t',         // 탭만 있는 라인
    ]
    const result = processReplayInput(linesWithBlanks)

    expect(result.rawLines).toHaveLength(2)
    expect(result.parseResults).toHaveLength(2)
  })

  test('빈 라인만 있으면 rawLines와 events가 모두 비어 있다', () => {
    const result = processReplayInput(['', '  ', '\t', '\n'])

    expect(result.rawLines).toHaveLength(0)
    expect(result.events).toHaveLength(0)
    expect(result.parseResults).toHaveLength(0)
    expect(result.parseFailCount).toBe(0)
  })

  test('빈 배열 입력: rawLines와 events가 모두 비어 있다', () => {
    const result = processReplayInput([])

    expect(result.rawLines).toHaveLength(0)
    expect(result.events).toHaveLength(0)
    expect(result.parseResults).toHaveLength(0)
    expect(result.parseFailCount).toBe(0)
  })

  // ─── sourcePath 동작 ─────────────────────────────────────

  test('string[] 입력 시 sourcePath는 "<inline>"이다', () => {
    const result = processReplayInput([...VALID_LINES])

    expect(result.sourcePath).toBe('<inline>')
  })

  test('파일 경로 입력 시 sourcePath가 해당 경로로 설정된다', () => {
    const fakeFilePath = '/tmp/test-session.jsonl'
    const mockReadLines = (_path: string): string[] => [...VALID_LINES]

    const result = processReplayInput(fakeFilePath, mockReadLines)

    expect(result.sourcePath).toBe(fakeFilePath)
  })

  // ─── Mock readLines 주입 (파일 경로 경로) ─────────────────

  test('Mock readLines 주입: readLines가 반환한 라인으로 parseLine이 호출된다', () => {
    const fakeFilePath = '/tmp/fake-session.jsonl'
    const expectedLines = [VALID_LINES[0]!, VALID_LINES[1]!, VALID_LINES[2]!]
    const mockReadLines = (_path: string): string[] => expectedLines

    const result = processReplayInput(fakeFilePath, mockReadLines)

    expect(result.rawLines).toHaveLength(3)
    expect(result.parseResults).toHaveLength(3)
    expect(result.events).toHaveLength(3)
    expect(result.events[0]!.uuid).toBe('rp-u1')
    expect(result.events[1]!.uuid).toBe('rp-a1')
    expect(result.events[2]!.uuid).toBe('rp-r1')
  })

  test('Mock readLines: readLines에 전달된 경로가 입력 경로와 동일하다', () => {
    const fakeFilePath = '/tmp/verify-path.jsonl'
    const capturedPaths: string[] = []
    const mockReadLines = (path: string): string[] => {
      capturedPaths.push(path)
      return [VALID_LINES[0]!]
    }

    processReplayInput(fakeFilePath, mockReadLines)

    expect(capturedPaths).toHaveLength(1)
    expect(capturedPaths[0]).toBe(fakeFilePath)
  })

  test('파일 경로 입력에 readLines가 없으면 에러를 던진다', () => {
    expect(() => {
      processReplayInput('/tmp/no-reader.jsonl')
    }).toThrow(/readLines/)
  })

  // ─── 세션 ID 보존 ─────────────────────────────────────────

  test('모든 이벤트가 동일한 sessionId를 가진다', () => {
    const result = processReplayInput([...VALID_LINES])

    for (const event of result.events) {
      expect(event.sessionId).toBe(SESSION_ID)
    }
  })

  // ─── 단일 라인 ────────────────────────────────────────────

  test('단일 라인 입력: parseResults와 events가 각각 1개이다', () => {
    const result = processReplayInput([VALID_LINES[0]!])

    expect(result.rawLines).toHaveLength(1)
    expect(result.parseResults).toHaveLength(1)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]!.uuid).toBe('rp-u1')
    expect(result.parseFailCount).toBe(0)
  })

  test('단일 라인의 byteOffset은 0이다', () => {
    const result = processReplayInput([VALID_LINES[0]!])

    expect(result.parseResults[0]!.event.byteOffset).toBe(0)
  })

  // ─── 이벤트 타입 검증 ────────────────────────────────────

  test('parseLine 결과 events의 kind가 올바르게 파싱된다', () => {
    const result = processReplayInput([...VALID_LINES])

    expect(result.events[0]!.kind).toBe('user')      // rp-u1
    expect(result.events[1]!.kind).toBe('assistant') // rp-a1 (tool_use 포함)
    expect(result.events[2]!.kind).toBe('user')      // rp-r1 (tool_result 포함)
    expect(result.events[3]!.kind).toBe('assistant') // rp-a2 (tool_use 포함)
    expect(result.events[4]!.kind).toBe('user')      // rp-r2 (tool_result 포함)
  })

  // ─── 전체 라인 실패 ───────────────────────────────────────

  test('모든 라인이 파싱 실패해도 전체 파이프라인이 중단되지 않는다', () => {
    const allBrokenLines = [INVALID_LINE, PARTIAL_JSON, '!!!']
    const result = processReplayInput(allBrokenLines)

    expect(result.parseResults).toHaveLength(3)
    expect(result.events).toHaveLength(0)
    expect(result.parseFailCount).toBe(3)
  })
})
