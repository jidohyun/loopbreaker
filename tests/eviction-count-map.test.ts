/**
 * tests/eviction-count-map.test.ts
 *
 * Sub-AC 4: 윈도 만료 시 카운트 맵 감소(eviction) 테스트
 *
 * 검증 항목:
 *   1. RingBuffer가 꽉 찬 상태에서 새 triple push 시 밀려난 triple의
 *      argKeyCounts 카운트가 정확히 1 감소하는지
 *   2. 동일 argKey의 카운트가 0이 되면 Map에서 키가 삭제되는지
 *   3. fullKeyCounts(argKey#resultClass)도 동일하게 evict 처리되는지
 *   4. uuids 배열에서 evicted uuid가 정확히 제거되는지
 *   5. 다수의 연속 eviction 후 카운트 정합성 유지
 *   6. 혼합 argKey 시나리오에서 evict된 키만 감소하고 나머지는 유지
 *   7. historySize=1 경계값에서 모든 push가 eviction을 유발
 *   8. error resultClass를 가진 triple의 eviction 후 errLoopN 정합성
 */

import {
  createSessionState,
  pushTriple,
  getRepeatN,
  getErrLoopN,
  getWindowUuids,
} from '../src/detect/session-state.js'
import type { ActionTriple } from '../src/contracts.js'

// ─── 헬퍼 ────────────────────────────────────────────────────

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

// ─── 1. argKeyCounts 1 감소 — 기본 eviction ─────────────────

describe('eviction — argKeyCounts 1 감소', () => {
  test('꽉 찬 버퍼(historySize=3)에서 push 시 evicted triple의 카운트가 1 감소', () => {
    const state = createSessionState('s1', 'root', 3)
    const argKey = 'Bash:evict001'

    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'u1', 100))
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'u2', 200))
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'u3', 300))
    expect(getRepeatN(state, argKey)).toBe(3)

    // 4번째 push → u1 evict → 카운트 3-1=3 (u4 추가 후 net)
    // 실제: evict(u1) → count 2, then bump(u4) → count 3
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'u4', 400))
    expect(getRepeatN(state, argKey)).toBe(3) // 윈도: [u2,u3,u4]

    // u1 uuid는 제거됨
    const uuids = getWindowUuids(state, argKey)
    expect(uuids).not.toContain('u1')
    expect(uuids).toContain('u2')
    expect(uuids).toContain('u3')
    expect(uuids).toContain('u4')
  })

  test('연속 eviction — 각 단계마다 카운트가 정확히 유지됨', () => {
    const state = createSessionState('s1', 'root', 2)
    const argKey = 'Edit:/f.ts:aaaa'

    // 윈도에 2개 채움
    pushTriple(state, makeTriple('Edit', argKey, 'ok', 'e1', 100))
    pushTriple(state, makeTriple('Edit', argKey, 'ok', 'e2', 200))
    expect(getRepeatN(state, argKey)).toBe(2)

    // e1 evict: 카운트 2-1+1=2 (e3 추가)
    pushTriple(state, makeTriple('Edit', argKey, 'ok', 'e3', 300))
    expect(getRepeatN(state, argKey)).toBe(2) // [e2, e3]

    // e2 evict: 카운트 2-1+1=2 (e4 추가)
    pushTriple(state, makeTriple('Edit', argKey, 'ok', 'e4', 400))
    expect(getRepeatN(state, argKey)).toBe(2) // [e3, e4]

    // e3 evict: 카운트 2-1+1=2 (e5 추가)
    pushTriple(state, makeTriple('Edit', argKey, 'ok', 'e5', 500))
    expect(getRepeatN(state, argKey)).toBe(2) // [e4, e5]

    const uuids = getWindowUuids(state, argKey)
    expect(uuids).toEqual(['e4', 'e5'])
  })
})

// ─── 2. 카운트 0 → 키 삭제 ───────────────────────────────────

describe('eviction — 카운트 0이 되면 Map에서 키 삭제', () => {
  test('argKey가 완전히 윈도 밖으로 밀려나면 argKeyCounts에서 키 삭제', () => {
    const state = createSessionState('s2', 'root', 3)
    const evictKey = 'Read:gone001'
    const fillKey = 'Read:filler'

    pushTriple(state, makeTriple('Read', evictKey, 'ok', 'gone-u1'))
    expect(state.argKeyCounts.has(evictKey)).toBe(true)

    // 3번 다른 key push → evictKey가 윈도 밖으로
    for (let i = 0; i < 3; i++) {
      pushTriple(state, makeTriple('Read', fillKey, 'ok', `fill-${i}`))
    }

    // evictKey 카운트 0 → 키 삭제
    expect(state.argKeyCounts.has(evictKey)).toBe(false)
    expect(getRepeatN(state, evictKey)).toBe(0)
  })

  test('2개의 evictKey가 모두 밀려나면 두 키 모두 삭제', () => {
    const state = createSessionState('s2', 'root', 2)
    const key1 = 'Bash:del001'
    const key2 = 'Bash:del002'
    const fillKey = 'Bash:fill'

    pushTriple(state, makeTriple('Bash', key1, 'ok', 'k1u'))
    pushTriple(state, makeTriple('Bash', key2, 'ok', 'k2u'))
    expect(state.argKeyCounts.has(key1)).toBe(true)
    expect(state.argKeyCounts.has(key2)).toBe(true)

    // 2번 fill push → key1, key2 각각 evict
    pushTriple(state, makeTriple('Bash', fillKey, 'ok', 'f1'))
    pushTriple(state, makeTriple('Bash', fillKey, 'ok', 'f2'))

    expect(state.argKeyCounts.has(key1)).toBe(false)
    expect(state.argKeyCounts.has(key2)).toBe(false)
    expect(getRepeatN(state, fillKey)).toBe(2)
  })

  test('동일 argKey가 여러 번 등장 후 완전히 밀려나면 삭제', () => {
    const state = createSessionState('s2', 'root', 4)
    const targetKey = 'Grep:multi001'
    const fillKey = 'Grep:filler'

    // targetKey 2번 push
    pushTriple(state, makeTriple('Grep', targetKey, 'ok', 't1'))
    pushTriple(state, makeTriple('Grep', targetKey, 'ok', 't2'))
    expect(getRepeatN(state, targetKey)).toBe(2)

    // fillKey 4번 push → targetKey 2개 모두 윈도 밖
    for (let i = 0; i < 4; i++) {
      pushTriple(state, makeTriple('Grep', fillKey, 'ok', `f${i}`))
    }

    expect(state.argKeyCounts.has(targetKey)).toBe(false)
    expect(getRepeatN(state, targetKey)).toBe(0)
    expect(getRepeatN(state, fillKey)).toBe(4)
  })
})

// ─── 3. fullKeyCounts(argKey#resultClass) eviction ──────────

describe('eviction — fullKeyCounts 정합성', () => {
  test('error triple evict 후 fullKeyCounts에서 error 키 삭제', () => {
    const state = createSessionState('s3', 'root', 2)
    const argKey = 'Bash:fkevict01'

    pushTriple(state, makeTriple('Bash', argKey, 'error', 'err1'))
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'ok1'))
    // 윈도: [error, ok] — errLoopN=1, ok=1

    // 3번째 push → err1 evict
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'ok2'))
    // errLoopN = 0 → fullKey 삭제
    expect(state.fullKeyCounts.has(`${argKey}#error`)).toBe(false)
    expect(getErrLoopN(state, argKey)).toBe(0)
    expect(state.fullKeyCounts.get(`${argKey}#ok`)?.n).toBe(2)
  })

  test('error triple이 부분적으로 evict되면 남은 count 정확히 유지', () => {
    const state = createSessionState('s3', 'root', 3)
    const argKey = 'Bash:fkpartial'

    pushTriple(state, makeTriple('Bash', argKey, 'error', 'err1'))
    pushTriple(state, makeTriple('Bash', argKey, 'error', 'err2'))
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'ok1'))
    // 윈도 full: [err1, err2, ok1]

    // 4번째 push → err1 evict
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'ok2'))
    // 윈도: [err2, ok1, ok2] — errLoopN=1, ok=2
    expect(getErrLoopN(state, argKey)).toBe(1)
    expect(state.fullKeyCounts.get(`${argKey}#error`)?.n).toBe(1)
    expect(state.fullKeyCounts.get(`${argKey}#ok`)?.n).toBe(2)
  })

  test('ok triple evict 후 ok fullKey 삭제, error fullKey 유지', () => {
    const state = createSessionState('s3', 'root', 2)
    const argKey = 'Bash:fkmix'

    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'ok1'))
    pushTriple(state, makeTriple('Bash', argKey, 'error', 'err1'))
    // 윈도: [ok1, err1]

    // ok1 evict → ok fullKey 삭제
    pushTriple(state, makeTriple('Bash', argKey, 'error', 'err2'))
    expect(state.fullKeyCounts.has(`${argKey}#ok`)).toBe(false)
    expect(getErrLoopN(state, argKey)).toBe(2)
  })
})

// ─── 4. uuids 배열에서 evicted uuid 제거 ────────────────────

describe('eviction — uuids 배열 정합성', () => {
  test('evicted triple의 uuid가 uuids 배열에서 제거됨', () => {
    const state = createSessionState('s4', 'root', 3)
    const argKey = 'Edit:/u.ts:uuid01'

    pushTriple(state, makeTriple('Edit', argKey, 'ok', 'uid-remove'))
    pushTriple(state, makeTriple('Edit', argKey, 'ok', 'uid-keep1'))
    pushTriple(state, makeTriple('Edit', argKey, 'ok', 'uid-keep2'))

    // 버퍼 꽉 참 → uid-remove evict
    pushTriple(state, makeTriple('Edit', argKey, 'ok', 'uid-new'))

    const uuids = getWindowUuids(state, argKey)
    expect(uuids).not.toContain('uid-remove')
    expect(uuids).toContain('uid-keep1')
    expect(uuids).toContain('uid-keep2')
    expect(uuids).toContain('uid-new')
    expect(uuids).toHaveLength(3)
  })

  test('연속 eviction 시 uuids 배열 길이가 historySize를 초과하지 않음', () => {
    const historySize = 4
    const state = createSessionState('s4', 'root', historySize)
    const argKey = 'Bash:uuidbuf'

    for (let i = 0; i < 10; i++) {
      pushTriple(state, makeTriple('Bash', argKey, 'ok', `u${i}`))
      const uuids = getWindowUuids(state, argKey)
      // historySize를 초과하지 않아야 함
      expect(uuids.length).toBeLessThanOrEqual(historySize)
    }
  })

  test('eviction 후 uuids 배열이 현재 윈도와 일치', () => {
    const state = createSessionState('s4', 'root', 3)
    const argKey = 'Read:uuidwin'

    const expectedUuids: string[] = []
    for (let i = 0; i < 6; i++) {
      const uuid = `ru${i}`
      pushTriple(state, makeTriple('Read', argKey, 'ok', uuid))
      expectedUuids.push(uuid)
      // 윈도는 최근 3개
      const windowUuids = expectedUuids.slice(-3)
      const actual = getWindowUuids(state, argKey)
      expect([...actual].sort()).toEqual([...windowUuids].sort())
    }
  })
})

// ─── 5. 다수 연속 eviction 후 카운트 정합성 ─────────────────

describe('eviction — 다수 연속 eviction 후 카운트 정합성', () => {
  test('historySize=5로 50번 push 후 카운트가 정확히 5', () => {
    const state = createSessionState('s5', 'root', 5)
    const argKey = 'Bash:many001'

    for (let i = 0; i < 50; i++) {
      pushTriple(state, makeTriple('Bash', argKey, 'ok', `m${i}`))
    }

    expect(getRepeatN(state, argKey)).toBe(5)
    expect(state.history).toHaveLength(5)

    const uuids = getWindowUuids(state, argKey)
    expect(uuids).toHaveLength(5)
    // 마지막 5개 uuid
    for (let i = 45; i < 50; i++) {
      expect(uuids).toContain(`m${i}`)
    }
  })

  test('argKeyCounts.size가 현재 윈도 내 고유 argKey 수와 일치', () => {
    const state = createSessionState('s5', 'root', 4)

    // key1 3번, key2 1번 → 총 4개 (윈도 full)
    const key1 = 'Bash:cnt001'
    const key2 = 'Bash:cnt002'
    const key3 = 'Bash:cnt003'

    pushTriple(state, makeTriple('Bash', key1, 'ok', 'k1a'))
    pushTriple(state, makeTriple('Bash', key2, 'ok', 'k2a'))
    pushTriple(state, makeTriple('Bash', key1, 'ok', 'k1b'))
    pushTriple(state, makeTriple('Bash', key1, 'ok', 'k1c'))
    // 윈도: [key1(k1a), key2, key1(k1b), key1(k1c)]

    expect(getRepeatN(state, key1)).toBe(3)
    expect(getRepeatN(state, key2)).toBe(1)
    expect(state.argKeyCounts.size).toBe(2)

    // key3 push → key1(k1a) evict
    pushTriple(state, makeTriple('Bash', key3, 'ok', 'k3a'))
    // 윈도: [key2, key1(k1b), key1(k1c), key3]
    expect(getRepeatN(state, key1)).toBe(2)
    expect(getRepeatN(state, key2)).toBe(1)
    expect(getRepeatN(state, key3)).toBe(1)
    expect(state.argKeyCounts.size).toBe(3)
  })

  test('교대 push로 두 key가 번갈아 evict될 때 카운트 항상 정확', () => {
    const state = createSessionState('s5', 'root', 2)
    const keyA = 'Bash:altA'
    const keyB = 'Bash:altB'

    for (let round = 0; round < 5; round++) {
      pushTriple(state, makeTriple('Bash', keyA, 'ok', `a${round}`))
      pushTriple(state, makeTriple('Bash', keyB, 'ok', `b${round}`))
      // 윈도: [keyA_round, keyB_round] — 각 1회
      expect(getRepeatN(state, keyA)).toBe(1)
      expect(getRepeatN(state, keyB)).toBe(1)
    }
  })
})

// ─── 6. 혼합 argKey — 선택적 eviction ───────────────────────

describe('eviction — 혼합 argKey 선택적 감소', () => {
  test('evict된 argKey의 카운트만 감소하고 나머지는 변하지 않음', () => {
    const state = createSessionState('s6', 'root', 3)
    const evictKey = 'Edit:/evict.ts:abc'
    const stayKey1 = 'Edit:/stay1.ts:def'
    const stayKey2 = 'Edit:/stay2.ts:ghi'

    pushTriple(state, makeTriple('Edit', evictKey, 'ok', 'ev1'))
    pushTriple(state, makeTriple('Edit', stayKey1, 'ok', 's1a'))
    pushTriple(state, makeTriple('Edit', stayKey2, 'ok', 's2a'))
    // 윈도 full: [evict, stay1, stay2]

    // push stay1 again → evict evict
    pushTriple(state, makeTriple('Edit', stayKey1, 'ok', 's1b'))
    // 윈도: [stay1(s1a), stay2, stay1(s1b)]

    expect(state.argKeyCounts.has(evictKey)).toBe(false)
    expect(getRepeatN(state, stayKey1)).toBe(2)
    expect(getRepeatN(state, stayKey2)).toBe(1)
  })

  test('argKeyCounts의 카운트 총합이 historySize와 일치', () => {
    const historySize = 5
    const state = createSessionState('s6', 'root', historySize)
    const keys = ['k1', 'k2', 'k3', 'k4', 'k5']

    // historySize개 push (각기 다른 key)
    keys.forEach((k, i) => {
      pushTriple(state, makeTriple('Bash', k, 'ok', `u${i}`))
    })

    // 총 카운트 합 = historySize
    let total = 0
    for (const entry of state.argKeyCounts.values()) {
      total += entry.n
    }
    expect(total).toBe(historySize)

    // 5개 더 push (다른 key들)
    for (let i = 0; i < historySize; i++) {
      pushTriple(state, makeTriple('Bash', `newkey${i}`, 'ok', `nu${i}`))
    }

    // 총 카운트 합 여전히 historySize
    total = 0
    for (const entry of state.argKeyCounts.values()) {
      total += entry.n
    }
    expect(total).toBe(historySize)
  })
})

// ─── 7. historySize=1 경계값 ─────────────────────────────────

describe('eviction — historySize=1 경계값', () => {
  test('historySize=1: 모든 push가 이전 triple을 evict', () => {
    const state = createSessionState('s7', 'root', 1)
    const argKey = 'Bash:tiny'

    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'x1'))
    expect(getRepeatN(state, argKey)).toBe(1)
    expect(getWindowUuids(state, argKey)).toEqual(['x1'])

    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'x2'))
    // x1 evict → count 1 (not 2)
    expect(getRepeatN(state, argKey)).toBe(1)
    expect(getWindowUuids(state, argKey)).toEqual(['x2'])
    expect(state.history).toHaveLength(1)
  })

  test('historySize=1: argKey가 바뀌면 이전 key가 즉시 삭제됨', () => {
    const state = createSessionState('s7', 'root', 1)
    const keyA = 'Bash:oneA'
    const keyB = 'Bash:oneB'

    pushTriple(state, makeTriple('Bash', keyA, 'ok', 'a1'))
    expect(state.argKeyCounts.has(keyA)).toBe(true)

    pushTriple(state, makeTriple('Bash', keyB, 'ok', 'b1'))
    // keyA evict → 삭제
    expect(state.argKeyCounts.has(keyA)).toBe(false)
    expect(getRepeatN(state, keyB)).toBe(1)
  })

  test('historySize=1: error evict 후 errLoopN=0', () => {
    const state = createSessionState('s7', 'root', 1)
    const argKey = 'Bash:err1'

    pushTriple(state, makeTriple('Bash', argKey, 'error', 'e1'))
    expect(getErrLoopN(state, argKey)).toBe(1)

    // ok push → error evict
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'o1'))
    expect(getErrLoopN(state, argKey)).toBe(0)
    expect(state.fullKeyCounts.has(`${argKey}#error`)).toBe(false)
  })
})

// ─── 8. error resultClass eviction 후 errLoopN 정합성 ───────

describe('eviction — error resultClass eviction 후 errLoopN 정합성', () => {
  test('error triple이 윈도 밖으로 밀려나면 errLoopN이 정확히 감소', () => {
    const state = createSessionState('s8', 'root', 5)
    const argKey = 'Bash:erredge'
    const fillKey = 'Bash:errfill'

    // error 2번 push
    pushTriple(state, makeTriple('Bash', argKey, 'error', 'err1'))
    pushTriple(state, makeTriple('Bash', argKey, 'error', 'err2'))
    expect(getErrLoopN(state, argKey)).toBe(2)

    // 5번 fill push → err1, err2 모두 윈도 밖
    for (let i = 0; i < 5; i++) {
      pushTriple(state, makeTriple('Bash', fillKey, 'ok', `f${i}`))
    }

    // errLoopN = 0, fullKeyCounts에서 error 키 삭제
    expect(getErrLoopN(state, argKey)).toBe(0)
    expect(state.fullKeyCounts.has(`${argKey}#error`)).toBe(false)
  })

  test('error 3개 중 1개만 evict → errLoopN=2로 정확히 유지', () => {
    const state = createSessionState('s8', 'root', 4)
    const argKey = 'Bash:errpartial'

    pushTriple(state, makeTriple('Bash', argKey, 'error', 'err1'))
    pushTriple(state, makeTriple('Bash', argKey, 'error', 'err2'))
    pushTriple(state, makeTriple('Bash', argKey, 'error', 'err3'))
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'ok1'))
    // 윈도 full: [err1, err2, err3, ok1] — errLoopN=3

    // err1 evict
    pushTriple(state, makeTriple('Bash', argKey, 'ok', 'ok2'))
    // 윈도: [err2, err3, ok1, ok2] — errLoopN=2
    expect(getErrLoopN(state, argKey)).toBe(2)
    expect(state.fullKeyCounts.get(`${argKey}#error`)?.n).toBe(2)
    expect(state.fullKeyCounts.get(`${argKey}#ok`)?.n).toBe(2)
  })

  test('errLoopN 임계값 직전 eviction 시나리오 — 카운트가 정확히 임계 미만으로 떨어짐', () => {
    // historySize=5: 5개 error push → window full.
    // 6번째 push → 가장 오래된 error evict → errLoopN=4
    const state = createSessionState('s8', 'root', 5)
    const argKey = 'Bash:errcrit'
    const fillKey = 'Bash:critfill'

    // error 5번 push → window full
    for (let i = 0; i < 5; i++) {
      pushTriple(state, makeTriple('Bash', argKey, 'error', `ce${i}`))
    }
    expect(getErrLoopN(state, argKey)).toBe(5)

    // fill 1번 → 가장 오래된 error(ce0) evict
    pushTriple(state, makeTriple('Bash', fillKey, 'ok', 'cf1'))
    expect(getErrLoopN(state, argKey)).toBe(4)

    // fill 4번 더 → error 4개(ce1~ce4) 모두 evict
    for (let i = 0; i < 4; i++) {
      pushTriple(state, makeTriple('Bash', fillKey, 'ok', `cf${i + 2}`))
    }
    expect(getErrLoopN(state, argKey)).toBe(0)
    expect(state.fullKeyCounts.has(`${argKey}#error`)).toBe(false)
  })
})
