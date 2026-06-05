/**
 * tests/parse-label-sub-ac-2.test.ts
 *
 * Sub-AC 2: parseLabel(raw: string): LabelValue 단위 테스트.
 *
 * 규칙:
 *   - 유효한 입력(tp/fp/tn/fn, 대소문자/공백 변형)은 LabelValue를 반환한다.
 *   - 유효하지 않은 입력은 Error를 던진다.
 *   - 부수효과 없음 (DB/FS/API 접근 없음).
 */

import { parseLabel, type LabelValue } from '../src/eval/cli/label-cli.js'

describe('parseLabel — Sub-AC 2', () => {
  // ─── 유효 입력 ────────────────────────────────────────────────────────────────

  describe('valid inputs', () => {
    const validCases: Array<[string, LabelValue]> = [
      // 소문자 정확 입력
      ['tp', 'tp'],
      ['fp', 'fp'],
      ['tn', 'tn'],
      ['fn', 'fn'],
      // 대문자 변형
      ['TP', 'tp'],
      ['FP', 'fp'],
      ['TN', 'tn'],
      ['FN', 'fn'],
      // 혼합 대소문자
      ['Tp', 'tp'],
      ['fP', 'fp'],
      ['Tn', 'tn'],
      ['fN', 'fn'],
      // 앞뒤 공백 포함
      [' tp', 'tp'],
      ['fp ', 'fp'],
      [' tn ', 'tn'],
      ['\tfn\t', 'fn'],
      // 대문자 + 공백 조합
      [' TP ', 'tp'],
      [' FP ', 'fp'],
    ]

    test.each(validCases)(
      'parseLabel(%j) → %j',
      (raw, expected) => {
        expect(parseLabel(raw)).toBe(expected)
      },
    )

    it('returns exactly the LabelValue type', () => {
      const result = parseLabel('tp')
      // TypeScript: result should be assignable to LabelValue
      const _check: LabelValue = result
      expect(_check).toBe('tp')
    })
  })

  // ─── 무효 입력 ────────────────────────────────────────────────────────────────

  describe('invalid inputs — throws Error', () => {
    const invalidCases: string[] = [
      // 완전히 다른 값
      'yes',
      'no',
      'positive',
      'negative',
      'true',
      'false',
      '1',
      '0',
      // 빈 문자열
      '',
      '   ',
      // 부분 매칭
      't',
      'f',
      'p',
      'n',
      // 유사하지만 틀린 값
      'tpp',
      'fpp',
      'tnn',
      'fnn',
      // 숫자/특수문자
      '42',
      '?',
      'tp fp',
      // 유니코드
      'тп',
    ]

    test.each(invalidCases)(
      'parseLabel(%j) throws',
      (raw) => {
        expect(() => parseLabel(raw)).toThrow(Error)
      },
    )

    it('error message includes the invalid value', () => {
      expect(() => parseLabel('bad-value')).toThrow(/bad-value/)
    })

    it('error message lists valid values', () => {
      let caughtMessage = ''
      try {
        parseLabel('oops')
      } catch (e) {
        if (e instanceof Error) caughtMessage = e.message
      }
      expect(caughtMessage).toMatch(/tp/)
      expect(caughtMessage).toMatch(/fp/)
      expect(caughtMessage).toMatch(/tn/)
      expect(caughtMessage).toMatch(/fn/)
    })

    it('throws Error (not a non-Error value)', () => {
      let caught: unknown
      try {
        parseLabel('invalid')
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(Error)
    })
  })

  // ─── 불변성 ───────────────────────────────────────────────────────────────────

  describe('immutability — input not mutated', () => {
    it('does not mutate the input string', () => {
      const input = ' TP '
      const original = input
      parseLabel(input)
      expect(input).toBe(original)
    })
  })

  // ─── 결정론성 ─────────────────────────────────────────────────────────────────

  describe('determinism', () => {
    it('returns the same value for the same input every call', () => {
      expect(parseLabel('tp')).toBe(parseLabel('tp'))
      expect(parseLabel('FN')).toBe(parseLabel('FN'))
    })
  })
})
