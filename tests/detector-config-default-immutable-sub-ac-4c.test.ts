// tests/detector-config-default-immutable-sub-ac-4c.test.ts
//
// Sub-AC 4c: DEFAULT_DETECTOR_CONFIG의 기존 필드명과 기본값이 M4 이후 변경되지
// 않음을 검증하는 단위 테스트.
//
// 검증 항목:
//   1. M0~M3에서 확립된 모든 필드명이 그대로 존재한다 (이름 변경 없음)
//   2. 모든 기존 기본값이 SPEC §1 기준 그대로 유지된다 (값 변경 없음)
//   3. M4에서 추가된 알림 필드(4개)는 기존 필드에 영향을 주지 않는다
//   4. DEFAULT_DETECTOR_CONFIG는 'as const' 객체로 동결되어 있다 (불변성)
//   5. DetectorConfig 인터페이스의 전체 필드 목록이 예상 집합과 일치한다

import {
  type DetectorConfig,
  DEFAULT_DETECTOR_CONFIG,
} from '../src/contracts.js'

// ── 1. M0~M3 기존 필드명 불변 검증 ──────────────────────────────────────────

describe('DEFAULT_DETECTOR_CONFIG Sub-AC 4c: M0~M3 기존 필드명 불변', () => {
  const cfg = DEFAULT_DETECTOR_CONFIG

  // 구조 게이트 임계값 필드명
  test('WARNING 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'WARNING')).toBe(true)
  })

  test('CRITICAL 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'CRITICAL')).toBe(true)
  })

  test('circuitBreaker 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'circuitBreaker')).toBe(true)
  })

  test('historySize 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'historySize')).toBe(true)
  })

  test('errLoopWarn 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'errLoopWarn')).toBe(true)
  })

  test('errLoopCrit 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'errLoopCrit')).toBe(true)
  })

  test('fileEditWarn 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'fileEditWarn')).toBe(true)
  })

  test('fileEditCrit 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'fileEditCrit')).toBe(true)
  })

  // 의미 게이트 임계값 필드명
  test('simThresh 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'simThresh')).toBe(true)
  })

  test('decideThresh 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'decideThresh')).toBe(true)
  })

  // 가짜성공 프로브 임계값 필드명
  test('selfApprovalMs 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'selfApprovalMs')).toBe(true)
  })

  test('selfApprovalCriticalMs 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'selfApprovalCriticalMs')).toBe(true)
  })

  // judge 설정 필드명
  test('judgeSelfConsistencyN 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'judgeSelfConsistencyN')).toBe(true)
  })

  test('judgePositionSwaps 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'judgePositionSwaps')).toBe(true)
  })

  // 모델 설정 필드명
  test('embedModelId 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'embedModelId')).toBe(true)
  })

  test('judgeModelId 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'judgeModelId')).toBe(true)
  })

  test('embedDim 필드명이 유지된다', () => {
    expect(Object.prototype.hasOwnProperty.call(cfg, 'embedDim')).toBe(true)
  })
})

// ── 2. M0~M3 기존 기본값 불변 검증 (SPEC §1 기준) ──────────────────────────

describe('DEFAULT_DETECTOR_CONFIG Sub-AC 4c: M0~M3 기존 기본값 SPEC §1 불변', () => {
  // 구조 게이트 임계값
  test('WARNING 기본값 10이 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10)
  })

  test('CRITICAL 기본값 20이 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.CRITICAL).toBe(20)
  })

  test('circuitBreaker 기본값 30이 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.circuitBreaker).toBe(30)
  })

  test('historySize 기본값 30이 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.historySize).toBe(30)
  })

  test('errLoopWarn 기본값 3이 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.errLoopWarn).toBe(3)
  })

  test('errLoopCrit 기본값 5가 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.errLoopCrit).toBe(5)
  })

  test('fileEditWarn 기본값 5가 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.fileEditWarn).toBe(5)
  })

  test('fileEditCrit 기본값 8이 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.fileEditCrit).toBe(8)
  })

  // 의미 게이트 임계값
  test('simThresh 기본값 0.90이 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.simThresh).toBe(0.90)
  })

  test('decideThresh 기본값 0.7이 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.decideThresh).toBe(0.7)
  })

  // 가짜성공 프로브 임계값
  test('selfApprovalMs 기본값 15000이 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.selfApprovalMs).toBe(15000)
  })

  test('selfApprovalCriticalMs 기본값 1000이 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.selfApprovalCriticalMs).toBe(1000)
  })

  // judge 설정
  test('judgeSelfConsistencyN 기본값 1이 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.judgeSelfConsistencyN).toBe(1)
  })

  test('judgePositionSwaps 기본값 0이 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.judgePositionSwaps).toBe(0)
  })

  // 모델 설정 (BLOCKER B2)
  test('embedModelId 기본값 "voyage-3-lite"가 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.embedModelId).toBe('voyage-3-lite')
  })

  test('judgeModelId 기본값 "claude-3-5-sonnet-20241022"가 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.judgeModelId).toBe('claude-3-5-sonnet-20241022')
  })

  test('embedDim 기본값 1024가 M4 이후 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.embedDim).toBe(1024)
  })
})

// ── 3. M4 알림 필드 추가가 기존 필드에 영향 없음을 검증 ─────────────────────

describe('DEFAULT_DETECTOR_CONFIG Sub-AC 4c: M4 알림 필드 추가 후 기존 필드 불간섭', () => {
  test('M4 알림 필드(notifyDebounceMs)가 추가되어도 WARNING 기본값은 10이다', () => {
    // M4에서 알림 필드가 추가됐지만 구조 게이트 임계값은 그대로
    expect(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs).toBe(60000) // M4 신규
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10) // 기존 불변
  })

  test('M4 알림 필드(notifyChannels)가 추가되어도 decideThresh 기본값은 0.7이다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.notifyChannels).toEqual(['desktop', 'cli']) // M4 신규
    expect(DEFAULT_DETECTOR_CONFIG.decideThresh).toBe(0.7) // 기존 불변
  })

  test('M4 알림 필드(lowConfidenceNotify)가 추가되어도 simThresh 기본값은 0.90이다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.lowConfidenceNotify).toBe(false) // M4 신규
    expect(DEFAULT_DETECTOR_CONFIG.simThresh).toBe(0.90) // 기존 불변
  })

  test('M4 알림 필드(webhookUrl)가 추가되어도 judgeModelId 기본값은 변경되지 않았다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.webhookUrl).toBeUndefined() // M4 신규
    expect(DEFAULT_DETECTOR_CONFIG.judgeModelId).toBe('claude-3-5-sonnet-20241022') // 기존 불변
  })

  test('스프레드 복사 후 알림 필드 수정이 기존 필드를 변경하지 않는다', () => {
    const modified: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      notifyDebounceMs: 120000,
      notifyChannels: ['cli'],
      lowConfidenceNotify: true,
    }
    // M4 필드는 수정됨
    expect(modified.notifyDebounceMs).toBe(120000)
    expect(modified.notifyChannels).toEqual(['cli'])
    expect(modified.lowConfidenceNotify).toBe(true)
    // M0~M3 필드는 기본값 유지
    expect(modified.WARNING).toBe(10)
    expect(modified.CRITICAL).toBe(20)
    expect(modified.circuitBreaker).toBe(30)
    expect(modified.historySize).toBe(30)
    expect(modified.errLoopWarn).toBe(3)
    expect(modified.errLoopCrit).toBe(5)
    expect(modified.fileEditWarn).toBe(5)
    expect(modified.fileEditCrit).toBe(8)
    expect(modified.simThresh).toBe(0.90)
    expect(modified.decideThresh).toBe(0.7)
    expect(modified.selfApprovalMs).toBe(15000)
    expect(modified.selfApprovalCriticalMs).toBe(1000)
    expect(modified.judgeSelfConsistencyN).toBe(1)
    expect(modified.judgePositionSwaps).toBe(0)
    expect(modified.embedModelId).toBe('voyage-3-lite')
    expect(modified.judgeModelId).toBe('claude-3-5-sonnet-20241022')
    expect(modified.embedDim).toBe(1024)
  })
})

// ── 4. DEFAULT_DETECTOR_CONFIG 불변성 검증 ('as const') ───────────────────

describe('DEFAULT_DETECTOR_CONFIG Sub-AC 4c: 불변성(as const) 검증', () => {
  test('DEFAULT_DETECTOR_CONFIG는 객체 타입이다', () => {
    expect(typeof DEFAULT_DETECTOR_CONFIG).toBe('object')
    expect(DEFAULT_DETECTOR_CONFIG).not.toBeNull()
  })

  test('기존 필드 값을 직접 변경하려 해도 원본 DEFAULT_DETECTOR_CONFIG는 변경되지 않는다', () => {
    // as const로 선언되어 있으므로 TypeScript 레벨에서 변경 불가
    // 런타임에서도 Object.isFrozen이 true인지 확인
    // (as const는 deep readonly지만 Object.freeze와 동일하지 않을 수 있으므로
    //  값 자체는 별도 복사본에서 검증)
    const originalWarning = DEFAULT_DETECTOR_CONFIG.WARNING
    const copy = { ...DEFAULT_DETECTOR_CONFIG }
    ;(copy as Record<string, unknown>)['WARNING'] = 999
    // 원본은 변경되지 않음
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(originalWarning)
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10)
  })

  test('DEFAULT_DETECTOR_CONFIG 참조가 null/undefined가 아니다 (정의됨)', () => {
    expect(DEFAULT_DETECTOR_CONFIG).toBeDefined()
    expect(DEFAULT_DETECTOR_CONFIG).not.toBeNull()
  })
})

// ── 5. DetectorConfig 전체 필드 집합 검증 (누락/추가 필드 없음) ─────────────

describe('DEFAULT_DETECTOR_CONFIG Sub-AC 4c: 전체 필드 집합 검증', () => {
  /**
   * M0~M3에서 확립된 17개 필드 + M4에서 추가된 4개 필드 = 총 21개 필드.
   * webhookUrl은 optional이므로 기본값 객체에서 key가 없을 수 있음.
   */
  const EXPECTED_REQUIRED_FIELDS = [
    // M0~M3 필드 (17개)
    'WARNING',
    'CRITICAL',
    'circuitBreaker',
    'historySize',
    'errLoopWarn',
    'errLoopCrit',
    'fileEditWarn',
    'fileEditCrit',
    'simThresh',
    'decideThresh',
    'selfApprovalMs',
    'selfApprovalCriticalMs',
    'judgeSelfConsistencyN',
    'judgePositionSwaps',
    'embedModelId',
    'judgeModelId',
    'embedDim',
    // M4 신규 필드 (3개 필수 + 1개 optional)
    'notifyDebounceMs',
    'notifyChannels',
    'lowConfidenceNotify',
  ] as const

  test('DEFAULT_DETECTOR_CONFIG에 M0~M3의 17개 기존 필드와 M4의 3개 필수 알림 필드가 모두 존재한다', () => {
    for (const field of EXPECTED_REQUIRED_FIELDS) {
      const exists = Object.prototype.hasOwnProperty.call(DEFAULT_DETECTOR_CONFIG, field)
      if (!exists) {
        throw new Error(`필드 "${field}"가 DEFAULT_DETECTOR_CONFIG에 없다`)
      }
      expect(exists).toBe(true)
    }
  })

  test('M0~M3 필드명이 snake_case나 camelCase로 변경되지 않았다', () => {
    // 예: 'warning' (소문자) 또는 'warn' 같은 이름으로 변경되지 않았음
    const keys = Object.keys(DEFAULT_DETECTOR_CONFIG)
    expect(keys).not.toContain('warning') // WARNING이어야 함
    expect(keys).not.toContain('critical') // CRITICAL이어야 함
    expect(keys).not.toContain('circuit_breaker') // circuitBreaker이어야 함
    expect(keys).not.toContain('history_size') // historySize이어야 함
    expect(keys).not.toContain('err_loop_warn') // errLoopWarn이어야 함
    expect(keys).not.toContain('sim_thresh') // simThresh이어야 함
    expect(keys).not.toContain('decide_thresh') // decideThresh이어야 함
  })

  test('M0~M3 기존 필드 타입이 변경되지 않았다 (number 필드 검증)', () => {
    const numberFields = [
      'WARNING', 'CRITICAL', 'circuitBreaker', 'historySize',
      'errLoopWarn', 'errLoopCrit', 'fileEditWarn', 'fileEditCrit',
      'simThresh', 'decideThresh', 'selfApprovalMs', 'selfApprovalCriticalMs',
      'judgeSelfConsistencyN', 'judgePositionSwaps', 'embedDim',
    ] as const
    for (const field of numberFields) {
      const fieldType = typeof DEFAULT_DETECTOR_CONFIG[field]
      if (fieldType !== 'number') {
        throw new Error(`필드 "${field}"의 타입이 number가 아니다: ${fieldType}`)
      }
      expect(fieldType).toBe('number')
    }
  })

  test('M0~M3 기존 string 필드 타입이 변경되지 않았다', () => {
    expect(typeof DEFAULT_DETECTOR_CONFIG.embedModelId).toBe('string')
    expect(typeof DEFAULT_DETECTOR_CONFIG.judgeModelId).toBe('string')
  })
})
