// tests/config-manager-sub-ac-5-2d.test.ts
//
// Sub-AC 5.2d: ConfigManager.onReload(next)가 privacy·api상한 필드 변경을 무중단으로 적용한다.
//
// 검증 항목:
//   1. privacy 필드 변경 시 getLoopBreakerConfig()가 즉시 새 값을 반환한다
//   2. api 상한 필드(maxConcurrentApiCalls/apiMaxRetries/dailyCostCapUsd/maxJudgeCallsPerSession)
//      변경 시 getLoopBreakerConfig()가 즉시 새 값을 반환한다
//   3. onReload 콜백이 호출된다 (privacy/api 변경 단독으로는 DetectorConfig 변경 없으므로
//      안전 필드가 동시에 바뀐 경우 콜백 포함 검증)
//   4. privacy + api 상한을 동시에 변경하면 둘 다 즉시 반영된다
//   5. privacy·api 변경과 위험 필드 변경이 함께 오면 위험 필드만 거부되고
//      privacy·api는 적용된다
//   6. 연속 reload에서도 privacy·api 값이 매번 최신으로 유지된다
//   7. DEFAULT_DETECTOR_CONFIG는 reload 후에도 불변이다
//
// 부수효과 없음: 실제 파일 I/O 없음, 임시 tmpdir 경로만 사용.

import { ConfigManager } from '../src/config/config-manager.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'
import {
  loopBreakerConfigSchema,
  type LoopBreakerConfig,
} from '../src/config/config-schema.js'

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

/** 최소 유효 LoopBreakerConfig를 zod로 빌드하는 헬퍼 */
function makeLoopBreakerConfig(overrides?: {
  detector?: Record<string, unknown>
  privacy?: Record<string, unknown>
  api?: Record<string, unknown>
  watch?: Record<string, unknown>
  notify?: Record<string, unknown>
}): LoopBreakerConfig {
  return loopBreakerConfigSchema.parse({
    version: 1,
    detector: overrides?.detector ?? {},
    privacy: overrides?.privacy ?? {},
    api: overrides?.api ?? {},
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

// ── 1. privacy 필드 변경이 즉시 반영된다 ────────────────────────────────────

describe('Sub-AC 5.2d: privacy 필드 변경 무중단 적용', () => {
  test('privacy.redactFilePaths 변경 시 getLoopBreakerConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getLoopBreakerConfig().privacy.redactFilePaths).toBe(true) // default

    // privacy 변경만으로는 DetectorConfig에 변경이 없으므로 detector도 같이 변경
    const nextWithDetector = makeLoopBreakerConfig({
      privacy: { redactFilePaths: false },
      detector: { WARNING: 8 },
    })
    mgr.reload(nextWithDetector)

    expect(mgr.getLoopBreakerConfig().privacy.redactFilePaths).toBe(false)
  })

  test('privacy.sendCodeToApi 변경 시 getLoopBreakerConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({ privacy: { sendCodeToApi: 'snippets' } })
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getLoopBreakerConfig().privacy.sendCodeToApi).toBe('snippets')

    const next = makeLoopBreakerConfig({
      privacy: { sendCodeToApi: 'none' },
      detector: { WARNING: 8 }, // DetectorConfig도 변경해 reload가 true를 반환하게 함
    })
    mgr.reload(next)

    expect(mgr.getLoopBreakerConfig().privacy.sendCodeToApi).toBe('none')
  })

  test('privacy.maxSnippetChars 변경 시 getLoopBreakerConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({ privacy: { maxSnippetChars: 2000 } })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      privacy: { maxSnippetChars: 500 },
      detector: { WARNING: 8 },
    })
    mgr.reload(next)

    expect(mgr.getLoopBreakerConfig().privacy.maxSnippetChars).toBe(500)
  })

  test('privacy.embedReasoning 변경 시 getLoopBreakerConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({ privacy: { embedReasoning: false } })
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getLoopBreakerConfig().privacy.embedReasoning).toBe(false)

    const next = makeLoopBreakerConfig({
      privacy: { embedReasoning: true },
      detector: { WARNING: 8 },
    })
    mgr.reload(next)

    expect(mgr.getLoopBreakerConfig().privacy.embedReasoning).toBe(true)
  })

  test('reload 후에도 위험 필드(embedDim)는 변경되지 않는다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { embedDim: 1024 },
      privacy: { redactFilePaths: true },
    })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      detector: { embedDim: 512, WARNING: 8 }, // embedDim은 위험 필드 — 거부됨
      privacy: { redactFilePaths: false },      // 안전 필드 — 적용됨
    })
    mgr.reload(next)

    // privacy 안전 필드는 적용됨
    expect(mgr.getLoopBreakerConfig().privacy.redactFilePaths).toBe(false)
    // 위험 필드 embedDim은 거부됨
    expect(mgr.getConfig().embedDim).toBe(1024)
  })
})

// ── 2. api 상한 필드 변경이 즉시 반영된다 ───────────────────────────────────

describe('Sub-AC 5.2d: api 상한 필드 변경 무중단 적용', () => {
  test('api.maxConcurrentApiCalls 변경 시 getLoopBreakerConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({ api: { maxConcurrentApiCalls: 4 } })
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getLoopBreakerConfig().api.maxConcurrentApiCalls).toBe(4)

    const next = makeLoopBreakerConfig({
      api: { maxConcurrentApiCalls: 8 },
      detector: { WARNING: 8 },
    })
    mgr.reload(next)

    expect(mgr.getLoopBreakerConfig().api.maxConcurrentApiCalls).toBe(8)
  })

  test('api.apiMaxRetries 변경 시 getLoopBreakerConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({ api: { apiMaxRetries: 3 } })
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getLoopBreakerConfig().api.apiMaxRetries).toBe(3)

    const next = makeLoopBreakerConfig({
      api: { apiMaxRetries: 5 },
      detector: { WARNING: 8 },
    })
    mgr.reload(next)

    expect(mgr.getLoopBreakerConfig().api.apiMaxRetries).toBe(5)
  })

  test('api.dailyCostCapUsd 변경 시 getLoopBreakerConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({ api: { dailyCostCapUsd: 5.0 } })
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getLoopBreakerConfig().api.dailyCostCapUsd).toBe(5.0)

    const next = makeLoopBreakerConfig({
      api: { dailyCostCapUsd: 10.0 },
      detector: { WARNING: 8 },
    })
    mgr.reload(next)

    expect(mgr.getLoopBreakerConfig().api.dailyCostCapUsd).toBe(10.0)
  })

  test('api.maxJudgeCallsPerSession 변경 시 getLoopBreakerConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({ api: { maxJudgeCallsPerSession: 50 } })
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getLoopBreakerConfig().api.maxJudgeCallsPerSession).toBe(50)

    const next = makeLoopBreakerConfig({
      api: { maxJudgeCallsPerSession: 100 },
      detector: { WARNING: 8 },
    })
    mgr.reload(next)

    expect(mgr.getLoopBreakerConfig().api.maxJudgeCallsPerSession).toBe(100)
  })

  test('api 상한 필드 변경 후 reload 반환값이 true다 (다른 안전 필드와 함께)', () => {
    const initial = makeLoopBreakerConfig({ api: { maxConcurrentApiCalls: 4 } })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      api: { maxConcurrentApiCalls: 8 },
      detector: { WARNING: 8 }, // DetectorConfig 변경 포함 → reload=true 보장
    })
    const result = mgr.reload(next)

    expect(result).toBe(true)
  })

  test('api 상한을 낮출 수도 있다 (dailyCostCapUsd 감소)', () => {
    const initial = makeLoopBreakerConfig({ api: { dailyCostCapUsd: 10.0 } })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      api: { dailyCostCapUsd: 1.0 },
      detector: { WARNING: 8 },
    })
    mgr.reload(next)

    expect(mgr.getLoopBreakerConfig().api.dailyCostCapUsd).toBe(1.0)
  })
})

// ── 3. onReload 콜백이 privacy/api 변경 포함 reload에서 호출된다 ─────────────

describe('Sub-AC 5.2d: onReload 콜백 호출 검증 — privacy·api 변경 포함', () => {
  test('privacy + detector 안전 필드 변경 시 onReload 콜백이 새 DetectorConfig를 받는다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    let callbackCount = 0
    let receivedWarning: number | null = null
    mgr.onReload((next) => {
      callbackCount++
      receivedWarning = next.WARNING
    })

    const next = makeLoopBreakerConfig({
      privacy: { redactFilePaths: false, sendCodeToApi: 'none' },
      api: { maxConcurrentApiCalls: 8, dailyCostCapUsd: 10.0 },
      detector: { WARNING: 15 }, // DetectorConfig 변경 → 콜백 트리거
    })
    mgr.reload(next)

    expect(callbackCount).toBe(1)
    expect(receivedWarning).toBe(15)
    // privacy·api 변경도 반영됨
    expect(mgr.getLoopBreakerConfig().privacy.redactFilePaths).toBe(false)
    expect(mgr.getLoopBreakerConfig().api.maxConcurrentApiCalls).toBe(8)
  })

  test('여러 onReload 콜백이 모두 호출된다 (privacy·api + detector 변경)', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const received: number[] = []
    mgr.onReload((next) => { received.push(next.WARNING) })
    mgr.onReload((next) => { received.push(next.WARNING) })

    const next = makeLoopBreakerConfig({
      privacy: { embedReasoning: true },
      api: { apiMaxRetries: 5 },
      detector: { WARNING: 12 },
    })
    mgr.reload(next)

    expect(received).toEqual([12, 12])
    expect(mgr.getLoopBreakerConfig().api.apiMaxRetries).toBe(5)
  })
})

// ── 4. privacy + api 상한 동시 변경이 즉시 반영된다 ─────────────────────────

describe('Sub-AC 5.2d: privacy·api 동시 변경 무중단 적용', () => {
  test('privacy와 api 상한 4개를 동시에 변경하면 모두 즉시 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      privacy: {
        redactFilePaths: false,
        sendCodeToApi: 'full',
        maxSnippetChars: 1000,
        embedReasoning: true,
      },
      api: {
        maxConcurrentApiCalls: 2,
        apiMaxRetries: 1,
        dailyCostCapUsd: 20.0,
        maxJudgeCallsPerSession: 25,
      },
      detector: { WARNING: 8 },
    })
    mgr.reload(next)

    const lb = mgr.getLoopBreakerConfig()
    // privacy 필드 검증
    expect(lb.privacy.redactFilePaths).toBe(false)
    expect(lb.privacy.sendCodeToApi).toBe('full')
    expect(lb.privacy.maxSnippetChars).toBe(1000)
    expect(lb.privacy.embedReasoning).toBe(true)
    // api 상한 필드 검증
    expect(lb.api.maxConcurrentApiCalls).toBe(2)
    expect(lb.api.apiMaxRetries).toBe(1)
    expect(lb.api.dailyCostCapUsd).toBe(20.0)
    expect(lb.api.maxJudgeCallsPerSession).toBe(25)
  })

  test('privacy·api 변경과 함께 위험 필드 변경이 오면 위험 필드만 거부된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { embedDim: 1024, judgeModelId: 'claude-3-5-sonnet-20241022' },
      privacy: { redactFilePaths: true },
      api: { maxConcurrentApiCalls: 4 },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const next = makeLoopBreakerConfig({
      detector: {
        embedDim: 512,                            // 위험 필드 — 거부
        judgeModelId: 'claude-3-opus-20240229',   // 위험 필드 — 거부
        WARNING: 8,                               // 안전 필드 — 적용
      },
      privacy: { redactFilePaths: false },        // 안전 필드 — 적용
      api: { maxConcurrentApiCalls: 8 },          // 안전 필드 — 적용
    })
    mgr.reload(next)

    // 위험 필드는 이전 값 유지
    expect(mgr.getConfig().embedDim).toBe(1024)
    expect(mgr.getConfig().judgeModelId).toBe('claude-3-5-sonnet-20241022')
    // 안전 필드는 적용됨
    expect(mgr.getConfig().WARNING).toBe(8)
    expect(mgr.getLoopBreakerConfig().privacy.redactFilePaths).toBe(false)
    expect(mgr.getLoopBreakerConfig().api.maxConcurrentApiCalls).toBe(8)
    // 위험 필드 거부 경고 로그 존재
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0].msg).toMatch(/위험 필드/)
  })
})

// ── 5. 위험 필드 변경 시 privacy·api는 여전히 적용된다 ───────────────────────

describe('Sub-AC 5.2d: 위험 필드 거부 + 안전 필드(privacy·api) 적용 독립성', () => {
  test('embedModelId 위험 필드 거부와 무관하게 privacy는 업데이트된다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { embedModelId: 'voyage-3-lite' },
      privacy: { sendCodeToApi: 'snippets' },
    })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      detector: {
        embedModelId: 'text-embedding-3-large', // 위험 필드 — 거부
        WARNING: 7,
      },
      privacy: { sendCodeToApi: 'none' },       // 안전 필드 — 적용
    })
    mgr.reload(next)

    // 위험 필드 embedModelId는 거부됨
    expect(mgr.getConfig().embedModelId).toBe('voyage-3-lite')
    // privacy 안전 필드는 적용됨
    expect(mgr.getLoopBreakerConfig().privacy.sendCodeToApi).toBe('none')
  })

  test('sessionGlob 위험 필드 거부와 무관하게 api 상한은 업데이트된다', () => {
    const initial = makeLoopBreakerConfig({
      watch: { sessionGlob: '~/.claude/projects/**/*.jsonl' },
      api: { maxJudgeCallsPerSession: 50 },
    })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      watch: { sessionGlob: '/custom/path/**/*.jsonl' }, // 위험 필드 — 거부
      api: { maxJudgeCallsPerSession: 200 },             // 안전 필드 — 적용
      detector: { WARNING: 7 },
    })
    mgr.reload(next)

    // watch.sessionGlob은 거부됨
    expect(mgr.getLoopBreakerConfig().watch.sessionGlob).toBe('~/.claude/projects/**/*.jsonl')
    // api 상한은 적용됨
    expect(mgr.getLoopBreakerConfig().api.maxJudgeCallsPerSession).toBe(200)
  })
})

// ── 6. 연속 reload에서 privacy·api 값이 매번 최신으로 유지된다 ──────────────

describe('Sub-AC 5.2d: 연속 reload — privacy·api 최신값 유지', () => {
  test('api.maxConcurrentApiCalls를 여러 번 연속으로 변경할 수 있다', () => {
    const initial = makeLoopBreakerConfig({ api: { maxConcurrentApiCalls: 4 } })
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(makeLoopBreakerConfig({
      api: { maxConcurrentApiCalls: 2 },
      detector: { WARNING: 8 },
    }))
    expect(mgr.getLoopBreakerConfig().api.maxConcurrentApiCalls).toBe(2)

    mgr.reload(makeLoopBreakerConfig({
      api: { maxConcurrentApiCalls: 6 },
      detector: { WARNING: 9 },
    }))
    expect(mgr.getLoopBreakerConfig().api.maxConcurrentApiCalls).toBe(6)

    mgr.reload(makeLoopBreakerConfig({
      api: { maxConcurrentApiCalls: 1 },
      detector: { WARNING: 10 },
    }))
    expect(mgr.getLoopBreakerConfig().api.maxConcurrentApiCalls).toBe(1)
  })

  test('privacy.sendCodeToApi를 여러 번 연속으로 변경할 수 있다', () => {
    const initial = makeLoopBreakerConfig({ privacy: { sendCodeToApi: 'snippets' } })
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(makeLoopBreakerConfig({
      privacy: { sendCodeToApi: 'none' },
      detector: { WARNING: 8 },
    }))
    expect(mgr.getLoopBreakerConfig().privacy.sendCodeToApi).toBe('none')

    mgr.reload(makeLoopBreakerConfig({
      privacy: { sendCodeToApi: 'full' },
      detector: { WARNING: 9 },
    }))
    expect(mgr.getLoopBreakerConfig().privacy.sendCodeToApi).toBe('full')

    mgr.reload(makeLoopBreakerConfig({
      privacy: { sendCodeToApi: 'snippets' },
      detector: { WARNING: 10 },
    }))
    expect(mgr.getLoopBreakerConfig().privacy.sendCodeToApi).toBe('snippets')
  })

  test('reload 실패(zod 검증 실패) 시 privacy·api 이전 값을 유지한다', () => {
    const { logger } = makeLogger()
    const initial = makeLoopBreakerConfig({
      privacy: { redactFilePaths: true, sendCodeToApi: 'snippets' },
      api: { maxConcurrentApiCalls: 4, apiMaxRetries: 3 },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    // 잘못된 config (version 누락) → zod 실패
    const result = mgr.reload({ version: 99, invalid: true })
    expect(result).toBe(false)

    // 이전 값이 그대로 유지됨
    expect(mgr.getLoopBreakerConfig().privacy.redactFilePaths).toBe(true)
    expect(mgr.getLoopBreakerConfig().privacy.sendCodeToApi).toBe('snippets')
    expect(mgr.getLoopBreakerConfig().api.maxConcurrentApiCalls).toBe(4)
    expect(mgr.getLoopBreakerConfig().api.apiMaxRetries).toBe(3)
  })
})

// ── 7. DEFAULT_DETECTOR_CONFIG는 reload 후에도 불변이다 ────────────────────

describe('Sub-AC 5.2d: DEFAULT_DETECTOR_CONFIG 불변 유지', () => {
  test('privacy·api reload 후 DEFAULT_DETECTOR_CONFIG 전체가 동결 상태다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    for (let i = 0; i < 3; i++) {
      mgr.reload(makeLoopBreakerConfig({
        privacy: { redactFilePaths: i % 2 === 0, sendCodeToApi: i % 2 === 0 ? 'snippets' : 'none' },
        api: { maxConcurrentApiCalls: i + 1, dailyCostCapUsd: (i + 1) * 5.0 },
        detector: { WARNING: 8 + i },
      }))
    }

    expect(Object.isFrozen(DEFAULT_DETECTOR_CONFIG)).toBe(true)
    // DEFAULT_DETECTOR_CONFIG의 기준 값은 변경되지 않음
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10)
    expect(DEFAULT_DETECTOR_CONFIG.embedDim).toBe(1024)
    expect(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs).toBe(60000)
  })

  test('getConfig()가 반환하는 객체는 DEFAULT_DETECTOR_CONFIG와 별개다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(makeLoopBreakerConfig({
      privacy: { redactFilePaths: false },
      api: { maxConcurrentApiCalls: 8 },
      detector: { WARNING: 7 },
    }))

    expect(mgr.getConfig()).not.toBe(DEFAULT_DETECTOR_CONFIG)
    expect(mgr.getConfig().WARNING).toBe(7)
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10)
  })
})
