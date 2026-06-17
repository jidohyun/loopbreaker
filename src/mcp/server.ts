#!/usr/bin/env node
// src/mcp/server.ts
//
// LoopBreaker MCP stdio 서버.
//
// 작업 중인 Claude Code 에이전트(또는 다른 MCP 클라이언트)가 LoopBreaker의
// 자기점검·상태 조회 기능을 도구로 호출할 수 있게 노출한다.
//
// 노출 도구:
//   - loopbreaker_self_check       : 세션 JSONL을 분석해 지금 thrashing 중인지 판정
//   - loopbreaker_status           : 데몬 상태·세션 수·최근 탐지 요약
//   - loopbreaker_recent_detections: 최근 탐지 목록
//
// 설계:
//   - 모든 도구는 CLI dispatch(io 캡처)를 재사용한다 — CLI가 단일 진실 출처.
//     self_check는 selfCheck() 코어를, status는 ops.db read-only 조회를 그 경로로 부른다.
//     (임베딩·judge·API 키 불필요, 결정론적.)
//   - read-only: 어떤 도구도 에이전트에 개입하거나 파일을 쓰지 않는다.
//
// 부수효과 격리: import 시 실행되지 않는다(isMain 가드). 스폰될 때만 stdio 연결.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { dispatch, type CliIO } from '../cli/index.js'

const SERVER_VERSION = '0.1.0'

/** dispatch를 호출하고 stdout/stderr를 문자열로 캡처한다. */
async function captureDispatch(argv: string[]): Promise<{
  code: number
  out: string
  err: string
}> {
  const out: string[] = []
  const err: string[] = []
  const io: CliIO = { out: (s) => out.push(s), err: (s) => err.push(s) }
  const code = await dispatch(argv, io)
  return { code, out: out.join(''), err: err.join('') }
}

/** MCP 서버를 구성한다 (테스트에서 transport 없이 도구 등록만 검증 가능). */
export function buildServer(): McpServer {
  const server = new McpServer({
    name: 'loopbreaker',
    version: SERVER_VERSION,
  })

  // ── loopbreaker_self_check ──────────────────────────────────────────────
  server.registerTool(
    'loopbreaker_self_check',
    {
      title: 'LoopBreaker Self-Check',
      description:
        '작업 중인 세션이 지금 thrashing(같은 영역을 미세하게 반복 편집하며 헛돌기) 중인지 ' +
        '세션 JSONL을 구조 분석해 즉시 판정한다. 결정론적이며 API 키가 필요 없다. ' +
        '자기 세션이 헛돌고 있다고 의심되면 호출해서 접근을 바꿀지 사람을 부를지 판단하라.',
      inputSchema: {
        session: z
          .string()
          .describe(
            '세션 JSONL 파일 경로(예: ~/.claude/projects/<proj>/<id>.jsonl) ' +
              '또는 세션 ID(예: abc-123). ID면 ~/.claude/projects에서 자동 탐색.',
          ),
      },
    },
    async ({ session }) => {
      const { code, out, err } = await captureDispatch([
        'self-check',
        session,
        '--json',
      ])
      if (code === 1) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: err || '세션을 찾지 못했습니다.' }],
        }
      }
      // code 0(정상) 또는 2(thrashing 발화) 둘 다 JSON 결과 반환
      return { content: [{ type: 'text' as const, text: out.trim() }] }
    },
  )

  // ── loopbreaker_status ──────────────────────────────────────────────────
  server.registerTool(
    'loopbreaker_status',
    {
      title: 'LoopBreaker Status',
      description:
        'LoopBreaker 데몬의 상태(실행 여부)·감시 중인 세션 수·누적 탐지 수·최근 탐지를 ' +
        '운영 DB에서 read-only로 조회한다.',
      inputSchema: {},
    },
    async () => {
      const { out } = await captureDispatch(['status', '--json'])
      return { content: [{ type: 'text' as const, text: out.trim() }] }
    },
  )

  // ── loopbreaker_recent_detections ───────────────────────────────────────
  server.registerTool(
    'loopbreaker_recent_detections',
    {
      title: 'LoopBreaker Recent Detections',
      description:
        '데몬이 최근 기록한 탐지 목록(kind/subtype/시각)만 추려서 반환한다. ' +
        'status의 recentDetections 부분.',
      inputSchema: {},
    },
    async () => {
      const { out } = await captureDispatch(['status', '--json'])
      let recent: unknown = []
      try {
        const parsed = JSON.parse(out) as { recentDetections?: unknown }
        recent = parsed.recentDetections ?? []
      } catch {
        // status 파싱 실패 시 빈 목록
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(recent, null, 2) }],
      }
    },
  )

  return server
}

/** stdio로 서버를 기동한다. */
export async function main(): Promise<void> {
  const server = buildServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

/** import 시 실행 금지 가드 */
function isMain(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  return import.meta.url === `file://${entry}`
}

if (isMain()) {
  main().catch((err: unknown) => {
    process.stderr.write(`[loopbreaker-mcp FATAL] ${String(err)}\n`)
    process.exitCode = 1
  })
}
