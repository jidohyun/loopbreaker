/**
 * tests/build-embedding-pairs-sub-ac-3b.test.ts
 *
 * Sub-AC 3b: buildEmbeddingPairs 단위 테스트
 *
 * 검증 항목:
 *  1. 3개 트리플 → 3쌍(C(3,2)) 반환, 각 쌍의 a/b/cos 구조 정확
 *  2. 코사인 유사도 값이 mock 벡터로부터 올바르게 계산됨
 *  3. triples 빈 배열 → 빈 배열 반환, embedFn 미호출
 *  4. triples 길이 1 → 빈 배열 반환, embedFn 미호출
 *  5. 동일 트리플 쌍 → cos ≈ 1.0
 *  6. 직교 벡터 쌍 → cos ≈ 0.0
 *  7. renderTripleText가 "tool argKey" 형태로 렌더링
 *  8. embedFn은 texts를 일괄 한 번만 호출 (API 최소화)
 *  9. 2개 트리플 → 1쌍 반환
 */

import type { ActionTriple } from '../src/contracts.js'
import {
  buildEmbeddingPairs,
  renderTripleText,
  type CosinePair,
  type EmbedFn,
} from '../src/detect/semantic-stage.js'

// ---- 헬퍼 ----

function makeTriple(
  tool: string,
  argKey: string,
  uuid = 'uuid-1',
  ts = 1000,
): ActionTriple {
  return { tool, argKey, resultClass: 'ok', ref: { uuid, ts } }
}

/**
 * 텍스트→고정 벡터 매핑으로 결정론 embedFn을 만든다.
 * 캐시 미스 시 에러(조용한 폴백 금지).
 */
function makeMockEmbedFn(
  fixtures: ReadonlyMap<string, readonly number[]>,
  callTracker?: { count: number },
): EmbedFn {
  return async (texts: string[]): Promise<number[][]> => {
    if (callTracker !== undefined) callTracker.count += 1
    return texts.map(text => {
      const vec = fixtures.get(text)
      if (vec === undefined) {
        throw new Error(
          `MockEmbedFn: 캐시 미스 — 등록되지 않은 텍스트: "${text}"`,
        )
      }
      return [...vec]
    })
  }
}

// ---- renderTripleText ----

describe('renderTripleText', () => {
  it('renders "tool argKey" format', () => {
    const triple = makeTriple('Edit', 'src/foo.ts')
    expect(renderTripleText(triple)).toBe('Edit src/foo.ts')
  })

  it('handles tool with special characters in argKey', () => {
    const triple = makeTriple('Bash', 'npm run build')
    expect(renderTripleText(triple)).toBe('Bash npm run build')
  })

  it('includes tool and argKey separated by space', () => {
    const triple = makeTriple('Read', '/tmp/file.txt')
    const rendered = renderTripleText(triple)
    expect(rendered.startsWith('Read ')).toBe(true)
    expect(rendered).toContain('/tmp/file.txt')
  })
})

// ---- buildEmbeddingPairs: 빈/단일 입력 ----

describe('buildEmbeddingPairs — empty and single inputs', () => {
  it('empty triples → returns [] without calling embedFn', async () => {
    const tracker = { count: 0 }
    const embedFn = makeMockEmbedFn(new Map(), tracker)
    const result = await buildEmbeddingPairs([], embedFn)
    expect(result).toEqual([])
    expect(tracker.count).toBe(0)
  })

  it('single triple → returns [] without calling embedFn', async () => {
    const tracker = { count: 0 }
    const embedFn = makeMockEmbedFn(new Map(), tracker)
    const triple = makeTriple('Edit', 'src/foo.ts')
    const result = await buildEmbeddingPairs([triple], embedFn)
    expect(result).toEqual([])
    expect(tracker.count).toBe(0)
  })
})

// ---- buildEmbeddingPairs: 2개 트리플 ----

describe('buildEmbeddingPairs — two triples', () => {
  const tripleA = makeTriple('Edit', 'src/a.ts', 'uuid-a', 1000)
  const tripleB = makeTriple('Edit', 'src/b.ts', 'uuid-b', 2000)

  const textA = renderTripleText(tripleA) // 'Edit src/a.ts'
  const textB = renderTripleText(tripleB) // 'Edit src/b.ts'

  // 직교 벡터
  const vecA = [1, 0, 0, 0]
  const vecB = [0, 1, 0, 0]

  const fixtures = new Map<string, readonly number[]>([
    [textA, vecA],
    [textB, vecB],
  ])

  it('returns exactly 1 pair for 2 triples', async () => {
    const embedFn = makeMockEmbedFn(fixtures)
    const result = await buildEmbeddingPairs([tripleA, tripleB], embedFn)
    expect(result).toHaveLength(1)
  })

  it('pair has correct a, b, cos fields', async () => {
    const embedFn = makeMockEmbedFn(fixtures)
    const result = await buildEmbeddingPairs([tripleA, tripleB], embedFn)
    const pair = result[0]!
    expect(pair.a).toBe(textA)
    expect(pair.b).toBe(textB)
    expect(pair.cos).toBeCloseTo(0.0, 10) // 직교 → cos=0
  })
})

// ---- buildEmbeddingPairs: 3개 트리플 (C(3,2)=3쌍) ----

describe('buildEmbeddingPairs — three triples', () => {
  const t1 = makeTriple('Edit', 'src/x.ts', 'u1', 1000)
  const t2 = makeTriple('Edit', 'src/y.ts', 'u2', 2000)
  const t3 = makeTriple('Bash', 'npm test', 'u3', 3000)

  const text1 = renderTripleText(t1) // 'Edit src/x.ts'
  const text2 = renderTripleText(t2) // 'Edit src/y.ts'
  const text3 = renderTripleText(t3) // 'Bash npm test'

  // t1/t2는 같은 방향(유사), t3는 직교
  const vec1 = [1, 0]
  const vec2 = [1, 0] // 동일 방향 → cos=1
  const vec3 = [0, 1] // 직교 → cos=0

  const fixtures = new Map<string, readonly number[]>([
    [text1, vec1],
    [text2, vec2],
    [text3, vec3],
  ])

  it('returns exactly 3 pairs for 3 triples', async () => {
    const embedFn = makeMockEmbedFn(fixtures)
    const result = await buildEmbeddingPairs([t1, t2, t3], embedFn)
    expect(result).toHaveLength(3)
  })

  it('pairs are in (i<j) order: (0,1), (0,2), (1,2)', async () => {
    const embedFn = makeMockEmbedFn(fixtures)
    const result = await buildEmbeddingPairs([t1, t2, t3], embedFn)
    expect(result[0]!.a).toBe(text1)
    expect(result[0]!.b).toBe(text2)
    expect(result[1]!.a).toBe(text1)
    expect(result[1]!.b).toBe(text3)
    expect(result[2]!.a).toBe(text2)
    expect(result[2]!.b).toBe(text3)
  })

  it('t1/t2 same direction → cos ≈ 1.0', async () => {
    const embedFn = makeMockEmbedFn(fixtures)
    const result = await buildEmbeddingPairs([t1, t2, t3], embedFn)
    const pair01 = result.find(p => p.a === text1 && p.b === text2)!
    expect(pair01.cos).toBeCloseTo(1.0, 10)
  })

  it('t1/t3 orthogonal → cos ≈ 0.0', async () => {
    const embedFn = makeMockEmbedFn(fixtures)
    const result = await buildEmbeddingPairs([t1, t2, t3], embedFn)
    const pair02 = result.find(p => p.a === text1 && p.b === text3)!
    expect(pair02.cos).toBeCloseTo(0.0, 10)
  })

  it('t2/t3 orthogonal → cos ≈ 0.0', async () => {
    const embedFn = makeMockEmbedFn(fixtures)
    const result = await buildEmbeddingPairs([t1, t2, t3], embedFn)
    const pair12 = result.find(p => p.a === text2 && p.b === text3)!
    expect(pair12.cos).toBeCloseTo(0.0, 10)
  })

  it('embedFn is called exactly once (batch)', async () => {
    const tracker = { count: 0 }
    const embedFn = makeMockEmbedFn(fixtures, tracker)
    await buildEmbeddingPairs([t1, t2, t3], embedFn)
    expect(tracker.count).toBe(1)
  })
})

// ---- CosinePair 타입 구조 검증 ----

describe('buildEmbeddingPairs — CosinePair structure', () => {
  it('each pair has a, b (strings) and cos (number in [-1,1])', async () => {
    const t1 = makeTriple('Read', 'file.ts', 'u1', 1000)
    const t2 = makeTriple('Read', 'file.ts', 'u2', 2000) // 동일 argKey → cos=1
    const text = renderTripleText(t1)
    const fixtures = new Map<string, readonly number[]>([[text, [1, 0]]])
    const embedFn = makeMockEmbedFn(fixtures)
    const result = await buildEmbeddingPairs([t1, t2], embedFn)

    expect(result).toHaveLength(1)
    const pair: CosinePair = result[0]!
    expect(typeof pair.a).toBe('string')
    expect(typeof pair.b).toBe('string')
    expect(typeof pair.cos).toBe('number')
    expect(pair.cos).toBeGreaterThanOrEqual(-1)
    expect(pair.cos).toBeLessThanOrEqual(1)
  })

  it('identical triples → cos ≈ 1.0', async () => {
    const t1 = makeTriple('Edit', 'src/same.ts', 'u1', 1000)
    const t2 = makeTriple('Edit', 'src/same.ts', 'u2', 2000)
    const text = renderTripleText(t1) // same as t2
    const fixtures = new Map<string, readonly number[]>([[text, [3, 4]]])
    const embedFn = makeMockEmbedFn(fixtures)
    const result = await buildEmbeddingPairs([t1, t2], embedFn)
    expect(result[0]!.cos).toBeCloseTo(1.0, 10)
  })

  it('known 45-degree angle → cos ≈ 1/√2', async () => {
    const t1 = makeTriple('Edit', 'src/p.ts', 'u1', 1000)
    const t2 = makeTriple('Edit', 'src/q.ts', 'u2', 2000)
    const text1 = renderTripleText(t1)
    const text2 = renderTripleText(t2)
    const fixtures = new Map<string, readonly number[]>([
      [text1, [1, 0]],
      [text2, [1, 1]], // 45° from [1,0]
    ])
    const embedFn = makeMockEmbedFn(fixtures)
    const result = await buildEmbeddingPairs([t1, t2], embedFn)
    expect(result[0]!.cos).toBeCloseTo(1 / Math.SQRT2, 8)
  })
})
