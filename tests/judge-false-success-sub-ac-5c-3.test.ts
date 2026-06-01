/**
 * tests/judge-false-success-sub-ac-5c-3.test.ts
 *
 * Sub-AC 5c-3: judgeFalseSuccess(text, rubric, llmClient) → JudgeVerdict
 * 통합 함수 단위 테스트.
 *
 * 검증 항목:
 *   A. false_success 판정 경로
 *      A1. mock llmClient가 false_success 판정을 반환하면 그대로 전달된다
 *      A2. kind='false_success', confidence, subtype이 보존된다
 *      A3. rawSamples가 보존된다
 *      A4. topicDivergence/circularReference 선택 필드가 보존된다
 *      A5. buildJudgePrompt가 호출된다 (JudgeRequest.cacheableBlock이 비어있지 않다)
 *      A6. JudgeRequest.kind가 'false_success'이다
 *      A7. JudgeRequest.volatileBlock에 판정 대상 text가 포함된다
 *
 *   B. 비판정(none) 경로
 *      B1. mock llmClient가 none 판정을 반환하면 그대로 전달된다
 *      B2. kind='none', confidence 낮음이 보존된다
 *      B3. reason이 보존된다
 *      B4. none 판정에서도 rawSamples가 보존된다
 *
 *   C. 입력 검증
 *      C1. 빈 text 입력 시 에러를 throw한다 (buildJudgePrompt 검증)
 *      C2. 유효하지 않은 rubric 입력 시 에러를 throw한다
 *      C3. llmClient.judge() 실패 시 에러를 그대로 throw한다 (fail-closed)
 *
 *   D. 불변성·순수성
 *      D1. 함수 호출 후 입력 text가 변경되지 않는다
 *      D2. 함수 호출 후 rubric이 변경되지 않는다
 *      D3. 동일 입력·동일 mock → 동일 반환값 (결정론)
 *
 *   E. judgeFalseSuccessFromRaw — 원시 JSON 응답 처리
 *      E1. 유효한 false_success JSON 응답에서 JudgeVerdict를 반환한다
 *      E2. 유효한 none JSON 응답에서 JudgeVerdict를 반환한다
 *      E3. 유효하지 않은 JSON 응답 시 JudgeParseError를 throw한다
 *      E4. 빈 text 입력 시 에러를 throw한다 (buildJudgePrompt 검증 경유)
 *
 *   F. BLOCKER C1/C2 검증
 *      F1. 반환 kind가 'thrashing' | 'false_success' | 'none' 중 하나이다 (C1)
 *      F2. 반환 타입이 JudgeVerdict 필드 구조를 갖는다 (C2)
 */

import {
  judgeFalseSuccess,
  judgeFalseSuccessFromRaw,
} from '../src/detect/judge-false-success.js'
import {
  buildFalseSuccessRubric,
  type Rubric,
  type RubricCriterion,
} from '../src/detect/false-success-rubric.js'
import {
  MockJudgeClient,
  type JudgeRequest,
  type MockJudgeCacheEntry,
} from '../src/api/judge-client.js'
import type { JudgeVerdict } from '../src/contracts.js'
import { JudgeParseError } from '../src/detect/parse-judge-response.js'

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

const DEFAULT_RUBRIC = buildFalseSuccessRubric()
const SAMPLE_TEXT = '작업이 완료되었습니다. 모든 테스트가 통과했습니다.'
const MODEL_ID = 'claude-3-5-sonnet-20241022'

/** false_success 판정 샘플 verdict */
const FALSE_SUCCESS_VERDICT: JudgeVerdict = Object.freeze({
  kind: 'false_success' as const,
  subtype: 'unverified_completion',
  confidence: 0.87,
  topicDivergence: 0.1,
  circularReference: false,
  reason: '완료선언이 있으나 tool_result로 뒷받침된 검증 근거가 없습니다.',
  rawSamples: ['작업이 완료되었습니다.', '테스트 통과를 확인했습니다.'],
})

/** none 판정 샘플 verdict */
const NONE_VERDICT: JudgeVerdict = Object.freeze({
  kind: 'none' as const,
  subtype: '',
  confidence: 0.15,
  reason: '판정 근거 불충분. 검증 tool_result가 존재합니다.',
  rawSamples: [],
})

/**
 * judgeFalseSuccess가 내부적으로 생성하는 JudgeRequest의 kind/modelId 기반 키로
 * MockJudgeClient를 등록한다.
 * MockJudgeClient 기본 키 형식: `${kind}:${modelId}`
 */
function makeMockClient(verdict: JudgeVerdict, kind: 'false_success' | 'thrashing' = 'false_success'): MockJudgeClient {
  const entry: MockJudgeCacheEntry = {
    cacheKey: `${kind}:${MODEL_ID}`,
    verdict,
  }
  return new MockJudgeClient([entry])
}

// ── A. false_success 판정 경로 ────────────────────────────────────────────────

describe('judgeFalseSuccess — false_success 판정 경로', () => {
  test('A1. mock llmClient가 false_success 판정을 반환하면 그대로 전달된다', async () => {
    const client = makeMockClient(FALSE_SUCCESS_VERDICT)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(verdict.kind).toBe('false_success')
  })

  test('A2. kind, confidence, subtype이 보존된다', async () => {
    const client = makeMockClient(FALSE_SUCCESS_VERDICT)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(verdict.kind).toBe('false_success')
    expect(verdict.confidence).toBe(0.87)
    expect(verdict.subtype).toBe('unverified_completion')
  })

  test('A3. rawSamples가 보존된다', async () => {
    const client = makeMockClient(FALSE_SUCCESS_VERDICT)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(verdict.rawSamples).toEqual(['작업이 완료되었습니다.', '테스트 통과를 확인했습니다.'])
  })

  test('A4. topicDivergence/circularReference 선택 필드가 보존된다', async () => {
    const client = makeMockClient(FALSE_SUCCESS_VERDICT)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(verdict.topicDivergence).toBe(0.1)
    expect(verdict.circularReference).toBe(false)
  })

  test('A5. 내부적으로 buildJudgePrompt가 호출된다 (JudgeRequest.cacheableBlock이 비어있지 않다)', async () => {
    // MockJudgeClient가 요청 정보를 캡처하도록 커스텀 클라이언트 사용
    let capturedReq: JudgeRequest | undefined
    const capturingClient = {
      async judge(req: JudgeRequest): Promise<JudgeVerdict> {
        capturedReq = req
        return FALSE_SUCCESS_VERDICT
      },
    }
    await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, capturingClient, MODEL_ID)
    expect(capturedReq).toBeDefined()
    expect(capturedReq!.cacheableBlock.length).toBeGreaterThan(0)
    // systemBlock에 루브릭 내용이 포함되어야 함
    expect(capturedReq!.cacheableBlock).toContain('false_success')
  })

  test('A6. JudgeRequest.kind가 "false_success"이다', async () => {
    let capturedReq: JudgeRequest | undefined
    const capturingClient = {
      async judge(req: JudgeRequest): Promise<JudgeVerdict> {
        capturedReq = req
        return FALSE_SUCCESS_VERDICT
      },
    }
    await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, capturingClient, MODEL_ID)
    expect(capturedReq!.kind).toBe('false_success')
  })

  test('A7. JudgeRequest.volatileBlock에 판정 대상 text가 포함된다', async () => {
    let capturedReq: JudgeRequest | undefined
    const capturingClient = {
      async judge(req: JudgeRequest): Promise<JudgeVerdict> {
        capturedReq = req
        return FALSE_SUCCESS_VERDICT
      },
    }
    await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, capturingClient, MODEL_ID)
    expect(capturedReq!.volatileBlock).toContain(SAMPLE_TEXT)
  })
})

// ── B. none(비판정) 경로 ──────────────────────────────────────────────────────

describe('judgeFalseSuccess — none(비판정) 경로', () => {
  test('B1. mock llmClient가 none 판정을 반환하면 그대로 전달된다', async () => {
    const client = makeMockClient(NONE_VERDICT)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(verdict.kind).toBe('none')
  })

  test('B2. kind="none", confidence 낮음이 보존된다', async () => {
    const client = makeMockClient(NONE_VERDICT)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(verdict.kind).toBe('none')
    expect(verdict.confidence).toBe(0.15)
  })

  test('B3. reason이 보존된다', async () => {
    const client = makeMockClient(NONE_VERDICT)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(verdict.reason).toBe('판정 근거 불충분. 검증 tool_result가 존재합니다.')
  })

  test('B4. none 판정에서도 rawSamples가 보존된다', async () => {
    const client = makeMockClient(NONE_VERDICT)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(verdict.rawSamples).toEqual([])
  })

  test('B5. 다양한 텍스트에서 none 판정을 반환한다', async () => {
    const texts = [
      '완료했습니다.',
      '수정이 완료되었습니다.',
      '테스트 결과가 정상입니다.',
    ]
    const client = makeMockClient(NONE_VERDICT)
    for (const t of texts) {
      const verdict = await judgeFalseSuccess(t, DEFAULT_RUBRIC, client, MODEL_ID)
      expect(verdict.kind).toBe('none')
    }
  })
})

// ── C. 입력 검증 ──────────────────────────────────────────────────────────────

describe('judgeFalseSuccess — 입력 검증', () => {
  test('C1. 빈 text 입력 시 에러를 throw한다 (buildJudgePrompt 검증 경유)', async () => {
    const client = makeMockClient(FALSE_SUCCESS_VERDICT)
    await expect(
      judgeFalseSuccess('', DEFAULT_RUBRIC, client, MODEL_ID)
    ).rejects.toThrow()
  })

  test('C2. 유효하지 않은 rubric.kind 입력 시 에러를 throw한다', async () => {
    const invalidRubric = {
      kind: 'thrashing' as unknown as 'false_success',
      blocker: 'C1' as const,
      version: '1.0.0',
      criteria: Object.freeze([
        Object.freeze({
          id: 'F1',
          patternId: 'unverified_completion',
          description: '설명.',
          weight: 0.9,
          kind: 'false_success' as const,
        }),
      ]),
      decisionThreshold: 0.5,
    } as Rubric
    const client = makeMockClient(FALSE_SUCCESS_VERDICT)
    await expect(
      judgeFalseSuccess(SAMPLE_TEXT, invalidRubric, client, MODEL_ID)
    ).rejects.toThrow()
  })

  test('C3. llmClient.judge() 실패 시 에러를 그대로 throw한다 (fail-closed)', async () => {
    const failClient = {
      async judge(_req: JudgeRequest): Promise<JudgeVerdict> {
        throw new Error('judge API 호출 실패 — 테스트 에러')
      },
    }
    await expect(
      judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, failClient, MODEL_ID)
    ).rejects.toThrow('judge API 호출 실패 — 테스트 에러')
  })

  test('C4. 빈 criteria 배열 rubric 입력 시 에러를 throw한다', async () => {
    const emptyRubric = {
      kind: 'false_success' as const,
      blocker: 'C1' as const,
      version: '1.0.0',
      criteria: Object.freeze([]) as unknown as Rubric['criteria'],
      decisionThreshold: 0.5,
    } as Rubric
    const client = makeMockClient(FALSE_SUCCESS_VERDICT)
    await expect(
      judgeFalseSuccess(SAMPLE_TEXT, emptyRubric, client, MODEL_ID)
    ).rejects.toThrow()
  })
})

// ── D. 불변성·결정론 ──────────────────────────────────────────────────────────

describe('judgeFalseSuccess — 불변성·결정론', () => {
  test('D1. 함수 호출 후 입력 text가 변경되지 않는다', async () => {
    const text = '원본 텍스트입니다.'
    const originalText = text
    const client = makeMockClient(FALSE_SUCCESS_VERDICT)
    await judgeFalseSuccess(text, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(text).toBe(originalText)
  })

  test('D2. 함수 호출 후 rubric이 변경되지 않는다', async () => {
    const rubric = buildFalseSuccessRubric()
    const originalLength = rubric.criteria.length
    const originalKind = rubric.kind
    const client = makeMockClient(FALSE_SUCCESS_VERDICT)
    await judgeFalseSuccess(SAMPLE_TEXT, rubric, client, MODEL_ID)
    expect(rubric.criteria.length).toBe(originalLength)
    expect(rubric.kind).toBe(originalKind)
  })

  test('D3. 동일 입력·동일 mock → 동일 반환값 (결정론)', async () => {
    const client = makeMockClient(FALSE_SUCCESS_VERDICT)
    const v1 = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    const v2 = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(v1.kind).toBe(v2.kind)
    expect(v1.confidence).toBe(v2.confidence)
    expect(v1.subtype).toBe(v2.subtype)
    expect(v1.reason).toBe(v2.reason)
  })
})

// ── E. judgeFalseSuccessFromRaw — 원시 JSON 응답 처리 ─────────────────────────

describe('judgeFalseSuccessFromRaw — 원시 LLM JSON 응답 처리', () => {
  const FALSE_SUCCESS_RAW = JSON.stringify({
    kind: 'false_success',
    subtype: 'unverified_completion',
    confidence: 0.85,
    topicDivergence: 0.05,
    circularReference: false,
    reason: '완료선언이 있으나 검증 tool_result가 없습니다.',
    rawSamples: ['작업이 완료되었습니다.'],
  })

  const NONE_RAW = JSON.stringify({
    kind: 'none',
    subtype: null,
    confidence: 0.2,
    reason: '판정 근거 불충분.',
    rawSamples: [],
  })

  test('E1. 유효한 false_success JSON 응답에서 JudgeVerdict를 반환한다', () => {
    const verdict = judgeFalseSuccessFromRaw(SAMPLE_TEXT, DEFAULT_RUBRIC, FALSE_SUCCESS_RAW)
    expect(verdict.kind).toBe('false_success')
    expect(verdict.confidence).toBe(0.85)
    expect(verdict.subtype).toBe('unverified_completion')
  })

  test('E2. 유효한 none JSON 응답에서 JudgeVerdict를 반환한다', () => {
    const verdict = judgeFalseSuccessFromRaw(SAMPLE_TEXT, DEFAULT_RUBRIC, NONE_RAW)
    expect(verdict.kind).toBe('none')
    expect(verdict.confidence).toBe(0.2)
    // subtype null → ''로 정규화
    expect(verdict.subtype).toBe('')
  })

  test('E3. 유효하지 않은 JSON 응답 시 JudgeParseError를 throw한다', () => {
    expect(() =>
      judgeFalseSuccessFromRaw(SAMPLE_TEXT, DEFAULT_RUBRIC, 'invalid json {{{')
    ).toThrow(JudgeParseError)
  })

  test('E4. 빈 text 입력 시 에러를 throw한다', () => {
    expect(() =>
      judgeFalseSuccessFromRaw('', DEFAULT_RUBRIC, FALSE_SUCCESS_RAW)
    ).toThrow()
  })

  test('E5. ```json 코드블록 감싸인 응답을 정상 파싱한다', () => {
    const codeBlockRaw = `\`\`\`json\n${FALSE_SUCCESS_RAW}\n\`\`\``
    const verdict = judgeFalseSuccessFromRaw(SAMPLE_TEXT, DEFAULT_RUBRIC, codeBlockRaw)
    expect(verdict.kind).toBe('false_success')
  })

  test('E6. kind="fake_success"인 응답 시 JudgeParseError를 throw한다 (BLOCKER C1)', () => {
    const invalidKindRaw = JSON.stringify({
      kind: 'fake_success', // BLOCKER C1 위반
      subtype: 'unverified_completion',
      confidence: 0.85,
      reason: '설명',
      rawSamples: [],
    })
    expect(() =>
      judgeFalseSuccessFromRaw(SAMPLE_TEXT, DEFAULT_RUBRIC, invalidKindRaw)
    ).toThrow(JudgeParseError)
  })
})

// ── F. BLOCKER C1/C2 검증 ─────────────────────────────────────────────────────

describe('judgeFalseSuccess — BLOCKER C1/C2 검증', () => {
  test('F1. 반환 kind가 "thrashing" | "false_success" | "none" 중 하나이다 (BLOCKER C1)', async () => {
    const client = makeMockClient(FALSE_SUCCESS_VERDICT)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(['thrashing', 'false_success', 'none']).toContain(verdict.kind)
  })

  test('F2. 반환 타입이 JudgeVerdict 필드 구조를 갖는다 (BLOCKER C2)', async () => {
    const client = makeMockClient(FALSE_SUCCESS_VERDICT)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    // contracts.ts JudgeVerdict 필수 필드 검증
    expect(verdict).toHaveProperty('kind')
    expect(verdict).toHaveProperty('subtype')
    expect(verdict).toHaveProperty('confidence')
    expect(verdict).toHaveProperty('reason')
    expect(verdict).toHaveProperty('rawSamples')
    expect(Array.isArray(verdict.rawSamples)).toBe(true)
    expect(typeof verdict.confidence).toBe('number')
    expect(verdict.confidence).toBeGreaterThanOrEqual(0)
    expect(verdict.confidence).toBeLessThanOrEqual(1)
  })

  test('F3. none 판정도 동일한 JudgeVerdict 구조를 갖는다 (BLOCKER C2)', async () => {
    const client = makeMockClient(NONE_VERDICT)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(verdict).toHaveProperty('kind')
    expect(verdict).toHaveProperty('subtype')
    expect(verdict).toHaveProperty('confidence')
    expect(verdict).toHaveProperty('reason')
    expect(verdict).toHaveProperty('rawSamples')
    expect(['thrashing', 'false_success', 'none']).toContain(verdict.kind)
  })

  test('F4. modelId가 JudgeRequest에 전달된다 (BLOCKER B2: Anthropic 모델)', async () => {
    let capturedModelId: string | undefined
    const capturingClient = {
      async judge(req: JudgeRequest): Promise<JudgeVerdict> {
        capturedModelId = req.modelId
        return FALSE_SUCCESS_VERDICT
      },
    }
    await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, capturingClient, MODEL_ID)
    expect(capturedModelId).toBe(MODEL_ID)
  })
})

// ── G. 엣지 케이스 ────────────────────────────────────────────────────────────

describe('judgeFalseSuccess — 엣지 케이스', () => {
  test('G1. 커스텀 rubric(criteria 1개)으로 판정이 성공한다', async () => {
    const minimalCriterion: RubricCriterion = Object.freeze({
      id: 'F1',
      patternId: 'unverified_completion',
      description: '완료 선언이 있으나 검증 tool_result가 없다.',
      weight: 0.9,
      kind: 'false_success' as const,
    })
    const minimalRubric: Rubric = Object.freeze({
      kind: 'false_success' as const,
      blocker: 'C1' as const,
      version: '1.0.0',
      criteria: Object.freeze([minimalCriterion]),
      decisionThreshold: 0.5,
    })
    const client = makeMockClient(FALSE_SUCCESS_VERDICT)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, minimalRubric, client, MODEL_ID)
    expect(verdict.kind).toBe('false_success')
  })

  test('G2. 기본 modelId(claude-3-5-sonnet-20241022)로 호출 가능하다', async () => {
    // modelId 파라미터 없이 호출 — 기본값 사용
    let capturedModelId: string | undefined
    const capturingClient = {
      async judge(req: JudgeRequest): Promise<JudgeVerdict> {
        capturedModelId = req.modelId
        return FALSE_SUCCESS_VERDICT
      },
    }
    await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, capturingClient)
    expect(capturedModelId).toBe('claude-3-5-sonnet-20241022')
  })

  test('G3. confidence=1.0 극단값 판정이 전달된다', async () => {
    const highConfVerdict: JudgeVerdict = {
      kind: 'false_success',
      subtype: 'error_ignored',
      confidence: 1.0,
      reason: '에러 무시 패턴 확실.',
      rawSamples: [],
    }
    const client = makeMockClient(highConfVerdict)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(verdict.confidence).toBe(1.0)
  })

  test('G4. confidence=0.0 극단값 판정이 전달된다', async () => {
    const lowConfVerdict: JudgeVerdict = {
      kind: 'none',
      subtype: '',
      confidence: 0.0,
      reason: '판정 근거 전혀 없음.',
      rawSamples: [],
    }
    const client = makeMockClient(lowConfVerdict)
    const verdict = await judgeFalseSuccess(SAMPLE_TEXT, DEFAULT_RUBRIC, client, MODEL_ID)
    expect(verdict.confidence).toBe(0.0)
  })
})
