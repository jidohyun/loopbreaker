/**
 * tests/mcp-server.test.ts
 *
 * MCP 서버가 도구를 등록하는지 검증한다 (stdio transport 없이 buildServer만).
 *
 * 부수효과 0: 서버를 connect하지 않으므로 stdio·프로세스 종속 없음.
 */

import { describe, it, expect } from '@jest/globals'
import { buildServer } from '../src/mcp/server.js'

describe('LoopBreaker MCP 서버', () => {
  it('buildServer는 McpServer 인스턴스를 반환한다', () => {
    const server = buildServer()
    expect(server).toBeDefined()
    // McpServer는 connect 메서드를 갖는다 (덕 타이핑 검증)
    expect(typeof (server as { connect?: unknown }).connect).toBe('function')
  })

  it('3개 도구(self_check/status/recent_detections)를 등록한다', () => {
    const server = buildServer()
    // McpServer 내부 _registeredTools 맵에서 등록된 도구 이름 확인.
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools
    const names = Object.keys(tools)
    expect(names).toContain('loopbreaker_self_check')
    expect(names).toContain('loopbreaker_status')
    expect(names).toContain('loopbreaker_recent_detections')
  })
})
