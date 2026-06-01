/**
 * tests/detector-config-sub-ac-6b.test.ts
 *
 * Sub-AC 6b: Detector/gate factory or constructor가 DetectorConfig 파라미터를
 * 받아 내부에 저장하고, 서로 다른 config로 생성한 두 인스턴스가
 * 각자의 값을 유지하며 교차 오염이 없음을 검증한다.
 *
 * 검증 항목:
 *   1. StructureGate constructor가 DetectorConfig를 파라미터로 받는다.
 *   2. 두 인스턴스를 서로 다른 config로 생성하면 각자의 config를 유지한다.
 *   3. 한 인스턴스의 config를 외부에서 변경해도 다른 인스턴스에 영향이 없다.
 *   4. createStructureGate 팩토리 함수도 동일 보장을 제공한다.
 *   5. 두 인스턴스가 각자의 config로 독립적으로 탐지 임계를 적용한다.
 */

import {
  type DetectorConfig,
  DEFAULT_DETECTOR_CONFIG,
} from '../src/contracts.js'
import {
  StructureGate,
  createStructureGate,
  createSessionState,
} from '../src/detect/structure-gate.js'
import type { NormalizedEvent } from '../src/contracts.js'

// ─── 헬퍼: 최소 NormalizedEvent 팩토리 ─────────────────────────────────────

let _seq = 0
function makeToolUseEvent(
  overrides: Partial<NormalizedEvent> & { tool: string; input?: Record<string, unknown> },
): NormalizedEvent {
  _seq++
  return {
    uuid: `uuid-${_seq}`,
    parentUuid: null,
    sessionId: 'sess-test',
    cwd: '/project',
    agentScope: 'root',
    isSidechain: false,
    ts: Date.now() + _seq,
    byteOffset: _seq * 100,
    kind: 'tool_use',
    resultClass: 'ok',
    ...overrides,
  }
}

// ─── 1. Constructor가 DetectorConfig를 받아 내부에 저장한다 ────────────────

describe('StructureGate — Sub-AC 6b: constructor가 DetectorConfig를 받아 내부에 저장한다', () => {
  test('StructureGate를 DEFAULT_DETECTOR_CONFIG로 생성하면 getConfig()가 동일 값을 반환한다', () => {
    const gate = new StructureGate(DEFAULT_DETECTOR_CONFIG)
    const stored = gate.getConfig()

    expect(stored.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING)
    expect(stored.CRITICAL).toBe(DEFAULT_DETECTOR_CONFIG.CRITICAL)
    expect(stored.historySize).toBe(DEFAULT_DETECTOR_CONFIG.historySize)
    expect(stored.errLoopWarn).toBe(DEFAULT_DETECTOR_CONFIG.errLoopWarn)
    expect(stored.errLoopCrit).toBe(DEFAULT_DETECTOR_CONFIG.errLoopCrit)
    expect(stored.fileEditWarn).toBe(DEFAULT_DETECTOR_CONFIG.fileEditWarn)
    expect(stored.fileEditCrit).toBe(DEFAULT_DETECTOR_CONFIG.fileEditCrit)
  })

  test('커스텀 DetectorConfig로 생성하면 getConfig()가 커스텀 값을 반환한다', () => {
    const custom: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      WARNING: 5,
      CRITICAL: 10,
      historySize: 15,
      errLoopWarn: 2,
      errLoopCrit: 4,
      fileEditWarn: 3,
      fileEditCrit: 6,
    }

    const gate = new StructureGate(custom)
    const stored = gate.getConfig()

    expect(stored.WARNING).toBe(5)
    expect(stored.CRITICAL).toBe(10)
    expect(stored.historySize).toBe(15)
    expect(stored.errLoopWarn).toBe(2)
    expect(stored.errLoopCrit).toBe(4)
    expect(stored.fileEditWarn).toBe(3)
    expect(stored.fileEditCrit).toBe(6)
  })
})

// ─── 2. 두 인스턴스가 서로 다른 config를 각자 유지한다 ──────────────────────

describe('StructureGate — Sub-AC 6b: 두 인스턴스가 각자의 config를 독립적으로 유지한다', () => {
  test('configA와 configB로 생성한 두 인스턴스가 각자의 값을 반환한다 (교차 오염 없음)', () => {
    const configA: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      WARNING: 3,
      CRITICAL: 6,
      historySize: 10,
      errLoopWarn: 1,
      errLoopCrit: 2,
      fileEditWarn: 2,
      fileEditCrit: 4,
    }

    const configB: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      WARNING: 99,
      CRITICAL: 199,
      historySize: 50,
      errLoopWarn: 20,
      errLoopCrit: 40,
      fileEditWarn: 30,
      fileEditCrit: 60,
    }

    const gateA = new StructureGate(configA)
    const gateB = new StructureGate(configB)

    // gateA는 configA 값을 유지
    expect(gateA.getConfig().WARNING).toBe(3)
    expect(gateA.getConfig().CRITICAL).toBe(6)
    expect(gateA.getConfig().historySize).toBe(10)
    expect(gateA.getConfig().errLoopWarn).toBe(1)
    expect(gateA.getConfig().errLoopCrit).toBe(2)
    expect(gateA.getConfig().fileEditWarn).toBe(2)
    expect(gateA.getConfig().fileEditCrit).toBe(4)

    // gateB는 configB 값을 유지
    expect(gateB.getConfig().WARNING).toBe(99)
    expect(gateB.getConfig().CRITICAL).toBe(199)
    expect(gateB.getConfig().historySize).toBe(50)
    expect(gateB.getConfig().errLoopWarn).toBe(20)
    expect(gateB.getConfig().errLoopCrit).toBe(40)
    expect(gateB.getConfig().fileEditWarn).toBe(30)
    expect(gateB.getConfig().fileEditCrit).toBe(60)

    // gateA의 config가 gateB에 오염되지 않음
    expect(gateA.getConfig().WARNING).not.toBe(gateB.getConfig().WARNING)
    expect(gateA.getConfig().CRITICAL).not.toBe(gateB.getConfig().CRITICAL)
  })

  test('gateA가 생성된 이후 원본 configA 객체를 변경해도 gateA 내부 config는 변경되지 않는다', () => {
    const mutableConfig: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      WARNING: 7,
    }

    const gate = new StructureGate(mutableConfig)

    // 외부에서 원본 객체를 변경 (방어적 복사가 없으면 오염됨)
    // TypeScript 타입 시스템상 직접 수정은 막히지 않음 (readonly는 런타임 보장이 없음)
    ;(mutableConfig as unknown as Record<string, unknown>)['WARNING'] = 999

    // gate 내부에는 방어적 복사가 되어 있어야 함
    expect(gate.getConfig().WARNING).toBe(7)
  })

  test('세 번째 인스턴스를 생성해도 기존 두 인스턴스의 config가 변경되지 않는다', () => {
    const configA: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, WARNING: 11 }
    const configB: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, WARNING: 22 }
    const configC: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, WARNING: 33 }

    const gateA = new StructureGate(configA)
    const gateB = new StructureGate(configB)
    new StructureGate(configC)

    // 세 번째 인스턴스 생성 후에도 A, B가 자신의 값 유지
    expect(gateA.getConfig().WARNING).toBe(11)
    expect(gateB.getConfig().WARNING).toBe(22)
  })
})

// ─── 3. createStructureGate 팩토리 함수도 동일 보장 ────────────────────────

describe('createStructureGate factory — Sub-AC 6b: 팩토리 함수도 교차 오염 없이 독립 인스턴스를 생성한다', () => {
  test('createStructureGate로 생성한 두 인스턴스가 각자의 config를 유지한다', () => {
    const configA: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, WARNING: 4, CRITICAL: 8 }
    const configB: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, WARNING: 40, CRITICAL: 80 }

    const gateA = createStructureGate(configA)
    const gateB = createStructureGate(configB)

    expect(gateA.getConfig().WARNING).toBe(4)
    expect(gateA.getConfig().CRITICAL).toBe(8)
    expect(gateB.getConfig().WARNING).toBe(40)
    expect(gateB.getConfig().CRITICAL).toBe(80)
  })

  test('createStructureGate는 StructureGate 인스턴스를 반환한다', () => {
    const gate = createStructureGate(DEFAULT_DETECTOR_CONFIG)
    expect(gate).toBeInstanceOf(StructureGate)
  })
})

// ─── 4. 두 인스턴스가 각자의 임계값으로 독립적으로 탐지한다 ──────────────────

describe('StructureGate — Sub-AC 6b: 두 인스턴스가 각자의 임계값으로 독립 탐지한다', () => {
  /**
   * gateA: WARNING=3 (낮은 임계 → 빨리 발화)
   * gateB: WARNING=99 (높은 임계 → 발화 안 함)
   *
   * 동일한 이벤트 시퀀스를 각 게이트에 보내면,
   * gateA는 warning을 발화하고 gateB는 null을 반환해야 한다.
   */
  test('낮은 임계 gateA는 3회 반복에서 warning을 발화하고, 높은 임계 gateB는 null을 반환한다', () => {
    const configA: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      WARNING: 3,
      CRITICAL: 6,
      historySize: 20,
      errLoopWarn: 99, // repeat_error 탐지 비활성화
      errLoopCrit: 99,
      fileEditWarn: 99, // file_edit 탐지 비활성화
      fileEditCrit: 99,
    }

    const configB: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      WARNING: 99,
      CRITICAL: 199,
      historySize: 20,
      errLoopWarn: 99,
      errLoopCrit: 99,
      fileEditWarn: 99,
      fileEditCrit: 99,
    }

    const gateA = new StructureGate(configA)
    const gateB = new StructureGate(configB)

    // 동일 Bash 명령 반복 이벤트
    const makeEvent = (i: number) => makeToolUseEvent({
      uuid: `bash-repeat-${i}`,
      tool: 'Bash',
      input: { command: 'echo hello' },
    })

    let stateA = createSessionState('sess', 'root', configA.historySize)
    let stateB = createSessionState('sess', 'root', configB.historySize)

    let lastResultA: ReturnType<StructureGate['process']>['result'] = null
    let lastResultB: ReturnType<StructureGate['process']>['result'] = null

    // 3회 반복
    for (let i = 1; i <= 3; i++) {
      const ev = makeEvent(i)
      const outA = gateA.process(ev, stateA)
      const outB = gateB.process(ev, stateB)
      stateA = outA.nextState
      stateB = outB.nextState
      lastResultA = outA.result
      lastResultB = outB.result
    }

    // gateA: WARNING=3이므로 3회에서 warning 발화
    expect(lastResultA).not.toBeNull()
    expect(lastResultA?.severity).toBe('warning')
    expect(lastResultA?.type).toBe('thrashing')

    // gateB: WARNING=99이므로 3회에서 발화 안 함
    expect(lastResultB).toBeNull()
  })

  test('gateA와 gateB가 각자 독립적인 SessionState를 관리하며 서로 영향을 주지 않는다', () => {
    const configA: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      WARNING: 2,
      CRITICAL: 4,
      historySize: 10,
      errLoopWarn: 99,
      errLoopCrit: 99,
      fileEditWarn: 99,
      fileEditCrit: 99,
    }

    const configB: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      WARNING: 50,
      CRITICAL: 100,
      historySize: 10,
      errLoopWarn: 99,
      errLoopCrit: 99,
      fileEditWarn: 99,
      fileEditCrit: 99,
    }

    const gateA = new StructureGate(configA)
    void new StructureGate(configB) // 생성만 해 교차 오염 없음 검증 (stateB는 독립 관리)

    let stateA = createSessionState('sess-a', 'root', configA.historySize)
    let stateB = createSessionState('sess-b', 'root', configB.historySize)

    // gateA에만 이벤트를 2회 보냄
    for (let i = 1; i <= 2; i++) {
      const ev = makeToolUseEvent({ uuid: `only-a-${i}`, tool: 'Bash', input: { command: 'ls' } })
      const out = gateA.process(ev, stateA)
      stateA = out.nextState
    }

    // gateB는 한 번도 이벤트를 받지 않음 → stateB는 빈 window
    expect(stateB.window.length).toBe(0)

    // gateA의 stateA는 2개 항목
    expect(stateA.window.length).toBe(2)
  })
})
