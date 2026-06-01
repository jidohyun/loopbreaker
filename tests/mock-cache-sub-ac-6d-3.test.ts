/**
 * tests/mock-cache-sub-ac-6d-3.test.ts
 *
 * Sub-AC 6d-3: 인메모리 mock_cache 미등록 키 CacheMissError 테스트
 *
 * 검증 항목:
 *   - 등록하지 않은 키로 임베딩 캐시를 조회할 때 CacheMissError가 발생한다
 *   - 등록하지 않은 키로 judge 캐시를 조회할 때 JudgeCacheMissError가 발생한다
 *   - 조용한 폴백(silent fallback, undefined/null 반환) 절대 금지
 *   - CacheMissError/JudgeCacheMissError는 Error 서브클래스
 *   - cacheKey 필드에 실패한 키가 기록된다
 *   - 빈 캐시와 부분 등록 캐시 모두 미등록 키에 대해 예외를 던진다
 *
 * 외부 API 절대 미호출 — 네트워크·API 키 불필요.
 * SPEC §1 표준 (e): cacheKey = sha256(payload)+':'+modelId
 */

import {
  CacheMissError,
  createEmbeddingCache,
  createEmbeddingCacheFrom,
  getOrRegisterEmbedding,
  registerEmbedding,
  type EmbeddingVector,
} from '../src/api/embedding-cache.js'

import {
  JudgeCacheMissError,
  createJudgeCache,
  createJudgeCacheFrom,
  getOrRegisterJudge,
  registerJudge,
  type JudgeVerdict,
} from '../src/api/judge-cache.js'

import { buildCacheKey } from '../src/api/cache-key.js'

// ─── 공통 픽스처 ─────────────────────────────────────────────────────────────

const EMBED_MODEL = 'voyage-3-lite'
const JUDGE_MODEL = 'claude-3-5-haiku-20241022'

const SAMPLE_VERDICT: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'repeat',
  confidence: 0.9,
  reason: 'loop detected',
  rawSamples: ['raw-sample-1'],
}

const SAMPLE_VECTOR: EmbeddingVector = [0.1, 0.2, 0.3, 0.4]

// ─── 임베딩 캐시: 미등록 키 → CacheMissError ─────────────────────────────────

describe('인메모리 임베딩 mock_cache — 미등록 키 CacheMissError (Sub-AC 6d-3)', () => {
  // ── 빈 캐시에서 모든 조회가 CacheMissError ──────────────────────────────────

  test('빈 캐시(createEmbeddingCache)에서 임의 키 조회 시 CacheMissError를 던진다', () => {
    const cache = createEmbeddingCache()
    const unregistered = buildCacheKey('unregistered-text', EMBED_MODEL)

    expect(() => getOrRegisterEmbedding(unregistered, cache)).toThrow(CacheMissError)
  })

  test('빈 캐시에서 조용한 폴백(undefined/null 반환)이 없음을 확인한다', () => {
    const cache = createEmbeddingCache()
    let thrown = false
    try {
      getOrRegisterEmbedding('some-key:model', cache)
    } catch {
      thrown = true
    }
    expect(thrown).toBe(true)
  })

  // ── 부분 등록 캐시: 등록된 키는 히트, 미등록 키는 CacheMissError ──────────

  test('부분 등록 캐시에서 미등록 키 조회 시 CacheMissError를 던진다', () => {
    const registeredKey = buildCacheKey('registered-text', EMBED_MODEL)
    const cache = createEmbeddingCacheFrom([[registeredKey, SAMPLE_VECTOR]])
    const unregisteredKey = buildCacheKey('not-registered', EMBED_MODEL)

    // 등록된 키는 히트
    expect(() => getOrRegisterEmbedding(registeredKey, cache)).not.toThrow()

    // 미등록 키는 CacheMissError
    expect(() => getOrRegisterEmbedding(unregisteredKey, cache)).toThrow(CacheMissError)
  })

  test('등록된 텍스트와 다른 텍스트의 키는 CacheMissError를 던진다', () => {
    const keyA = buildCacheKey('text-A', EMBED_MODEL)
    const keyB = buildCacheKey('text-B', EMBED_MODEL)
    const cache = createEmbeddingCacheFrom([[keyA, [1.0, 0.0]]])

    expect(() => getOrRegisterEmbedding(keyB, cache)).toThrow(CacheMissError)
  })

  test('같은 텍스트라도 다른 모델 ID의 키는 CacheMissError를 던진다 (모델별 캐시 분리)', () => {
    const keyVoyage = buildCacheKey('hello', 'voyage-3-lite')
    const keyOpenAI = buildCacheKey('hello', 'text-embedding-3-small')
    const cache = createEmbeddingCacheFrom([[keyVoyage, [0.5, 0.5]]])

    // 같은 텍스트지만 다른 모델 → 미스
    expect(() => getOrRegisterEmbedding(keyOpenAI, cache)).toThrow(CacheMissError)
  })

  // ── CacheMissError 인스턴스 검증 ─────────────────────────────────────────────

  test('CacheMissError는 Error 서브클래스이다', () => {
    const cache = createEmbeddingCache()
    expect(() => getOrRegisterEmbedding('any-key:model', cache)).toThrow(Error)
  })

  test('CacheMissError.name이 "CacheMissError"이다', () => {
    const cache = createEmbeddingCache()
    const failKey = 'deadbeef:voyage-3-lite'
    let caught: unknown
    try {
      getOrRegisterEmbedding(failKey, cache)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CacheMissError)
    expect((caught as CacheMissError).name).toBe('CacheMissError')
  })

  test('CacheMissError.cacheKey에 조회 실패한 키가 기록된다', () => {
    const cache = createEmbeddingCache()
    const failKey = buildCacheKey('missing-payload', EMBED_MODEL)
    let caught: unknown
    try {
      getOrRegisterEmbedding(failKey, cache)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(CacheMissError)
    expect((caught as CacheMissError).cacheKey).toBe(failKey)
  })

  test('CacheMissError.message에 실패한 키 정보가 포함된다', () => {
    const cache = createEmbeddingCache()
    const failKey = 'specific-missing-key:voyage-3-lite'
    let caught: unknown
    try {
      getOrRegisterEmbedding(failKey, cache)
    } catch (err) {
      caught = err
    }
    expect((caught as CacheMissError).message).toContain(failKey)
  })

  // ── registerEmbedding 후 원본 캐시는 여전히 미등록 키에 CacheMissError ──────

  test('registerEmbedding 후 원본 캐시는 변이되지 않아 새 키 조회 시 CacheMissError를 던진다', () => {
    const originalKey = buildCacheKey('original', EMBED_MODEL)
    const newKey = buildCacheKey('new-entry', EMBED_MODEL)

    const originalCache = createEmbeddingCacheFrom([[originalKey, [0.1, 0.9]]])
    registerEmbedding(newKey, [0.5, 0.5], originalCache)

    // 원본 캐시는 변이 없으므로 newKey 조회 시 CacheMissError
    expect(() => getOrRegisterEmbedding(newKey, originalCache)).toThrow(CacheMissError)
  })

  // ── 여러 미등록 키 모두 CacheMissError ──────────────────────────────────────

  test('여러 미등록 키 모두 CacheMissError를 발생시킨다', () => {
    const cache = createEmbeddingCache()
    const unregisteredKeys = [
      'sha256hash-a:voyage-3-lite',
      'sha256hash-b:voyage-3-lite',
      'sha256hash-c:text-embedding-3-small',
    ]

    for (const key of unregisteredKeys) {
      expect(() => getOrRegisterEmbedding(key, cache)).toThrow(CacheMissError)
    }
  })
})

// ─── judge 캐시: 미등록 키 → JudgeCacheMissError ─────────────────────────────

describe('인메모리 judge mock_cache — 미등록 키 JudgeCacheMissError (Sub-AC 6d-3)', () => {
  // ── 빈 캐시에서 모든 조회가 JudgeCacheMissError ──────────────────────────────

  test('빈 캐시(createJudgeCache)에서 임의 키 조회 시 JudgeCacheMissError를 던진다', () => {
    const cache = createJudgeCache()
    const unregistered = buildCacheKey('unregistered-prompt', JUDGE_MODEL)

    expect(() => getOrRegisterJudge(unregistered, cache)).toThrow(JudgeCacheMissError)
  })

  test('빈 캐시에서 조용한 폴백(undefined/null 반환)이 없음을 확인한다', () => {
    const cache = createJudgeCache()
    let thrown = false
    try {
      getOrRegisterJudge('some-key:model', cache)
    } catch {
      thrown = true
    }
    expect(thrown).toBe(true)
  })

  // ── 부분 등록 캐시: 등록된 키는 히트, 미등록 키는 JudgeCacheMissError ───────

  test('부분 등록 캐시에서 미등록 키 조회 시 JudgeCacheMissError를 던진다', () => {
    const registeredKey = buildCacheKey('registered-prompt', JUDGE_MODEL)
    const cache = createJudgeCacheFrom([[registeredKey, SAMPLE_VERDICT]])
    const unregisteredKey = buildCacheKey('not-registered-prompt', JUDGE_MODEL)

    // 등록된 키는 히트
    expect(() => getOrRegisterJudge(registeredKey, cache)).not.toThrow()

    // 미등록 키는 JudgeCacheMissError
    expect(() => getOrRegisterJudge(unregisteredKey, cache)).toThrow(JudgeCacheMissError)
  })

  test('같은 프롬프트라도 다른 모델 ID의 키는 JudgeCacheMissError를 던진다 (모델별 캐시 분리)', () => {
    const promptText = 'system: rubric\nuser: is this thrashing?'
    const keyHaiku = buildCacheKey(promptText, 'claude-3-5-haiku-20241022')
    const keySonnet = buildCacheKey(promptText, 'claude-3-5-sonnet-20241022')
    const cache = createJudgeCacheFrom([[keyHaiku, SAMPLE_VERDICT]])

    // 같은 프롬프트지만 다른 모델 → 미스
    expect(() => getOrRegisterJudge(keySonnet, cache)).toThrow(JudgeCacheMissError)
  })

  // ── JudgeCacheMissError 인스턴스 검증 ────────────────────────────────────────

  test('JudgeCacheMissError는 Error 서브클래스이다', () => {
    const cache = createJudgeCache()
    expect(() => getOrRegisterJudge('any-key:model', cache)).toThrow(Error)
  })

  test('JudgeCacheMissError.name이 "JudgeCacheMissError"이다', () => {
    const cache = createJudgeCache()
    const failKey = 'deadbeef:claude-3-5-haiku-20241022'
    let caught: unknown
    try {
      getOrRegisterJudge(failKey, cache)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(JudgeCacheMissError)
    expect((caught as JudgeCacheMissError).name).toBe('JudgeCacheMissError')
  })

  test('JudgeCacheMissError.cacheKey에 조회 실패한 키가 기록된다', () => {
    const cache = createJudgeCache()
    const failKey = buildCacheKey('missing-prompt', JUDGE_MODEL)
    let caught: unknown
    try {
      getOrRegisterJudge(failKey, cache)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(JudgeCacheMissError)
    expect((caught as JudgeCacheMissError).cacheKey).toBe(failKey)
  })

  test('JudgeCacheMissError.message에 실패한 키 정보가 포함된다', () => {
    const cache = createJudgeCache()
    const failKey = 'specific-missing-judge-key:claude-3-5-haiku-20241022'
    let caught: unknown
    try {
      getOrRegisterJudge(failKey, cache)
    } catch (err) {
      caught = err
    }
    expect((caught as JudgeCacheMissError).message).toContain(failKey)
  })

  // ── registerJudge 후 원본 캐시는 여전히 미등록 키에 JudgeCacheMissError ──────

  test('registerJudge 후 원본 캐시는 변이되지 않아 새 키 조회 시 JudgeCacheMissError를 던진다', () => {
    const originalKey = buildCacheKey('original-prompt', JUDGE_MODEL)
    const newKey = buildCacheKey('new-prompt', JUDGE_MODEL)

    const originalCache = createJudgeCacheFrom([[originalKey, SAMPLE_VERDICT]])
    registerJudge(newKey, { ...SAMPLE_VERDICT, kind: 'none' }, originalCache)

    // 원본 캐시는 변이 없으므로 newKey 조회 시 JudgeCacheMissError
    expect(() => getOrRegisterJudge(newKey, originalCache)).toThrow(JudgeCacheMissError)
  })

  // ── 여러 미등록 키 모두 JudgeCacheMissError ───────────────────────────────────

  test('여러 미등록 키 모두 JudgeCacheMissError를 발생시킨다', () => {
    const cache = createJudgeCache()
    const unregisteredKeys = [
      'sha256hash-a:claude-3-5-haiku-20241022',
      'sha256hash-b:claude-3-5-haiku-20241022',
      'sha256hash-c:claude-3-5-sonnet-20241022',
    ]

    for (const key of unregisteredKeys) {
      expect(() => getOrRegisterJudge(key, cache)).toThrow(JudgeCacheMissError)
    }
  })
})

// ─── 통합: 임베딩+judge 캐시 동시 미등록 키 검증 (SPEC §1 표준 e) ──────────────

describe('임베딩+judge mock_cache 통합 — 동일 buildCacheKey 규칙으로 미등록 키 CacheMissError (Sub-AC 6d-3)', () => {
  test('buildCacheKey 규칙이 임베딩·judge 양쪽에 동일하게 적용되며, 미등록 키는 각각 해당 오류를 던진다', () => {
    const payload = 'shared-payload-text'

    const embedKey = buildCacheKey(payload, EMBED_MODEL)
    const judgeKey = buildCacheKey(payload, JUDGE_MODEL)

    const embedCache = createEmbeddingCache()
    const judgeCache = createJudgeCache()

    // 두 캐시 모두 미등록 → 각각 CacheMissError, JudgeCacheMissError
    expect(() => getOrRegisterEmbedding(embedKey, embedCache)).toThrow(CacheMissError)
    expect(() => getOrRegisterJudge(judgeKey, judgeCache)).toThrow(JudgeCacheMissError)

    // 임베딩만 등록 후, judge 캐시는 여전히 미등록
    const embedCacheWithEntry = createEmbeddingCacheFrom([[embedKey, [0.5, 0.5]]])
    expect(() => getOrRegisterEmbedding(embedKey, embedCacheWithEntry)).not.toThrow()
    expect(() => getOrRegisterJudge(judgeKey, judgeCache)).toThrow(JudgeCacheMissError)
  })

  test('캐시 키 형식(sha256 hex 64자 + ":" + modelId)이 올바르게 생성된다', () => {
    const embedKey = buildCacheKey('sample-text', EMBED_MODEL)
    const judgeKey = buildCacheKey('sample-prompt', JUDGE_MODEL)

    // sha256 hex (64자) + ':' + modelId 형식 검증
    expect(embedKey).toMatch(/^[0-9a-f]{64}:voyage-3-lite$/)
    expect(judgeKey).toMatch(/^[0-9a-f]{64}:claude-3-5-haiku-20241022$/)

    // 미등록이므로 CacheMissError / JudgeCacheMissError 발생
    const embedCache = createEmbeddingCache()
    const judgeCache = createJudgeCache()
    expect(() => getOrRegisterEmbedding(embedKey, embedCache)).toThrow(CacheMissError)
    expect(() => getOrRegisterJudge(judgeKey, judgeCache)).toThrow(JudgeCacheMissError)
  })
})
