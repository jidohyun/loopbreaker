/**
 * tests/push-triple-count-map.test.ts
 *
 * pushTriple 카운트 맵 증가 로직 테스트 — Sub-AC 3
 *
 * 검증 항목:
 *   - ActionTriple을 pushTriple로 추가하면 argKeyCounts/fullKeyCounts가 1 증가
 *   - 동일 argKey triple을 반복 추가하면 카운트가 누적됨
 *   - 다른 argKey triple을 추가하면 각각 독립적으로 카운트
 *   - historySize 초과 시 evict된 triple의 카운트가 감소
 *   - fullKey(argKey#resultClass) 카운트 독립성 검증
 *   - uuids 배열에 추가된 triple ref.uuid가 누적됨
 *   - error resultClass를 가진 triple의 errLoopN 카운트
 */

import {
  createSessionState,
  pushTriple,
  getRepeatN,
  getErrLoopN,
  getWindowUuids,
} from '../src/detect/session-state.js'
import type { ActionTriple } from '../src/contracts.js'

// ─── 헬퍼: ActionTriple 생성 ─────────────────────────────────

function makeTriple(
  tool: string,
  argKey: string,
  resultClass: ActionTriple['resultClass'],
  uuid: string,
  ts = 1000,
): ActionTriple {
  return Object.freeze({
    tool,
    argKey,
    resultClass,
    ref: Object.freeze({ uuid, ts }),
  })
}

// ─── 단일 push: 카운트 1 증가 ────────────────────────────────

describe('pushTriple — 단일 push: 카운트 1 증가', () => {
  test('pushTriple 후 argKeyCounts에 해당 argKey 카운트가 1이 됨', () => {
    const state = createSessionState('sess-1', 'root', 30)
    const triple = makeTriple('Edit', 'Edit:/foo.ts:abc123', 'ok', 'uuid-1')
    pushTriple(state, triple)
    expect(state.argKeyCounts.get('Edit:/foo.ts:abc123')?.n).toBe(1)
  })

  test('pushTriple 후 fullKeyCounts에 argKey#resultClass 카운트가 1이 됨', () => {
    const state = createSessionState('sess-1', 'root', 30)
    const triple = makeTriple('Edit', 'Edit:/foo.ts:abc123', 'ok', 'uuid-1')
    pushTriple(state, triple)
    expect(state.fullKeyCounts.get('Edit:/foo.ts:abc123#ok')?.n).toBe(1)
  })

  test('pushTriple 후 history 길이가 1이 됨', () => {
    const state = createSessionState('sess-1', 'root', 30)
    const triple = makeTriple('Bash', 'Bash:deadbeef', 'ok', 'uuid-2')
    pushTriple(state, triple)
    expect(state.history).toHaveLength(1)
  })

  test('pushTriple 후 argKeyCounts에 uuid가 기록됨', () => {
    const state = createSessionState('sess-1', 'root', 30)
    const triple = makeTriple('Read', 'Read:cafebabe', 'ok', 'uuid-3')
    pushTriple(state, triple)
    expect(getWindowUuids(state, 'Read:cafebabe')).toContain('uuid-3')
  })

  test('pushTriple 후 argKeyCounts.firstTs/lastTs가 triple.ref.ts와 일치', () => {
    const state = createSessionState('sess-1', 'root', 30)
    const triple = makeTriple('Bash', 'Bash:deadbeef', 'error', 'uuid-4', 9999)
    pushTriple(state, triple)
    const entry = state.argKeyCounts.get('Bash:deadbeef')
    expect(entry?.firstTs).toBe(9999)
    expect(entry?.lastTs).toBe(9999)
  })
})

// ─── 반복 push: 카운트 누적 ──────────────────────────────────

describe('pushTriple — 동일 argKey 반복 push: 카운트 누적', () => {
  test('동일 argKey triple을 3회 push하면 카운트가 3', () => {
    const state = createSessionState('sess-2', 'root', 30)
    const argKey = 'Edit:/bar.ts:ff001122'
    for (let i = 1; i <= 3; i++) {
      pushTriple(state, makeTriple('Edit', argKey, 'ok', `uuid-${i}`, 1000 + i))
    }
    expect(getRepeatN(state, argKey)).toBe(3)
  })

  test('동일 argKey+error triple을 5회 push하면 errLoopN이 5', () => {
    const state = createSessionState('sess-2', 'root', 30)
    const argKey = 'Bash:beefdead'
    for (let i = 1; i <= 5; i++) {
      pushTriple(state, makeTriple('Bash', argKey, 'error', `uuid-err-${i}`, 2000 + i))
    }
    expect(getErrLoopN(state, argKey)).toBe(5)
  })

  test('반복 push 시 lastTs가 최신 ts로 갱신됨', () => {
    const state = createSessionState('sess-2', 'root', 30)
    const argKey = 'Read:12345678'
    pushTriple(state, makeTriple('Read', argKey, 'ok', 'uuid-a', 1000))
    pushTriple(state, makeTriple('Read', argKey, 'ok', 'uuid-b', 2000))
    pushTriple(state, makeTriple('Read', argKey, 'ok', 'uuid-c', 3000))
    const entry = state.argKeyCounts.get(argKey)
    expect(entry?.firstTs).toBe(1000)
    expect(entry?.lastTs).toBe(3000)
    expect(entry?.n).toBe(3)
  })

  test('반복 push 시 모든 uuid가 uuids 배열에 누적됨', () => {
    const state = createSessionState('sess-2', 'root', 30)
    const argKey = 'Bash:aabbccdd'
    const uuids = ['u1', 'u2', 'u3', 'u4']
    for (const uuid of uuids) {
      pushTriple(state, makeTriple('Bash', argKey, 'ok', uuid, 5000))
    }
    const recorded = getWindowUuids(state, argKey)
    expect(recorded).toEqual(uuids)
  })

  test('10회 반복 push 후 카운트가 정확히 10', () => {
    const state = createSessionState('sess-2', 'root', 30)
    const argKey = 'Grep:deadf00d'
    for (let i = 0; i < 10; i++) {
      pushTriple(state, makeTriple('Grep', argKey, 'ok', `uid-${i}`, i * 100))
    }
    expect(getRepeatN(state, argKey)).toBe(10)
    expect(state.history).toHaveLength(10)
  })
})

// ─── 다른 argKey: 카운트 독립성 ──────────────────────────────

describe('pushTriple — 다른 argKey 카운트 독립성', () => {
  test('서로 다른 argKey는 독립적인 카운트를 가짐', () => {
    const state = createSessionState('sess-3', 'root', 30)
    const key1 = 'Edit:/a.ts:aaa'
    const key2 = 'Edit:/b.ts:bbb'

    pushTriple(state, makeTriple('Edit', key1, 'ok', 'u1'))
    pushTriple(state, makeTriple('Edit', key1, 'ok', 'u2'))
    pushTriple(state, makeTriple('Edit', key2, 'ok', 'u3'))

    expect(getRepeatN(state, key1)).toBe(2)
    expect(getRepeatN(state, key2)).toBe(1)
  })

  test('key1 반복 추가가 key2 카운트에 영향을 미치지 않음', () => {
    const state = createSessionState('sess-3', 'root', 30)
    const key1 = 'Bash:111aaaaa'
    const key2 = 'Bash:222bbbbb'

    for (let i = 0; i < 5; i++) {
      pushTriple(state, makeTriple('Bash', key1, 'ok', `k1-${i}`))
    }
    pushTriple(state, makeTriple('Bash', key2, 'ok', 'k2-0'))

    expect(getRepeatN(state, key1)).toBe(5)
    expect(getRepeatN(state, key2)).toBe(1)
  })

  test('N개 다른 argKey 각각 1회 push → 각 카운트 1', () => {
    const state = createSessionState('sess-3', 'root', 30)
    const keys = ['Read:r1', 'Read:r2', 'Read:r3', 'Bash:b1', 'Bash:b2']
    keys.forEach((argKey, i) => {
      pushTriple(state, makeTriple('Read', argKey, 'ok', `uid-${i}`))
    })
    for (const key of keys) {
      expect(getRepeatN(state, key)).toBe(1)
    }
  })
})

// ─── resultClass별 fullKey 카운트 독립성 ────────────────────

describe('pushTriple — resultClass별 fullKey 카운트 독립성', () => {
  test('동일 argKey에 ok와 error resultClass가 섞이면 fullKey 카운트가 각각 독립', () => {
    const state = createSessionState('sess-4', 'root', 30)
    const argKey = 'Bash:mixed001'

    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'ok-1'))
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'ok-2'))
    pushTriple(state, makeTriple('Bash', argKey, 'error', 'err-1'))

    // argKey 전체 카운트 = 3
    expect(getRepeatN(state, argKey)).toBe(3)
    // error 카운트 = 1
    expect(getErrLoopN(state, argKey)).toBe(1)
    // ok fullKey = 2
    expect(state.fullKeyCounts.get(`${argKey}#ok`)?.n).toBe(2)
  })

  test('error만 연속 3회 push → errLoopN = 3, repeatN = 3', () => {
    const state = createSessionState('sess-4', 'root', 30)
    const argKey = 'Bash:erronly'

    for (let i = 0; i < 3; i++) {
      pushTriple(state, makeTriple('Bash', argKey, 'error', `e-${i}`))
    }

    expect(getRepeatN(state, argKey)).toBe(3)
    expect(getErrLoopN(state, argKey)).toBe(3)
    // ok fullKey는 없음
    expect(state.fullKeyCounts.get(`${argKey}#ok`)).toBeUndefined()
  })

  test('ok만 연속 push → errLoopN = 0', () => {
    const state = createSessionState('sess-4', 'root', 30)
    const argKey = 'Bash:okonly'

    for (let i = 0; i < 4; i++) {
      pushTriple(state, makeTriple('Bash', argKey, 'ok', `o-${i}`))
    }

    expect(getRepeatN(state, argKey)).toBe(4)
    expect(getErrLoopN(state, argKey)).toBe(0)
  })
})

// ─── historySize 초과: evict 시 카운트 감소 ─────────────────

describe('pushTriple — historySize 초과 시 evict된 triple 카운트 감소', () => {
  test('historySize=3에서 4번째 push 시 첫 번째가 evict되어 카운트 감소', () => {
    const state = createSessionState('sess-5', 'root', 3)
    const argKey = 'Bash:window01'

    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'ev-1', 100))
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'ev-2', 200))
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'ev-3', 300))
    // 카운트 = 3
    expect(getRepeatN(state, argKey)).toBe(3)

    // 4번째 push → ev-1 evict
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'ev-4', 400))
    // 윈도 내 카운트 = 3 (ev-1 제거, ev-4 추가)
    expect(getRepeatN(state, argKey)).toBe(3)
    // ev-1은 uuids에서 제거됨
    expect(getWindowUuids(state, argKey)).not.toContain('ev-1')
    // ev-4는 uuids에 존재
    expect(getWindowUuids(state, argKey)).toContain('ev-4')
    // history 크기는 historySize(=3) 유지
    expect(state.history).toHaveLength(3)
  })

  test('historySize=2에서 서로 다른 argKey가 evict 시 올바른 카운트 감소', () => {
    const state = createSessionState('sess-5', 'root', 2)
    const key1 = 'Edit:/x.ts:111'
    const key2 = 'Edit:/y.ts:222'

    pushTriple(state, makeTriple('Edit', key1, 'ok', 'k1u1'))
    pushTriple(state, makeTriple('Edit', key2, 'ok', 'k2u1'))
    // 두 키 각 1회
    expect(getRepeatN(state, key1)).toBe(1)
    expect(getRepeatN(state, key2)).toBe(1)

    // key1 두 번째 push → key1 첫 번째(k1u1)가 evict
    pushTriple(state, makeTriple('Edit', key1, 'ok', 'k1u2'))
    // key1이 evict → key1 카운트 = 1 (k1u2만 남음), key2도 evict → 0
    // 윈도: [key2-k2u1 evicted], [key1-k1u2 남음]
    // 실제로 historySize=2이므로 [key2-k2u1, key1-k1u2] → push key1 → [key1-k1u1 evict], 윈도=[key2-k2u1, key1-k1u2]
    // key1-k1u1 evict → key1 카운트 1 → key2 카운트 1
    expect(getRepeatN(state, key1)).toBe(1)
    expect(getRepeatN(state, key2)).toBe(1)
  })

  test('historySize=1에서 모든 push는 이전 triple을 evict함', () => {
    const state = createSessionState('sess-5', 'root', 1)
    const argKey = 'Read:tiny001'

    pushTriple(state, makeTriple('Read', argKey, 'ok', 'r1'))
    expect(getRepeatN(state, argKey)).toBe(1)

    pushTriple(state, makeTriple('Read', argKey, 'ok', 'r2'))
    // r1 evict → 카운트 여전히 1
    expect(getRepeatN(state, argKey)).toBe(1)
    expect(getWindowUuids(state, argKey)).toEqual(['r2'])

    pushTriple(state, makeTriple('Read', argKey, 'ok', 'r3'))
    expect(getRepeatN(state, argKey)).toBe(1)
    expect(getWindowUuids(state, argKey)).toEqual(['r3'])
  })

  test('historySize=5에서 argKey가 완전히 윈도 밖으로 나가면 카운트 0 (키 삭제)', () => {
    const state = createSessionState('sess-5', 'root', 5)
    const evictKey = 'Bash:goaway'
    const fillKey = 'Bash:filler'

    // evictKey 1회 push
    pushTriple(state, makeTriple('Bash', evictKey, 'ok', 'gone-1'))
    expect(getRepeatN(state, evictKey)).toBe(1)

    // fillKey 5회 push → evictKey triple이 윈도 밖으로 밀려남
    for (let i = 0; i < 5; i++) {
      pushTriple(state, makeTriple('Bash', fillKey, 'ok', `fill-${i}`))
    }

    // evictKey는 윈도 밖 → 카운트 0
    expect(getRepeatN(state, evictKey)).toBe(0)
    // Map에서 키가 삭제됨
    expect(state.argKeyCounts.has(evictKey)).toBe(false)
    // fillKey는 5회
    expect(getRepeatN(state, fillKey)).toBe(5)
  })
})

// ─── argKeyCounts Map 내부 구조 무결성 ──────────────────────

describe('pushTriple — argKeyCounts Map 내부 구조 무결성', () => {
  test('push 후 argKeyCounts에 정확히 1개의 키 존재 (단일 argKey)', () => {
    const state = createSessionState('sess-6', 'root', 30)
    pushTriple(state, makeTriple('Edit', 'Edit:/only.ts:zzz', 'ok', 'solo'))
    expect(state.argKeyCounts.size).toBe(1)
  })

  test('N개 서로 다른 argKey 추가 후 argKeyCounts.size === N', () => {
    const state = createSessionState('sess-6', 'root', 30)
    const keys = ['Bash:k1', 'Bash:k2', 'Bash:k3', 'Read:k4', 'Edit:/f.ts:k5']
    keys.forEach((k, i) => pushTriple(state, makeTriple('Bash', k, 'ok', `u-${i}`)))
    expect(state.argKeyCounts.size).toBe(keys.length)
  })

  test('동일 argKey를 N회 push해도 argKeyCounts.size === 1', () => {
    const state = createSessionState('sess-6', 'root', 30)
    const argKey = 'Bash:repeat'
    for (let i = 0; i < 7; i++) {
      pushTriple(state, makeTriple('Bash', argKey, 'ok', `rep-${i}`))
    }
    expect(state.argKeyCounts.size).toBe(1)
    expect(getRepeatN(state, argKey)).toBe(7)
  })
})

// ─── fullKeyCounts Map 내부 구조 무결성 ─────────────────────

describe('pushTriple — fullKeyCounts Map 내부 구조 무결성', () => {
  test('단일 argKey + 단일 resultClass → fullKeyCounts.size === 1', () => {
    const state = createSessionState('sess-7', 'root', 30)
    pushTriple(state, makeTriple('Bash', 'Bash:fk1', 'error', 'fu1'))
    pushTriple(state, makeTriple('Bash', 'Bash:fk1', 'error', 'fu2'))
    expect(state.fullKeyCounts.size).toBe(1)
    expect(state.fullKeyCounts.get('Bash:fk1#error')?.n).toBe(2)
  })

  test('동일 argKey + 두 가지 resultClass → fullKeyCounts.size === 2', () => {
    const state = createSessionState('sess-7', 'root', 30)
    pushTriple(state, makeTriple('Bash', 'Bash:fk2', 'ok', 'fu3'))
    pushTriple(state, makeTriple('Bash', 'Bash:fk2', 'error', 'fu4'))
    expect(state.fullKeyCounts.size).toBe(2)
  })

  test('error triple evict 후 fullKeyCounts에서 error 키가 삭제됨', () => {
    const state = createSessionState('sess-7', 'root', 2)
    const argKey = 'Bash:fkevict'

    pushTriple(state, makeTriple('Bash', argKey, 'error', 'fe1'))
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'fo1'))
    // 윈도: [fe1, fo1], 카운트: error=1, ok=1

    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'fo2'))
    // fe1 evict → error 키 삭제, ok=2
    expect(state.fullKeyCounts.has(`${argKey}#error`)).toBe(false)
    expect(state.fullKeyCounts.get(`${argKey}#ok`)?.n).toBe(2)
  })
})

// ─── getRepeatN / getErrLoopN API 검증 ──────────────────────

describe('getRepeatN / getErrLoopN — 공개 API 검증', () => {
  test('getRepeatN: 존재하지 않는 argKey → 0 반환', () => {
    const state = createSessionState('sess-8', 'root', 30)
    expect(getRepeatN(state, 'nonexistent:key')).toBe(0)
  })

  test('getErrLoopN: 에러 없는 argKey → 0 반환', () => {
    const state = createSessionState('sess-8', 'root', 30)
    pushTriple(state, makeTriple('Bash', 'Bash:noerr', 'ok', 'u1'))
    expect(getErrLoopN(state, 'Bash:noerr')).toBe(0)
  })

  test('getWindowUuids: 빈 상태에서 빈 배열 반환', () => {
    const state = createSessionState('sess-8', 'root', 30)
    expect(getWindowUuids(state, 'no:key')).toEqual([])
  })

  test('getRepeatN + getErrLoopN 모두 pushTriple과 일관성 있음', () => {
    const state = createSessionState('sess-8', 'root', 30)
    const argKey = 'Bash:consistent'

    // 3 ok + 2 error
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'c1'))
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'c2'))
    pushTriple(state, makeTriple('Bash', argKey, 'error', 'c3'))
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'c4'))
    pushTriple(state, makeTriple('Bash', argKey, 'error', 'c5'))

    expect(getRepeatN(state, argKey)).toBe(5)
    expect(getErrLoopN(state, argKey)).toBe(2)
  })
})
