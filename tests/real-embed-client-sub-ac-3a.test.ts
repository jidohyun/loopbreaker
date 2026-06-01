/**
 * real-embed-client-sub-ac-3a.test.ts
 *
 * Sub-AC 3a: RealEmbedClient 골격 단위 테스트.
 *
 * 검증 목적:
 *   1. RealEmbedClient 클래스가 존재하고 importable하다.
 *   2. RealEmbedClient가 EmbedClient 인터페이스를 구현한다 (TypeScript 구조 타이핑).
 *   3. embed() 호출 시 NotImplementedError를 throw한다 (골격, 미활성화).
 *   4. 외부 네트워크 호출 없음 — 결정론 동작.
 *
 * 제약:
 *   - 네트워크·API 키 절대 불필요.
 *   - jest.spyOn 등 네트워크 인터셉터 없이 결정론 동작.
 *   - MockEmbedClient는 이 테스트에서 사용하지 않음 (골격 클라이언트 자체를 검증).
 */

import { type EmbedClient } from '../src/api/embed-client.js'
import {
  RealEmbedClient,
  NotImplementedError,
} from '../src/api/real-embed-client.js'

describe('RealEmbedClient (Sub-AC 3a)', () => {
  const modelId = 'voyage-3-lite'

  // ── 클래스 존재 및 importable 검증 ────────────────────────────────────────

  test('RealEmbedClient class exists and is importable', () => {
    expect(RealEmbedClient).toBeDefined()
    expect(typeof RealEmbedClient).toBe('function') // class는 함수
  })

  // ── EmbedClient 인터페이스 구현 검증 (구조 타이핑) ──────────────────────────

  test('RealEmbedClient implements EmbedClient interface (TypeScript structural typing)', () => {
    // TypeScript 컴파일 시 이미 검증됨.
    // 런타임에도 EmbedClient 타입 변수에 할당 가능한지 확인.
    const client: EmbedClient = new RealEmbedClient(modelId)
    expect(client).toBeDefined()
  })

  test('RealEmbedClient instance satisfies EmbedClient interface structurally', () => {
    const client = new RealEmbedClient(modelId)
    // EmbedClient 인터페이스는 embed(texts: string[]): Promise<number[][]> 를 요구함
    expect(typeof client.embed).toBe('function')
  })

  test('RealEmbedClient is assignable to EmbedClient-typed variable', () => {
    // 구조 타이핑: EmbedClient 인터페이스를 받는 함수에 RealEmbedClient 인스턴스 전달 가능
    function acceptEmbedClient(c: EmbedClient): boolean {
      return typeof c.embed === 'function'
    }
    const client = new RealEmbedClient(modelId)
    expect(acceptEmbedClient(client)).toBe(true)
  })

  // ── embed() → NotImplementedError ─────────────────────────────────────────

  test('embed() throws NotImplementedError without making any network call', async () => {
    const client = new RealEmbedClient(modelId)
    await expect(client.embed(['test text'])).rejects.toThrow(NotImplementedError)
  })

  test('embed() error name is "NotImplementedError"', async () => {
    const client = new RealEmbedClient(modelId)
    await expect(client.embed(['any input'])).rejects.toMatchObject({
      name: 'NotImplementedError',
    })
  })

  test('embed() error message describes skeleton state and modelId', async () => {
    const client = new RealEmbedClient(modelId)
    await expect(client.embed(['any input'])).rejects.toThrow(/미활성화/)
  })

  test('embed() error message includes modelId', async () => {
    const client = new RealEmbedClient('text-embedding-3-small')
    await expect(client.embed(['input'])).rejects.toThrow(/text-embedding-3-small/)
  })

  test('embed() throws for empty input array', async () => {
    const client = new RealEmbedClient(modelId)
    // 빈 배열도 골격이므로 NotImplementedError
    await expect(client.embed([])).rejects.toThrow(NotImplementedError)
  })

  test('embed() throws for multiple texts', async () => {
    const client = new RealEmbedClient(modelId)
    await expect(
      client.embed(['text a', 'text b', 'text c'])
    ).rejects.toThrow(NotImplementedError)
  })

  test('embed() throws an Error subclass (caught as Error)', async () => {
    const client = new RealEmbedClient(modelId)
    await expect(client.embed(['hello'])).rejects.toBeInstanceOf(Error)
  })

  // ── 생성자 검증 ────────────────────────────────────────────────────────────

  test('modelId accessor returns the model ID passed to constructor', () => {
    const client = new RealEmbedClient('voyage-3-lite')
    expect(client.modelId).toBe('voyage-3-lite')
  })

  test('modelId accessor works with OpenAI model ID', () => {
    const client = new RealEmbedClient('text-embedding-3-small')
    expect(client.modelId).toBe('text-embedding-3-small')
  })

  test('constructor accepts optional apiKey without throwing', () => {
    // apiKey는 골격에서 무시됨 — 생성만으로 네트워크 호출 없음
    expect(() => new RealEmbedClient('voyage-3-lite', 'dummy-api-key')).not.toThrow()
  })

  test('constructor throws TypeError for empty modelId', () => {
    expect(() => new RealEmbedClient('')).toThrow(TypeError)
  })

  // ── NotImplementedError 자체 검증 ─────────────────────────────────────────

  test('NotImplementedError is an instance of Error', () => {
    const err = new NotImplementedError('test message')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(NotImplementedError)
    expect(err.name).toBe('NotImplementedError')
    expect(err.message).toBe('test message')
  })
})
