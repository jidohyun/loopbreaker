// tests/config-manager-sub-ac-5-2e.test.ts
//
// Sub-AC 5.2e: ConfigManager.onReload(next)가 복수의 안전필드를 동시에 변경할 때
//              모든 필드가 원자적으로 반영된다.
//
// 검증 항목:
//   1. 단일 onReload 호출로 여러 안전 필드를 한꺼번에 교체했을 때,
//      getConfig() 스냅샷에서 모든 필드가 새 값으로 일관되게 반영된다.
//   2. 부분 적용 상태(일부 필드는 이전 값, 일부는 새 값)가 관찰되지 않는다.
//   3. 콜백 내에서 읽은 getConfig()도 완전히 교체된 상태다.
//   4. 여러 콜백이 등록되어 있어도 각 콜백에서 읽는 값이 동일하게 일관된다.
//   5. 위험 필드가 섞여 있어도 안전 필드끼리는 원자적으로 반영된다.
//   6. 연속 reload에서 각 snapshot이 순서대로 원자적으로 전환된다.
//
// 부수효과 없음: 실제 파일 I/O 없음, 임시 tmpdir 경로만 사용.

import { ConfigManager } from '../src/config/config-manager.js'
import { DEFAULT_DETECTOR_CONFIG, type DetectorConfig } from '../src/contracts.js'
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

// ── 1. 복수 안전 필드의 원자적 반영 ─────────────────────────────────────────

describe('Sub-AC 5.2e: 복수 안전 필드 원자적 반영', () => {
  test('단일 reload 호출로 여러 detector 안전 필드가 동시에 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    // 기준값 확인
    expect(mgr.getConfig().WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING)
    expect(mgr.getConfig().CRITICAL).toBe(DEFAULT_DETECTOR_CONFIG.CRITICAL)
    expect(mgr.getConfig().simThresh).toBe(DEFAULT_DETECTOR_CONFIG.simThresh)
    expect(mgr.getConfig().decideThresh).toBe(DEFAULT_DETECTOR_CONFIG.decideThresh)
    expect(mgr.getConfig().notifyDebounceMs).toBe(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs)

    const next = makeLoopBreakerConfig({
      detector: {
        WARNING: 7,
        CRITICAL: 15,
        simThresh: 0.85,
        decideThresh: 0.6,
        notifyDebounceMs: 30000,
      },
    })
    const result = mgr.reload(next)

    expect(result).toBe(true)

    // 단일 getConfig() 스냅샷에서 모든 필드가 새 값으로 반영되어야 함
    const snap = mgr.getConfig()
    expect(snap.WARNING).toBe(7)
    expect(snap.CRITICAL).toBe(15)
    expect(snap.simThresh).toBe(0.85)
    expect(snap.decideThresh).toBe(0.6)
    expect(snap.notifyDebounceMs).toBe(30000)
  })

  test('단일 reload로 임계값 6개를 동시에 변경하면 모두 새 값으로 일관 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      detector: {
        WARNING: 8,
        CRITICAL: 16,
        circuitBreaker: 25,
        historySize: 20,
        errLoopWarn: 2,
        errLoopCrit: 4,
      },
    })
    mgr.reload(next)

    const snap = mgr.getConfig()
    expect(snap.WARNING).toBe(8)
    expect(snap.CRITICAL).toBe(16)
    expect(snap.circuitBreaker).toBe(25)
    expect(snap.historySize).toBe(20)
    expect(snap.errLoopWarn).toBe(2)
    expect(snap.errLoopCrit).toBe(4)
  })

  test('알림 관련 안전 필드(notifyDebounceMs, lowConfidenceNotify) 동시 변경이 원자적으로 반영된다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      detector: {
        WARNING: 9,
        notifyDebounceMs: 45000,
        lowConfidenceNotify: true,
        notifyChannels: ['desktop', 'cli'],
      },
    })
    mgr.reload(next)

    const snap = mgr.getConfig()
    expect(snap.notifyDebounceMs).toBe(45000)
    expect(snap.lowConfidenceNotify).toBe(true)
    expect(snap.notifyChannels).toEqual(['desktop', 'cli'])
  })
})

// ── 2. 부분 적용 상태가 관찰되지 않음 ────────────────────────────────────────

describe('Sub-AC 5.2e: 부분 적용 상태 관찰 불가', () => {
  test('reload 전후의 getConfig() 스냅샷은 중간 상태 없이 완전히 교체된다', () => {
    const initial = makeLoopBreakerConfig({
      detector: {
        WARNING: 10,
        CRITICAL: 20,
        simThresh: 0.90,
        decideThresh: 0.7,
      },
    })
    const mgr = ConfigManager.fromConfig(initial)

    // reload 전 스냅샷 캡처
    const before = mgr.getConfig()
    expect(before.WARNING).toBe(10)
    expect(before.CRITICAL).toBe(20)

    const next = makeLoopBreakerConfig({
      detector: {
        WARNING: 5,
        CRITICAL: 12,
        simThresh: 0.80,
        decideThresh: 0.5,
      },
    })
    mgr.reload(next)

    // reload 후 스냅샷 — 모든 필드가 새 값이어야 한다 (부분 적용 없음)
    const after = mgr.getConfig()
    expect(after.WARNING).toBe(5)
    expect(after.CRITICAL).toBe(12)
    expect(after.simThresh).toBe(0.80)
    expect(after.decideThresh).toBe(0.5)

    // 이전 스냅샷 before는 이전 값을 유지(스냅샷 독립성)
    expect(before.WARNING).toBe(10)
    expect(before.CRITICAL).toBe(20)
  })

  test('onReload 콜백 내에서 읽은 getConfig()가 이미 모든 필드가 새 값으로 교체된 상태다', () => {
    const initial = makeLoopBreakerConfig({
      detector: {
        WARNING: 10,
        CRITICAL: 20,
        errLoopWarn: 3,
        errLoopCrit: 5,
      },
    })
    const mgr = ConfigManager.fromConfig(initial)

    // 콜백 내에서 관찰된 스냅샷을 수집
    const snapshots: DetectorConfig[] = []
    mgr.onReload((_next) => {
      // 콜백 인자(_next)와 getConfig()는 동일해야 한다
      snapshots.push(mgr.getConfig())
    })

    const next = makeLoopBreakerConfig({
      detector: {
        WARNING: 7,
        CRITICAL: 14,
        errLoopWarn: 2,
        errLoopCrit: 4,
      },
    })
    mgr.reload(next)

    expect(snapshots).toHaveLength(1)
    const snap = snapshots[0]
    // 콜백 내 getConfig()에서도 모든 필드가 새 값
    expect(snap.WARNING).toBe(7)
    expect(snap.CRITICAL).toBe(14)
    expect(snap.errLoopWarn).toBe(2)
    expect(snap.errLoopCrit).toBe(4)
  })
})

// ── 3. 콜백 인자와 getConfig() 일관성 ────────────────────────────────────────

describe('Sub-AC 5.2e: 콜백 인자 vs getConfig() 일관성', () => {
  test('콜백으로 전달된 next DetectorConfig가 getConfig()와 동일한 값을 갖는다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    let callbackNext: DetectorConfig | null = null
    mgr.onReload((next) => {
      callbackNext = next
    })

    const newConfig = makeLoopBreakerConfig({
      detector: {
        WARNING: 6,
        CRITICAL: 13,
        fileEditWarn: 4,
        fileEditCrit: 7,
      },
    })
    mgr.reload(newConfig)

    expect(callbackNext).not.toBeNull()
    const fromGet = mgr.getConfig()

    // 콜백 인자와 getConfig() 결과가 동일한 필드 값을 가져야 한다
    expect(callbackNext!.WARNING).toBe(fromGet.WARNING)
    expect(callbackNext!.CRITICAL).toBe(fromGet.CRITICAL)
    expect(callbackNext!.fileEditWarn).toBe(fromGet.fileEditWarn)
    expect(callbackNext!.fileEditCrit).toBe(fromGet.fileEditCrit)
  })

  test('복수 콜백에서 각각 관찰한 getConfig() 스냅샷이 동일한 값이다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const observedSnapshots: DetectorConfig[] = []
    // 첫 번째 콜백
    mgr.onReload((_next) => {
      observedSnapshots.push(mgr.getConfig())
    })
    // 두 번째 콜백
    mgr.onReload((_next) => {
      observedSnapshots.push(mgr.getConfig())
    })
    // 세 번째 콜백
    mgr.onReload((_next) => {
      observedSnapshots.push(mgr.getConfig())
    })

    const next = makeLoopBreakerConfig({
      detector: {
        WARNING: 11,
        CRITICAL: 22,
        simThresh: 0.88,
        selfApprovalMs: 10000,
        selfApprovalCriticalMs: 500,
      },
    })
    mgr.reload(next)

    expect(observedSnapshots).toHaveLength(3)

    // 모든 콜백에서 동일한 값을 관찰해야 한다 (원자성)
    for (const snap of observedSnapshots) {
      expect(snap.WARNING).toBe(11)
      expect(snap.CRITICAL).toBe(22)
      expect(snap.simThresh).toBe(0.88)
      expect(snap.selfApprovalMs).toBe(10000)
      expect(snap.selfApprovalCriticalMs).toBe(500)
    }
  })
})

// ── 4. 위험 필드 혼재 시 안전 필드끼리의 원자적 반영 ──────────────────────────

describe('Sub-AC 5.2e: 위험 필드 혼재 시 안전 필드 원자적 반영', () => {
  test('위험 필드가 섞여 있어도 여러 안전 필드가 동시에 원자적으로 반영된다', () => {
    const { logger, warnings } = makeLogger()
    const initial = makeLoopBreakerConfig({
      detector: {
        WARNING: 10,
        CRITICAL: 20,
        simThresh: 0.90,
        embedDim: 1024,
        embedModelId: 'voyage-3-lite',
      },
    })
    const mgr = ConfigManager.fromConfig(initial, logger)

    const next = makeLoopBreakerConfig({
      detector: {
        WARNING: 6,            // 안전 필드 → 반영
        CRITICAL: 12,          // 안전 필드 → 반영
        simThresh: 0.82,       // 안전 필드 → 반영
        decideThresh: 0.55,    // 안전 필드 → 반영
        embedDim: 512,         // 위험 필드 → 거부
        embedModelId: 'text-embedding-3-large', // 위험 필드 → 거부
      },
    })
    mgr.reload(next)

    const snap = mgr.getConfig()

    // 안전 필드: 모두 새 값으로 원자적 반영
    expect(snap.WARNING).toBe(6)
    expect(snap.CRITICAL).toBe(12)
    expect(snap.simThresh).toBe(0.82)
    expect(snap.decideThresh).toBe(0.55)

    // 위험 필드: 이전 값 유지
    expect(snap.embedDim).toBe(1024)
    expect(snap.embedModelId).toBe('voyage-3-lite')

    // 위험 필드 거부 경고 로그가 발생해야 함
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0].msg).toMatch(/위험 필드/)
  })

  test('위험 필드 거부 시 안전 필드들 간에 부분 적용 없이 모두 일괄 반영된다', () => {
    const initial = makeLoopBreakerConfig({
      detector: {
        WARNING: 10,
        CRITICAL: 20,
        errLoopWarn: 3,
        errLoopCrit: 5,
        fileEditWarn: 5,
        fileEditCrit: 8,
        judgeModelId: 'claude-3-5-sonnet-20241022',
      },
    })
    const mgr = ConfigManager.fromConfig(initial)

    const next = makeLoopBreakerConfig({
      detector: {
        WARNING: 7,                              // 안전 → 반영
        CRITICAL: 14,                             // 안전 → 반영
        errLoopWarn: 2,                           // 안전 → 반영
        errLoopCrit: 4,                           // 안전 → 반영
        fileEditWarn: 3,                          // 안전 → 반영
        fileEditCrit: 6,                          // 안전 → 반영
        judgeModelId: 'claude-3-opus-20240229',   // 위험 → 거부
      },
    })
    mgr.reload(next)

    const snap = mgr.getConfig()

    // 안전 필드 6개 모두 원자적으로 반영
    expect(snap.WARNING).toBe(7)
    expect(snap.CRITICAL).toBe(14)
    expect(snap.errLoopWarn).toBe(2)
    expect(snap.errLoopCrit).toBe(4)
    expect(snap.fileEditWarn).toBe(3)
    expect(snap.fileEditCrit).toBe(6)

    // 위험 필드만 거부
    expect(snap.judgeModelId).toBe('claude-3-5-sonnet-20241022')
  })
})

// ── 5. 연속 reload에서 각 snapshot의 원자적 전환 ──────────────────────────────

describe('Sub-AC 5.2e: 연속 reload 원자적 전환', () => {
  test('연속 reload 시 각 round의 getConfig() 스냅샷이 해당 round 값으로 완전히 교체된다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { WARNING: 10, CRITICAL: 20, simThresh: 0.90 },
    })
    const mgr = ConfigManager.fromConfig(initial)

    // Round 1
    mgr.reload(makeLoopBreakerConfig({
      detector: { WARNING: 8, CRITICAL: 16, simThresh: 0.85 },
    }))
    let snap = mgr.getConfig()
    expect(snap.WARNING).toBe(8)
    expect(snap.CRITICAL).toBe(16)
    expect(snap.simThresh).toBe(0.85)

    // Round 2
    mgr.reload(makeLoopBreakerConfig({
      detector: { WARNING: 6, CRITICAL: 12, simThresh: 0.80 },
    }))
    snap = mgr.getConfig()
    expect(snap.WARNING).toBe(6)
    expect(snap.CRITICAL).toBe(12)
    expect(snap.simThresh).toBe(0.80)

    // Round 3
    mgr.reload(makeLoopBreakerConfig({
      detector: { WARNING: 14, CRITICAL: 28, simThresh: 0.95 },
    }))
    snap = mgr.getConfig()
    expect(snap.WARNING).toBe(14)
    expect(snap.CRITICAL).toBe(28)
    expect(snap.simThresh).toBe(0.95)
  })

  test('각 reload에서 콜백이 받는 snapshot이 해당 round의 완전한 상태를 반영한다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    const receivedSnapshots: Array<{ WARNING: number; CRITICAL: number; historySize: number }> = []

    mgr.onReload((next) => {
      receivedSnapshots.push({
        WARNING: next.WARNING,
        CRITICAL: next.CRITICAL,
        historySize: next.historySize,
      })
    })

    const rounds = [
      { WARNING: 7, CRITICAL: 14, historySize: 20 },
      { WARNING: 9, CRITICAL: 18, historySize: 25 },
      { WARNING: 5, CRITICAL: 10, historySize: 15 },
    ]

    for (const r of rounds) {
      mgr.reload(makeLoopBreakerConfig({ detector: r }))
    }

    expect(receivedSnapshots).toHaveLength(3)
    for (let i = 0; i < rounds.length; i++) {
      expect(receivedSnapshots[i].WARNING).toBe(rounds[i].WARNING)
      expect(receivedSnapshots[i].CRITICAL).toBe(rounds[i].CRITICAL)
      expect(receivedSnapshots[i].historySize).toBe(rounds[i].historySize)
    }
  })

  test('동일 값 reload 시 콜백은 호출되지 않고 스냅샷은 일관성을 유지한다', () => {
    const initial = makeLoopBreakerConfig({
      detector: { WARNING: 10, CRITICAL: 20 },
    })
    const mgr = ConfigManager.fromConfig(initial)

    let callbackCount = 0
    mgr.onReload((_next) => { callbackCount++ })

    // 완전히 동일한 설정으로 reload
    const same = makeLoopBreakerConfig({
      detector: { WARNING: 10, CRITICAL: 20 },
    })
    const result = mgr.reload(same)

    // 변경 없으므로 false 반환
    expect(result).toBe(false)
    // 콜백 미호출
    expect(callbackCount).toBe(0)
    // 스냅샷은 그대로 일관됨
    const snap = mgr.getConfig()
    expect(snap.WARNING).toBe(10)
    expect(snap.CRITICAL).toBe(20)
  })
})

// ── 6. 전체 안전 필드 동시 변경 원자성 (종합 검증) ────────────────────────────

describe('Sub-AC 5.2e: 전체 안전 필드 일괄 교체 원자성', () => {
  test('모든 안전 필드를 한 번의 reload로 교체하면 getConfig() 스냅샷이 완전히 새 값이다', () => {
    const initial = makeLoopBreakerConfig({})
    const mgr = ConfigManager.fromConfig(initial)

    // 모든 안전 필드를 DEFAULT와 다른 값으로 설정
    const next = makeLoopBreakerConfig({
      detector: {
        WARNING: 7,
        CRITICAL: 15,
        circuitBreaker: 25,
        historySize: 20,
        errLoopWarn: 2,
        errLoopCrit: 4,
        fileEditWarn: 3,
        fileEditCrit: 6,
        simThresh: 0.85,
        decideThresh: 0.6,
        selfApprovalMs: 10000,
        selfApprovalCriticalMs: 500,
        judgeSelfConsistencyN: 2,
        judgePositionSwaps: 1,
        notifyDebounceMs: 30000,
        notifyChannels: ['desktop'],
        lowConfidenceNotify: true,
      },
    })
    mgr.reload(next)

    // 단일 스냅샷에서 모든 필드가 새 값으로 일관 반영
    const snap = mgr.getConfig()
    expect(snap.WARNING).toBe(7)
    expect(snap.CRITICAL).toBe(15)
    expect(snap.circuitBreaker).toBe(25)
    expect(snap.historySize).toBe(20)
    expect(snap.errLoopWarn).toBe(2)
    expect(snap.errLoopCrit).toBe(4)
    expect(snap.fileEditWarn).toBe(3)
    expect(snap.fileEditCrit).toBe(6)
    expect(snap.simThresh).toBe(0.85)
    expect(snap.decideThresh).toBe(0.6)
    expect(snap.selfApprovalMs).toBe(10000)
    expect(snap.selfApprovalCriticalMs).toBe(500)
    expect(snap.judgeSelfConsistencyN).toBe(2)
    expect(snap.judgePositionSwaps).toBe(1)
    expect(snap.notifyDebounceMs).toBe(30000)
    expect(snap.notifyChannels).toEqual(['desktop'])
    expect(snap.lowConfidenceNotify).toBe(true)

    // 위험 필드(DEFAULT값 유지)는 변경되지 않아야 한다
    expect(snap.embedDim).toBe(DEFAULT_DETECTOR_CONFIG.embedDim)
    expect(snap.embedModelId).toBe(DEFAULT_DETECTOR_CONFIG.embedModelId)
    expect(snap.judgeModelId).toBe(DEFAULT_DETECTOR_CONFIG.judgeModelId)
  })
})
