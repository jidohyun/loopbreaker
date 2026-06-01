/**
 * mock-embed-client.test.ts
 *
 * Sub-AC 2: MockEmbedClient 단위 테스트
 *
 * 검증 항목:
 *   - 동일 입력 → 동일 벡터 (결정론)
 *   - 벡터 차원 상수 (모든 결과가 dim 길이)
 *   - 텍스트 수 == 반환 벡터 수
 *   - 캐시 미스 → EmbedClientError (조용한 폴백 금지)
 *   - 빈 배열 입력 → 빈 배열 반환
 *   - MockEmbedClientWithHashKey: sha256 키 기반 결정론
 *   - sha256Text 유틸리티
 *
 * 외부 API 절대 미호출 — 네트워크·API 키 불필요.
 */

import {
  MockEmbedClient,
  MockEmbedClientWithHashKey,
  EmbedClientError,
  sha256Text,
  type MockEmbedEntry,
} from '../src/api/embed-client.js'

// ── 공통 픽스처 ───────────────────────────────────────────────────────────────

const DIM = 4

const ENTRIES: MockEmbedEntry[] = [
  { text: 'hello', vector: [0.1, 0.2, 0.3, 0.4] },
  { text: 'world', vector: [0.5, 0.6, 0.7, 0.8] },
  { text: 'foo',   vector: [1.0, 0.0, 0.0, 0.0] },
]

// ── MockEmbedClient ───────────────────────────────────────────────────────────

describe('MockEmbedClient', () => {
  const client = new MockEmbedClient(ENTRIES, DIM)

  // ── 결정론: 동일 입력 → 동일 벡터 ──────────────────────────────────────────

  test('identical inputs return identical vectors', async () => {
    const first = await client.embed(['hello'])
    const second = await client.embed(['hello'])

    expect(first).toEqual(second)
    expect(first[0]).toEqual([0.1, 0.2, 0.3, 0.4])
  })

  test('identical inputs return identical vectors across multiple calls', async () => {
    const calls = await Promise.all([
      client.embed(['world']),
      client.embed(['world']),
      client.embed(['world']),
    ])
    for (const result of calls) {
      expect(result[0]).toEqual([0.5, 0.6, 0.7, 0.8])
    }
  })

  // ── 차원 상수 ────────────────────────────────────────────────────────────────

  test('vector dimensionality is constant (equals dim)', async () => {
    const result = await client.embed(['hello', 'world', 'foo'])
    for (const vec of result) {
      expect(vec).toHaveLength(DIM)
    }
  })

  test('dim getter returns the configured dimension', () => {
    expect(client.dim).toBe(DIM)
  })

  // ── 텍스트 수 == 반환 벡터 수 ────────────────────────────────────────────────

  test('multiple texts return one vector per text', async () => {
    const texts = ['hello', 'world', 'foo']
    const result = await client.embed(texts)

    expect(result).toHaveLength(texts.length)
    expect(result[0]).toEqual(ENTRIES[0].vector)
    expect(result[1]).toEqual(ENTRIES[1].vector)
    expect(result[2]).toEqual(ENTRIES[2].vector)
  })

  test('single text returns exactly one vector', async () => {
    const result = await client.embed(['foo'])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual([1.0, 0.0, 0.0, 0.0])
  })

  // ── 빈 배열 ─────────────────────────────────────────────────────────────────

  test('empty input returns empty array', async () => {
    const result = await client.embed([])
    expect(result).toEqual([])
    expect(result).toHaveLength(0)
  })

  // ── 캐시 미스 → EmbedClientError ─────────────────────────────────────────────

  test('cache miss throws EmbedClientError (no silent fallback)', async () => {
    await expect(client.embed(['not-registered'])).rejects.toThrow(EmbedClientError)
  })

  test('cache miss error message contains the missing text', async () => {
    await expect(client.embed(['missing-text'])).rejects.toThrow('missing-text')
  })

  test('EmbedClientError has correct name', async () => {
    let caught: unknown
    try {
      await client.embed(['unregistered'])
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EmbedClientError)
    expect((caught as EmbedClientError).name).toBe('EmbedClientError')
  })

  // ── 불변성: 반환된 벡터 변조가 내부 상태에 영향을 주지 않음 ────────────────

  test('returned vectors are copies (mutation does not affect internal state)', async () => {
    const [vec] = await client.embed(['hello'])
    vec[0] = 9999

    const [fresh] = await client.embed(['hello'])
    expect(fresh[0]).toBeCloseTo(0.1)
  })

  // ── 생성자 검증 ──────────────────────────────────────────────────────────────

  test('constructor throws if vector length does not match dim', () => {
    expect(() =>
      new MockEmbedClient([{ text: 'bad', vector: [1, 2, 3] }], DIM)
    ).toThrow(TypeError)
  })

  test('constructor throws if dim is zero', () => {
    expect(() => new MockEmbedClient([], 0)).toThrow(TypeError)
  })

  test('constructor throws if dim is negative', () => {
    expect(() => new MockEmbedClient([], -1)).toThrow(TypeError)
  })

  test('constructor accepts empty entries with valid dim', () => {
    expect(() => new MockEmbedClient([], DIM)).not.toThrow()
  })

  // ── register (불변 헬퍼) ─────────────────────────────────────────────────────

  test('register returns new client with additional entry', async () => {
    const extended = client.register({
      text: 'new-text',
      vector: [0.9, 0.8, 0.7, 0.6],
    })

    const result = await extended.embed(['new-text'])
    expect(result[0]).toEqual([0.9, 0.8, 0.7, 0.6])
  })

  test('register does not mutate the original client', async () => {
    client.register({ text: 'another', vector: [0.1, 0.2, 0.3, 0.4] })

    await expect(client.embed(['another'])).rejects.toThrow(EmbedClientError)
  })
})

// ── MockEmbedClientWithHashKey ────────────────────────────────────────────────

describe('MockEmbedClientWithHashKey', () => {
  const MODEL_ID = 'voyage-3-lite'
  const DIM_H = 3

  const helloKey = `${sha256Text('alpha')}:${MODEL_ID}`
  const betaKey  = `${sha256Text('beta')}:${MODEL_ID}`

  const client = new MockEmbedClientWithHashKey(
    [
      { cacheKey: helloKey, vector: [0.1, 0.2, 0.3] },
      { cacheKey: betaKey,  vector: [0.4, 0.5, 0.6] },
    ],
    DIM_H,
    MODEL_ID,
  )

  test('identical inputs return identical vectors', async () => {
    const a = await client.embed(['alpha'])
    const b = await client.embed(['alpha'])
    expect(a).toEqual(b)
  })

  test('vector dimensionality is constant', async () => {
    const result = await client.embed(['alpha', 'beta'])
    for (const vec of result) {
      expect(vec).toHaveLength(DIM_H)
    }
  })

  test('multiple texts return one vector per text', async () => {
    const result = await client.embed(['alpha', 'beta'])
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([0.1, 0.2, 0.3])
    expect(result[1]).toEqual([0.4, 0.5, 0.6])
  })

  test('empty input returns empty array', async () => {
    const result = await client.embed([])
    expect(result).toEqual([])
  })

  test('cache miss throws EmbedClientError', async () => {
    await expect(client.embed(['not-registered'])).rejects.toThrow(EmbedClientError)
  })

  test('constructor throws if vector length does not match dim', () => {
    expect(() =>
      new MockEmbedClientWithHashKey(
        [{ cacheKey: 'anykey', vector: [1, 2] }],
        DIM_H,
        MODEL_ID,
      )
    ).toThrow(TypeError)
  })
})

// ── sha256Text 유틸리티 ───────────────────────────────────────────────────────

describe('sha256Text', () => {
  test('returns a 64-character hex string', () => {
    const hash = sha256Text('hello')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]+$/)
  })

  test('same input produces same hash (deterministic)', () => {
    expect(sha256Text('test')).toBe(sha256Text('test'))
  })

  test('different inputs produce different hashes', () => {
    expect(sha256Text('aaa')).not.toBe(sha256Text('bbb'))
  })

  test('empty string produces a valid hash', () => {
    const hash = sha256Text('')
    expect(hash).toHaveLength(64)
  })
})
