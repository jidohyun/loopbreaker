// tests/config-loader-sub-ac-5-1a.test.ts
// Sub-AC 5.1a: ConfigManager.loadConfig() 단위 테스트.
// - 유효한 중첩 LoopBreakerConfig JSON 파싱 검증
// - 유효하지 않은 입력에 대해 오류 throw 검증
// - 파일 부재 시 zod 기본값 반환 검증
// 부수효과 없음: 실제 ~/.loopbreaker 미사용, tmpdir 임시 파일 사용.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadConfig, defaultConfigDir, defaultConfigPath } from '../src/config/config-loader.js'

// 각 테스트마다 격리된 임시 경로를 사용
function makeTempConfigPath(): { dir: string; configPath: string; cleanup: () => void } {
  const dir = join(tmpdir(), `loopbreaker-test-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  const configPath = join(dir, 'config.json')
  return {
    dir,
    configPath,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    },
  }
}

describe('loadConfig() — Sub-AC 5.1a', () => {
  describe('파일 부재 시 기본값 반환', () => {
    it('존재하지 않는 경로를 전달하면 zod 기본값을 가진 LoopBreakerConfig를 반환한다', () => {
      const nonExistent = join(tmpdir(), `loopbreaker-nonexistent-${randomUUID()}`, 'config.json')
      const config = loadConfig(nonExistent)

      expect(config.version).toBe(1)
      expect(config.detector.WARNING).toBe(10)
      expect(config.detector.CRITICAL).toBe(20)
      expect(config.detector.circuitBreaker).toBe(30)
      expect(config.detector.simThresh).toBe(0.9)
      expect(config.detector.decideThresh).toBe(0.7)
      expect(config.privacy.redactFilePaths).toBe(true)
      expect(config.api.maxConcurrentApiCalls).toBe(4)
      expect(config.watch.sessionGlob).toContain('*.jsonl')
      expect(config.notify.desktop).toBe(true)
      expect(config.webhook.url).toBeNull()
    })

    it('파일 부재 시 DEFAULT_DETECTOR_CONFIG 값을 그대로 사용한다', () => {
      const nonExistent = join(tmpdir(), `loopbreaker-nonexistent-${randomUUID()}`, 'config.json')
      const config = loadConfig(nonExistent)

      // DEFAULT_DETECTOR_CONFIG 불변 기준선 검증
      expect(config.detector.errLoopWarn).toBe(3)
      expect(config.detector.errLoopCrit).toBe(5)
      expect(config.detector.fileEditWarn).toBe(5)
      expect(config.detector.fileEditCrit).toBe(8)
      expect(config.detector.selfApprovalMs).toBe(15000)
      expect(config.detector.selfApprovalCriticalMs).toBe(1000)
      expect(config.detector.judgeSelfConsistencyN).toBe(1)
      expect(config.detector.judgePositionSwaps).toBe(0)
      expect(config.detector.embedModelId).toBe('voyage-3-lite')
      expect(config.detector.judgeModelId).toBe('claude-3-5-sonnet-20241022')
      expect(config.detector.embedDim).toBe(1024)
      expect(config.detector.notifyDebounceMs).toBe(60000)
      expect(config.detector.lowConfidenceNotify).toBe(false)
    })
  })

  describe('유효한 중첩 LoopBreakerConfig JSON 파싱', () => {
    it('모든 섹션을 포함한 최소 유효 config.json을 파싱한다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, JSON.stringify({
          version: 1,
          detector: {},
          privacy: {},
          api: {},
          watch: {},
          webhook: {},
          notify: {},
        }), 'utf8')

        const config = loadConfig(configPath)
        expect(config.version).toBe(1)
        expect(config.detector.WARNING).toBe(10)
        expect(config.privacy.sendCodeToApi).toBe('snippets')
        expect(config.api.apiMaxRetries).toBe(3)
        expect(config.watch.usePollingFallback).toBe('auto')
      } finally {
        cleanup()
      }
    })

    it('detector 섹션의 임계값을 올바르게 덮어쓴다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, JSON.stringify({
          version: 1,
          detector: {
            WARNING: 5,
            CRITICAL: 15,
            simThresh: 0.85,
            decideThresh: 0.6,
          },
          privacy: {},
          api: {},
          watch: {},
          webhook: {},
          notify: {},
        }), 'utf8')

        const config = loadConfig(configPath)
        // 명시된 값은 덮어써진다
        expect(config.detector.WARNING).toBe(5)
        expect(config.detector.CRITICAL).toBe(15)
        expect(config.detector.simThresh).toBe(0.85)
        expect(config.detector.decideThresh).toBe(0.6)
        // 명시되지 않은 값은 기본값 유지
        expect(config.detector.circuitBreaker).toBe(30)
        expect(config.detector.historySize).toBe(30)
      } finally {
        cleanup()
      }
    })

    it('privacy 섹션을 올바르게 파싱한다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, JSON.stringify({
          version: 1,
          detector: {},
          privacy: {
            redactFilePaths: false,
            sendCodeToApi: 'full',
            maxSnippetChars: 4000,
            embedReasoning: true,
          },
          api: {},
          watch: {},
          webhook: {},
          notify: {},
        }), 'utf8')

        const config = loadConfig(configPath)
        expect(config.privacy.redactFilePaths).toBe(false)
        expect(config.privacy.sendCodeToApi).toBe('full')
        expect(config.privacy.maxSnippetChars).toBe(4000)
        expect(config.privacy.embedReasoning).toBe(true)
      } finally {
        cleanup()
      }
    })

    it('api 섹션을 올바르게 파싱한다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, JSON.stringify({
          version: 1,
          detector: {},
          privacy: {},
          api: {
            maxConcurrentApiCalls: 8,
            apiMaxRetries: 5,
            dailyCostCapUsd: 10.0,
            maxJudgeCallsPerSession: 100,
          },
          watch: {},
          webhook: {},
          notify: {},
        }), 'utf8')

        const config = loadConfig(configPath)
        expect(config.api.maxConcurrentApiCalls).toBe(8)
        expect(config.api.apiMaxRetries).toBe(5)
        expect(config.api.dailyCostCapUsd).toBe(10.0)
        expect(config.api.maxJudgeCallsPerSession).toBe(100)
      } finally {
        cleanup()
      }
    })

    it('watch.sessionGlob을 올바르게 파싱한다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, JSON.stringify({
          version: 1,
          detector: {},
          privacy: {},
          api: {},
          watch: { sessionGlob: '/custom/path/**/*.jsonl' },
          webhook: {},
          notify: {},
        }), 'utf8')

        const config = loadConfig(configPath)
        expect(config.watch.sessionGlob).toBe('/custom/path/**/*.jsonl')
      } finally {
        cleanup()
      }
    })

    it('반환된 config 객체는 freeze되어 변경 불가능하다', () => {
      const nonExistent = join(tmpdir(), `loopbreaker-nonexistent-${randomUUID()}`, 'config.json')
      const config = loadConfig(nonExistent)

      // Object.isFrozen은 최상위 레벨만 확인
      expect(Object.isFrozen(config)).toBe(true)
    })

    it('올바른 타입의 LoopBreakerConfig 객체를 반환한다', () => {
      const nonExistent = join(tmpdir(), `loopbreaker-nonexistent-${randomUUID()}`, 'config.json')
      const config = loadConfig(nonExistent)

      expect(typeof config.version).toBe('number')
      expect(typeof config.detector).toBe('object')
      expect(typeof config.privacy).toBe('object')
      expect(typeof config.api).toBe('object')
      expect(typeof config.watch).toBe('object')
      expect(typeof config.webhook).toBe('object')
      expect(typeof config.notify).toBe('object')
      // detector 필드 타입 검증
      expect(typeof config.detector.WARNING).toBe('number')
      expect(typeof config.detector.simThresh).toBe('number')
      expect(typeof config.detector.embedModelId).toBe('string')
      expect(Array.isArray(config.detector.notifyChannels)).toBe(true)
    })
  })

  describe('유효하지 않은 입력에 대해 오류 throw', () => {
    it('JSON 파싱 실패 시 에러를 throw한다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, 'invalid json {{{', 'utf8')
        expect(() => loadConfig(configPath)).toThrow('설정 파일 JSON 파싱 실패')
      } finally {
        cleanup()
      }
    })

    it('version이 1이 아니면 ZodError를 포함한 에러를 throw한다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, JSON.stringify({
          version: 2,
          detector: {}, privacy: {}, api: {}, watch: {}, webhook: {}, notify: {},
        }), 'utf8')
        expect(() => loadConfig(configPath)).toThrow()
      } finally {
        cleanup()
      }
    })

    it('version 필드가 없으면 에러를 throw한다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, JSON.stringify({
          detector: {}, privacy: {}, api: {}, watch: {}, webhook: {}, notify: {},
        }), 'utf8')
        expect(() => loadConfig(configPath)).toThrow()
      } finally {
        cleanup()
      }
    })

    it('privacy.sendCodeToApi에 유효하지 않은 enum 값을 넣으면 에러를 throw한다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, JSON.stringify({
          version: 1,
          detector: {},
          privacy: { sendCodeToApi: 'all' },
          api: {}, watch: {}, webhook: {}, notify: {},
        }), 'utf8')
        expect(() => loadConfig(configPath)).toThrow()
      } finally {
        cleanup()
      }
    })

    it('detector.WARNING에 문자열을 넣으면 에러를 throw한다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, JSON.stringify({
          version: 1,
          detector: { WARNING: 'ten' },
          privacy: {}, api: {}, watch: {}, webhook: {}, notify: {},
        }), 'utf8')
        expect(() => loadConfig(configPath)).toThrow()
      } finally {
        cleanup()
      }
    })

    it('detector.simThresh에 범위 초과 값을 넣으면 에러를 throw한다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, JSON.stringify({
          version: 1,
          detector: { simThresh: 2.0 },
          privacy: {}, api: {}, watch: {}, webhook: {}, notify: {},
        }), 'utf8')
        expect(() => loadConfig(configPath)).toThrow()
      } finally {
        cleanup()
      }
    })

    it('watch.usePollingFallback에 유효하지 않은 값을 넣으면 에러를 throw한다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, JSON.stringify({
          version: 1,
          detector: {}, privacy: {}, api: {},
          watch: { usePollingFallback: 'maybe' },
          webhook: {}, notify: {},
        }), 'utf8')
        expect(() => loadConfig(configPath)).toThrow()
      } finally {
        cleanup()
      }
    })

    it('에러 메시지에 설정 검증 실패 안내가 포함된다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, JSON.stringify({
          version: 1,
          detector: { WARNING: -5 },  // 음수 금지 (positive)
          privacy: {}, api: {}, watch: {}, webhook: {}, notify: {},
        }), 'utf8')
        expect(() => loadConfig(configPath)).toThrow('설정 검증 실패')
      } finally {
        cleanup()
      }
    })

    it('null을 JSON 루트로 넣으면 에러를 throw한다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, 'null', 'utf8')
        expect(() => loadConfig(configPath)).toThrow()
      } finally {
        cleanup()
      }
    })

    it('빈 JSON 객체를 넣으면 version 누락으로 에러를 throw한다', () => {
      const { configPath, cleanup } = makeTempConfigPath()
      try {
        writeFileSync(configPath, '{}', 'utf8')
        expect(() => loadConfig(configPath)).toThrow()
      } finally {
        cleanup()
      }
    })
  })

  describe('defaultConfigDir / defaultConfigPath — 헬퍼 함수', () => {
    it('defaultConfigDir()는 ~/ 경로를 포함한 문자열을 반환한다', () => {
      const dir = defaultConfigDir()
      expect(typeof dir).toBe('string')
      expect(dir.length).toBeGreaterThan(0)
      expect(dir).toContain('.loopbreaker')
    })

    it('defaultConfigPath()는 config.json으로 끝나는 경로를 반환한다', () => {
      const path = defaultConfigPath()
      expect(path).toContain('config.json')
      expect(path).toContain('.loopbreaker')
    })
  })
})
