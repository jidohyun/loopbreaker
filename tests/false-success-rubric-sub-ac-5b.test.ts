/**
 * tests/false-success-rubric-sub-ac-5b.test.ts
 *
 * Sub-AC 5b: build_false_success_rubric() 단위 테스트.
 *
 * 검증 항목:
 *   1. 반환 객체에 kind='false_success' 필수 필드 포함 (BLOCKER C1)
 *   2. 반환 객체에 blocker='C1' 필수 필드 포함
 *   3. 반환 객체에 criteria 목록 필수 필드 포함 (length >= 1)
 *   4. criteria 각 항목이 필수 필드(id, patternId, description, weight, kind)를 모두 가짐
 *   5. criteria[].kind가 모두 'false_success' (BLOCKER C1)
 *   6. SPEC §5 §2.3 F1~F5 패턴 id 전체 포함
 *   7. criteria 순서 F1→F2→F3→F4→F5 유지
 *   8. weight가 0~1 범위
 *   9. 반환 객체 불변성 (Object.freeze)
 *  10. 매 호출마다 독립된 객체 반환 (참조 분리)
 *  11. findCriterionByPatternId 조회 함수 동작
 *  12. version 필드 존재
 *  13. decisionThreshold 필드 존재 및 0~1 범위
 */

import {
  buildFalseSuccessRubric,
  findCriterionByPatternId,
  type Rubric,
  type RubricCriterion,
} from '../src/detect/false-success-rubric.js'

// ── 1. 필수 필드: kind='false_success' (BLOCKER C1) ───────────────────────────

describe('buildFalseSuccessRubric — BLOCKER C1: kind', () => {
  test('반환 객체의 kind가 정확히 "false_success"이다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(rubric.kind).toBe('false_success')
  })

  test('kind가 "false_success" 리터럴 타입이다 (fake_success/fakeSuccess 금지)', () => {
    const rubric = buildFalseSuccessRubric()
    expect(rubric.kind).not.toBe('fake_success')
    expect(rubric.kind).not.toBe('fakeSuccess')
    expect(rubric.kind).not.toBe('thrashing')
    expect(rubric.kind).not.toBe('none')
  })
})

// ── 2. 필수 필드: blocker='C1' ────────────────────────────────────────────────

describe('buildFalseSuccessRubric — blocker 필드', () => {
  test('반환 객체의 blocker가 정확히 "C1"이다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(rubric.blocker).toBe('C1')
  })

  test('blocker 필드가 존재한다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(rubric).toHaveProperty('blocker')
  })
})

// ── 3. 필수 필드: criteria 목록 ───────────────────────────────────────────────

describe('buildFalseSuccessRubric — criteria 필드', () => {
  test('criteria 필드가 존재한다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(rubric).toHaveProperty('criteria')
  })

  test('criteria가 배열이다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(Array.isArray(rubric.criteria)).toBe(true)
  })

  test('criteria 길이가 1 이상이다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(rubric.criteria.length).toBeGreaterThanOrEqual(1)
  })

  test('criteria 길이가 정확히 5이다 (F1~F5)', () => {
    const rubric = buildFalseSuccessRubric()
    expect(rubric.criteria).toHaveLength(5)
  })
})

// ── 4. criteria 각 항목 필수 필드 ─────────────────────────────────────────────

describe('buildFalseSuccessRubric — criteria 항목 필수 필드', () => {
  let rubric: Rubric

  beforeEach(() => {
    rubric = buildFalseSuccessRubric()
  })

  test('각 criterion에 id 필드가 있다', () => {
    for (const criterion of rubric.criteria) {
      expect(criterion).toHaveProperty('id')
      expect(typeof criterion.id).toBe('string')
      expect(criterion.id.length).toBeGreaterThan(0)
    }
  })

  test('각 criterion에 patternId 필드가 있다', () => {
    for (const criterion of rubric.criteria) {
      expect(criterion).toHaveProperty('patternId')
      expect(typeof criterion.patternId).toBe('string')
      expect(criterion.patternId.length).toBeGreaterThan(0)
    }
  })

  test('각 criterion에 description 필드가 있다', () => {
    for (const criterion of rubric.criteria) {
      expect(criterion).toHaveProperty('description')
      expect(typeof criterion.description).toBe('string')
      expect(criterion.description.length).toBeGreaterThan(0)
    }
  })

  test('각 criterion에 weight 필드가 있다', () => {
    for (const criterion of rubric.criteria) {
      expect(criterion).toHaveProperty('weight')
      expect(typeof criterion.weight).toBe('number')
    }
  })

  test('각 criterion에 kind 필드가 있다', () => {
    for (const criterion of rubric.criteria) {
      expect(criterion).toHaveProperty('kind')
    }
  })
})

// ── 5. criteria[].kind가 모두 'false_success' (BLOCKER C1) ───────────────────

describe('buildFalseSuccessRubric — criteria.kind BLOCKER C1', () => {
  test('모든 criterion.kind가 "false_success"이다', () => {
    const rubric = buildFalseSuccessRubric()
    for (const criterion of rubric.criteria) {
      expect(criterion.kind).toBe('false_success')
    }
  })

  test('어떤 criterion.kind도 "thrashing"이 아니다', () => {
    const rubric = buildFalseSuccessRubric()
    for (const criterion of rubric.criteria) {
      expect(criterion.kind).not.toBe('thrashing')
    }
  })
})

// ── 6. SPEC §5 §2.3 F1~F5 패턴 id 전체 포함 ─────────────────────────────────

describe('buildFalseSuccessRubric — SPEC §5 §2.3 F1~F5 패턴 포함', () => {
  const EXPECTED_PATTERN_IDS = [
    'unverified_completion',
    'self_validation_circular',
    'topic_divergence_success',
    'error_ignored',
    'partial_as_complete',
  ] as const

  test.each(EXPECTED_PATTERN_IDS)(
    '패턴 id "%s" 가 criteria에 포함된다',
    (patternId) => {
      const rubric = buildFalseSuccessRubric()
      const found = rubric.criteria.some(c => c.patternId === patternId)
      expect(found).toBe(true)
    },
  )

  test('F1~F5 모든 패턴 id가 누락 없이 포함된다', () => {
    const rubric = buildFalseSuccessRubric()
    const patternIds = rubric.criteria.map(c => c.patternId)
    for (const expected of EXPECTED_PATTERN_IDS) {
      expect(patternIds).toContain(expected)
    }
  })
})

// ── 7. criteria 순서 F1→F2→F3→F4→F5 ─────────────────────────────────────────

describe('buildFalseSuccessRubric — criteria 순서 보장', () => {
  test('criteria 순서가 F1→F2→F3→F4→F5이다', () => {
    const rubric = buildFalseSuccessRubric()
    const ids = rubric.criteria.map((c: RubricCriterion) => c.id)
    expect(ids).toEqual(['F1', 'F2', 'F3', 'F4', 'F5'])
  })

  test('criteria patternId 순서가 SPEC §5 §2.3 순서와 일치한다', () => {
    const rubric = buildFalseSuccessRubric()
    const patternIds = rubric.criteria.map((c: RubricCriterion) => c.patternId)
    expect(patternIds).toEqual([
      'unverified_completion',
      'self_validation_circular',
      'topic_divergence_success',
      'error_ignored',
      'partial_as_complete',
    ])
  })
})

// ── 8. weight 범위 0~1 ────────────────────────────────────────────────────────

describe('buildFalseSuccessRubric — weight 범위', () => {
  test('모든 criterion.weight가 0 이상이다', () => {
    const rubric = buildFalseSuccessRubric()
    for (const criterion of rubric.criteria) {
      expect(criterion.weight).toBeGreaterThanOrEqual(0)
    }
  })

  test('모든 criterion.weight가 1 이하이다', () => {
    const rubric = buildFalseSuccessRubric()
    for (const criterion of rubric.criteria) {
      expect(criterion.weight).toBeLessThanOrEqual(1)
    }
  })

  test('F4(error_ignored)의 weight가 가장 높다 (SPEC: "가중 매우 높음")', () => {
    const rubric = buildFalseSuccessRubric()
    const f4 = rubric.criteria.find(c => c.patternId === 'error_ignored')
    expect(f4).toBeDefined()
    const maxWeight = Math.max(...rubric.criteria.map(c => c.weight))
    expect(f4!.weight).toBe(maxWeight)
  })
})

// ── 9. 불변성 (Object.freeze) ─────────────────────────────────────────────────

describe('buildFalseSuccessRubric — 불변성', () => {
  test('반환 객체가 동결(frozen)되어 있다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(Object.isFrozen(rubric)).toBe(true)
  })

  test('rubric.criteria 배열이 동결되어 있다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(Object.isFrozen(rubric.criteria)).toBe(true)
  })

  test('rubric.kind 변경 시도는 TypeError를 던진다 (strict ESM + Object.freeze)', () => {
    const rubric = buildFalseSuccessRubric()
    // ESM strict 모드에서 Object.freeze된 객체 수정은 TypeError
    expect(() => {
      // @ts-expect-error frozen object mutation test
      rubric.kind = 'thrashing'
    }).toThrow(TypeError)
    // 값은 여전히 'false_success'
    expect(rubric.kind).toBe('false_success')
  })
})

// ── 10. 매 호출마다 독립된 객체 반환 ─────────────────────────────────────────

describe('buildFalseSuccessRubric — 호출 독립성', () => {
  test('두 번 호출 시 서로 다른 객체 참조를 반환한다', () => {
    const r1 = buildFalseSuccessRubric()
    const r2 = buildFalseSuccessRubric()
    expect(r1).not.toBe(r2)
  })

  test('두 번 호출 시 동일한 구조/값을 반환한다', () => {
    const r1 = buildFalseSuccessRubric()
    const r2 = buildFalseSuccessRubric()
    expect(r1.kind).toBe(r2.kind)
    expect(r1.blocker).toBe(r2.blocker)
    expect(r1.criteria).toHaveLength(r2.criteria.length)
    expect(r1.version).toBe(r2.version)
  })
})

// ── 11. findCriterionByPatternId 조회 함수 ───────────────────────────────────

describe('findCriterionByPatternId', () => {
  test('존재하는 patternId로 조회 시 해당 항목을 반환한다', () => {
    const rubric = buildFalseSuccessRubric()
    const criterion = findCriterionByPatternId(rubric, 'unverified_completion')
    expect(criterion).toBeDefined()
    expect(criterion!.id).toBe('F1')
    expect(criterion!.patternId).toBe('unverified_completion')
  })

  test('error_ignored(F4) 조회 시 올바른 항목을 반환한다', () => {
    const rubric = buildFalseSuccessRubric()
    const criterion = findCriterionByPatternId(rubric, 'error_ignored')
    expect(criterion).toBeDefined()
    expect(criterion!.id).toBe('F4')
  })

  test('존재하지 않는 patternId 조회 시 undefined를 반환한다', () => {
    const rubric = buildFalseSuccessRubric()
    const criterion = findCriterionByPatternId(rubric, 'nonexistent_pattern')
    expect(criterion).toBeUndefined()
  })

  test('빈 문자열 patternId 조회 시 undefined를 반환한다', () => {
    const rubric = buildFalseSuccessRubric()
    const criterion = findCriterionByPatternId(rubric, '')
    expect(criterion).toBeUndefined()
  })

  test('F1~F5 모든 항목을 patternId로 조회할 수 있다', () => {
    const rubric = buildFalseSuccessRubric()
    const patternIds = [
      'unverified_completion',
      'self_validation_circular',
      'topic_divergence_success',
      'error_ignored',
      'partial_as_complete',
    ]
    for (const patternId of patternIds) {
      const criterion = findCriterionByPatternId(rubric, patternId)
      expect(criterion).toBeDefined()
      expect(criterion!.patternId).toBe(patternId)
    }
  })
})

// ── 12. version 필드 ──────────────────────────────────────────────────────────

describe('buildFalseSuccessRubric — version 필드', () => {
  test('version 필드가 존재한다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(rubric).toHaveProperty('version')
  })

  test('version이 비어있지 않은 문자열이다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(typeof rubric.version).toBe('string')
    expect(rubric.version.length).toBeGreaterThan(0)
  })
})

// ── 13. decisionThreshold 필드 ───────────────────────────────────────────────

describe('buildFalseSuccessRubric — decisionThreshold 필드', () => {
  test('decisionThreshold 필드가 존재한다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(rubric).toHaveProperty('decisionThreshold')
  })

  test('decisionThreshold가 0 이상이다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(rubric.decisionThreshold).toBeGreaterThanOrEqual(0)
  })

  test('decisionThreshold가 1 이하이다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(rubric.decisionThreshold).toBeLessThanOrEqual(1)
  })

  test('decisionThreshold가 number 타입이다', () => {
    const rubric = buildFalseSuccessRubric()
    expect(typeof rubric.decisionThreshold).toBe('number')
  })
})
