// tests/config-manager-sub-ac-5-1c.test.ts
//
// Sub-AC 5.1c: DEFAULT_DETECTOR_CONFIG 불변 보장 + toDetectorConfig() 기본값 사용 검증.
//
// 검증 항목:
//   1. DEFAULT_DETECTOR_CONFIG가 Object.freeze로 동결되어 있다 (런타임 불변성)
//   2. 동결된 객체의 직접 변경 시도가 strict mode에서 TypeError를 throw한다
//   3. notifyChannels 배열도 동결되어 있다 (중첩 동결)
//   4. toDetectorConfig()가 누락된 선택적 필드에 DEFAULT_DETECTOR_CONFIG 기본값을 사용한다
//   5. toDetectorConfig()는 DEFAULT_DETECTOR_CONFIG 자체를 변경하지 않는다
//
// 부수효과 없음: 실제 파일 I/O 없음, 임시 tmpdir 경로만 사용.

import { DEFAULT_DETECTOR_CONFIG, type DetectorConfig } from '../src/contracts.js'
import { toDetectorConfig } from '../src/config/config-loader.js'
import { loopBreakerConfigSchema, type LoopBreakerConfig } from '../src/config/config-schema.js'

// 최소 유효 LoopBreakerConfig를 zod로 빌드하는 헬퍼
function makeConfig(overrides?: {
  detector?: Record<string, unknown>
  notify?: Record<string, unknown>
}): LoopBreakerConfig {
  return loopBreakerConfigSchema.parse({
    version: 1,
    detector: overrides?.detector ?? {},
    privacy: {},
    api: {},
    watch: {},
    webhook: {},
    notify: overrides?.notify ?? {},
  })
}

// ── 1. Object.freeze 런타임 불변성 보장 ─────────────────────────────────────

describe('Sub-AC 5.1c: DEFAULT_DETECTOR_CONFIG Object.freeze 런타임 불변성', () => {
  test('DEFAULT_DETECTOR_CONFIG는 Object.isFrozen()이 true를 반환한다', () => {
    expect(Object.isFrozen(DEFAULT_DETECTOR_CONFIG)).toBe(true)
  })

  test('notifyChannels 배열도 Object.isFrozen()이 true를 반환한다 (중첩 동결)', () => {
    expect(Object.isFrozen(DEFAULT_DETECTOR_CONFIG.notifyChannels)).toBe(true)
  })

  test('동결된 객체에 새 프로퍼티 추가 시도는 strict mode에서 TypeError를 throw한다', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(DEFAULT_DETECTOR_CONFIG as any).newProp = 'value'
    }).toThrow(TypeError)
  })

  test('동결된 객체의 기존 프로퍼티 변경 시도는 strict mode에서 TypeError를 throw한다', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(DEFAULT_DETECTOR_CONFIG as any).WARNING = 999
    }).toThrow(TypeError)
  })

  test('동결된 notifyChannels 배열 변경 시도는 strict mode에서 TypeError를 throw한다', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(DEFAULT_DETECTOR_CONFIG.notifyChannels as any).push('webhook')
    }).toThrow(TypeError)
  })

  test('동결된 notifyChannels 배열 인덱스 변경 시도는 strict mode에서 TypeError를 throw한다', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(DEFAULT_DETECTOR_CONFIG.notifyChannels as any)[0] = 'webhook'
    }).toThrow(TypeError)
  })

  test('동결 후 WARNING 기본값 10이 유지된다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10)
  })

  test('동결 후 CRITICAL 기본값 20이 유지된다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.CRITICAL).toBe(20)
  })

  test('동결 후 circuitBreaker 기본값 30이 유지된다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.circuitBreaker).toBe(30)
  })

  test('동결 후 embedModelId 기본값 "voyage-3-lite"가 유지된다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.embedModelId).toBe('voyage-3-lite')
  })

  test('동결 후 judgeModelId 기본값 "claude-3-5-sonnet-20241022"가 유지된다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.judgeModelId).toBe('claude-3-5-sonnet-20241022')
  })

  test('동결 후 notifyDebounceMs 기본값 60000이 유지된다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs).toBe(60000)
  })

  test('동결 후 lowConfidenceNotify 기본값 false가 유지된다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.lowConfidenceNotify).toBe(false)
  })

  test('동결 후 webhookUrl 기본값 undefined가 유지된다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.webhookUrl).toBeUndefined()
  })
})

// ── 2. toDetectorConfig() 누락 선택적 필드 → DEFAULT_DETECTOR_CONFIG 기본값 사용 ──

describe('Sub-AC 5.1c: toDetectorConfig() 누락 필드에 DEFAULT_DETECTOR_CONFIG 기본값 사용', () => {
  test('빈 detector 설정 → 모든 필드가 DEFAULT_DETECTOR_CONFIG 값과 일치한다', () => {
    const config = makeConfig()
    const flat = toDetectorConfig(config)

    // 구조 게이트 임계값
    expect(flat.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING)
    expect(flat.CRITICAL).toBe(DEFAULT_DETECTOR_CONFIG.CRITICAL)
    expect(flat.circuitBreaker).toBe(DEFAULT_DETECTOR_CONFIG.circuitBreaker)
    expect(flat.historySize).toBe(DEFAULT_DETECTOR_CONFIG.historySize)
    expect(flat.errLoopWarn).toBe(DEFAULT_DETECTOR_CONFIG.errLoopWarn)
    expect(flat.errLoopCrit).toBe(DEFAULT_DETECTOR_CONFIG.errLoopCrit)
    expect(flat.fileEditWarn).toBe(DEFAULT_DETECTOR_CONFIG.fileEditWarn)
    expect(flat.fileEditCrit).toBe(DEFAULT_DETECTOR_CONFIG.fileEditCrit)
    // 의미 게이트
    expect(flat.simThresh).toBe(DEFAULT_DETECTOR_CONFIG.simThresh)
    expect(flat.decideThresh).toBe(DEFAULT_DETECTOR_CONFIG.decideThresh)
    // 가짜성공 프로브
    expect(flat.selfApprovalMs).toBe(DEFAULT_DETECTOR_CONFIG.selfApprovalMs)
    expect(flat.selfApprovalCriticalMs).toBe(DEFAULT_DETECTOR_CONFIG.selfApprovalCriticalMs)
    // judge
    expect(flat.judgeSelfConsistencyN).toBe(DEFAULT_DETECTOR_CONFIG.judgeSelfConsistencyN)
    expect(flat.judgePositionSwaps).toBe(DEFAULT_DETECTOR_CONFIG.judgePositionSwaps)
    // 모델
    expect(flat.embedModelId).toBe(DEFAULT_DETECTOR_CONFIG.embedModelId)
    expect(flat.judgeModelId).toBe(DEFAULT_DETECTOR_CONFIG.judgeModelId)
    expect(flat.embedDim).toBe(DEFAULT_DETECTOR_CONFIG.embedDim)
    // 알림
    expect(flat.notifyDebounceMs).toBe(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs)
    expect(flat.notifyChannels).toEqual(DEFAULT_DETECTOR_CONFIG.notifyChannels)
    expect(flat.webhookUrl).toBeUndefined()
    expect(flat.lowConfidenceNotify).toBe(DEFAULT_DETECTOR_CONFIG.lowConfidenceNotify)
  })

  test('WARNING만 지정하고 나머지 필드는 DEFAULT_DETECTOR_CONFIG 기본값을 사용한다', () => {
    const config = makeConfig({ detector: { WARNING: 5 } })
    const flat = toDetectorConfig(config)

    expect(flat.WARNING).toBe(5) // 명시된 값
    expect(flat.CRITICAL).toBe(DEFAULT_DETECTOR_CONFIG.CRITICAL) // 기본값
    expect(flat.circuitBreaker).toBe(DEFAULT_DETECTOR_CONFIG.circuitBreaker) // 기본값
    expect(flat.simThresh).toBe(DEFAULT_DETECTOR_CONFIG.simThresh) // 기본값
    expect(flat.embedModelId).toBe(DEFAULT_DETECTOR_CONFIG.embedModelId) // 기본값
    expect(flat.notifyDebounceMs).toBe(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs) // 기본값
    expect(flat.lowConfidenceNotify).toBe(DEFAULT_DETECTOR_CONFIG.lowConfidenceNotify) // 기본값
  })

  test('embedDim만 지정하고 나머지 필드는 DEFAULT_DETECTOR_CONFIG 기본값을 사용한다', () => {
    const config = makeConfig({ detector: { embedDim: 512 } })
    const flat = toDetectorConfig(config)

    expect(flat.embedDim).toBe(512) // 명시된 값
    expect(flat.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING) // 기본값
    expect(flat.embedModelId).toBe(DEFAULT_DETECTOR_CONFIG.embedModelId) // 기본값
    expect(flat.judgeModelId).toBe(DEFAULT_DETECTOR_CONFIG.judgeModelId) // 기본값
    expect(flat.notifyChannels).toEqual(DEFAULT_DETECTOR_CONFIG.notifyChannels) // 기본값
  })

  test('notifyChannels만 지정하고 나머지 알림 필드는 DEFAULT_DETECTOR_CONFIG 기본값을 사용한다', () => {
    const config = makeConfig({ detector: { notifyChannels: ['cli'] } })
    const flat = toDetectorConfig(config)

    expect(flat.notifyChannels).toEqual(['cli']) // 명시된 값
    expect(flat.notifyDebounceMs).toBe(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs) // 기본값
    expect(flat.lowConfidenceNotify).toBe(DEFAULT_DETECTOR_CONFIG.lowConfidenceNotify) // 기본값
    expect(flat.webhookUrl).toBeUndefined() // 기본값
  })

  test('lowConfidenceNotify만 true로 지정하고 나머지는 기본값을 사용한다', () => {
    const config = makeConfig({ detector: { lowConfidenceNotify: true } })
    const flat = toDetectorConfig(config)

    expect(flat.lowConfidenceNotify).toBe(true) // 명시된 값
    expect(flat.notifyDebounceMs).toBe(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs) // 기본값
    expect(flat.notifyChannels).toEqual(DEFAULT_DETECTOR_CONFIG.notifyChannels) // 기본값
    expect(flat.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING) // 기본값
  })

  test('notify.notifyDebounceMs 누락 시 DEFAULT_DETECTOR_CONFIG.notifyDebounceMs(60000)를 사용한다', () => {
    const config = makeConfig() // notify도 기본값
    const flat = toDetectorConfig(config)

    expect(flat.notifyDebounceMs).toBe(60000)
    expect(flat.notifyDebounceMs).toBe(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs)
  })

  test('selfApprovalCriticalMs 누락 시 DEFAULT_DETECTOR_CONFIG 기본값 1000을 사용한다', () => {
    const config = makeConfig({ detector: { selfApprovalMs: 30000 } }) // selfApprovalCriticalMs 누락
    const flat = toDetectorConfig(config)

    expect(flat.selfApprovalMs).toBe(30000) // 명시된 값
    expect(flat.selfApprovalCriticalMs).toBe(DEFAULT_DETECTOR_CONFIG.selfApprovalCriticalMs) // 기본값 1000
    expect(flat.selfApprovalCriticalMs).toBe(1000)
  })
})

// ── 3. toDetectorConfig() 호출 후 DEFAULT_DETECTOR_CONFIG 불변 보장 ────────────

describe('Sub-AC 5.1c: toDetectorConfig() 호출 후 DEFAULT_DETECTOR_CONFIG 불변 유지', () => {
  test('toDetectorConfig() 호출 후 WARNING 기본값 10이 변경되지 않는다', () => {
    const config = makeConfig({ detector: { WARNING: 99 } })
    toDetectorConfig(config)
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10)
  })

  test('toDetectorConfig() 호출 후 notifyChannels 기본값이 변경되지 않는다', () => {
    const config = makeConfig({ detector: { notifyChannels: ['webhook'] } })
    toDetectorConfig(config)
    expect(DEFAULT_DETECTOR_CONFIG.notifyChannels).toEqual(['desktop', 'cli'])
    expect(DEFAULT_DETECTOR_CONFIG.notifyChannels).toHaveLength(2)
  })

  test('toDetectorConfig()를 여러 번 호출해도 DEFAULT_DETECTOR_CONFIG는 불변이다', () => {
    for (let i = 0; i < 5; i++) {
      const config = makeConfig({
        detector: { WARNING: i + 1, CRITICAL: i + 2 },
        notify: { notifyDebounceMs: (i + 1) * 10000 },
      })
      toDetectorConfig(config)
    }

    // 여러 번 호출 후에도 기본값 동결 유지
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10)
    expect(DEFAULT_DETECTOR_CONFIG.CRITICAL).toBe(20)
    expect(DEFAULT_DETECTOR_CONFIG.circuitBreaker).toBe(30)
    expect(DEFAULT_DETECTOR_CONFIG.historySize).toBe(30)
    expect(DEFAULT_DETECTOR_CONFIG.errLoopWarn).toBe(3)
    expect(DEFAULT_DETECTOR_CONFIG.errLoopCrit).toBe(5)
    expect(DEFAULT_DETECTOR_CONFIG.fileEditWarn).toBe(5)
    expect(DEFAULT_DETECTOR_CONFIG.fileEditCrit).toBe(8)
    expect(DEFAULT_DETECTOR_CONFIG.simThresh).toBe(0.90)
    expect(DEFAULT_DETECTOR_CONFIG.decideThresh).toBe(0.7)
    expect(DEFAULT_DETECTOR_CONFIG.selfApprovalMs).toBe(15000)
    expect(DEFAULT_DETECTOR_CONFIG.selfApprovalCriticalMs).toBe(1000)
    expect(DEFAULT_DETECTOR_CONFIG.judgeSelfConsistencyN).toBe(1)
    expect(DEFAULT_DETECTOR_CONFIG.judgePositionSwaps).toBe(0)
    expect(DEFAULT_DETECTOR_CONFIG.embedModelId).toBe('voyage-3-lite')
    expect(DEFAULT_DETECTOR_CONFIG.judgeModelId).toBe('claude-3-5-sonnet-20241022')
    expect(DEFAULT_DETECTOR_CONFIG.embedDim).toBe(1024)
    expect(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs).toBe(60000)
    expect(DEFAULT_DETECTOR_CONFIG.lowConfidenceNotify).toBe(false)
    expect(Object.isFrozen(DEFAULT_DETECTOR_CONFIG)).toBe(true)
  })

  test('toDetectorConfig()가 반환하는 객체는 DEFAULT_DETECTOR_CONFIG와 다른 참조다', () => {
    const config = makeConfig()
    const flat = toDetectorConfig(config)

    expect(flat).not.toBe(DEFAULT_DETECTOR_CONFIG)
    expect(flat).not.toBe(config.detector)
  })

  test('반환된 DetectorConfig는 동결되지 않아 소비자가 새 객체로 오버라이드할 수 있다', () => {
    const config = makeConfig()
    const flat = toDetectorConfig(config)

    // 소비자는 스프레드로 새 객체 생성 가능 (DEFAULT_DETECTOR_CONFIG는 영향 없음)
    const overridden: DetectorConfig = { ...flat, WARNING: 999 }
    expect(overridden.WARNING).toBe(999)
    expect(flat.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING) // flat은 영향 없음
    expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10) // 기본값 불변
  })
})
