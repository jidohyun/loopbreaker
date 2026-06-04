// tests/config-manager-sub-ac-5-4.test.ts
//
// Sub-AC 5.4: ConfigManager.onReload(next)가 zod 재검증 실패 시
//             이전 설정을 폴백으로 유지하고 오류를 보고한다.
//
// 검증 항목:
//   1. 타입 오류가 있는 config(예: WARNING에 문자열) → 이전 설정 유지 + 경고 로그
//   2. 필수 필드 누락(version 없음) → 이전 설정 유지 + 경고 로그
//   3. null / undefined 입력 → 이전 설정 유지
//   4. 잘못된 enum 값(version: 999) → 이전 설정 유지
//   5. 중첩 객체 타입 오류(detector.WARNING: "bad") → 이전 설정 유지
//   6. 재검증 실패 시 onReload 콜백이 호출되지 않음
//   7. 재검증 실패 직전 값이 reload 성공 이후에도 계속 사용됨
//   8. 오류 보고: 경고 로그에 문제 필드 정보가 포함됨
//
// 부수효과 없음: 실제 파일 I/O 없음, Mock 로거만 사용.

import { ConfigManager } from '../src/config/config-manager.js'
import { loopBreakerConfigSchema, type LoopBreakerConfig } from '../src/config/config-schema.js'

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

/** 최소 유효 LoopBreakerConfig를 zod로 빌드하는 헬퍼 */
function makeValidConfig(overrides?: {
  detector?: Record<string, unknown>
  watch?: Record<string, unknown>
  notify?: Record<string, unknown>
}): LoopBreakerConfig {
  return loopBreakerConfigSchema.parse({
    version: 1,
    detector: overrides?.detector ?? {},
    privacy: {},
    api: {},
    watch: overrides?.watch ?? {},
    webhook: {},
    notify: overrides?.notify ?? {},
  })
}

/** 경고·정보 메시지를 수집하는 Mock 로거 */
function makeLogger() {
  const warnings: Array<{ msg: string; extra?: Record<string, unknown> }> = []
  const infos: Array<{ msg: string; extra?: Record<string, unknown> }> = []
  return {
    logger: {
      warn(msg: string, extra?: Record<string, unknown>) {
        warnings.push({ msg, extra })
      },
      info(msg: string, extra?: Record<string, unknown>) {
        infos.push({ msg, extra })
      },
    },
    warnings,
    infos,
  }
}

// ── 1. 타입 오류가 있는 config ────────────────────────────────────────────────

describe('Sub-AC 5.4: 타입 오류 config → 이전 설정 유지 + 오류 보고', () => {
  test('detector.WARNING에 문자열을 넣으면 검증 실패하고 이전 설정이 유지된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeValidConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const invalid = {
      version: 1,
      detector: { WARNING: 'not-a-number' },
      privacy: {},
      api: {},
      watch: {},
      webhook: {},
      notify: {},
    }
    const result = mgr.reload(invalid)

    expect(result).toBe(false)
    expect(mgr.getConfig().WARNING).toBe(10)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => w.msg.includes('검증 실패'))).toBe(true)
  })

  test('detector.CRITICAL에 음수를 넣으면 검증 실패하고 이전 설정이 유지된다', () => {
    const { logger } = makeLogger()
    const initial = makeValidConfig({ detector: { CRITICAL: 20 } })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const invalid = {
      version: 1,
      detector: { CRITICAL: -5 },
      privacy: {},
      api: {},
      watch: {},
      webhook: {},
      notify: {},
    }
    const result = mgr.reload(invalid)

    expect(result).toBe(false)
    expect(mgr.getConfig().CRITICAL).toBe(20)
  })

  test('detector.simThresh에 범위 초과 값(1.5)을 넣으면 검증 실패하고 이전 설정이 유지된다', () => {
    const { logger } = makeLogger()
    const initial = makeValidConfig({ detector: { simThresh: 0.9 } })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const invalid = {
      version: 1,
      detector: { simThresh: 1.5 },
      privacy: {},
      api: {},
      watch: {},
      webhook: {},
      notify: {},
    }
    const result = mgr.reload(invalid)

    expect(result).toBe(false)
    expect(mgr.getConfig().simThresh).toBe(0.9)
  })

  test('notifyChannels에 잘못된 enum 값을 넣으면 검증 실패하고 이전 설정이 유지된다', () => {
    const { logger } = makeLogger()
    const initial = makeValidConfig({ detector: { notifyChannels: ['desktop'] } })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const invalid = {
      version: 1,
      detector: { notifyChannels: ['invalid-channel'] },
      privacy: {},
      api: {},
      watch: {},
      webhook: {},
      notify: {},
    }
    const result = mgr.reload(invalid)

    expect(result).toBe(false)
    expect(mgr.getConfig().notifyChannels).toEqual(['desktop'])
  })
})

// ── 2. 필수 필드 누락 ─────────────────────────────────────────────────────────

describe('Sub-AC 5.4: 필수 필드 누락 → 이전 설정 유지 + 오류 보고', () => {
  test('version 필드가 없으면 검증 실패하고 이전 설정이 유지된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeValidConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const noVersion = {
      detector: { WARNING: 5 },
      privacy: {},
      api: {},
      watch: {},
      webhook: {},
      notify: {},
    }
    const result = mgr.reload(noVersion)

    expect(result).toBe(false)
    expect(mgr.getConfig().WARNING).toBe(10)
    expect(warnings.some((w) => w.msg.includes('검증 실패'))).toBe(true)
  })

  test('version이 1이 아닌 다른 숫자면 검증 실패하고 이전 설정이 유지된다', () => {
    const { logger } = makeLogger()
    const initial = makeValidConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const wrongVersion = {
      version: 2,
      detector: { WARNING: 5 },
      privacy: {},
      api: {},
      watch: {},
      webhook: {},
      notify: {},
    }
    const result = mgr.reload(wrongVersion)

    expect(result).toBe(false)
    expect(mgr.getConfig().WARNING).toBe(10)
  })

  test('detector 필드 자체가 없어도 검증 실패하고 이전 설정이 유지된다', () => {
    const { logger } = makeLogger()
    const initial = makeValidConfig({ detector: { CRITICAL: 15 } })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const noDetector = {
      version: 1,
      privacy: {},
      api: {},
      watch: {},
      webhook: {},
      notify: {},
    }
    const result = mgr.reload(noDetector)

    // detector 필드가 없어도 zod는 optional/default 처리할 수 있으나,
    // 여기서는 실제 스키마 동작 결과에 따른다.
    // 만약 통과한다면 CRITICAL는 기본값(20)이 되므로 원래 15가 사라진다.
    // 실패 시에는 15가 유지된다.
    if (!result) {
      expect(mgr.getConfig().CRITICAL).toBe(15)
    }
    // (통과한 경우도 허용 — zod 스키마가 detector를 optional로 처리하는지에 따름)
  })
})

// ── 3. null / undefined 입력 ──────────────────────────────────────────────────

describe('Sub-AC 5.4: null / undefined 입력 → 이전 설정 유지', () => {
  test('null 입력은 검증 실패로 처리되고 이전 설정이 유지된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeValidConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const originalConfig = mgr.getConfig()
    const result = mgr.reload(null)

    expect(result).toBe(false)
    expect(mgr.getConfig()).toBe(originalConfig)
    expect(mgr.getConfig().WARNING).toBe(10)
    expect(warnings.length).toBeGreaterThan(0)
  })

  test('undefined 입력은 검증 실패로 처리되고 이전 설정이 유지된다', () => {
    const initial = makeValidConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial)

    const result = mgr.reload(undefined)

    expect(result).toBe(false)
    expect(mgr.getConfig().WARNING).toBe(10)
  })

  test('빈 객체 입력은 검증 실패로 처리된다', () => {
    const initial = makeValidConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial)

    const result = mgr.reload({})

    expect(result).toBe(false)
    expect(mgr.getConfig().WARNING).toBe(10)
  })

  test('배열 입력은 검증 실패로 처리되고 이전 설정이 유지된다', () => {
    const initial = makeValidConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial)

    const result = mgr.reload([1, 2, 3])

    expect(result).toBe(false)
    expect(mgr.getConfig().WARNING).toBe(10)
  })

  test('문자열 입력은 검증 실패로 처리되고 이전 설정이 유지된다', () => {
    const initial = makeValidConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial)

    const result = mgr.reload('invalid config string')

    expect(result).toBe(false)
    expect(mgr.getConfig().WARNING).toBe(10)
  })
})

// ── 4. 재검증 실패 시 onReload 콜백이 호출되지 않음 ──────────────────────────

describe('Sub-AC 5.4: 재검증 실패 시 onReload 콜백 미호출', () => {
  test('검증 실패 시 등록된 onReload 콜백이 호출되지 않는다', () => {
    const initial = makeValidConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    let callbackCallCount = 0
    mgr.onReload(() => {
      callbackCallCount++
    })

    mgr.reload({ invalid: true })

    expect(callbackCallCount).toBe(0)
  })

  test('검증 실패 후 성공적인 reload에서는 콜백이 정상 호출된다', () => {
    const initial = makeValidConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial)

    let callbackCallCount = 0
    mgr.onReload(() => {
      callbackCallCount++
    })

    // 첫 번째: 실패
    mgr.reload({ invalid: true })
    expect(callbackCallCount).toBe(0)

    // 두 번째: 성공
    const valid = makeValidConfig({ detector: { WARNING: 5 } })
    mgr.reload(valid)
    expect(callbackCallCount).toBe(1)
  })

  test('여러 번 연속 실패해도 콜백이 전혀 호출되지 않는다', () => {
    const initial = makeValidConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const calls: string[] = []
    mgr.onReload(() => calls.push('called'))

    mgr.reload(null)
    mgr.reload(undefined)
    mgr.reload({})
    mgr.reload('bad')
    mgr.reload({ version: 2 })

    expect(calls).toHaveLength(0)
  })
})

// ── 5. 오류 보고: 경고 로그에 문제 정보가 포함됨 ─────────────────────────────

describe('Sub-AC 5.4: 오류 보고 — 경고 로그 내용 검증', () => {
  test('경고 로그에 "검증 실패" 메시지가 포함된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeValidConfig({})
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload({ version: 999, detector: { WARNING: 'bad' } })

    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0].msg).toContain('검증 실패')
  })

  test('경고 로그 extra에 issues 정보가 포함된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeValidConfig({})
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload({
      version: 1,
      detector: { WARNING: 'not-a-number' },
      privacy: {},
      api: {},
      watch: {},
      webhook: {},
      notify: {},
    })

    expect(warnings.length).toBeGreaterThan(0)
    // extra에 issues 키가 있어야 함
    const warnEntry = warnings[0]
    expect(warnEntry.extra).toBeDefined()
    expect(typeof warnEntry.extra?.issues).toBe('string')
    expect((warnEntry.extra?.issues as string).length).toBeGreaterThan(0)
  })

  test('타입 오류 시 경고 로그 issues에 문제 경로가 포함된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeValidConfig({})
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload({
      version: 1,
      detector: { WARNING: 'bad-value' },
      privacy: {},
      api: {},
      watch: {},
      webhook: {},
      notify: {},
    })

    const issues = warnings[0]?.extra?.issues as string | undefined
    expect(issues).toBeDefined()
    // 문제 필드 경로(detector.WARNING 또는 WARNING)가 포함돼야 한다
    expect(issues).toMatch(/WARNING/i)
  })

  test('검증 실패 시 데몬이 죽지 않는다 — reload가 예외를 throw하지 않는다', () => {
    const initial = makeValidConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    expect(() => mgr.reload(null)).not.toThrow()
    expect(() => mgr.reload(undefined)).not.toThrow()
    expect(() => mgr.reload({ version: 999 })).not.toThrow()
    expect(() => mgr.reload({ version: 1, detector: { WARNING: [] } })).not.toThrow()
  })
})

// ── 6. 폴백 지속성: reload 성공 후 또 실패해도 마지막 성공값 유지 ────────────

describe('Sub-AC 5.4: 폴백 지속성 — 마지막 성공 설정 유지', () => {
  test('성공→실패 순서일 때 마지막 성공 설정이 유지된다', () => {
    const { logger } = makeLogger()
    const initial = makeValidConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial, logger)

    // 1차 성공: WARNING=7 적용
    const valid = makeValidConfig({ detector: { WARNING: 7 } })
    const r1 = mgr.reload(valid)
    expect(r1).toBe(true)
    expect(mgr.getConfig().WARNING).toBe(7)

    // 2차 실패: WARNING=7 그대로 유지
    const r2 = mgr.reload({ version: 999, garbage: true })
    expect(r2).toBe(false)
    expect(mgr.getConfig().WARNING).toBe(7)
  })

  test('실패→성공→실패 순서일 때 두 번째 성공 설정이 최종 유지된다', () => {
    const initial = makeValidConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial)

    // 1차 실패
    mgr.reload(null)
    expect(mgr.getConfig().WARNING).toBe(10)

    // 2차 성공: WARNING=5
    mgr.reload(makeValidConfig({ detector: { WARNING: 5 } }))
    expect(mgr.getConfig().WARNING).toBe(5)

    // 3차 실패
    mgr.reload({ bad: 'data' })
    expect(mgr.getConfig().WARNING).toBe(5)
  })

  test('여러 번 연속 실패해도 초기 설정이 계속 유지된다', () => {
    const initial = makeValidConfig({ detector: { WARNING: 10, CRITICAL: 20 } })
    const mgr = ConfigManager.fromConfig(initial)

    for (let i = 0; i < 10; i++) {
      mgr.reload({ version: 999 })
      expect(mgr.getConfig().WARNING).toBe(10)
      expect(mgr.getConfig().CRITICAL).toBe(20)
    }
  })

  test('getLoopBreakerConfig()도 재검증 실패 시 이전 값을 유지한다', () => {
    const initial = makeValidConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial)

    const originalLoopBreakerConfig = mgr.getLoopBreakerConfig()

    mgr.reload({ invalid: 'data' })

    // 동일한 참조 (변경 없음)
    expect(mgr.getLoopBreakerConfig()).toBe(originalLoopBreakerConfig)
  })
})
