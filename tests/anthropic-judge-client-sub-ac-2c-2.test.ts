/**
 * tests/anthropic-judge-client-sub-ac-2c-2.test.ts
 *
 * Sub-AC 2c-2: AnthropicJudgeClient 클래스가 별도 모듈에 구현되고,
 * 생성자가 apiKey 등 필수 파라미터를 받으며, JudgeClient 인터페이스를
 * implements함을 타입 체크(tsc --noEmit 동등)로 검증한다.
 *
 * 검증 사항:
 *   1. AnthropicJudgeClient는 src/api/anthropic-judge-client.ts 별도 모듈에서 임포트됨
 *   2. 생성자가 apiKey(string) 필수 파라미터를 받음
 *   3. JudgeClient 인터페이스를 implements — judge(req) 메서드 존재
 *   4. judge() 호출 시 NotImplementedError를 throw (네트워크 미호출 보장)
 *   5. JudgeClient 타입 변수에 할당 가능 (구조적 타입 호환)
 *   6. defaultModelId 선택 파라미터 동작 검증
 *
 * 제약:
 *   - 외부 API 절대 미호출 — AnthropicJudgeClient.judge()는 항상 NotImplementedError를 throw
 *   - 네트워크·API 키 불필요 (골격 클라이언트이므로)
 *   - BLOCKER B2: judge는 Anthropic 전용. EmbedClient와 완전 분리.
 *   - BLOCKER C2: JudgeVerdict는 contracts.ts 정본.
 */

import {
  AnthropicJudgeClient,
  NotImplementedError,
} from '../src/api/anthropic-judge-client.js'
import { type JudgeClient, type JudgeRequest } from '../src/api/judge-client.js'

// ── 공통 픽스처 ───────────────────────────────────────────────────────────────

const FAKE_API_KEY = 'test-api-key-not-real'
const MODEL_ID = 'claude-3-5-sonnet-20241022'

const SAMPLE_REQ: JudgeRequest = {
  kind: 'false_success',
  cacheableBlock: '루브릭: false_success 판정 기준...',
  volatileBlock: '판정 대상 컨텍스트: step 1~10',
  modelId: MODEL_ID,
}

// ── 1. 생성자 파라미터 검증 ────────────────────────────────────────────────────

describe('AnthropicJudgeClient — 생성자 파라미터', () => {
  it('apiKey 필수 파라미터로 인스턴스를 생성한다', () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY)
    expect(client).toBeInstanceOf(AnthropicJudgeClient)
  })

  it('apiKey와 defaultModelId 파라미터로 인스턴스를 생성한다', () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY, MODEL_ID)
    expect(client).toBeInstanceOf(AnthropicJudgeClient)
  })

  it('defaultModelId를 생략하면 기본값 "claude-3-5-sonnet-20241022"를 사용한다', () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY)
    expect(client.defaultModelId).toBe('claude-3-5-sonnet-20241022')
  })

  it('명시적 defaultModelId를 저장한다', () => {
    const customModel = 'claude-3-opus-20240229'
    const client = new AnthropicJudgeClient(FAKE_API_KEY, customModel)
    expect(client.defaultModelId).toBe(customModel)
  })
})

// ── 2. JudgeClient 인터페이스 implements 검증 (타입 레벨) ─────────────────────

describe('AnthropicJudgeClient — JudgeClient 인터페이스 구현 (타입 레벨)', () => {
  it('JudgeClient 타입 변수에 할당 가능하다 (구조적 타입 호환)', () => {
    // 이 할당이 tsc --noEmit 에러 없이 컴파일되면 implements 계약이 성립한다.
    const client: JudgeClient = new AnthropicJudgeClient(FAKE_API_KEY)
    expect(client).toBeDefined()
  })

  it('judge 메서드가 존재한다', () => {
    const client: JudgeClient = new AnthropicJudgeClient(FAKE_API_KEY)
    expect(typeof client.judge).toBe('function')
  })

  it('judge 메서드는 Promise를 반환한다', () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY)
    // judge()는 NotImplementedError를 throw하지만 Promise 타입이어야 한다
    const result = client.judge(SAMPLE_REQ)
    expect(result).toBeInstanceOf(Promise)
    // Promise rejection을 소비하여 UnhandledPromiseRejection 방지
    result.catch(() => undefined)
  })
})

// ── 3. 골격 클라이언트 동작 검증 (외부 API 미호출 보장) ───────────────────────

describe('AnthropicJudgeClient — 골격 동작 (NotImplementedError)', () => {
  it('judge() 호출 시 NotImplementedError를 throw한다 (외부 API 미호출 보장)', async () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY)
    await expect(client.judge(SAMPLE_REQ)).rejects.toThrow(NotImplementedError)
  })

  it('NotImplementedError는 Error의 서브클래스이다', async () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY)
    await expect(client.judge(SAMPLE_REQ)).rejects.toBeInstanceOf(Error)
  })

  it('에러 메시지에 "미활성화" 안내가 포함된다', async () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY)
    await expect(client.judge(SAMPLE_REQ)).rejects.toThrow('미활성화')
  })

  it('에러 메시지에 MockJudgeClient 사용 안내가 포함된다', async () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY)
    await expect(client.judge(SAMPLE_REQ)).rejects.toThrow('MockJudgeClient')
  })

  it('thrashing kind 요청에도 동일하게 NotImplementedError를 throw한다', async () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY)
    const req: JudgeRequest = {
      kind: 'thrashing',
      cacheableBlock: '루브릭',
      volatileBlock: '컨텍스트',
      modelId: MODEL_ID,
    }
    await expect(client.judge(req)).rejects.toThrow(NotImplementedError)
  })

  it('temperature 옵션이 있는 요청에도 동일하게 NotImplementedError를 throw한다', async () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY)
    const req: JudgeRequest = {
      kind: 'false_success',
      cacheableBlock: '루브릭',
      volatileBlock: '컨텍스트',
      modelId: MODEL_ID,
      temperature: 0.4,
    }
    await expect(client.judge(req)).rejects.toThrow(NotImplementedError)
  })
})

// ── 4. NotImplementedError 클래스 자체 검증 ───────────────────────────────────

describe('NotImplementedError — 클래스 계약', () => {
  it('NotImplementedError 인스턴스 생성 및 메시지 검증', () => {
    const err = new NotImplementedError('테스트 에러 메시지')
    expect(err).toBeInstanceOf(NotImplementedError)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('테스트 에러 메시지')
    expect(err.name).toBe('NotImplementedError')
  })
})

// ── 5. 별도 모듈 임포트 검증 ──────────────────────────────────────────────────

describe('AnthropicJudgeClient — 별도 모듈(anthropic-judge-client.ts)에서 임포트', () => {
  it('AnthropicJudgeClient는 judge-client.ts가 아닌 별도 모듈에서 임포트된다', () => {
    // 이 테스트는 import 경로가 '../src/api/anthropic-judge-client.js'임을
    // 코드 구조로 검증한다. 파일이 존재하고 임포트가 성공하면 조건 충족.
    expect(AnthropicJudgeClient).toBeDefined()
    expect(typeof AnthropicJudgeClient).toBe('function') // 클래스는 함수 타입
  })

  it('JudgeClient 인터페이스는 judge-client.ts에서 임포트된다 (분리 경계 유지)', () => {
    // judge-client.ts에서 JudgeClient 타입을 임포트하고
    // anthropic-judge-client.ts에서 AnthropicJudgeClient를 임포트하는 구조가
    // 컴파일 에러 없이 동작해야 한다.
    const client: JudgeClient = new AnthropicJudgeClient(FAKE_API_KEY)
    expect(client).toBeDefined()
  })
})
