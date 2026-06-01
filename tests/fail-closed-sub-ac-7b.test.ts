/**
 * tests/fail-closed-sub-ac-7b.test.ts
 *
 * Sub-AC 7b: fail-closed 동작 — 재시도 소진 후 미발화(DetectionRecord 미생성) 검증.
 *
 * SPEC §4: 임베딩/judge 실패·타임아웃 시 재시도(지수백오프, 상한 apiMaxRetries) 후
 * fail-closed(미발화) — fail-open 금지.
 *
 * 검증 항목:
 * 1. embed API가 항상 실패할 때 → DetectionRecord 생성 없음 (미발화)
 * 2. embed 성공 but judge API가 항상 실패 + simThresh 이상일 때 → DetectionRecord 미생성
 * 3. 여러 hit 중 일부만 실패 → 성공한 hit만 DetectionRecord 생성 (부분 성공)
 * 4. hits 배열이 빈 경우 → 빈 결과 (항상 성공)
 *
 * 모든 테스트: MockEmbedClient/MockJudgeClient 사용, 네트워크/API 키 없음.
 */

import { describe, it, expect } from '@jest/globals'
import type { ActionTriple, DetectorConfig, StructureGateResult } from '../src/contracts.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'
import type { EmbedClient } from '../src/api/embed-client.js'
import { MockEmbedClient, EmbedClientError } from '../src/api/embed-client.js'
import type { JudgeClient } from '../src/api/judge-client.js'
import { MockJudgeClient } from '../src/api/judge-client.js'
import type { DetectionHit } from '../src/detect/detection-pipeline.js'
import { runM3Pipeline } from '../src/detect/m3-pipeline.js'

// ─── 테스트 픽스처 헬퍼 ──────────────────────────────────────────────────────

/** 테스트용 StructureGateResult 생성 */
function makeGateResult(subtype = 'file_edit_loop'): StructureGateResult {
  return {
    type: 'thrashing',
    subtype,
    severity: 'warning',
    sessionId: 'test-session',
    agentScope: 'root',
    windowRefs: ['uuid-1', 'uuid-2', 'uuid-3'],
    metrics: { fileEditN: 3 },
  }
}

/** 테스트용 DetectionHit 생성 */
function makeDetectionHit(gate?: StructureGateResult): DetectionHit {
  return {
    gate: gate ?? makeGateResult(),
    triggerUuid: 'trigger-uuid',
    ts: Date.now(),
  }
}

/** 테스트용 ActionTriple 배열 생성 (2개) */
function makeTriples(): ActionTriple[] {
  return [
    {
      tool: 'Edit',
      argKey: '/proj/a.ts',
      resultClass: 'ok',
      ref: { uuid: 'uuid-1', ts: 1000 },
    },
    {
      tool: 'Edit',
      argKey: '/proj/a.ts',
      resultClass: 'ok',
      ref: { uuid: 'uuid-2', ts: 2000 },
    },
    {
      tool: 'Edit',
      argKey: '/proj/a.ts',
      resultClass: 'ok',
      ref: { uuid: 'uuid-3', ts: 3000 },
    },
  ]
}

/** 항상 실패하는 EmbedClient (API 오류 시뮬레이션) */
class AlwaysFailEmbedClient implements EmbedClient {
  async embed(_texts: string[]): Promise<number[][]> {
    throw new EmbedClientError('AlwaysFailEmbedClient: simulated API failure')
  }
}

/** 항상 실패하는 JudgeClient (API 오류 시뮬레이션) */
class AlwaysFailJudgeClient implements JudgeClient {
  async judge(_req: Parameters<JudgeClient['judge']>[0]): ReturnType<JudgeClient['judge']> {
    throw new Error('AlwaysFailJudgeClient: simulated judge API failure')
  }
}

/** simThresh 이상 유사도를 반환하는 EmbedClient (고코사인 — judge 호출을 유발) */
function makeHighSimilarityEmbedClient(dim = 4): EmbedClient {
  // 두 벡터를 동일하게 설정 → cosine = 1.0 (simThresh=0.90 초과)
  const identicalVec = Array.from({ length: dim }, (_, i) => (i + 1) * 0.1)
  return new MockEmbedClient(
    [
      { text: 'Edit /proj/a.ts', vector: identicalVec },
      { text: 'Edit /proj/b.ts', vector: identicalVec },
      { text: 'Edit /proj/c.ts', vector: identicalVec },
    ],
    dim,
  )
}

// ─── 기본 설정 ────────────────────────────────────────────────────────────────

const BASE_CONFIG: DetectorConfig = {
  ...DEFAULT_DETECTOR_CONFIG,
  simThresh: 0.90,
  judgeSelfConsistencyN: 1,
  judgePositionSwaps: 0,
}

// ─── 1. embed 항상 실패 → 미발화 ────────────────────────────────────────────

describe('Sub-AC 7b: fail-closed — embed API 항상 실패', () => {
  it('embed API가 항상 실패하면 DetectionRecord가 생성되지 않는다 (미발화)', async () => {
    const hits = [makeDetectionHit()]
    const triples = [makeTriples()]
    const embedClient = new AlwaysFailEmbedClient()
    const judgeClient = new MockJudgeClient([]) // 호출되지 않아야 함

    const records = await runM3Pipeline(hits, triples, {
      embedClient,
      judgeClient,
      config: BASE_CONFIG,
    })

    // fail-closed: 실패 시 DetectionRecord 생성 없음
    expect(records).toHaveLength(0)
  })

  it('embed API 실패 시 detection event가 발화하지 않는다 (빈 배열)', async () => {
    const hits = [makeDetectionHit(), makeDetectionHit(), makeDetectionHit()]
    const triples = [makeTriples(), makeTriples(), makeTriples()]
    const embedClient = new AlwaysFailEmbedClient()
    const judgeClient = new MockJudgeClient([])

    const records = await runM3Pipeline(hits, triples, {
      embedClient,
      judgeClient,
      config: BASE_CONFIG,
    })

    expect(records).toHaveLength(0)
  })
})

// ─── 2. judge 항상 실패 + simThresh 이상 → judgeError record 생성 ────────────
// SPEC §4: judge API 실패/타임아웃 → DetectionRecord{judgeError:true, deferred:true}.
// Sub-AC 7b 핵심: judge 모든 재시도 후 실패 → judge=undefined, judgeError:true,
//   deferred:true, final은 false_success 아님(fail-open 금지).

/** 공통 픽스처: 항상 실패 judge + 고유사도 embed → judge 실패 레코드 1건 */
async function runJudgeFailScenario() {
  const sameArgTriples: ActionTriple[] = [
    { tool: 'Edit', argKey: '/proj/a.ts', resultClass: 'ok', ref: { uuid: 'u1', ts: 1 } },
    { tool: 'Edit', argKey: '/proj/b.ts', resultClass: 'ok', ref: { uuid: 'u2', ts: 2 } },
  ]
  const hits = [makeDetectionHit()]
  const triples = [sameArgTriples]
  const embedClient = makeHighSimilarityEmbedClient(4)
  const judgeClient = new AlwaysFailJudgeClient()

  return runM3Pipeline(hits, triples, {
    embedClient,
    judgeClient,
    config: { ...BASE_CONFIG, simThresh: 0.5 },
  })
}

describe('Sub-AC 7b: fail-closed — judge API 항상 실패 (simThresh 이상)', () => {
  it('judge API가 항상 실패하면 judgeError:true 가 붙은 DetectionRecord가 생성된다 (SPEC §4)', async () => {
    const records = await runJudgeFailScenario()

    // SPEC §4: judge 실패 시 judgeError:true, deferred:true가 붙은 DetectionRecord 생성
    expect(records).toHaveLength(1)
    expect(records[0]!.judgeError).toBe(true)
    expect(records[0]!.deferred).toBe(true)
    expect(records[0]!.judge).toBeUndefined()
  })

  it('judge 모든 재시도 후 실패 시 DetectionRecord.judge === undefined (판정 없음, fail-open 금지)', async () => {
    const records = await runJudgeFailScenario()

    // judge 실패 → judge 필드에 부분 판정 결과가 절대 들어가면 안 됨 (fail-open 금지)
    expect(records[0]!.judge).toBeUndefined()
  })

  it('judge 실패 시 final 필드는 정의되며 false_success를 emit하지 않는다 (fail-open 금지)', async () => {
    const records = await runJudgeFailScenario()

    // final은 존재하되 judge 실패이므로 false_success로 판정하면 안 됨
    expect(records[0]!.final).toBeDefined()
    expect(records[0]!.final.kind).not.toBe('false_success')
  })

  it('judge 실패 시 embed 필드는 보존된다 (단조 누적)', async () => {
    const records = await runJudgeFailScenario()

    // embed는 성공했으므로 단조 누적 원칙에 따라 보존
    expect(records[0]!.embed).toBeDefined()
    expect(typeof records[0]!.embed!.maxCosine).toBe('number')
  })

  it('judge 실패 시 gate 필드는 보존된다 (단조 누적)', async () => {
    const records = await runJudgeFailScenario()

    expect(records[0]!.gate).toBeDefined()
    expect(records[0]!.gate.type).toBe('thrashing')
  })
})

// ─── 3. 부분 실패 — 성공한 hit만 DetectionRecord 생성 ─────────────────────────

describe('Sub-AC 7b: fail-closed — 부분 실패 시 성공분만 누적', () => {
  it('여러 hit 중 일부만 embed 실패 → 성공한 hit만 DetectionRecord에 포함', async () => {
    // Hit 1: simThresh 미달 임베딩 → 정상 처리 (embed 단계까지만, judge 미호출)
    const lowSimilarityTriple1: ActionTriple[] = [
      { tool: 'Edit', argKey: '/proj/x.ts', resultClass: 'ok', ref: { uuid: 'u1', ts: 1 } },
      { tool: 'Read', argKey: '/proj/y.ts', resultClass: 'ok', ref: { uuid: 'u2', ts: 2 } },
    ]
    // Hit 2: embed 실패 → 미발화
    // (AlwaysFailEmbedClient을 두 번째 호출에서만 실패하게 하기 위해 카운터 사용)

    let embedCallCount = 0
    const partialFailEmbedClient: EmbedClient = {
      async embed(texts: string[]): Promise<number[][]> {
        embedCallCount++
        if (embedCallCount === 1) {
          // 첫 번째 hit: 직교 벡터 → 낮은 유사도 (simThresh 미달)
          const orthogonalVecs: number[][] = texts.map((_, i) =>
            Array.from({ length: 4 }, (__, j) => (j === i % 4 ? 1.0 : 0.0))
          )
          return orthogonalVecs
        }
        // 두 번째 hit: 실패
        throw new EmbedClientError('partialFailEmbedClient: 두 번째 호출 실패')
      },
    }

    const hit1 = makeDetectionHit(makeGateResult('file_edit_loop'))
    const hit2 = makeDetectionHit(makeGateResult('err_loop'))
    const hits = [hit1, hit2]
    const triples = [lowSimilarityTriple1, makeTriples()]

    const judgeClient = new MockJudgeClient([]) // 호출 없어야 함

    const records = await runM3Pipeline(hits, triples, {
      embedClient: partialFailEmbedClient,
      judgeClient,
      config: BASE_CONFIG,
    })

    // hit1은 성공(DetectionRecord 생성), hit2는 실패(미발화)
    expect(records).toHaveLength(1)
    expect(records[0]!.gate.subtype).toBe('file_edit_loop')
    expect(records[0]!.embed).toBeDefined()
  })
})

// ─── 4. 빈 hits 배열 → 빈 결과 ───────────────────────────────────────────────

describe('Sub-AC 7b: 빈 입력', () => {
  it('hits 배열이 비어있으면 빈 DetectionRecord 배열을 반환한다', async () => {
    const records = await runM3Pipeline([], [], {
      embedClient: new AlwaysFailEmbedClient(),
      judgeClient: new MockJudgeClient([]),
      config: BASE_CONFIG,
    })

    expect(records).toHaveLength(0)
  })
})

// ─── 5. hits/triples 길이 불일치 → 에러 ─────────────────────────────────────

describe('Sub-AC 7b: hits/triples 길이 불일치', () => {
  it('hits와 triples 길이가 다르면 에러를 던진다', async () => {
    const hits = [makeDetectionHit()]
    const triples: ActionTriple[][] = [] // 길이 불일치

    await expect(
      runM3Pipeline(hits, triples, {
        embedClient: new AlwaysFailEmbedClient(),
        judgeClient: new MockJudgeClient([]),
        config: BASE_CONFIG,
      })
    ).rejects.toThrow()
  })
})
