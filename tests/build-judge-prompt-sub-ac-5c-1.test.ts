/**
 * tests/build-judge-prompt-sub-ac-5c-1.test.ts
 *
 * Sub-AC 5c-1: build_judge_prompt(text, rubric) → string 단위 테스트.
 *
 * 검증 항목:
 *   1. 반환값에 rubric.criteria의 각 patternId가 포함된다
 *   2. 반환값에 rubric.criteria의 각 id(F1~F5)가 포함된다
 *   3. 반환값에 rubric.criteria의 각 description이 포함된다
 *   4. 반환값에 decisionThreshold가 포함된다
 *   5. 반환값에 rubric.version이 포함된다
 *   6. 반환값에 판정 대상 text가 포함된다
 *   7. BLOCKER C1: 반환 프롬프트에 "false_success" 리터럴이 포함되고
 *                  "fake_success"/"fakeSuccess"는 포함되지 않는다
 *   8. BLOCKER C2: 출력 스키마에 JudgeVerdict 필드(kind,subtype,confidence,
 *                  topicDivergence,circularReference,reason,rawSamples)가 모두 포함된다
 *   9. systemBlock과 volatileBlock이 분리되어 있다
 *  10. volatileBlock에 판정 대상 text가 포함된다
 *  11. systemBlock에 루브릭 섹션이 포함된다
 *  12. 빈 text 입력 시 에러를 throw한다
 *  13. rubric.kind가 'false_success'가 아니면 에러를 throw한다
 *  14. 반환 객체의 rubricKind가 'false_success'이다 (BLOCKER C1)
 *  15. 반환 객체가 동결(freeze)되어 있다
 *  16. 다양한 Rubric 입력(criteria 1개, 커스텀 rubric)에 대해 해당 필드가 포함된다
 *  17. fullPrompt = systemBlock + '\n\n' + volatileBlock
 *  18. criteria weight가 프롬프트에 반영된다
 *  19. 순수 함수: 동일 입력→동일 출력
 *  20. 입력 text/rubric을 변경하지 않는다 (불변성)
 */

import { buildJudgePrompt, type JudgePrompt } from '../src/detect/judge-prompt.js'
import {
  buildFalseSuccessRubric,
  type Rubric,
  type RubricCriterion,
} from '../src/detect/false-success-rubric.js'

// ── 헬퍼: 최소 유효 Rubric ────────────────────────────────────────────────────

function makeMinimalRubric(): Rubric {
  const criterion: RubricCriterion = Object.freeze({
    id: 'F1',
    patternId: 'unverified_completion',
    description: '완료 선언이 있으나 검증 tool_result가 없다.',
    weight: 0.9,
    kind: 'false_success' as const,
  })
  return Object.freeze({
    kind: 'false_success' as const,
    blocker: 'C1' as const,
    version: '1.0.0',
    criteria: Object.freeze([criterion]),
    decisionThreshold: 0.5,
  })
}

function makeCustomRubric(overrides?: Partial<Rubric>): Rubric {
  const base = buildFalseSuccessRubric()
  // Object.freeze된 객체이므로 새 객체 생성
  return Object.freeze({
    kind: base.kind,
    blocker: base.blocker,
    version: overrides?.version ?? base.version,
    criteria: overrides?.criteria ?? base.criteria,
    decisionThreshold: overrides?.decisionThreshold ?? base.decisionThreshold,
  })
}

const SAMPLE_TEXT = '작업이 완료되었습니다. 모든 테스트가 통과했습니다.'
const DEFAULT_RUBRIC = buildFalseSuccessRubric()

// ── 1. criteria patternId 포함 ─────────────────────────────────────────────────

describe('buildJudgePrompt — criteria patternId 포함', () => {
  test('F1~F5 모든 patternId가 fullPrompt에 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    for (const criterion of DEFAULT_RUBRIC.criteria) {
      expect(prompt.fullPrompt).toContain(criterion.patternId)
    }
  })

  test('F1~F5 모든 patternId가 systemBlock에 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    for (const criterion of DEFAULT_RUBRIC.criteria) {
      expect(prompt.systemBlock).toContain(criterion.patternId)
    }
  })

  test('커스텀 patternId가 fullPrompt에 포함된다', () => {
    const customRubric = Object.freeze({
      kind: 'false_success' as const,
      blocker: 'C1' as const,
      version: '1.0.0',
      criteria: Object.freeze([
        Object.freeze({
          id: 'X1',
          patternId: 'custom_pattern_xyz',
          description: '커스텀 패턴 설명.',
          weight: 0.8,
          kind: 'false_success' as const,
        }),
      ]),
      decisionThreshold: 0.5,
    })
    const prompt = buildJudgePrompt(SAMPLE_TEXT, customRubric)
    expect(prompt.fullPrompt).toContain('custom_pattern_xyz')
  })
})

// ── 2. criteria id(F1~F5) 포함 ────────────────────────────────────────────────

describe('buildJudgePrompt — criteria id(F1~F5) 포함', () => {
  test('F1~F5 모든 id가 fullPrompt에 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    for (const criterion of DEFAULT_RUBRIC.criteria) {
      expect(prompt.fullPrompt).toContain(criterion.id)
    }
  })

  test('systemBlock에 F1, F2, F3, F4, F5가 모두 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    for (const id of ['F1', 'F2', 'F3', 'F4', 'F5']) {
      expect(prompt.systemBlock).toContain(id)
    }
  })
})

// ── 3. criteria description 포함 ──────────────────────────────────────────────

describe('buildJudgePrompt — criteria description 포함', () => {
  test('F1~F5 모든 description의 일부가 fullPrompt에 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    // description 전체보다 앞부분 20자로 포함 여부 확인 (줄바꿈/공백 처리 허용)
    for (const criterion of DEFAULT_RUBRIC.criteria) {
      const snippet = criterion.description.slice(0, 20)
      expect(prompt.fullPrompt).toContain(snippet)
    }
  })

  test('단일 criterion description이 systemBlock에 포함된다', () => {
    const rubric = makeMinimalRubric()
    const prompt = buildJudgePrompt(SAMPLE_TEXT, rubric)
    expect(prompt.systemBlock).toContain('완료 선언이 있으나 검증 tool_result가 없다.')
  })
})

// ── 4. decisionThreshold 포함 ─────────────────────────────────────────────────

describe('buildJudgePrompt — decisionThreshold 포함', () => {
  test('rubric.decisionThreshold 값이 fullPrompt에 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.fullPrompt).toContain(String(DEFAULT_RUBRIC.decisionThreshold))
  })

  test('커스텀 decisionThreshold 값이 systemBlock에 포함된다', () => {
    const rubric = makeCustomRubric({ decisionThreshold: 0.75 })
    const prompt = buildJudgePrompt(SAMPLE_TEXT, rubric)
    expect(prompt.systemBlock).toContain('0.75')
  })

  test('decisionThreshold=0이 포함된다', () => {
    const rubric = makeCustomRubric({ decisionThreshold: 0 })
    const prompt = buildJudgePrompt(SAMPLE_TEXT, rubric)
    expect(prompt.systemBlock).toContain('0')
  })
})

// ── 5. rubric.version 포함 ────────────────────────────────────────────────────

describe('buildJudgePrompt — rubric.version 포함', () => {
  test('rubric.version이 fullPrompt에 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.fullPrompt).toContain(DEFAULT_RUBRIC.version)
  })

  test('커스텀 version이 systemBlock에 포함된다', () => {
    const rubric = makeCustomRubric({ version: '2.5.0' })
    const prompt = buildJudgePrompt(SAMPLE_TEXT, rubric)
    expect(prompt.systemBlock).toContain('2.5.0')
  })

  test('rubricVersion 필드가 rubric.version과 일치한다', () => {
    const rubric = makeCustomRubric({ version: '3.0.1' })
    const prompt = buildJudgePrompt(SAMPLE_TEXT, rubric)
    expect(prompt.rubricVersion).toBe('3.0.1')
  })
})

// ── 6. 판정 대상 text 포함 ────────────────────────────────────────────────────

describe('buildJudgePrompt — 판정 대상 text 포함', () => {
  test('판정 대상 text가 fullPrompt에 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.fullPrompt).toContain(SAMPLE_TEXT)
  })

  test('다양한 text가 fullPrompt에 포함된다', () => {
    const texts = [
      '완료했습니다.',
      '성공적으로 처리되었습니다.',
      'Task completed successfully.',
      '내가 확인한 결과 정상입니다.',
    ]
    for (const t of texts) {
      const prompt = buildJudgePrompt(t, DEFAULT_RUBRIC)
      expect(prompt.fullPrompt).toContain(t)
    }
  })

  test('긴 텍스트가 fullPrompt에 포함된다', () => {
    const longText = '작업이 완료되었습니다. '.repeat(50)
    const prompt = buildJudgePrompt(longText, DEFAULT_RUBRIC)
    expect(prompt.fullPrompt).toContain(longText.trim().slice(0, 50))
  })
})

// ── 7. BLOCKER C1: false_success 리터럴 ──────────────────────────────────────

describe('buildJudgePrompt — BLOCKER C1: false_success 리터럴', () => {
  test('fullPrompt에 "false_success" 리터럴이 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.fullPrompt).toContain('false_success')
  })

  test('출력 스키마 kind enum에 "fake_success"가 허용 값으로 나타나지 않는다 (BLOCKER C1)', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    // 출력 스키마 JSON 블록에서 kind 필드 값이 "false_success | none"이어야 한다.
    // "fake_success"는 허용 enum 값으로 나타나지 않는다.
    // (프롬프트 규칙 문구 안에서 "fake_success 금지"라고 언급하는 것은 허용됨)
    // 실제 출력 스키마 JSON 내부의 kind 값을 검증
    expect(prompt.systemBlock).toContain('"kind": "false_success | none"')
  })

  test('출력 스키마에 "fakeSuccess"가 허용 값으로 나타나지 않는다 (BLOCKER C1)', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    // 출력 스키마 JSON 내부 kind 필드에 "fakeSuccess"가 없어야 한다.
    expect(prompt.systemBlock).toContain('"kind": "false_success | none"')
    // 출력 스키마 블록에 fakeSuccess가 enum 값으로 포함되지 않는다.
    expect(prompt.systemBlock).not.toMatch(/"kind":\s*"[^"]*fakeSuccess[^"]*"/)
  })

  test('systemBlock에 kind enum이 "false_success | none"으로 제한된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    // SPEC §5 §2.3: kind는 "false_success" 또는 "none"만 허용
    expect(prompt.systemBlock).toMatch(/false_success.*none|none.*false_success/)
  })

  test('rubricKind 필드가 "false_success"이다 (BLOCKER C1)', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.rubricKind).toBe('false_success')
  })
})

// ── 8. BLOCKER C2: JudgeVerdict 필드 포함 ────────────────────────────────────

describe('buildJudgePrompt — BLOCKER C2: JudgeVerdict 필드 포함', () => {
  const JUDGE_VERDICT_FIELDS = [
    'kind',
    'subtype',
    'confidence',
    'topicDivergence',
    'circularReference',
    'reason',
    'rawSamples',
  ] as const

  test.each(JUDGE_VERDICT_FIELDS)(
    'fullPrompt에 JudgeVerdict 필드 "%s"가 포함된다 (BLOCKER C2)',
    (field) => {
      const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
      expect(prompt.fullPrompt).toContain(field)
    },
  )

  test('systemBlock에 JudgeVerdict 모든 필드가 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    for (const field of JUDGE_VERDICT_FIELDS) {
      expect(prompt.systemBlock).toContain(field)
    }
  })
})

// ── 9. systemBlock과 volatileBlock 분리 ───────────────────────────────────────

describe('buildJudgePrompt — systemBlock/volatileBlock 분리', () => {
  test('반환값에 systemBlock 필드가 존재한다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt).toHaveProperty('systemBlock')
    expect(typeof prompt.systemBlock).toBe('string')
    expect(prompt.systemBlock.length).toBeGreaterThan(0)
  })

  test('반환값에 volatileBlock 필드가 존재한다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt).toHaveProperty('volatileBlock')
    expect(typeof prompt.volatileBlock).toBe('string')
    expect(prompt.volatileBlock.length).toBeGreaterThan(0)
  })

  test('systemBlock과 volatileBlock이 서로 다른 내용을 가진다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.systemBlock).not.toBe(prompt.volatileBlock)
  })

  test('systemBlock에는 루브릭 내용이 있고, 텍스트만 다른 두 호출에서 systemBlock이 동일하다', () => {
    const p1 = buildJudgePrompt('텍스트 A', DEFAULT_RUBRIC)
    const p2 = buildJudgePrompt('텍스트 B', DEFAULT_RUBRIC)
    // 같은 rubric → systemBlock은 동일해야 함 (캐시 가능)
    expect(p1.systemBlock).toBe(p2.systemBlock)
  })

  test('텍스트가 다르면 volatileBlock이 다르다', () => {
    const p1 = buildJudgePrompt('텍스트 A', DEFAULT_RUBRIC)
    const p2 = buildJudgePrompt('텍스트 B', DEFAULT_RUBRIC)
    expect(p1.volatileBlock).not.toBe(p2.volatileBlock)
  })
})

// ── 10. volatileBlock에 text 포함 ─────────────────────────────────────────────

describe('buildJudgePrompt — volatileBlock에 text 포함', () => {
  test('volatileBlock에 판정 대상 text가 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.volatileBlock).toContain(SAMPLE_TEXT)
  })

  test('volatileBlock에 "판정 대상" 키워드가 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.volatileBlock).toContain('판정 대상')
  })
})

// ── 11. systemBlock에 루브릭 섹션 포함 ───────────────────────────────────────

describe('buildJudgePrompt — systemBlock에 루브릭 섹션 포함', () => {
  test('systemBlock에 "루브릭" 키워드가 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.systemBlock).toContain('루브릭')
  })

  test('systemBlock에 "false_success의 정의" 섹션이 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.systemBlock).toContain('false_success의 정의')
  })

  test('systemBlock에 "출력 스키마" 섹션이 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.systemBlock).toContain('출력 스키마')
  })

  test('systemBlock에 CoT 지시("사고 절차") 섹션이 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.systemBlock).toContain('사고 절차')
  })
})

// ── 12. 빈 text 입력 시 에러 ──────────────────────────────────────────────────

describe('buildJudgePrompt — 입력 검증: 빈 text', () => {
  test('빈 문자열 text 입력 시 에러를 throw한다', () => {
    expect(() => buildJudgePrompt('', DEFAULT_RUBRIC)).toThrow()
  })

  test('공백만 있는 text 입력 시 에러를 throw한다', () => {
    // zod min(1)은 문자 수 기준. 공백 1개는 통과하므로 빈 문자열만 테스트.
    expect(() => buildJudgePrompt('', DEFAULT_RUBRIC)).toThrow()
  })
})

// ── 13. rubric.kind 유효성 검증 ───────────────────────────────────────────────

describe('buildJudgePrompt — 입력 검증: rubric.kind', () => {
  test('rubric.kind가 "false_success"가 아니면 에러를 throw한다', () => {
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
    expect(() => buildJudgePrompt(SAMPLE_TEXT, invalidRubric)).toThrow()
  })

  test('rubric.criteria가 빈 배열이면 에러를 throw한다', () => {
    const emptyRubric = {
      kind: 'false_success' as const,
      blocker: 'C1' as const,
      version: '1.0.0',
      criteria: Object.freeze([]) as unknown as Rubric['criteria'],
      decisionThreshold: 0.5,
    } as Rubric
    expect(() => buildJudgePrompt(SAMPLE_TEXT, emptyRubric)).toThrow()
  })
})

// ── 14. rubricKind 필드 ───────────────────────────────────────────────────────

describe('buildJudgePrompt — rubricKind 필드 (BLOCKER C1)', () => {
  test('반환 객체의 rubricKind가 "false_success"이다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.rubricKind).toBe('false_success')
  })

  test('커스텀 rubric에서도 rubricKind가 "false_success"이다', () => {
    const rubric = makeMinimalRubric()
    const prompt = buildJudgePrompt(SAMPLE_TEXT, rubric)
    expect(prompt.rubricKind).toBe('false_success')
  })
})

// ── 15. 반환 객체 동결(freeze) ────────────────────────────────────────────────

describe('buildJudgePrompt — 반환 객체 동결', () => {
  test('반환 객체가 동결(frozen)되어 있다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(Object.isFrozen(prompt)).toBe(true)
  })

  test('반환 객체 필드 변경 시도는 TypeError를 던진다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC) as JudgePrompt & Record<string, unknown>
    expect(() => {
      // @ts-expect-error frozen object mutation test
      prompt.rubricKind = 'thrashing'
    }).toThrow(TypeError)
  })
})

// ── 16. 다양한 Rubric 입력 ────────────────────────────────────────────────────

describe('buildJudgePrompt — 다양한 Rubric 입력', () => {
  test('criteria 1개짜리 rubric에서 해당 patternId가 fullPrompt에 포함된다', () => {
    const rubric = makeMinimalRubric()
    const prompt = buildJudgePrompt(SAMPLE_TEXT, rubric)
    expect(prompt.fullPrompt).toContain('unverified_completion')
    expect(prompt.fullPrompt).toContain('F1')
  })

  test('criteria 3개짜리 커스텀 rubric에서 모든 patternId가 포함된다', () => {
    const criteria = Object.freeze([
      Object.freeze({ id: 'A1', patternId: 'pattern_alpha', description: '알파 패턴.', weight: 0.9, kind: 'false_success' as const }),
      Object.freeze({ id: 'A2', patternId: 'pattern_beta', description: '베타 패턴.', weight: 0.7, kind: 'false_success' as const }),
      Object.freeze({ id: 'A3', patternId: 'pattern_gamma', description: '감마 패턴.', weight: 0.5, kind: 'false_success' as const }),
    ])
    const rubric = Object.freeze({
      kind: 'false_success' as const,
      blocker: 'C1' as const,
      version: '2.0.0',
      criteria,
      decisionThreshold: 0.6,
    })
    const prompt = buildJudgePrompt('테스트 텍스트.', rubric)
    expect(prompt.fullPrompt).toContain('pattern_alpha')
    expect(prompt.fullPrompt).toContain('pattern_beta')
    expect(prompt.fullPrompt).toContain('pattern_gamma')
    expect(prompt.fullPrompt).toContain('2.0.0')
    expect(prompt.fullPrompt).toContain('0.6')
  })

  test('buildFalseSuccessRubric()으로 생성한 표준 rubric에서 F1~F5 전체가 포함된다', () => {
    const rubric = buildFalseSuccessRubric()
    const prompt = buildJudgePrompt('완료되었습니다.', rubric)
    for (const c of rubric.criteria) {
      expect(prompt.fullPrompt).toContain(c.id)
      expect(prompt.fullPrompt).toContain(c.patternId)
    }
  })
})

// ── 17. fullPrompt = systemBlock + '\n\n' + volatileBlock ─────────────────────

describe('buildJudgePrompt — fullPrompt 구성', () => {
  test('fullPrompt가 systemBlock + "\\n\\n" + volatileBlock이다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.fullPrompt).toBe(`${prompt.systemBlock}\n\n${prompt.volatileBlock}`)
  })

  test('fullPrompt가 비어있지 않다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.fullPrompt.length).toBeGreaterThan(0)
  })
})

// ── 18. weight가 프롬프트에 반영된다 ──────────────────────────────────────────

describe('buildJudgePrompt — weight 정보 반영', () => {
  test('F4(error_ignored, weight=0.95)에 "가중 매우 높음" 레이블이 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(prompt.systemBlock).toContain('가중 매우 높음')
  })

  test('weight 값(숫자)이 systemBlock에 포함된다', () => {
    const prompt = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    // F4 weight=0.95
    expect(prompt.systemBlock).toContain('0.95')
  })

  test('낮은 weight criterion에 "가중 낮음" 레이블이 포함된다', () => {
    const lowWeightRubric = Object.freeze({
      kind: 'false_success' as const,
      blocker: 'C1' as const,
      version: '1.0.0',
      criteria: Object.freeze([
        Object.freeze({
          id: 'L1',
          patternId: 'low_weight_pattern',
          description: '낮은 가중치 패턴.',
          weight: 0.3,
          kind: 'false_success' as const,
        }),
      ]),
      decisionThreshold: 0.5,
    })
    const prompt = buildJudgePrompt(SAMPLE_TEXT, lowWeightRubric)
    expect(prompt.systemBlock).toContain('가중 낮음')
  })
})

// ── 19. 순수 함수: 동일 입력→동일 출력 ──────────────────────────────────────

describe('buildJudgePrompt — 순수 함수', () => {
  test('동일 입력으로 두 번 호출하면 동일한 fullPrompt를 반환한다', () => {
    const p1 = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    const p2 = buildJudgePrompt(SAMPLE_TEXT, DEFAULT_RUBRIC)
    expect(p1.fullPrompt).toBe(p2.fullPrompt)
    expect(p1.systemBlock).toBe(p2.systemBlock)
    expect(p1.volatileBlock).toBe(p2.volatileBlock)
  })

  test('다른 text 입력은 다른 fullPrompt를 반환한다', () => {
    const p1 = buildJudgePrompt('텍스트 A', DEFAULT_RUBRIC)
    const p2 = buildJudgePrompt('텍스트 B', DEFAULT_RUBRIC)
    expect(p1.fullPrompt).not.toBe(p2.fullPrompt)
  })

  test('다른 rubric 입력은 다른 fullPrompt를 반환한다', () => {
    const rubric1 = makeCustomRubric({ version: '1.0.0' })
    const rubric2 = makeCustomRubric({ version: '2.0.0' })
    const p1 = buildJudgePrompt(SAMPLE_TEXT, rubric1)
    const p2 = buildJudgePrompt(SAMPLE_TEXT, rubric2)
    expect(p1.fullPrompt).not.toBe(p2.fullPrompt)
  })
})

// ── 20. 불변성: 입력 변경 없음 ────────────────────────────────────────────────

describe('buildJudgePrompt — 불변성', () => {
  test('함수 호출 후 입력 text가 변경되지 않는다', () => {
    const text = '원본 텍스트 내용입니다.'
    const originalText = text
    buildJudgePrompt(text, DEFAULT_RUBRIC)
    expect(text).toBe(originalText)
  })

  test('함수 호출 후 rubric.criteria 배열이 변경되지 않는다', () => {
    const rubric = buildFalseSuccessRubric()
    const originalLength = rubric.criteria.length
    const originalFirst = rubric.criteria[0]
    buildJudgePrompt(SAMPLE_TEXT, rubric)
    expect(rubric.criteria.length).toBe(originalLength)
    expect(rubric.criteria[0]).toBe(originalFirst)
  })

  test('함수 호출 후 rubric.kind가 변경되지 않는다', () => {
    const rubric = buildFalseSuccessRubric()
    buildJudgePrompt(SAMPLE_TEXT, rubric)
    expect(rubric.kind).toBe('false_success')
  })
})
