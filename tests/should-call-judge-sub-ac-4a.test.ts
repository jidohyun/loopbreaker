/**
 * tests/should-call-judge-sub-ac-4a.test.ts
 *
 * Sub-AC 4a: `shouldCallJudge(gate: GateResult): boolean`
 *   - gate 통과분(pass=true)일 때만 true를 반환
 *   - gate 탈락분(pass=false)일 때 false를 반환
 *
 * SPEC §4: "게이트 미통과 이벤트는 judge에 도달하지 않는다" (비용 게이트 핵심)
 * 외부 API 절대 미호출 — 네트워크·API 키 불필요.
 */

import { shouldCallJudge, type GateResult } from '../src/detect/semantic-stage.js'

describe('shouldCallJudge (Sub-AC 4a)', () => {
  describe('게이트 통과분 (pass=true) → true 반환', () => {
    test('pass=true인 GateResult를 받으면 true를 반환한다', () => {
      const gate: GateResult = { pass: true }
      expect(shouldCallJudge(gate)).toBe(true)
    })

    test('pass=true 객체에 다른 필드가 있어도 true를 반환한다', () => {
      const gate: GateResult & { extra: string } = { pass: true, extra: 'ignored' }
      expect(shouldCallJudge(gate)).toBe(true)
    })
  })

  describe('게이트 탈락분 (pass=false) → false 반환', () => {
    test('pass=false인 GateResult를 받으면 false를 반환한다', () => {
      const gate: GateResult = { pass: false }
      expect(shouldCallJudge(gate)).toBe(false)
    })

    test('pass=false 객체에 다른 필드가 있어도 false를 반환한다', () => {
      const gate: GateResult & { reason: string } = { pass: false, reason: 'no signal' }
      expect(shouldCallJudge(gate)).toBe(false)
    })
  })

  describe('결정론: 동일 입력 → 동일 출력', () => {
    test('pass=true를 여러 번 호출해도 항상 true', () => {
      const gate: GateResult = { pass: true }
      for (let i = 0; i < 10; i++) {
        expect(shouldCallJudge(gate)).toBe(true)
      }
    })

    test('pass=false를 여러 번 호출해도 항상 false', () => {
      const gate: GateResult = { pass: false }
      for (let i = 0; i < 10; i++) {
        expect(shouldCallJudge(gate)).toBe(false)
      }
    })
  })

  describe('불변성: 입력 객체를 변경하지 않는다', () => {
    test('pass=true 객체가 호출 후에도 그대로다', () => {
      const gate: GateResult = Object.freeze({ pass: true })
      expect(shouldCallJudge(gate)).toBe(true)
      expect(gate.pass).toBe(true)
    })

    test('pass=false 객체가 호출 후에도 그대로다', () => {
      const gate: GateResult = Object.freeze({ pass: false })
      expect(shouldCallJudge(gate)).toBe(false)
      expect(gate.pass).toBe(false)
    })
  })
})
