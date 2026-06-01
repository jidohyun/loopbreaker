/**
 * tests/session-state-create.test.ts
 *
 * createSessionState 팩토리 함수 단위 테스트 — Sub-AC 2a
 *
 * 검증 항목:
 *   - (sessionId, agentScope) 복합 키를 받아 새 SessionState 인스턴스 생성
 *   - 반환된 인스턴스의 올바른 초기 상태:
 *       - sessionId / agentScope 필드 일치
 *       - history 빈 배열
 *       - historySize 설정값 일치
 *       - argKeyCounts 빈 Map
 *       - fullKeyCounts 빈 Map
 *       - fileEditStates 빈 Map
 *   - 서로 다른 호출은 독립적인 인스턴스를 반환 (참조 분리)
 *   - historySize 경계값 (1, 기본 30, 큰 값)
 *   - root / 서브에이전트 agentScope 모두 허용
 */

import { createSessionState } from '../src/detect/session-state.js'

// ─── 기본 초기 상태 ───────────────────────────────────────────

describe('createSessionState — 기본 초기 상태', () => {
  test('sessionId가 반환된 인스턴스에 저장됨', () => {
    const state = createSessionState('sess-001', 'root', 30)
    expect(state.sessionId).toBe('sess-001')
  })

  test('agentScope가 반환된 인스턴스에 저장됨', () => {
    const state = createSessionState('sess-001', 'root', 30)
    expect(state.agentScope).toBe('root')
  })

  test('historySize가 인자 값으로 설정됨', () => {
    const state = createSessionState('sess-001', 'root', 30)
    expect(state.historySize).toBe(30)
  })

  test('history는 빈 배열', () => {
    const state = createSessionState('sess-001', 'root', 30)
    expect(state.history).toEqual([])
    expect(state.history).toHaveLength(0)
  })

  test('argKeyCounts는 빈 Map', () => {
    const state = createSessionState('sess-001', 'root', 30)
    expect(state.argKeyCounts).toBeInstanceOf(Map)
    expect(state.argKeyCounts.size).toBe(0)
  })

  test('fullKeyCounts는 빈 Map', () => {
    const state = createSessionState('sess-001', 'root', 30)
    expect(state.fullKeyCounts).toBeInstanceOf(Map)
    expect(state.fullKeyCounts.size).toBe(0)
  })

  test('fileEditStates는 빈 Map', () => {
    const state = createSessionState('sess-001', 'root', 30)
    expect(state.fileEditStates).toBeInstanceOf(Map)
    expect(state.fileEditStates.size).toBe(0)
  })
})

// ─── (sessionId, agentScope) 복합 키 ──────────────────────────

describe('createSessionState — (sessionId, agentScope) 복합 키', () => {
  test('root agentScope 허용', () => {
    const state = createSessionState('sess-abc', 'root', 10)
    expect(state.sessionId).toBe('sess-abc')
    expect(state.agentScope).toBe('root')
  })

  test('서브에이전트 경로 agentScope 허용', () => {
    const scope = 'subagent-42'
    const state = createSessionState('sess-xyz', scope, 10)
    expect(state.agentScope).toBe(scope)
  })

  test('임의 문자열 agentScope 허용', () => {
    const scope = '/path/to/subagent'
    const state = createSessionState('sess-xyz', scope, 20)
    expect(state.agentScope).toBe(scope)
  })

  test('sessionId와 agentScope가 혼동되지 않음', () => {
    const state = createSessionState('my-session', 'my-scope', 5)
    expect(state.sessionId).toBe('my-session')
    expect(state.agentScope).toBe('my-scope')
    expect(state.sessionId).not.toBe(state.agentScope)
  })
})

// ─── historySize 경계값 ───────────────────────────────────────

describe('createSessionState — historySize 경계값', () => {
  test('historySize=1: 최솟값 허용', () => {
    const state = createSessionState('sess-min', 'root', 1)
    expect(state.historySize).toBe(1)
    expect(state.history).toHaveLength(0)
  })

  test('historySize=30: 기본값', () => {
    const state = createSessionState('sess-default', 'root', 30)
    expect(state.historySize).toBe(30)
  })

  test('historySize=100: 큰 값', () => {
    const state = createSessionState('sess-large', 'root', 100)
    expect(state.historySize).toBe(100)
  })

  test('historySize=5: 커스텀 값', () => {
    const state = createSessionState('sess-custom', 'root', 5)
    expect(state.historySize).toBe(5)
  })
})

// ─── 인스턴스 독립성 ──────────────────────────────────────────

describe('createSessionState — 인스턴스 독립성', () => {
  test('서로 다른 호출은 별개의 객체를 반환', () => {
    const s1 = createSessionState('sess-A', 'root', 30)
    const s2 = createSessionState('sess-B', 'root', 30)
    expect(s1).not.toBe(s2)
  })

  test('history 배열이 인스턴스마다 독립적', () => {
    const s1 = createSessionState('sess-A', 'root', 30)
    const s2 = createSessionState('sess-B', 'root', 30)
    expect(s1.history).not.toBe(s2.history)
  })

  test('argKeyCounts Map이 인스턴스마다 독립적', () => {
    const s1 = createSessionState('sess-A', 'root', 30)
    const s2 = createSessionState('sess-B', 'root', 30)
    expect(s1.argKeyCounts).not.toBe(s2.argKeyCounts)
  })

  test('fullKeyCounts Map이 인스턴스마다 독립적', () => {
    const s1 = createSessionState('sess-A', 'root', 30)
    const s2 = createSessionState('sess-B', 'root', 30)
    expect(s1.fullKeyCounts).not.toBe(s2.fullKeyCounts)
  })

  test('fileEditStates Map이 인스턴스마다 독립적', () => {
    const s1 = createSessionState('sess-A', 'root', 30)
    const s2 = createSessionState('sess-B', 'root', 30)
    expect(s1.fileEditStates).not.toBe(s2.fileEditStates)
  })

  test('동일한 (sessionId, agentScope)로 호출해도 독립적인 인스턴스', () => {
    const s1 = createSessionState('same-session', 'root', 30)
    const s2 = createSessionState('same-session', 'root', 30)
    expect(s1).not.toBe(s2)
    expect(s1.history).not.toBe(s2.history)
  })
})

// ─── 구조적 무결성 ────────────────────────────────────────────

describe('createSessionState — 구조적 무결성', () => {
  test('반환 객체에 SessionState 인터페이스 필드 모두 존재', () => {
    const state = createSessionState('sess-001', 'root', 30)
    expect(state).toHaveProperty('sessionId')
    expect(state).toHaveProperty('agentScope')
    expect(state).toHaveProperty('history')
    expect(state).toHaveProperty('historySize')
    expect(state).toHaveProperty('argKeyCounts')
    expect(state).toHaveProperty('fullKeyCounts')
    expect(state).toHaveProperty('fileEditStates')
  })

  test('초기 상태에서 argKeyCounts에 아무 키도 없음', () => {
    const state = createSessionState('sess-001', 'root', 30)
    expect([...state.argKeyCounts.keys()]).toHaveLength(0)
  })

  test('초기 상태에서 fullKeyCounts에 아무 키도 없음', () => {
    const state = createSessionState('sess-001', 'root', 30)
    expect([...state.fullKeyCounts.keys()]).toHaveLength(0)
  })

  test('초기 상태에서 fileEditStates에 아무 키도 없음', () => {
    const state = createSessionState('sess-001', 'root', 30)
    expect([...state.fileEditStates.keys()]).toHaveLength(0)
  })
})
