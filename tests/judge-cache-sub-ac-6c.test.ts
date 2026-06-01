/**
 * tests/judge-cache-sub-ac-6c.test.ts
 *
 * Sub-AC 6c: getOrRegisterJudge(key, cache) -> JudgeVerdict
 *
 * 검증 항목:
 *   1. 캐시 히트 → 등록된 판정을 결정론으로 반환한다
 *   2. 캐시 미스 → JudgeCacheMissError를 던진다 (조용한 폴백 금지)
 *   3. JudgeCacheMissError.cacheKey 필드에 실패한 키가 기록된다
 *   4. 반환 판정은 원본과 독립된 불변 복사본이다
 *   5. 빈 캐시에서 모든 조회가 JudgeCacheMissError를 발생시킨다
 *   6. 여러 키가 등록된 캐시에서 각각 정확한 판정을 반환한다
 *   7. registerJudge: 새 캐시를 반환하고 기존 캐시를 변이하지 않는다
 *   8. createJudgeCacheFrom: 초기 항목으로 캐시를 생성한다
 *   9. buildCacheKey와 연동: sha256(prompt)+':'+modelId 키로 조회한다
 */

import {
  JudgeCacheMissError,
  createJudgeCache,
  createJudgeCacheFrom,
  getOrRegisterJudge,
  registerJudge,
  type JudgeCache,
  type JudgeVerdict,
} from '../src/api/judge-cache.js'
import { buildCacheKey } from '../src/api/cache-key.js'

// ─── 공통 픽스처 ─────────────────────────────────────────────────────────────

const VERDICT_THRASHING: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'repeat',
  confidence: 0.9,
  reason: 'loop detected',
  rawSamples: ['sample1'],
}

const VERDICT_FALSE_SUCCESS: JudgeVerdict = {
  kind: 'false_success',
  subtype: 'premature-completion',
  confidence: 0.85,
  reason: 'task incomplete',
  rawSamples: ['sample2'],
}

const VERDICT_NONE: JudgeVerdict = {
  kind: 'none',
  subtype: '',
  confidence: 0.1,
  reason: 'no issue',
  rawSamples: [],
}

// ─── 1. 캐시 히트 → 등록된 판정을 결정론으로 반환 ───────────────────────────

describe('getOrRegisterJudge — 캐시 히트', () => {
  const KEY = 'abc123:claude-3-5-haiku-20241022'

  let cache: JudgeCache

  beforeEach(() => {
    cache = createJudgeCacheFrom([[KEY, VERDICT_THRASHING]])
  })

  test('캐시 히트 시 등록된 판정을 반환한다', () => {
    const result = getOrRegisterJudge(KEY, cache)
    expect(result).toEqual(VERDICT_THRASHING)
  })

  test('동일 키로 두 번 조회해도 동일 값을 반환한다 (결정론)', () => {
    const r1 = getOrRegisterJudge(KEY, cache)
    const r2 = getOrRegisterJudge(KEY, cache)
    expect(r1).toEqual(r2)
  })

  test('반환된 판정의 필드가 등록된 값과 일치한다', () => {
    const result = getOrRegisterJudge(KEY, cache)
    expect(result.kind).toBe('thrashing')
    expect(result.subtype).toBe('repeat')
    expect(result.confidence).toBe(0.9)
    expect(result.reason).toBe('loop detected')
    expect(result.rawSamples).toEqual(['sample1'])
  })

  test('false_success 판정도 정확히 반환된다', () => {
    const key = 'def456:claude-3-5-haiku-20241022'
    const c = createJudgeCacheFrom([[key, VERDICT_FALSE_SUCCESS]])
    const result = getOrRegisterJudge(key, c)
    expect(result.kind).toBe('false_success')
    expect(result.confidence).toBe(0.85)
  })

  test('none 판정도 정확히 반환된다', () => {
    const key = 'ghi789:claude-3-5-haiku-20241022'
    const c = createJudgeCacheFrom([[key, VERDICT_NONE]])
    const result = getOrRegisterJudge(key, c)
    expect(result.kind).toBe('none')
  })
})

// ─── 2. 캐시 미스 → JudgeCacheMissError 발생 (조용한 폴백 금지) ─────────────

describe('getOrRegisterJudge — 캐시 미스 (JudgeCacheMissError)', () => {
  test('빈 캐시에서 조회하면 JudgeCacheMissError를 던진다', () => {
    const cache = createJudgeCache()
    expect(() => getOrRegisterJudge('any-key', cache)).toThrow(JudgeCacheMissError)
  })

  test('등록되지 않은 키로 조회하면 JudgeCacheMissError를 던진다', () => {
    const cache = createJudgeCacheFrom([['registered-key:model', VERDICT_NONE]])
    expect(() => getOrRegisterJudge('unregistered-key:model', cache)).toThrow(JudgeCacheMissError)
  })

  test('JudgeCacheMissError는 Error 서브클래스이다', () => {
    const cache = createJudgeCache()
    expect(() => getOrRegisterJudge('missing', cache)).toThrow(Error)
  })

  test('JudgeCacheMissError.name이 "JudgeCacheMissError"이다', () => {
    const cache = createJudgeCache()
    try {
      getOrRegisterJudge('missing', cache)
      fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(JudgeCacheMissError)
      expect((err as JudgeCacheMissError).name).toBe('JudgeCacheMissError')
    }
  })

  test('폴백(undefined/null 반환)이 아니라 실제로 throw한다', () => {
    const cache = createJudgeCache()
    let thrown = false
    try {
      getOrRegisterJudge('key', cache)
    } catch {
      thrown = true
    }
    expect(thrown).toBe(true)
  })
})

// ─── 3. JudgeCacheMissError.cacheKey에 실패한 키가 기록된다 ─────────────────

describe('JudgeCacheMissError — cacheKey 필드', () => {
  test('JudgeCacheMissError.cacheKey가 조회 실패한 키를 담는다', () => {
    const cache = createJudgeCache()
    const failKey = 'deadbeef:claude-3-5-haiku-20241022'
    try {
      getOrRegisterJudge(failKey, cache)
      fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(JudgeCacheMissError)
      expect((err as JudgeCacheMissError).cacheKey).toBe(failKey)
    }
  })

  test('message에 실패한 키 정보가 포함된다', () => {
    const cache = createJudgeCache()
    const failKey = 'missing-key:model'
    try {
      getOrRegisterJudge(failKey, cache)
      fail('should have thrown')
    } catch (err) {
      expect((err as JudgeCacheMissError).message).toContain(failKey)
    }
  })

  test('JudgeCacheMissError를 직접 생성하면 cacheKey 필드가 세팅된다', () => {
    const err = new JudgeCacheMissError('test-key:model')
    expect(err.cacheKey).toBe('test-key:model')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('JudgeCacheMissError')
  })
})

// ─── 4. 반환 판정은 불변 복사본 (원본 캐시 보호) ────────────────────────────

describe('getOrRegisterJudge — 불변 복사본 반환', () => {
  test('반환된 판정은 원본 참조와 다른 객체이다', () => {
    const key = 'k:m'
    const cache = createJudgeCacheFrom([[key, VERDICT_THRASHING]])
    const result = getOrRegisterJudge(key, cache)
    // 값은 동등하지만 참조가 다름
    expect(result).toEqual(VERDICT_THRASHING)
    expect(result).not.toBe(VERDICT_THRASHING)
  })

  test('두 번 조회해도 동등한 값을 반환한다', () => {
    const key = 'k:m'
    const cache = createJudgeCacheFrom([[key, VERDICT_NONE]])
    const r1 = getOrRegisterJudge(key, cache)
    const r2 = getOrRegisterJudge(key, cache)
    expect(r1).toEqual(r2)
  })
})

// ─── 5. 빈 캐시에서 모든 조회가 JudgeCacheMissError ─────────────────────────

describe('getOrRegisterJudge — 빈 캐시', () => {
  test('createJudgeCache()로 만든 빈 캐시는 어떤 키도 찾지 못한다', () => {
    const cache = createJudgeCache()
    const keys = ['a:m', 'b:m', 'sha256hash:claude-3-5-haiku-20241022']
    for (const key of keys) {
      expect(() => getOrRegisterJudge(key, cache)).toThrow(JudgeCacheMissError)
    }
  })
})

// ─── 6. 여러 키 등록 → 각각 정확한 판정 반환 ────────────────────────────────

describe('getOrRegisterJudge — 여러 키 등록', () => {
  test('두 개의 키가 각자 올바른 판정을 반환한다', () => {
    const keyA = 'hash-a:claude-3-5-haiku-20241022'
    const keyB = 'hash-b:claude-3-5-haiku-20241022'

    const cache = createJudgeCacheFrom([
      [keyA, VERDICT_THRASHING],
      [keyB, VERDICT_FALSE_SUCCESS],
    ])

    expect(getOrRegisterJudge(keyA, cache).kind).toBe('thrashing')
    expect(getOrRegisterJudge(keyB, cache).kind).toBe('false_success')
  })

  test('세 키 중 두 개만 등록 시 미등록 키는 JudgeCacheMissError를 던진다', () => {
    const cache = createJudgeCacheFrom([
      ['key1:model', VERDICT_THRASHING],
      ['key2:model', VERDICT_NONE],
    ])

    // 히트
    expect(() => getOrRegisterJudge('key1:model', cache)).not.toThrow()
    expect(() => getOrRegisterJudge('key2:model', cache)).not.toThrow()

    // 미스
    expect(() => getOrRegisterJudge('key3:model', cache)).toThrow(JudgeCacheMissError)
  })
})

// ─── 7. registerJudge — 불변성 보장 ─────────────────────────────────────────

describe('registerJudge — 불변성 (기존 캐시 변이 없음)', () => {
  test('registerJudge는 새 맵을 반환하고 기존 캐시를 변이하지 않는다', () => {
    const originalCache = createJudgeCacheFrom([['key1:m', VERDICT_THRASHING]])
    const newCache = registerJudge('key2:m', VERDICT_FALSE_SUCCESS, originalCache)

    // 원본에는 key2가 없다
    expect(() => getOrRegisterJudge('key2:m', originalCache)).toThrow(JudgeCacheMissError)

    // 새 캐시에는 key2가 있다
    expect(getOrRegisterJudge('key2:m', newCache).kind).toBe('false_success')

    // 새 캐시에서도 key1을 조회할 수 있다 (기존 항목 유지)
    expect(getOrRegisterJudge('key1:m', newCache).kind).toBe('thrashing')
  })

  test('registerJudge로 생성한 캐시와 원본 캐시는 독립적이다', () => {
    const cache1 = createJudgeCache()
    const cache2 = registerJudge('k:m', VERDICT_NONE, cache1)

    expect(cache1.size).toBe(0)
    expect(cache2.size).toBe(1)
  })

  test('여러 번 registerJudge를 연쇄해도 각 단계의 이전 캐시는 영향 없다', () => {
    const c0 = createJudgeCache()
    const c1 = registerJudge('key1:m', VERDICT_THRASHING, c0)
    const c2 = registerJudge('key2:m', VERDICT_FALSE_SUCCESS, c1)
    const c3 = registerJudge('key3:m', VERDICT_NONE, c2)

    expect(c0.size).toBe(0)
    expect(c1.size).toBe(1)
    expect(c2.size).toBe(2)
    expect(c3.size).toBe(3)

    expect(() => getOrRegisterJudge('key3:m', c1)).toThrow(JudgeCacheMissError)
    expect(getOrRegisterJudge('key3:m', c3).kind).toBe('none')
  })
})

// ─── 8. createJudgeCacheFrom — 초기 항목 생성 ────────────────────────────────

describe('createJudgeCacheFrom — 초기 항목으로 캐시 생성', () => {
  test('빈 배열로 생성하면 빈 캐시가 된다', () => {
    const cache = createJudgeCacheFrom([])
    expect(cache.size).toBe(0)
  })

  test('초기 항목으로 생성된 캐시는 해당 키를 조회할 수 있다', () => {
    const cache = createJudgeCacheFrom([['abc:model', VERDICT_THRASHING]])
    expect(getOrRegisterJudge('abc:model', cache)).toEqual(VERDICT_THRASHING)
  })

  test('여러 초기 항목 모두 정상 조회된다', () => {
    const entries: Array<readonly [string, JudgeVerdict]> = [
      ['k1:m', VERDICT_THRASHING],
      ['k2:m', VERDICT_FALSE_SUCCESS],
      ['k3:m', VERDICT_NONE],
    ]
    const cache = createJudgeCacheFrom(entries)
    expect(cache.size).toBe(3)
    expect(getOrRegisterJudge('k1:m', cache).kind).toBe('thrashing')
    expect(getOrRegisterJudge('k2:m', cache).kind).toBe('false_success')
    expect(getOrRegisterJudge('k3:m', cache).kind).toBe('none')
  })
})

// ─── 9. buildCacheKey와 연동 — sha256 기반 캐시 키 조회 ──────────────────────

describe('getOrRegisterJudge + buildCacheKey 연동 (SPEC §1 표준 e)', () => {
  const MODEL_ID = 'claude-3-5-haiku-20241022'
  const PROMPT = 'system: rubric\nuser: is this thrashing?'

  test('buildCacheKey로 생성한 키로 등록한 후 동일 키로 조회하면 히트한다', () => {
    const key = buildCacheKey(PROMPT, MODEL_ID)
    const cache = createJudgeCacheFrom([[key, VERDICT_THRASHING]])
    const result = getOrRegisterJudge(key, cache)
    expect(result).toEqual(VERDICT_THRASHING)
  })

  test('buildCacheKey로 생성한 키가 다른 prompt면 미스가 발생한다', () => {
    const key = buildCacheKey(PROMPT, MODEL_ID)
    const cache = createJudgeCacheFrom([[key, VERDICT_THRASHING]])

    const otherKey = buildCacheKey('different prompt', MODEL_ID)
    expect(otherKey).not.toBe(key)
    expect(() => getOrRegisterJudge(otherKey, cache)).toThrow(JudgeCacheMissError)
  })

  test('동일 prompt라도 다른 modelId면 미스가 발생한다 (모델별 캐시 분리)', () => {
    const keyA = buildCacheKey(PROMPT, 'claude-3-5-haiku-20241022')
    const cache = createJudgeCacheFrom([[keyA, VERDICT_THRASHING]])

    const keyB = buildCacheKey(PROMPT, 'claude-3-5-sonnet-20241022')
    expect(keyB).not.toBe(keyA)
    expect(() => getOrRegisterJudge(keyB, cache)).toThrow(JudgeCacheMissError)
  })

  test('SPEC §1 (e): sha256(prompt)+":"+judgeModelId 형식의 캐시 키가 올바르게 조회된다', () => {
    const prompt = 'Rubric: is this a false success?'
    const judgeModelId = 'claude-3-5-haiku-20241022'
    const cacheKey = buildCacheKey(prompt, judgeModelId)

    const cache = createJudgeCacheFrom([[cacheKey, VERDICT_FALSE_SUCCESS]])
    const retrieved = getOrRegisterJudge(cacheKey, cache)

    expect(retrieved.kind).toBe('false_success')
    // 키 형식 검증: sha256 hex (64자) + ':' + modelId
    expect(cacheKey).toMatch(/^[0-9a-f]{64}:claude-3-5-haiku-20241022$/)
  })
})
