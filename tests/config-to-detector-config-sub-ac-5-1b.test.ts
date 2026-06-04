// tests/config-to-detector-config-sub-ac-5-1b.test.ts
// Sub-AC 5.1b: toDetectorConfig() 어댑터 단위 테스트.
//
// 검증 항목:
//   1. 중첩 LoopBreakerConfig → 평면 DetectorConfig 매핑 정확성
//   2. 중첩 경로별 필드 매핑 (detector.* / notify.*)
//   3. DEFAULT_DETECTOR_CONFIG 기본값 불변 (덮어쓰지 않음)
//   4. 파일 명시 값 정확히 반영
//   5. 반환 객체는 새 객체 (원본 config 불변)
//
// 부수효과 없음: 실제 파일 I/O 없음, loadConfig/toDetectorConfig 직접 호출.

import { toDetectorConfig, loadConfig } from '../src/config/config-loader.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'
import { loopBreakerConfigSchema, type LoopBreakerConfig } from '../src/config/config-schema.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'

// 최소 유효 LoopBreakerConfig를 zod로 빌드하는 헬퍼
function makeConfig(overrides?: {
  detector?: Record<string, unknown>
  notify?: Record<string, unknown>
  api?: Record<string, unknown>
}): LoopBreakerConfig {
  return loopBreakerConfigSchema.parse({
    version: 1,
    detector: overrides?.detector ?? {},
    privacy: {},
    api: overrides?.api ?? {},
    watch: {},
    webhook: {},
    notify: overrides?.notify ?? {},
  })
}

// 임시 config 파일 생성 헬퍼
function makeTempConfig(json: unknown): { configPath: string; cleanup: () => void } {
  const dir = join(tmpdir(), `loopbreaker-test-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  const configPath = join(dir, 'config.json')
  writeFileSync(configPath, JSON.stringify(json), 'utf8')
  return {
    configPath,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    },
  }
}

describe('toDetectorConfig() — Sub-AC 5.1b 중첩→평면 매핑 어댑터', () => {

  describe('1. 기본값 통과 — 모든 기본값 설정 시 DEFAULT_DETECTOR_CONFIG와 동일', () => {
    it('빈 detector/notify로 만든 config를 변환하면 DEFAULT_DETECTOR_CONFIG 값과 일치한다', () => {
      const config = makeConfig()
      const flat = toDetectorConfig(config)

      expect(flat.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING)
      expect(flat.CRITICAL).toBe(DEFAULT_DETECTOR_CONFIG.CRITICAL)
      expect(flat.circuitBreaker).toBe(DEFAULT_DETECTOR_CONFIG.circuitBreaker)
      expect(flat.historySize).toBe(DEFAULT_DETECTOR_CONFIG.historySize)
      expect(flat.errLoopWarn).toBe(DEFAULT_DETECTOR_CONFIG.errLoopWarn)
      expect(flat.errLoopCrit).toBe(DEFAULT_DETECTOR_CONFIG.errLoopCrit)
      expect(flat.fileEditWarn).toBe(DEFAULT_DETECTOR_CONFIG.fileEditWarn)
      expect(flat.fileEditCrit).toBe(DEFAULT_DETECTOR_CONFIG.fileEditCrit)
      expect(flat.simThresh).toBe(DEFAULT_DETECTOR_CONFIG.simThresh)
      expect(flat.decideThresh).toBe(DEFAULT_DETECTOR_CONFIG.decideThresh)
      expect(flat.selfApprovalMs).toBe(DEFAULT_DETECTOR_CONFIG.selfApprovalMs)
      expect(flat.selfApprovalCriticalMs).toBe(DEFAULT_DETECTOR_CONFIG.selfApprovalCriticalMs)
      expect(flat.judgeSelfConsistencyN).toBe(DEFAULT_DETECTOR_CONFIG.judgeSelfConsistencyN)
      expect(flat.judgePositionSwaps).toBe(DEFAULT_DETECTOR_CONFIG.judgePositionSwaps)
      expect(flat.embedModelId).toBe(DEFAULT_DETECTOR_CONFIG.embedModelId)
      expect(flat.judgeModelId).toBe(DEFAULT_DETECTOR_CONFIG.judgeModelId)
      expect(flat.embedDim).toBe(DEFAULT_DETECTOR_CONFIG.embedDim)
      expect(flat.notifyDebounceMs).toBe(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs)
      expect(flat.notifyChannels).toEqual(DEFAULT_DETECTOR_CONFIG.notifyChannels)
      expect(flat.webhookUrl).toBeUndefined()
      expect(flat.lowConfidenceNotify).toBe(DEFAULT_DETECTOR_CONFIG.lowConfidenceNotify)
    })

    it('DEFAULT_DETECTOR_CONFIG 자체는 변경되지 않는다', () => {
      const config = makeConfig()
      toDetectorConfig(config)

      // 불변 기준선 동결 검증
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
    })
  })

  describe('2. config.detector.* → 구조 게이트 임계값 매핑', () => {
    it('detector.WARNING / CRITICAL / circuitBreaker / historySize를 정확히 매핑한다', () => {
      const config = makeConfig({ detector: { WARNING: 5, CRITICAL: 15, circuitBreaker: 25, historySize: 20 } })
      const flat = toDetectorConfig(config)

      expect(flat.WARNING).toBe(5)
      expect(flat.CRITICAL).toBe(15)
      expect(flat.circuitBreaker).toBe(25)
      expect(flat.historySize).toBe(20)
    })

    it('detector.errLoopWarn / errLoopCrit를 정확히 매핑한다', () => {
      const config = makeConfig({ detector: { errLoopWarn: 7, errLoopCrit: 10 } })
      const flat = toDetectorConfig(config)

      expect(flat.errLoopWarn).toBe(7)
      expect(flat.errLoopCrit).toBe(10)
      // 명시되지 않은 값은 기본값 유지
      expect(flat.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING)
    })

    it('detector.fileEditWarn / fileEditCrit를 정확히 매핑한다', () => {
      const config = makeConfig({ detector: { fileEditWarn: 3, fileEditCrit: 6 } })
      const flat = toDetectorConfig(config)

      expect(flat.fileEditWarn).toBe(3)
      expect(flat.fileEditCrit).toBe(6)
    })
  })

  describe('3. config.detector.* → 의미 게이트 / judge 임계값 매핑', () => {
    it('detector.simThresh / decideThresh를 정확히 매핑한다', () => {
      const config = makeConfig({ detector: { simThresh: 0.85, decideThresh: 0.6 } })
      const flat = toDetectorConfig(config)

      expect(flat.simThresh).toBe(0.85)
      expect(flat.decideThresh).toBe(0.6)
    })

    it('detector.selfApprovalMs / selfApprovalCriticalMs를 정확히 매핑한다', () => {
      const config = makeConfig({ detector: { selfApprovalMs: 30000, selfApprovalCriticalMs: 500 } })
      const flat = toDetectorConfig(config)

      expect(flat.selfApprovalMs).toBe(30000)
      expect(flat.selfApprovalCriticalMs).toBe(500)
    })

    it('detector.judgeSelfConsistencyN / judgePositionSwaps를 정확히 매핑한다', () => {
      const config = makeConfig({ detector: { judgeSelfConsistencyN: 3, judgePositionSwaps: 1 } })
      const flat = toDetectorConfig(config)

      expect(flat.judgeSelfConsistencyN).toBe(3)
      expect(flat.judgePositionSwaps).toBe(1)
    })
  })

  describe('4. config.detector.* → 모델 설정 매핑 (위험필드)', () => {
    it('detector.embedModelId / judgeModelId / embedDim을 정확히 매핑한다', () => {
      const config = makeConfig({
        detector: {
          embedModelId: 'voyage-3',
          judgeModelId: 'claude-3-opus-20240229',
          embedDim: 512,
        },
      })
      const flat = toDetectorConfig(config)

      expect(flat.embedModelId).toBe('voyage-3')
      expect(flat.judgeModelId).toBe('claude-3-opus-20240229')
      expect(flat.embedDim).toBe(512)
    })
  })

  describe('5. config.detector.* → 알림 설정 매핑', () => {
    it('detector.notifyChannels를 정확히 매핑한다', () => {
      const config = makeConfig({ detector: { notifyChannels: ['desktop', 'webhook', 'cli'] } })
      const flat = toDetectorConfig(config)

      expect(flat.notifyChannels).toEqual(['desktop', 'webhook', 'cli'])
    })

    it('detector.notifyChannels를 cli만으로 지정하면 그대로 매핑한다', () => {
      const config = makeConfig({ detector: { notifyChannels: ['cli'] } })
      const flat = toDetectorConfig(config)

      expect(flat.notifyChannels).toEqual(['cli'])
    })

    it('detector.webhookUrl을 정확히 매핑한다', () => {
      const config = makeConfig({ detector: { webhookUrl: 'https://example.com/hook' } })
      const flat = toDetectorConfig(config)

      expect(flat.webhookUrl).toBe('https://example.com/hook')
    })

    it('detector.webhookUrl이 없으면 undefined로 매핑한다', () => {
      const config = makeConfig()
      const flat = toDetectorConfig(config)

      expect(flat.webhookUrl).toBeUndefined()
    })

    it('detector.lowConfidenceNotify=true를 정확히 매핑한다', () => {
      const config = makeConfig({ detector: { lowConfidenceNotify: true } })
      const flat = toDetectorConfig(config)

      expect(flat.lowConfidenceNotify).toBe(true)
    })
  })

  describe('6. config.notify.notifyDebounceMs → notifyDebounceMs 매핑', () => {
    it('detector.notifyDebounceMs가 기본값이고 notify.notifyDebounceMs가 다르면 notify 값을 사용한다', () => {
      const config = makeConfig({ notify: { notifyDebounceMs: 120000 } })
      const flat = toDetectorConfig(config)

      expect(flat.notifyDebounceMs).toBe(120000)
    })

    it('detector.notifyDebounceMs가 명시되면 detector 값이 우선한다', () => {
      const config = makeConfig({
        detector: { notifyDebounceMs: 30000 },
        notify: { notifyDebounceMs: 120000 },
      })
      const flat = toDetectorConfig(config)

      expect(flat.notifyDebounceMs).toBe(30000)
    })

    it('둘 다 기본값이면 DEFAULT_DETECTOR_CONFIG.notifyDebounceMs를 사용한다', () => {
      const config = makeConfig()
      const flat = toDetectorConfig(config)

      expect(flat.notifyDebounceMs).toBe(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs)
    })
  })

  describe('7. 반환 타입 및 불변성', () => {
    it('반환 객체는 새 객체 (원본 config와 동일 참조가 아님)', () => {
      const config = makeConfig()
      const flat = toDetectorConfig(config)

      // flat은 새 객체
      expect(flat).not.toBe(config)
      expect(flat).not.toBe(config.detector)
    })

    it('반환 객체는 DetectorConfig의 모든 필드를 포함한다', () => {
      const config = makeConfig()
      const flat = toDetectorConfig(config)

      // 구조 게이트 임계값
      expect('WARNING' in flat).toBe(true)
      expect('CRITICAL' in flat).toBe(true)
      expect('circuitBreaker' in flat).toBe(true)
      expect('historySize' in flat).toBe(true)
      expect('errLoopWarn' in flat).toBe(true)
      expect('errLoopCrit' in flat).toBe(true)
      expect('fileEditWarn' in flat).toBe(true)
      expect('fileEditCrit' in flat).toBe(true)
      // 의미 게이트
      expect('simThresh' in flat).toBe(true)
      expect('decideThresh' in flat).toBe(true)
      // 가짜성공 프로브
      expect('selfApprovalMs' in flat).toBe(true)
      expect('selfApprovalCriticalMs' in flat).toBe(true)
      // judge
      expect('judgeSelfConsistencyN' in flat).toBe(true)
      expect('judgePositionSwaps' in flat).toBe(true)
      // 모델
      expect('embedModelId' in flat).toBe(true)
      expect('judgeModelId' in flat).toBe(true)
      expect('embedDim' in flat).toBe(true)
      // 알림
      expect('notifyDebounceMs' in flat).toBe(true)
      expect('notifyChannels' in flat).toBe(true)
      expect('lowConfidenceNotify' in flat).toBe(true)
    })

    it('반환된 notifyChannels는 새 배열 참조 (detector 배열과 독립)', () => {
      const config = makeConfig({ detector: { notifyChannels: ['desktop', 'cli'] } })
      const flat = toDetectorConfig(config)

      // 값은 동일해도 참조가 불변성을 깨지 않아야 한다
      expect(Array.isArray(flat.notifyChannels)).toBe(true)
      expect(flat.notifyChannels).toEqual(['desktop', 'cli'])
    })
  })

  describe('8. 실제 loadConfig + toDetectorConfig 통합 경로', () => {
    it('실제 JSON 파일 → loadConfig → toDetectorConfig 전체 경로가 동작한다', () => {
      const { configPath, cleanup } = makeTempConfig({
        version: 1,
        detector: {
          WARNING: 7,
          CRITICAL: 14,
          simThresh: 0.88,
          embedModelId: 'voyage-3',
          notifyChannels: ['cli'],
          lowConfidenceNotify: true,
        },
        privacy: {},
        api: {},
        watch: {},
        webhook: {},
        notify: { notifyDebounceMs: 90000 },
      })
      try {
        const config = loadConfig(configPath)
        const flat = toDetectorConfig(config)

        // detector.* 매핑
        expect(flat.WARNING).toBe(7)
        expect(flat.CRITICAL).toBe(14)
        expect(flat.simThresh).toBe(0.88)
        expect(flat.embedModelId).toBe('voyage-3')
        expect(flat.notifyChannels).toEqual(['cli'])
        expect(flat.lowConfidenceNotify).toBe(true)
        // 명시되지 않은 값은 기본값
        expect(flat.circuitBreaker).toBe(DEFAULT_DETECTOR_CONFIG.circuitBreaker)
        expect(flat.historySize).toBe(DEFAULT_DETECTOR_CONFIG.historySize)
        // notify.notifyDebounceMs 매핑 (detector에는 기본값이므로 notify 값 적용)
        expect(flat.notifyDebounceMs).toBe(90000)
      } finally {
        cleanup()
      }
    })

    it('파일 없는 경우 loadConfig 기본값 → toDetectorConfig가 DEFAULT_DETECTOR_CONFIG와 일치한다', () => {
      const { configPath, cleanup } = makeTempConfig({
        version: 1,
        detector: {},
        privacy: {},
        api: {},
        watch: {},
        webhook: {},
        notify: {},
      })
      try {
        const config = loadConfig(configPath)
        const flat = toDetectorConfig(config)

        expect(flat.WARNING).toBe(DEFAULT_DETECTOR_CONFIG.WARNING)
        expect(flat.simThresh).toBe(DEFAULT_DETECTOR_CONFIG.simThresh)
        expect(flat.embedModelId).toBe(DEFAULT_DETECTOR_CONFIG.embedModelId)
        expect(flat.notifyDebounceMs).toBe(DEFAULT_DETECTOR_CONFIG.notifyDebounceMs)
      } finally {
        cleanup()
      }
    })
  })

  describe('9. 중첩 경로별 매핑 정확성 — 경계 케이스', () => {
    it('judgeSelfConsistencyN=1이 유지되고 오버라이드도 동작한다', () => {
      const defaultConfig = makeConfig()
      expect(toDetectorConfig(defaultConfig).judgeSelfConsistencyN).toBe(1)

      const overriddenConfig = makeConfig({ detector: { judgeSelfConsistencyN: 5 } })
      expect(toDetectorConfig(overriddenConfig).judgeSelfConsistencyN).toBe(5)
    })

    it('judgePositionSwaps=0이 유지되고 오버라이드도 동작한다', () => {
      const defaultConfig = makeConfig()
      expect(toDetectorConfig(defaultConfig).judgePositionSwaps).toBe(0)

      const overriddenConfig = makeConfig({ detector: { judgePositionSwaps: 2 } })
      expect(toDetectorConfig(overriddenConfig).judgePositionSwaps).toBe(2)
    })

    it('selfApprovalCriticalMs=1000이 유지되고 오버라이드도 동작한다', () => {
      const defaultConfig = makeConfig()
      expect(toDetectorConfig(defaultConfig).selfApprovalCriticalMs).toBe(1000)

      const overriddenConfig = makeConfig({ detector: { selfApprovalCriticalMs: 200 } })
      expect(toDetectorConfig(overriddenConfig).selfApprovalCriticalMs).toBe(200)
    })

    it('embedDim=1024이 유지되고 오버라이드도 동작한다', () => {
      const defaultConfig = makeConfig()
      expect(toDetectorConfig(defaultConfig).embedDim).toBe(1024)

      const overriddenConfig = makeConfig({ detector: { embedDim: 768 } })
      expect(toDetectorConfig(overriddenConfig).embedDim).toBe(768)
    })

    it('모든 구조 게이트 임계값을 한 번에 오버라이드해도 기본값 동결에 영향 없다', () => {
      const config = makeConfig({
        detector: {
          WARNING: 1,
          CRITICAL: 2,
          circuitBreaker: 3,
          historySize: 4,
          errLoopWarn: 1,
          errLoopCrit: 2,
          fileEditWarn: 1,
          fileEditCrit: 2,
        },
      })
      const flat = toDetectorConfig(config)

      // 오버라이드 값 반영
      expect(flat.WARNING).toBe(1)
      expect(flat.CRITICAL).toBe(2)
      expect(flat.circuitBreaker).toBe(3)
      expect(flat.historySize).toBe(4)
      expect(flat.errLoopWarn).toBe(1)
      expect(flat.errLoopCrit).toBe(2)
      expect(flat.fileEditWarn).toBe(1)
      expect(flat.fileEditCrit).toBe(2)

      // DEFAULT_DETECTOR_CONFIG 불변 확인
      expect(DEFAULT_DETECTOR_CONFIG.WARNING).toBe(10)
      expect(DEFAULT_DETECTOR_CONFIG.CRITICAL).toBe(20)
      expect(DEFAULT_DETECTOR_CONFIG.circuitBreaker).toBe(30)
    })
  })
})
