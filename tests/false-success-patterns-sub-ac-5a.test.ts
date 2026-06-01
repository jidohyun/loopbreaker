/**
 * tests/false-success-patterns-sub-ac-5a.test.ts
 *
 * Sub-AC 5a: detectFalseSuccessPatterns 단위 테스트.
 *
 * 검증 항목:
 *   1. 근거 없는 완료선언(UNSUBSTANTIATED_COMPLETION) 패턴 있음 — 최소 2개 케이스
 *   2. 근거 없는 완료선언 패턴 없음 — 최소 2개 케이스
 *   3. 자기검증 순환참조(SELF_REFERENTIAL_VERIFICATION) 패턴 있음 — 최소 2개 케이스
 *   4. 자기검증 순환참조 패턴 없음 — 최소 2개 케이스
 *   5. 두 범주 동시 매칭
 *   6. 중복 없음 보장
 *   7. 반환 순서 보장
 *   8. 빈 입력 / 공백 입력 처리
 */

import { detectFalseSuccessPatterns } from '../src/detect/false-success-patterns.js'

// ── 1. UNSUBSTANTIATED_COMPLETION 패턴 있음 ────────────────────────────────────

describe('detectFalseSuccessPatterns — UNSUBSTANTIATED_COMPLETION 패턴 있음', () => {
  test('완료했습니다 표현 탐지', () => {
    const result = detectFalseSuccessPatterns('파일 편집을 완료했습니다.')
    expect(result).toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('완료되었습니다 표현 탐지', () => {
    const result = detectFalseSuccessPatterns('작업이 완료되었습니다.')
    expect(result).toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('성공적으로 처리됨 표현 탐지', () => {
    const result = detectFalseSuccessPatterns('요청이 성공적으로 처리됨.')
    expect(result).toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('성공적으로 완료 표현 탐지', () => {
    const result = detectFalseSuccessPatterns('모든 설정이 성공적으로 완료되었습니다.')
    expect(result).toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('정상적으로 완료 표현 탐지', () => {
    const result = detectFalseSuccessPatterns('배포가 정상적으로 완료됐습니다.')
    expect(result).toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('마쳤습니다 표현 탐지', () => {
    const result = detectFalseSuccessPatterns('리팩토링 작업을 마쳤습니다.')
    expect(result).toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('수정 완료 표현 탐지', () => {
    const result = detectFalseSuccessPatterns('버그 수정이 완료되었습니다.')
    expect(result).toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('영어 successfully completed 탐지', () => {
    const result = detectFalseSuccessPatterns('The task was successfully completed.')
    expect(result).toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('영어 task is done 탐지', () => {
    const result = detectFalseSuccessPatterns('The task is done.')
    expect(result).toContain('UNSUBSTANTIATED_COMPLETION')
  })
})

// ── 2. UNSUBSTANTIATED_COMPLETION 패턴 없음 ────────────────────────────────────

describe('detectFalseSuccessPatterns — UNSUBSTANTIATED_COMPLETION 패턴 없음', () => {
  test('중립적인 진행 중 문장은 미탐지', () => {
    const result = detectFalseSuccessPatterns('다음 단계를 진행합니다.')
    expect(result).not.toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('에러 보고 문장은 미탐지', () => {
    const result = detectFalseSuccessPatterns('빌드 중 에러가 발생했습니다.')
    expect(result).not.toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('질문 문장은 미탐지', () => {
    const result = detectFalseSuccessPatterns('어떤 파일을 수정할까요?')
    expect(result).not.toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('완료 단어 없는 문장은 미탐지', () => {
    const result = detectFalseSuccessPatterns('TypeScript 코드를 분석하고 있습니다.')
    expect(result).not.toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('빈 문자열은 미탐지', () => {
    const result = detectFalseSuccessPatterns('')
    expect(result).not.toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('공백만 있는 문자열은 미탐지', () => {
    const result = detectFalseSuccessPatterns('   ')
    expect(result).not.toContain('UNSUBSTANTIATED_COMPLETION')
  })
})

// ── 3. SELF_REFERENTIAL_VERIFICATION 패턴 있음 ────────────────────────────────

describe('detectFalseSuccessPatterns — SELF_REFERENTIAL_VERIFICATION 패턴 있음', () => {
  test('내가 확인한 결과 정상임 탐지', () => {
    const result = detectFalseSuccessPatterns('내가 확인한 결과 정상입니다.')
    expect(result).toContain('SELF_REFERENTIAL_VERIFICATION')
  })

  test('제가 검토한 결과 문제없습니다 탐지', () => {
    const result = detectFalseSuccessPatterns('제가 검토한 결과 문제없습니다.')
    expect(result).toContain('SELF_REFERENTIAL_VERIFICATION')
  })

  test('확인한 결과 정상적으로 작동 탐지', () => {
    const result = detectFalseSuccessPatterns('확인한 결과 정상적으로 작동합니다.')
    expect(result).toContain('SELF_REFERENTIAL_VERIFICATION')
  })

  test('내가 테스트한 결과 이상 없음 탐지', () => {
    const result = detectFalseSuccessPatterns('내가 테스트한 결과 이상 없습니다.')
    expect(result).toContain('SELF_REFERENTIAL_VERIFICATION')
  })

  test('검증 결과 이상 없음 탐지', () => {
    const result = detectFalseSuccessPatterns('검증 결과 이상 없음.')
    expect(result).toContain('SELF_REFERENTIAL_VERIFICATION')
  })

  test('저는 확인한 결과 이상없습니다 탐지', () => {
    const result = detectFalseSuccessPatterns('저는 확인한 결과 이상없습니다.')
    expect(result).toContain('SELF_REFERENTIAL_VERIFICATION')
  })

  test('영어 I verified and it works 탐지', () => {
    const result = detectFalseSuccessPatterns('I verified and it works correctly.')
    expect(result).toContain('SELF_REFERENTIAL_VERIFICATION')
  })

  test('영어 as I confirmed 탐지', () => {
    const result = detectFalseSuccessPatterns('As I confirmed, everything is fine.')
    expect(result).toContain('SELF_REFERENTIAL_VERIFICATION')
  })
})

// ── 4. SELF_REFERENTIAL_VERIFICATION 패턴 없음 ────────────────────────────────

describe('detectFalseSuccessPatterns — SELF_REFERENTIAL_VERIFICATION 패턴 없음', () => {
  test('외부 CI 결과 참조 문장은 미탐지', () => {
    const result = detectFalseSuccessPatterns('CI 파이프라인이 통과했습니다.')
    expect(result).not.toContain('SELF_REFERENTIAL_VERIFICATION')
  })

  test('테스트 코드가 통과한다는 사실 기술은 미탐지', () => {
    const result = detectFalseSuccessPatterns('모든 단위 테스트가 PASS입니다.')
    expect(result).not.toContain('SELF_REFERENTIAL_VERIFICATION')
  })

  test('중립적인 분석 문장은 미탐지', () => {
    const result = detectFalseSuccessPatterns('코드를 분석한 결과 세 가지 개선점이 있습니다.')
    expect(result).not.toContain('SELF_REFERENTIAL_VERIFICATION')
  })

  test('질문 형식은 미탐지', () => {
    const result = detectFalseSuccessPatterns('이 부분을 어떻게 수정하면 좋을까요?')
    expect(result).not.toContain('SELF_REFERENTIAL_VERIFICATION')
  })

  test('빈 문자열은 미탐지', () => {
    const result = detectFalseSuccessPatterns('')
    expect(result).not.toContain('SELF_REFERENTIAL_VERIFICATION')
  })

  test('에러 문장은 미탐지', () => {
    const result = detectFalseSuccessPatterns('타입스크립트 컴파일 에러가 발생했습니다.')
    expect(result).not.toContain('SELF_REFERENTIAL_VERIFICATION')
  })
})

// ── 5. 두 범주 동시 매칭 ───────────────────────────────────────────────────────

describe('detectFalseSuccessPatterns — 두 범주 동시 매칭', () => {
  test('두 패턴 동시 포함 문장에서 둘 다 탐지', () => {
    const text = '내가 확인한 결과 정상이며, 작업이 완료되었습니다.'
    const result = detectFalseSuccessPatterns(text)
    expect(result).toContain('UNSUBSTANTIATED_COMPLETION')
    expect(result).toContain('SELF_REFERENTIAL_VERIFICATION')
    expect(result).toHaveLength(2)
  })

  test('영어 두 패턴 동시 포함', () => {
    const text = 'I verified and it works. The task was successfully completed.'
    const result = detectFalseSuccessPatterns(text)
    expect(result).toContain('UNSUBSTANTIATED_COMPLETION')
    expect(result).toContain('SELF_REFERENTIAL_VERIFICATION')
  })
})

// ── 6. 중복 없음 보장 ─────────────────────────────────────────────────────────

describe('detectFalseSuccessPatterns — 중복 없음', () => {
  test('완료 패턴이 여러 규칙에 걸려도 UNSUBSTANTIATED_COMPLETION 1회만 반환', () => {
    // "성공적으로 완료되었습니다"는 여러 규칙에 매칭될 수 있음
    const text = '모든 작업이 성공적으로 완료되었습니다. 정상적으로 완료됐습니다.'
    const result = detectFalseSuccessPatterns(text)
    const count = result.filter(k => k === 'UNSUBSTANTIATED_COMPLETION').length
    expect(count).toBe(1)
  })

  test('순환참조 패턴이 여러 규칙에 걸려도 SELF_REFERENTIAL_VERIFICATION 1회만 반환', () => {
    const text = '내가 확인한 결과 정상입니다. 검증 결과 이상 없음.'
    const result = detectFalseSuccessPatterns(text)
    const count = result.filter(k => k === 'SELF_REFERENTIAL_VERIFICATION').length
    expect(count).toBe(1)
  })
})

// ── 7. 반환 순서 보장 ─────────────────────────────────────────────────────────

describe('detectFalseSuccessPatterns — 반환 순서', () => {
  test('두 패턴 모두 있을 때 UNSUBSTANTIATED_COMPLETION이 먼저', () => {
    const text = '내가 확인한 결과 정상이며, 작업이 완료되었습니다.'
    const result = detectFalseSuccessPatterns(text)
    expect(result[0]).toBe('UNSUBSTANTIATED_COMPLETION')
    expect(result[1]).toBe('SELF_REFERENTIAL_VERIFICATION')
  })

  test('SELF_REFERENTIAL_VERIFICATION만 있을 때 단독 반환', () => {
    const text = '내가 확인한 결과 이상 없습니다.'
    const result = detectFalseSuccessPatterns(text)
    expect(result).toEqual(['SELF_REFERENTIAL_VERIFICATION'])
  })

  test('UNSUBSTANTIATED_COMPLETION만 있을 때 단독 반환', () => {
    const text = '작업이 완료되었습니다.'
    const result = detectFalseSuccessPatterns(text)
    expect(result).toEqual(['UNSUBSTANTIATED_COMPLETION'])
  })
})

// ── 8. 엣지 케이스 ────────────────────────────────────────────────────────────

describe('detectFalseSuccessPatterns — 엣지 케이스', () => {
  test('빈 문자열은 빈 배열 반환', () => {
    expect(detectFalseSuccessPatterns('')).toEqual([])
  })

  test('공백만 있는 문자열은 빈 배열 반환', () => {
    expect(detectFalseSuccessPatterns('   ')).toEqual([])
  })

  test('개행만 있는 문자열은 빈 배열 반환', () => {
    expect(detectFalseSuccessPatterns('\n\n\t')).toEqual([])
  })

  test('일반 기술 문장은 빈 배열 반환', () => {
    const text = 'src/detect/semantic-stage.ts 파일에 computeCosineSimilarity 함수를 추가합니다.'
    expect(detectFalseSuccessPatterns(text)).toEqual([])
  })

  test('대소문자 무관하게 영어 패턴 탐지', () => {
    const result = detectFalseSuccessPatterns('SUCCESSFULLY COMPLETED the task.')
    expect(result).toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('줄바꿈 포함 멀티라인 텍스트에서도 탐지', () => {
    const text = '분석을 진행했습니다.\n작업이 완료되었습니다.\n다음 단계로 이동합니다.'
    const result = detectFalseSuccessPatterns(text)
    expect(result).toContain('UNSUBSTANTIATED_COMPLETION')
  })
})
