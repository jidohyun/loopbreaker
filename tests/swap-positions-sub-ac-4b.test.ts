/**
 * tests/swap-positions-sub-ac-4b.test.ts
 *
 * Sub-AC 4b: `swapPositions(prompt: JudgePrompt): JudgePrompt`
 *   - A/B 두 발화의 위치를 교환한 새 프롬프트를 반환한다
 *   - 원본 JudgePrompt의 불변성을 보장한다
 *
 * SPEC §5: position swap — 편향완화(position bias mitigation).
 * 외부 API 절대 미호출 — 순수 함수, 네트워크·API 키 불필요.
 */

import { swapPositions, type JudgePrompt } from '../src/detect/semantic-stage.js'

describe('swapPositions (Sub-AC 4b)', () => {
  // ---- 기본 교환 동작 ----

  describe('A/B 발화 위치 교환', () => {
    test('positionA와 positionB가 교환된 새 객체를 반환한다', () => {
      const prompt: JudgePrompt = {
        positionA: 'utterance-A',
        positionB: 'utterance-B',
      }
      const swapped = swapPositions(prompt)

      expect(swapped.positionA).toBe('utterance-B')
      expect(swapped.positionB).toBe('utterance-A')
    })

    test('동일한 텍스트도 교환한다 (대칭성)', () => {
      const prompt: JudgePrompt = {
        positionA: 'same-text',
        positionB: 'same-text',
      }
      const swapped = swapPositions(prompt)

      expect(swapped.positionA).toBe('same-text')
      expect(swapped.positionB).toBe('same-text')
    })

    test('빈 문자열도 교환한다', () => {
      const prompt: JudgePrompt = {
        positionA: '',
        positionB: 'non-empty',
      }
      const swapped = swapPositions(prompt)

      expect(swapped.positionA).toBe('non-empty')
      expect(swapped.positionB).toBe('')
    })

    test('멀티라인 텍스트도 교환한다', () => {
      const textA = 'line1\nline2\nline3'
      const textB = 'alpha\nbeta'
      const prompt: JudgePrompt = { positionA: textA, positionB: textB }
      const swapped = swapPositions(prompt)

      expect(swapped.positionA).toBe(textB)
      expect(swapped.positionB).toBe(textA)
    })
  })

  // ---- 선택 필드(prefix/suffix) 보존 ----

  describe('prefix/suffix 필드 보존', () => {
    test('prefix가 있을 때 그대로 유지된다', () => {
      const prompt: JudgePrompt = {
        positionA: 'A-text',
        positionB: 'B-text',
        prefix: 'rubric content',
      }
      const swapped = swapPositions(prompt)

      expect(swapped.prefix).toBe('rubric content')
      expect(swapped.positionA).toBe('B-text')
      expect(swapped.positionB).toBe('A-text')
    })

    test('suffix가 있을 때 그대로 유지된다', () => {
      const prompt: JudgePrompt = {
        positionA: 'A-text',
        positionB: 'B-text',
        suffix: 'instruction footer',
      }
      const swapped = swapPositions(prompt)

      expect(swapped.suffix).toBe('instruction footer')
      expect(swapped.positionA).toBe('B-text')
      expect(swapped.positionB).toBe('A-text')
    })

    test('prefix와 suffix 둘 다 있을 때 모두 유지된다', () => {
      const prompt: JudgePrompt = {
        positionA: 'A-text',
        positionB: 'B-text',
        prefix: 'pre',
        suffix: 'suf',
      }
      const swapped = swapPositions(prompt)

      expect(swapped.prefix).toBe('pre')
      expect(swapped.suffix).toBe('suf')
      expect(swapped.positionA).toBe('B-text')
      expect(swapped.positionB).toBe('A-text')
    })

    test('prefix/suffix 없을 때 결과에도 없다 (undefined)', () => {
      const prompt: JudgePrompt = {
        positionA: 'A-text',
        positionB: 'B-text',
      }
      const swapped = swapPositions(prompt)

      expect(swapped.prefix).toBeUndefined()
      expect(swapped.suffix).toBeUndefined()
    })
  })

  // ---- 원본 불변성 보장 ----

  describe('원본 불변성 (immutability)', () => {
    test('swapPositions 호출 후 원본 positionA가 변경되지 않는다', () => {
      const prompt: JudgePrompt = {
        positionA: 'original-A',
        positionB: 'original-B',
      }
      swapPositions(prompt)

      expect(prompt.positionA).toBe('original-A')
    })

    test('swapPositions 호출 후 원본 positionB가 변경되지 않는다', () => {
      const prompt: JudgePrompt = {
        positionA: 'original-A',
        positionB: 'original-B',
      }
      swapPositions(prompt)

      expect(prompt.positionB).toBe('original-B')
    })

    test('Object.freeze된 원본에서도 동작한다', () => {
      const prompt = Object.freeze<JudgePrompt>({
        positionA: 'frozen-A',
        positionB: 'frozen-B',
        prefix: 'frozen-prefix',
      })
      const swapped = swapPositions(prompt)

      expect(swapped.positionA).toBe('frozen-B')
      expect(swapped.positionB).toBe('frozen-A')
      expect(swapped.prefix).toBe('frozen-prefix')
      // 원본 확인
      expect(prompt.positionA).toBe('frozen-A')
      expect(prompt.positionB).toBe('frozen-B')
    })

    test('반환된 객체는 원본과 다른 참조다', () => {
      const prompt: JudgePrompt = {
        positionA: 'A-text',
        positionB: 'B-text',
      }
      const swapped = swapPositions(prompt)

      expect(swapped).not.toBe(prompt)
    })
  })

  // ---- 이중 교환 = 원본 복원 ----

  describe('이중 교환 대칭성 (double swap = identity)', () => {
    test('두 번 교환하면 원본과 같은 값이 된다', () => {
      const prompt: JudgePrompt = {
        positionA: 'A-text',
        positionB: 'B-text',
        prefix: 'rubric',
        suffix: 'footer',
      }
      const doubleSwapped = swapPositions(swapPositions(prompt))

      expect(doubleSwapped.positionA).toBe(prompt.positionA)
      expect(doubleSwapped.positionB).toBe(prompt.positionB)
      expect(doubleSwapped.prefix).toBe(prompt.prefix)
      expect(doubleSwapped.suffix).toBe(prompt.suffix)
    })
  })

  // ---- 결정론: 동일 입력 → 동일 출력 ----

  describe('결정론 (determinism)', () => {
    test('동일 입력을 여러 번 호출해도 항상 같은 결과다', () => {
      const prompt: JudgePrompt = {
        positionA: 'A-text',
        positionB: 'B-text',
      }
      const results = Array.from({ length: 5 }, () => swapPositions(prompt))

      for (const r of results) {
        expect(r.positionA).toBe('B-text')
        expect(r.positionB).toBe('A-text')
      }
    })
  })
})
