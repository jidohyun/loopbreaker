/**
 * tests/api-clients-sub-ac-7-3.test.ts
 *
 * Sub-AC 7.3: ApiClients 팩토리 함수(createApiClients)가
 *   config에 judgeModelId / apiKey가 모두 존재할 때 AnthropicJudgeClient 스텁 인스턴스를,
 *   키 없을 때 MockJudgeClient를 반환하는지 각각 검증하는 단위 테스트.
 *
 * 테스트 부수효과 절대 금지:
 *   - 실제 네트워크 호출 없음 (AnthropicJudgeClient.judge()는 NotImplementedError throw 스텁)
 *   - 실제 API 키 불필요 (임의 문자열로 테스트)
 *   - OS 알림·파일 감시·lockfile 사용 없음
 */

import { describe, it, expect } from '@jest/globals'
import { createApiClients, NotImplementedError } from '../src/api/api-clients.js'
import { AnthropicJudgeClient } from '../src/api/anthropic-judge-client.js'
import { MockJudgeClient } from '../src/api/judge-client.js'

const FAKE_API_KEY = 'test-api-key-does-not-hit-network'
const EMBED_MODEL_ID = 'voyage-3-lite'
const JUDGE_MODEL_ID = 'claude-3-5-sonnet-20241022'

describe('createApiClients — Sub-AC 7.3: judgeModelId/apiKey → AnthropicJudgeClient vs MockJudgeClient', () => {
  // ── judgeModelId + apiKey 모두 있을 때: AnthropicJudgeClient 스텁 반환 ────

  describe('judgeModelId + apiKey 모두 있을 때', () => {
    it('judgeClient가 AnthropicJudgeClient 인스턴스이다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: FAKE_API_KEY,
      })
      expect(result.judgeClient).toBeInstanceOf(AnthropicJudgeClient)
    })

    it('isReal === true를 반환한다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: FAKE_API_KEY,
      })
      expect(result.isReal).toBe(true)
    })

    it('AnthropicJudgeClient.judge()는 NotImplementedError를 throw한다 (스텁, 네트워크 0)', async () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: FAKE_API_KEY,
      })
      await expect(
        result.judgeClient.judge({
          kind: 'thrashing',
          cacheableBlock: 'rubric',
          volatileBlock: 'context',
          modelId: JUDGE_MODEL_ID,
        }),
      ).rejects.toBeInstanceOf(NotImplementedError)
    })

    it('judgeModelId를 생략해도 기본값으로 AnthropicJudgeClient를 반환한다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        // judgeModelId 생략 — 기본값 'claude-3-5-sonnet-20241022' 사용
        apiKey: FAKE_API_KEY,
      })
      expect(result.judgeClient).toBeInstanceOf(AnthropicJudgeClient)
      expect(result.isReal).toBe(true)
    })

    it('false_success kind에서도 NotImplementedError를 throw한다', async () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: FAKE_API_KEY,
      })
      await expect(
        result.judgeClient.judge({
          kind: 'false_success',
          cacheableBlock: 'rubric',
          volatileBlock: 'context',
          modelId: JUDGE_MODEL_ID,
        }),
      ).rejects.toBeInstanceOf(NotImplementedError)
    })
  })

  // ── apiKey 없을 때: MockJudgeClient 폴백 ────────────────────────────────────

  describe('apiKey 없을 때 (MockJudgeClient 폴백)', () => {
    it('judgeClient가 MockJudgeClient 인스턴스이다 (apiKey=undefined)', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: undefined,
      })
      expect(result.judgeClient).toBeInstanceOf(MockJudgeClient)
    })

    it('isReal === false를 반환한다 (apiKey=undefined)', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: undefined,
      })
      expect(result.isReal).toBe(false)
    })

    it('judgeClient가 MockJudgeClient 인스턴스이다 (apiKey 미전달)', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        // apiKey 아예 없음
      })
      expect(result.judgeClient).toBeInstanceOf(MockJudgeClient)
    })

    it('judgeClient가 MockJudgeClient 인스턴스이다 (apiKey 빈 문자열)', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: '',
      })
      expect(result.judgeClient).toBeInstanceOf(MockJudgeClient)
    })

    it('opts 완전 생략 시 judgeClient가 MockJudgeClient이다', () => {
      const result = createApiClients()
      expect(result.judgeClient).toBeInstanceOf(MockJudgeClient)
      expect(result.isReal).toBe(false)
    })
  })

  // ── opts.mock === true: 키 있어도 MockJudgeClient 강제 ─────────────────────

  describe('opts.mock === true (명시적 Mock 강제)', () => {
    it('judgeModelId + apiKey가 있어도 MockJudgeClient를 반환한다', () => {
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: FAKE_API_KEY,
        mock: true,
      })
      expect(result.judgeClient).toBeInstanceOf(MockJudgeClient)
      expect(result.isReal).toBe(false)
    })
  })

  // ── DI 주입: judgeClient 직접 주입 시 그대로 반환 ─────────────────────────

  describe('DI 주입 — judgeClient 직접 주입 우선순위', () => {
    it('주입된 judgeClient가 AnthropicJudgeClient 설정보다 우선한다', () => {
      const injectedJudge = new MockJudgeClient()
      const result = createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: FAKE_API_KEY,
        judgeClient: injectedJudge,
      })
      // DI 최우선: API 키 있어도 주입된 Mock이 반환됨
      expect(result.judgeClient).toBe(injectedJudge)
      expect(result.isReal).toBe(false)
    })

    it('DI AnthropicJudgeClient 인스턴스 주입 시 그대로 반환한다', () => {
      const customJudge = new AnthropicJudgeClient(FAKE_API_KEY, JUDGE_MODEL_ID)
      const result = createApiClients({ judgeClient: customJudge })
      expect(result.judgeClient).toBe(customJudge)
    })
  })

  // ── 경고 로그: apiKey 부재 시 logger.warn 호출 ────────────────────────────

  describe('경고 로그 — apiKey 없을 때 logger.warn 호출 확인', () => {
    it('apiKey 없으면 logger.warn이 호출된다', () => {
      const warnCalls: string[] = []
      const logger = {
        warn: (msg: string) => { warnCalls.push(msg) },
        info: () => undefined,
      }
      createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        logger,
      })
      expect(warnCalls.length).toBeGreaterThan(0)
      expect(warnCalls[0]).toContain('API 키 없음')
    })

    it('judgeModelId + apiKey 있을 때 warn 없이 info만 호출된다', () => {
      const warnCalls: string[] = []
      const infoCalls: string[] = []
      const logger = {
        warn: (msg: string) => { warnCalls.push(msg) },
        info: (msg: string) => { infoCalls.push(msg) },
      }
      createApiClients({
        embedModelId: EMBED_MODEL_ID,
        judgeModelId: JUDGE_MODEL_ID,
        apiKey: FAKE_API_KEY,
        logger,
      })
      expect(warnCalls).toHaveLength(0)
      expect(infoCalls.length).toBeGreaterThan(0)
    })
  })
})
