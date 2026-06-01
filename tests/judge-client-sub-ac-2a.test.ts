/**
 * tests/judge-client-sub-ac-2a.test.ts
 *
 * Sub-AC 2a: JudgeVerdict 타입과 JudgeClient 인터페이스를
 * src/api/judge-client.ts에서 정의하고, 해당 타입이 올바른 필드를
 * 가지는지 검증하는 타입 레벨 컴파일 테스트.
 *
 * BLOCKER C1: kind는 'false_success' 단일 리터럴
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본 타입과 일치
 * 제약: 외부 API 절대 미호출 — MockJudgeClient만 사용
 */

import {
  MockJudgeClient,
  parseJudgeVerdict,
  JudgeVerdictSchema,
  type JudgeVerdict,
  type JudgeClient,
  type JudgeRequest,
  type MockJudgeCacheEntry,
} from '../src/api/judge-client.js'

// ─────────────────────────────────────────────
// A. 타입 레벨 컴파일 검증 (Compile-time type tests)
//    이 블록이 tsc 에러 없이 컴파일되면 타입 계약이 성립한다.
// ─────────────────────────────────────────────

describe('JudgeVerdict — 타입 레벨 컴파일 검증', () => {
  it('kind 리터럴 열거형이 정확히 세 가지여야 한다', () => {
    // BLOCKER C1: 'false_success' 단일 리터럴 (fake_success/fakeSuccess 금지)
    const thrashing: JudgeVerdict = {
      kind: 'thrashing',
      subtype: 'stuck_error_loop',
      confidence: 0.85,
      reason: '동일 에러가 반복되었습니다.',
      rawSamples: [],
    }
    const falseSuc: JudgeVerdict = {
      kind: 'false_success',
      subtype: 'unverified_completion',
      confidence: 0.9,
      reason: '검증 없이 완료를 선언했습니다.',
      rawSamples: ['sample1'],
    }
    const none: JudgeVerdict = {
      kind: 'none',
      subtype: '',
      confidence: 0.1,
      reason: '정상입니다.',
      rawSamples: [],
    }
    expect(thrashing.kind).toBe('thrashing')
    expect(falseSuc.kind).toBe('false_success')
    expect(none.kind).toBe('none')
  })

  it('필수 필드가 모두 존재해야 한다 (contracts.ts §1 정본)', () => {
    const verdict: JudgeVerdict = {
      kind: 'false_success',
      subtype: 'self_validation_circular',
      confidence: 0.95,
      reason: '자기참조 순환이 탐지되었습니다.',
      rawSamples: ['raw1', 'raw2'],
    }
    // 각 필수 필드 접근 — 컴파일 에러가 없어야 함
    expect(verdict.kind).toBeDefined()
    expect(verdict.subtype).toBeDefined()
    expect(typeof verdict.confidence).toBe('number')
    expect(typeof verdict.reason).toBe('string')
    expect(Array.isArray(verdict.rawSamples)).toBe(true)
  })

  it('선택 필드 topicDivergence와 circularReference는 undefined 허용', () => {
    const withOptionals: JudgeVerdict = {
      kind: 'thrashing',
      subtype: 'same_region_reedit',
      confidence: 0.8,
      topicDivergence: 0.2,
      circularReference: false,
      reason: '반복 편집이 탐지되었습니다.',
      rawSamples: [],
    }
    const withoutOptionals: JudgeVerdict = {
      kind: 'none',
      subtype: '',
      confidence: 0.05,
      reason: '정상입니다.',
      rawSamples: [],
    }
    expect(withOptionals.topicDivergence).toBe(0.2)
    expect(withOptionals.circularReference).toBe(false)
    expect(withoutOptionals.topicDivergence).toBeUndefined()
    expect(withoutOptionals.circularReference).toBeUndefined()
  })

  it('rawSamples는 unknown[] 타입이어야 한다 (감사용)', () => {
    const verdict: JudgeVerdict = {
      kind: 'false_success',
      subtype: 'error_ignored',
      confidence: 0.88,
      reason: '에러를 무시하고 완료를 선언했습니다.',
      // rawSamples는 unknown[] 이므로 다양한 타입 혼합 가능
      rawSamples: ['문자열', 42, { nested: true }, null],
    }
    expect(verdict.rawSamples).toHaveLength(4)
  })
})

// ─────────────────────────────────────────────
// B. JudgeClient 인터페이스 계약 검증
// ─────────────────────────────────────────────

describe('JudgeClient 인터페이스 — 구조 계약', () => {
  it('JudgeClient를 구현하는 객체는 judge(req) 메서드를 가져야 한다', () => {
    // MockJudgeClient가 JudgeClient를 구현하는지 타입 검사
    const client: JudgeClient = new MockJudgeClient()
    expect(typeof client.judge).toBe('function')
  })

  it('JudgeRequest에 필수 필드가 모두 존재해야 한다', () => {
    const req: JudgeRequest = {
      kind: 'false_success',
      cacheableBlock: '루브릭 텍스트',
      volatileBlock: '판정 대상 컨텍스트',
      modelId: 'claude-3-5-sonnet-20241022',
    }
    expect(req.kind).toBe('false_success')
    expect(req.modelId).toContain('claude')
  })

  it('temperature는 선택 필드여야 한다', () => {
    const withTemp: JudgeRequest = {
      kind: 'thrashing',
      cacheableBlock: 'rubric',
      volatileBlock: 'context',
      modelId: 'claude-3-5-sonnet-20241022',
      temperature: 0.4,
    }
    const withoutTemp: JudgeRequest = {
      kind: 'thrashing',
      cacheableBlock: 'rubric',
      volatileBlock: 'context',
      modelId: 'claude-3-5-sonnet-20241022',
    }
    expect(withTemp.temperature).toBe(0.4)
    expect(withoutTemp.temperature).toBeUndefined()
  })
})

// ─────────────────────────────────────────────
// C. MockJudgeClient — 결정론 동작 검증
//    (외부 API 절대 미호출)
// ─────────────────────────────────────────────

describe('MockJudgeClient — 결정론 동작', () => {
  const sampleVerdict: JudgeVerdict = {
    kind: 'false_success',
    subtype: 'unverified_completion',
    confidence: 0.92,
    topicDivergence: 0.1,
    circularReference: true,
    reason: '완료선언 직전 검증 tool_result가 없습니다.',
    rawSamples: ['완료했습니다.', { step: 3, tool: 'Bash' }],
  }

  const entry: MockJudgeCacheEntry = {
    cacheKey: 'false_success:claude-3-5-sonnet-20241022',
    verdict: sampleVerdict,
  }

  it('등록된 cacheKey에 대해 결정론적으로 동일한 verdict를 반환한다', async () => {
    const client = new MockJudgeClient([entry])
    const req: JudgeRequest & { _cacheKey: string } = {
      kind: 'false_success',
      cacheableBlock: 'rubric',
      volatileBlock: 'context',
      modelId: 'claude-3-5-sonnet-20241022',
      _cacheKey: 'false_success:claude-3-5-sonnet-20241022',
    }
    const result = await client.judge(req)
    expect(result).toEqual(sampleVerdict)
    expect(result.kind).toBe('false_success')
    expect(result.confidence).toBe(0.92)
    expect(result.circularReference).toBe(true)
  })

  it('캐시 미스 시 에러를 throw한다 (조용한 폴백 금지)', async () => {
    const client = new MockJudgeClient([]) // 빈 캐시
    const req: JudgeRequest & { _cacheKey: string } = {
      kind: 'thrashing',
      cacheableBlock: 'rubric',
      volatileBlock: 'context',
      modelId: 'claude-3-5-sonnet-20241022',
      _cacheKey: 'nonexistent:key',
    }
    await expect(client.judge(req)).rejects.toThrow('캐시 미스')
  })

  it('register()로 새 항목을 추가하면 새 인스턴스를 반환한다 (불변성)', async () => {
    const original = new MockJudgeClient([])
    const thrashingVerdict: JudgeVerdict = {
      kind: 'thrashing',
      subtype: 'stuck_error_loop',
      confidence: 0.75,
      reason: '동일 에러 반복.',
      rawSamples: [],
    }
    const extended = original.register({
      cacheKey: 'thrashing:claude-3-5-sonnet-20241022',
      verdict: thrashingVerdict,
    })

    // 원본은 변경되지 않아야 함 (불변성)
    const origReq: JudgeRequest & { _cacheKey: string } = {
      kind: 'thrashing',
      cacheableBlock: 'x',
      volatileBlock: 'y',
      modelId: 'claude-3-5-sonnet-20241022',
      _cacheKey: 'thrashing:claude-3-5-sonnet-20241022',
    }
    await expect(original.judge(origReq)).rejects.toThrow()

    // 확장된 인스턴스는 정상 동작
    const result = await extended.judge(origReq)
    expect(result.kind).toBe('thrashing')
  })

  it('여러 항목을 등록하고 각각 올바른 verdict를 반환한다', async () => {
    const v1: JudgeVerdict = {
      kind: 'thrashing',
      subtype: 'revert_oscillation',
      confidence: 0.8,
      reason: '되돌리기 반복.',
      rawSamples: [],
    }
    const v2: JudgeVerdict = {
      kind: 'none',
      subtype: '',
      confidence: 0.1,
      reason: '정상.',
      rawSamples: [],
    }
    const client = new MockJudgeClient([
      { cacheKey: 'key1', verdict: v1 },
      { cacheKey: 'key2', verdict: v2 },
    ])

    const makeReq = (key: string): JudgeRequest & { _cacheKey: string } => ({
      kind: 'thrashing',
      cacheableBlock: 'x',
      volatileBlock: 'y',
      modelId: 'claude-3-5-sonnet-20241022',
      _cacheKey: key,
    })

    expect((await client.judge(makeReq('key1'))).kind).toBe('thrashing')
    expect((await client.judge(makeReq('key2'))).kind).toBe('none')
  })
})

// ─────────────────────────────────────────────
// D. JudgeVerdictSchema (zod) — 런타임 검증
// ─────────────────────────────────────────────

describe('JudgeVerdictSchema — zod 런타임 검증', () => {
  it('유효한 JudgeVerdict 객체를 파싱한다', () => {
    const raw = {
      kind: 'false_success',
      subtype: 'unverified_completion',
      confidence: 0.9,
      topicDivergence: 0.3,
      circularReference: true,
      reason: '이유 텍스트.',
      rawSamples: ['sample'],
    }
    const result = JudgeVerdictSchema.parse(raw)
    expect(result.kind).toBe('false_success')
    expect(result.confidence).toBe(0.9)
  })

  it("kind='fakeSuccess'는 zod 에러로 거부한다 (BLOCKER C1)", () => {
    const invalid = {
      kind: 'fakeSuccess', // C1 위반
      subtype: '',
      confidence: 0.5,
      reason: 'x',
      rawSamples: [],
    }
    expect(() => JudgeVerdictSchema.parse(invalid)).toThrow()
  })

  it("kind='fake_success'는 zod 에러로 거부한다 (BLOCKER C1)", () => {
    const invalid = {
      kind: 'fake_success', // C1 위반
      subtype: '',
      confidence: 0.5,
      reason: 'x',
      rawSamples: [],
    }
    expect(() => JudgeVerdictSchema.parse(invalid)).toThrow()
  })

  it('confidence가 0~1 범위를 벗어나면 에러를 던진다', () => {
    const tooHigh = {
      kind: 'none',
      subtype: '',
      confidence: 1.5,
      reason: 'x',
      rawSamples: [],
    }
    expect(() => JudgeVerdictSchema.parse(tooHigh)).toThrow()
  })
})

// ─────────────────────────────────────────────
// E. parseJudgeVerdict — JSON 파싱 검증
// ─────────────────────────────────────────────

describe('parseJudgeVerdict — JSON 문자열 파싱', () => {
  it('유효한 JSON 문자열을 JudgeVerdict로 파싱한다', () => {
    const json = JSON.stringify({
      kind: 'thrashing',
      subtype: 'same_region_reedit',
      confidence: 0.87,
      topicDivergence: 0.15,
      circularReference: false,
      reason: 'stepIndex 3, 5, 7에서 동일 파일이 반복 편집됨.',
      rawSamples: ['편집 A', '편집 B'],
    })
    const verdict = parseJudgeVerdict(json)
    expect(verdict.kind).toBe('thrashing')
    expect(verdict.subtype).toBe('same_region_reedit')
    expect(verdict.rawSamples).toHaveLength(2)
  })

  it('```json 코드블록으로 감싸인 경우도 파싱한다', () => {
    const json = `\`\`\`json
{
  "kind": "none",
  "subtype": "",
  "confidence": 0.05,
  "reason": "정상입니다.",
  "rawSamples": []
}
\`\`\``
    const verdict = parseJudgeVerdict(json)
    expect(verdict.kind).toBe('none')
  })

  it('유효하지 않은 JSON이면 에러를 던진다', () => {
    expect(() => parseJudgeVerdict('not json')).toThrow()
  })

  it('스키마 위반(kind=fakeSuccess) JSON이면 에러를 던진다', () => {
    const badJson = JSON.stringify({
      kind: 'fakeSuccess',
      subtype: '',
      confidence: 0.5,
      reason: 'x',
      rawSamples: [],
    })
    expect(() => parseJudgeVerdict(badJson)).toThrow()
  })
})
