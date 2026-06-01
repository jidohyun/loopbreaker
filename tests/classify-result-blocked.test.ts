/**
 * tests/classify-result-blocked.test.ts
 *
 * Sub-AC 2a: classifyResult returns 'blocked' for events where toolUseResult
 * indicates a blocked tool use, verified by unit tests covering blocked signal
 * detection independently of is_error.
 *
 * SPEC §4 §1a + BLOCKER 우선순위:
 *   blocked(hook deny) > rejected(perm 거부) > error > empty > ok > unknown
 *
 * is_error는 선택적 키(53.7%만 존재) → 단일 신호 금지.
 * blocked 신호는 <tool_use_error> 래퍼 텍스트 채널로도 독립 감지해야 함.
 *
 * 검증 범위:
 *   1. blocked — is_error 없이 <tool_use_error>+"Blocked" 텍스트만으로 감지
 *   2. blocked — is_error=true+"Blocked" 텍스트 조합으로 감지
 *   3. blocked — is_error=false여도 <tool_use_error>+"Blocked" 텍스트로 감지
 *   4. blocked — string content (배열 아님)으로도 감지
 *   5. blocked — blocked 우선순위 > rejected > error 검증
 *   6. blocked — "Blocked" 단어 없으면 blocked 미반환 (오탐 방지)
 *   7. rejected — is_error 없이 <tool_use_error>+"rejected" 텍스트만으로 감지
 *   8. error — is_error=true만 있고 Blocked/rejected 없으면 error
 *   9. error — <tool_use_error> 래퍼만 있고 Blocked/rejected 없으면 error
 *  10. error — toolUseResult.isApiErrorMessage=true → error (신호3 사이드카)
 *  11. empty — is_error 없음 + 빈 content
 *  12. ok — is_error 없음 + 내용 있음
 *  13. unknown — block 파싱 실패
 */

import { classifyResult } from '../src/ingest/parser.js'

// ──────────────────────────────────────────────────────────────
// 헬퍼: tool_result 블록 생성
// ──────────────────────────────────────────────────────────────

function makeToolResultBlock(opts: {
  content?: string | Array<{ type: string; text?: string }>
  is_error?: boolean
  tool_use_id?: string
}) {
  return {
    type: 'tool_result' as const,
    tool_use_id: opts.tool_use_id ?? 'tool-use-id-001',
    content: opts.content,
    ...(opts.is_error !== undefined ? { is_error: opts.is_error } : {}),
  }
}

function makeToolUseErrorContent(message: string): string {
  return `<tool_use_error>${message}</tool_use_error>`
}

// ──────────────────────────────────────────────────────────────
// §1: blocked — is_error 없이 텍스트 채널만으로 감지
// ──────────────────────────────────────────────────────────────

describe('classifyResult: blocked — is_error 독립 감지 (Sub-AC 2a)', () => {
  it('① is_error 키 없음 + <tool_use_error>+Blocked → blocked', () => {
    // is_error 필드가 아예 없는 tool_result 블록
    const block = makeToolResultBlock({
      content: makeToolUseErrorContent('Blocked by hook settings'),
      // is_error: 없음 (undefined)
    })
    expect(classifyResult(block)).toBe('blocked')
  })

  it('② is_error=undefined 명시적 확인 — blocked 독립 감지', () => {
    // is_error가 undefined인 상태에서 텍스트 채널만 신호
    const block = {
      type: 'tool_result',
      tool_use_id: 'tu-001',
      content: '<tool_use_error>Blocked by PreToolUse hook deny</tool_use_error>',
      // is_error 키 자체가 없음
    }
    expect(classifyResult(block)).toBe('blocked')
  })

  it('③ is_error=false + <tool_use_error>+Blocked → blocked (is_error=false도 텍스트 우선)', () => {
    // is_error=false이지만 래퍼+Blocked 텍스트가 있으면 blocked
    const block = makeToolResultBlock({
      content: makeToolUseErrorContent('Blocked - hook denied this tool call'),
      is_error: false,
    })
    expect(classifyResult(block)).toBe('blocked')
  })

  it('④ is_error=true + Blocked 텍스트 → blocked (우선순위 blocked > error)', () => {
    // is_error=true이어도 Blocked 텍스트가 있으면 blocked가 error보다 우선
    const block = makeToolResultBlock({
      content: makeToolUseErrorContent('Blocked by settings hook'),
      is_error: true,
    })
    expect(classifyResult(block)).toBe('blocked')
  })

  it('⑤ content가 배열 형식 (text block) + <tool_use_error>+Blocked → blocked', () => {
    // content가 문자열이 아닌 배열 [{type:"text", text:"..."}] 형식일 때
    const block = makeToolResultBlock({
      content: [
        {
          type: 'text',
          text: makeToolUseErrorContent('Blocked by PreToolUse deny hook'),
        },
      ],
      // is_error 없음
    })
    expect(classifyResult(block)).toBe('blocked')
  })

  it('⑥ string content (배열 아님) + <tool_use_error>+Blocked → blocked', () => {
    // content가 문자열 직접 전달
    const block = makeToolResultBlock({
      content: '<tool_use_error>Blocked: hook rejected the operation</tool_use_error>',
    })
    expect(classifyResult(block)).toBe('blocked')
  })

  it('⑦ "Blocked" 대소문자 정확히 일치 (대문자 B) → blocked', () => {
    const block = makeToolResultBlock({
      content: makeToolUseErrorContent('This action was Blocked by the hook'),
    })
    expect(classifyResult(block)).toBe('blocked')
  })

  it('⑧ "blocked" 소문자만 있는 경우 — Blocked 대문자 없으면 blocked 미반환', () => {
    // /\bBlocked\b/ 정규식이므로 소문자 blocked는 매칭 안 됨 → error로 분류
    const block = makeToolResultBlock({
      content: makeToolUseErrorContent('this action was blocked (lowercase)'),
    })
    // <tool_use_error> 래퍼는 있지만 대문자 Blocked 없음 → error
    expect(classifyResult(block)).toBe('error')
  })
})

// ──────────────────────────────────────────────────────────────
// §2: blocked 우선순위 검증
// ──────────────────────────────────────────────────────────────

describe('classifyResult: blocked 우선순위 (blocked > rejected > error)', () => {
  it('blocked 텍스트 + rejected 텍스트 동시 → blocked 우선', () => {
    // 두 키워드가 동시에 있어도 blocked가 우선
    const block = makeToolResultBlock({
      content: makeToolUseErrorContent('Blocked: permission rejected by hook'),
    })
    expect(classifyResult(block)).toBe('blocked')
  })

  it('rejected 텍스트만 있고 Blocked 없음 → rejected', () => {
    const block = makeToolResultBlock({
      content: makeToolUseErrorContent('Permission rejected by user settings'),
    })
    expect(classifyResult(block)).toBe('rejected')
  })

  it('blocked 텍스트 + is_error=true → blocked (error보다 우선)', () => {
    const block = makeToolResultBlock({
      content: makeToolUseErrorContent('Blocked by system hook deny'),
      is_error: true,
    })
    // is_error=true여도 Blocked가 있으면 blocked 우선
    expect(classifyResult(block)).toBe('blocked')
  })

  it('toolUseResult.isApiErrorMessage=true + Blocked 텍스트 → blocked 우선 (신호3 < 신호2)', () => {
    // toolUseResult 사이드카의 isApiErrorMessage는 error를 의미하지만
    // 텍스트 채널의 Blocked가 우선
    const block = makeToolResultBlock({
      content: makeToolUseErrorContent('Blocked by hook, please check settings'),
    })
    const toolUseResult = { isApiErrorMessage: true }
    expect(classifyResult(block, toolUseResult)).toBe('blocked')
  })
})

// ──────────────────────────────────────────────────────────────
// §3: 오탐 방지 — Blocked 없으면 blocked 미반환
// ──────────────────────────────────────────────────────────────

describe('classifyResult: 오탐 방지 — blocked 미반환 케이스', () => {
  it('<tool_use_error> 래퍼 있지만 Blocked 없음 → error (not blocked)', () => {
    const block = makeToolResultBlock({
      content: makeToolUseErrorContent('File not found'),
    })
    expect(classifyResult(block)).toBe('error')
  })

  it('is_error=true + Blocked 없음 → error (not blocked)', () => {
    const block = makeToolResultBlock({
      content: 'Something went wrong with the operation',
      is_error: true,
    })
    expect(classifyResult(block)).toBe('error')
  })

  it('정상 성공 응답 (Blocked 텍스트 포함이어도 래퍼 없음) → ok (not blocked)', () => {
    // "blocked" 키워드가 본문에 있어도 <tool_use_error> 래퍼 없으면 blocked 아님
    // 예: 검색 결과에 "Blocked" 단어가 나오는 경우
    const block = makeToolResultBlock({
      content: 'Found 3 results: item1, Blocked queue, item3',
      // is_error 없음
    })
    // <tool_use_error> 래퍼 없으므로 blocked로 분류 안 됨 → ok
    expect(classifyResult(block)).toBe('ok')
  })
})

// ──────────────────────────────────────────────────────────────
// §4: 나머지 ResultClass 분류 검증 (회귀 방지)
// ──────────────────────────────────────────────────────────────

describe('classifyResult: 전체 우선순위 체인 회귀 테스트', () => {
  it('rejected — is_error 없이 <tool_use_error>+rejected → rejected', () => {
    const block = makeToolResultBlock({
      content: makeToolUseErrorContent('Permission rejected: not allowed to read this file'),
    })
    expect(classifyResult(block)).toBe('rejected')
  })

  it('rejected — is_error=true + rejected 텍스트 → rejected', () => {
    const block = makeToolResultBlock({
      content: makeToolUseErrorContent('User rejected the permission request'),
      is_error: true,
    })
    expect(classifyResult(block)).toBe('rejected')
  })

  it('error — is_error=true + 일반 오류 텍스트 → error', () => {
    const block = makeToolResultBlock({
      content: 'File write failed: disk full',
      is_error: true,
    })
    expect(classifyResult(block)).toBe('error')
  })

  it('error — <tool_use_error> 래퍼만 (Blocked/rejected 없음) → error', () => {
    const block = makeToolResultBlock({
      content: makeToolUseErrorContent('Timeout exceeded while waiting for response'),
    })
    expect(classifyResult(block)).toBe('error')
  })

  it('error — toolUseResult.isApiErrorMessage=true (신호3 사이드카) → error', () => {
    const block = makeToolResultBlock({
      content: 'API call response',
    })
    const toolUseResult = { isApiErrorMessage: true }
    expect(classifyResult(block, toolUseResult)).toBe('error')
  })

  it('empty — is_error 없음 + 빈 content 문자열 → empty', () => {
    const block = makeToolResultBlock({
      content: '',
    })
    expect(classifyResult(block)).toBe('empty')
  })

  it('empty — is_error 없음 + "0 results" 패턴 → empty', () => {
    const block = makeToolResultBlock({
      content: 'Found 0 results in the database',
    })
    expect(classifyResult(block)).toBe('empty')
  })

  it('empty — is_error 없음 + "0 matches" 패턴 → empty', () => {
    const block = makeToolResultBlock({
      content: '0 matches found',
    })
    expect(classifyResult(block)).toBe('empty')
  })

  it('ok — is_error 없음 + 내용 있음 → ok', () => {
    const block = makeToolResultBlock({
      content: 'Successfully wrote 42 bytes to file',
    })
    expect(classifyResult(block)).toBe('ok')
  })

  it('ok — content가 배열 형식 + 텍스트 있음 → ok', () => {
    const block = makeToolResultBlock({
      content: [{ type: 'text', text: 'Operation completed successfully' }],
    })
    expect(classifyResult(block)).toBe('ok')
  })

  it('unknown — block 파싱 실패 (null 입력) → unknown', () => {
    expect(classifyResult(null)).toBe('unknown')
  })

  it('unknown — block 파싱 실패 (string 입력) → unknown', () => {
    expect(classifyResult('not-a-block')).toBe('unknown')
  })

  it('unknown — type이 tool_result가 아닌 객체 → unknown', () => {
    expect(classifyResult({ type: 'tool_use', name: 'read' })).toBe('unknown')
  })
})

// ──────────────────────────────────────────────────────────────
// §5: 실제 Claude Code 훅 거부 패턴 시뮬레이션
// ──────────────────────────────────────────────────────────────

describe('classifyResult: 실제 Claude Code 훅 거부 시나리오', () => {
  it('PreToolUse hook deny — is_error 없이 Blocked 반환', () => {
    // Claude Code가 PreToolUse hook에서 거부할 때 생성하는 구조 시뮬레이션
    // is_error 키가 없는 경우 (실측 53.7%만 보유)
    const toolResultBlock = {
      type: 'tool_result',
      tool_use_id: 'toolu_abc123',
      content: '<tool_use_error>Blocked by hook: git push is not allowed in this project</tool_use_error>',
      // is_error 키 없음 — 단일 신호 금지, 텍스트 채널이 주 신호
    }
    expect(classifyResult(toolResultBlock)).toBe('blocked')
  })

  it('PreToolUse hook deny — is_error=true + Blocked 반환', () => {
    // is_error=true가 있는 경우에도 Blocked 우선
    const toolResultBlock = {
      type: 'tool_result',
      tool_use_id: 'toolu_def456',
      is_error: true,
      content: '<tool_use_error>Blocked by settings: dangerous command pattern detected</tool_use_error>',
    }
    expect(classifyResult(toolResultBlock)).toBe('blocked')
  })

  it('permission rejected by user — is_error 없이 rejected 반환', () => {
    // 사용자가 permission을 거부했을 때 (is_error 없음)
    const toolResultBlock = {
      type: 'tool_result',
      tool_use_id: 'toolu_ghi789',
      content: '<tool_use_error>User rejected the permission: allow bash command execution?</tool_use_error>',
      // is_error 없음
    }
    expect(classifyResult(toolResultBlock)).toBe('rejected')
  })
})
