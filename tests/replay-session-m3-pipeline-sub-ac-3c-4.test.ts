// tests/replay-session-m3-pipeline-sub-ac-3c-4.test.ts
//
// Sub-AC 3c-4: 트리플 배열에 runM3Pipeline(Mock embed·judge)을 적용해
// DetectionRecord[] 를 반환하는 단계 단위 테스트.
//
// 검증 목표:
//   - Mock embed·judge를 주입한 합성 트리플 입력에 대해
//     결정론적으로 동일한 DetectionRecord 배열을 반환함
//   - 동일 입력으로 두 번 호출 → 결과 동일 (결정론 보장)
//   - records[i].gate === hits[i].gate (hit 참조 보존)
//   - records[i].final.kind / confidence 가 mock judge verdict와 일치
//   - 빈 hits/triples → 빈 records 반환
//   - embed API 실패 hit → fail-closed 건너뜀 + skippedCount 증가
//   - judge API 실패 hit → judgeError=true, deferred=true + record 포함
//   - simThresh 미달(약한 의미 신호) → judge 미호출, embed 결과만으로 record 생성
//
// 제약:
//   - 실경로(~/.claude 등) 리터럴 없음
//   - @anthropic-ai/sdk 없음
//   - FS/API/DB 접근 없음 — 합성 픽스처 + Mock 클라이언트만 사용
//   - dispatcher.dispatch 호출 없음

import { applyM3Pipeline } from '../src/eval/replay-session.js'
import { MockEmbedClient, type MockEmbedEntry } from '../src/api/embed-client.js'
import { MockJudgeClient } from '../src/api/judge-client.js'
import {
  DEFAULT_DETECTOR_CONFIG,
  type DetectorConfig,
  type StructureGateResult,
  type ActionTriple,
  type JudgeVerdict,
} from '../src/contracts.js'
import type { DetectionHit } from '../src/detect/detection-pipeline.js'

// ─── 합성 픽스처 헬퍼 ─────────────────────────────────────────────────────────

const SESSION_ID = 'test-session-3c4'
const DIM = 4

/**
 * 합성 DetectionHit 생성 헬퍼.
 */
function makeHit(
  windowRefs: string[],
  triggerUuid: string,
  type: StructureGateResult['type'] = 'thrashing',
): DetectionHit {
  const gate: StructureGateResult = {
    sessionId: SESSION_ID,
    agentScope: 'root',
    type,
    subtype: 'edit_repeat',
    severity: 'warning',
    metrics: { editRepeat: windowRefs.length },
    windowRefs,
  }
  return {
    gate,
    triggerUuid,
    ts: 1_700_000_000_000,
  }
}

/**
 * 합성 ActionTriple 생성 헬퍼.
 * argKey는 외부에서 주입 (결정론적 텍스트 렌더링 제어).
 */
function makeTriple(tool: string, argKey: string): ActionTriple {
  return Object.freeze({
    tool,
    argKey,
    resultClass: 'ok',
    ref: { uuid: `ref-${tool}-${argKey}`, ts: 1_700_000_000_000 },
  })
}

/**
 * 트리플 임베딩 텍스트 렌더링 — semantic-stage와 동일.
 * "${triple.tool} ${triple.argKey}"
 */
function renderTripleText(triple: ActionTriple): string {
  return `${triple.tool} ${triple.argKey}`
}

/**
 * 단위 벡터 생성 (dim=4).
 */
function makeVec(v: [number, number, number, number]): number[] {
  return [...v]
}

/**
 * 두 triple에 대한 MockEmbedEntry 배열 생성.
 * semantic-stage의 buildEmbeddingPairs가 사용하는 텍스트 포맷과 동일하게 등록.
 */
function makeMockEmbedEntries(
  triples: ActionTriple[],
  vectors: readonly number[][],
): MockEmbedEntry[] {
  return triples.map((t, i) => ({
    text: renderTripleText(t),
    vector: vectors[i]!,
  }))
}

/**
 * Mock judge 판정 생성 헬퍼.
 * MockJudgeClient 기본 키: "${kind}:${modelId}"
 */
function makeMockJudgeVerdict(kind: JudgeVerdict['kind'] = 'thrashing'): JudgeVerdict {
  return {
    kind,
    subtype: 'edit_repeat',
    confidence: 0.85,
    reason: `mock judge verdict: ${kind}`,
    rawSamples: [],
  }
}

/**
 * MockJudgeClient 기본 캐시 키.
 * MockJudgeClient.judge()는 _cacheKey 미제공 시
 * `${req.kind}:${req.modelId}` 를 키로 사용한다.
 */
function makeMockJudgeCacheKey(
  kind: 'thrashing' | 'false_success',
  modelId: string,
): string {
  return `${kind}:${modelId}`
}

// ─── 공통 설정 ─────────────────────────────────────────────────────────────────

/**
 * simThresh를 낮춰서 judge 호출이 항상 발생하도록 설정한 config.
 * (기본 simThresh=0.90은 테스트에서 통과하기 어려우므로 낮춤)
 */
const TEST_CONFIG_WITH_JUDGE: DetectorConfig = Object.freeze({
  ...DEFAULT_DETECTOR_CONFIG,
  simThresh: 0.0,   // 모든 임베딩 신호가 judge 단계에 도달
  decideThresh: 0.5,
  judgeSelfConsistencyN: 1,
  judgePositionSwaps: 0,
  embedModelId: 'voyage-3-lite',
  judgeModelId: 'claude-3-5-sonnet-20241022',
  embedDim: DIM,
})

/**
 * simThresh를 높여서 judge 호출이 발생하지 않도록 설정한 config.
 */
const TEST_CONFIG_NO_JUDGE: DetectorConfig = Object.freeze({
  ...DEFAULT_DETECTOR_CONFIG,
  simThresh: 2.0,   // 절대 judge에 도달 불가 (cosine ≤ 1.0)
  embedDim: DIM,
})

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe('applyM3Pipeline (Sub-AC 3c-4)', () => {
  // ─ 빈 입력 → 빈 결과 ──────────────────────────────────────────────────────
  test('빈 hits/triples → 빈 records, hitCount=0, skippedCount=0', async () => {
    const embedClient = new MockEmbedClient([], DIM)
    const judgeClient = new MockJudgeClient()

    const result = await applyM3Pipeline([], [], {
      embedClient,
      judgeClient,
      config: TEST_CONFIG_WITH_JUDGE,
    })

    expect(result.records).toHaveLength(0)
    expect(result.hitCount).toBe(0)
    expect(result.skippedCount).toBe(0)
  })

  // ─ 단일 hit + 트리플 2개 → DetectionRecord 1건 반환 ─────────────────────────
  test('단일 hit(트리플 2개) → Mock embed·judge → DetectionRecord 1건 반환', async () => {
    const tripleA = makeTriple('Edit', '/proj/a.ts')
    const tripleB = makeTriple('Edit', '/proj/b.ts')
    const triples = [tripleA, tripleB]

    // 두 트리플의 임베딩 텍스트를 MockEmbedClient에 등록
    // 유사도가 높게 되도록 동일 벡터 근사
    const vecA = makeVec([1, 0, 0, 0])
    const vecB = makeVec([0.99, 0.01, 0, 0])  // cosine ≈ 0.99 (>simThresh=0.0)
    const embedClient = new MockEmbedClient(
      makeMockEmbedEntries(triples, [vecA, vecB]),
      DIM,
    )

    const modelId = TEST_CONFIG_WITH_JUDGE.judgeModelId
    const judgeVerdict = makeMockJudgeVerdict('thrashing')
    const judgeClient = new MockJudgeClient([
      {
        cacheKey: makeMockJudgeCacheKey('thrashing', modelId),
        verdict: judgeVerdict,
      },
    ])

    const hit = makeHit([tripleA.ref.uuid, tripleB.ref.uuid], 'trigger-01')

    const result = await applyM3Pipeline([hit], [triples], {
      embedClient,
      judgeClient,
      config: TEST_CONFIG_WITH_JUDGE,
    })

    expect(result.hitCount).toBe(1)
    expect(result.skippedCount).toBe(0)
    expect(result.records).toHaveLength(1)

    const record = result.records[0]!
    // gate 참조 보존
    expect(record.gate).toBe(hit.gate)
    // embed 결과 존재
    expect(record.embed).toBeDefined()
    // judge 결과 존재 (simThresh=0.0 이므로 항상 통과)
    expect(record.judge).toBeDefined()
    expect(record.judge!.kind).toBe('thrashing')
    expect(record.judge!.confidence).toBe(0.85)
    // final 판정
    expect(record.final.kind).toBe('thrashing')
  })

  // ─ 결정론 보장: 동일 입력으로 두 번 호출 → 동일 DetectionRecord ──────────────
  test('동일 합성 입력으로 두 번 호출 → 동일 DetectionRecord 배열 반환 (결정론)', async () => {
    const tripleA = makeTriple('Bash', 'npm test')
    const tripleB = makeTriple('Bash', 'npm test')
    const triples = [tripleA, tripleB]

    const vecA = makeVec([0.7, 0.7, 0, 0])
    const vecB = makeVec([0.7, 0.7, 0, 0])  // identical → cosine=1.0
    const embedClient = new MockEmbedClient(
      makeMockEmbedEntries(triples, [vecA, vecB]),
      DIM,
    )

    const modelId = TEST_CONFIG_WITH_JUDGE.judgeModelId
    const judgeVerdict = makeMockJudgeVerdict('thrashing')
    const judgeClient = new MockJudgeClient([
      {
        cacheKey: makeMockJudgeCacheKey('thrashing', modelId),
        verdict: judgeVerdict,
      },
    ])

    const hit = makeHit(['ref-Bash-npm test'], 'trigger-det')
    const opts = { embedClient, judgeClient, config: TEST_CONFIG_WITH_JUDGE }

    const result1 = await applyM3Pipeline([hit], [triples], opts)
    const result2 = await applyM3Pipeline([hit], [triples], opts)

    // 동일 길이
    expect(result1.records.length).toBe(result2.records.length)
    // 동일 kind
    expect(result1.records[0]!.final.kind).toBe(result2.records[0]!.final.kind)
    // 동일 confidence
    expect(result1.records[0]!.final.confidence).toBe(result2.records[0]!.final.confidence)
    // 동일 hitCount / skippedCount
    expect(result1.hitCount).toBe(result2.hitCount)
    expect(result1.skippedCount).toBe(result2.skippedCount)
  })

  // ─ simThresh 높음 → judge 미호출 → embed 결과만으로 record 생성 ───────────────
  test('simThresh 초과 설정 → judge 미호출 → embed 결과만으로 DetectionRecord 반환', async () => {
    const tripleA = makeTriple('Read', '/proj/x.ts')
    const tripleB = makeTriple('Read', '/proj/y.ts')
    const triples = [tripleA, tripleB]

    // 낮은 유사도 벡터 (직교) — cosine=0 < simThresh=2.0
    const vecA = makeVec([1, 0, 0, 0])
    const vecB = makeVec([0, 1, 0, 0])
    const embedClient = new MockEmbedClient(
      makeMockEmbedEntries(triples, [vecA, vecB]),
      DIM,
    )

    // judge 호출하면 캐시 미스로 실패하도록 빈 MockJudgeClient 주입
    const judgeClient = new MockJudgeClient([])

    const hit = makeHit([tripleA.ref.uuid], 'trigger-no-judge')
    const result = await applyM3Pipeline([hit], [triples], {
      embedClient,
      judgeClient,
      config: TEST_CONFIG_NO_JUDGE,  // simThresh=2.0
    })

    expect(result.records).toHaveLength(1)
    const record = result.records[0]!
    // embed 결과는 있음
    expect(record.embed).toBeDefined()
    // judge 미호출
    expect(record.judge).toBeUndefined()
    expect(record.judgeError).toBeUndefined()
    expect(record.deferred).toBeUndefined()
    // final은 gate 기반
    expect(record.final.kind).toBe('thrashing') // gate.type
  })

  // ─ embed API 실패 → fail-closed → skippedCount 증가 (false_success 한정) ──────
  // SPEC §11 degrade: thrashing은 embed 실패 시 구조신호로 degrade 발화하므로,
  //   fail-closed(skip)는 의미·judge가 본질인 false_success에서만 성립한다.
  test('false_success embed 실패(캐시 미스) → fail-closed 건너뜀 → records 없음, skippedCount=1', async () => {
    // MockEmbedClient에 해당 텍스트를 등록하지 않으면 EmbedClientError throw
    const embedClient = new MockEmbedClient([], DIM)
    const judgeClient = new MockJudgeClient()

    const tripleA = makeTriple('Edit', '/proj/missing.ts')
    const tripleB = makeTriple('Edit', '/proj/also-missing.ts')
    const hit = makeHit(['ref-1', 'ref-2'], 'trigger-fail-embed', 'false_success')

    const result = await applyM3Pipeline([hit], [[tripleA, tripleB]], {
      embedClient,
      judgeClient,
      config: TEST_CONFIG_WITH_JUDGE,
    })

    // false_success embed 실패 → hit 건너뜀 → records 없음
    expect(result.records).toHaveLength(0)
    expect(result.hitCount).toBe(1)
    expect(result.skippedCount).toBe(1)
  })

  // ─ thrashing embed 실패 → 구조신호 degrade 발화 (SPEC §11) ────────────────────
  test('thrashing embed 실패(캐시 미스) → 구조신호 degrade로 record 생성, skippedCount=0', async () => {
    const embedClient = new MockEmbedClient([], DIM)
    const judgeClient = new MockJudgeClient()

    const tripleA = makeTriple('Edit', '/proj/missing.ts')
    const tripleB = makeTriple('Edit', '/proj/also-missing.ts')
    const hit = makeHit(['ref-1', 'ref-2'], 'trigger-degrade') // 기본 thrashing

    const result = await applyM3Pipeline([hit], [[tripleA, tripleB]], {
      embedClient,
      judgeClient,
      config: TEST_CONFIG_WITH_JUDGE,
    })

    // thrashing은 degrade로 발화 → record 1건, skip 0
    expect(result.records).toHaveLength(1)
    expect(result.records[0]!.degraded).toBe(true)
    expect(result.records[0]!.embedError).toBe(true)
    expect(result.records[0]!.final.kind).toBe('thrashing')
    expect(result.skippedCount).toBe(0)
  })

  // ─ 다중 hit: 일부 embed 성공, 일부 실패 → 성공분만 records에 포함 ─────────────
  test('다중 hit 중 일부 embed 실패 → 성공분만 records에 포함, skippedCount 정확', async () => {
    // hitOk: 트리플 2개, 둘 다 등록됨 → embed 성공 → record 생성
    const tripleOkA = makeTriple('Bash', 'echo ok-a')
    const tripleOkB = makeTriple('Bash', 'echo ok-b')

    // hitFail: 트리플 2개, 둘 다 미등록 → embed 캐시 미스 → skip
    const tripleFailA = makeTriple('Edit', '/no-entry-a.ts')
    const tripleFailB = makeTriple('Edit', '/no-entry-b.ts')

    // tripleOkA, tripleOkB 텍스트만 등록 (tripleFailA, tripleFailB 미등록)
    const vecA = makeVec([1, 0, 0, 0])
    const vecB = makeVec([0.9, 0.1, 0, 0])
    const embedClient = new MockEmbedClient(
      [
        { text: renderTripleText(tripleOkA), vector: vecA },
        { text: renderTripleText(tripleOkB), vector: vecB },
      ],
      DIM,
    )

    const modelId = TEST_CONFIG_WITH_JUDGE.judgeModelId
    const judgeClient = new MockJudgeClient([
      {
        cacheKey: makeMockJudgeCacheKey('thrashing', modelId),
        verdict: makeMockJudgeVerdict('thrashing'),
      },
    ])

    const hitOk   = makeHit(['ref-ok-a', 'ref-ok-b'],     'trigger-ok')
    // hitFail은 false_success: embed 실패 시 fail-closed skip (thrashing이면 degrade 발화함)
    const hitFail = makeHit(['ref-fail-a', 'ref-fail-b'], 'trigger-fail', 'false_success')

    const result = await applyM3Pipeline(
      [hitOk, hitFail],
      [[tripleOkA, tripleOkB], [tripleFailA, tripleFailB]],
      { embedClient, judgeClient, config: TEST_CONFIG_WITH_JUDGE },
    )

    expect(result.hitCount).toBe(2)
    // hitOk: embed 성공 → record 생성 (judge 성공 or 실패여도 record 생성됨)
    expect(result.records.length).toBeGreaterThanOrEqual(1)
    // hitFail(false_success): embed 캐시 미스 → fail-closed skip
    expect(result.skippedCount).toBeGreaterThanOrEqual(1)
    // 항등식 유지
    expect(result.hitCount).toBe(result.records.length + result.skippedCount)
  })

  // ─ judge API 실패 → judgeError=true, deferred=true, record 포함 ──────────────
  test('judge API 실패 → judgeError=true, deferred=true 로 record 반환 (embed는 보존)', async () => {
    const tripleA = makeTriple('Edit', '/proj/judge-fail-a.ts')
    const tripleB = makeTriple('Edit', '/proj/judge-fail-b.ts')
    const triples = [tripleA, tripleB]

    // 높은 유사도 벡터 → judge 단계에 진입
    const vecA = makeVec([1, 0, 0, 0])
    const vecB = makeVec([0.99, 0.01, 0, 0])
    const embedClient = new MockEmbedClient(
      makeMockEmbedEntries(triples, [vecA, vecB]),
      DIM,
    )

    // judge 캐시 미스 → CacheMissError → judgeError=true (SPEC §4)
    const judgeClient = new MockJudgeClient([])  // 등록 없음

    const hit = makeHit([tripleA.ref.uuid, tripleB.ref.uuid], 'trigger-judge-fail')
    const result = await applyM3Pipeline([hit], [triples], {
      embedClient,
      judgeClient,
      config: TEST_CONFIG_WITH_JUDGE,  // simThresh=0.0 → judge에 진입
    })

    // judge 실패는 record를 생성함 (judgeError=true, deferred=true)
    expect(result.records).toHaveLength(1)
    expect(result.skippedCount).toBe(0)

    const record = result.records[0]!
    expect(record.judgeError).toBe(true)
    expect(record.deferred).toBe(true)
    // embed 결과는 보존됨
    expect(record.embed).toBeDefined()
    // judge 결과는 없음
    expect(record.judge).toBeUndefined()
  })

  // ─ false_success 타입 hit → 동일하게 처리됨 ──────────────────────────────────
  test('false_success 타입 hit + 트리플 → DetectionRecord 반환', async () => {
    const tripleA = makeTriple('Bash', 'echo done')
    const tripleB = makeTriple('Bash', 'echo complete')
    const triples = [tripleA, tripleB]

    const vecA = makeVec([0.8, 0.6, 0, 0])
    const vecB = makeVec([0.8, 0.6, 0, 0])  // cosine=1.0
    const embedClient = new MockEmbedClient(
      makeMockEmbedEntries(triples, [vecA, vecB]),
      DIM,
    )

    // false_success 타입용 judge 등록
    const modelId = TEST_CONFIG_WITH_JUDGE.judgeModelId
    const judgeClient = new MockJudgeClient([
      {
        cacheKey: makeMockJudgeCacheKey('thrashing', modelId),
        verdict: makeMockJudgeVerdict('false_success'),
      },
    ])

    const hit = makeHit([tripleA.ref.uuid, tripleB.ref.uuid], 'anchor-fs', 'false_success')
    const result = await applyM3Pipeline([hit], [triples], {
      embedClient,
      judgeClient,
      config: TEST_CONFIG_WITH_JUDGE,
    })

    expect(result.records).toHaveLength(1)
    const record = result.records[0]!
    expect(record.gate.type).toBe('false_success')
    expect(record.embed).toBeDefined()
  })

  // ─ record의 gate === hits[i].gate 참조 보존 ───────────────────────────────────
  test('record.gate === 입력 hit.gate 참조 동일성 보존', async () => {
    const tripleA = makeTriple('Read', '/proj/ref-test.ts')
    const tripleB = makeTriple('Read', '/proj/ref-test2.ts')
    const triples = [tripleA, tripleB]

    const vecA = makeVec([1, 0, 0, 0])
    const vecB = makeVec([0.9, 0.1, 0, 0])
    const embedClient = new MockEmbedClient(
      makeMockEmbedEntries(triples, [vecA, vecB]),
      DIM,
    )
    const modelId = TEST_CONFIG_WITH_JUDGE.judgeModelId
    const judgeClient = new MockJudgeClient([
      {
        cacheKey: makeMockJudgeCacheKey('thrashing', modelId),
        verdict: makeMockJudgeVerdict('thrashing'),
      },
    ])

    const hit = makeHit([tripleA.ref.uuid], 'trigger-ref')
    const result = await applyM3Pipeline([hit], [triples], {
      embedClient,
      judgeClient,
      config: TEST_CONFIG_WITH_JUDGE,
    })

    expect(result.records).toHaveLength(1)
    // gate 참조는 동일 객체 (재정의 금지)
    expect(result.records[0]!.gate).toBe(hit.gate)
  })

  // ─ hitCount = records.length + skippedCount 항등 유지 ─────────────────────────
  test('hitCount === records.length + skippedCount 항등식이 항상 유지됨', async () => {
    // 3개의 hit 중 1개는 embed 실패
    const tripleGood1A = makeTriple('Edit', '/g1a.ts')
    const tripleGood1B = makeTriple('Edit', '/g1b.ts')
    const tripleGood2A = makeTriple('Bash', 'ls -la')
    const tripleGood2B = makeTriple('Bash', 'ls -la')

    const vecG = makeVec([1, 0, 0, 0])
    const vecG2 = makeVec([0.9, 0.1, 0, 0])
    const embedClient = new MockEmbedClient(
      [
        { text: renderTripleText(tripleGood1A), vector: vecG },
        { text: renderTripleText(tripleGood1B), vector: vecG2 },
        { text: renderTripleText(tripleGood2A), vector: vecG },
        { text: renderTripleText(tripleGood2B), vector: vecG2 },
        // tripleFailA, tripleFailB は미등록 → 캐시 미스
      ],
      DIM,
    )

    const modelId = TEST_CONFIG_WITH_JUDGE.judgeModelId
    const judgeClient = new MockJudgeClient([
      {
        cacheKey: makeMockJudgeCacheKey('thrashing', modelId),
        verdict: makeMockJudgeVerdict('thrashing'),
      },
    ])

    const hitGood1 = makeHit(['r1', 'r2'], 'trig-g1')
    const hitGood2 = makeHit(['r3', 'r4'], 'trig-g2')
    // false_success: embed 실패 시 skip (thrashing이면 degrade 발화하므로 항등식 검증엔 false_success 사용)
    const hitFail  = makeHit(['r5', 'r6'], 'trig-f', 'false_success')

    const tripleFail = makeTriple('Edit', '/unregistered.ts')
    const tripleFail2 = makeTriple('Edit', '/unregistered2.ts')

    const result = await applyM3Pipeline(
      [hitGood1, hitGood2, hitFail],
      [
        [tripleGood1A, tripleGood1B],
        [tripleGood2A, tripleGood2B],
        [tripleFail, tripleFail2],
      ],
      { embedClient, judgeClient, config: TEST_CONFIG_WITH_JUDGE },
    )

    // 항등식 검증
    expect(result.hitCount).toBe(result.records.length + result.skippedCount)
    expect(result.hitCount).toBe(3)
    // hitFail은 embed 실패로 skip
    expect(result.skippedCount).toBeGreaterThanOrEqual(1)
  })
})
