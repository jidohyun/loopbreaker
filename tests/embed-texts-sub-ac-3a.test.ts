/**
 * tests/embed-texts-sub-ac-3a.test.ts
 *
 * Sub-AC 3a: embedTexts(texts: string[]) 단위 테스트
 *
 * 검증 항목:
 *   1. 입력 텍스트 배열에 대해 동일 개수의 벡터를 반환한다
 *   2. 모든 반환 벡터가 동일 차원(dim)을 가진다
 *   3. 빈 배열 입력 → 빈 배열 반환 (client.embed 미호출)
 *   4. 단일 텍스트 → 길이 1 벡터 배열
 *   5. 복수 텍스트 → 입력 순서와 동일한 벡터 순서
 *   6. 캐시 미스 → EmbedClientError throw (조용한 폴백 금지)
 *   7. 불변성: 반환 벡터 변조가 내부 상태에 영향을 주지 않음
 *   8. 외부 API 절대 미호출 — 네트워크·API 키 불필요
 *
 * 제약:
 *   - 모든 테스트는 MockEmbedClient로만 동작 (네트워크·API 키 불필요)
 *   - 결정론: 동일 입력 → 항상 동일 벡터
 */

import { embedTexts } from '../src/detect/semantic-stage.js'
import {
  MockEmbedClient,
  EmbedClientError,
  type MockEmbedEntry,
} from '../src/api/embed-client.js'

// ── 공통 픽스처 ────────────────────────────────────────────────────────────────

const DIM = 4

const ENTRIES: MockEmbedEntry[] = [
  { text: 'hello world',  vector: [0.1, 0.2, 0.3, 0.4] },
  { text: 'foo bar',      vector: [0.5, 0.6, 0.7, 0.8] },
  { text: 'baz qux',      vector: [0.9, 0.0, 0.1, 0.2] },
]

describe('embedTexts (Sub-AC 3a)', () => {
  const client = new MockEmbedClient(ENTRIES, DIM)

  // ── 1. 반환 벡터 수 == 입력 텍스트 수 ────────────────────────────────────────

  it('returns exactly one vector per input text (3 texts → 3 vectors)', async () => {
    const texts = ['hello world', 'foo bar', 'baz qux']
    const result = await embedTexts(client, texts)
    expect(result).toHaveLength(texts.length)
  })

  it('returns exactly one vector for single-text input', async () => {
    const result = await embedTexts(client, ['hello world'])
    expect(result).toHaveLength(1)
  })

  it('returns exactly two vectors for two-text input', async () => {
    const result = await embedTexts(client, ['hello world', 'foo bar'])
    expect(result).toHaveLength(2)
  })

  // ── 2. 모든 반환 벡터의 차원이 동일함 (dim) ───────────────────────────────────

  it('all returned vectors have the same dimension (dim)', async () => {
    const texts = ['hello world', 'foo bar', 'baz qux']
    const result = await embedTexts(client, texts)
    for (const vec of result) {
      expect(vec).toHaveLength(DIM)
    }
  })

  it('single vector has correct dimension', async () => {
    const result = await embedTexts(client, ['foo bar'])
    expect(result[0]).toHaveLength(DIM)
  })

  // ── 3. 빈 배열 입력 → 빈 배열 반환 ──────────────────────────────────────────

  it('returns empty array for empty text input', async () => {
    const result = await embedTexts(client, [])
    expect(result).toEqual([])
    expect(result).toHaveLength(0)
  })

  it('does not call client.embed for empty input', async () => {
    // MockEmbedClient에 등록되지 않은 빈 배열을 확인:
    // 빈 배열은 client.embed를 호출하지 않으므로 에러 없이 통과해야 함
    const emptyClient = new MockEmbedClient([], DIM)
    const result = await embedTexts(emptyClient, [])
    expect(result).toEqual([])
  })

  // ── 4. 결정론: 동일 입력 → 동일 벡터 ────────────────────────────────────────

  it('same input produces identical vectors (deterministic)', async () => {
    const first = await embedTexts(client, ['hello world'])
    const second = await embedTexts(client, ['hello world'])
    expect(first).toEqual(second)
  })

  it('deterministic across multiple parallel calls', async () => {
    const calls = await Promise.all([
      embedTexts(client, ['foo bar']),
      embedTexts(client, ['foo bar']),
      embedTexts(client, ['foo bar']),
    ])
    for (const result of calls) {
      expect(result[0]).toEqual([0.5, 0.6, 0.7, 0.8])
    }
  })

  // ── 5. 입력 순서와 동일한 벡터 순서 ─────────────────────────────────────────

  it('preserves input order in output vectors', async () => {
    const texts = ['hello world', 'foo bar', 'baz qux']
    const result = await embedTexts(client, texts)
    expect(result[0]).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(result[1]).toEqual([0.5, 0.6, 0.7, 0.8])
    expect(result[2]).toEqual([0.9, 0.0, 0.1, 0.2])
  })

  it('two texts in reverse order return vectors in corresponding order', async () => {
    const resultAB = await embedTexts(client, ['hello world', 'foo bar'])
    const resultBA = await embedTexts(client, ['foo bar', 'hello world'])
    expect(resultAB[0]).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(resultAB[1]).toEqual([0.5, 0.6, 0.7, 0.8])
    expect(resultBA[0]).toEqual([0.5, 0.6, 0.7, 0.8])
    expect(resultBA[1]).toEqual([0.1, 0.2, 0.3, 0.4])
  })

  // ── 6. 캐시 미스 → EmbedClientError (조용한 폴백 금지) ───────────────────────

  it('throws EmbedClientError for unregistered text (no silent fallback)', async () => {
    await expect(
      embedTexts(client, ['not-registered'])
    ).rejects.toThrow(EmbedClientError)
  })

  it('throws EmbedClientError with message containing missing text', async () => {
    await expect(
      embedTexts(client, ['unknown-text'])
    ).rejects.toThrow('unknown-text')
  })

  it('throws EmbedClientError even when mixed with valid texts', async () => {
    // One valid + one invalid → should throw
    await expect(
      embedTexts(client, ['hello world', 'not-registered'])
    ).rejects.toThrow(EmbedClientError)
  })

  // ── 7. 불변성: 반환 벡터 변조가 내부 상태에 영향을 주지 않음 ─────────────────

  it('mutating returned vector does not affect subsequent calls', async () => {
    const result = await embedTexts(client, ['hello world'])
    const vec = result[0]!
    // 반환 벡터 변조
    vec[0] = 9999

    // 다음 호출에서 원본 벡터가 유지되는지 확인
    const fresh = await embedTexts(client, ['hello world'])
    expect(fresh[0]![0]).toBeCloseTo(0.1)
  })

  // ── 8. 결과는 number[][] 타입 ─────────────────────────────────────────────────

  it('returns number[][] type with numeric elements', async () => {
    const result = await embedTexts(client, ['hello world', 'foo bar'])
    expect(Array.isArray(result)).toBe(true)
    for (const vec of result) {
      expect(Array.isArray(vec)).toBe(true)
      for (const val of vec) {
        expect(typeof val).toBe('number')
        expect(Number.isFinite(val)).toBe(true)
      }
    }
  })

  // ── 9. 다양한 dim 크기 ────────────────────────────────────────────────────────

  it('works with dim=1', async () => {
    const smallClient = new MockEmbedClient(
      [{ text: 'x', vector: [0.5] }],
      1,
    )
    const result = await embedTexts(smallClient, ['x'])
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveLength(1)
    expect(result[0]![0]).toBeCloseTo(0.5)
  })

  it('works with large dim=8', async () => {
    const largeClient = new MockEmbedClient(
      [{ text: 'big', vector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] }],
      8,
    )
    const result = await embedTexts(largeClient, ['big'])
    expect(result[0]).toHaveLength(8)
  })
})
