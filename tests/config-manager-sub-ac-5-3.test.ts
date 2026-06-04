// tests/config-manager-sub-ac-5-3.test.ts
//
// Sub-AC 5.3: ConfigManager.onReload(next)가 위험 필드(DB경로/sessionGlob/embedDim/
//             embedModelId/judgeModelId) 변경을 거부하고 경고를 발생시키며
//             이전 설정을 유지한다.
//
// 검증 항목:
//   1. embedDim 변경 시도 → 거부 + 경고 + 이전 값 보존
//   2. embedModelId 변경 시도 → 거부 + 경고 + 이전 값 보존
//   3. judgeModelId 변경 시도 → 거부 + 경고 + 이전 값 보존
//   4. watch.sessionGlob 변경 시도 → 거부 + 경고 + 이전 값 보존
//   5. 위험 필드 여러 개 동시 변경 → 모두 거부 + 경고 + 이전 값 보존
//   6. 위험 필드 거부 시 안전 필드는 정상 적용됨
//   7. 위험 필드만 변경 시 reload 반환값(true/false) 및 콜백 동작 확인
//   8. 연속 reload에서도 위험 필드가 항상 거부된다
//   9. 경고 메시지에 변경 시도된 위험 필드 이름이 포함된다
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

// ── 1. embedDim 위험 필드 거부 ──────────────────────────────────────────────

describe('Sub-AC 5.3: embedDim 위험 필드 거부', () => {
  test('embedDim 변경 시도 시 경고가 발생한다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { embedDim: 1024 },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: { embedDim: 512, WARNING: 8 },
      }),
    )

    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0].msg).toMatch(/위험 필드/)
  })

  test('embedDim 변경 시도 시 이전 값(1024)이 보존된다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { embedDim: 1024 },
    })
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: { embedDim: 512, WARNING: 8 },
      }),
    )

    expect(mgr.getConfig().embedDim).toBe(1024)
  })

  test('경고 extra에 변경 시도된 위험 필드(detector.embedDim)가 포함된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { embedDim: 1024 },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: { embedDim: 512, WARNING: 8 },
      }),
    )

    expect(warnings.length).toBeGreaterThan(0)
    const changedFields = warnings[0].extra?.changedFields as string[] | undefined
    expect(changedFields).toBeDefined()
    expect(changedFields).toContain('detector.embedDim')
  })
})

// ── 2. embedModelId 위험 필드 거부 ─────────────────────────────────────────

describe('Sub-AC 5.3: embedModelId 위험 필드 거부', () => {
  test('embedModelId 변경 시도 시 경고가 발생한다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { embedModelId: 'voyage-3-lite' },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          embedModelId: 'text-embedding-3-large',
          WARNING: 8,
        },
      }),
    )

    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0].msg).toMatch(/위험 필드/)
  })

  test('embedModelId 변경 시도 시 이전 값(voyage-3-lite)이 보존된다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { embedModelId: 'voyage-3-lite' },
    })
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          embedModelId: 'text-embedding-3-large',
          WARNING: 8,
        },
      }),
    )

    expect(mgr.getConfig().embedModelId).toBe('voyage-3-lite')
  })

  test('경고 extra에 detector.embedModelId가 포함된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { embedModelId: 'voyage-3-lite' },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          embedModelId: 'text-embedding-3-large',
          WARNING: 8,
        },
      }),
    )

    const changedFields = warnings[0]?.extra?.changedFields as string[] | undefined
    expect(changedFields).toContain('detector.embedModelId')
  })
})

// ── 3. judgeModelId 위험 필드 거부 ─────────────────────────────────────────

describe('Sub-AC 5.3: judgeModelId 위험 필드 거부', () => {
  test('judgeModelId 변경 시도 시 경고가 발생한다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { judgeModelId: 'claude-3-5-sonnet-20241022' },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          judgeModelId: 'claude-3-opus-20240229',
          WARNING: 8,
        },
      }),
    )

    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0].msg).toMatch(/위험 필드/)
  })

  test('judgeModelId 변경 시도 시 이전 값(claude-3-5-sonnet-20241022)이 보존된다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { judgeModelId: 'claude-3-5-sonnet-20241022' },
    })
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          judgeModelId: 'claude-3-opus-20240229',
          WARNING: 8,
        },
      }),
    )

    expect(mgr.getConfig().judgeModelId).toBe('claude-3-5-sonnet-20241022')
  })

  test('경고 extra에 detector.judgeModelId가 포함된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { judgeModelId: 'claude-3-5-sonnet-20241022' },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          judgeModelId: 'claude-3-opus-20240229',
          WARNING: 8,
        },
      }),
    )

    const changedFields = warnings[0]?.extra?.changedFields as string[] | undefined
    expect(changedFields).toContain('detector.judgeModelId')
  })
})

// ── 4. watch.sessionGlob 위험 필드 거부 ────────────────────────────────────

describe('Sub-AC 5.3: watch.sessionGlob 위험 필드 거부', () => {
  test('watch.sessionGlob 변경 시도 시 경고가 발생한다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      watch: { sessionGlob: '~/.claude/projects/**/*.jsonl' },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload(
      makeLoopBreakerConfig({
        watch: { sessionGlob: '/custom/sessions/**/*.jsonl' },
        detector: { WARNING: 8 },
      }),
    )

    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0].msg).toMatch(/위험 필드/)
  })

  test('watch.sessionGlob 변경 시도 시 이전 값이 보존된다', () => {
    const initial = makeLoopBreakerConfig({
      watch: { sessionGlob: '~/.claude/projects/**/*.jsonl' },
    })
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(
      makeLoopBreakerConfig({
        watch: { sessionGlob: '/custom/sessions/**/*.jsonl' },
        detector: { WARNING: 8 },
      }),
    )

    expect(mgr.getLoopBreakerConfig().watch.sessionGlob).toBe(
      '~/.claude/projects/**/*.jsonl',
    )
  })

  test('경고 extra에 watch.sessionGlob이 포함된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      watch: { sessionGlob: '~/.claude/projects/**/*.jsonl' },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload(
      makeLoopBreakerConfig({
        watch: { sessionGlob: '/custom/sessions/**/*.jsonl' },
        detector: { WARNING: 8 },
      }),
    )

    const changedFields = warnings[0]?.extra?.changedFields as string[] | undefined
    expect(changedFields).toContain('watch.sessionGlob')
  })
})

// ── 5. 위험 필드 여러 개 동시 변경 — 모두 거부 ────────────────────────────────

describe('Sub-AC 5.3: 위험 필드 복수 동시 변경 시 모두 거부', () => {
  test('embedDim + embedModelId + judgeModelId 동시 변경 시 모두 거부된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: {
        embedDim: 1024,
        embedModelId: 'voyage-3-lite',
        judgeModelId: 'claude-3-5-sonnet-20241022',
      },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          embedDim: 512,
          embedModelId: 'text-embedding-3-large',
          judgeModelId: 'claude-3-opus-20240229',
          WARNING: 8,
        },
      }),
    )

    // 경고 발생
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0].msg).toMatch(/위험 필드/)

    // 세 필드 모두 이전 값 보존
    expect(mgr.getConfig().embedDim).toBe(1024)
    expect(mgr.getConfig().embedModelId).toBe('voyage-3-lite')
    expect(mgr.getConfig().judgeModelId).toBe('claude-3-5-sonnet-20241022')
  })

  test('모든 위험 필드(embedDim·embedModelId·judgeModelId·sessionGlob) 동시 변경 시 경고에 4개 필드 모두 포함된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: {
        embedDim: 1024,
        embedModelId: 'voyage-3-lite',
        judgeModelId: 'claude-3-5-sonnet-20241022',
      },
      watch: { sessionGlob: '~/.claude/projects/**/*.jsonl' },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          embedDim: 512,
          embedModelId: 'text-embedding-3-large',
          judgeModelId: 'claude-3-opus-20240229',
          WARNING: 8,
        },
        watch: { sessionGlob: '/custom/path/**/*.jsonl' },
      }),
    )

    expect(warnings.length).toBeGreaterThan(0)
    const changedFields = warnings[0]?.extra?.changedFields as string[] | undefined
    expect(changedFields).toBeDefined()
    expect(changedFields).toContain('detector.embedDim')
    expect(changedFields).toContain('detector.embedModelId')
    expect(changedFields).toContain('detector.judgeModelId')
    expect(changedFields).toContain('watch.sessionGlob')
  })

  test('모든 위험 필드가 동시에 거부됐을 때 이전 값이 모두 보존된다', () => {
    const initial = makeLoopBreakerConfig({
      detector: {
        embedDim: 1024,
        embedModelId: 'voyage-3-lite',
        judgeModelId: 'claude-3-5-sonnet-20241022',
      },
      watch: { sessionGlob: '~/.claude/projects/**/*.jsonl' },
    })
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          embedDim: 768,
          embedModelId: 'text-embedding-3-small',
          judgeModelId: 'claude-3-haiku-20240307',
          WARNING: 8,
        },
        watch: { sessionGlob: '/tmp/sessions/**/*.jsonl' },
      }),
    )

    expect(mgr.getConfig().embedDim).toBe(1024)
    expect(mgr.getConfig().embedModelId).toBe('voyage-3-lite')
    expect(mgr.getConfig().judgeModelId).toBe('claude-3-5-sonnet-20241022')
    expect(mgr.getLoopBreakerConfig().watch.sessionGlob).toBe(
      '~/.claude/projects/**/*.jsonl',
    )
  })
})

// ── 6. 위험 필드 거부 시 안전 필드는 정상 적용 ────────────────────────────────

describe('Sub-AC 5.3: 위험 필드 거부와 안전 필드 적용의 독립성', () => {
  test('embedDim 거부 + 안전 필드(WARNING) 정상 적용', () => {
    const initial = makeLoopBreakerConfig({
      detector: { embedDim: 1024, WARNING: 10 },
    })
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: { embedDim: 512, WARNING: 7 },
      }),
    )

    expect(mgr.getConfig().embedDim).toBe(1024) // 거부
    expect(mgr.getConfig().WARNING).toBe(7)       // 적용
  })

  test('embedModelId 거부 + 안전 필드(simThresh·decideThresh) 정상 적용', () => {
    const initial = makeLoopBreakerConfig({
      detector: {
        embedModelId: 'voyage-3-lite',
        simThresh: 0.90,
        decideThresh: 0.7,
      },
    })
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          embedModelId: 'text-embedding-3-large',
          simThresh: 0.80,
          decideThresh: 0.6,
          WARNING: 8,
        },
      }),
    )

    expect(mgr.getConfig().embedModelId).toBe('voyage-3-lite') // 거부
    expect(mgr.getConfig().simThresh).toBe(0.80)               // 적용
    expect(mgr.getConfig().decideThresh).toBe(0.6)             // 적용
  })

  test('judgeModelId 거부 + 안전 필드(notifyDebounceMs·notifyChannels) 정상 적용', () => {
    const initial = makeLoopBreakerConfig({
      detector: {
        judgeModelId: 'claude-3-5-sonnet-20241022',
        notifyDebounceMs: 60000,
        notifyChannels: ['desktop', 'cli'],
      },
    })
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          judgeModelId: 'claude-3-opus-20240229',
          notifyDebounceMs: 30000,
          notifyChannels: ['desktop'],
          WARNING: 8,
        },
      }),
    )

    expect(mgr.getConfig().judgeModelId).toBe('claude-3-5-sonnet-20241022') // 거부
    expect(mgr.getConfig().notifyDebounceMs).toBe(30000)                     // 적용
    expect(mgr.getConfig().notifyChannels).toEqual(['desktop'])               // 적용
  })

  test('watch.sessionGlob 거부 + 안전 필드(lowConfidenceNotify) 정상 적용', () => {
    const initial = makeLoopBreakerConfig({
      watch: { sessionGlob: '~/.claude/projects/**/*.jsonl' },
      detector: { lowConfidenceNotify: false },
    })
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(
      makeLoopBreakerConfig({
        watch: { sessionGlob: '/custom/**/*.jsonl' },
        detector: { lowConfidenceNotify: true, WARNING: 8 },
      }),
    )

    expect(mgr.getLoopBreakerConfig().watch.sessionGlob).toBe(
      '~/.claude/projects/**/*.jsonl',
    ) // 거부
    expect(mgr.getConfig().lowConfidenceNotify).toBe(true) // 적용
  })
})

// ── 7. 위험 필드만 변경 시 reload 반환값 및 콜백 동작 ─────────────────────────

describe('Sub-AC 5.3: 위험 필드만 변경 시 reload 반환값과 콜백 동작', () => {
  test('위험 필드만 변경하고 안전 필드 변경이 없으면 reload는 false를 반환한다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { embedDim: 1024 },
    })
    const mgr = ConfigManager.fromConfig(initial)

    // 안전 필드는 전부 DEFAULT 값, 위험 필드만 다름
    const result = mgr.reload(
      makeLoopBreakerConfig({
        detector: { embedDim: 512 },
      }),
    )

    // embedDim은 거부되고, 안전 필드 변경이 없으므로 false
    expect(result).toBe(false)
  })

  test('위험 필드만 변경 시 onReload 콜백은 호출되지 않는다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { embedModelId: 'voyage-3-lite' },
    })
    const mgr = ConfigManager.fromConfig(initial)

    let callbackCount = 0
    mgr.onReload(() => {
      callbackCount++
    })

    // 안전 필드는 모두 DEFAULT, 위험 필드만 다름
    mgr.reload(
      makeLoopBreakerConfig({
        detector: { embedModelId: 'text-embedding-3-large' },
      }),
    )

    // 위험 필드 거부 → 안전 필드 변화 없음 → 콜백 미호출
    expect(callbackCount).toBe(0)
  })

  test('위험 필드 변경 + 안전 필드 변경이 함께 오면 reload는 true를 반환하고 콜백이 호출된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { embedDim: 1024 },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    let callbackCount = 0
    mgr.onReload(() => {
      callbackCount++
    })

    const result = mgr.reload(
      makeLoopBreakerConfig({
        detector: { embedDim: 512, WARNING: 7 }, // embedDim 거부, WARNING 적용
      }),
    )

    expect(result).toBe(true)      // 안전 필드 적용됐으므로 true
    expect(callbackCount).toBe(1)  // 콜백 호출됨
    expect(warnings.length).toBeGreaterThan(0) // 위험 필드 거부 경고
    expect(mgr.getConfig().embedDim).toBe(1024) // 위험 필드는 거부됨
    expect(mgr.getConfig().WARNING).toBe(7)     // 안전 필드는 적용됨
  })
})

// ── 8. 연속 reload에서도 위험 필드는 항상 거부된다 ────────────────────────────

describe('Sub-AC 5.3: 연속 reload에서 위험 필드 항상 거부', () => {
  test('embedDim을 여러 번 변경 시도해도 항상 이전 값(1024)이 유지된다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { embedDim: 1024 },
    })
    const mgr = ConfigManager.fromConfig(initial)

    for (const dim of [512, 256, 768, 2048]) {
      mgr.reload(
        makeLoopBreakerConfig({
          detector: { embedDim: dim, WARNING: 8 },
        }),
      )
      expect(mgr.getConfig().embedDim).toBe(1024)
    }
  })

  test('judgeModelId를 여러 번 변경 시도해도 항상 초기 값이 유지된다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { judgeModelId: 'claude-3-5-sonnet-20241022' },
    })
    const mgr = ConfigManager.fromConfig(initial)

    const models = [
      'claude-3-opus-20240229',
      'claude-3-haiku-20240307',
      'claude-3-5-haiku-20241022',
    ]

    for (const model of models) {
      mgr.reload(
        makeLoopBreakerConfig({
          detector: { judgeModelId: model, WARNING: 8 },
        }),
      )
      expect(mgr.getConfig().judgeModelId).toBe('claude-3-5-sonnet-20241022')
    }
  })

  test('watch.sessionGlob을 여러 번 변경 시도해도 항상 초기 값이 유지된다', () => {
    const initial = makeLoopBreakerConfig({
      watch: { sessionGlob: '~/.claude/projects/**/*.jsonl' },
    })
    const mgr = ConfigManager.fromConfig(initial)

    const globs = [
      '/custom/path/**/*.jsonl',
      '/tmp/sessions/**/*.jsonl',
      '~/other/**/*.jsonl',
    ]

    let warnNum = 8
    for (const glob of globs) {
      mgr.reload(
        makeLoopBreakerConfig({
          watch: { sessionGlob: glob },
          detector: { WARNING: warnNum++ },
        }),
      )
      expect(mgr.getLoopBreakerConfig().watch.sessionGlob).toBe(
        '~/.claude/projects/**/*.jsonl',
      )
    }
  })

  test('연속 reload 중 안전 필드는 매번 업데이트되고 위험 필드는 매번 거부된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: {
        embedDim: 1024,
        embedModelId: 'voyage-3-lite',
        WARNING: 10,
      },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const warningValues = [7, 8, 9]
    for (const w of warningValues) {
      mgr.reload(
        makeLoopBreakerConfig({
          detector: {
            embedDim: 512,          // 위험 — 거부
            embedModelId: 'other-model', // 위험 — 거부
            WARNING: w,             // 안전 — 적용
          },
        }),
      )
    }

    // 위험 필드는 여전히 초기 값
    expect(mgr.getConfig().embedDim).toBe(1024)
    expect(mgr.getConfig().embedModelId).toBe('voyage-3-lite')
    // 안전 필드는 마지막 reload 값
    expect(mgr.getConfig().WARNING).toBe(9)
    // 매 reload마다 경고가 발생했어야 함
    expect(warnings.length).toBe(warningValues.length)
  })
})

// ── 9. 경고 메시지 내용 검증 ────────────────────────────────────────────────

describe('Sub-AC 5.3: 경고 메시지 내용 검증', () => {
  test('경고 msg 문자열이 위험 필드 관련 내용을 포함한다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { embedDim: 1024 },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: { embedDim: 512, WARNING: 8 },
      }),
    )

    expect(warnings.length).toBeGreaterThan(0)
    // 위험 필드 관련 경고여야 함
    const msg = warnings[0].msg
    expect(typeof msg).toBe('string')
    expect(msg.length).toBeGreaterThan(0)
    // 경고에 "위험", "거부", "재기동" 중 하나 이상 포함 (한국어 경고 메시지)
    expect(msg).toMatch(/위험|거부|재기동/)
  })

  test('경고 extra.changedFields가 배열이고 최소 1개 이상의 위험 필드명을 담는다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { embedDim: 1024 },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: { embedDim: 512, WARNING: 8 },
      }),
    )

    expect(warnings.length).toBeGreaterThan(0)
    const changedFields = warnings[0]?.extra?.changedFields
    expect(Array.isArray(changedFields)).toBe(true)
    expect((changedFields as string[]).length).toBeGreaterThan(0)
    // 필드명 형식: 'section.fieldName'
    const fieldNames = changedFields as string[]
    for (const f of fieldNames) {
      expect(f).toMatch(/^(detector|watch)\./)
    }
  })

  test('위험 필드 미변경 시 위험 필드 거부 경고가 발생하지 않는다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: {
        embedDim: 1024,
        embedModelId: 'voyage-3-lite',
        judgeModelId: 'claude-3-5-sonnet-20241022',
        WARNING: 10,
      },
      watch: { sessionGlob: '~/.claude/projects/**/*.jsonl' },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    // 안전 필드만 변경 (위험 필드는 그대로)
    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          embedDim: 1024,
          embedModelId: 'voyage-3-lite',
          judgeModelId: 'claude-3-5-sonnet-20241022',
          WARNING: 7,           // 안전 필드만 변경
          CRITICAL: 15,         // 안전 필드만 변경
        },
        watch: { sessionGlob: '~/.claude/projects/**/*.jsonl' },
      }),
    )

    // 위험 필드 변경 없으므로 경고 없음
    const dangerWarnings = warnings.filter((w) => w.msg.match(/위험 필드/))
    expect(dangerWarnings.length).toBe(0)
  })

  test('DEFAULT 값으로부터 구성된 ConfigManager에서 DEFAULT와 동일한 위험 필드 값으로 reload 시 경고 없음', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial, logger)

    // 위험 필드를 DEFAULT와 동일한 값으로 reload
    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          embedDim: DEFAULT_DETECTOR_CONFIG.embedDim,
          embedModelId: DEFAULT_DETECTOR_CONFIG.embedModelId,
          judgeModelId: DEFAULT_DETECTOR_CONFIG.judgeModelId,
          WARNING: 7, // 안전 필드 변경
        },
      }),
    )

    // 위험 필드가 변경되지 않았으므로 경고 없음
    const dangerWarnings = warnings.filter((w) => w.msg.match(/위험 필드/))
    expect(dangerWarnings.length).toBe(0)
  })
})

// ── 10. getConfig() 반환 값이 DEFAULT_DETECTOR_CONFIG 기본값 불변 확인 ────────

describe('Sub-AC 5.3: 위험 필드 거부 후 DEFAULT_DETECTOR_CONFIG 불변 확인', () => {
  test('위험 필드 거부 후에도 DEFAULT_DETECTOR_CONFIG가 불변 상태다', () => {
    const initial = makeLoopBreakerConfig({
      detector: {
        embedDim: 1024,
        embedModelId: 'voyage-3-lite',
        judgeModelId: 'claude-3-5-sonnet-20241022',
      },
    })
    const mgr = ConfigManager.fromConfig(initial)

    mgr.reload(
      makeLoopBreakerConfig({
        detector: {
          embedDim: 512,
          embedModelId: 'text-embedding-3-large',
          judgeModelId: 'claude-3-opus-20240229',
          WARNING: 8,
        },
      }),
    )

    // DEFAULT_DETECTOR_CONFIG는 여전히 동결 상태이고 값 불변
    expect(Object.isFrozen(DEFAULT_DETECTOR_CONFIG)).toBe(true)
    expect(DEFAULT_DETECTOR_CONFIG.embedDim).toBe(1024)
    expect(DEFAULT_DETECTOR_CONFIG.embedModelId).toBe('voyage-3-lite')
    expect(DEFAULT_DETECTOR_CONFIG.judgeModelId).toBe('claude-3-5-sonnet-20241022')
  })
})
