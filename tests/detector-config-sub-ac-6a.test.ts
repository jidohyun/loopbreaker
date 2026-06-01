// tests/detector-config-sub-ac-6a.test.ts
// Sub-AC 6a: DetectorConfig의 7개 임계값 필드가 각각 독립적으로 설정·읽기 가능함을 검증.
//
// 대상 필드 (SPEC §1, contracts.ts DetectorConfig):
//   WARNING, CRITICAL, historySize, errLoopWarn, errLoopCrit, fileEditWarn, fileEditCrit
//
// 모든 임계는 DetectorConfig에서 주입되어야 하며 코드 상수 금지 (SPEC §4 constraint).

import {
  type DetectorConfig,
  DEFAULT_DETECTOR_CONFIG,
} from '../src/contracts.js'

// ── 1. 필드 존재 & 타입 검증 ─────────────────────────────────────────────────

describe('DetectorConfig — Sub-AC 6a: 7개 임계값 필드 존재 및 타입', () => {
  test('WARNING 필드가 number 타입으로 정의된다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    expect(typeof cfg.WARNING).toBe('number')
    expect(Object.prototype.hasOwnProperty.call(cfg, 'WARNING')).toBe(true)
  })

  test('CRITICAL 필드가 number 타입으로 정의된다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    expect(typeof cfg.CRITICAL).toBe('number')
    expect(Object.prototype.hasOwnProperty.call(cfg, 'CRITICAL')).toBe(true)
  })

  test('historySize 필드가 number 타입으로 정의된다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    expect(typeof cfg.historySize).toBe('number')
    expect(Object.prototype.hasOwnProperty.call(cfg, 'historySize')).toBe(true)
  })

  test('errLoopWarn 필드가 number 타입으로 정의된다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    expect(typeof cfg.errLoopWarn).toBe('number')
    expect(Object.prototype.hasOwnProperty.call(cfg, 'errLoopWarn')).toBe(true)
  })

  test('errLoopCrit 필드가 number 타입으로 정의된다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    expect(typeof cfg.errLoopCrit).toBe('number')
    expect(Object.prototype.hasOwnProperty.call(cfg, 'errLoopCrit')).toBe(true)
  })

  test('fileEditWarn 필드가 number 타입으로 정의된다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    expect(typeof cfg.fileEditWarn).toBe('number')
    expect(Object.prototype.hasOwnProperty.call(cfg, 'fileEditWarn')).toBe(true)
  })

  test('fileEditCrit 필드가 number 타입으로 정의된다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    expect(typeof cfg.fileEditCrit).toBe('number')
    expect(Object.prototype.hasOwnProperty.call(cfg, 'fileEditCrit')).toBe(true)
  })
})

// ── 2. 각 필드를 독립적으로 설정하면 해당 필드만 변경되고 나머지는 기본값 유지 ───

describe('DetectorConfig — Sub-AC 6a: 각 필드 독립 설정/읽기', () => {
  test('WARNING만 오버라이드하면 나머지 6개 임계값 필드는 기본값을 유지한다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, WARNING: 7 }
    expect(cfg.WARNING).toBe(7)
    // 나머지는 기본값
    expect(cfg.CRITICAL).toBe(DEFAULT_DETECTOR_CONFIG.CRITICAL)
    expect(cfg.historySize).toBe(DEFAULT_DETECTOR_CONFIG.historySize)
    expect(cfg.errLoopWarn).toBe(DEFAULT_DETECTOR_CONFIG.errLoopWarn)
    expect(cfg.errLoopCrit).toBe(DEFAULT_DETECTOR_CONFIG.errLoopCrit)
    expect(cfg.fileEditWarn).toBe(DEFAULT_DETECTOR_CONFIG.fileEditWarn)
    expect(cfg.fileEditCrit).toBe(DEFAULT_DETECTOR_CONFIG.fileEditCrit)
  })

  test('CRITICAL만 오버라이드하면 나머지 6개 임계값 필드는 기본값을 유지한다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, CRITICAL: 25 }
    expect(cfg.CRITICAL).toBe(25)
    expect(cfg.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING)
    expect(cfg.historySize).toBe(DEFAULT_DETECTOR_CONFIG.historySize)
    expect(cfg.errLoopWarn).toBe(DEFAULT_DETECTOR_CONFIG.errLoopWarn)
    expect(cfg.errLoopCrit).toBe(DEFAULT_DETECTOR_CONFIG.errLoopCrit)
    expect(cfg.fileEditWarn).toBe(DEFAULT_DETECTOR_CONFIG.fileEditWarn)
    expect(cfg.fileEditCrit).toBe(DEFAULT_DETECTOR_CONFIG.fileEditCrit)
  })

  test('historySize만 오버라이드하면 나머지 6개 임계값 필드는 기본값을 유지한다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, historySize: 50 }
    expect(cfg.historySize).toBe(50)
    expect(cfg.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING)
    expect(cfg.CRITICAL).toBe(DEFAULT_DETECTOR_CONFIG.CRITICAL)
    expect(cfg.errLoopWarn).toBe(DEFAULT_DETECTOR_CONFIG.errLoopWarn)
    expect(cfg.errLoopCrit).toBe(DEFAULT_DETECTOR_CONFIG.errLoopCrit)
    expect(cfg.fileEditWarn).toBe(DEFAULT_DETECTOR_CONFIG.fileEditWarn)
    expect(cfg.fileEditCrit).toBe(DEFAULT_DETECTOR_CONFIG.fileEditCrit)
  })

  test('errLoopWarn만 오버라이드하면 나머지 6개 임계값 필드는 기본값을 유지한다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, errLoopWarn: 2 }
    expect(cfg.errLoopWarn).toBe(2)
    expect(cfg.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING)
    expect(cfg.CRITICAL).toBe(DEFAULT_DETECTOR_CONFIG.CRITICAL)
    expect(cfg.historySize).toBe(DEFAULT_DETECTOR_CONFIG.historySize)
    expect(cfg.errLoopCrit).toBe(DEFAULT_DETECTOR_CONFIG.errLoopCrit)
    expect(cfg.fileEditWarn).toBe(DEFAULT_DETECTOR_CONFIG.fileEditWarn)
    expect(cfg.fileEditCrit).toBe(DEFAULT_DETECTOR_CONFIG.fileEditCrit)
  })

  test('errLoopCrit만 오버라이드하면 나머지 6개 임계값 필드는 기본값을 유지한다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, errLoopCrit: 8 }
    expect(cfg.errLoopCrit).toBe(8)
    expect(cfg.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING)
    expect(cfg.CRITICAL).toBe(DEFAULT_DETECTOR_CONFIG.CRITICAL)
    expect(cfg.historySize).toBe(DEFAULT_DETECTOR_CONFIG.historySize)
    expect(cfg.errLoopWarn).toBe(DEFAULT_DETECTOR_CONFIG.errLoopWarn)
    expect(cfg.fileEditWarn).toBe(DEFAULT_DETECTOR_CONFIG.fileEditWarn)
    expect(cfg.fileEditCrit).toBe(DEFAULT_DETECTOR_CONFIG.fileEditCrit)
  })

  test('fileEditWarn만 오버라이드하면 나머지 6개 임계값 필드는 기본값을 유지한다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, fileEditWarn: 3 }
    expect(cfg.fileEditWarn).toBe(3)
    expect(cfg.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING)
    expect(cfg.CRITICAL).toBe(DEFAULT_DETECTOR_CONFIG.CRITICAL)
    expect(cfg.historySize).toBe(DEFAULT_DETECTOR_CONFIG.historySize)
    expect(cfg.errLoopWarn).toBe(DEFAULT_DETECTOR_CONFIG.errLoopWarn)
    expect(cfg.errLoopCrit).toBe(DEFAULT_DETECTOR_CONFIG.errLoopCrit)
    expect(cfg.fileEditCrit).toBe(DEFAULT_DETECTOR_CONFIG.fileEditCrit)
  })

  test('fileEditCrit만 오버라이드하면 나머지 6개 임계값 필드는 기본값을 유지한다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, fileEditCrit: 12 }
    expect(cfg.fileEditCrit).toBe(12)
    expect(cfg.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING)
    expect(cfg.CRITICAL).toBe(DEFAULT_DETECTOR_CONFIG.CRITICAL)
    expect(cfg.historySize).toBe(DEFAULT_DETECTOR_CONFIG.historySize)
    expect(cfg.errLoopWarn).toBe(DEFAULT_DETECTOR_CONFIG.errLoopWarn)
    expect(cfg.errLoopCrit).toBe(DEFAULT_DETECTOR_CONFIG.errLoopCrit)
    expect(cfg.fileEditWarn).toBe(DEFAULT_DETECTOR_CONFIG.fileEditWarn)
  })
})

// ── 3. 기본값이 SPEC §1 의사코드와 일치하는지 검증 ──────────────────────────

describe('DetectorConfig — Sub-AC 6a: 7개 임계값 기본값 SPEC §1 일치', () => {
  test('WARNING 기본값은 10이다 (SPEC §1)', () => {
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10)
  })

  test('CRITICAL 기본값은 20이다 (SPEC §1)', () => {
    expect(DEFAULT_DETECTOR_CONFIG.CRITICAL).toBe(20)
  })

  test('historySize 기본값은 30이다 (SPEC §1)', () => {
    expect(DEFAULT_DETECTOR_CONFIG.historySize).toBe(30)
  })

  test('errLoopWarn 기본값은 3이다 (SPEC §1)', () => {
    expect(DEFAULT_DETECTOR_CONFIG.errLoopWarn).toBe(3)
  })

  test('errLoopCrit 기본값은 5이다 (SPEC §1)', () => {
    expect(DEFAULT_DETECTOR_CONFIG.errLoopCrit).toBe(5)
  })

  test('fileEditWarn 기본값은 5이다 (SPEC §1)', () => {
    expect(DEFAULT_DETECTOR_CONFIG.fileEditWarn).toBe(5)
  })

  test('fileEditCrit 기본값은 8이다 (SPEC §1)', () => {
    expect(DEFAULT_DETECTOR_CONFIG.fileEditCrit).toBe(8)
  })
})

// ── 4. DetectorConfig에서 7개 필드를 한번에 주입하는 팩토리 패턴 검증 ─────────

describe('DetectorConfig — Sub-AC 6a: DetectorConfig 주입 패턴', () => {
  /**
   * 구조 게이트는 임계값을 DetectorConfig에서만 읽어야 한다 (코드 상수 금지).
   * 이 테스트는 구조 게이트가 DetectorConfig를 파라미터로 받아
   * 7개 임계값을 모두 소비할 수 있는지 시뮬레이션한다.
   */
  function simulateGateThresholds(cfg: DetectorConfig): {
    repeatWarn: number
    repeatCrit: number
    windowSize: number
    errWarn: number
    errCrit: number
    fileWarn: number
    fileCrit: number
  } {
    return {
      repeatWarn: cfg.WARNING,
      repeatCrit: cfg.CRITICAL,
      windowSize: cfg.historySize,
      errWarn: cfg.errLoopWarn,
      errCrit: cfg.errLoopCrit,
      fileWarn: cfg.fileEditWarn,
      fileCrit: cfg.fileEditCrit,
    }
  }

  test('7개 임계값 모두 커스텀 DetectorConfig에서 독립적으로 읽힌다', () => {
    const customCfg: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      WARNING: 8,
      CRITICAL: 16,
      historySize: 40,
      errLoopWarn: 2,
      errLoopCrit: 4,
      fileEditWarn: 6,
      fileEditCrit: 10,
    }

    const thresholds = simulateGateThresholds(customCfg)

    expect(thresholds.repeatWarn).toBe(8)
    expect(thresholds.repeatCrit).toBe(16)
    expect(thresholds.windowSize).toBe(40)
    expect(thresholds.errWarn).toBe(2)
    expect(thresholds.errCrit).toBe(4)
    expect(thresholds.fileWarn).toBe(6)
    expect(thresholds.fileCrit).toBe(10)
  })

  test('기본 DetectorConfig로 시뮬레이션하면 SPEC §1 기본값이 반환된다', () => {
    const thresholds = simulateGateThresholds(DEFAULT_DETECTOR_CONFIG)

    expect(thresholds.repeatWarn).toBe(10)
    expect(thresholds.repeatCrit).toBe(20)
    expect(thresholds.windowSize).toBe(30)
    expect(thresholds.errWarn).toBe(3)
    expect(thresholds.errCrit).toBe(5)
    expect(thresholds.fileWarn).toBe(5)
    expect(thresholds.fileCrit).toBe(8)
  })

  test('WARNING < CRITICAL 불변식이 기본값에서 성립한다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBeLessThan(DEFAULT_DETECTOR_CONFIG.CRITICAL)
  })

  test('errLoopWarn < errLoopCrit 불변식이 기본값에서 성립한다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.errLoopWarn).toBeLessThan(DEFAULT_DETECTOR_CONFIG.errLoopCrit)
  })

  test('fileEditWarn < fileEditCrit 불변식이 기본값에서 성립한다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.fileEditWarn).toBeLessThan(DEFAULT_DETECTOR_CONFIG.fileEditCrit)
  })
})
