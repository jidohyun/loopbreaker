/**
 * tests/semantic-to-judge-integration-sub-ac-10b.test.ts
 *
 * Sub-AC 10b: semantic-stage → judge-stage 연결 통합 테스트
 *
 * EmbeddingSimilarityResult를 입력으로 Mock LLM 클라이언트가 JudgeVerdict를
 * 반환하는 end-to-end 경로를 검증하는 단일 테스트 함수.
 *
 * 검증 경로:
 *   1. MockEmbedClient → computeEmbeddingSimilarityFromContents
 *      → EmbeddingSimilarityResult (maxCosine, pairs)
 *   2. EmbeddingSimilarityResult.maxCosine >= simThresh → SemanticSignal.STRONG
 *   3. STRONG 신호 → gate.pass=true → runJudgeStage 호출
 *   4. MockJudgeClient (position swap × n) → JudgeVerdict (rawSamples 포함)
 *
 * 제약:
 *   - 외부 API 절대 미호출: MockEmbedClient + MockJudgeClient만 사용
 *   - 네트워크·API 키 불필요
 *   - BLOCKER C1: kind ∈ {'thrashing','false_success','none'}
 *   - BLOCKER C2: JudgeVerdict는 contracts.ts 정본
 *   - BLOCKER C8: EmbeddingSimilarityResult.pairs:{a,b,cos}[] (pairCount 금지)
 */

import {
  computeEmbeddingSimilarityFromContents,
  evaluateSemanticSignal,
  SemanticSignal,
} from '../src/detect/semantic-stage.js'
import { runJudgeStage } from '../src/detect/run-judge-stage.js'
import { MockEmbedClient } from '../src/api/embed-client.js'
import type { GateCandidate } from '../src/detect/filter-gate-passed.js'
import type { PositionSwapContext } from '../src/detect/build-position-swapped-pairs.js'
import type { JudgeVerdict } from '../src/contracts.js'
import type { JudgeClient, JudgeRequest } from '../src/api/judge-client.js'

// ── 테스트 픽스처 ─────────────────────────────────────────────────────────────

const MODEL_ID = 'claude-3-5-sonnet-20241022'
const SIM_THRESH = 0.8
const DIM = 4

/**
 * 높은 유사도(cosine ≈ 1.0)를 가지는 벡터 쌍.
 * thrashing 시나리오: 두 발화가 의미적으로 거의 동일.
 */
const HIGH_SIM_VECTORS = {
  textA: 'write /src/app.ts iteration-1',
  vecA: [0.9, 0.1, 0.0, 0.0],
  textB: 'write /src/app.ts iteration-2',
  vecB: [0.9, 0.1, 0.0, 0.0], // 같은 방향 벡터 → cosine = 1.0, 텍스트는 구별 가능
}

/**
 * 낮은 유사도(cosine ≈ 0.0)를 가지는 벡터 쌍.
 * 게이트 미통과 시나리오: 두 발화가 의미적으로 다름.
 */
const LOW_SIM_VECTORS = {
  textA: 'read /README.md',
  vecA: [1.0, 0.0, 0.0, 0.0],
  textB: 'bash npm test',
  vecB: [0.0, 0.0, 0.0, 1.0], // 직교 벡터 → cosine = 0.0
}

const FALSE_SUCCESS_VERDICT: JudgeVerdict = {
  kind: 'false_success',
  subtype: 'unsupported_completion_claim',
  confidence: 0.9,
  circularReference: false,
  reason: '근거 없는 완료 선언이 감지되었습니다.',
  rawSamples: [],
}

const THRASHING_VERDICT: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'stuck_error_loop',
  confidence: 0.85,
  reason: '동일 에러 패턴이 반복되었습니다.',
  rawSamples: [],
}

/**
 * MockJudgeClient — 모든 judge 호출에 고정 JudgeVerdict를 반환하는 인라인 구현체.
 * position swap 원본·swap 호출 모두 동일 verdict 반환 (통합 테스트 단순화).
 */
function makeDeterministicJudgeClient(verdict: JudgeVerdict): JudgeClient {
  return {
    async judge(_req: JudgeRequest): Promise<JudgeVerdict> {
      // 외부 API 절대 미호출 — 고정 verdict 반환
      return verdict
    },
  }
}

/**
 * call-tracking MockJudgeClient — 호출 횟수와 마지막 요청을 추적한다.
 */
function makeTrackingJudgeClient(verdict: JudgeVerdict): {
  client: JudgeClient
  callCount: () => number
  lastReqs: () => readonly JudgeRequest[]
} {
  const reqs: JudgeRequest[] = []
  const client: JudgeClient = {
    async judge(req: JudgeRequest): Promise<JudgeVerdict> {
      reqs.push(req)
      return verdict
    },
  }
  return {
    client,
    callCount: () => reqs.length,
    lastReqs: () => reqs,
  }
}

const GATE_CANDIDATE_PASSED: GateCandidate = {
  gate: null,
  gate_passed: true,
  triggerUuid: 'uuid-integration-10b',
  ts: Date.now(),
}

const GATE_CANDIDATE_FAILED: GateCandidate = {
  gate: null,
  gate_passed: false,
  triggerUuid: 'uuid-integration-10b-fail',
  ts: Date.now(),
}

function makeCtx(posA: string, posB: string): PositionSwapContext {
  return {
    positionA: posA,
    positionB: posB,
    cacheableBlock: '루브릭: 아래 두 발화가 thrashing 패턴인지 판정하라.',
    modelId: MODEL_ID,
    kind: 'false_success',
    temperature: 0,
  }
}

// ── 핵심 end-to-end 통합 테스트 ───────────────────────────────────────────────

describe('Sub-AC 10b: semantic-stage → judge-stage end-to-end 통합', () => {
  /**
   * 핵심 단일 테스트 함수:
   * EmbeddingSimilarityResult를 입력으로 Mock LLM 클라이언트가
   * JudgeVerdict를 반환하는 end-to-end 경로 검증.
   */
  test('semantic-stage EmbeddingSimilarityResult → judge-stage JudgeVerdict end-to-end', async () => {
    // ── STEP 1: MockEmbedClient로 임베딩 유사도 계산 ──────────────────────────
    const embedClient = new MockEmbedClient(
      [
        { text: HIGH_SIM_VECTORS.textA, vector: HIGH_SIM_VECTORS.vecA },
        { text: HIGH_SIM_VECTORS.textB, vector: HIGH_SIM_VECTORS.vecB },
      ],
      DIM,
    )

    const contents = [HIGH_SIM_VECTORS.textA, HIGH_SIM_VECTORS.textB]
    const embedResult = await computeEmbeddingSimilarityFromContents(
      contents,
      (texts) => embedClient.embed(texts),
    )

    // EmbeddingSimilarityResult 계약 검증 (BLOCKER C8: pairs:{a,b,cos}[])
    expect(embedResult).toHaveProperty('maxCosine')
    expect(embedResult).toHaveProperty('pairs')
    expect(Array.isArray(embedResult.pairs)).toBe(true)
    // pairCount 필드 금지 (BLOCKER C8)
    expect(embedResult).not.toHaveProperty('pairCount')

    // 동일 벡터 → maxCosine ≈ 1.0
    expect(embedResult.maxCosine).toBeCloseTo(1.0, 5)
    expect(embedResult.pairs).toHaveLength(1)
    expect(embedResult.pairs[0]).toHaveProperty('a', HIGH_SIM_VECTORS.textA)
    expect(embedResult.pairs[0]).toHaveProperty('b', HIGH_SIM_VECTORS.textB)
    expect(embedResult.pairs[0]!.cos).toBeCloseTo(1.0, 5)

    // ── STEP 2: SemanticSignal 판정 ───────────────────────────────────────────
    const signal = evaluateSemanticSignal(embedResult, SIM_THRESH)

    // maxCosine(≈1.0) >= simThresh(0.8) → STRONG
    expect(signal).toBe(SemanticSignal.STRONG)

    // ── STEP 3: STRONG → gate.pass=true → runJudgeStage 호출 ─────────────────
    const { client: judgeClient, callCount, lastReqs } = makeTrackingJudgeClient(FALSE_SUCCESS_VERDICT)
    const ctx = makeCtx(HIGH_SIM_VECTORS.textA, HIGH_SIM_VECTORS.textB)

    // selfConsistencyN=1 → 원본(1회) + swap(1회) = 2회 호출
    const stageResult = await runJudgeStage(GATE_CANDIDATE_PASSED, judgeClient, ctx, 1)

    // gate.pass=true → skipped=false, verdict 존재
    expect(stageResult.skipped).toBe(false)
    expect(stageResult.verdict).toBeDefined()

    // position swap: 원본 1회 + swap 1회 = 2회 호출
    expect(callCount()).toBe(2)

    // ── STEP 4: JudgeVerdict 계약 검증 (BLOCKER C1/C2) ───────────────────────
    const verdict = stageResult.verdict!

    // BLOCKER C1: kind ∈ {'thrashing','false_success','none'}
    expect(['thrashing', 'false_success', 'none']).toContain(verdict.kind)
    // BLOCKER C2: JudgeVerdict 필드 정본
    expect(verdict).toHaveProperty('subtype')
    expect(verdict).toHaveProperty('confidence')
    expect(verdict).toHaveProperty('reason')
    expect(verdict).toHaveProperty('rawSamples')
    expect(Array.isArray(verdict.rawSamples)).toBe(true)

    // rawSamples에 n×2=2개 응답 보존 (SPEC §5)
    expect(verdict.rawSamples).toHaveLength(2)

    // candidate 참조 보존
    expect(stageResult.candidate).toBe(GATE_CANDIDATE_PASSED)

    // ── STEP 5: position swap 편향완화 — 두 요청의 volatileBlock이 다름 ────────
    const reqs = lastReqs()
    expect(reqs).toHaveLength(2)
    // 원본: positionA → A위치, positionB → B위치
    // swap: positionB → A위치, positionA → B위치
    // volatileBlock이 서로 달라야 함 (SPEC §5)
    expect(reqs[0]!.volatileBlock).not.toBe(reqs[1]!.volatileBlock)
    // 동일 cacheableBlock
    expect(reqs[0]!.cacheableBlock).toBe(reqs[1]!.cacheableBlock)
    // 동일 modelId
    expect(reqs[0]!.modelId).toBe(MODEL_ID)
    expect(reqs[1]!.modelId).toBe(MODEL_ID)
  })

  // ── 보조 검증: gate.pass=false → judge 미호출 ─────────────────────────────

  test('semantic 신호 약함(WEAK) 시나리오: maxCosine < simThresh → judge 미호출 경로', async () => {
    // 낮은 유사도 임베딩
    const embedClient = new MockEmbedClient(
      [
        { text: LOW_SIM_VECTORS.textA, vector: LOW_SIM_VECTORS.vecA },
        { text: LOW_SIM_VECTORS.textB, vector: LOW_SIM_VECTORS.vecB },
      ],
      DIM,
    )

    const contents = [LOW_SIM_VECTORS.textA, LOW_SIM_VECTORS.textB]
    const embedResult = await computeEmbeddingSimilarityFromContents(
      contents,
      (texts) => embedClient.embed(texts),
    )

    // 직교 벡터 → maxCosine = 0.0
    expect(embedResult.maxCosine).toBeCloseTo(0.0, 5)

    // WEAK 신호 → judge 미호출 대상
    const signal = evaluateSemanticSignal(embedResult, SIM_THRESH)
    expect(signal).toBe(SemanticSignal.WEAK)

    // gate.pass=false 후보로 runJudgeStage → skipped=true
    const judgeClient = makeDeterministicJudgeClient(THRASHING_VERDICT)
    const ctx = makeCtx(LOW_SIM_VECTORS.textA, LOW_SIM_VECTORS.textB)

    const stageResult = await runJudgeStage(GATE_CANDIDATE_FAILED, judgeClient, ctx, 1)

    expect(stageResult.skipped).toBe(true)
    expect(stageResult.verdict).toBeUndefined()
  })

  // ── self-consistency N=3 → rawSamples.length = 6 ────────────────────────

  test('selfConsistencyN=3 시 rawSamples에 6개(3×2) 응답이 보존된다', async () => {
    const embedClient = new MockEmbedClient(
      [
        { text: HIGH_SIM_VECTORS.textA, vector: HIGH_SIM_VECTORS.vecA },
        { text: HIGH_SIM_VECTORS.textB, vector: HIGH_SIM_VECTORS.vecB },
      ],
      DIM,
    )

    const contents = [HIGH_SIM_VECTORS.textA, HIGH_SIM_VECTORS.textB]
    const embedResult = await computeEmbeddingSimilarityFromContents(
      contents,
      (texts) => embedClient.embed(texts),
    )

    // STRONG 신호 확인
    const signal = evaluateSemanticSignal(embedResult, SIM_THRESH)
    expect(signal).toBe(SemanticSignal.STRONG)

    // N=3 → 원본 3회 + swap 3회 = 6회 judge 호출
    const { client: judgeClient, callCount } = makeTrackingJudgeClient(FALSE_SUCCESS_VERDICT)
    const ctx = makeCtx(HIGH_SIM_VECTORS.textA, HIGH_SIM_VECTORS.textB)

    const stageResult = await runJudgeStage(GATE_CANDIDATE_PASSED, judgeClient, ctx, 3)

    expect(stageResult.skipped).toBe(false)
    expect(stageResult.verdict).toBeDefined()
    // 3×2=6회 호출
    expect(callCount()).toBe(6)
    // rawSamples에 6개 보존
    expect(stageResult.verdict!.rawSamples).toHaveLength(6)
  })

  // ── EmbeddingSimilarityResult → JudgeVerdict 타입 계약 일관성 ───────────────

  test('EmbeddingSimilarityResult.pairs 계약: pairCount 필드 없음(BLOCKER C8)', async () => {
    const embedClient = new MockEmbedClient(
      [
        { text: HIGH_SIM_VECTORS.textA, vector: HIGH_SIM_VECTORS.vecA },
        { text: HIGH_SIM_VECTORS.textB, vector: HIGH_SIM_VECTORS.vecB },
      ],
      DIM,
    )

    const embedResult = await computeEmbeddingSimilarityFromContents(
      [HIGH_SIM_VECTORS.textA, HIGH_SIM_VECTORS.textB],
      (texts) => embedClient.embed(texts),
    )

    // BLOCKER C8: pairCount 필드 금지
    expect(embedResult).not.toHaveProperty('pairCount')
    // pairs는 배열
    expect(Array.isArray(embedResult.pairs)).toBe(true)
    // 각 pair는 {a, b, cos} 구조
    for (const pair of embedResult.pairs) {
      expect(pair).toHaveProperty('a')
      expect(pair).toHaveProperty('b')
      expect(pair).toHaveProperty('cos')
      expect(typeof pair.a).toBe('string')
      expect(typeof pair.b).toBe('string')
      expect(typeof pair.cos).toBe('number')
    }
  })

  test('JudgeVerdict 계약: kind는 허용된 리터럴만(BLOCKER C1)', async () => {
    const judgeClient = makeDeterministicJudgeClient(FALSE_SUCCESS_VERDICT)
    const ctx = makeCtx(HIGH_SIM_VECTORS.textA, HIGH_SIM_VECTORS.textB)

    const stageResult = await runJudgeStage(GATE_CANDIDATE_PASSED, judgeClient, ctx, 1)
    const verdict = stageResult.verdict!

    // BLOCKER C1
    const validKinds = ['thrashing', 'false_success', 'none'] as const
    expect(validKinds).toContain(verdict.kind)
  })
})
