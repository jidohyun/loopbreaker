/**
 * tests/classify-false-success-sub-ac-5a.test.ts
 *
 * Sub-AC 5a: classifyFalseSuccess 단위 테스트.
 *
 * classifyFalseSuccess(text: string): boolean
 *   - 양성 예시 3건 이상: 가짜성공 패턴 포함 → true
 *   - 음성 예시 3건 이상: 가짜성공 패턴 없음 → false
 */

import { classifyFalseSuccess } from '../src/detect/false-success-patterns.js'

// ── 양성 예시 (true 반환) ──────────────────────────────────────────────────────

describe('classifyFalseSuccess — 양성 예시 (true)', () => {
  test('완료했습니다 → true', () => {
    expect(classifyFalseSuccess('파일 편집을 완료했습니다.')).toBe(true)
  })

  test('작업이 완료되었습니다 → true', () => {
    expect(classifyFalseSuccess('작업이 완료되었습니다.')).toBe(true)
  })

  test('성공적으로 처리됨 → true', () => {
    expect(classifyFalseSuccess('요청이 성공적으로 처리됨.')).toBe(true)
  })

  test('내가 확인한 결과 정상입니다 → true', () => {
    expect(classifyFalseSuccess('내가 확인한 결과 정상입니다.')).toBe(true)
  })

  test('제가 검토한 결과 문제없습니다 → true', () => {
    expect(classifyFalseSuccess('제가 검토한 결과 문제없습니다.')).toBe(true)
  })

  test('영어 successfully completed → true', () => {
    expect(classifyFalseSuccess('The task was successfully completed.')).toBe(true)
  })

  test('영어 I verified and it works → true', () => {
    expect(classifyFalseSuccess('I verified and it works.')).toBe(true)
  })

  test('두 패턴 동시 포함 → true', () => {
    expect(
      classifyFalseSuccess('내가 확인한 결과 정상이며, 작업이 완료되었습니다.')
    ).toBe(true)
  })
})

// ── 음성 예시 (false 반환) ────────────────────────────────────────────────────

describe('classifyFalseSuccess — 음성 예시 (false)', () => {
  test('중립적인 진행 중 문장 → false', () => {
    expect(classifyFalseSuccess('다음 단계를 진행합니다.')).toBe(false)
  })

  test('에러 보고 문장 → false', () => {
    expect(classifyFalseSuccess('빌드 중 에러가 발생했습니다.')).toBe(false)
  })

  test('질문 문장 → false', () => {
    expect(classifyFalseSuccess('어떤 파일을 수정할까요?')).toBe(false)
  })

  test('분석 결과 + 개선점 언급 → false', () => {
    expect(
      classifyFalseSuccess('코드를 분석한 결과 세 가지 개선점이 있습니다.')
    ).toBe(false)
  })

  test('외부 CI 통과 언급 → false', () => {
    expect(classifyFalseSuccess('CI 파이프라인이 통과했습니다.')).toBe(false)
  })

  test('빈 문자열 → false', () => {
    expect(classifyFalseSuccess('')).toBe(false)
  })

  test('공백만 있는 문자열 → false', () => {
    expect(classifyFalseSuccess('   ')).toBe(false)
  })

  test('일반 기술 문장 → false', () => {
    expect(
      classifyFalseSuccess(
        'src/detect/semantic-stage.ts 파일에 computeCosineSimilarity 함수를 추가합니다.'
      )
    ).toBe(false)
  })
})
