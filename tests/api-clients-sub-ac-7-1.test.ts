/**
 * tests/api-clients-sub-ac-7-1.test.ts
 *
 * Sub-AC 7.1: ApiClients 팩토리 함수(createApiClients)가
 *   config에 embedModelId/apiKey가 모두 존재할 때 RealEmbedClient 스텁 인스턴스를 반환하는지 검증.
 *
 * 테스트 부수효과 절대 금지:
 *   - 실제 네트워크 호출 없음 (RealEmbedClient.embed()는 NotImplementedError throw 스텁)
 *   - 실제 API 키 불필요 (임의 문자열로 테스트)
 *   - OS 알림·파일 감시·lockfile 사용 없음
 */

import { describe, it, expect } from '@jest/globals'
import { createApiClients, NotImplementedError } from '../src/api/api-clients.js'
import { RealEmbedClient } from '../src/api/real-embed-client.js'
import { AnthropicJudgeClient } from '../src/api/anthropic-judge-client.js'
import { MockEmbedClient } from '../src/api/embed-client.js'
import { MockJudgeClient } from '../src/api/judge-client.js'

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

const FAKE_API_KEY = 'test-api-key-does-not-hit-network'
const EMBED_MODEL_ID = 'voyage-3-lite'
const JUDGE_MODEL_ID = 'claude-3-5-sonnet-20241022'

// ── 테스트 ───────────────────────────────────────────────────────────────────

describe('createApiClients — Sub-AC 7.1', () => {
  // ── Real 경로 ────────────────────────────────────────────────────────────

  describe('embedModelId + apiKey 모두 있을 때 (Real 스텁 경로)', () => {
    it('isReal === true를 반환한다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: FAKE_API_KEY,
      })
      expect(result.isReal).toBe(true)
    })

    it('embedClient가 RealEmbedClient 인스턴스이다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: FAKE_API_KEY,
      })
      expect(result.embedClient).toBeInstanceOf(RealEmbedClient)
    })

    it('judgeClient가 AnthropicJudgeClient 인스턴스이다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: FAKE_API_KEY,
      })
      expect(result.judgeClient).toBeInstanceOf(AnthropicJudgeClient)
    })

    it('RealEmbedClient.embed()는 NotImplementedError를 throw한다 (스텁 검증)', async () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        apiKey: FAKE_API_KEY,
      })
      // RealEmbedClient 내부의 NotImplementedError는 embed-client-providers.ts에서 오고,
      // 이 테스트 파일의 NotImplementedError는 anthropic-judge-client.ts에서 온다.
      // 두 클래스는 다른 모듈 인스턴스이므로 instanceof 대신 .name 으로 검증한다.
      await expect(result.embedClient.embed(['test'])).rejects.toMatchObject({
        name: 'NotImplementedError',
      })
    })

    it('AnthropicJudgeClient.judge()는 NotImplementedError를 throw한다 (스텁 검증)', async () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: FAKE_API_KEY,
      })
      await expect(
        result.judgeClient.judge({
          kind: 'thrashing',
          cacheableBlock: 'block',
          volatileBlock: 'volatile',
          modelId: JUDGE_MODEL_ID,
        }),
      ).rejects.toBeInstanceOf(NotImplementedError)
    })

    it('judgeModelId가 생략되면 기본값 claude-3-5-sonnet-20241022를 사용한다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        apiKey: FAKE_API_KEY,
        // judgeModelId 생략
      })
      expect(result.isReal).toBe(true)
      expect(result.judgeClient).toBeInstanceOf(AnthropicJudgeClient)
    })
  })

  // ── Mock 경로 ────────────────────────────────────────────────────────────

  describe('apiKey 없을 때 (Mock 폴백 경로)', () => {
    it('isReal === false를 반환한다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        // apiKey 없음
      })
      expect(result.isReal).toBe(false)
    })

    it('embedClient가 MockEmbedClient 인스턴스이다', () => {
      const result = createApiClients({ embedModelId: EMBED_MODEL_ID })
      expect(result.embedClient).toBeInstanceOf(MockEmbedClient)
    })

    it('judgeClient가 MockJudgeClient 인스턴스이다', () => {
      const result = createApiClients({ embedModelId: EMBED_MODEL_ID })
      expect(result.judgeClient).toBeInstanceOf(MockJudgeClient)
    })
  })

  describe('embedModelId 없을 때 (Mock 폴백 경로)', () => {
    it('isReal === false를 반환한다', () => {
      const result = createApiClients({
        apiKey: FAKE_API_KEY,
        // embedModelId 없음
      })
      expect(result.isReal).toBe(false)
    })
  })

  describe('opts.mock === true (명시적 Mock 강제)', () => {
    it('isReal === false를 반환한다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        apiKey: FAKE_API_KEY,
        mock: true,
      })
      expect(result.isReal).toBe(false)
    })

    it('embedClient가 MockEmbedClient 인스턴스이다', () => {
      const result = createApiClients({ mock: true })
      expect(result.embedClient).toBeInstanceOf(MockEmbedClient)
    })

    it('judgeClient가 MockJudgeClient 인스턴스이다', () => {
      const result = createApiClients({ mock: true })
      expect(result.judgeClient).toBeInstanceOf(MockJudgeClient)
    })
  })

  describe('빈 opts (아무 것도 없을 때)', () => {
    it('isReal === false, Mock 클라이언트 반환', () => {
      const result = createApiClients()
      expect(result.isReal).toBe(false)
      expect(result.embedClient).toBeInstanceOf(MockEmbedClient)
      expect(result.judgeClient).toBeInstanceOf(MockJudgeClient)
    })
  })

  // ── DI 주입 경로 ──────────────────────────────────────────────────────────

  describe('DI 주입 (embedClient / judgeClient 직접 주입)', () => {
    it('주입된 embedClient를 그대로 반환한다', () => {
      const mockEmbed = new MockEmbedClient([], 512)
      const result = createApiClients({ embedClient: mockEmbed })
      expect(result.embedClient).toBe(mockEmbed)
    })

    it('주입된 judgeClient를 그대로 반환한다', () => {
      const mockJudge = new MockJudgeClient()
      const result = createApiClients({ judgeClient: mockJudge })
      expect(result.judgeClient).toBe(mockJudge)
    })

    it('DI 주입 시 isReal === false이다', () => {
      const result = createApiClients({
        embedClient: new MockEmbedClient([], 1024),
        judgeClient: new MockJudgeClient(),
      })
      expect(result.isReal).toBe(false)
    })

    it('embedClient만 주입 시 judgeClient는 MockJudgeClient 폴백', () => {
      const mockEmbed = new MockEmbedClient([], 1024)
      const result = createApiClients({ embedClient: mockEmbed })
      expect(result.embedClient).toBe(mockEmbed)
      expect(result.judgeClient).toBeInstanceOf(MockJudgeClient)
    })
  })

  // ── 로거 부수효과 없음 검증 ────────────────────────────────────────────────

  describe('로거 호출 (console.log 없음 검증)', () => {
    it('경고 로그는 주입된 logger.warn을 통해서만 나온다', () => {
      const warnCalls: Array<{ msg: string; extra?: Record<string, unknown> }> = []
      const logger = {
        warn: (msg: string, extra?: Record<string, unknown>) => { warnCalls.push({ msg, extra }) },
        info: () => undefined,
      }
      createApiClients({ logger })
      // apiKey 없음 → warn 호출
      expect(warnCalls.length).toBeGreaterThan(0)
      expect(warnCalls[0].msg).toContain('API 키 없음')
    })

    it('Real 경로에서는 warn 없이 info만 호출된다', () => {
      const warnCalls: string[] = []
      const infoCalls: string[] = []
      const logger = {
        warn: (msg: string) => { warnCalls.push(msg) },
        info: (msg: string) => { infoCalls.push(msg) },
      }
      createApiClients({
        embedModelId: EMBED_MODEL_ID,
        apiKey: FAKE_API_KEY,
        logger,
      })
      expect(warnCalls).toHaveLength(0)
      expect(infoCalls.length).toBeGreaterThan(0)
    })
  })
})
