/**
 * tests/semantic-stage-sub-ac-3d.test.ts
 *
 * Sub-AC 3d: semanticStage 단위 테스트
 *
 * 검증 항목:
 *  1. maxCosine >= simThresh → triggered=true
 *  2. maxCosine < simThresh  → triggered=false
 *  3. maxCosine === simThresh (경계값) → triggered=true (>= 이므로 포함)
 *  4. hits가 2개 미만이면 result={maxCosine:0, pairs:[]}, triggered=false 반환 (embedFn 미호출)
 *  5. hits가 2개 이상이면 embedFn이 호출되어 EmbeddingSimilarityResult에 pairs가 생성됨
 *  6. normalizeContent 정규화 적용 검증 (whitespace collapse + lowercase + 500자 truncate)
 *  7. EmbeddingSimilarityResult에 pairCount 필드 없음 (BLOCKER C8)
 *  8. 다양한 simThresh 값에 대한 triggered 경계값 검증
 */

import { semanticStage, normalizeContent } from '../src/detect/semantic-stage.js'
import type { DetectionHit, } from '../src/detect/detection-pipeline.js'
import type { StructureGateResult } from '../src/contracts.js'

// ── 테스트 헬퍼 ────────────────────────────────────────────────────────────────

function makeHit(type: 'thrashing' | 'false_success', subtype: string): DetectionHit {
  const gate: StructureGateResult = {
    type,
    subtype,
    severity: 'warning',
    sessionId: 'test-session',
    agentScope: 'root',
    windowRefs: ['uuid-1', 'uuid-2'],
    metrics: { count: 3 },
  }
  return {
    gate,
    triggerUuid: 'trigger-uuid',
    ts: Date.now(),
  }
}

/**
 * embedFn 호출 여부를 추적하는 Mock.
 * 지정한 코사인 유사도를 반환한다.
 * 원리: vecA = [1, 0], vecB = [cos(θ), sin(θ)] 이면 cos 유사도 = cos(θ).
 */
function makeMockEmbedFnWithSpy(targetCosine: number): {
  embedFn: (texts: string[]) => Promise<number[][]>
  callCount: number
} {
  const spy = { callCount: 0 }
  const sinVal = Math.sqrt(Math.max(0, 1 - targetCosine * targetCosine))
  const vecA = [1, 0]
  const vecB = [targetCosine, sinVal]

  const embedFn = async (texts: string[]): Promise<number[][]> => {
    spy.callCount++
    return texts.map((_, i) => (i === 0 ? vecA : vecB))
  }

  return { embedFn, ...spy }
}

// ── normalizeContent 단위 테스트 ───────────────────────────────────────────────

describe('normalizeContent', () => {
  it('whitespace collapse: 연속 공백을 단일 스페이스로 압축', () => {
    const result = normalizeContent('hello   world\t\nfoo')
    expect(result).toBe('hello world foo')
  })

  it('lowercase: 대문자를 소문자로 변환', () => {
    const result = normalizeContent('Hello WORLD Foo')
    expect(result).toBe('hello world foo')
  })

  it('500자 truncate: 500자 초과 텍스트는 자름', () => {
    const longText = 'a'.repeat(600)
    const result = normalizeContent(longText)
    expect(result).toHaveLength(500)
    expect(result).toBe('a'.repeat(500))
  })

  it('500자 이하 텍스트는 그대로 보존', () => {
    const text = 'hello world'
    const result = normalizeContent(text)
    expect(result).toBe('hello world')
  })

  it('앞뒤 공백 제거', () => {
    const result = normalizeContent('  hello world  ')
    expect(result).toBe('hello world')
  })

  it('복합 정규화: whitespace + lowercase + truncate 순서 올바름', () => {
    const text = '  Hello   WORLD  ' + 'x'.repeat(500)
    const result = normalizeContent(text)
    expect(result.length).toBe(500)
    expect(result.startsWith('hello world')).toBe(true)
  })

  it('빈 문자열 → 빈 문자열', () => {
    expect(normalizeContent('')).toBe('')
  })
})

// ── semanticStage 단위 테스트 ─────────────────────────────────────────────────

describe('semanticStage', () => {
  describe('triggered 반환값 — simThresh 판정', () => {
    it('maxCosine > simThresh → triggered=true', async () => {
      const hits = [makeHit('thrashing', 'edit_loop'), makeHit('thrashing', 'edit_loop')]
      const simThresh = 0.85
      const { embedFn } = makeMockEmbedFnWithSpy(0.95)

      const { result, triggered } = await semanticStage(hits, simThresh, embedFn)

      expect(triggered).toBe(true)
      expect(result.maxCosine).toBeGreaterThan(simThresh)
    })

    it('maxCosine < simThresh → triggered=false', async () => {
      const hits = [makeHit('thrashing', 'edit_loop'), makeHit('thrashing', 'different_sub')]
      const simThresh = 0.90
      const { embedFn } = makeMockEmbedFnWithSpy(0.70)

      const { result, triggered } = await semanticStage(hits, simThresh, embedFn)

      expect(triggered).toBe(false)
      expect(result.maxCosine).toBeLessThan(simThresh)
    })

    it('maxCosine === simThresh (경계값) → triggered=true (>= 포함)', async () => {
      const hits = [makeHit('thrashing', 'edit_loop'), makeHit('thrashing', 'edit_loop')]
      const simThresh = 0.90
      // 정확히 0.90 코사인을 반환하는 embedFn
      const embedFn = async (texts: string[]): Promise<number[][]> => {
        const cos = 0.90
        const sin = Math.sqrt(1 - cos * cos)
        return texts.map((_, i) => (i === 0 ? [1, 0] : [cos, sin]))
      }

      const { result, triggered } = await semanticStage(hits, simThresh, embedFn)

      expect(result.maxCosine).toBeCloseTo(0.90, 8)
      expect(triggered).toBe(true)
    })

    it('simThresh 직하 경계값 (maxCosine 0.8999) → triggered=false', async () => {
      const hits = [makeHit('thrashing', 'a'), makeHit('thrashing', 'b')]
      const simThresh = 0.90
      const cos = 0.8999
      const sin = Math.sqrt(Math.max(0, 1 - cos * cos))
      const embedFn = async (texts: string[]): Promise<number[][]> =>
        texts.map((_, i) => (i === 0 ? [1, 0] : [cos, sin]))

      const { triggered } = await semanticStage(hits, simThresh, embedFn)

      expect(triggered).toBe(false)
    })
  })

  describe('hits 개수 처리', () => {
    it('hits가 빈 배열 → maxCosine=0, pairs=[], triggered=false (embedFn 미호출)', async () => {
      const spy = { callCount: 0 }
      const embedFn = async (texts: string[]): Promise<number[][]> => {
        spy.callCount++
        return texts.map(() => [1, 0])
      }

      const { result, triggered } = await semanticStage([], 0.90, embedFn)

      expect(result.maxCosine).toBe(0)
      expect(result.pairs).toEqual([])
      expect(triggered).toBe(false)
      expect(spy.callCount).toBe(0) // embedFn 미호출
    })

    it('hits가 1개 → maxCosine=0, pairs=[], triggered=false (embedFn 미호출)', async () => {
      const spy = { callCount: 0 }
      const embedFn = async (texts: string[]): Promise<number[][]> => {
        spy.callCount++
        return texts.map(() => [1, 0])
      }
      const hits = [makeHit('thrashing', 'edit_loop')]

      const { result, triggered } = await semanticStage(hits, 0.90, embedFn)

      expect(result.maxCosine).toBe(0)
      expect(result.pairs).toEqual([])
      expect(triggered).toBe(false)
      expect(spy.callCount).toBe(0) // embedFn 미호출
    })

    it('hits가 2개 → embedFn이 호출되고 1개 pair 생성', async () => {
      const spy = { callCount: 0 }
      const embedFn = async (texts: string[]): Promise<number[][]> => {
        spy.callCount++
        return texts.map(() => [1, 0]) // 동일 벡터 → cos=1.0
      }
      const hits = [makeHit('thrashing', 'a'), makeHit('thrashing', 'b')]

      const { result } = await semanticStage(hits, 0.90, embedFn)

      expect(spy.callCount).toBe(1) // embedFn 한 번만 호출
      expect(result.pairs).toHaveLength(1)
    })

    it('hits가 3개 → 3개 pair 생성 (C(3,2)=3)', async () => {
      const embedFn = async (texts: string[]): Promise<number[][]> =>
        texts.map(() => [1, 0])
      const hits = [
        makeHit('thrashing', 'a'),
        makeHit('thrashing', 'b'),
        makeHit('thrashing', 'c'),
      ]

      const { result } = await semanticStage(hits, 0.90, embedFn)

      expect(result.pairs).toHaveLength(3) // C(3,2) = 3
    })
  })

  describe('EmbeddingSimilarityResult 구조 (BLOCKER C8)', () => {
    it('result에 pairCount 필드가 없어야 함 (BLOCKER C8)', async () => {
      const hits = [makeHit('thrashing', 'a'), makeHit('thrashing', 'b')]
      const embedFn = async (texts: string[]): Promise<number[][]> =>
        texts.map(() => [1, 0])

      const { result } = await semanticStage(hits, 0.90, embedFn)

      expect(result).not.toHaveProperty('pairCount')
    })

    it('result.pairs의 각 원소에 a, b, cos 필드가 있어야 함', async () => {
      const hits = [makeHit('thrashing', 'edit_loop'), makeHit('thrashing', 'edit_loop')]
      const embedFn = async (texts: string[]): Promise<number[][]> =>
        texts.map(() => [1, 0])

      const { result } = await semanticStage(hits, 0.90, embedFn)

      expect(result.pairs).toHaveLength(1)
      const pair = result.pairs[0]!
      expect(pair).toHaveProperty('a')
      expect(pair).toHaveProperty('b')
      expect(pair).toHaveProperty('cos')
      expect(typeof pair.a).toBe('string')
      expect(typeof pair.b).toBe('string')
      expect(typeof pair.cos).toBe('number')
    })

    it('result.maxCosine은 pairs 중 최대 cos 값', async () => {
      // 세 hit: 첫 두 개는 유사(cos≈1.0), 세 번째는 다름
      const hits = [
        makeHit('thrashing', 'a'),
        makeHit('thrashing', 'b'),
        makeHit('thrashing', 'c'),
      ]
      // vec[0]=[1,0], vec[1]=[1,0] (동일→cos=1.0), vec[2]=[0,1] (직교→cos=0.0)
      const embedFn = async (texts: string[]): Promise<number[][]> =>
        texts.map((_, i) => (i < 2 ? [1, 0] : [0, 1]))

      const { result } = await semanticStage(hits, 0.90, embedFn)

      // pair(0,1)=1.0, pair(0,2)=0.0, pair(1,2)=0.0
      expect(result.maxCosine).toBeCloseTo(1.0, 8)
    })
  })

  describe('normalizeContent 적용 검증', () => {
    it('DetectionHit의 gate.type + gate.subtype으로 텍스트가 생성됨', async () => {
      let capturedTexts: string[] = []
      const embedFn = async (texts: string[]): Promise<number[][]> => {
        capturedTexts = [...texts]
        return texts.map(() => [1, 0])
      }
      const hits = [
        makeHit('thrashing', 'Edit Loop'),
        makeHit('false_success', 'Self Approval'),
      ]

      await semanticStage(hits, 0.90, embedFn)

      // 정규화: lowercase, whitespace collapse
      expect(capturedTexts[0]).toBe('thrashing edit loop')
      expect(capturedTexts[1]).toBe('false_success self approval')
    })

    it('텍스트가 lowercase로 변환됨', async () => {
      let capturedTexts: string[] = []
      const embedFn = async (texts: string[]): Promise<number[][]> => {
        capturedTexts = [...texts]
        return texts.map(() => [1, 0])
      }
      const hits = [
        makeHit('thrashing', 'UPPERCASE_TYPE'),
        makeHit('thrashing', 'another_type'),
      ]

      await semanticStage(hits, 0.90, embedFn)

      // 모두 소문자
      expect(capturedTexts.every(t => t === t.toLowerCase())).toBe(true)
    })

    it('결과 텍스트가 500자를 초과하지 않음', async () => {
      let capturedTexts: string[] = []
      const embedFn = async (texts: string[]): Promise<number[][]> => {
        capturedTexts = [...texts]
        return texts.map(() => [1, 0])
      }
      // subtype에 긴 문자열 설정
      const longSubtype = 'x'.repeat(600)
      const hits = [
        makeHit('thrashing', longSubtype),
        makeHit('thrashing', longSubtype),
      ]

      await semanticStage(hits, 0.90, embedFn)

      expect(capturedTexts.every(t => t.length <= 500)).toBe(true)
    })
  })

  describe('fail-closed: embedFn 실패 시 예외 전파', () => {
    it('embedFn이 throw하면 semanticStage도 throw (fail-closed)', async () => {
      const embedFn = async (_texts: string[]): Promise<number[][]> => {
        throw new Error('embed API failed')
      }
      const hits = [makeHit('thrashing', 'a'), makeHit('thrashing', 'b')]

      await expect(semanticStage(hits, 0.90, embedFn)).rejects.toThrow(
        'embed API failed',
      )
    })
  })

  describe('불변성: 입력 배열 변경 금지', () => {
    it('semanticStage는 입력 hits 배열을 변경하지 않음', async () => {
      const hits = [makeHit('thrashing', 'a'), makeHit('thrashing', 'b')]
      const originalHits = [...hits]
      const embedFn = async (texts: string[]): Promise<number[][]> =>
        texts.map(() => [1, 0])

      await semanticStage(hits, 0.90, embedFn)

      expect(hits).toEqual(originalHits)
      expect(hits).toHaveLength(2)
    })
  })
})
