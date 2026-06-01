/**
 * tests/session-registry-sub-ac-2b.test.ts
 *
 * Sub-AC 2b: SessionState 레지스트리 조회 함수 구현 및 단위 테스트
 *
 * 검증 항목:
 *   - 같은 (sessionId, agentScope) 키로 두 번 조회하면 동일 인스턴스 반환 (멱등성)
 *   - 키가 없으면 자동 생성 (get-or-create)
 *   - 서로 다른 키는 독립적인 인스턴스를 반환
 *   - lookupSession: 존재/부재 조회
 *   - deleteSession: 삭제 후 재생성
 *   - 레지스트리 간 격리
 */

import {
  createSessionRegistry,
  getOrCreateSession,
  lookupSession,
  deleteSession,
} from '../src/detect/session-state.js'

// ─── get-or-create: 기본 동작 ─────────────────────────────────

describe('getOrCreateSession — get-or-create 기본 동작', () => {
  test('키가 없으면 새 SessionState를 생성하여 반환', () => {
    const registry = createSessionRegistry()
    const state = getOrCreateSession(registry, 'sess-001', 'root', 30)
    expect(state).toBeDefined()
    expect(state.sessionId).toBe('sess-001')
    expect(state.agentScope).toBe('root')
    expect(state.historySize).toBe(30)
  })

  test('생성된 SessionState는 올바른 초기 상태', () => {
    const registry = createSessionRegistry()
    const state = getOrCreateSession(registry, 'sess-001', 'root', 30)
    expect(state.history).toEqual([])
    expect(state.argKeyCounts.size).toBe(0)
    expect(state.fullKeyCounts.size).toBe(0)
    expect(state.fileEditStates.size).toBe(0)
  })
})

// ─── 멱등성: 동일 키 → 동일 인스턴스 ─────────────────────────

describe('getOrCreateSession — 멱등성(idempotency)', () => {
  test('같은 (sessionId, agentScope)로 두 번 호출하면 동일 인스턴스 반환', () => {
    const registry = createSessionRegistry()
    const first = getOrCreateSession(registry, 'sess-A', 'root', 30)
    const second = getOrCreateSession(registry, 'sess-A', 'root', 30)
    expect(first).toBe(second)
  })

  test('세 번 호출해도 동일 인스턴스 반환', () => {
    const registry = createSessionRegistry()
    const first = getOrCreateSession(registry, 'sess-B', 'root', 30)
    const second = getOrCreateSession(registry, 'sess-B', 'root', 30)
    const third = getOrCreateSession(registry, 'sess-B', 'root', 30)
    expect(first).toBe(second)
    expect(second).toBe(third)
  })

  test('historySize가 달라도 최초 생성 인스턴스를 반환 (historySize 무시)', () => {
    const registry = createSessionRegistry()
    const first = getOrCreateSession(registry, 'sess-C', 'root', 30)
    const second = getOrCreateSession(registry, 'sess-C', 'root', 99) // 다른 historySize
    expect(first).toBe(second)
    expect(second.historySize).toBe(30) // 최초 값 유지
  })

  test('멱등 호출 후 상태 변경이 공유됨 (같은 인스턴스이므로)', () => {
    const registry = createSessionRegistry()
    const first = getOrCreateSession(registry, 'sess-D', 'sub-1', 10)
    // 임의 변이: argKeyCounts에 직접 쓰기 (내부 뮤터블 허용 설계)
    ;(first.argKeyCounts as Map<string, unknown>).set('key-x', { n: 1, firstTs: 0, lastTs: 0, uuids: ['u1'] })
    const second = getOrCreateSession(registry, 'sess-D', 'sub-1', 10)
    expect(second.argKeyCounts.has('key-x')).toBe(true)
  })
})

// ─── 키 분리: 서로 다른 키 → 독립 인스턴스 ───────────────────

describe('getOrCreateSession — 서로 다른 키 분리', () => {
  test('다른 sessionId → 독립 인스턴스', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-1', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-2', 'root', 30)
    expect(s1).not.toBe(s2)
  })

  test('같은 sessionId, 다른 agentScope → 독립 인스턴스', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-X', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-X', 'subagent-1', 30)
    expect(s1).not.toBe(s2)
  })

  test('다른 sessionId, 다른 agentScope → 독립 인스턴스', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-P', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-Q', 'subagent-1', 30)
    expect(s1).not.toBe(s2)
    expect(s1.sessionId).toBe('sess-P')
    expect(s2.sessionId).toBe('sess-Q')
  })

  test('sessionId="A\0B", agentScope="" 와 sessionId="A", agentScope="B" 는 충돌하지 않음', () => {
    // NUL 구분자를 사용하므로 "A\0B"+"" vs "A"+"\0B" 가 다른 키가 됨
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'A\0B', '', 30)
    const s2 = getOrCreateSession(registry, 'A', 'B', 30)
    // 내부 키: "A\0B\0" vs "A\0B" — 구분자 위치 달라서 다른 키
    expect(s1).not.toBe(s2)
  })
})

// ─── lookupSession ────────────────────────────────────────────

describe('lookupSession', () => {
  test('등록된 키를 조회하면 SessionState 반환', () => {
    const registry = createSessionRegistry()
    const created = getOrCreateSession(registry, 'sess-L1', 'root', 30)
    const found = lookupSession(registry, 'sess-L1', 'root')
    expect(found).toBe(created)
  })

  test('존재하지 않는 키 조회 시 undefined 반환', () => {
    const registry = createSessionRegistry()
    const found = lookupSession(registry, 'nonexistent', 'root')
    expect(found).toBeUndefined()
  })

  test('키의 한 쪽만 일치해도 undefined (sessionId만 같음)', () => {
    const registry = createSessionRegistry()
    getOrCreateSession(registry, 'sess-M', 'root', 30)
    expect(lookupSession(registry, 'sess-M', 'other-scope')).toBeUndefined()
  })

  test('키의 한 쪽만 일치해도 undefined (agentScope만 같음)', () => {
    const registry = createSessionRegistry()
    getOrCreateSession(registry, 'sess-N', 'root', 30)
    expect(lookupSession(registry, 'other-session', 'root')).toBeUndefined()
  })

  test('lookupSession은 인스턴스를 생성하지 않음 (사이드이펙트 없음)', () => {
    const registry = createSessionRegistry()
    lookupSession(registry, 'never-created', 'root')
    expect(registry.size).toBe(0)
  })
})

// ─── deleteSession ────────────────────────────────────────────

describe('deleteSession', () => {
  test('존재하는 키 삭제 시 true 반환', () => {
    const registry = createSessionRegistry()
    getOrCreateSession(registry, 'sess-DEL', 'root', 30)
    const result = deleteSession(registry, 'sess-DEL', 'root')
    expect(result).toBe(true)
  })

  test('삭제 후 lookupSession은 undefined 반환', () => {
    const registry = createSessionRegistry()
    getOrCreateSession(registry, 'sess-DEL2', 'root', 30)
    deleteSession(registry, 'sess-DEL2', 'root')
    expect(lookupSession(registry, 'sess-DEL2', 'root')).toBeUndefined()
  })

  test('삭제 후 getOrCreateSession으로 새 인스턴스 생성 가능', () => {
    const registry = createSessionRegistry()
    const original = getOrCreateSession(registry, 'sess-DEL3', 'root', 30)
    deleteSession(registry, 'sess-DEL3', 'root')
    const recreated = getOrCreateSession(registry, 'sess-DEL3', 'root', 30)
    expect(recreated).not.toBe(original) // 새 인스턴스
    expect(recreated.sessionId).toBe('sess-DEL3')
  })

  test('존재하지 않는 키 삭제 시 false 반환', () => {
    const registry = createSessionRegistry()
    const result = deleteSession(registry, 'nonexistent', 'root')
    expect(result).toBe(false)
  })
})

// ─── 레지스트리 격리 ──────────────────────────────────────────

describe('createSessionRegistry — 레지스트리 격리', () => {
  test('서로 다른 레지스트리 인스턴스는 독립적', () => {
    const reg1 = createSessionRegistry()
    const reg2 = createSessionRegistry()
    const s1 = getOrCreateSession(reg1, 'sess-ISO', 'root', 30)
    expect(lookupSession(reg2, 'sess-ISO', 'root')).toBeUndefined()
    expect(s1).toBeDefined()
  })

  test('reg1에 등록된 세션이 reg2에서 조회되지 않음', () => {
    const reg1 = createSessionRegistry()
    const reg2 = createSessionRegistry()
    getOrCreateSession(reg1, 'shared-key', 'scope', 30)
    const fromReg2 = lookupSession(reg2, 'shared-key', 'scope')
    expect(fromReg2).toBeUndefined()
  })

  test('빈 레지스트리 초기 크기는 0', () => {
    const registry = createSessionRegistry()
    expect(registry.size).toBe(0)
  })

  test('getOrCreateSession 호출 후 레지스트리 크기 증가', () => {
    const registry = createSessionRegistry()
    getOrCreateSession(registry, 'sess-1', 'root', 30)
    expect(registry.size).toBe(1)
    getOrCreateSession(registry, 'sess-2', 'root', 30)
    expect(registry.size).toBe(2)
    // 동일 키 재호출 — 크기 변하지 않음
    getOrCreateSession(registry, 'sess-1', 'root', 30)
    expect(registry.size).toBe(2)
  })
})
