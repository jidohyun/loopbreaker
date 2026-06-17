// tests/cli-dispatch.test.ts
//
// CLI 디스패처 단위 테스트.
// Mock CliIO로 dispatch를 호출해 부수효과 0(실 데몬 기동·launchd 없음)으로 검증.

import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatch, type CliIO } from '../src/cli/index.js'

function makeIo(): { io: CliIO; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return {
    io: { out: (s) => out.push(s), err: (s) => err.push(s) },
    out,
    err,
  }
}

/** 같은 파일을 N회 미세 반복 편집하는 thrashing JSONL 파일을 임시로 만들고 경로 반환 */
function writeThrashingJsonl(editCount: number): string {
  const lines: string[] = []
  let prev: string | null = null
  let ts = Date.parse('2026-06-17T10:00:00.000Z')
  const push = (o: Record<string, unknown>): void => {
    lines.push(
      JSON.stringify({
        ...o,
        sessionId: 'cli-thrash',
        cwd: '/tmp/proj',
        isSidechain: false,
        parentUuid: prev,
        timestamp: new Date(ts).toISOString(),
      }),
    )
    ts += 1500
    prev = o['uuid'] as string
  }
  push({ type: 'user', uuid: 'u0', message: { role: 'user', content: 'go' } })
  const vs = ['1', '2', '1', '1.0', '2', '0', '1', '3', '1', '2']
  for (let i = 0; i < editCount; i++) {
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
              old_string: `function calc() { return ${vs[(i - 1 + vs.length) % vs.length]}; }`,
              new_string: `function calc() { return ${vs[i % vs.length]}; }`,
            },
          },
        ],
      },
    })
  }
  const dir = mkdtempSync(join(tmpdir(), 'lb-cli-'))
  const file = join(dir, 'cli-thrash.jsonl')
  writeFileSync(file, lines.join('\n') + '\n')
  return file
}

describe('CLI dispatch', () => {
  test('version 명령은 버전을 출력하고 0을 반환한다', async () => {
    const { io, out } = makeIo()
    const code = await dispatch(['version'], io)
    expect(code).toBe(0)
    expect(out.join('')).toContain('loopbreaker 0.1.0')
  })

  test('help/인자 없음은 도움말을 출력하고 0을 반환한다', async () => {
    for (const argv of [['help'], [] as string[], ['--help']]) {
      const { io, out } = makeIo()
      const code = await dispatch(argv, io)
      expect(code).toBe(0)
      expect(out.join('')).toContain('loopbreaker <command>')
    }
  })

  test('알 수 없는 명령은 1을 반환하고 도움말을 출력한다', async () => {
    const { io, out, err } = makeIo()
    const code = await dispatch(['frobnicate'], io)
    expect(code).toBe(1)
    expect(err.join('')).toContain('알 수 없는 명령')
    expect(out.join('')).toContain('loopbreaker <command>')
  })

  test('status는 데몬 미실행·DB 없음 상황에서도 0을 반환한다 (read-only 조회)', async () => {
    // 실제 ~/.loopbreaker가 없거나 lockfile 없으면 '정지'로 출력. 부수효과 없음.
    const { io, out } = makeIo()
    const code = await dispatch(['status'], io)
    expect(code).toBe(0)
    expect(out.join('')).toContain('loopbreaker status')
    expect(out.join('')).toMatch(/데몬:/)
  })

  test('status --json은 JSON 요약을 출력한다', async () => {
    const { io, out } = makeIo()
    const code = await dispatch(['status', '--json'], io)
    expect(code).toBe(0)
    const parsed = JSON.parse(out.join('')) as { running: boolean; sessionCount: number }
    expect(typeof parsed.running).toBe('boolean')
    expect(typeof parsed.sessionCount).toBe('number')
  })

  test('doctor는 건강검진 항목을 출력한다', async () => {
    const { io, out } = makeIo()
    const code = await dispatch(['doctor'], io)
    expect([0, 1]).toContain(code) // 환경에 따라 0/1 (항목 충족 여부)
    expect(out.join('')).toContain('loopbreaker doctor')
    expect(out.join('')).toContain('ANTHROPIC_API_KEY')
  })

  test('start(--foreground 없음)는 안내만 출력하고 데몬을 띄우지 않는다', async () => {
    const { io, out } = makeIo()
    const code = await dispatch(['start'], io)
    expect(code).toBe(0)
    expect(out.join('')).toContain('--foreground')
  })

  test('stop은 안내를 출력하고 0을 반환한다', async () => {
    const { io, out } = makeIo()
    const code = await dispatch(['stop'], io)
    expect(code).toBe(0)
    expect(out.join('')).toContain('loopbreaker stop')
  })

  test('self-check: thrashing JSONL → exit 2, ⚠️ 출력', async () => {
    const file = writeThrashingJsonl(10)
    const { io, out } = makeIo()
    const code = await dispatch(['self-check', file], io)
    expect(code).toBe(2) // 발화 신호
    expect(out.join('')).toContain('thrashing 감지')
    expect(out.join('')).toContain('critical')
  })

  test('self-check --json: 파싱 가능한 구조 출력', async () => {
    const file = writeThrashingJsonl(10)
    const { io, out } = makeIo()
    const code = await dispatch(['self-check', file, '--json'], io)
    expect(code).toBe(2)
    const parsed = JSON.parse(out.join('')) as {
      thrashing: boolean
      severity: string
      hits: unknown[]
    }
    expect(parsed.thrashing).toBe(true)
    expect(parsed.severity).toBe('critical')
    expect(Array.isArray(parsed.hits)).toBe(true)
  })

  test('self-check: 인자 없음 → exit 1, 사용법 안내', async () => {
    const { io, err } = makeIo()
    const code = await dispatch(['self-check'], io)
    expect(code).toBe(1)
    expect(err.join('')).toContain('사용법')
  })

  test('self-check: 존재하지 않는 세션 → exit 1', async () => {
    const { io, err } = makeIo()
    const code = await dispatch(['self-check', 'no-such-session-id-xyz'], io)
    expect(code).toBe(1)
    expect(err.join('')).toContain('찾지 못함')
  })
})
