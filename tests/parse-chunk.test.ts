/**
 * tests/parse-chunk.test.ts
 *
 * parseChunk(buffer, partialLine) 단위 테스트.
 *
 * 검증 범위:
 *   - 기본 동작: 완성된 라인 반환 + 미완성 partialLine 보류
 *   - 청크 경계에서 분리된 JSON (연속 호출로 조합)
 *   - 빈 입력 엣지케이스 (빈 Buffer, 빈 partialLine)
 *   - \r\n, \r, \n 개행 처리
 *   - 빈 라인(공백만 있는 라인) 필터링
 *   - partialLine 누적 (이전 미완성 + 새 청크 합산)
 *   - 여러 라인이 한 청크에 포함된 경우
 */

import { parseChunk } from '../src/ingest/parser.js'

describe('parseChunk', () => {
  // ──────────────────────────────────────────────────
  // 기본 동작
  // ──────────────────────────────────────────────────

  it('단일 완성 JSON 라인을 반환한다', () => {
    const line = '{"type":"user","uuid":"abc"}'
    const chunk = Buffer.from(line + '\n', 'utf8')
    const result = parseChunk(chunk, '')

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toBe(line)
    expect(result.partialLine).toBe('')
  })

  it('여러 완성 JSON 라인을 반환한다', () => {
    const line1 = '{"type":"user"}'
    const line2 = '{"type":"assistant"}'
    const line3 = '{"type":"system"}'
    const chunk = Buffer.from(`${line1}\n${line2}\n${line3}\n`, 'utf8')
    const result = parseChunk(chunk, '')

    expect(result.lines).toHaveLength(3)
    expect(result.lines[0]).toBe(line1)
    expect(result.lines[1]).toBe(line2)
    expect(result.lines[2]).toBe(line3)
    expect(result.partialLine).toBe('')
  })

  it('개행 없이 끝나는 라인은 partialLine으로 보류된다', () => {
    const partial = '{"type":"user","uuid":'
    const chunk = Buffer.from(partial, 'utf8')
    const result = parseChunk(chunk, '')

    expect(result.lines).toHaveLength(0)
    expect(result.partialLine).toBe(partial)
  })

  it('완성된 라인 + 미완성 라인을 올바르게 분리한다', () => {
    const complete = '{"type":"user","uuid":"abc"}'
    const partial = '{"type":"assistant","uuid":'
    const chunk = Buffer.from(`${complete}\n${partial}`, 'utf8')
    const result = parseChunk(chunk, '')

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toBe(complete)
    expect(result.partialLine).toBe(partial)
  })

  // ──────────────────────────────────────────────────
  // 청크 경계에서 분리된 JSON (연속 호출 시나리오)
  // ──────────────────────────────────────────────────

  it('청크 경계에서 JSON이 분리된 경우 연속 호출로 조합된다', () => {
    const fullLine = '{"type":"user","uuid":"xyz","sessionId":"s1"}'

    // 첫 번째 청크: JSON의 절반
    const chunk1 = Buffer.from(fullLine.slice(0, 20), 'utf8')
    const result1 = parseChunk(chunk1, '')
    expect(result1.lines).toHaveLength(0)
    expect(result1.partialLine).toBe(fullLine.slice(0, 20))

    // 두 번째 청크: 나머지 + 개행
    const chunk2 = Buffer.from(fullLine.slice(20) + '\n', 'utf8')
    const result2 = parseChunk(chunk2, result1.partialLine)
    expect(result2.lines).toHaveLength(1)
    expect(result2.lines[0]).toBe(fullLine)
    expect(result2.partialLine).toBe('')
  })

  it('세 개의 청크로 분리된 JSON을 올바르게 조합한다', () => {
    const fullLine = '{"type":"assistant","uuid":"u1","ts":1234567890}'

    const chunk1 = Buffer.from(fullLine.slice(0, 15), 'utf8')
    const r1 = parseChunk(chunk1, '')
    expect(r1.lines).toHaveLength(0)

    const chunk2 = Buffer.from(fullLine.slice(15, 30), 'utf8')
    const r2 = parseChunk(chunk2, r1.partialLine)
    expect(r2.lines).toHaveLength(0)

    const chunk3 = Buffer.from(fullLine.slice(30) + '\n', 'utf8')
    const r3 = parseChunk(chunk3, r2.partialLine)
    expect(r3.lines).toHaveLength(1)
    expect(r3.lines[0]).toBe(fullLine)
    expect(r3.partialLine).toBe('')
  })

  it('한 청크에 완성 라인 + 경계 분리 미완성 라인이 공존한다', () => {
    const complete1 = '{"type":"user"}'
    const complete2 = '{"type":"system"}'
    const partialStart = '{"type":"tool_'

    const chunk1 = Buffer.from(`${complete1}\n${complete2}\n${partialStart}`, 'utf8')
    const r1 = parseChunk(chunk1, '')
    expect(r1.lines).toHaveLength(2)
    expect(r1.lines[0]).toBe(complete1)
    expect(r1.lines[1]).toBe(complete2)
    expect(r1.partialLine).toBe(partialStart)

    const partialEnd = 'use"}'
    const chunk2 = Buffer.from(`${partialEnd}\n`, 'utf8')
    const r2 = parseChunk(chunk2, r1.partialLine)
    expect(r2.lines).toHaveLength(1)
    expect(r2.lines[0]).toBe(partialStart + partialEnd)
    expect(r2.partialLine).toBe('')
  })

  // ──────────────────────────────────────────────────
  // 빈 입력 엣지케이스
  // ──────────────────────────────────────────────────

  it('빈 Buffer + 빈 partialLine → lines=[], partialLine=""', () => {
    const result = parseChunk(Buffer.alloc(0), '')
    expect(result.lines).toHaveLength(0)
    expect(result.partialLine).toBe('')
  })

  it('빈 Buffer + 기존 partialLine → lines=[], partialLine 그대로 보존', () => {
    const existing = '{"type":"user","partial":true'
    const result = parseChunk(Buffer.alloc(0), existing)
    expect(result.lines).toHaveLength(0)
    expect(result.partialLine).toBe(existing)
  })

  it('개행만 있는 Buffer → 빈 라인 필터링, lines=[], partialLine=""', () => {
    const chunk = Buffer.from('\n\n\n', 'utf8')
    const result = parseChunk(chunk, '')
    expect(result.lines).toHaveLength(0)
    expect(result.partialLine).toBe('')
  })

  it('공백만 있는 라인은 필터링된다', () => {
    const chunk = Buffer.from('  \n{"type":"user"}\n   \n', 'utf8')
    const result = parseChunk(chunk, '')
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toBe('{"type":"user"}')
  })

  // ──────────────────────────────────────────────────
  // 개행 변형 처리 (\r\n, \r, \n)
  // ──────────────────────────────────────────────────

  it('\\r\\n (Windows CRLF) 개행을 처리한다', () => {
    const line1 = '{"type":"user"}'
    const line2 = '{"type":"assistant"}'
    const chunk = Buffer.from(`${line1}\r\n${line2}\r\n`, 'utf8')
    const result = parseChunk(chunk, '')

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]).toBe(line1)
    expect(result.lines[1]).toBe(line2)
    expect(result.partialLine).toBe('')
  })

  it('\\r (old Mac CR) 개행을 처리한다', () => {
    const line = '{"type":"system"}'
    const chunk = Buffer.from(`${line}\r`, 'utf8')
    const result = parseChunk(chunk, '')

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toBe(line)
    expect(result.partialLine).toBe('')
  })

  it('혼합 개행 스타일을 올바르게 처리한다', () => {
    const line1 = '{"type":"user"}'
    const line2 = '{"type":"assistant"}'
    const line3 = '{"type":"system"}'
    const chunk = Buffer.from(`${line1}\n${line2}\r\n${line3}\r`, 'utf8')
    const result = parseChunk(chunk, '')

    expect(result.lines).toHaveLength(3)
    expect(result.lines[0]).toBe(line1)
    expect(result.lines[1]).toBe(line2)
    expect(result.lines[2]).toBe(line3)
  })

  // ──────────────────────────────────────────────────
  // partialLine 누적 시나리오
  // ──────────────────────────────────────────────────

  it('partialLine이 있을 때 새 청크와 올바르게 합산된다', () => {
    const partialLine = '{"type":"user","uuid":"a'
    const rest = 'bc"}\n'
    const chunk = Buffer.from(rest, 'utf8')
    const result = parseChunk(chunk, partialLine)

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toBe('{"type":"user","uuid":"abc"}')
    expect(result.partialLine).toBe('')
  })

  it('이전 partialLine + 새 청크로 여러 완성 라인이 만들어진다', () => {
    const partialLine = '{"type":"user"}'  // 개행 없이 끝난 상태
    const chunk = Buffer.from('\n{"type":"assistant"}\n{"type":"system"}\n', 'utf8')
    const result = parseChunk(chunk, partialLine)

    expect(result.lines).toHaveLength(3)
    expect(result.lines[0]).toBe('{"type":"user"}')
    expect(result.lines[1]).toBe('{"type":"assistant"}')
    expect(result.lines[2]).toBe('{"type":"system"}')
    expect(result.partialLine).toBe('')
  })

  // ──────────────────────────────────────────────────
  // 실제 Claude Code JSONL 형식 유사 케이스
  // ──────────────────────────────────────────────────

  it('실제 JSONL 형식과 유사한 대용량 단일 라인을 처리한다', () => {
    const record = JSON.stringify({
      type: 'assistant',
      uuid: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      parentUuid: 'yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy',
      timestamp: '2024-01-01T00:00:00.000Z',
      sessionId: 'session-001',
      cwd: '/home/user/project',
      isSidechain: false,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello, world!' }],
      },
    })

    const chunk = Buffer.from(record + '\n', 'utf8')
    const result = parseChunk(chunk, '')

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toBe(record)
    expect(result.partialLine).toBe('')
  })

  it('fsync 전 부분 쓰기 — 개행 없이 끝나는 레코드를 partialLine으로 보류한다', () => {
    // 파일 쓰기 중 개행이 아직 없는 상태를 시뮬레이션
    const incomplete = '{"type":"user","uuid":"abc","message":{"role":"user","content":'
    const chunk = Buffer.from(incomplete, 'utf8')
    const result = parseChunk(chunk, '')

    expect(result.lines).toHaveLength(0)
    expect(result.partialLine).toBe(incomplete)

    // 이후 파일 쓰기 완료로 나머지 도착
    const rest = '"hello"}}\n'
    const result2 = parseChunk(Buffer.from(rest, 'utf8'), result.partialLine)
    expect(result2.lines).toHaveLength(1)
    expect(JSON.parse(result2.lines[0]!)).toMatchObject({ type: 'user', uuid: 'abc' })
    expect(result2.partialLine).toBe('')
  })
})
