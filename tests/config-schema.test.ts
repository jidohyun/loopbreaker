// tests/config-schema.test.ts
// config 스키마 zod 검증 단위 테스트.
// BLOCKER C3: DetectorConfig 평면 구조 검증.

import { detectorConfigSchema, loopBreakerConfigSchema } from '../src/config/config-schema.js'

describe('detectorConfigSchema — 기본값 검증', () => {
  test('빈 객체를 파싱하면 모든 기본값이 채워진다', () => {
    const result = detectorConfigSchema.parse({})
    expect(result.WARNING).toBe(10)
    expect(result.CRITICAL).toBe(20)
    expect(result.circuitBreaker).toBe(30)
    expect(result.historySize).toBe(30)
    expect(result.errLoopWarn).toBe(3)
    expect(result.errLoopCrit).toBe(5)
    expect(result.simThresh).toBe(0.90)
    expect(result.decideThresh).toBe(0.7)
    expect(result.selfApprovalMs).toBe(15000)
    expect(result.selfApprovalCriticalMs).toBe(1000)
    expect(result.judgeSelfConsistencyN).toBe(1)
    expect(result.judgePositionSwaps).toBe(0)
    expect(result.embedDim).toBeGreaterThan(0)
  })

  test('값을 오버라이드할 수 있다', () => {
    const result = detectorConfigSchema.parse({ WARNING: 5, CRITICAL: 15 })
    expect(result.WARNING).toBe(5)
    expect(result.CRITICAL).toBe(15)
    expect(result.circuitBreaker).toBe(30) // 기본값 유지
  })

  test('잘못된 타입은 거부된다', () => {
    expect(() => detectorConfigSchema.parse({ WARNING: 'ten' })).toThrow()
    expect(() => detectorConfigSchema.parse({ simThresh: 2.0 })).toThrow() // 0~1 범위 초과
    expect(() => detectorConfigSchema.parse({ embedDim: -1 })).toThrow() // 음수 금지
  })

  test('embedModelId는 비어있을 수 없다', () => {
    expect(() => detectorConfigSchema.parse({ embedModelId: '' })).toThrow()
  })
})

describe('loopBreakerConfigSchema — 전체 config.json 검증', () => {
  test('최소 유효 config.json을 파싱한다', () => {
    const config = loopBreakerConfigSchema.parse({
      version: 1,
      detector: {},
      privacy: {},
      api: {},
      watch: {},
      webhook: {},
      notify: {},
    })
    expect(config.version).toBe(1)
    expect(config.detector.WARNING).toBe(10)
    expect(config.privacy.redactFilePaths).toBe(true)
    expect(config.api.maxConcurrentApiCalls).toBe(4)
    expect(config.watch.sessionGlob).toContain('*.jsonl')
    expect(config.webhook.url).toBeNull()
    expect(config.notify.desktop).toBe(true)
  })

  test('version이 1이 아니면 거부된다', () => {
    expect(() => loopBreakerConfigSchema.parse({
      version: 2,
      detector: {}, privacy: {}, api: {}, watch: {}, webhook: {}, notify: {},
    })).toThrow()
  })

  test('privacy.sendCodeToApi는 none|snippets|full만 허용한다', () => {
    expect(() => loopBreakerConfigSchema.parse({
      version: 1,
      detector: {},
      privacy: { sendCodeToApi: 'all' },
      api: {}, watch: {}, webhook: {}, notify: {},
    })).toThrow()
  })

  test('watch.usePollingFallback은 auto|always|never만 허용한다', () => {
    const result = loopBreakerConfigSchema.parse({
      version: 1,
      detector: {},
      privacy: {},
      api: {},
      watch: { usePollingFallback: 'always' },
      webhook: {},
      notify: {},
    })
    expect(result.watch.usePollingFallback).toBe('always')
  })
})
