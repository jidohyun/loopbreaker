// tests/config-manager-sub-ac-5-2c.test.ts
//
// Sub-AC 5.2c: ConfigManager.onReload(next)가 notifyChannels·webhookUrl·lowConfidenceNotify
// 필드 변경을 무중단으로 적용한다.
//
// 검증 항목:
//   1. notifyChannels 변경 시 getConfig()가 즉시 새 값을 반환한다
//   2. webhookUrl 변경 시 getConfig()가 즉시 새 값을 반환한다
//   3. lowConfidenceNotify 변경 시 getConfig()가 즉시 새 값을 반환한다
//   4. onReload 콜백이 각 알림 관련 필드의 새 값을 인자로 받는다
//   5. 동일 ConfigManager 인스턴스에서 무중단으로 연속 변경이 가능하다
//   6. DEFAULT_DETECTOR_CONFIG의 알림 관련 기본값은 불변이다
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

// ── 1. notifyChannels 변경이 즉시 반영된다 ──────────────────────────────────

describe('Sub-AC 5.2c: notifyChannels 변경 무중단 적용', () => {
  test('notifyChannels 변경 시 getConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getConfig().notifyChannels).toEqual(DEFAULT_DETECTOR_CONFIG.notifyChannels)

    const next = makeLoopBreakerConfig({ detector: { notifyChannels: ['cli'] } })
    mgr.reload(next)

    expect(mgr.getConfig().notifyChannels).toEqual(['cli'])
  })

  test('notifyChannels를 [desktop, webhook, cli] 전체로 확장할 수 있다', () => {
    const initial = makeLoopBreakerConfig({ detector: { notifyChannels: ['cli'] } })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      detector: { notifyChannels: ['desktop', 'webhook', 'cli'] },
    })
    mgr.reload(next)

    expect(mgr.getConfig().notifyChannels).toEqual(['desktop', 'webhook', 'cli'])
  })

  test('notifyChannels를 빈 배열로 변경할 수 있다', () => {
    const initial = makeLoopBreakerConfig({ detector: { notifyChannels: ['desktop', 'cli'] } })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { notifyChannels: [] } })
    mgr.reload(next)

    expect(mgr.getConfig().notifyChannels).toEqual([])
  })

  test('notifyChannels 변경 후 reload 반환값이 true다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { notifyChannels: ['webhook'] } })
    const result = mgr.reload(next)

    expect(result).toBe(true)
  })

  test('동일한 notifyChannels 값으로 reload하면 reload 반환값이 false다 (변경 없음)', () => {
    const initial = makeLoopBreakerConfig({
      detector: { notifyChannels: ['desktop', 'cli'] },
    })
    const mgr = ConfigManager.fromConfig(initial)

    const same = makeLoopBreakerConfig({ detector: { notifyChannels: ['desktop', 'cli'] } })
    const result = mgr.reload(same)

    expect(result).toBe(false)
  })
})

// ── 2. webhookUrl 변경이 즉시 반영된다 ──────────────────────────────────────

describe('Sub-AC 5.2c: webhookUrl 변경 무중단 적용', () => {
  test('webhookUrl 변경 시 getConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getConfig().webhookUrl).toBe(DEFAULT_DETECTOR_CONFIG.webhookUrl)

    const next = makeLoopBreakerConfig({
      detector: { webhookUrl: 'https://example.com/hook' },
    })
    mgr.reload(next)

    expect(mgr.getConfig().webhookUrl).toBe('https://example.com/hook')
  })

  test('webhookUrl을 다른 URL로 변경할 수 있다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { webhookUrl: 'https://first.example.com/hook' },
    })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      detector: { webhookUrl: 'https://second.example.com/hook' },
    })
    mgr.reload(next)

    expect(mgr.getConfig().webhookUrl).toBe('https://second.example.com/hook')
  })

  test('webhookUrl을 undefined(미설정)로 변경할 수 있다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { webhookUrl: 'https://example.com/hook' },
    })
    const mgr = ConfigManager.fromConfig(initial)

    // webhookUrl 없는 config로 reload → undefined로 돌아간다
    const next = makeLoopBreakerConfig({})
    mgr.reload(next)

    expect(mgr.getConfig().webhookUrl).toBeUndefined()
  })

  test('webhookUrl 변경 후 reload 반환값이 true다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      detector: { webhookUrl: 'https://example.com/hook' },
    })
    const result = mgr.reload(next)

    expect(result).toBe(true)
  })
})

// ── 3. lowConfidenceNotify 변경이 즉시 반영된다 ─────────────────────────────

describe('Sub-AC 5.2c: lowConfidenceNotify 변경 무중단 적용', () => {
  test('lowConfidenceNotify false→true 변경 시 getConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getConfig().lowConfidenceNotify).toBe(DEFAULT_DETECTOR_CONFIG.lowConfidenceNotify)
    expect(mgr.getConfig().lowConfidenceNotify).toBe(false)

    const next = makeLoopBreakerConfig({ detector: { lowConfidenceNotify: true } })
    mgr.reload(next)

    expect(mgr.getConfig().lowConfidenceNotify).toBe(true)
  })

  test('lowConfidenceNotify true→false 변경 시 getConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({ detector: { lowConfidenceNotify: true } })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { lowConfidenceNotify: false } })
    mgr.reload(next)

    expect(mgr.getConfig().lowConfidenceNotify).toBe(false)
  })

  test('lowConfidenceNotify 변경 후 reload 반환값이 true다', () => {
    const initial = makeLoopBreakerConfig({ detector: { lowConfidenceNotify: false } })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { lowConfidenceNotify: true } })
    const result = mgr.reload(next)

    expect(result).toBe(true)
  })

  test('동일한 lowConfidenceNotify 값으로 reload하면 반환값이 false다 (변경 없음)', () => {
    const initial = makeLoopBreakerConfig({ detector: { lowConfidenceNotify: true } })
    const mgr = ConfigManager.fromConfig(initial)

    const same = makeLoopBreakerConfig({ detector: { lowConfidenceNotify: true } })
    const result = mgr.reload(same)

    expect(result).toBe(false)
  })
})

// ── 4. onReload 콜백이 각 알림 관련 필드의 새 값을 인자로 받는다 ─────────────

describe('Sub-AC 5.2c: onReload 콜백 — 알림 관련 필드 전달 검증', () => {
  test('notifyChannels 변경 시 onReload 콜백이 새 값을 받는다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    let received: DetectorConfig | null = null
    mgr.onReload((next) => { received = next })

    const next = makeLoopBreakerConfig({ detector: { notifyChannels: ['webhook'] } })
    mgr.reload(next)

    expect(received).not.toBeNull()
    expect(received!.notifyChannels).toEqual(['webhook'])
  })

  test('webhookUrl 변경 시 onReload 콜백이 새 값을 받는다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    let received: DetectorConfig | null = null
    mgr.onReload((next) => { received = next })

    const next = makeLoopBreakerConfig({
      detector: { webhookUrl: 'https://example.com/hook' },
    })
    mgr.reload(next)

    expect(received).not.toBeNull()
    expect(received!.webhookUrl).toBe('https://example.com/hook')
  })

  test('lowConfidenceNotify 변경 시 onReload 콜백이 새 값을 받는다', () => {
    const initial = makeLoopBreakerConfig({ detector: { lowConfidenceNotify: false } })
    const mgr = ConfigManager.fromConfig(initial)

    let received: DetectorConfig | null = null
    mgr.onReload((next) => { received = next })

    const next = makeLoopBreakerConfig({ detector: { lowConfidenceNotify: true } })
    mgr.reload(next)

    expect(received).not.toBeNull()
    expect(received!.lowConfidenceNotify).toBe(true)
  })

  test('콜백이 받은 값은 getConfig()와 일치한다 (notifyChannels)', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    let callbackChannels: string[] | null = null
    mgr.onReload((next) => { callbackChannels = [...next.notifyChannels] })

    const next = makeLoopBreakerConfig({ detector: { notifyChannels: ['cli', 'webhook'] } })
    mgr.reload(next)

    expect(callbackChannels).toEqual(['cli', 'webhook'])
    expect(callbackChannels).toEqual(mgr.getConfig().notifyChannels)
  })

  test('콜백이 받은 값은 getConfig()와 일치한다 (lowConfidenceNotify)', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    let callbackValue: boolean | null = null
    mgr.onReload((next) => { callbackValue = next.lowConfidenceNotify })

    const next = makeLoopBreakerConfig({ detector: { lowConfidenceNotify: true } })
    mgr.reload(next)

    expect(callbackValue).toBe(true)
    expect(callbackValue).toBe(mgr.getConfig().lowConfidenceNotify)
  })

  test('세 알림 필드를 동시에 변경하면 콜백이 모두 새 값을 받는다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    let received: DetectorConfig | null = null
    mgr.onReload((next) => { received = next })

    const next = makeLoopBreakerConfig({
      detector: {
        notifyChannels: ['desktop', 'webhook'],
        webhookUrl: 'https://example.com/hook',
        lowConfidenceNotify: true,
      },
    })
    mgr.reload(next)

    expect(received).not.toBeNull()
    expect(received!.notifyChannels).toEqual(['desktop', 'webhook'])
    expect(received!.webhookUrl).toBe('https://example.com/hook')
    expect(received!.lowConfidenceNotify).toBe(true)
  })

  test('여러 onReload 콜백이 모두 새 알림 필드 값을 받는다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const received: boolean[] = []
    mgr.onReload((next) => { received.push(next.lowConfidenceNotify) })
    mgr.onReload((next) => { received.push(next.lowConfidenceNotify) })

    const next = makeLoopBreakerConfig({ detector: { lowConfidenceNotify: true } })
    mgr.reload(next)

    expect(received).toEqual([true, true])
  })
})

// ── 5. 동일 인스턴스에서 무중단 연속 변경 ─────────────────────────────────────

describe('Sub-AC 5.2c: 서비스 재시작 없이 연속 변경 — 알림 관련 필드', () => {
  test('notifyChannels를 여러 번 연속으로 변경할 수 있다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(makeLoopBreakerConfig({ detector: { notifyChannels: ['cli'] } }))
    expect(mgr.getConfig().notifyChannels).toEqual(['cli'])

    mgr.reload(makeLoopBreakerConfig({ detector: { notifyChannels: ['desktop', 'cli'] } }))
    expect(mgr.getConfig().notifyChannels).toEqual(['desktop', 'cli'])

    mgr.reload(makeLoopBreakerConfig({ detector: { notifyChannels: ['webhook'] } }))
    expect(mgr.getConfig().notifyChannels).toEqual(['webhook'])
  })

  test('lowConfidenceNotify를 여러 번 토글할 수 있다', () => {
    const initial = makeLoopBreakerConfig({ detector: { lowConfidenceNotify: false } })
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(makeLoopBreakerConfig({ detector: { lowConfidenceNotify: true } }))
    expect(mgr.getConfig().lowConfidenceNotify).toBe(true)

    mgr.reload(makeLoopBreakerConfig({ detector: { lowConfidenceNotify: false } }))
    expect(mgr.getConfig().lowConfidenceNotify).toBe(false)

    mgr.reload(makeLoopBreakerConfig({ detector: { lowConfidenceNotify: true } }))
    expect(mgr.getConfig().lowConfidenceNotify).toBe(true)
  })

  test('세 알림 필드와 다른 안전 필드를 동시에 변경할 수 있다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      detector: {
        notifyChannels: ['desktop', 'webhook'],
        webhookUrl: 'https://example.com/hook',
        lowConfidenceNotify: true,
        notifyDebounceMs: 30000,
        WARNING: 8,
      },
    })
    mgr.reload(next)

    const cfg = mgr.getConfig()
    expect(cfg.notifyChannels).toEqual(['desktop', 'webhook'])
    expect(cfg.webhookUrl).toBe('https://example.com/hook')
    expect(cfg.lowConfidenceNotify).toBe(true)
    expect(cfg.notifyDebounceMs).toBe(30000)
    expect(cfg.WARNING).toBe(8)
  })

  test('위험 필드 변경과 함께 알림 필드를 변경하면 알림 필드만 적용된다', () => {
    const { logger } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: {
        embedDim: 1024,
        notifyChannels: ['desktop'],
        lowConfidenceNotify: false,
      },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const next = makeLoopBreakerConfig({
      detector: {
        embedDim: 512,          // 위험 필드 — 거부됨
        notifyChannels: ['cli', 'webhook'],  // 안전 필드 — 적용됨
        lowConfidenceNotify: true,           // 안전 필드 — 적용됨
      },
    })
    mgr.reload(next)

    // 안전 필드(알림 관련) 변경은 적용됨
    expect(mgr.getConfig().notifyChannels).toEqual(['cli', 'webhook'])
    expect(mgr.getConfig().lowConfidenceNotify).toBe(true)
    // 위험 필드(embedDim) 변경은 거부됨
    expect(mgr.getConfig().embedDim).toBe(1024)
  })

  test('변경 없이 동일 값으로 reload하면 ConfigManager 인스턴스는 그대로다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { notifyChannels: ['desktop', 'cli'] },
    })
    const mgr = ConfigManager.fromConfig(initial)
    const mgrRef = mgr

    const same = makeLoopBreakerConfig({
      detector: { notifyChannels: ['desktop', 'cli'] },
    })
    mgr.reload(same)

    // 동일 인스턴스 — 재시작/재생성 없음
    expect(mgr).toBe(mgrRef)
  })
})

// ── 6. DEFAULT_DETECTOR_CONFIG 알림 관련 기본값 불변 보장 ─────────────────────

describe('Sub-AC 5.2c: DEFAULT_DETECTOR_CONFIG 알림 관련 기본값 불변 유지', () => {
  test('reload 후 DEFAULT_DETECTOR_CONFIG.notifyChannels는 변경되지 않는다', () => {
    const originalChannels = [...DEFAULT_DETECTOR_CONFIG.notifyChannels]
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(makeLoopBreakerConfig({ detector: { notifyChannels: ['webhook'] } }))

    expect(DEFAULT_DETECTOR_CONFIG.notifyChannels).toEqual(originalChannels)
  })

  test('reload 후 DEFAULT_DETECTOR_CONFIG.webhookUrl은 undefined로 불변이다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(makeLoopBreakerConfig({
      detector: { webhookUrl: 'https://example.com/hook' },
    }))

    expect(DEFAULT_DETECTOR_CONFIG.webhookUrl).toBeUndefined()
  })

  test('reload 후 DEFAULT_DETECTOR_CONFIG.lowConfidenceNotify는 false로 불변이다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(makeLoopBreakerConfig({ detector: { lowConfidenceNotify: true } }))

    expect(DEFAULT_DETECTOR_CONFIG.lowConfidenceNotify).toBe(false)
  })

  test('여러 번 reload 후에도 DEFAULT_DETECTOR_CONFIG 전체 객체가 동결 상태다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    for (let i = 0; i < 3; i++) {
      mgr.reload(makeLoopBreakerConfig({
        detector: {
          notifyChannels: ['cli'],
          lowConfidenceNotify: i % 2 === 0,
        },
      }))
    }

    expect(Object.isFrozen(DEFAULT_DETECTOR_CONFIG)).toBe(true)
    expect(DEFAULT_DETECTOR_CONFIG.notifyChannels).toEqual(['desktop', 'cli'])
    expect(DEFAULT_DETECTOR_CONFIG.lowConfidenceNotify).toBe(false)
    expect(DEFAULT_DETECTOR_CONFIG.webhookUrl).toBeUndefined()
  })

  test('getConfig()가 반환하는 객체는 DEFAULT_DETECTOR_CONFIG와 별개다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(makeLoopBreakerConfig({
      detector: { notifyChannels: ['webhook'], lowConfidenceNotify: true },
    }))

    expect(mgr.getConfig()).not.toBe(DEFAULT_DETECTOR_CONFIG)
    expect(mgr.getConfig().notifyChannels).toEqual(['webhook'])
    expect(DEFAULT_DETECTOR_CONFIG.notifyChannels).toEqual(['desktop', 'cli'])
  })
})
