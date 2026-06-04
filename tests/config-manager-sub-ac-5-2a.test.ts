// tests/config-manager-sub-ac-5-2a.test.ts
//
// Sub-AC 5.2a: ConfigManager.onReload(next)가 threshold(임계값) 필드 변경을 무중단으로 적용한다.
//
// 검증 항목:
//   1. onReload 콜백에 새 threshold 값을 가진 config를 전달했을 때,
//      getConfig()가 즉시 새 값을 반환한다
//   2. 내부 상태가 서비스 재시작 없이 갱신된다
//   3. 등록된 onReload 콜백이 새 DetectorConfig를 인자로 호출된다
//   4. 위험 필드(embedDim, embedModelId, judgeModelId, sessionGlob) 변경은 거부된다
//   5. 재검증 실패 시 이전 설정이 유지된다
//   6. DEFAULT_DETECTOR_CONFIG는 변경되지 않는다 (불변 보장)
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

/** 경고 메시지를 수집하는 Mock 로거 */
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

// ── 1. 기본 동작: threshold 변경이 무중단으로 적용된다 ──────────────────────

describe('Sub-AC 5.2a: onReload — threshold 변경 무중단 적용', () => {
  test('WARNING 임계값 변경 시 getConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getConfig().WARNING).toBe(10)

    const next = makeLoopBreakerConfig({ detector: { WARNING: 5 } })
    mgr.reload(next)

    expect(mgr.getConfig().WARNING).toBe(5)
  })

  test('CRITICAL 임계값 변경 시 getConfig()가 즉시 새 값을 반환한다', () => {
    const initial = makeLoopBreakerConfig({ detector: { CRITICAL: 20 } })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { CRITICAL: 15 } })
    mgr.reload(next)

    expect(mgr.getConfig().CRITICAL).toBe(15)
  })

  test('circuitBreaker 임계값 변경이 즉시 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getConfig().circuitBreaker).toBe(DEFAULT_DETECTOR_CONFIG.circuitBreaker)

    const next = makeLoopBreakerConfig({ detector: { circuitBreaker: 50 } })
    mgr.reload(next)

    expect(mgr.getConfig().circuitBreaker).toBe(50)
  })

  test('errLoopWarn 임계값 변경이 즉시 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { errLoopWarn: 7 } })
    mgr.reload(next)

    expect(mgr.getConfig().errLoopWarn).toBe(7)
  })

  test('errLoopCrit 임계값 변경이 즉시 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { errLoopCrit: 10 } })
    mgr.reload(next)

    expect(mgr.getConfig().errLoopCrit).toBe(10)
  })

  test('fileEditWarn 임계값 변경이 즉시 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { fileEditWarn: 3 } })
    mgr.reload(next)

    expect(mgr.getConfig().fileEditWarn).toBe(3)
  })

  test('fileEditCrit 임계값 변경이 즉시 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { fileEditCrit: 12 } })
    mgr.reload(next)

    expect(mgr.getConfig().fileEditCrit).toBe(12)
  })

  test('simThresh 의미 게이트 임계값 변경이 즉시 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { simThresh: 0.85 } })
    mgr.reload(next)

    expect(mgr.getConfig().simThresh).toBe(0.85)
  })

  test('decideThresh 의미 게이트 임계값 변경이 즉시 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { decideThresh: 0.6 } })
    mgr.reload(next)

    expect(mgr.getConfig().decideThresh).toBe(0.6)
  })

  test('selfApprovalMs 가짜성공 프로브 임계값 변경이 즉시 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { selfApprovalMs: 30000 } })
    mgr.reload(next)

    expect(mgr.getConfig().selfApprovalMs).toBe(30000)
  })

  test('selfApprovalCriticalMs 변경이 즉시 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { selfApprovalCriticalMs: 2000 } })
    mgr.reload(next)

    expect(mgr.getConfig().selfApprovalCriticalMs).toBe(2000)
  })

  test('notifyDebounceMs 알림 설정 변경이 즉시 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { notifyDebounceMs: 30000 } })
    mgr.reload(next)

    expect(mgr.getConfig().notifyDebounceMs).toBe(30000)
  })

  test('notifyChannels 변경이 즉시 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { notifyChannels: ['cli'] } })
    mgr.reload(next)

    expect(mgr.getConfig().notifyChannels).toEqual(['cli'])
  })

  test('lowConfidenceNotify 변경이 즉시 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { lowConfidenceNotify: true } })
    mgr.reload(next)

    expect(mgr.getConfig().lowConfidenceNotify).toBe(true)
  })

  test('여러 threshold 필드를 한 번에 변경할 수 있다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      detector: {
        WARNING: 8,
        CRITICAL: 16,
        circuitBreaker: 40,
        simThresh: 0.88,
        decideThresh: 0.65,
        notifyDebounceMs: 45000,
      },
    })
    mgr.reload(next)

    const cfg = mgr.getConfig()
    expect(cfg.WARNING).toBe(8)
    expect(cfg.CRITICAL).toBe(16)
    expect(cfg.circuitBreaker).toBe(40)
    expect(cfg.simThresh).toBe(0.88)
    expect(cfg.decideThresh).toBe(0.65)
    expect(cfg.notifyDebounceMs).toBe(45000)
  })
})

// ── 2. onReload 콜백이 새 DetectorConfig를 받는다 ────────────────────────────

describe('Sub-AC 5.2a: onReload 콜백 호출 검증', () => {
  test('onReload 콜백 등록 후 reload 시 콜백이 호출된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    let callbackCalled = false
    let receivedConfig: DetectorConfig | null = null

    mgr.onReload((next) => {
      callbackCalled = true
      receivedConfig = next
    })

    const next = makeLoopBreakerConfig({ detector: { WARNING: 7 } })
    mgr.reload(next)

    expect(callbackCalled).toBe(true)
    expect(receivedConfig).not.toBeNull()
    expect(receivedConfig!.WARNING).toBe(7)
  })

  test('콜백이 받은 DetectorConfig는 getConfig()와 동일한 객체다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    let callbackConfig: DetectorConfig | null = null
    mgr.onReload((next) => { callbackConfig = next })

    const next = makeLoopBreakerConfig({ detector: { CRITICAL: 18 } })
    mgr.reload(next)

    expect(callbackConfig).toBe(mgr.getConfig())
  })

  test('여러 onReload 콜백이 모두 호출된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const calls: number[] = []
    mgr.onReload(() => calls.push(1))
    mgr.onReload(() => calls.push(2))
    mgr.onReload(() => calls.push(3))

    const next = makeLoopBreakerConfig({ detector: { WARNING: 5 } })
    mgr.reload(next)

    expect(calls).toEqual([1, 2, 3])
  })

  test('콜백이 예외를 throw해도 다른 콜백과 reload 자체가 계속된다', () => {
    const { logger } = makeLogger()
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial, logger)

    let secondCalled = false
    mgr.onReload(() => { throw new Error('콜백 실패') })
    mgr.onReload(() => { secondCalled = true })

    const next = makeLoopBreakerConfig({ detector: { WARNING: 5 } })
    expect(() => mgr.reload(next)).not.toThrow()
    expect(secondCalled).toBe(true)
    // getConfig()는 여전히 새 값 반환
    expect(mgr.getConfig().WARNING).toBe(5)
  })

  test('콜백이 없어도 reload가 정상 동작한다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { WARNING: 3 } })
    expect(() => mgr.reload(next)).not.toThrow()
    expect(mgr.getConfig().WARNING).toBe(3)
  })
})

// ── 3. 위험 필드 변경 거부 ────────────────────────────────────────────────────

describe('Sub-AC 5.2a: 위험 필드 변경 거부 + 안전 필드 적용', () => {
  test('embedDim 변경은 로그 경고를 남기지만 실제 값에는 반영되지 않는다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({ detector: { embedDim: 1024 } })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const next = makeLoopBreakerConfig({ detector: { embedDim: 512 } })
    mgr.reload(next)

    // 경고 로그가 발생했는지 확인
    expect(warnings.some((w) => w.msg.includes('위험 필드'))).toBe(true)
    // embedDim은 이전 값 유지
    expect(mgr.getConfig().embedDim).toBe(1024)
  })

  test('embedModelId 변경은 거부되어 이전 값이 유지된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { embedModelId: 'voyage-3-lite' },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const next = makeLoopBreakerConfig({
      detector: { embedModelId: 'text-embedding-3-small' },
    })
    mgr.reload(next)

    expect(warnings.some((w) => w.msg.includes('위험 필드'))).toBe(true)
    expect(mgr.getConfig().embedModelId).toBe('voyage-3-lite')
  })

  test('judgeModelId 변경은 거부되어 이전 값이 유지된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { judgeModelId: 'claude-3-5-sonnet-20241022' },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const next = makeLoopBreakerConfig({
      detector: { judgeModelId: 'claude-3-7-sonnet-20250219' },
    })
    mgr.reload(next)

    expect(warnings.some((w) => w.msg.includes('위험 필드'))).toBe(true)
    expect(mgr.getConfig().judgeModelId).toBe('claude-3-5-sonnet-20241022')
  })

  test('위험 필드 변경 시에도 안전 필드는 무중단 적용된다', () => {
    const { logger } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: { WARNING: 10, embedDim: 1024 },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    // 위험 필드 + 안전 필드 동시 변경
    const next = makeLoopBreakerConfig({
      detector: { WARNING: 5, embedDim: 512 },
    })
    mgr.reload(next)

    // 안전 필드(WARNING)는 적용됨
    expect(mgr.getConfig().WARNING).toBe(5)
    // 위험 필드(embedDim)는 이전 값 유지
    expect(mgr.getConfig().embedDim).toBe(1024)
  })

  test('watch.sessionGlob 변경은 거부되어 이전 값이 유지된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      watch: { sessionGlob: '~/.claude/projects/**/*.jsonl' },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const next = makeLoopBreakerConfig({
      watch: { sessionGlob: '/custom/path/**/*.jsonl' },
    })
    mgr.reload(next)

    expect(warnings.some((w) => w.msg.includes('위험 필드'))).toBe(true)
    // sessionGlob은 LoopBreakerConfig에서 확인 (DetectorConfig에는 없음)
    expect(mgr.getLoopBreakerConfig().watch.sessionGlob).toBe(
      '~/.claude/projects/**/*.jsonl',
    )
  })
})

// ── 4. 재검증 실패 시 이전 설정 유지 ────────────────────────────────────────

describe('Sub-AC 5.2a: 재검증 실패 시 이전 설정 유지', () => {
  test('잘못된 raw 객체(zod 검증 실패)는 이전 설정을 유지한다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const originalConfig = mgr.getConfig()

    // 잘못된 raw (version 누락, 검증 실패 예상)
    const invalid = { version: 2, detector: { WARNING: 5 } }
    const result = mgr.reload(invalid)

    expect(result).toBe(false)
    expect(warnings.some((w) => w.msg.includes('검증 실패'))).toBe(true)
    // 이전 설정 유지
    expect(mgr.getConfig()).toBe(originalConfig)
    expect(mgr.getConfig().WARNING).toBe(10)
  })

  test('null 입력은 검증 실패로 처리되어 이전 설정을 유지한다', () => {
    const initial = makeLoopBreakerConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial)

    const result = mgr.reload(null)
    expect(result).toBe(false)
    expect(mgr.getConfig().WARNING).toBe(10)
  })

  test('빈 객체 입력은 검증 실패로 처리된다 (version 필드 누락)', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const result = mgr.reload({})
    expect(result).toBe(false)
  })

  test('재검증 실패 시 onReload 콜백이 호출되지 않는다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    let callbackCalled = false
    mgr.onReload(() => { callbackCalled = true })

    mgr.reload({ invalid: true })
    expect(callbackCalled).toBe(false)
  })
})

// ── 5. DEFAULT_DETECTOR_CONFIG 불변 보장 ─────────────────────────────────────

describe('Sub-AC 5.2a: reload 후 DEFAULT_DETECTOR_CONFIG 불변 유지', () => {
  test('reload 후 DEFAULT_DETECTOR_CONFIG.WARNING은 10으로 유지된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { WARNING: 99 } })
    mgr.reload(next)

    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10)
  })

  test('여러 번 reload 후에도 DEFAULT_DETECTOR_CONFIG는 불변이다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    for (let i = 0; i < 5; i++) {
      const next = makeLoopBreakerConfig({
        detector: { WARNING: i + 1, CRITICAL: i + 2 },
      })
      mgr.reload(next)
    }

    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10)
    expect(DEFAULT_DETECTOR_CONFIG.CRITICAL).toBe(20)
    expect(DEFAULT_DETECTOR_CONFIG.circuitBreaker).toBe(30)
    expect(Object.isFrozen(DEFAULT_DETECTOR_CONFIG)).toBe(true)
  })

  test('reload 후 getConfig()가 반환하는 객체는 DEFAULT_DETECTOR_CONFIG와 다른 참조다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { WARNING: 5 } })
    mgr.reload(next)

    expect(mgr.getConfig()).not.toBe(DEFAULT_DETECTOR_CONFIG)
  })
})

// ── 6. 서비스 재시작 없이 상태가 갱신됨을 단위 테스트로 검증 ─────────────────

describe('Sub-AC 5.2a: 서비스 재시작 없이 내부 상태 갱신', () => {
  test('동일 ConfigManager 인스턴스로 연속 reload가 가능하다', () => {
    const initial = makeLoopBreakerConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial)

    // 1차 reload
    const next1 = makeLoopBreakerConfig({ detector: { WARNING: 8 } })
    mgr.reload(next1)
    expect(mgr.getConfig().WARNING).toBe(8)

    // 2차 reload
    const next2 = makeLoopBreakerConfig({ detector: { WARNING: 5 } })
    mgr.reload(next2)
    expect(mgr.getConfig().WARNING).toBe(5)

    // 3차 reload (원래 값으로)
    const next3 = makeLoopBreakerConfig({ detector: { WARNING: 10 } })
    mgr.reload(next3)
    expect(mgr.getConfig().WARNING).toBe(10)
  })

  test('reload는 새 인스턴스를 생성하지 않고 기존 인스턴스 상태를 갱신한다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)
    const mgrRef = mgr

    const next = makeLoopBreakerConfig({ detector: { WARNING: 5 } })
    mgr.reload(next)

    // 동일 인스턴스 (재시작 없음)
    expect(mgr).toBe(mgrRef)
    expect(mgr.getConfig().WARNING).toBe(5)
  })

  test('reload 반환값이 true이면 안전 필드 변경이 적용됐음을 나타낸다', () => {
    const initial = makeLoopBreakerConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({ detector: { WARNING: 5 } })
    const result = mgr.reload(next)

    expect(result).toBe(true)
  })

  test('reload 반환값이 false이면 변경 없음이나 실패를 나타낸다', () => {
    const initial = makeLoopBreakerConfig({ detector: { WARNING: 10 } })
    const mgr = ConfigManager.fromConfig(initial)

    // 동일한 config로 reload → 변경 없음
    const same = makeLoopBreakerConfig({ detector: { WARNING: 10 } })
    const result = mgr.reload(same)

    expect(result).toBe(false)
  })

  test('historySize 변경이 즉시 반영된다 (내부 상태 갱신)', () => {
    const initial = makeLoopBreakerConfig({ detector: { historySize: 30 } })
    const mgr = ConfigManager.fromConfig(initial)

    expect(mgr.getConfig().historySize).toBe(30)

    const next = makeLoopBreakerConfig({ detector: { historySize: 50 } })
    mgr.reload(next)

    expect(mgr.getConfig().historySize).toBe(50)
  })
})
