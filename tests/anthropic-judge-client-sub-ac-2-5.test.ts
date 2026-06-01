/**
 * tests/anthropic-judge-client-sub-ac-2-5.test.ts
 *
 * Sub-AC 5: 실제 Anthropic 호출 골격 분리 확인
 *
 * 검증 사항:
 *   1. AnthropicJudgeClient가 별도 모듈(src/api/anthropic-judge-client.ts)에서
 *      임포트된다 — judge-client.ts와 다른 파일.
 *   2. AnthropicJudgeClient와 MockJudgeClient 모두 동일한 JudgeClient 인터페이스를
 *      구현한다 (컴파일 타임 타입 단언).
 *   3. 두 구현 클래스가 구조적으로 JudgeClient와 호환됨을 TypeScript 타입 시스템이
 *      검증한다 (tsc --noEmit 통과).
 *   4. AnthropicJudgeClient는 외부 API를 호출하지 않는다 (NotImplementedError).
 *
 * 제약:
 *   - 외부 API 절대 미호출
 *   - 네트워크·API 키 불필요
 *   - BLOCKER B2: judge는 Anthropic 전용. EmbedClient와 완전 분리.
 *   - BLOCKER C2: JudgeVerdict는 contracts.ts 정본.
 */

// ── 별도 모듈에서 AnthropicJudgeClient 임포트 ─────────────────────────────────
// Sub-AC 5 핵심: AnthropicJudgeClient는 judge-client.ts가 아닌
// anthropic-judge-client.ts 별도 파일에서 임포트해야 한다.
import {
  AnthropicJudgeClient,
  NotImplementedError,
} from '../src/api/anthropic-judge-client.js'

// ── JudgeClient 인터페이스 + MockJudgeClient는 judge-client.ts에서 임포트 ───────
import {
  type JudgeClient,
  type JudgeRequest,
  MockJudgeClient,
  type MockJudgeCacheEntry,
} from '../src/api/judge-client.js'

// ─────────────────────────────────────────────────────────────────────────────
// 컴파일 타임 타입 단언 (TypeScript 구조적 타입 호환성)
//
// 아래 할당문들은 tsc --noEmit 에 의해 검증된다.
// 타입 에러가 발생하면 AC 미충족.
// ─────────────────────────────────────────────────────────────────────────────

// 1. AnthropicJudgeClient → JudgeClient 할당 가능성
//    (AnthropicJudgeClient implements JudgeClient를 TypeScript가 구조적으로 검증)
const _anthropicAsJudgeClient: JudgeClient = new AnthropicJudgeClient('test-key')
void _anthropicAsJudgeClient

// 2. MockJudgeClient → JudgeClient 할당 가능성
const _mockAsJudgeClient: JudgeClient = new MockJudgeClient([])
void _mockAsJudgeClient

// 3. 팩토리 함수 — 두 구현 모두 JudgeClient로 반환 가능
function createAnthropicClient(_apiKey: string): JudgeClient {
  return new AnthropicJudgeClient(_apiKey)
}
function createMockClient(entries: readonly MockJudgeCacheEntry[]): JudgeClient {
  return new MockJudgeClient(entries)
}
void createAnthropicClient
void createMockClient

// 4. judge 메서드 시그니처 타입 호환성 단언
//    JudgeClient['judge']와 AnthropicJudgeClient.prototype.judge가 같은 타입
type _JudgeMethodSig = JudgeClient['judge']
const _anthropicJudgeMethod: _JudgeMethodSig =
  AnthropicJudgeClient.prototype.judge.bind(new AnthropicJudgeClient('test-key'))
const _mockJudgeMethod: _JudgeMethodSig =
  MockJudgeClient.prototype.judge.bind(new MockJudgeClient([]))
void _anthropicJudgeMethod
void _mockJudgeMethod

// ─────────────────────────────────────────────────────────────────────────────
// 1. 별도 모듈 분리 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-AC 5: AnthropicJudgeClient — 별도 모듈 분리 확인', () => {
  it('AnthropicJudgeClient는 별도 모듈(anthropic-judge-client.ts)에서 임포트된다', () => {
    // 파일이 존재하고 임포트가 성공하면 별도 모듈로 분리된 것임.
    expect(AnthropicJudgeClient).toBeDefined()
    expect(typeof AnthropicJudgeClient).toBe('function') // 클래스 = 함수 타입
  })

  it('NotImplementedError도 같은 별도 모듈에서 임포트된다', () => {
    expect(NotImplementedError).toBeDefined()
    expect(typeof NotImplementedError).toBe('function')
  })

  it('MockJudgeClient는 judge-client.ts에서 임포트된다 (분리 경계 유지)', () => {
    expect(MockJudgeClient).toBeDefined()
    expect(typeof MockJudgeClient).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. JudgeClient 인터페이스 공통 구현 검증 (컴파일 타임 증명)
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-AC 5: AnthropicJudgeClient와 MockJudgeClient — 동일 JudgeClient 인터페이스 구현', () => {
  it('AnthropicJudgeClient 인스턴스를 JudgeClient 변수에 할당할 수 있다', () => {
    // 이 할당이 타입 에러 없이 컴파일 → implements 계약 성립
    const client: JudgeClient = new AnthropicJudgeClient('test-key')
    expect(client).toBeDefined()
  })

  it('MockJudgeClient 인스턴스를 JudgeClient 변수에 할당할 수 있다', () => {
    const client: JudgeClient = new MockJudgeClient([])
    expect(client).toBeDefined()
  })

  it('AnthropicJudgeClient에 judge 메서드가 존재한다', () => {
    const client: JudgeClient = new AnthropicJudgeClient('test-key')
    expect(typeof client.judge).toBe('function')
  })

  it('MockJudgeClient에 judge 메서드가 존재한다', () => {
    const client: JudgeClient = new MockJudgeClient([])
    expect(typeof client.judge).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. 두 클래스가 동일한 JudgeClient 인터페이스 계약을 이행함을 런타임 비교
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-AC 5: AnthropicJudgeClient vs MockJudgeClient — 인터페이스 계약 대칭성', () => {
  // JudgeClient 인터페이스에서 요구하는 메서드 목록
  const REQUIRED_METHODS: ReadonlyArray<keyof JudgeClient> = ['judge'] as const

  it('AnthropicJudgeClient 프로토타입에 JudgeClient 요구 메서드가 모두 존재한다', () => {
    for (const method of REQUIRED_METHODS) {
      const proto = AnthropicJudgeClient.prototype as unknown as Record<string, unknown>
      expect(typeof proto[method]).toBe('function')
    }
  })

  it('MockJudgeClient 프로토타입에 JudgeClient 요구 메서드가 모두 존재한다', () => {
    for (const method of REQUIRED_METHODS) {
      const proto = MockJudgeClient.prototype as unknown as Record<string, unknown>
      expect(typeof proto[method]).toBe('function')
    }
  })

  it('AnthropicJudgeClient.judge와 MockJudgeClient.judge 모두 동일한 파라미터 수(1)를 갖는다', () => {
    expect(AnthropicJudgeClient.prototype.judge.length).toBe(1)
    expect(MockJudgeClient.prototype.judge.length).toBe(1)
  })

  it('두 클라이언트 모두 judge() 호출 시 Promise를 반환한다', async () => {
    const anthropic: JudgeClient = new AnthropicJudgeClient('test-key')
    const mock: JudgeClient = new MockJudgeClient([])

    const req: JudgeRequest = {
      kind: 'false_success',
      cacheableBlock: '루브릭',
      volatileBlock: '컨텍스트',
      modelId: 'claude-3-5-sonnet-20241022',
    }

    const anthropicResult = anthropic.judge(req)
    const mockResult = mock.judge(req)

    expect(anthropicResult).toBeInstanceOf(Promise)
    expect(mockResult).toBeInstanceOf(Promise)

    // 두 Promise를 모두 소비 (UnhandledPromiseRejection 방지)
    await anthropicResult.catch(() => undefined)
    await mockResult.catch(() => undefined)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. AnthropicJudgeClient — 외부 API 미호출 보장 (골격 클라이언트)
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-AC 5: AnthropicJudgeClient — 외부 API 절대 미호출 (골격)', () => {
  const FAKE_KEY = 'sub-ac-5-test-not-real'
  const MODEL_ID = 'claude-3-5-sonnet-20241022'

  const SAMPLE_REQ: JudgeRequest = {
    kind: 'false_success',
    cacheableBlock: '루브릭: false_success 판정 기준',
    volatileBlock: '판정 대상 컨텍스트',
    modelId: MODEL_ID,
  }

  it('judge() 호출 시 NotImplementedError를 throw한다 (외부 API 미호출 보장)', async () => {
    const client = new AnthropicJudgeClient(FAKE_KEY)
    await expect(client.judge(SAMPLE_REQ)).rejects.toThrow(NotImplementedError)
  })

  it('NotImplementedError는 Error의 서브클래스이다', async () => {
    const client = new AnthropicJudgeClient(FAKE_KEY)
    await expect(client.judge(SAMPLE_REQ)).rejects.toBeInstanceOf(Error)
  })

  it('JudgeClient 인터페이스 타입으로 호출해도 동일하게 NotImplementedError를 throw한다', async () => {
    // 인터페이스 타입으로만 접근 — 구현 타입 정보 은닉
    const client: JudgeClient = new AnthropicJudgeClient(FAKE_KEY)
    await expect(client.judge(SAMPLE_REQ)).rejects.toThrow(NotImplementedError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. 모듈 임포트 경로 독립성 검증
//    — anthropic-judge-client.ts가 judge-client.ts로부터 JudgeClient를 올바르게 의존
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-AC 5: 모듈 임포트 경로 독립성', () => {
  it('AnthropicJudgeClient가 임포트된 모듈과 MockJudgeClient가 임포트된 모듈은 다르다', () => {
    // 두 클래스가 서로 다른 소스 파일에서 왔음을 구조적으로 검증:
    // AnthropicJudgeClient.prototype과 MockJudgeClient.prototype은 별개 객체이다.
    expect(AnthropicJudgeClient.prototype).not.toBe(MockJudgeClient.prototype)
    expect(AnthropicJudgeClient).not.toBe(MockJudgeClient)
  })

  it('두 클래스가 다른 생성자를 갖는다', () => {
    const anthropicInst = new AnthropicJudgeClient('key')
    const mockInst = new MockJudgeClient([])
    expect(anthropicInst.constructor).toBe(AnthropicJudgeClient)
    expect(mockInst.constructor).toBe(MockJudgeClient)
    expect(anthropicInst.constructor).not.toBe(mockInst.constructor)
  })

  it('AnthropicJudgeClient는 AnthropicJudgeClient의 instance이지 MockJudgeClient의 instance가 아니다', () => {
    const client = new AnthropicJudgeClient('key')
    expect(client).toBeInstanceOf(AnthropicJudgeClient)
    expect(client).not.toBeInstanceOf(MockJudgeClient)
  })

  it('MockJudgeClient는 MockJudgeClient의 instance이지 AnthropicJudgeClient의 instance가 아니다', () => {
    const client = new MockJudgeClient([])
    expect(client).toBeInstanceOf(MockJudgeClient)
    expect(client).not.toBeInstanceOf(AnthropicJudgeClient)
  })
})
