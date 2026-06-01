/**
 * embed-client-interface.test.ts
 *
 * Sub-AC 1: EmbedClient 인터페이스 컴파일·런타임 검증.
 *
 * 목적:
 * - EmbedClient 인터페이스를 구현하는 어떤 객체든 TypeScript가 허용하는지 확인.
 * - 외부 API 절대 미호출: 인메모리 Mock으로만 동작.
 */

import { type EmbedClient, EmbedClientError } from '../src/api/embed-client.js'

// ── 컴파일 타임 검증: 인터페이스를 만족하는 구현체 ───────────────────────────

/**
 * 인라인 Mock 구현체.
 * EmbedClient 인터페이스를 구현하는 임의 객체가 타입으로 수용되는지 검증.
 */
class InlineEmbedClientMock implements EmbedClient {
  private readonly fixtures: Map<string, number[]>

  constructor(fixtures: Map<string, number[]>) {
    this.fixtures = fixtures
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(t => {
      const vec = this.fixtures.get(t)
      if (vec === undefined) {
        throw new EmbedClientError(`no fixture for text: ${t}`)
      }
      return vec
    })
  }
}

/**
 * 객체 리터럴로도 인터페이스를 만족할 수 있는지 확인 (structural typing).
 */
function acceptEmbedClient(client: EmbedClient): EmbedClient {
  return client
}

// ── 런타임 테스트 ─────────────────────────────────────────────────────────────

describe('EmbedClient interface', () => {
  const dim = 4
  const fixtures = new Map<string, number[]>([
    ['hello', [0.1, 0.2, 0.3, 0.4]],
    ['world', [0.5, 0.6, 0.7, 0.8]],
  ])
  const client: EmbedClient = new InlineEmbedClientMock(fixtures)

  test('embed() returns a vector per input text', async () => {
    const result = await client.embed(['hello', 'world'])
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(result[1]).toEqual([0.5, 0.6, 0.7, 0.8])
  })

  test('embed() returns empty array for empty input', async () => {
    const result = await client.embed([])
    expect(result).toHaveLength(0)
  })

  test('embed() returns vectors with consistent dimension', async () => {
    const result = await client.embed(['hello', 'world'])
    for (const vec of result) {
      expect(vec).toHaveLength(dim)
    }
  })

  test('object literal satisfies EmbedClient structural typing (compile-time)', () => {
    // TypeScript structural typing: 객체 리터럴이 인터페이스를 만족하면 컴파일 통과.
    const literalClient = acceptEmbedClient({
      embed: async (_texts: string[]) => Promise.resolve([[1, 2], [3, 4]]),
    })
    expect(literalClient).toBeDefined()
  })

  test('class instance is accepted by EmbedClient-typed variable', () => {
    // 클래스 인스턴스가 EmbedClient 타입 변수에 할당 가능한지 확인.
    const typed: EmbedClient = new InlineEmbedClientMock(new Map())
    expect(typed).toBeDefined()
  })

  test('EmbedClientError is thrown on missing fixture', async () => {
    await expect(client.embed(['nonexistent'])).rejects.toThrow(EmbedClientError)
    await expect(client.embed(['nonexistent'])).rejects.toThrow(
      'no fixture for text: nonexistent',
    )
  })

  test('EmbedClientError preserves embedCause', () => {
    const cause = new Error('network timeout')
    const err = new EmbedClientError('upstream failed', cause)
    expect(err.name).toBe('EmbedClientError')
    expect(err.message).toBe('upstream failed')
    expect(err.embedCause).toBe(cause)
  })
})
