/**
 * tests/judge-error-sub-ac-7c.test.ts
 *
 * Sub-AC 7c: judge 실패 시 judgeError 마킹 검증.
 *
 * SPEC §4: judge API 실패/타임아웃 → 재시도 후 실패 시
 *   DetectionRecord{judgeError:true, deferred:true} 표시하고 미확정.
 *   알림은 보류하되, 구조+의미 신호만으로 LOW_CONFIDENCE 알림 옵션(config).
 *
 * 검증 항목:
 * 1. judge가 실패하면 DetectionRecord.judgeError === true
 * 2. DetectionRecord.deferred === true
 * 3. DetectionRecord.judge === undefined (판정 없음)
 * 4. DetectionRecord.final.kind !== 'false_success' (가짜성공 오판 금지)
 * 5. DetectionRecord.gate / embed 필드는 정상 보존 (단조 누적)
 * 6. embed 성공 + judge 실패 → 레코드 생성됨 (미발화 아님)
 *
 * 모든 테스트: MockEmbedClient/MockJudgeClient 사용, 네트워크/API 키 없음.
 */

import { describe, it, expect } from '@jest/globals'
import type { ActionTriple, DetectorConfig, StructureGateResult } from '../src/contracts.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'
import type { EmbedClient } from '../src/api/embed-client.js'
import { MockEmbedClient } from '../src/api/embed-client.js'
import type { JudgeClient } from '../src/api/judge-client.js'
import type { DetectionHit } from '../src/detect/detection-pipeline.js'
import { runM3Pipeline } from '../src/detect/m3-pipeline.js'

// ─── 픽스처 헬퍼 ─────────────────────────────────────────────────────────────

function makeGateResult(subtype = 'file_edit_loop'): StructureGateResult {
  return {
    type: 'thrashing',
    subtype,
    severity: 'warning',
    sessionId: 'sess-7c',
    agentScope: 'root',
    windowRefs: ['uuid-a', 'uuid-b', 'uuid-c'],
    metrics: { fileEditN: 5 },
  }
}

function makeDetectionHit(gate?: StructureGateResult): DetectionHit {
  return {
    gate: gate ?? makeGateResult(),
    triggerUuid: 'trigger-7c',
    ts: Date.now(),
  }
}

/** simThresh를 초과하는 고유사도 임베딩 클라이언트 */
function makeHighSimilarityEmbedClient(dim = 4): EmbedClient {
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

/** 항상 예외를 던지는 JudgeClient */
class AlwaysFailJudgeClient implements JudgeClient {
  async judge(_req: Parameters<JudgeClient['judge']>[0]): ReturnType<JudgeClient['judge']> {
    throw new Error('AlwaysFailJudgeClient: simulated judge API failure (AC 7c)')
  }
}

/** simThresh 이상 트리플 (embed 호출 유발) */
const HIGH_SIM_TRIPLES: ActionTriple[] = [
  { tool: 'Edit', argKey: '/proj/a.ts', resultClass: 'ok', ref: { uuid: 'ua', ts: 1000 } },
  { tool: 'Edit', argKey: '/proj/b.ts', resultClass: 'ok', ref: { uuid: 'ub', ts: 2000 } },
]

const BASE_CONFIG: DetectorConfig = {
  ...DEFAULT_DETECTOR_CONFIG,
  simThresh: 0.5, // 낮은 임계값 → 고유사도 embed로 judge 호출 확보
  judgeSelfConsistencyN: 1,
  judgePositionSwaps: 0,
}

// ─── 1. judge 실패 시 judgeError:true 레코드 생성 ─────────────────────────────

describe('Sub-AC 7c: judge 실패 → judgeError 마킹 DetectionRecord', () => {
  it('judge가 실패하면 DetectionRecord.judgeError === true', async () => {
    const hits = [makeDetectionHit()]
    const triples = [HIGH_SIM_TRIPLES]

    const records = await runM3Pipeline(hits, triples, {
      embedClient: makeHighSimilarityEmbedClient(4),
      judgeClient: new AlwaysFailJudgeClient(),
      config: BASE_CONFIG,
    })

    expect(records).toHaveLength(1)
    expect(records[0]!.judgeError).toBe(true)
  })

  it('judge가 실패하면 DetectionRecord.deferred === true', async () => {
    const hits = [makeDetectionHit()]
    const triples = [HIGH_SIM_TRIPLES]

    const records = await runM3Pipeline(hits, triples, {
      embedClient: makeHighSimilarityEmbedClient(4),
      judgeClient: new AlwaysFailJudgeClient(),
      config: BASE_CONFIG,
    })

    expect(records[0]!.deferred).toBe(true)
  })

  it('judge 실패 시 DetectionRecord.judge 필드는 undefined (판정 없음)', async () => {
    const hits = [makeDetectionHit()]
    const triples = [HIGH_SIM_TRIPLES]

    const records = await runM3Pipeline(hits, triples, {
      embedClient: makeHighSimilarityEmbedClient(4),
      judgeClient: new AlwaysFailJudgeClient(),
      config: BASE_CONFIG,
    })

    expect(records[0]!.judge).toBeUndefined()
  })
})

// ─── 2. final verdict가 false_success가 아님 ─────────────────────────────────

describe('Sub-AC 7c: judge 실패 시 final verdict는 false_success가 아님', () => {
  it('judge 실패 시 final.kind !== "false_success" (가짜성공 오판 금지)', async () => {
    const hits = [makeDetectionHit()]
    const triples = [HIGH_SIM_TRIPLES]

    const records = await runM3Pipeline(hits, triples, {
      embedClient: makeHighSimilarityEmbedClient(4),
      judgeClient: new AlwaysFailJudgeClient(),
      config: BASE_CONFIG,
    })

    expect(records[0]!.final.kind).not.toBe('false_success')
  })

  it('judge 실패 시 final 필드는 정의됨 (미확정이나 undefined가 아님)', async () => {
    const hits = [makeDetectionHit()]
    const triples = [HIGH_SIM_TRIPLES]

    const records = await runM3Pipeline(hits, triples, {
      embedClient: makeHighSimilarityEmbedClient(4),
      judgeClient: new AlwaysFailJudgeClient(),
      config: BASE_CONFIG,
    })

    expect(records[0]!.final).toBeDefined()
    expect(typeof records[0]!.final.kind).toBe('string')
  })
})

// ─── 3. 단조 누적: gate / embed 보존 ─────────────────────────────────────────

describe('Sub-AC 7c: judge 실패 시 gate/embed 필드 보존 (단조 누적)', () => {
  it('judge 실패 시 gate 필드는 정상 보존됨', async () => {
    const gate = makeGateResult('err_loop')
    const hits = [makeDetectionHit(gate)]
    const triples = [HIGH_SIM_TRIPLES]

    const records = await runM3Pipeline(hits, triples, {
      embedClient: makeHighSimilarityEmbedClient(4),
      judgeClient: new AlwaysFailJudgeClient(),
      config: BASE_CONFIG,
    })

    expect(records[0]!.gate).toEqual(gate)
  })

  it('judge 실패 시 embed 필드는 정상 보존됨 (embed 단계까지 성공했으므로)', async () => {
    const hits = [makeDetectionHit()]
    const triples = [HIGH_SIM_TRIPLES]

    const records = await runM3Pipeline(hits, triples, {
      embedClient: makeHighSimilarityEmbedClient(4),
      judgeClient: new AlwaysFailJudgeClient(),
      config: BASE_CONFIG,
    })

    // embed는 성공했으므로 보존되어야 함
    expect(records[0]!.embed).toBeDefined()
    expect(typeof records[0]!.embed!.maxCosine).toBe('number')
  })
})

// ─── 4. 정상 judge와 비교: 성공 시 judgeError 없음 ──────────────────────────

describe('Sub-AC 7c: 정상 judge 시 judgeError 없음 (대조군)', () => {
  it('judge 성공 시 judgeError 필드는 undefined', async () => {
    const hits = [makeDetectionHit()]
    const triples = [HIGH_SIM_TRIPLES]
    const identicalVec = Array.from({ length: 4 }, (_, i) => (i + 1) * 0.1)

    // 정상 judge (thrashing 응답)
    const successfulJudgeClient: JudgeClient = {
      async judge(_req) {
        return {
          kind: 'thrashing',
          subtype: 'file_edit_loop',
          confidence: 0.85,
          reason: 'repeated file edits detected',
          rawSamples: [],
        }
      },
    }

    const records = await runM3Pipeline(hits, triples, {
      embedClient: new MockEmbedClient(
        [
          { text: 'Edit /proj/a.ts', vector: identicalVec },
          { text: 'Edit /proj/b.ts', vector: identicalVec },
        ],
        4,
      ),
      judgeClient: successfulJudgeClient,
      config: BASE_CONFIG,
    })

    expect(records).toHaveLength(1)
    expect(records[0]!.judgeError).toBeUndefined()
    expect(records[0]!.deferred).toBeUndefined()
    expect(records[0]!.judge).toBeDefined()
  })
})
