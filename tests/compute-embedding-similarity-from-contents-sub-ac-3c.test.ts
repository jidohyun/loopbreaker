/**
 * tests/compute-embedding-similarity-from-contents-sub-ac-3c.test.ts
 *
 * Sub-AC 3c: computeEmbeddingSimilarityFromContents(contents, embedFn)
 *   - normalizedContent 배열로부터 maxCosine과 pairs(모든 쌍의 유사도)를 올바르게 산출하는지 검증.
 *   - embedFn은 stub (MockEmbedClient.embed 또는 인라인 async 함수).
 *   - 외부 API 절대 미호출: 네트워크·API 키 없이 결정론 동작.
 *   - BLOCKER C8: pairs:{a,b,cos}[] 정본 (pairCount 필드 금지).
 */

import { jest } from '@jest/globals'
import { computeEmbeddingSimilarityFromContents } from '../src/detect/semantic-stage.js'
import type { EmbedFn } from '../src/detect/semantic-stage.js'

// ---------------------------------------------------------------------------
// 헬퍼: 고정 벡터 맵을 이용한 stub embedFn 생성
// ---------------------------------------------------------------------------

/**
 * text→vector 맵으로부터 결정론 embedFn stub을 생성한다.
 * 등록되지 않은 텍스트 → Error throw (조용한 폴백 금지).
 */
function makeStubEmbedFn(fixtures: ReadonlyMap<string, number[]>): EmbedFn {
  return async (texts: string[]): Promise<number[][]> => {
    return texts.map(t => {
      const vec = fixtures.get(t)
      if (vec === undefined) {
        throw new Error(`stub embedFn: 미등록 텍스트 "${t}"`)
      }
      return [...vec]
    })
  }
}

/**
 * 두 벡터 간 코사인 유사도를 계산하는 순수 헬퍼 (기댓값 계산용).
 */
function cosine(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0
  return Math.max(-1, Math.min(1, dot / denom))
}

// ---------------------------------------------------------------------------
// 픽스처 벡터 (4차원, 단순 계산 가능한 값)
// ---------------------------------------------------------------------------

const VEC_A = [1, 0, 0, 0]   // 단위벡터 A
const VEC_B = [0, 1, 0, 0]   // 단위벡터 B (A와 직교 → cos=0)
const VEC_C = [1, 1, 0, 0]   // A+B 방향 (A와 45도 → cos=1/√2 ≈ 0.707)
const VEC_D = [1, 0, 0, 0]   // A와 동일 (→ cos=1.0)

// ---------------------------------------------------------------------------
// 1. 기본 동작: 2개 contents → 1쌍
// ---------------------------------------------------------------------------

describe('computeEmbeddingSimilarityFromContents — 2개 contents (1쌍)', () => {
  const fixtures = new Map([
    ['edit foo.ts', VEC_A],
    ['bash npm test', VEC_B],
  ])
  const embedFn = makeStubEmbedFn(fixtures)

  test('pairs 배열 길이가 1이다', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      ['edit foo.ts', 'bash npm test'],
      embedFn,
    )
    expect(result.pairs).toHaveLength(1)
  })

  test('pair.a와 pair.b가 입력 텍스트와 일치한다', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      ['edit foo.ts', 'bash npm test'],
      embedFn,
    )
    expect(result.pairs[0]!.a).toBe('edit foo.ts')
    expect(result.pairs[0]!.b).toBe('bash npm test')
  })

  test('직교 벡터의 cos는 0이다', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      ['edit foo.ts', 'bash npm test'],
      embedFn,
    )
    // VEC_A · VEC_B = 0
    expect(result.pairs[0]!.cos).toBeCloseTo(0, 10)
  })

  test('maxCosine은 pairs 중 최대 cos 값과 같다', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      ['edit foo.ts', 'bash npm test'],
      embedFn,
    )
    expect(result.maxCosine).toBeCloseTo(0, 10)
  })

  test('pairCount 필드가 없다 (BLOCKER C8)', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      ['edit foo.ts', 'bash npm test'],
      embedFn,
    )
    expect(result).not.toHaveProperty('pairCount')
  })
})

// ---------------------------------------------------------------------------
// 2. 3개 contents → 3쌍
// ---------------------------------------------------------------------------

describe('computeEmbeddingSimilarityFromContents — 3개 contents (3쌍)', () => {
  const TEXT_A = 'edit src/foo.ts'
  const TEXT_B = 'bash run tests'
  const TEXT_C = 'edit src/bar.ts'

  const fixtures = new Map([
    [TEXT_A, VEC_A],
    [TEXT_B, VEC_B],
    [TEXT_C, VEC_C],
  ])
  const embedFn = makeStubEmbedFn(fixtures)

  test('pairs 배열 길이가 3이다 (C(3,2)=3)', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      [TEXT_A, TEXT_B, TEXT_C],
      embedFn,
    )
    expect(result.pairs).toHaveLength(3)
  })

  test('모든 쌍이 i<j 순서로 열거된다', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      [TEXT_A, TEXT_B, TEXT_C],
      embedFn,
    )
    expect(result.pairs[0]!.a).toBe(TEXT_A)
    expect(result.pairs[0]!.b).toBe(TEXT_B)
    expect(result.pairs[1]!.a).toBe(TEXT_A)
    expect(result.pairs[1]!.b).toBe(TEXT_C)
    expect(result.pairs[2]!.a).toBe(TEXT_B)
    expect(result.pairs[2]!.b).toBe(TEXT_C)
  })

  test('각 쌍의 cos 값이 수동 계산값과 일치한다', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      [TEXT_A, TEXT_B, TEXT_C],
      embedFn,
    )
    const expectedAB = cosine(VEC_A, VEC_B) // 0
    const expectedAC = cosine(VEC_A, VEC_C) // 1/√2 ≈ 0.707
    const expectedBC = cosine(VEC_B, VEC_C) // 1/√2 ≈ 0.707

    expect(result.pairs[0]!.cos).toBeCloseTo(expectedAB, 10)
    expect(result.pairs[1]!.cos).toBeCloseTo(expectedAC, 10)
    expect(result.pairs[2]!.cos).toBeCloseTo(expectedBC, 10)
  })

  test('maxCosine은 모든 쌍 중 최대 cos 값이다', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      [TEXT_A, TEXT_B, TEXT_C],
      embedFn,
    )
    const expectedMax = Math.max(
      cosine(VEC_A, VEC_B),
      cosine(VEC_A, VEC_C),
      cosine(VEC_B, VEC_C),
    )
    expect(result.maxCosine).toBeCloseTo(expectedMax, 10)
  })
})

// ---------------------------------------------------------------------------
// 3. 동일 벡터 → cos=1.0 (최고 유사도)
// ---------------------------------------------------------------------------

describe('computeEmbeddingSimilarityFromContents — 동일 벡터 쌍 (cos=1.0)', () => {
  const TEXT_A = 'edit foo.ts line 10'
  const TEXT_D = 'edit foo.ts line 10 again'

  const fixtures = new Map([
    [TEXT_A, VEC_A],
    [TEXT_D, VEC_D], // VEC_D === VEC_A
  ])
  const embedFn = makeStubEmbedFn(fixtures)

  test('동일 방향 벡터의 cos는 1.0에 매우 근접한다', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      [TEXT_A, TEXT_D],
      embedFn,
    )
    expect(result.pairs[0]!.cos).toBeCloseTo(1.0, 10)
    expect(result.maxCosine).toBeCloseTo(1.0, 10)
  })
})

// ---------------------------------------------------------------------------
// 4. 경계값: 0개 contents → maxCosine=0, pairs=[]
// ---------------------------------------------------------------------------

describe('computeEmbeddingSimilarityFromContents — 경계값: 빈 배열', () => {
  const embedFnSpy = jest.fn(async (_: string[]) => [] as number[][])

  test('빈 배열 입력 시 maxCosine=0, pairs=[] 반환한다', async () => {
    const result = await computeEmbeddingSimilarityFromContents([], embedFnSpy)
    expect(result.maxCosine).toBe(0)
    expect(result.pairs).toHaveLength(0)
  })

  test('빈 배열 입력 시 embedFn을 호출하지 않는다', async () => {
    embedFnSpy.mockClear()
    await computeEmbeddingSimilarityFromContents([], embedFnSpy)
    expect(embedFnSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 5. 경계값: 1개 contents → maxCosine=0, pairs=[]
// ---------------------------------------------------------------------------

describe('computeEmbeddingSimilarityFromContents — 경계값: 단일 텍스트', () => {
  const embedFnSpy = jest.fn(async (_: string[]) => [[1, 0, 0, 0]])

  test('1개 입력 시 maxCosine=0, pairs=[] 반환한다 (쌍 없음)', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      ['edit single.ts'],
      embedFnSpy,
    )
    expect(result.maxCosine).toBe(0)
    expect(result.pairs).toHaveLength(0)
  })

  test('1개 입력 시 embedFn을 호출하지 않는다', async () => {
    embedFnSpy.mockClear()
    await computeEmbeddingSimilarityFromContents(['edit single.ts'], embedFnSpy)
    expect(embedFnSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 6. embedFn 단 1회만 호출 (API 호출 최소화)
// ---------------------------------------------------------------------------

describe('computeEmbeddingSimilarityFromContents — embedFn 호출 횟수', () => {
  test('embedFn은 정확히 1회만 호출된다', async () => {
    const callCount = { n: 0 }
    const embedFn: EmbedFn = async (texts: string[]) => {
      callCount.n++
      return texts.map(() => [1, 0, 0, 0])
    }
    await computeEmbeddingSimilarityFromContents(
      ['text-a', 'text-b', 'text-c'],
      embedFn,
    )
    expect(callCount.n).toBe(1)
  })

  test('embedFn은 모든 texts를 한 번에 전달받는다', async () => {
    const received: string[][] = []
    const embedFn: EmbedFn = async (texts: string[]) => {
      received.push([...texts])
      return texts.map(() => [1, 0, 0, 0])
    }
    const inputs = ['alpha', 'beta', 'gamma']
    await computeEmbeddingSimilarityFromContents(inputs, embedFn)
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(inputs)
  })
})

// ---------------------------------------------------------------------------
// 7. 불변성: 입력 contents 배열이 변경되지 않는다
// ---------------------------------------------------------------------------

describe('computeEmbeddingSimilarityFromContents — 불변성', () => {
  test('입력 contents 배열이 변경되지 않는다', async () => {
    const fixtures = new Map([
      ['aaa', [1, 0]],
      ['bbb', [0, 1]],
    ])
    const embedFn = makeStubEmbedFn(fixtures)
    const contents = ['aaa', 'bbb']
    const snapshot = [...contents]

    await computeEmbeddingSimilarityFromContents(contents, embedFn)
    expect(contents).toEqual(snapshot)
  })

  test('반환된 pairs 배열은 embedFn이 반환한 벡터와 독립적이다', async () => {
    const mutableVecA = [1, 0]
    const mutableVecB = [0, 1]
    const fixtures = new Map([
      ['x', mutableVecA],
      ['y', mutableVecB],
    ])
    const embedFn = makeStubEmbedFn(fixtures)

    const result = await computeEmbeddingSimilarityFromContents(['x', 'y'], embedFn)
    const cosBefore = result.pairs[0]!.cos

    // 외부에서 원본 벡터를 변경해도 결과에 영향 없음
    mutableVecA[0] = 999
    expect(result.pairs[0]!.cos).toBe(cosBefore)
  })
})

// ---------------------------------------------------------------------------
// 8. embedFn 실패 → 예외 전파 (fail-closed)
// ---------------------------------------------------------------------------

describe('computeEmbeddingSimilarityFromContents — embedFn 실패 처리 (fail-closed)', () => {
  test('embedFn이 throw하면 예외를 그대로 전파한다', async () => {
    const failingEmbedFn: EmbedFn = async (_texts: string[]) => {
      throw new Error('API 오류: 타임아웃')
    }
    await expect(
      computeEmbeddingSimilarityFromContents(['a', 'b'], failingEmbedFn),
    ).rejects.toThrow('API 오류: 타임아웃')
  })

  test('embedFn이 reject되면 결과를 조용히 emit하지 않는다 (fail-open 금지)', async () => {
    const failingEmbedFn: EmbedFn = async (_texts: string[]) => {
      return Promise.reject(new Error('embed 실패'))
    }
    await expect(
      computeEmbeddingSimilarityFromContents(['x', 'y'], failingEmbedFn),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 9. EmbeddingSimilarityResult 구조 검증 (BLOCKER C8)
// ---------------------------------------------------------------------------

describe('computeEmbeddingSimilarityFromContents — EmbeddingSimilarityResult 구조 (BLOCKER C8)', () => {
  const fixtures = new Map([
    ['content-1', [1, 0, 0]],
    ['content-2', [0, 1, 0]],
  ])
  const embedFn = makeStubEmbedFn(fixtures)

  test('반환 타입에 maxCosine 필드가 있다', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      ['content-1', 'content-2'],
      embedFn,
    )
    expect(result).toHaveProperty('maxCosine')
    expect(typeof result.maxCosine).toBe('number')
  })

  test('반환 타입에 pairs 필드가 있다 (pairCount 아님)', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      ['content-1', 'content-2'],
      embedFn,
    )
    expect(result).toHaveProperty('pairs')
    expect(result).not.toHaveProperty('pairCount')
  })

  test('pairs 각 원소는 {a:string, b:string, cos:number} 구조다', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      ['content-1', 'content-2'],
      embedFn,
    )
    for (const pair of result.pairs) {
      expect(typeof pair.a).toBe('string')
      expect(typeof pair.b).toBe('string')
      expect(typeof pair.cos).toBe('number')
    }
  })

  test('maxCosine은 [-1, 1] 범위 내다', async () => {
    const result = await computeEmbeddingSimilarityFromContents(
      ['content-1', 'content-2'],
      embedFn,
    )
    expect(result.maxCosine).toBeGreaterThanOrEqual(-1)
    expect(result.maxCosine).toBeLessThanOrEqual(1)
  })

  test('4개 contents → pairs 길이가 C(4,2)=6이다', async () => {
    const fix4 = new Map([
      ['t1', [1, 0, 0, 0]],
      ['t2', [0, 1, 0, 0]],
      ['t3', [0, 0, 1, 0]],
      ['t4', [0, 0, 0, 1]],
    ])
    const result = await computeEmbeddingSimilarityFromContents(
      ['t1', 't2', 't3', 't4'],
      makeStubEmbedFn(fix4),
    )
    // C(4,2) = 6
    expect(result.pairs).toHaveLength(6)
  })
})

// ---------------------------------------------------------------------------
// 10. MockEmbedClient.embed를 embedFn으로 사용 (통합 검증)
// ---------------------------------------------------------------------------

import { MockEmbedClient } from '../src/api/embed-client.js'

describe('computeEmbeddingSimilarityFromContents — MockEmbedClient 통합', () => {
  test('MockEmbedClient.embed를 embedFn으로 직접 주입할 수 있다', async () => {
    const client = new MockEmbedClient(
      [
        { text: 'edit foo.ts', vector: [1, 0, 0, 0] },
        { text: 'edit bar.ts', vector: [1, 0, 0, 0] },
      ],
      4,
    )
    // MockEmbedClient.embed를 bind해 EmbedFn으로 사용
    const embedFn: EmbedFn = (texts) => client.embed(texts)

    const result = await computeEmbeddingSimilarityFromContents(
      ['edit foo.ts', 'edit bar.ts'],
      embedFn,
    )

    // 동일 벡터 → cos=1.0, simThresh(0.90) 초과 → 의미 반복 신호 STRONG
    expect(result.maxCosine).toBeCloseTo(1.0, 10)
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]!.cos).toBeCloseTo(1.0, 10)
  })

  test('MockEmbedClient 캐시 미스 → EmbedClientError throw (fail-closed)', async () => {
    const client = new MockEmbedClient(
      [{ text: 'known', vector: [1, 0, 0, 0] }],
      4,
    )
    const embedFn: EmbedFn = (texts) => client.embed(texts)

    await expect(
      computeEmbeddingSimilarityFromContents(['known', 'UNKNOWN_TEXT'], embedFn),
    ).rejects.toThrow('캐시 미스')
  })
})
