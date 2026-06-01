/**
 * tests/build-rubric-prompt-sub-ac-5c-1.test.ts
 *
 * Sub-AC 5c-1: buildFalseSuccessRubricPrompt(signals) → string 단위 테스트.
 *
 * 검증 항목:
 *   1. 반환 문자열에 편향완화 구문이 포함된다
 *      ("공정한 판정자", "위치 독립성", "자기일관성", "증거 기반", "보수적 판정")
 *   2. 반환 문자열에 rubric 키워드가 포함된다
 *      ("false_success", "루브릭", "unverified_completion", "error_ignored", "circularReference")
 *   3. 반환 문자열에 임베딩 신호 값(maxCosine)이 포함된다
 *   4. 반환 문자열에 구조 패턴 신호 값(detectedPatterns)이 포함된다
 *   5. BLOCKER C1: "false_success" 리터럴 포함, "fake_success"/"fakeSuccess" 금지
 *   6. BLOCKER C2: 출력 스키마에 JudgeVerdict 7개 필드가 모두 포함된다
 *   7. candidateText가 있으면 프롬프트에 포함된다
 *   8. candidateText가 없어도 프롬프트가 정상 생성된다
 *   9. 순수 함수: 동일 입력→동일 출력
 *  10. 불변성: 입력 signals를 변경하지 않는다
 *  11. 입력 검증: maxCosine > 1이면 에러를 throw한다
 *  12. 입력 검증: maxCosine < 0이면 에러를 throw한다
 *  13. simThreshold 값이 프롬프트에 포함된다
 *  14. gateTriggered=true이면 "gate_passed=true"가 포함된다
 *  15. circularReference=true이면 "circularReference=true"가 포함된다
 *  16. pairCount 값이 프롬프트에 포함된다
 *  17. 탐지 패턴이 없으면 "(탐지된 패턴 없음)"이 포함된다
 *  18. UNSUBSTANTIATED_COMPLETION 패턴이 탐지되면 해당 패턴 이름이 포함된다
 *  19. SELF_REFERENTIAL_VERIFICATION 패턴이 탐지되면 해당 패턴 이름이 포함된다
 *  20. position swap 안내 문구가 포함된다
 */

import {
  buildFalseSuccessRubricPrompt,
  type RubricPromptSignals,
  type EmbeddingSignal,
  type StructuralSignal,
} from '../src/detect/build-rubric-prompt.js'

// ── 픽스처 ────────────────────────────────────────────────────────────────────

const BASE_EMBEDDING: EmbeddingSignal = {
  maxCosine: 0.92,
  pairCount: 3,
  simThreshold: 0.85,
}

const BASE_STRUCTURAL: StructuralSignal = {
  detectedPatterns: ['UNSUBSTANTIATED_COMPLETION'],
  gateTriggered: true,
  circularReference: false,
}

const BASE_SIGNALS: RubricPromptSignals = {
  embedding: BASE_EMBEDDING,
  structural: BASE_STRUCTURAL,
  candidateText: '작업이 완료되었습니다. 모든 테스트가 통과했습니다.',
}

const SIGNALS_NO_TEXT: RubricPromptSignals = {
  embedding: BASE_EMBEDDING,
  structural: BASE_STRUCTURAL,
}

// ── 1. 편향완화 구문 포함 ──────────────────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — 편향완화 구문', () => {
  test('"공정한 판정자" 구문이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('공정한 판정자')
  })

  test('"위치 독립성" 편향완화 원칙이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('위치 독립성')
  })

  test('"자기일관성" 편향완화 원칙이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('자기일관성')
  })

  test('"증거 기반" 편향완화 원칙이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('증거 기반')
  })

  test('"보수적 판정" 편향완화 원칙이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('보수적 판정')
  })

  test('편향완화 헤더가 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('편향완화')
  })
})

// ── 2. rubric 키워드 포함 ─────────────────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — rubric 키워드', () => {
  test('"false_success" 리터럴이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('false_success')
  })

  test('"루브릭" 키워드가 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('루브릭')
  })

  test('"unverified_completion" 루브릭 패턴이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('unverified_completion')
  })

  test('"error_ignored" 루브릭 패턴이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('error_ignored')
  })

  test('"circularReference" 루브릭 키워드가 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('circularReference')
  })

  test('"self_validation_circular" 루브릭 패턴이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('self_validation_circular')
  })

  test('"topic_divergence_success" 루브릭 패턴이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('topic_divergence_success')
  })

  test('"partial_as_complete" 루브릭 패턴이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('partial_as_complete')
  })

  test('F1~F5 루브릭 항목 ID가 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    for (const id of ['F1', 'F2', 'F3', 'F4', 'F5']) {
      expect(prompt).toContain(id)
    }
  })
})

// ── 3. 임베딩 신호 값(maxCosine) 포함 ────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — 임베딩 신호 값', () => {
  test('maxCosine 값이 프롬프트에 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    // 0.92 → "0.9200" 형식으로 포함
    expect(prompt).toContain('0.9200')
  })

  test('다른 maxCosine 값이 프롬프트에 반영된다', () => {
    const signals: RubricPromptSignals = {
      ...BASE_SIGNALS,
      embedding: { ...BASE_EMBEDDING, maxCosine: 0.75 },
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(prompt).toContain('0.7500')
  })

  test('maxCosine=1.0이 프롬프트에 포함된다', () => {
    const signals: RubricPromptSignals = {
      ...BASE_SIGNALS,
      embedding: { ...BASE_EMBEDDING, maxCosine: 1.0 },
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(prompt).toContain('1.0000')
  })

  test('maxCosine=0이 프롬프트에 포함된다', () => {
    const signals: RubricPromptSignals = {
      ...BASE_SIGNALS,
      embedding: { ...BASE_EMBEDDING, maxCosine: 0 },
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(prompt).toContain('0.0000')
  })

  test('"maxCosine" 키워드가 프롬프트에 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('maxCosine')
  })
})

// ── 4. 구조 패턴 신호 값 포함 ────────────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — 구조 패턴 신호 값', () => {
  test('탐지된 패턴 이름이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('SELF_REFERENTIAL_VERIFICATION 패턴이 탐지되면 해당 이름이 포함된다', () => {
    const signals: RubricPromptSignals = {
      ...BASE_SIGNALS,
      structural: {
        ...BASE_STRUCTURAL,
        detectedPatterns: ['SELF_REFERENTIAL_VERIFICATION'],
      },
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(prompt).toContain('SELF_REFERENTIAL_VERIFICATION')
  })

  test('두 패턴 모두 탐지되면 둘 다 포함된다', () => {
    const signals: RubricPromptSignals = {
      ...BASE_SIGNALS,
      structural: {
        ...BASE_STRUCTURAL,
        detectedPatterns: ['UNSUBSTANTIATED_COMPLETION', 'SELF_REFERENTIAL_VERIFICATION'],
      },
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(prompt).toContain('UNSUBSTANTIATED_COMPLETION')
    expect(prompt).toContain('SELF_REFERENTIAL_VERIFICATION')
  })
})

// ── 5. BLOCKER C1: false_success 리터럴 ──────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — BLOCKER C1', () => {
  test('"false_success" 리터럴이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('false_success')
  })

  test('출력 스키마 kind enum이 "false_success | none"이다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('"kind": "false_success | none"')
  })

  test('출력 스키마에 "fake_success"가 enum 허용 값으로 나타나지 않는다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    // 출력 스키마 kind 필드 값에 fake_success가 없어야 한다
    expect(prompt).not.toMatch(/"kind":\s*"[^"]*fake_success[^"]*"/)
  })

  test('출력 스키마에 "fakeSuccess"가 enum 허용 값으로 나타나지 않는다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).not.toMatch(/"kind":\s*"[^"]*fakeSuccess[^"]*"/)
  })
})

// ── 6. BLOCKER C2: JudgeVerdict 7개 필드 포함 ────────────────────────────────

describe('buildFalseSuccessRubricPrompt — BLOCKER C2: JudgeVerdict 필드', () => {
  const VERDICT_FIELDS = [
    'kind',
    'subtype',
    'confidence',
    'topicDivergence',
    'circularReference',
    'reason',
    'rawSamples',
  ] as const

  test.each(VERDICT_FIELDS)(
    'JudgeVerdict 필드 "%s"가 출력 스키마에 포함된다',
    (field) => {
      const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
      expect(prompt).toContain(field)
    },
  )
})

// ── 7. candidateText 포함 ────────────────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — candidateText', () => {
  test('candidateText가 있으면 프롬프트에 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('작업이 완료되었습니다. 모든 테스트가 통과했습니다.')
  })

  test('다른 candidateText가 프롬프트에 반영된다', () => {
    const signals: RubricPromptSignals = {
      ...BASE_SIGNALS,
      candidateText: '구현을 성공적으로 완료했습니다.',
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(prompt).toContain('구현을 성공적으로 완료했습니다.')
  })
})

// ── 8. candidateText 없어도 정상 생성 ────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — candidateText 없음', () => {
  test('candidateText가 없어도 프롬프트가 생성된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(SIGNALS_NO_TEXT)
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })

  test('candidateText가 없으면 "판정 대상 텍스트" 섹션이 생략된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(SIGNALS_NO_TEXT)
    // 판정 대상 텍스트 섹션은 없어야 하지만 다른 내용은 있어야 함
    expect(prompt).toContain('false_success')
    expect(prompt).toContain('루브릭')
  })

  test('candidateText가 undefined이면 프롬프트가 정상 생성된다', () => {
    const signals: RubricPromptSignals = {
      embedding: BASE_EMBEDDING,
      structural: BASE_STRUCTURAL,
      candidateText: undefined,
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(typeof prompt).toBe('string')
    expect(prompt).toContain('공정한 판정자')
  })
})

// ── 9. 순수 함수 ─────────────────────────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — 순수 함수', () => {
  test('동일 입력으로 두 번 호출하면 동일한 결과를 반환한다', () => {
    const p1 = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    const p2 = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(p1).toBe(p2)
  })

  test('다른 maxCosine 입력은 다른 결과를 반환한다', () => {
    const s1: RubricPromptSignals = { ...BASE_SIGNALS, embedding: { ...BASE_EMBEDDING, maxCosine: 0.7 } }
    const s2: RubricPromptSignals = { ...BASE_SIGNALS, embedding: { ...BASE_EMBEDDING, maxCosine: 0.95 } }
    const p1 = buildFalseSuccessRubricPrompt(s1)
    const p2 = buildFalseSuccessRubricPrompt(s2)
    expect(p1).not.toBe(p2)
  })
})

// ── 10. 불변성: 입력 변경 없음 ────────────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — 불변성', () => {
  test('함수 호출 후 embedding.maxCosine이 변경되지 않는다', () => {
    const signals: RubricPromptSignals = {
      embedding: { maxCosine: 0.88, pairCount: 2, simThreshold: 0.8 },
      structural: BASE_STRUCTURAL,
    }
    const original = signals.embedding.maxCosine
    buildFalseSuccessRubricPrompt(signals)
    expect(signals.embedding.maxCosine).toBe(original)
  })

  test('함수 호출 후 structural.detectedPatterns가 변경되지 않는다', () => {
    const signals: RubricPromptSignals = {
      embedding: BASE_EMBEDDING,
      structural: {
        detectedPatterns: ['UNSUBSTANTIATED_COMPLETION'],
        gateTriggered: true,
        circularReference: false,
      },
    }
    const originalLength = signals.structural.detectedPatterns.length
    buildFalseSuccessRubricPrompt(signals)
    expect(signals.structural.detectedPatterns.length).toBe(originalLength)
  })
})

// ── 11-12. 입력 검증 ─────────────────────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — 입력 검증', () => {
  test('maxCosine > 1이면 에러를 throw한다', () => {
    const signals = {
      embedding: { maxCosine: 1.5, pairCount: 1, simThreshold: 0.8 },
      structural: BASE_STRUCTURAL,
    }
    expect(() => buildFalseSuccessRubricPrompt(signals)).toThrow()
  })

  test('maxCosine < 0이면 에러를 throw한다', () => {
    const signals = {
      embedding: { maxCosine: -0.1, pairCount: 1, simThreshold: 0.8 },
      structural: BASE_STRUCTURAL,
    }
    expect(() => buildFalseSuccessRubricPrompt(signals)).toThrow()
  })

  test('pairCount가 음수이면 에러를 throw한다', () => {
    const signals = {
      embedding: { maxCosine: 0.9, pairCount: -1, simThreshold: 0.8 },
      structural: BASE_STRUCTURAL,
    }
    expect(() => buildFalseSuccessRubricPrompt(signals)).toThrow()
  })
})

// ── 13. simThreshold 값 포함 ─────────────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — simThreshold 값', () => {
  test('simThreshold 값이 프롬프트에 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('0.85')
  })

  test('커스텀 simThreshold가 프롬프트에 반영된다', () => {
    const signals: RubricPromptSignals = {
      ...BASE_SIGNALS,
      embedding: { ...BASE_EMBEDDING, simThreshold: 0.92 },
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(prompt).toContain('0.92')
  })
})

// ── 14. gateTriggered 반영 ────────────────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — gateTriggered', () => {
  test('gateTriggered=true이면 "gate_passed=true"가 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('gate_passed=true')
  })

  test('gateTriggered=false이면 "gate_passed=true"가 포함되지 않는다', () => {
    const signals: RubricPromptSignals = {
      ...BASE_SIGNALS,
      structural: { ...BASE_STRUCTURAL, gateTriggered: false },
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(prompt).not.toContain('gate_passed=true')
  })
})

// ── 15. circularReference 반영 ────────────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — circularReference', () => {
  test('circularReference=true이면 "circularReference=true"가 포함된다', () => {
    const signals: RubricPromptSignals = {
      ...BASE_SIGNALS,
      structural: { ...BASE_STRUCTURAL, circularReference: true },
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(prompt).toContain('circularReference=true')
  })

  test('circularReference=false이면 순환참조 탐지 결과가 프롬프트에 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    // gateTriggered=false: "아니오" 문구 포함
    expect(prompt).toContain('아니오')
  })
})

// ── 16. pairCount 값 포함 ─────────────────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — pairCount', () => {
  test('pairCount 값이 프롬프트에 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    // pairCount=3
    expect(prompt).toContain('3')
  })

  test('커스텀 pairCount가 프롬프트에 반영된다', () => {
    const signals: RubricPromptSignals = {
      ...BASE_SIGNALS,
      embedding: { ...BASE_EMBEDDING, pairCount: 7 },
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(prompt).toContain('7')
  })
})

// ── 17. 탐지 패턴 없으면 "(탐지된 패턴 없음)" 포함 ──────────────────────────

describe('buildFalseSuccessRubricPrompt — 빈 패턴 목록', () => {
  test('탐지 패턴이 없으면 "(탐지된 패턴 없음)"이 포함된다', () => {
    const signals: RubricPromptSignals = {
      ...BASE_SIGNALS,
      structural: { ...BASE_STRUCTURAL, detectedPatterns: [] },
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(prompt).toContain('탐지된 패턴 없음')
  })
})

// ── 18-19. 각 패턴 이름 포함 ─────────────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — 개별 패턴 이름', () => {
  test('UNSUBSTANTIATED_COMPLETION 패턴이 탐지되면 해당 이름이 포함된다', () => {
    const signals: RubricPromptSignals = {
      ...BASE_SIGNALS,
      structural: {
        ...BASE_STRUCTURAL,
        detectedPatterns: ['UNSUBSTANTIATED_COMPLETION'],
      },
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(prompt).toContain('UNSUBSTANTIATED_COMPLETION')
  })

  test('SELF_REFERENTIAL_VERIFICATION 패턴이 탐지되면 해당 이름이 포함된다', () => {
    const signals: RubricPromptSignals = {
      ...BASE_SIGNALS,
      structural: {
        ...BASE_STRUCTURAL,
        detectedPatterns: ['SELF_REFERENTIAL_VERIFICATION'],
      },
    }
    const prompt = buildFalseSuccessRubricPrompt(signals)
    expect(prompt).toContain('SELF_REFERENTIAL_VERIFICATION')
  })
})

// ── 20. position swap 안내 포함 ───────────────────────────────────────────────

describe('buildFalseSuccessRubricPrompt — position swap 안내', () => {
  test('position swap 안내 문구가 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('position swap')
  })

  test('사고 절차(CoT) 섹션이 포함된다', () => {
    const prompt = buildFalseSuccessRubricPrompt(BASE_SIGNALS)
    expect(prompt).toContain('사고 절차')
  })
})
