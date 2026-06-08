// tests/cli-dispatch.test.ts
//
// CLI 디스패처 단위 테스트.
// Mock CliIO로 dispatch를 호출해 부수효과 0(실 데몬 기동·launchd 없음)으로 검증.

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
})
