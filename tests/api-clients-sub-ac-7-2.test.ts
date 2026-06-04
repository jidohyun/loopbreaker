/**
 * tests/api-clients-sub-ac-7-2.test.ts
 *
 * Sub-AC 7.2: ApiClients 팩토리 함수(createApiClients)가
 *   config에 embedApiKey가 없거나 빈 문자열일 때 MockEmbedClient를 폴백으로 반환하는지 검증.
 *
 * 테스트 부수효과 절대 금지:
 *   - 실제 네트워크 호출 없음
 *   - 실제 API 키 불필요 (빈 문자열 또는 undefined로 테스트)
 *   - OS 알림·파일 감시·lockfile 사용 없음
 */

import { describe, it, expect, jest } from '@jest/globals'
import { createApiClients } from '../src/api/api-clients.js'
import { MockEmbedClient } from '../src/api/embed-client.js'
import { MockJudgeClient } from '../src/api/judge-client.js'

const EMBED_MODEL_ID = 'voyage-3-lite'
const JUDGE_MODEL_ID = 'claude-3-5-sonnet-20241022'

describe('createApiClients — Sub-AC 7.2: embedApiKey 부재/빈 문자열 → MockEmbedClient 폴백', () => {
  // ── apiKey가 undefined인 경우 ─────────────────────────────────────────────

  describe('apiKey === undefined', () => {
    it('isReal === false를 반환한다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: undefined,
      })
      expect(result.isReal).toBe(false)
    })

    it('embedClient가 MockEmbedClient 인스턴스이다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        apiKey: undefined,
      })
      expect(result.embedClient).toBeInstanceOf(MockEmbedClient)
    })

    it('judgeClient가 MockJudgeClient 인스턴스이다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        apiKey: undefined,
      })
      expect(result.judgeClient).toBeInstanceOf(MockJudgeClient)
    })

    it('embedModelId도 없고 apiKey도 없을 때 MockEmbedClient를 반환한다', () => {
      const result = createApiClients({ apiKey: undefined })
      expect(result.embedClient).toBeInstanceOf(MockEmbedClient)
      expect(result.isReal).toBe(false)
    })
  })

  // ── apiKey가 빈 문자열인 경우 ─────────────────────────────────────────────

  describe('apiKey === "" (빈 문자열)', () => {
    it('isReal === false를 반환한다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: '',
      })
      expect(result.isReal).toBe(false)
    })

    it('embedClient가 MockEmbedClient 인스턴스이다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        apiKey: '',
      })
      expect(result.embedClient).toBeInstanceOf(MockEmbedClient)
    })

    it('judgeClient가 MockJudgeClient 인스턴스이다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        apiKey: '',
      })
      expect(result.judgeClient).toBeInstanceOf(MockJudgeClient)
    })

    it('embedModelId도 없고 apiKey가 빈 문자열일 때 MockEmbedClient를 반환한다', () => {
      const result = createApiClients({ apiKey: '' })
      expect(result.embedClient).toBeInstanceOf(MockEmbedClient)
      expect(result.isReal).toBe(false)
    })
  })

  // ── opts를 아예 생략한 경우 (apiKey 자체가 없음) ─────────────────────────

  describe('opts 생략 (apiKey 미전달)', () => {
    it('isReal === false, MockEmbedClient 반환', () => {
      const result = createApiClients()
      expect(result.isReal).toBe(false)
      expect(result.embedClient).toBeInstanceOf(MockEmbedClient)
    })

    it('judgeClient도 MockJudgeClient 반환', () => {
      const result = createApiClients()
      expect(result.judgeClient).toBeInstanceOf(MockJudgeClient)
    })
  })

  // ── 경고 로그 검증 ────────────────────────────────────────────────────────

  describe('경고 로그 — apiKey 부재 시 logger.warn 호출', () => {
    it('apiKey 없으면 logger.warn이 "API 키 없음" 메시지와 함께 호출된다', () => {
      const warnMessages: string[] = []
      const logger = {
        warn: (msg: string) => { warnMessages.push(msg) },
        info: () => undefined,
      }
      createApiClients({ embedModelId: EMBED_MODEL_ID, logger })
      expect(warnMessages.length).toBeGreaterThan(0)
      expect(warnMessages[0]).toContain('API 키 없음')
    })

    it('apiKey가 빈 문자열이면 logger.warn이 "API 키 없음" 메시지와 함께 호출된다', () => {
      const warnMessages: string[] = []
      const logger = {
        warn: (msg: string) => { warnMessages.push(msg) },
        info: () => undefined,
      }
      createApiClients({ embedModelId: EMBED_MODEL_ID, apiKey: '', logger })
      expect(warnMessages.length).toBeGreaterThan(0)
      expect(warnMessages[0]).toContain('API 키 없음')
    })

    it('logger 미주입 시 console.log/warn 없이 Mock 폴백이 조용히 반환된다', () => {
      // 부수효과 검증: console.log/warn 호출이 없어야 함
      const consoleSpy = {
        log: jest.spyOn(console, 'log').mockImplementation(() => undefined),
        warn: jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      }
      try {
        const result = createApiClients({ embedModelId: EMBED_MODEL_ID })
        expect(result.isReal).toBe(false)
        expect(consoleSpy.log).not.toHaveBeenCalled()
        expect(consoleSpy.warn).not.toHaveBeenCalled()
      } finally {
        consoleSpy.log.mockRestore()
        consoleSpy.warn.mockRestore()
      }
    })
  })

  // ── embedClient.embed() 호출 가능 확인 ───────────────────────────────────

  describe('MockEmbedClient 폴백 동작 확인', () => {
    it('폴백된 MockEmbedClient는 빈 배열 입력에 빈 배열을 반환한다', async () => {
      const result = createApiClients({ embedModelId: EMBED_MODEL_ID })
      const embeddings = await result.embedClient.embed([])
      expect(embeddings).toEqual([])
    })
  })
})
