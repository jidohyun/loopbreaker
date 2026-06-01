/**
 * tests/scope-isolation-sub-ac-2c.test.ts
 *
 * Sub-AC 2c: 스코프 격리 검증 테스트
 *
 * 동일 sessionId에 서로 다른 agentScope를 가진 두 SessionState 인스턴스가
 * 독립적으로 존재하며 한쪽 상태 변경이 다른 쪽에 영향을 주지 않음을 검증한다.
 *
 * 검증 항목:
 *   - 같은 sessionId + 다른 agentScope → 서로 다른 인스턴스 (참조 분리)
 *   - argKeyCounts 상태 변경 격리: 한쪽 pushTriple이 다른 쪽 카운트에 영향 없음
 *   - fullKeyCounts 상태 변경 격리: error 결과 누적이 다른 scope에 전파되지 않음
 *   - history 격리: 한쪽 history가 다른 scope의 history를 공유하지 않음
 *   - fileEditStates 격리: 동일 파일 편집 카운트가 scope 간 누수 없음
 *   - historySize 슬라이딩 윈도 격리: eviction이 다른 scope에 영향 없음
 *   - 3개 이상 scope 독립성
 *   - getRepeatN / getErrLoopN 격리 검증
 */

import {
  createSessionRegistry,
  getOrCreateSession,
  pushTriple,
  getRepeatN,
  getErrLoopN,
  getWindowUuids,
} from '../src/detect/session-state.js'
import type { ActionTriple } from '../src/contracts.js'

// ─── 헬퍼 ─────────────────────────────────────────────────────

let _seq = 0

function makeTriple(
  tool: string,
  argKey: string,
  resultClass: ActionTriple['resultClass'] = 'ok',
): ActionTriple {
  _seq++
  return {
    tool,
    argKey,
    resultClass,
    ref: { uuid: `uuid-${_seq}`, ts: 1000 + _seq },
  }
}

beforeEach(() => {
  _seq = 0
})

// ─── 기본 참조 분리 ───────────────────────────────────────────

describe('스코프 격리 — 기본 참조 분리', () => {
  test('동일 sessionId + 다른 agentScope → 서로 다른 인스턴스', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-X', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-X', 'subagent-1', 30)
    expect(s1).not.toBe(s2)
  })

  test('s1.sessionId === s2.sessionId (같은 세션)', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-X', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-X', 'subagent-1', 30)
    expect(s1.sessionId).toBe(s2.sessionId)
    expect(s1.sessionId).toBe('sess-X')
  })

  test('s1.agentScope !== s2.agentScope (다른 스코프)', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-X', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-X', 'subagent-1', 30)
    expect(s1.agentScope).not.toBe(s2.agentScope)
  })

  test('history 배열이 참조 수준에서 분리됨', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-X', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-X', 'subagent-1', 30)
    expect(s1.history).not.toBe(s2.history)
  })

  test('argKeyCounts Map이 참조 수준에서 분리됨', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-X', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-X', 'subagent-1', 30)
    expect(s1.argKeyCounts).not.toBe(s2.argKeyCounts)
  })

  test('fullKeyCounts Map이 참조 수준에서 분리됨', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-X', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-X', 'subagent-1', 30)
    expect(s1.fullKeyCounts).not.toBe(s2.fullKeyCounts)
  })

  test('fileEditStates Map이 참조 수준에서 분리됨', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-X', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-X', 'subagent-1', 30)
    expect(s1.fileEditStates).not.toBe(s2.fileEditStates)
  })
})

// ─── pushTriple 격리 — argKeyCounts ──────────────────────────

describe('스코프 격리 — pushTriple → argKeyCounts 상태 변경 격리', () => {
  test('s1에 pushTriple 후 s1.argKeyCounts 증가, s2는 0 유지', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-Y', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-Y', 'subagent-1', 30)

    const triple = makeTriple('Edit', 'hash-abc')
    pushTriple(s1, triple)

    expect(getRepeatN(s1, 'hash-abc')).toBe(1)
    expect(getRepeatN(s2, 'hash-abc')).toBe(0)
  })

  test('s2에 pushTriple 후 s2.argKeyCounts 증가, s1은 0 유지', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-Y', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-Y', 'subagent-1', 30)

    const triple = makeTriple('Bash', 'hash-xyz')
    pushTriple(s2, triple)

    expect(getRepeatN(s2, 'hash-xyz')).toBe(1)
    expect(getRepeatN(s1, 'hash-xyz')).toBe(0)
  })

  test('s1에 반복 pushTriple 해도 s2 카운트 0 유지', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-Y', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-Y', 'subagent-1', 30)

    for (let i = 0; i < 5; i++) {
      pushTriple(s1, makeTriple('Read', 'key-repeated'))
    }

    expect(getRepeatN(s1, 'key-repeated')).toBe(5)
    expect(getRepeatN(s2, 'key-repeated')).toBe(0)
  })

  test('s1과 s2 각각 독립 카운트 누적', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-Y', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-Y', 'subagent-1', 30)

    pushTriple(s1, makeTriple('Edit', 'shared-key'))
    pushTriple(s1, makeTriple('Edit', 'shared-key'))
    pushTriple(s2, makeTriple('Edit', 'shared-key'))

    expect(getRepeatN(s1, 'shared-key')).toBe(2)
    expect(getRepeatN(s2, 'shared-key')).toBe(1)
  })
})

// ─── pushTriple 격리 — fullKeyCounts (에러 수렴) ─────────────

describe('스코프 격리 — pushTriple → fullKeyCounts (에러 수렴) 격리', () => {
  test('s1에 error 트리플 누적해도 s2의 errLoopN=0', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-Z', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-Z', 'subagent-2', 30)

    for (let i = 0; i < 3; i++) {
      pushTriple(s1, makeTriple('Bash', 'err-key', 'error'))
    }

    expect(getErrLoopN(s1, 'err-key')).toBe(3)
    expect(getErrLoopN(s2, 'err-key')).toBe(0)
  })

  test('s2에 error 트리플 누적해도 s1의 errLoopN=0', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-Z', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-Z', 'subagent-2', 30)

    for (let i = 0; i < 5; i++) {
      pushTriple(s2, makeTriple('Bash', 'err-key2', 'error'))
    }

    expect(getErrLoopN(s2, 'err-key2')).toBe(5)
    expect(getErrLoopN(s1, 'err-key2')).toBe(0)
  })

  test('s1 ok + s2 error — resultClass 혼재 격리', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-Z', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-Z', 'subagent-2', 30)

    pushTriple(s1, makeTriple('Bash', 'cmd-key', 'ok'))
    pushTriple(s2, makeTriple('Bash', 'cmd-key', 'error'))
    pushTriple(s2, makeTriple('Bash', 'cmd-key', 'error'))

    expect(getErrLoopN(s1, 'cmd-key')).toBe(0)
    expect(getErrLoopN(s2, 'cmd-key')).toBe(2)
    expect(getRepeatN(s1, 'cmd-key')).toBe(1)
    expect(getRepeatN(s2, 'cmd-key')).toBe(2)
  })
})

// ─── history 격리 ─────────────────────────────────────────────

describe('스코프 격리 — history 격리', () => {
  test('s1 pushTriple 후 s1.history.length=1, s2.history.length=0', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-H', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-H', 'sub-agent', 30)

    pushTriple(s1, makeTriple('Read', 'path-hash'))

    expect(s1.history).toHaveLength(1)
    expect(s2.history).toHaveLength(0)
  })

  test('s1.history 항목이 s2.history에 포함되지 않음', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-H', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-H', 'sub-agent', 30)

    const t1 = makeTriple('Edit', 'file-hash')
    const t2 = makeTriple('Bash', 'cmd-hash')
    pushTriple(s1, t1)
    pushTriple(s2, t2)

    expect(s1.history).toContain(t1)
    expect(s1.history).not.toContain(t2)
    expect(s2.history).toContain(t2)
    expect(s2.history).not.toContain(t1)
  })

  test('getWindowUuids 격리 — 한쪽 uuid가 다른 scope에 노출 안됨', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-H', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-H', 'sub-agent', 30)

    const t = makeTriple('Read', 'uuid-test-key')
    pushTriple(s1, t)

    const uuids1 = getWindowUuids(s1, 'uuid-test-key')
    const uuids2 = getWindowUuids(s2, 'uuid-test-key')

    expect(uuids1).toContain(t.ref.uuid)
    expect(uuids2).toHaveLength(0)
  })
})

// ─── historySize 슬라이딩 윈도 eviction 격리 ────────────────

describe('스코프 격리 — historySize 슬라이딩 윈도 eviction 격리', () => {
  test('s1이 윈도 초과해 eviction 발생해도 s2 카운트 불변', () => {
    const registry = createSessionRegistry()
    const WINDOW = 3
    const s1 = getOrCreateSession(registry, 'sess-EV', 'root', WINDOW)
    const s2 = getOrCreateSession(registry, 'sess-EV', 'subagent-ev', WINDOW)

    // s2에 먼저 2회 push
    pushTriple(s2, makeTriple('Bash', 'key-ev'))
    pushTriple(s2, makeTriple('Bash', 'key-ev'))

    // s1에 윈도+1 push (eviction 발생)
    for (let i = 0; i < WINDOW + 1; i++) {
      pushTriple(s1, makeTriple('Bash', 'key-ev'))
    }

    // s1 윈도에는 최근 WINDOW개 = key-ev 3번
    expect(getRepeatN(s1, 'key-ev')).toBe(WINDOW)
    // s2는 s1 eviction 영향 없이 2 유지
    expect(getRepeatN(s2, 'key-ev')).toBe(2)
  })

  test('s1 historySize=2, s2 historySize=10 — 윈도 크기 독립', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-EV2', 'root', 2)
    const s2 = getOrCreateSession(registry, 'sess-EV2', 'subagent', 10)

    // s1에 3번 push (historySize=2이므로 eviction)
    pushTriple(s1, makeTriple('Read', 'win-key'))
    pushTriple(s1, makeTriple('Read', 'win-key'))
    pushTriple(s1, makeTriple('Read', 'win-key'))

    // s2에 3번 push (historySize=10이므로 모두 유지)
    pushTriple(s2, makeTriple('Read', 'win-key'))
    pushTriple(s2, makeTriple('Read', 'win-key'))
    pushTriple(s2, makeTriple('Read', 'win-key'))

    // s1: 윈도=2 → eviction 후 2
    expect(getRepeatN(s1, 'win-key')).toBe(2)
    // s2: 윈도=10 → eviction 없이 3
    expect(getRepeatN(s2, 'win-key')).toBe(3)
  })
})

// ─── 3개 이상 scope 독립성 ─────────────────────────────────────

describe('스코프 격리 — 3개 이상 agentScope 독립성', () => {
  test('root, subagent-1, subagent-2 각각 독립 카운트', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-3', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-3', 'subagent-1', 30)
    const s3 = getOrCreateSession(registry, 'sess-3', 'subagent-2', 30)

    // 각 scope에 다른 횟수로 push
    pushTriple(s1, makeTriple('Edit', 'multi-key'))

    pushTriple(s2, makeTriple('Edit', 'multi-key'))
    pushTriple(s2, makeTriple('Edit', 'multi-key'))

    pushTriple(s3, makeTriple('Edit', 'multi-key'))
    pushTriple(s3, makeTriple('Edit', 'multi-key'))
    pushTriple(s3, makeTriple('Edit', 'multi-key'))

    expect(getRepeatN(s1, 'multi-key')).toBe(1)
    expect(getRepeatN(s2, 'multi-key')).toBe(2)
    expect(getRepeatN(s3, 'multi-key')).toBe(3)
  })

  test('한 scope에서 error 수렴해도 다른 scope들은 0 유지', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-3', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-3', 'subagent-1', 30)
    const s3 = getOrCreateSession(registry, 'sess-3', 'subagent-2', 30)

    for (let i = 0; i < 4; i++) {
      pushTriple(s2, makeTriple('Bash', 'err-multi', 'error'))
    }

    expect(getErrLoopN(s1, 'err-multi')).toBe(0)
    expect(getErrLoopN(s2, 'err-multi')).toBe(4)
    expect(getErrLoopN(s3, 'err-multi')).toBe(0)
  })

  test('서로 다른 3개 인스턴스가 모두 별개 참조', () => {
    const registry = createSessionRegistry()
    const s1 = getOrCreateSession(registry, 'sess-3', 'root', 30)
    const s2 = getOrCreateSession(registry, 'sess-3', 'subagent-1', 30)
    const s3 = getOrCreateSession(registry, 'sess-3', 'subagent-2', 30)

    expect(s1).not.toBe(s2)
    expect(s2).not.toBe(s3)
    expect(s1).not.toBe(s3)
  })
})

// ─── 상태 변경 후 재조회 격리 ─────────────────────────────────

describe('스코프 격리 — 상태 변경 후 레지스트리 재조회 격리', () => {
  test('s1 변경 후 registry 재조회로 얻은 s1도 변경 반영, s2는 불변', () => {
    const registry = createSessionRegistry()
    getOrCreateSession(registry, 'sess-R', 'root', 30)
    getOrCreateSession(registry, 'sess-R', 'sub', 30)

    // 재조회
    const s1Again = getOrCreateSession(registry, 'sess-R', 'root', 30)
    getOrCreateSession(registry, 'sess-R', 'sub', 30)

    pushTriple(s1Again, makeTriple('Read', 'recheck-key'))

    // 같은 인스턴스이므로 재조회해도 동일
    const s1Final = getOrCreateSession(registry, 'sess-R', 'root', 30)
    const s2Final = getOrCreateSession(registry, 'sess-R', 'sub', 30)

    expect(getRepeatN(s1Final, 'recheck-key')).toBe(1)
    expect(getRepeatN(s2Final, 'recheck-key')).toBe(0)
  })
})
