/**
 * tests/cache-key-sub-ac-6a.test.ts
 *
 * Sub-AC 6a: cache_key 생성 함수 단위 테스트
 *
 * 검증 항목:
 *   1. 동일 입력(payload, modelId) → 동일 키 반환 (결정론)
 *   2. 다른 payload → 다른 키
 *   3. 다른 modelId → 다른 키
 *   4. 형식 검증: `${64자 hex}:${modelId}` (sha256 hex = 64자)
 *   5. payload가 빈 문자열이어도 동작
 *   6. modelId에 콜론이 포함되어도 키 파싱 가능 (구분자는 첫 번째 ':')
 */

import { buildCacheKey, sha256Hex } from '../src/api/cache-key.js'
import { createHash } from 'node:crypto'

// ── 1. 결정론: 동일 입력 → 동일 키 ──────────────────────────────────────────

describe('buildCacheKey — 결정론 (동일 입력 → 동일 키)', () => {
  test('동일 payload와 modelId를 두 번 호출하면 동일 키를 반환한다', () => {
    const k1 = buildCacheKey('hello world', 'voyage-3-lite')
    const k2 = buildCacheKey('hello world', 'voyage-3-lite')
    expect(k1).toBe(k2)
  })

  test('다른 호출 순서에서도 동일 입력이면 동일 키를 반환한다', () => {
    const payload = 'Edit /foo/bar.ts line 42'
    const model = 'text-embedding-3-small'
    const k1 = buildCacheKey(payload, model)
    const k2 = buildCacheKey(payload, model)
    expect(k1).toStrictEqual(k2)
  })

  test('judge 캐시 키도 동일 프롬프트·모델에서 결정론으로 동작한다', () => {
    const prompt = 'Did the agent approve its own result?'
    const model = 'claude-3-5-haiku-20241022'
    expect(buildCacheKey(prompt, model)).toBe(buildCacheKey(prompt, model))
  })
})

// ── 2. 다른 payload → 다른 키 ────────────────────────────────────────────────

describe('buildCacheKey — 다른 payload → 다른 키', () => {
  const MODEL = 'voyage-3-lite'

  test('payload "a"와 "b"는 서로 다른 키를 생성한다', () => {
    expect(buildCacheKey('a', MODEL)).not.toBe(buildCacheKey('b', MODEL))
  })

  test('payload "hello"와 "HELLO"(대소문자 차이)는 서로 다른 키를 생성한다', () => {
    expect(buildCacheKey('hello', MODEL)).not.toBe(buildCacheKey('HELLO', MODEL))
  })

  test('공백 차이가 있는 payload는 서로 다른 키를 생성한다', () => {
    expect(buildCacheKey('ab', MODEL)).not.toBe(buildCacheKey('a b', MODEL))
  })

  test('긴 payload들도 서로 다른 키를 생성한다', () => {
    const p1 = 'Edit /path/to/file.ts — write content A'
    const p2 = 'Edit /path/to/file.ts — write content B'
    expect(buildCacheKey(p1, MODEL)).not.toBe(buildCacheKey(p2, MODEL))
  })
})

// ── 3. 다른 modelId → 다른 키 ────────────────────────────────────────────────

describe('buildCacheKey — 다른 modelId → 다른 키', () => {
  const PAYLOAD = 'identical payload text'

  test('modelId "voyage-3-lite"와 "voyage-3"는 서로 다른 키를 생성한다', () => {
    expect(buildCacheKey(PAYLOAD, 'voyage-3-lite')).not.toBe(
      buildCacheKey(PAYLOAD, 'voyage-3')
    )
  })

  test('modelId "voyage-3-lite"와 "text-embedding-3-small"은 서로 다른 키를 생성한다', () => {
    expect(buildCacheKey(PAYLOAD, 'voyage-3-lite')).not.toBe(
      buildCacheKey(PAYLOAD, 'text-embedding-3-small')
    )
  })

  test('동일 payload라도 embed모델·judge모델은 서로 다른 키를 생성한다', () => {
    expect(buildCacheKey(PAYLOAD, 'voyage-3-lite')).not.toBe(
      buildCacheKey(PAYLOAD, 'claude-3-5-haiku-20241022')
    )
  })
})

// ── 4. 형식 검증: `${64자 hex}:${modelId}` ───────────────────────────────────

describe('buildCacheKey — 형식 검증', () => {
  test('반환값이 문자열이다', () => {
    expect(typeof buildCacheKey('payload', 'model')).toBe('string')
  })

  test('반환값이 콜론(:)을 포함한다', () => {
    expect(buildCacheKey('payload', 'model')).toContain(':')
  })

  test('콜론 앞 부분이 64자 소문자 hex 문자열이다 (sha256)', () => {
    const key = buildCacheKey('some text', 'voyage-3-lite')
    const colonIdx = key.indexOf(':')
    const hexPart = key.slice(0, colonIdx)
    expect(hexPart).toHaveLength(64)
    expect(hexPart).toMatch(/^[0-9a-f]{64}$/)
  })

  test('콜론 뒤 부분이 그대로 modelId이다', () => {
    const modelId = 'voyage-3-lite'
    const key = buildCacheKey('some text', modelId)
    const colonIdx = key.indexOf(':')
    expect(key.slice(colonIdx + 1)).toBe(modelId)
  })

  test('hex 부분이 실제 sha256 결과와 일치한다', () => {
    const payload = 'verify sha256 correctness'
    const expected = createHash('sha256').update(payload, 'utf8').digest('hex')
    const key = buildCacheKey(payload, 'any-model')
    expect(key.startsWith(expected + ':')).toBe(true)
  })

  test('전체 형식이 `{64자hex}:{modelId}` 패턴이다', () => {
    const key = buildCacheKey('test payload', 'claude-3-5-haiku-20241022')
    expect(key).toMatch(/^[0-9a-f]{64}:claude-3-5-haiku-20241022$/)
  })

  test('sha256Hex가 64자 소문자 hex를 반환한다', () => {
    const h = sha256Hex('anything')
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── 5. 빈 문자열 payload ──────────────────────────────────────────────────────

describe('buildCacheKey — 빈 문자열 처리', () => {
  test('payload가 빈 문자열이어도 유효한 키를 반환한다', () => {
    const key = buildCacheKey('', 'voyage-3-lite')
    expect(typeof key).toBe('string')
    expect(key).toContain(':')
    const colonIdx = key.indexOf(':')
    expect(key.slice(0, colonIdx)).toMatch(/^[0-9a-f]{64}$/)
  })

  test('빈 payload 키는 비어있지 않은 payload 키와 다르다', () => {
    expect(buildCacheKey('', 'model')).not.toBe(buildCacheKey('x', 'model'))
  })

  test('sha256Hex("")도 64자 hex를 반환한다', () => {
    const h = sha256Hex('')
    expect(h).toHaveLength(64)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── 6. SPEC §1 (e) 키 규칙 통합 검증 ────────────────────────────────────────

describe('buildCacheKey — SPEC §1 (e) 통합: embed & judge 캐시 키 규칙', () => {
  test('임베딩 캐시 키: sha256(text)+":"+embedModelId 형식을 따른다', () => {
    const text = 'Bash ls -la /tmp'
    const embedModelId = 'voyage-3-lite'
    const expectedHash = createHash('sha256').update(text, 'utf8').digest('hex')
    const key = buildCacheKey(text, embedModelId)
    expect(key).toBe(`${expectedHash}:${embedModelId}`)
  })

  test('judge 캐시 키: sha256(prompt)+":"+judgeModelId 형식을 따른다', () => {
    const prompt = 'Assess whether the agent has approved its own work.'
    const judgeModelId = 'claude-3-5-haiku-20241022'
    const expectedHash = createHash('sha256').update(prompt, 'utf8').digest('hex')
    const key = buildCacheKey(prompt, judgeModelId)
    expect(key).toBe(`${expectedHash}:${judgeModelId}`)
  })

  test('같은 텍스트라도 embed·judge 모델이 다르면 키가 다르다 (분리 보장)', () => {
    const text = 'shared input text'
    const embedKey = buildCacheKey(text, 'voyage-3-lite')
    const judgeKey = buildCacheKey(text, 'claude-3-5-haiku-20241022')
    expect(embedKey).not.toBe(judgeKey)
  })
})
