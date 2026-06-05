/**
 * tests/format-candidate-sub-ac-8-1.test.ts
 *
 * Sub-AC 1: formatCandidate(candidate): string
 *   후보 객체를 io.write에 넘길 문자열로 직렬화한다.
 *   단위 테스트가 픽스처 후보 객체를 입력해 출력 문자열 형식을 검증한다.
 *
 * 검증 항목:
 *   1. thrashing 후보 — start/end/windowRefs 포함, anchor 없음
 *   2. false_success 후보 — anchor 포함, start/end 없음
 *   3. windowRefs 5개 초과 → 트렁케이션 '...(N more)'
 *   4. windowRefs 빈 배열 → '[]'
 *   5. metrics 없음 → '(none)'
 *   6. metrics 여러 개 → key=value 콤마 구분
 *   7. 출력 문자열이 '\n'으로 끝남
 *   8. 헤더에 candidateId 포함
 *   9. parseLabelInput 파싱 검증
 *  10. formatLabelPrompt 반환값 검증
 */

import {
  formatCandidate,
  parseLabelInput,
  formatLabelPrompt,
} from '../src/eval/cli/label-cli.js'
import type { CandidateSignal } from '../src/eval/eval-contracts.js'

// ─── 픽스처 ──────────────────────────────────────────────────────────────────

/** thrashing 후보 픽스처 */
const thrashingCandidate: CandidateSignal = {
  candidateId: 'cand-thrashing-001',
  sessionId: 'sess-abc123',
  kind: 'thrashing',
  subtype: 'rapid_back_and_forth',
  anchorUuid: undefined,
  startUuid: 'uuid-start-001',
  endUuid: 'uuid-end-003',
  windowRefs: ['uuid-start-001', 'uuid-middle-002', 'uuid-end-003'],
  severity: 'critical',
  metrics: { repCount: 4, deltaMs: 120 },
  minedAt: 1700000000000,
}

/** false_success 후보 픽스처 */
const falseSuccessCandidate: CandidateSignal = {
  candidateId: 'cand-fs-002',
  sessionId: 'sess-def456',
  kind: 'false_success',
  subtype: 'self_approval',
  anchorUuid: 'uuid-anchor-007',
  startUuid: undefined,
  endUuid: undefined,
  windowRefs: ['uuid-anchor-007', 'uuid-near-008'],
  severity: 'warning',
  metrics: { confidence: 0.87 },
  minedAt: 1700000001000,
}

/** windowRefs가 6개인 후보 (트렁케이션 테스트용) */
const manyRefsCandidate: CandidateSignal = {
  candidateId: 'cand-many-003',
  sessionId: 'sess-ghi789',
  kind: 'thrashing',
  subtype: 'multi_window',
  anchorUuid: undefined,
  startUuid: 'uuid-w001',
  endUuid: 'uuid-w006',
  windowRefs: ['uuid-w001', 'uuid-w002', 'uuid-w003', 'uuid-w004', 'uuid-w005', 'uuid-w006'],
  severity: 'warning',
  metrics: { repCount: 6 },
  minedAt: 1700000002000,
}

/** windowRefs가 빈 후보 */
const emptyRefsCandidate: CandidateSignal = {
  candidateId: 'cand-empty-004',
  sessionId: 'sess-jkl012',
  kind: 'none',
  subtype: 'no_signal',
  anchorUuid: undefined,
  startUuid: undefined,
  endUuid: undefined,
  windowRefs: [],
  severity: 'warning',
  metrics: {},
  minedAt: 1700000003000,
}

// ─── formatCandidate 테스트 ───────────────────────────────────────────────────

describe('formatCandidate', () => {
  describe('thrashing 후보', () => {
    let result: string

    beforeEach(() => {
      result = formatCandidate(thrashingCandidate)
    })

    it('출력 문자열이 \\n으로 끝난다', () => {
      expect(result.endsWith('\n')).toBe(true)
    })

    it('헤더에 candidateId가 포함된다', () => {
      expect(result).toContain('cand-thrashing-001')
    })

    it('kind 필드가 포함된다', () => {
      expect(result).toContain('kind      : thrashing')
    })

    it('subtype 필드가 포함된다', () => {
      expect(result).toContain('subtype   : rapid_back_and_forth')
    })

    it('sessionId 필드가 포함된다', () => {
      expect(result).toContain('sessionId : sess-abc123')
    })

    it('severity 필드가 포함된다', () => {
      expect(result).toContain('severity  : critical')
    })

    it('start UUID가 포함된다', () => {
      expect(result).toContain('start     : uuid-start-001')
    })

    it('end UUID가 포함된다', () => {
      expect(result).toContain('end       : uuid-end-003')
    })

    it('anchor 라인이 없다 (thrashing에는 anchor 없음)', () => {
      expect(result).not.toContain('anchor    :')
    })

    it('windowRefs가 표시된다', () => {
      expect(result).toContain('uuid-start-001')
      expect(result).toContain('uuid-middle-002')
      expect(result).toContain('uuid-end-003')
    })

    it('metrics가 key=value 형식으로 표시된다', () => {
      expect(result).toContain('repCount=4')
      expect(result).toContain('deltaMs=120')
    })

    it('헤더 박스 문자(┌)와 푸터 박스 문자(└)가 있다', () => {
      expect(result).toContain('┌')
      expect(result).toContain('└')
    })

    it('라인 구분자(│)가 있다', () => {
      expect(result).toContain('│')
    })
  })

  describe('false_success 후보', () => {
    let result: string

    beforeEach(() => {
      result = formatCandidate(falseSuccessCandidate)
    })

    it('출력 문자열이 \\n으로 끝난다', () => {
      expect(result.endsWith('\n')).toBe(true)
    })

    it('헤더에 candidateId가 포함된다', () => {
      expect(result).toContain('cand-fs-002')
    })

    it('kind 필드가 false_success이다', () => {
      expect(result).toContain('kind      : false_success')
    })

    it('anchor UUID가 포함된다', () => {
      expect(result).toContain('anchor    : uuid-anchor-007')
    })

    it('start/end 라인이 없다 (false_success에는 start/end 없음)', () => {
      expect(result).not.toContain('start     :')
      expect(result).not.toContain('end       :')
    })

    it('windowRefs가 표시된다', () => {
      expect(result).toContain('uuid-anchor-007')
    })

    it('metrics confidence가 표시된다', () => {
      expect(result).toContain('confidence=0.87')
    })
  })

  describe('windowRefs 트렁케이션 (6개)', () => {
    let result: string

    beforeEach(() => {
      result = formatCandidate(manyRefsCandidate)
    })

    it('처음 5개의 ref가 표시된다', () => {
      expect(result).toContain('uuid-w001')
      expect(result).toContain('uuid-w002')
      expect(result).toContain('uuid-w003')
      expect(result).toContain('uuid-w004')
      expect(result).toContain('uuid-w005')
    })

    it('6번째 ref는 직접 표시 대신 트렁케이션 표기가 있다', () => {
      expect(result).toContain('...(1 more)')
    })

    it('6번째 uuid는 직접 표시되지 않는다 (트렁케이션)', () => {
      // uuid-w006은 '...(1 more)' 로 대체됨
      // 단, startUuid/endUuid 필드에는 포함될 수 있으므로 windowRefs 라인에서만 확인
      const windowLine = result.split('\n').find(l => l.includes('windowRefs'))
      expect(windowLine).toBeDefined()
      expect(windowLine).not.toContain('uuid-w006')
    })
  })

  describe('windowRefs 빈 배열', () => {
    let result: string

    beforeEach(() => {
      result = formatCandidate(emptyRefsCandidate)
    })

    it('windowRefs: [] 형식으로 표시된다', () => {
      expect(result).toContain('windowRefs: []')
    })
  })

  describe('metrics 없음', () => {
    let result: string

    beforeEach(() => {
      result = formatCandidate(emptyRefsCandidate)
    })

    it('metrics: (none) 으로 표시된다', () => {
      expect(result).toContain('metrics   : (none)')
    })
  })

  describe('metrics 여러 개', () => {
    it('콤마로 구분된 key=value 쌍이 모두 포함된다', () => {
      const result = formatCandidate(thrashingCandidate)
      // repCount=4, deltaMs=120 순서 무관하게 존재 확인
      expect(result).toContain('repCount=4')
      expect(result).toContain('deltaMs=120')
    })
  })

  describe('입력 불변성', () => {
    it('입력 candidate 객체가 변경되지 않는다', () => {
      const original = { ...thrashingCandidate, windowRefs: [...thrashingCandidate.windowRefs] }
      formatCandidate(thrashingCandidate)
      expect(thrashingCandidate.candidateId).toBe(original.candidateId)
      expect(thrashingCandidate.windowRefs).toEqual(original.windowRefs)
      expect(thrashingCandidate.metrics).toEqual(original.metrics)
    })
  })

  describe('windowRefs 정확히 5개 (트렁케이션 없음)', () => {
    it('5개는 트렁케이션 없이 모두 표시된다', () => {
      const fiveRefsCandidate: CandidateSignal = {
        ...thrashingCandidate,
        candidateId: 'cand-five-refs',
        windowRefs: ['u1', 'u2', 'u3', 'u4', 'u5'],
      }
      const result = formatCandidate(fiveRefsCandidate)
      expect(result).toContain('u1')
      expect(result).toContain('u5')
      expect(result).not.toContain('more)')
    })
  })
})

// ─── parseLabelInput 테스트 ───────────────────────────────────────────────────

describe('parseLabelInput', () => {
  it('"positive" → "positive"', () => {
    expect(parseLabelInput('positive')).toBe('positive')
  })

  it('"p" → "positive"', () => {
    expect(parseLabelInput('p')).toBe('positive')
  })

  it('"negative" → "negative"', () => {
    expect(parseLabelInput('negative')).toBe('negative')
  })

  it('"n" → "negative"', () => {
    expect(parseLabelInput('n')).toBe('negative')
  })

  it('"skip" → "skip"', () => {
    expect(parseLabelInput('skip')).toBe('skip')
  })

  it('"s" → "skip"', () => {
    expect(parseLabelInput('s')).toBe('skip')
  })

  it('대문자 "P" → "positive" (대소문자 무시)', () => {
    expect(parseLabelInput('P')).toBe('positive')
  })

  it('앞뒤 공백 제거 후 파싱', () => {
    expect(parseLabelInput('  p  ')).toBe('positive')
  })

  it('유효하지 않은 입력 → null', () => {
    expect(parseLabelInput('yes')).toBeNull()
    expect(parseLabelInput('x')).toBeNull()
    expect(parseLabelInput('')).toBeNull()
    expect(parseLabelInput('1')).toBeNull()
  })
})

// ─── formatLabelPrompt 테스트 ─────────────────────────────────────────────────

describe('formatLabelPrompt', () => {
  it('프롬프트 문자열을 반환한다', () => {
    const prompt = formatLabelPrompt()
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('[p]ositive 힌트가 포함된다', () => {
    expect(formatLabelPrompt()).toContain('[p]')
  })

  it('[n]egative 힌트가 포함된다', () => {
    expect(formatLabelPrompt()).toContain('[n]')
  })

  it('[s]kip 힌트가 포함된다', () => {
    expect(formatLabelPrompt()).toContain('[s]')
  })
})
