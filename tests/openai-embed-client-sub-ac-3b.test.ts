/**
 * openai-embed-client-sub-ac-3b.test.ts
 *
 * Sub-AC 3b: OpenAIEmbedClient 골격 단위 테스트.
 *
 * 검증 목적:
 *   1. OpenAIEmbedClient가 EmbedClient 인터페이스를 구현한다 (TypeScript 컴파일 검증).
 *   2. embed() 호출 시 NotImplementedError를 throw한다 (골격, 미활성화).
 *   3. 외부 네트워크 호출 없음 — NotImplementedError는 동기적으로 throw하므로
 *      네트워크 시도 자체가 없다.
 *
 * 제약:
 *   - 네트워크·API 키 절대 불필요.
 *   - jest.spyOn 등 네트워크 인터셉터 없이 결정론 동작.
 *   - MockEmbedClient는 이 테스트에서 사용하지 않음 (골격 클라이언트 자체를 검증).
 */

import { type EmbedClient } from '../src/api/embed-client.js'
import {
  OpenAIEmbedClient,
  NotImplementedError,
} from '../src/api/embed-client-providers.js'

describe('OpenAIEmbedClient (Sub-AC 3b)', () => {
  const modelId = 'text-embedding-3-small'

  // ── 컴파일 타임 검증 ───────────────────────────────────────────────────────

  test('OpenAIEmbedClient implements EmbedClient interface (TypeScript structural typing)', () => {
    const client: EmbedClient = new OpenAIEmbedClient(modelId)
    expect(client).toBeDefined()
  })

  // ── embed() → NotImplementedError ─────────────────────────────────────────

  test('embed() throws NotImplementedError without making any network call', async () => {
    const client = new OpenAIEmbedClient(modelId)

    await expect(client.embed(['test text'])).rejects.toThrow(NotImplementedError)
  })

  test('embed() error name is "NotImplementedError"', async () => {
    const client = new OpenAIEmbedClient(modelId)

    await expect(client.embed(['any input'])).rejects.toMatchObject({
      name: 'NotImplementedError',
    })
  })

  test('embed() error message describes skeleton state', async () => {
    const client = new OpenAIEmbedClient(modelId)

    await expect(client.embed(['any input'])).rejects.toThrow(/미활성화/)
  })

  test('embed() throws for empty input array (no network needed)', async () => {
    const client = new OpenAIEmbedClient(modelId)

    await expect(client.embed([])).rejects.toThrow(NotImplementedError)
  })

  test('embed() throws for multiple texts', async () => {
    const client = new OpenAIEmbedClient(modelId)

    await expect(
      client.embed(['text a', 'text b', 'text c'])
    ).rejects.toThrow(NotImplementedError)
  })

  // ── 생성자 검증 ────────────────────────────────────────────────────────────

  test('modelId accessor returns the model ID passed to constructor', () => {
    const client = new OpenAIEmbedClient('text-embedding-3-small')
    expect(client.modelId).toBe('text-embedding-3-small')
  })

  test('constructor accepts optional apiKey without throwing', () => {
    // apiKey는 골격에서 무시됨 — 생성만으로 네트워크 호출 없음
    expect(() => new OpenAIEmbedClient('text-embedding-3-small', 'dummy-key')).not.toThrow()
  })

  // ── NotImplementedError 자체 검증 ─────────────────────────────────────────

  test('NotImplementedError is an instance of Error', () => {
    const err = new NotImplementedError('test message')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(NotImplementedError)
    expect(err.name).toBe('NotImplementedError')
    expect(err.message).toBe('test message')
  })

  test('embed() throws an Error subclass (caught as Error)', async () => {
    const client = new OpenAIEmbedClient(modelId)

    await expect(client.embed(['hello'])).rejects.toBeInstanceOf(Error)
  })
})
