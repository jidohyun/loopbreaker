/**
 * tests/self-check.test.ts
 *
 * selfCheck(): 세션 JSONL → 구조 게이트 → thrashing 판정 (결정론적, API 없음).
 *
 * 검증:
 *  1. 같은 파일 미세 반복 편집(thrashing) JSONL → thrashing=true, severity 발화
 *  2. 정상 진행(서로 다른 파일/줄) JSONL → thrashing=false
 *  3. 파일 경로 입력과 라인 배열 입력이 동일 결과
 *  4. 빈 입력 → thrashing=false, 안전
 */

import { describe, it, expect } from '@jest/globals'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { selfCheck } from '../src/api/self-check.js'

// ─── 픽스처 생성 헬퍼 ────────────────────────────────────────────────────────

/** 같은 파일 calc()를 N회 미세 반복 편집하는 thrashing 세션 라인 배열 */
function makeThrashingLines(sessionId: string, editCount: number): string[] {
  const lines: string[] = []
  let prevUuid: string | null = null
  let ts = Date.parse('2026-06-17T10:00:00.000Z')

  const push = (obj: Record<string, unknown>): void => {
    lines.push(
      JSON.stringify({
        ...obj,
        sessionId,
        cwd: '/tmp/proj',
        isSidechain: false,
        parentUuid: prevUuid,
        timestamp: new Date(ts).toISOString(),
      }),
    )
    ts += 1500
    prevUuid = obj['uuid'] as string
  }

  push({ type: 'user', uuid: 'u0', message: { role: 'user', content: 'calc 고쳐줘' } })

  const variants = ['1', '2', '1', '1.0', '2', '0', '1', '3', '1', '2']
  for (let i = 0; i < editCount; i++) {
    const v = variants[i % variants.length]
    const prev = variants[(i - 1 + variants.length) % variants.length] ?? '0'
    push({
      type: 'assistant',
      uuid: `a${i + 1}`,
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: `tu-${i + 1}`,
            name: 'Edit',
            input: {
              file_path: '/tmp/proj/demo.ts',
              old_string: `function calc() { return ${prev}; }`,
              new_string: `function calc() { return ${v}; }`,
            },
          },
        ],
      },
    })
    push({
      type: 'user',
      uuid: `r${i + 1}`,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: `tu-${i + 1}`, content: 'edited' }],
      },
    })
  }
  return lines
}

/** 서로 다른 파일을 편집하는 정상 진행 세션 라인 배열 */
function makeHealthyLines(sessionId: string): string[] {
  const lines: string[] = []
  let prevUuid: string | null = null
  let ts = Date.parse('2026-06-17T10:00:00.000Z')
  const push = (obj: Record<string, unknown>): void => {
    lines.push(
      JSON.stringify({
        ...obj,
        sessionId,
        cwd: '/tmp/proj',
        isSidechain: false,
        parentUuid: prevUuid,
        timestamp: new Date(ts).toISOString(),
      }),
    )
    ts += 1500
    prevUuid = obj['uuid'] as string
  }
  push({ type: 'user', uuid: 'u0', message: { role: 'user', content: '여러 파일 작업' } })
  const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts']
  files.forEach((f, i) => {
    push({
      type: 'assistant',
      uuid: `a${i + 1}`,
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: `tu-${i + 1}`,
            name: 'Edit',
            input: {
              file_path: `/tmp/proj/${f}`,
              old_string: `const x${i} = 0`,
              new_string: `const x${i} = ${i + 1}`,
            },
          },
        ],
      },
    })
    push({
      type: 'user',
      uuid: `r${i + 1}`,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: `tu-${i + 1}`, content: 'ok' }],
      },
    })
  })
  return lines
}

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('selfCheck — thrashing 세션', () => {
  it('같은 파일을 critical 임계 이상 미세 반복 편집하면 thrashing=true, critical 발화', () => {
    const lines = makeThrashingLines('thrash-1', 10)
    const result = selfCheck(lines)

    expect(result.thrashing).toBe(true)
    expect(result.severity).toBe('critical')
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.hits[0]!.gate.type).toBe('thrashing')
    expect(result.summary.hitCount).toBe(result.hits.length)
    expect(result.summary.verdict).toContain('thrashing')
  })

  it('warning 임계(5회)~critical 미만(7회)이면 warning 발화', () => {
    const lines = makeThrashingLines('thrash-2', 6)
    const result = selfCheck(lines)

    expect(result.thrashing).toBe(true)
    expect(result.severity).toBe('warning')
  })
})

describe('selfCheck — 정상 세션', () => {
  it('서로 다른 파일을 편집하는 정상 진행은 thrashing=false', () => {
    const lines = makeHealthyLines('healthy-1')
    const result = selfCheck(lines)

    expect(result.thrashing).toBe(false)
    expect(result.severity).toBeNull()
    expect(result.hits).toHaveLength(0)
    expect(result.summary.verdict).toContain('신호 없음')
  })
})

describe('selfCheck — 입력 형태', () => {
  it('파일 경로 입력과 라인 배열 입력이 동일한 결과를 낸다', () => {
    const lines = makeThrashingLines('thrash-eq', 10)
    const fromLines = selfCheck(lines)

    const dir = mkdtempSync(join(tmpdir(), 'lb-selfcheck-'))
    const file = join(dir, 'session.jsonl')
    writeFileSync(file, lines.join('\n') + '\n')
    const fromFile = selfCheck(file)

    expect(fromFile.thrashing).toBe(fromLines.thrashing)
    expect(fromFile.severity).toBe(fromLines.severity)
    expect(fromFile.hits.length).toBe(fromLines.hits.length)
  })

  it('빈 입력은 thrashing=false로 안전하게 처리한다', () => {
    const result = selfCheck([])
    expect(result.thrashing).toBe(false)
    expect(result.severity).toBeNull()
    expect(result.summary.eventCount).toBe(0)
  })
})
