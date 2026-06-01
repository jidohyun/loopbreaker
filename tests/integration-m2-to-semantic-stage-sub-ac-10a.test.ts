/**
 * tests/integration-m2-to-semantic-stage-sub-ac-10a.test.ts
 *
 * Sub-AC 10a: M2 DetectionHit → semantic-stage 연결 통합 테스트
 *
 * M2가 생성한 DetectionHit 입력이 semantic-stage를 통해
 * EmbeddingSimilarityResult를 올바르게 생성하는 end-to-end 경로를 검증한다.
 *
 * 외부 API 절대 미호출 — MockEmbedClient만 사용. 네트워크·API 키 불필요.
 */

import { MockEmbedClient, type MockEmbedEntry } from '../src/api/embed-client.js'
import { semanticStage, normalizeContent } from '../src/detect/semantic-stage.js'
import type { DetectionHit } from '../src/detect/detection-pipeline.js'
import type { StructureGateResult } from '../src/contracts.js'

// ── 헬퍼: DetectionHit 픽스처 생성 ──────────────────────────────────────────

function makeHit(type: string, subtype: string, overrides?: Partial<StructureGateResult>): DetectionHit {
  const gate: StructureGateResult = {
    type: type as 'thrashing' | 'false_success',
    subtype,
    severity: 'warning',
    sessionId: 'session-001',
    agentScope: 'root',
    windowRefs: ['uuid-1', 'uuid-2'],
    metrics: { repeatCount: 3 },
    ...overrides,
  }
  return { gate, triggerUuid: `trigger-${subtype}`, ts: Date.now() }
}

// ── 픽스처: 두 hit의 normalizedContent ───────────────────────────────────────

const HIT_A = makeHit('thrashing', 'repeat_edit')
const HIT_B = makeHit('thrashing', 'repeat_edit')  // 동일 content → 고유사도

const CONTENT_A = normalizeContent(`${HIT_A.gate.type} ${HIT_A.gate.subtype}`)
// CONTENT_B === CONTENT_A ("thrashing repeat_edit") — same normalized text → high cosine

// 두 hit의 content는 동일 ("thrashing repeat_edit")
const SHARED_VECTOR = [1.0, 0.0, 0.0, 0.0]

const ENTRIES: MockEmbedEntry[] = [
  { text: CONTENT_A, vector: SHARED_VECTOR },
]

const EMBED_DIM = 4

// ── 메인 통합 테스트 ──────────────────────────────────────────────────────────

describe('M2 DetectionHit → semantic-stage integration (Sub-AC 10a)', () => {
  it('DetectionHit inputs produce EmbeddingSimilarityResult via semanticStage (end-to-end)', async () => {
    // GIVEN: MockEmbedClient에 두 hit의 content 벡터를 등록
    const client = new MockEmbedClient(ENTRIES, EMBED_DIM)
    const embedFn = client.embed.bind(client)
    const simThresh = 0.85

    // WHEN: M2 DetectionHit 배열을 semantic-stage에 입력
    const { result, triggered } = await semanticStage([HIT_A, HIT_B], simThresh, embedFn)

    // THEN: EmbeddingSimilarityResult가 올바르게 생성됨
    expect(result).toBeDefined()
    expect(result.maxCosine).toBeCloseTo(1.0, 6)

    // THEN: pairs 배열이 BLOCKER C8 정본 형태로 생성됨 ({a, b, cos}[])
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0]).toMatchObject({
      a: expect.any(String),
      b: expect.any(String),
      cos: expect.any(Number),
    })
    // pairCount 필드 금지 (BLOCKER C8)
    expect(result).not.toHaveProperty('pairCount')

    // THEN: maxCosine >= simThresh이므로 triggered=true
    expect(triggered).toBe(true)
  })

  it('different-content DetectionHits produce low cosine similarity', async () => {
    // GIVEN: 의미적으로 다른 두 hit
    const hitX = makeHit('thrashing', 'alpha_pattern')
    const hitY = makeHit('false_success', 'beta_pattern')

    const contentX = normalizeContent(`${hitX.gate.type} ${hitX.gate.subtype}`)
    const contentY = normalizeContent(`${hitY.gate.type} ${hitY.gate.subtype}`)

    // 직교 벡터 → 코사인 0.0
    const vecX = [1.0, 0.0, 0.0, 0.0]
    const vecY = [0.0, 1.0, 0.0, 0.0]

    const client = new MockEmbedClient(
      [
        { text: contentX, vector: vecX },
        { text: contentY, vector: vecY },
      ],
      EMBED_DIM,
    )
    const embedFn = client.embed.bind(client)
    const simThresh = 0.85

    // WHEN
    const { result, triggered } = await semanticStage([hitX, hitY], simThresh, embedFn)

    // THEN: 코사인 유사도가 낮음 (직교 벡터 → 0.0)
    expect(result.maxCosine).toBeCloseTo(0.0, 6)
    expect(triggered).toBe(false)
  })

  it('fewer than 2 DetectionHits returns empty pairs with triggered=false', async () => {
    const client = new MockEmbedClient([], EMBED_DIM)
    const embedFn = client.embed.bind(client)

    // WHEN: 단일 hit (쌍 없음)
    const { result, triggered } = await semanticStage([HIT_A], 0.85, embedFn)

    // THEN
    expect(result.maxCosine).toBe(0)
    expect(result.pairs).toHaveLength(0)
    expect(triggered).toBe(false)
  })
})
