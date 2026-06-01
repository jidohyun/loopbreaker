/**
 * tests/classify-self-referential-loop-sub-ac-5b.test.ts
 *
 * Sub-AC 5b: classifySelfReferentialLoop 단위 테스트.
 *
 * 자기검증 순환참조 패턴(예: '내가 확인했으니 맞다', '이전 응답 참조' 류)을
 * 감지하여 true/false를 반환하는 함수 검증.
 *
 * 검증 항목:
 *   1. 순환참조 있음 — 최소 3건 이상 (한국어)
 *   2. 순환참조 있음 — 최소 3건 이상 (영어/혼용)
 *   3. 순환참조 없음 — 최소 3건 이상
 *   4. 빈 입력 / 공백 처리
 *   5. 이전 응답 참조 패턴
 *   6. 자기 생성물 근거 패턴
 *   7. 인과 단정 패턴
 */

import { classifySelfReferentialLoop } from '../src/detect/false-success-patterns.js'

// ── 1. 순환참조 있음 — 한국어 케이스 ─────────────────────────────────────────

describe('classifySelfReferentialLoop — 순환참조 있음 (한국어)', () => {
  test('내가 확인한 결과 정상 → true', () => {
    expect(classifySelfReferentialLoop('내가 확인한 결과 정상입니다.')).toBe(true)
  })

  test('제가 검토한 결과 문제없습니다 → true', () => {
    expect(classifySelfReferentialLoop('제가 검토한 결과 문제없습니다.')).toBe(true)
  })

  test('내가 확인했으니 맞다 → true', () => {
    expect(classifySelfReferentialLoop('내가 확인했으니 맞다.')).toBe(true)
  })

  test('직접 검토했으니 문제없다 → true', () => {
    expect(classifySelfReferentialLoop('직접 검토했으니 문제없다.')).toBe(true)
  })

  test('검증 결과 이상 없음 → true', () => {
    expect(classifySelfReferentialLoop('검증 결과 이상 없음.')).toBe(true)
  })

  test('내가 테스트한 결과 이상 없음 → true', () => {
    expect(classifySelfReferentialLoop('내가 테스트한 결과 이상 없습니다.')).toBe(true)
  })
})

// ── 2. 순환참조 있음 — 영어/혼용 케이스 ──────────────────────────────────────

describe('classifySelfReferentialLoop — 순환참조 있음 (영어/혼용)', () => {
  test('I verified and it works → true', () => {
    expect(classifySelfReferentialLoop('I verified and it works.')).toBe(true)
  })

  test('as I confirmed → true', () => {
    expect(classifySelfReferentialLoop('As I confirmed, there are no issues.')).toBe(true)
  })

  test('as I mentioned before → true', () => {
    expect(classifySelfReferentialLoop('As I mentioned before, this is correct.')).toBe(true)
  })

  test('in my previous response → true', () => {
    expect(classifySelfReferentialLoop('In my previous response, I explained this.')).toBe(true)
  })

  test('I checked and it is fine → true', () => {
    expect(classifySelfReferentialLoop('I checked and it is fine.')).toBe(true)
  })

  test('as I stated earlier → true', () => {
    expect(classifySelfReferentialLoop('As I stated earlier, everything is working.')).toBe(true)
  })
})

// ── 3. 순환참조 없음 — 최소 3건 이상 ─────────────────────────────────────────

describe('classifySelfReferentialLoop — 순환참조 없음', () => {
  test('CI 파이프라인 통과 기술 → false', () => {
    expect(classifySelfReferentialLoop('CI 파이프라인이 통과했습니다.')).toBe(false)
  })

  test('외부 테스트 결과 참조 → false', () => {
    expect(classifySelfReferentialLoop('모든 단위 테스트가 PASS입니다.')).toBe(false)
  })

  test('중립적 분석 문장 → false', () => {
    expect(classifySelfReferentialLoop('코드를 분석한 결과 세 가지 개선점이 있습니다.')).toBe(false)
  })

  test('다음 단계 진행 문장 → false', () => {
    expect(classifySelfReferentialLoop('다음 단계를 진행합니다.')).toBe(false)
  })

  test('에러 보고 문장 → false', () => {
    expect(classifySelfReferentialLoop('빌드 중 에러가 발생했습니다.')).toBe(false)
  })

  test('질문 문장 → false', () => {
    expect(classifySelfReferentialLoop('어떤 파일을 수정할까요?')).toBe(false)
  })

  test('일반 기술 설명 → false', () => {
    expect(
      classifySelfReferentialLoop('TypeScript 컴파일러가 타입 오류를 감지했습니다.'),
    ).toBe(false)
  })

  test('영어 중립 문장 → false', () => {
    expect(classifySelfReferentialLoop('The build output shows 3 warnings.')).toBe(false)
  })

  test('영어 외부 검증 참조 → false', () => {
    expect(classifySelfReferentialLoop('The test suite passed all 42 checks.')).toBe(false)
  })
})

// ── 4. 빈 입력 / 공백 처리 ───────────────────────────────────────────────────

describe('classifySelfReferentialLoop — 빈 입력 처리', () => {
  test('빈 문자열 → false', () => {
    expect(classifySelfReferentialLoop('')).toBe(false)
  })

  test('공백만 있는 문자열 → false', () => {
    expect(classifySelfReferentialLoop('   ')).toBe(false)
  })

  test('개행만 있는 문자열 → false', () => {
    expect(classifySelfReferentialLoop('\n\n\t')).toBe(false)
  })
})

// ── 5. 이전 응답 참조 패턴 ───────────────────────────────────────────────────

describe('classifySelfReferentialLoop — 이전 응답 참조 패턴', () => {
  test('이전 응답에서 언급한 → true', () => {
    expect(classifySelfReferentialLoop('이전 응답에서 언급한 내용과 동일합니다.')).toBe(true)
  })

  test('앞서 확인한 바와 같이 → true', () => {
    expect(classifySelfReferentialLoop('앞서 확인한 바와 같이 이 방법이 올바릅니다.')).toBe(true)
  })

  test('이전 답변을 참조 → true', () => {
    expect(classifySelfReferentialLoop('이전 답변을 참조하면 알 수 있습니다.')).toBe(true)
  })

  test('in my last response → true', () => {
    expect(classifySelfReferentialLoop('In my last response, I described this issue.')).toBe(true)
  })
})

// ── 6. 자기 생성물 근거 패턴 ─────────────────────────────────────────────────

describe('classifySelfReferentialLoop — 자기 생성물 근거 패턴', () => {
  test('제가 작성한 코드이므로 → true', () => {
    expect(classifySelfReferentialLoop('제가 작성한 코드이므로 올바릅니다.')).toBe(true)
  })

  test('내가 만든 결과이니 → true', () => {
    expect(classifySelfReferentialLoop('내가 만든 결과이니 신뢰할 수 있습니다.')).toBe(true)
  })
})

// ── 7. 인과 단정 패턴 ────────────────────────────────────────────────────────

describe('classifySelfReferentialLoop — 인과 단정 패턴', () => {
  test('제가 검증했으니 이상없음 → true', () => {
    expect(classifySelfReferentialLoop('제가 검증했으니 이상없음.')).toBe(true)
  })

  test('내가 점검했으므로 문제없다 → true', () => {
    expect(classifySelfReferentialLoop('내가 점검했으므로 문제없습니다.')).toBe(true)
  })
})

// ── 8. 순수 함수 특성 검증 ───────────────────────────────────────────────────

describe('classifySelfReferentialLoop — 순수 함수 특성', () => {
  test('동일 입력에 대해 항상 동일 결과 반환 (결정론적)', () => {
    const text = '내가 확인한 결과 정상입니다.'
    const result1 = classifySelfReferentialLoop(text)
    const result2 = classifySelfReferentialLoop(text)
    expect(result1).toBe(result2)
    expect(result1).toBe(true)
  })

  test('false 케이스도 결정론적', () => {
    const text = 'CI 테스트가 통과했습니다.'
    const result1 = classifySelfReferentialLoop(text)
    const result2 = classifySelfReferentialLoop(text)
    expect(result1).toBe(result2)
    expect(result1).toBe(false)
  })

  test('입력 텍스트를 변경하지 않는다 (불변성)', () => {
    const text = '내가 확인한 결과 정상입니다.'
    const original = text
    classifySelfReferentialLoop(text)
    expect(text).toBe(original)
  })
})
