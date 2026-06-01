/**
 * tests/parse-judge-response-sub-ac-5c-2.test.ts
 *
 * Sub-AC 5c-2: parseJudgeResponse(raw: string) → JudgeVerdict 단위 테스트.
 *
 * 검증 항목:
 *   A. 유효한 false_success 응답 파싱
 *      A1. 기본 false_success JSON 파싱 성공
 *      A2. 모든 선택 필드(topicDivergence, circularReference) 포함 시 파싱 성공
 *      A3. rawSamples 복수 항목 포함 시 파싱 성공
 *      A4. subtype이 null이면 빈 문자열('')로 정규화
 *      A5. 다양한 subtype 값 파싱 성공
 *      A6. confidence 0과 1 경계값 파싱 성공
 *      A7. ```json ... ``` 코드블록 감싸인 응답 파싱 성공
 *      A8. ``` ... ``` 코드블록(언어 미지정) 감싸인 응답 파싱 성공
 *      A9. 반환 객체가 동결(freeze)되어 있다 (불변성)
 *      A10. 반환 타입이 JudgeVerdict와 호환된다
 *
 *   B. 비판정(none) 응답 파싱
 *      B1. kind='none' JSON 파싱 성공
 *      B2. kind='none', subtype=null → subtype=''로 정규화
 *      B3. kind='none', confidence 낮음 파싱 성공
 *      B4. kind='none', rawSamples 빈 배열 파싱 성공
 *      B5. kind='thrashing' 파싱 성공 (thrashing도 유효한 kind)
 *
 *   C. 잘못된 형식(오류) 응답
 *      C1. 빈 문자열 입력 → JudgeParseError(cause_tag='empty_input') throw
 *      C2. 공백만 있는 문자열 → JudgeParseError(cause_tag='empty_input') throw
 *      C3. 유효하지 않은 JSON → JudgeParseError(cause_tag='invalid_json') throw
 *      C4. JSON이지만 kind 필드 누락 → JudgeParseError(cause_tag='schema_mismatch') throw
 *      C5. kind='fake_success' (BLOCKER C1 위반) → JudgeParseError throw
 *      C6. kind='fakeSuccess' (BLOCKER C1 위반) → JudgeParseError throw
 *      C7. confidence가 0~1 범위 초과 → JudgeParseError throw
 *      C8. confidence가 음수 → JudgeParseError throw
 *      C9. JSON 배열 입력(객체 아님) → JudgeParseError throw
 *      C10. JSON null 입력 → JudgeParseError throw
 *      C11. 일반 텍스트(JSON 아님) 입력 → JudgeParseError throw
 *      C12. 부분 JSON(닫히지 않은 괄호) → JudgeParseError throw
 *
 *   D. JudgeParseError 클래스 특성
 *      D1. JudgeParseError.name이 'JudgeParseError'이다
 *      D2. JudgeParseError.raw에 원본 문자열이 보존된다
 *      D3. JudgeParseError.cause_tag이 올바른 값이다
 *      D4. JudgeParseError가 Error를 상속한다
 *      D5. JudgeParseError instanceof 체크가 정확하다
 *
 *   E. 순수 함수·불변성
 *      E1. 동일 입력 → 동일 kind/confidence 반환 (순수 함수)
 *      E2. 입력 raw 문자열이 함수 호출 후 변경되지 않는다
 *      E3. rawSamples가 없는 응답 → rawSamples=[] 기본값 적용
 *      E4. subtype 필드 없는 응답 → subtype='' 기본값 적용
 *
 *   F. 경계 케이스
 *      F1. 매우 긴 reason 문자열 파싱 성공
 *      F2. 한국어 reason 문자열 파싱 성공
 *      F3. topicDivergence=0 파싱 성공
 *      F4. topicDivergence=1 파싱 성공
 *      F5. circularReference=true 파싱 성공
 *      F6. circularReference=false 파싱 성공
 *      F7. rawSamples에 다양한 타입(string, object) 포함 시 파싱 성공
 */

import { parseJudgeResponse, JudgeParseError } from '../src/detect/parse-judge-response.js'
import type { JudgeVerdict } from '../src/contracts.js'

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

/** 유효한 false_success JudgeVerdict JSON 문자열을 생성한다 */
function makeFalseSuccessJson(overrides?: Partial<{
  kind: string
  subtype: string | null
  confidence: number
  topicDivergence: number
  circularReference: boolean
  reason: string
  rawSamples: unknown[]
}>): string {
  const obj = {
    kind: 'false_success',
    subtype: 'unverified_completion',
    confidence: 0.85,
    reason: '완료선언이 있으나 검증 근거가 없습니다.',
    rawSamples: ['작업이 완료되었습니다.'],
    ...overrides,
  }
  return JSON.stringify(obj)
}

/** 유효한 none JudgeVerdict JSON 문자열을 생성한다 */
function makeNoneJson(overrides?: Partial<{
  subtype: string | null
  confidence: number
  reason: string
  rawSamples: unknown[]
}>): string {
  const obj = {
    kind: 'none',
    subtype: null,
    confidence: 0.2,
    reason: '판정 근거 불충분.',
    rawSamples: [],
    ...overrides,
  }
  return JSON.stringify(obj)
}

// ── A. 유효한 false_success 응답 파싱 ──────────────────────────────────────────

describe('parseJudgeResponse — A. 유효한 false_success 응답', () => {
  test('A1: 기본 false_success JSON 파싱 성공', () => {
    const raw = makeFalseSuccessJson()
    const verdict = parseJudgeResponse(raw)
    expect(verdict.kind).toBe('false_success')
    expect(verdict.subtype).toBe('unverified_completion')
    expect(verdict.confidence).toBe(0.85)
    expect(verdict.reason).toBe('완료선언이 있으나 검증 근거가 없습니다.')
    expect(verdict.rawSamples).toHaveLength(1)
  })

  test('A2: 선택 필드(topicDivergence, circularReference) 포함 시 파싱 성공', () => {
    const raw = makeFalseSuccessJson({
      topicDivergence: 0.6,
      circularReference: true,
    })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.kind).toBe('false_success')
    expect(verdict.topicDivergence).toBe(0.6)
    expect(verdict.circularReference).toBe(true)
  })

  test('A3: rawSamples 복수 항목 포함 시 파싱 성공', () => {
    const raw = makeFalseSuccessJson({
      rawSamples: ['발췌 1', '발췌 2', '발췌 3'],
    })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.rawSamples).toHaveLength(3)
    expect(verdict.rawSamples[0]).toBe('발췌 1')
    expect(verdict.rawSamples[2]).toBe('발췌 3')
  })

  test('A4: subtype이 null이면 빈 문자열("")로 정규화', () => {
    const raw = makeFalseSuccessJson({ subtype: null })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.subtype).toBe('')
  })

  test('A5: 다양한 subtype 값 파싱 성공', () => {
    const subtypes = [
      'unverified_completion',
      'self_validation_circular',
      'topic_divergence_success',
      'error_ignored',
      'partial_as_complete',
    ]
    for (const subtype of subtypes) {
      const raw = makeFalseSuccessJson({ subtype })
      const verdict = parseJudgeResponse(raw)
      expect(verdict.subtype).toBe(subtype)
    }
  })

  test('A6: confidence 경계값 0과 1 파싱 성공', () => {
    const v0 = parseJudgeResponse(makeFalseSuccessJson({ confidence: 0 }))
    expect(v0.confidence).toBe(0)

    const v1 = parseJudgeResponse(makeFalseSuccessJson({ confidence: 1 }))
    expect(v1.confidence).toBe(1)
  })

  test('A7: ```json ... ``` 코드블록 감싸인 응답 파싱 성공', () => {
    const json = makeFalseSuccessJson()
    const raw = `\`\`\`json\n${json}\n\`\`\``
    const verdict = parseJudgeResponse(raw)
    expect(verdict.kind).toBe('false_success')
    expect(verdict.confidence).toBe(0.85)
  })

  test('A8: ``` ... ``` 코드블록(언어 미지정) 감싸인 응답 파싱 성공', () => {
    const json = makeFalseSuccessJson()
    const raw = `\`\`\`\n${json}\n\`\`\``
    const verdict = parseJudgeResponse(raw)
    expect(verdict.kind).toBe('false_success')
  })

  test('A9: 반환 객체가 동결(freeze)되어 있다', () => {
    const verdict = parseJudgeResponse(makeFalseSuccessJson())
    expect(Object.isFrozen(verdict)).toBe(true)
  })

  test('A10: 반환 타입이 JudgeVerdict와 호환된다', () => {
    const verdict = parseJudgeResponse(makeFalseSuccessJson())
    // 타입 체크: JudgeVerdict 타입 변수에 할당 가능해야 함
    const typed: JudgeVerdict = verdict
    expect(typed.kind).toBe('false_success')
  })
})

// ── B. 비판정(none) 응답 파싱 ──────────────────────────────────────────────────

describe('parseJudgeResponse — B. 비판정(none) 응답', () => {
  test('B1: kind="none" JSON 파싱 성공', () => {
    const raw = makeNoneJson()
    const verdict = parseJudgeResponse(raw)
    expect(verdict.kind).toBe('none')
    expect(verdict.confidence).toBe(0.2)
  })

  test('B2: kind="none", subtype=null → subtype="" 정규화', () => {
    const raw = makeNoneJson({ subtype: null })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.kind).toBe('none')
    expect(verdict.subtype).toBe('')
  })

  test('B3: kind="none", confidence 낮음(0.05) 파싱 성공', () => {
    const raw = makeNoneJson({ confidence: 0.05 })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.kind).toBe('none')
    expect(verdict.confidence).toBe(0.05)
  })

  test('B4: kind="none", rawSamples 빈 배열 파싱 성공', () => {
    const raw = makeNoneJson({ rawSamples: [] })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.rawSamples).toEqual([])
  })

  test('B5: kind="thrashing" 파싱 성공 (thrashing도 유효한 kind)', () => {
    const raw = JSON.stringify({
      kind: 'thrashing',
      subtype: 'repeated_tool_call',
      confidence: 0.9,
      reason: '동일 도구를 반복 호출합니다.',
      rawSamples: ['반복 발췌'],
    })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.kind).toBe('thrashing')
    expect(verdict.subtype).toBe('repeated_tool_call')
  })
})

// ── C. 잘못된 형식(오류) 응답 ────────────────────────────────────────────────────

describe('parseJudgeResponse — C. 잘못된 형식 응답 (에러)', () => {
  test('C1: 빈 문자열 → JudgeParseError(cause_tag="empty_input") throw', () => {
    expect(() => parseJudgeResponse('')).toThrow(JudgeParseError)
    try {
      parseJudgeResponse('')
    } catch (err) {
      expect(err).toBeInstanceOf(JudgeParseError)
      expect((err as JudgeParseError).cause_tag).toBe('empty_input')
    }
  })

  test('C2: 공백만 있는 문자열 → JudgeParseError(cause_tag="empty_input") throw', () => {
    expect(() => parseJudgeResponse('   \n\t  ')).toThrow(JudgeParseError)
    try {
      parseJudgeResponse('   ')
    } catch (err) {
      expect(err).toBeInstanceOf(JudgeParseError)
      expect((err as JudgeParseError).cause_tag).toBe('empty_input')
    }
  })

  test('C3: 유효하지 않은 JSON → JudgeParseError(cause_tag="invalid_json") throw', () => {
    expect(() => parseJudgeResponse('not valid json {')).toThrow(JudgeParseError)
    try {
      parseJudgeResponse('not valid json {')
    } catch (err) {
      expect(err).toBeInstanceOf(JudgeParseError)
      expect((err as JudgeParseError).cause_tag).toBe('invalid_json')
    }
  })

  test('C4: JSON이지만 kind 필드 누락 → JudgeParseError(cause_tag="schema_mismatch") throw', () => {
    const raw = JSON.stringify({
      subtype: 'unverified_completion',
      confidence: 0.8,
      reason: '이유.',
      rawSamples: [],
    })
    expect(() => parseJudgeResponse(raw)).toThrow(JudgeParseError)
    try {
      parseJudgeResponse(raw)
    } catch (err) {
      expect(err).toBeInstanceOf(JudgeParseError)
      expect((err as JudgeParseError).cause_tag).toBe('schema_mismatch')
    }
  })

  test('C5: kind="fake_success" (BLOCKER C1 위반) → JudgeParseError throw', () => {
    const raw = makeFalseSuccessJson({ kind: 'fake_success' })
    expect(() => parseJudgeResponse(raw)).toThrow(JudgeParseError)
    try {
      parseJudgeResponse(raw)
    } catch (err) {
      expect(err).toBeInstanceOf(JudgeParseError)
      expect((err as JudgeParseError).cause_tag).toBe('schema_mismatch')
    }
  })

  test('C6: kind="fakeSuccess" (BLOCKER C1 위반) → JudgeParseError throw', () => {
    const raw = makeFalseSuccessJson({ kind: 'fakeSuccess' })
    expect(() => parseJudgeResponse(raw)).toThrow(JudgeParseError)
    try {
      parseJudgeResponse(raw)
    } catch (err) {
      expect(err).toBeInstanceOf(JudgeParseError)
      expect((err as JudgeParseError).cause_tag).toBe('schema_mismatch')
    }
  })

  test('C7: confidence > 1 범위 초과 → JudgeParseError throw', () => {
    const raw = makeFalseSuccessJson({ confidence: 1.5 })
    expect(() => parseJudgeResponse(raw)).toThrow(JudgeParseError)
  })

  test('C8: confidence < 0 음수 → JudgeParseError throw', () => {
    const raw = makeFalseSuccessJson({ confidence: -0.1 })
    expect(() => parseJudgeResponse(raw)).toThrow(JudgeParseError)
  })

  test('C9: JSON 배열 입력(객체 아님) → JudgeParseError throw', () => {
    const raw = JSON.stringify([{ kind: 'false_success', confidence: 0.8, reason: '이유.', rawSamples: [] }])
    expect(() => parseJudgeResponse(raw)).toThrow(JudgeParseError)
  })

  test('C10: JSON null 입력 → JudgeParseError throw', () => {
    expect(() => parseJudgeResponse('null')).toThrow(JudgeParseError)
  })

  test('C11: 일반 텍스트(JSON 아님) 입력 → JudgeParseError throw', () => {
    expect(() => parseJudgeResponse('이것은 일반 텍스트 응답입니다.')).toThrow(JudgeParseError)
  })

  test('C12: 부분 JSON(닫히지 않은 괄호) → JudgeParseError throw', () => {
    const raw = '{"kind": "false_success", "confidence": 0.8'
    expect(() => parseJudgeResponse(raw)).toThrow(JudgeParseError)
    try {
      parseJudgeResponse(raw)
    } catch (err) {
      expect(err).toBeInstanceOf(JudgeParseError)
      expect((err as JudgeParseError).cause_tag).toBe('invalid_json')
    }
  })
})

// ── D. JudgeParseError 클래스 특성 ───────────────────────────────────────────────

describe('parseJudgeResponse — D. JudgeParseError 클래스 특성', () => {
  test('D1: JudgeParseError.name이 "JudgeParseError"이다', () => {
    try {
      parseJudgeResponse('')
    } catch (err) {
      expect((err as JudgeParseError).name).toBe('JudgeParseError')
    }
  })

  test('D2: JudgeParseError.raw에 원본 문자열이 보존된다', () => {
    const raw = '{"kind": "invalid_kind", "confidence": 0.5, "reason": ".", "rawSamples": []}'
    try {
      parseJudgeResponse(raw)
    } catch (err) {
      expect((err as JudgeParseError).raw).toBe(raw)
    }
  })

  test('D3: cause_tag 값이 상황에 따라 올바른 값이다', () => {
    // empty_input
    try { parseJudgeResponse('') } catch (err) {
      expect((err as JudgeParseError).cause_tag).toBe('empty_input')
    }

    // invalid_json
    try { parseJudgeResponse('{invalid json}') } catch (err) {
      expect((err as JudgeParseError).cause_tag).toBe('invalid_json')
    }

    // schema_mismatch
    try { parseJudgeResponse('{"kind": "bad_kind", "confidence": 0.5, "reason": ".", "rawSamples": []}') } catch (err) {
      expect((err as JudgeParseError).cause_tag).toBe('schema_mismatch')
    }
  })

  test('D4: JudgeParseError가 Error를 상속한다', () => {
    try {
      parseJudgeResponse('')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
    }
  })

  test('D5: JudgeParseError instanceof 체크가 정확하다', () => {
    let caught: unknown = null
    try {
      parseJudgeResponse('not json')
    } catch (err) {
      caught = err
    }
    expect(caught).not.toBeNull()
    expect(caught instanceof JudgeParseError).toBe(true)
    expect(caught instanceof Error).toBe(true)
  })
})

// ── E. 순수 함수·불변성 ──────────────────────────────────────────────────────────

describe('parseJudgeResponse — E. 순수 함수·불변성', () => {
  test('E1: 동일 입력 → 동일 kind/confidence 반환 (순수 함수)', () => {
    const raw = makeFalseSuccessJson()
    const v1 = parseJudgeResponse(raw)
    const v2 = parseJudgeResponse(raw)
    expect(v1.kind).toBe(v2.kind)
    expect(v1.confidence).toBe(v2.confidence)
    expect(v1.subtype).toBe(v2.subtype)
    expect(v1.reason).toBe(v2.reason)
  })

  test('E2: 입력 raw 문자열이 함수 호출 후 변경되지 않는다', () => {
    const raw = makeFalseSuccessJson()
    const originalRaw = raw
    parseJudgeResponse(raw)
    expect(raw).toBe(originalRaw)
  })

  test('E3: rawSamples 필드 없는 응답 → rawSamples=[] 기본값 적용', () => {
    const raw = JSON.stringify({
      kind: 'none',
      subtype: null,
      confidence: 0.1,
      reason: '판정 불가.',
      // rawSamples 누락
    })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.rawSamples).toEqual([])
  })

  test('E4: subtype 필드 없는 응답 → subtype="" 기본값 적용', () => {
    const raw = JSON.stringify({
      kind: 'none',
      confidence: 0.1,
      reason: '판정 불가.',
      rawSamples: [],
      // subtype 누락
    })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.subtype).toBe('')
  })
})

// ── F. 경계 케이스 ────────────────────────────────────────────────────────────────

describe('parseJudgeResponse — F. 경계 케이스', () => {
  test('F1: 매우 긴 reason 문자열 파싱 성공', () => {
    const longReason = '판정 이유: ' + '판정 근거가 있습니다. '.repeat(200)
    const raw = makeFalseSuccessJson({ reason: longReason })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.reason).toBe(longReason)
  })

  test('F2: 한국어 reason 문자열 파싱 성공', () => {
    const reason = '에이전트가 완료선언을 했으나, 선언을 뒷받침하는 tool_result가 없습니다. 자기검증 순환참조 패턴이 감지되었습니다.'
    const raw = makeFalseSuccessJson({ reason })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.reason).toBe(reason)
  })

  test('F3: topicDivergence=0 파싱 성공', () => {
    const raw = makeFalseSuccessJson({ topicDivergence: 0 })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.topicDivergence).toBe(0)
  })

  test('F4: topicDivergence=1 파싱 성공', () => {
    const raw = makeFalseSuccessJson({ topicDivergence: 1 })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.topicDivergence).toBe(1)
  })

  test('F5: circularReference=true 파싱 성공', () => {
    const raw = makeFalseSuccessJson({ circularReference: true })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.circularReference).toBe(true)
  })

  test('F6: circularReference=false 파싱 성공', () => {
    const raw = makeFalseSuccessJson({ circularReference: false })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.circularReference).toBe(false)
  })

  test('F7: rawSamples에 다양한 타입(string, object) 포함 시 파싱 성공', () => {
    const raw = makeFalseSuccessJson({
      rawSamples: [
        '텍스트 발췌',
        { turn: 3, text: '에이전트 발화' },
        42,
      ],
    })
    const verdict = parseJudgeResponse(raw)
    expect(verdict.rawSamples).toHaveLength(3)
    expect(verdict.rawSamples[0]).toBe('텍스트 발췌')
    expect(verdict.rawSamples[1]).toEqual({ turn: 3, text: '에이전트 발화' })
    expect(verdict.rawSamples[2]).toBe(42)
  })
})
