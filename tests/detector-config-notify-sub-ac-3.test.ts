// tests/detector-config-notify-sub-ac-3.test.ts
// Sub-AC 3: DetectorConfig에 notifyDebounceMs/notifyChannels/webhookUrl/lowConfidenceNotify
// 필드가 추가되었고, DEFAULT_DETECTOR_CONFIG에 기본값이 설정되었음을 검증.
//
// 검증 항목:
//   1. 4개 알림 필드가 DetectorConfig 인터페이스에 존재하고 올바른 타입
//   2. DEFAULT_DETECTOR_CONFIG 기본값 검증
//   3. BLOCKER C3: 평면 구조 (중첩 없음)
//   4. 기존 M0~M3 필드 기본값 불변 (회귀 방지)
//   5. 필드 독립 오버라이드 가능

import {
  type DetectorConfig,
  DEFAULT_DETECTOR_CONFIG,
} from '../src/contracts.js'

// ── 1. 알림 필드 존재 및 타입 검증 ────────────────────────────────────────────

describe('DetectorConfig 알림 필드 — Sub-AC 3: 필드 존재 및 타입', () => {
  test('notifyDebounceMs 필드가 number 타입으로 정의된다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    expect(typeof cfg.notifyDebounceMs).toBe('number')
    expect(Object.prototype.hasOwnProperty.call(cfg, 'notifyDebounceMs')).toBe(true)
  })

  test('notifyChannels 필드가 배열 타입으로 정의된다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    expect(Array.isArray(cfg.notifyChannels)).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(cfg, 'notifyChannels')).toBe(true)
  })

  test('notifyChannels 요소는 desktop|webhook|cli 리터럴만 허용된다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    const validChannels = new Set(['desktop', 'webhook', 'cli'])
    for (const ch of cfg.notifyChannels) {
      expect(validChannels.has(ch)).toBe(true)
    }
  })

  test('webhookUrl 필드가 string|undefined 타입이다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    // 기본값은 undefined이므로 존재 여부 확인 (optional 필드)
    expect(cfg.webhookUrl === undefined || typeof cfg.webhookUrl === 'string').toBe(true)
  })

  test('lowConfidenceNotify 필드가 boolean 타입으로 정의된다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    expect(typeof cfg.lowConfidenceNotify).toBe('boolean')
    expect(Object.prototype.hasOwnProperty.call(cfg, 'lowConfidenceNotify')).toBe(true)
  })
})

// ── 2. DEFAULT_DETECTOR_CONFIG 기본값 검증 ────────────────────────────────────

describe('DEFAULT_DETECTOR_CONFIG 알림 기본값 — Sub-AC 3', () => {
  test('notifyDebounceMs 기본값은 60000 (1분)이다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs).toBe(60000)
  })

  test("notifyChannels 기본값은 ['desktop', 'cli']이다", () => {
    expect(DEFAULT_DETECTOR_CONFIG.notifyChannels).toEqual(['desktop', 'cli'])
  })

  test('notifyChannels 기본값에 webhook은 포함되지 않는다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.notifyChannels).not.toContain('webhook')
  })

  test('webhookUrl 기본값은 undefined이다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.webhookUrl).toBeUndefined()
  })

  test('lowConfidenceNotify 기본값은 false이다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.lowConfidenceNotify).toBe(false)
  })
})

// ── 3. BLOCKER C3: 평면 구조 검증 (중첩 금지) ────────────────────────────────

describe('DetectorConfig 알림 필드 — Sub-AC 3: BLOCKER C3 평면 구조', () => {
  test('notifyDebounceMs는 스칼라(number)이고 중첩 객체가 아니다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    expect(typeof cfg.notifyDebounceMs).toBe('number')
    expect(cfg.notifyDebounceMs !== null && typeof cfg.notifyDebounceMs !== 'object').toBe(true)
  })

  test('notifyChannels는 기본 배열이고 중첩 객체 배열이 아니다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    for (const ch of cfg.notifyChannels) {
      // 각 요소가 원시 string 리터럴임을 확인
      expect(typeof ch).toBe('string')
    }
  })

  test('lowConfidenceNotify는 스칼라(boolean)이고 중첩 객체가 아니다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    expect(typeof cfg.lowConfidenceNotify).toBe('boolean')
  })

  test('알림 설정 4개 필드가 DetectorConfig 최상위에 직접 정의된다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG }
    // 평면 구조: notify 관련 네임스페이스/중첩 객체가 없어야 함
    const keys = Object.keys(cfg)
    // 중첩 notify 네임스페이스 객체가 없어야 함
    expect(keys).not.toContain('notify')
    expect(keys).not.toContain('notifyConfig')
    // 4개 알림 필드가 최상위에 직접 있어야 함
    expect(keys).toContain('notifyDebounceMs')
    expect(keys).toContain('notifyChannels')
    expect(keys).toContain('lowConfidenceNotify')
  })
})

// ── 4. 기존 M0~M3 필드 기본값 불변 (회귀 방지) ──────────────────────────────

describe('DEFAULT_DETECTOR_CONFIG M0~M3 필드 불변 — Sub-AC 3 회귀 방지', () => {
  test('WARNING 기본값 10 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10)
  })

  test('CRITICAL 기본값 20 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.CRITICAL).toBe(20)
  })

  test('circuitBreaker 기본값 30 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.circuitBreaker).toBe(30)
  })

  test('historySize 기본값 30 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.historySize).toBe(30)
  })

  test('errLoopWarn 기본값 3 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.errLoopWarn).toBe(3)
  })

  test('errLoopCrit 기본값 5 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.errLoopCrit).toBe(5)
  })

  test('fileEditWarn 기본값 5 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.fileEditWarn).toBe(5)
  })

  test('fileEditCrit 기본값 8 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.fileEditCrit).toBe(8)
  })

  test('simThresh 기본값 0.90 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.simThresh).toBe(0.90)
  })

  test('decideThresh 기본값 0.7 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.decideThresh).toBe(0.7)
  })

  test('selfApprovalMs 기본값 15000 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.selfApprovalMs).toBe(15000)
  })

  test('selfApprovalCriticalMs 기본값 1000 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.selfApprovalCriticalMs).toBe(1000)
  })

  test('judgeSelfConsistencyN 기본값 1 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.judgeSelfConsistencyN).toBe(1)
  })

  test('judgePositionSwaps 기본값 0 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.judgePositionSwaps).toBe(0)
  })

  test('embedModelId 기본값 "voyage-3-lite" 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.embedModelId).toBe('voyage-3-lite')
  })

  test('judgeModelId 기본값 "claude-3-5-sonnet-20241022" 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.judgeModelId).toBe('claude-3-5-sonnet-20241022')
  })

  test('embedDim 기본값 1024 불변', () => {
    expect(DEFAULT_DETECTOR_CONFIG.embedDim).toBe(1024)
  })
})

// ── 5. 알림 필드 독립 오버라이드 ──────────────────────────────────────────────

describe('DetectorConfig 알림 필드 — Sub-AC 3: 독립 오버라이드', () => {
  test('notifyDebounceMs만 오버라이드하면 다른 알림 필드는 기본값 유지', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, notifyDebounceMs: 120000 }
    expect(cfg.notifyDebounceMs).toBe(120000)
    expect(cfg.notifyChannels).toEqual(DEFAULT_DETECTOR_CONFIG.notifyChannels)
    expect(cfg.webhookUrl).toBeUndefined()
    expect(cfg.lowConfidenceNotify).toBe(false)
  })

  test('notifyChannels에 webhook 추가 오버라이드 가능', () => {
    const cfg: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      notifyChannels: ['desktop', 'webhook', 'cli'],
      webhookUrl: 'https://hooks.example.com/notify',
    }
    expect(cfg.notifyChannels).toContain('webhook')
    expect(cfg.webhookUrl).toBe('https://hooks.example.com/notify')
    // 기존 필드는 그대로
    expect(cfg.notifyDebounceMs).toBe(60000)
    expect(cfg.lowConfidenceNotify).toBe(false)
  })

  test('lowConfidenceNotify를 true로 오버라이드하면 나머지 알림 필드는 기본값 유지', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, lowConfidenceNotify: true }
    expect(cfg.lowConfidenceNotify).toBe(true)
    expect(cfg.notifyDebounceMs).toBe(60000)
    expect(cfg.notifyChannels).toEqual(['desktop', 'cli'])
    expect(cfg.webhookUrl).toBeUndefined()
  })

  test('4개 알림 필드 모두 커스텀 오버라이드 가능', () => {
    const cfg: DetectorConfig = {
      ...DEFAULT_DETECTOR_CONFIG,
      notifyDebounceMs: 30000,
      notifyChannels: ['cli'],
      webhookUrl: 'https://example.com/webhook',
      lowConfidenceNotify: true,
    }
    expect(cfg.notifyDebounceMs).toBe(30000)
    expect(cfg.notifyChannels).toEqual(['cli'])
    expect(cfg.webhookUrl).toBe('https://example.com/webhook')
    expect(cfg.lowConfidenceNotify).toBe(true)
    // 구조 게이트 필드들은 영향 없음
    expect(cfg.WARNING).toBe(10)
    expect(cfg.decideThresh).toBe(0.7)
  })

  test('notifyDebounceMs > 0 불변식 — 양수 값만 유효 (타입 레벨 문서화)', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, notifyDebounceMs: 1 }
    expect(cfg.notifyDebounceMs).toBeGreaterThan(0)
  })
})
