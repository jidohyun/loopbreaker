// tests/config-manager-sub-ac-5-2b.test.ts
//
// Sub-AC 5.2b: ConfigManager.onReload(next)가 debounce(디바운스) 필드 변경을 무중단으로 적용한다.
//
// 검증 항목:
//   1. onReload 콜백에 새 notifyDebounceMs 값을 전달했을 때,
//      getConfig()가 즉시 새 값을 반환한다
//   2. detector.notifyDebounceMs 경로로 변경이 반영된다
//   3. notify.notifyDebounceMs 경로로 변경이 반영된다 (config-loader 매핑 규칙)
//   4. 서비스 재시작 없이 동일 인스턴스에서 내부 상태가 갱신된다
//   5. onReload 콜백이 새 notifyDebounceMs를 인자로 호출된다
//   6. DEFAULT_DETECTOR_CONFIG.notifyDebounceMs(60000)는 변경되지 않는다 (불변)
//
// 부수효과 없음: 실제 파일 I/O 없음, 임시 tmpdir 경로만 사용.

import { ConfigManager } from '../src/config/config-manager.js'
import { DEFAULT_DETECTOR_CONFIG, type DetectorConfig } from '../src/contracts.js'
import { loopBreakerConfigSchema, type LoopBreakerConfig } from '../src/config/config-schema.js'

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

/** 최소 유효 LoopBreakerConfig를 zod로 빌드하는 헬퍼 */
function makeLoopBreakerConfig(overrides?: {
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
      warn(msg: string, extra?: Record<string, unknown>) { warnings.push({ msg, extra }) },
      info(msg: string, extra?: Record<string, unknown>) { infos.push({ msg, extra }) },
    },
    warnings,
    infos,
  }
}

// ── 1. detector.notifyDebounceMs 경로 변경이 즉시 반영된다 ───────────────────

describe('Sub-AC 5.2b: detector.notifyDebounceMs 변경 무중단 적용', () => {
  test('detector.notifyDebounceMs 변경 시 getConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getConfig().notifyDebounceMs).toBe(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs)

    const next = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 30000 } })
    mgr.reload(next)

    expect(mgr.getConfig().notifyDebounceMs).toBe(30000)
  })

  test('detector.notifyDebounceMs를 더 짧은 값으로 변경할 수 있다', () => {
    const initial = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 60000 } })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 10000 } })
    mgr.reload(next)

    expect(mgr.getConfig().notifyDebounceMs).toBe(10000)
  })

  test('detector.notifyDebounceMs를 더 긴 값으로 변경할 수 있다', () => {
    const initial = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 60000 } })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 120000 } })
    mgr.reload(next)

    expect(mgr.getConfig().notifyDebounceMs).toBe(120000)
  })

  test('detector.notifyDebounceMs 변경 후 reload 반환값이 true다', () => {
    const initial = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 60000 } })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 45000 } })
    const result = mgr.reload(next)

    expect(result).toBe(true)
  })
})

// ── 2. notify.notifyDebounceMs 경로 변경이 반영된다 ─────────────────────────

describe('Sub-AC 5.2b: notify.notifyDebounceMs 경로 변경 적용', () => {
  test('notify.notifyDebounceMs 변경 시 getConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getConfig().notifyDebounceMs).toBe(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs)

    const next = makeLoopBreakerConfig({ notify: { notifyDebounceMs: 20000 } })
    mgr.reload(next)

    expect(mgr.getConfig().notifyDebounceMs).toBe(20000)
  })

  test('notify.notifyDebounceMs를 더 짧은 값으로 변경할 수 있다', () => {
    const initial = makeLoopBreakerConfig({ notify: { notifyDebounceMs: 60000 } })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ notify: { notifyDebounceMs: 5000 } })
    mgr.reload(next)

    expect(mgr.getConfig().notifyDebounceMs).toBe(5000)
  })
})

// ── 3. onReload 콜백이 새 notifyDebounceMs를 받는다 ─────────────────────────

describe('Sub-AC 5.2b: onReload 콜백 — notifyDebounceMs 전달 검증', () => {
  test('onReload 콜백 등록 후 reload 시 새 notifyDebounceMs를 받는다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    let receivedConfig: DetectorConfig | null = null
    mgr.onReload((next) => { receivedConfig = next })

    const next = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 30000 } })
    mgr.reload(next)

    expect(receivedConfig).not.toBeNull()
    expect(receivedConfig!.notifyDebounceMs).toBe(30000)
  })

  test('콜백이 받은 notifyDebounceMs는 getConfig().notifyDebounceMs와 일치한다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    let callbackDebounce: number | null = null
    mgr.onReload((next) => { callbackDebounce = next.notifyDebounceMs })

    const next = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 45000 } })
    mgr.reload(next)

    expect(callbackDebounce).toBe(45000)
    expect(callbackDebounce).toBe(mgr.getConfig().notifyDebounceMs)
  })

  test('여러 onReload 콜백이 모두 새 notifyDebounceMs를 받는다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const received: number[] = []
    mgr.onReload((next) => { received.push(next.notifyDebounceMs) })
    mgr.onReload((next) => { received.push(next.notifyDebounceMs) })

    const next = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 15000 } })
    mgr.reload(next)

    expect(received).toEqual([15000, 15000])
  })

  test('notifyDebounceMs 변경 없이 다른 필드만 변경하면 콜백이 호출된다 (다른 안전 필드 변경)', () => {
    const initial = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 60000 } })
    const mgr = ConfigManager.fromConfig(initial)

    let callbackCalled = false
    mgr.onReload(() => { callbackCalled = true })

    // WARNING만 변경 (notifyDebounceMs 유지)
    const next = makeLoopBreakerConfig({
      detector: { WARNING: 5, notifyDebounceMs: 60000 },
    })
    mgr.reload(next)

    expect(callbackCalled).toBe(true)
    // notifyDebounceMs는 그대로 60000
    expect(mgr.getConfig().notifyDebounceMs).toBe(60000)
  })
})

// ── 4. 서비스 재시작 없이 동일 인스턴스에서 내부 상태 갱신 ──────────────────

describe('Sub-AC 5.2b: 서비스 재시작 없이 notifyDebounceMs 내부 상태 갱신', () => {
  test('동일 ConfigManager 인스턴스로 notifyDebounceMs 연속 변경이 가능하다', () => {
    const initial = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 60000 } })
    const mgr = ConfigManager.fromConfig(initial)

    // 1차 변경
    mgr.reload(makeLoopBreakerConfig({ detector: { notifyDebounceMs: 30000 } }))
    expect(mgr.getConfig().notifyDebounceMs).toBe(30000)

    // 2차 변경
    mgr.reload(makeLoopBreakerConfig({ detector: { notifyDebounceMs: 10000 } }))
    expect(mgr.getConfig().notifyDebounceMs).toBe(10000)

    // 3차 변경 (원래 값으로 복원)
    mgr.reload(makeLoopBreakerConfig({ detector: { notifyDebounceMs: 60000 } }))
    expect(mgr.getConfig().notifyDebounceMs).toBe(60000)
  })

  test('notifyDebounceMs 변경은 새 인스턴스를 생성하지 않고 기존 상태를 갱신한다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)
    const mgrRef = mgr

    mgr.reload(makeLoopBreakerConfig({ detector: { notifyDebounceMs: 30000 } }))

    expect(mgr).toBe(mgrRef)
    expect(mgr.getConfig().notifyDebounceMs).toBe(30000)
  })

  test('notifyDebounceMs와 다른 안전 필드를 동시에 변경할 수 있다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      detector: {
        notifyDebounceMs: 45000,
        WARNING: 8,
        CRITICAL: 16,
        notifyChannels: ['cli'],
        lowConfidenceNotify: true,
      },
    })
    mgr.reload(next)

    const cfg = mgr.getConfig()
    expect(cfg.notifyDebounceMs).toBe(45000)
    expect(cfg.WARNING).toBe(8)
    expect(cfg.CRITICAL).toBe(16)
    expect(cfg.notifyChannels).toEqual(['cli'])
    expect(cfg.lowConfidenceNotify).toBe(true)
  })

  test('동일한 notifyDebounceMs 값으로 reload하면 reload 반환값이 false다 (변경 없음)', () => {
    const initial = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 60000 } })
    const mgr = ConfigManager.fromConfig(initial)

    const same = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 60000 } })
    const result = mgr.reload(same)

    expect(result).toBe(false)
    expect(mgr.getConfig().notifyDebounceMs).toBe(60000)
  })

  test('위험 필드 변경과 함께 notifyDebounceMs를 변경하면 debounce만 적용된다', () => {
    const { logger } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { embedDim: 1024, notifyDebounceMs: 60000 },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const next = makeLoopBreakerConfig({
      detector: { embedDim: 512, notifyDebounceMs: 30000 },
    })
    mgr.reload(next)

    // 안전 필드(notifyDebounceMs) 변경은 적용됨
    expect(mgr.getConfig().notifyDebounceMs).toBe(30000)
    // 위험 필드(embedDim) 변경은 거부됨
    expect(mgr.getConfig().embedDim).toBe(1024)
  })
})

// ── 5. DEFAULT_DETECTOR_CONFIG.notifyDebounceMs 불변 보장 ────────────────────

describe('Sub-AC 5.2b: DEFAULT_DETECTOR_CONFIG.notifyDebounceMs 불변 유지', () => {
  test('notifyDebounceMs reload 후 DEFAULT_DETECTOR_CONFIG.notifyDebounceMs(60000)는 변경되지 않는다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(makeLoopBreakerConfig({ detector: { notifyDebounceMs: 1 } }))

    expect(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs).toBe(60000)
  })

  test('여러 번 notifyDebounceMs reload 후에도 DEFAULT_DETECTOR_CONFIG는 불변이다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    for (let i = 1; i <= 5; i++) {
      mgr.reload(makeLoopBreakerConfig({ detector: { notifyDebounceMs: i * 1000 } }))
    }

    expect(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs).toBe(60000)
    expect(Object.isFrozen(DEFAULT_DETECTOR_CONFIG)).toBe(true)
  })

  test('getConfig()가 반환하는 notifyDebounceMs는 DEFAULT_DETECTOR_CONFIG와 별개 객체에 있다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(makeLoopBreakerConfig({ detector: { notifyDebounceMs: 30000 } }))

    expect(mgr.getConfig()).not.toBe(DEFAULT_DETECTOR_CONFIG)
    expect(mgr.getConfig().notifyDebounceMs).toBe(30000)
    expect(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs).toBe(60000)
  })
})
