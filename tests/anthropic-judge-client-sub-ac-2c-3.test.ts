/**
 * tests/anthropic-judge-client-sub-ac-2c-3.test.ts
 *
 * Sub-AC 2c-3: AnthropicJudgeClient의 메서드 시그니처가 JudgeClient 인터페이스와
 * 완전히 일치하는지(파라미터 타입·반환 타입)를 런타임 반사(reflection) 또는
 * 타입 단언 테스트로 독립 검증한다.
 *
 * 검증 전략:
 *   A. 컴파일 타임 타입 단언 — TypeScript satisfies/assignability 패턴으로
 *      AnthropicJudgeClient가 JudgeClient를 완전 충족하는지 정적 증명.
 *   B. 런타임 반사 — judge 메서드 존재 여부, Function.length(파라미터 수),
 *      반환값이 Promise인지, 메서드 이름 등을 런타임에서 검증.
 *   C. 시그니처 불변성 — JudgeClient 인터페이스가 요구하는 메서드 이름 집합과
 *      AnthropicJudgeClient 프로토타입의 메서드 집합을 비교.
 *
 * 제약:
 *   - 외부 API 절대 미호출 — AnthropicJudgeClient는 NotImplementedError를 throw
 *   - 네트워크·API 키 불필요 (골격 클라이언트)
 *   - BLOCKER B2: judge는 Anthropic 전용
 *   - BLOCKER C2: JudgeVerdict는 contracts.ts 정본
 */

import {
  AnthropicJudgeClient,
  NotImplementedError,
} from '../src/api/anthropic-judge-client.js'
import {
  type JudgeClient,
  type JudgeRequest,
  type JudgeVerdict,
} from '../src/api/judge-client.js'

// ── 공통 픽스처 ───────────────────────────────────────────────────────────────

const FAKE_API_KEY = 'sub-ac-2c-3-test-key-not-real'
const MODEL_ID = 'claude-3-5-sonnet-20241022'

// ─────────────────────────────────────────────────────────────────────────────
// A. 컴파일 타임 타입 단언 (TypeScript 구조적 타입 호환성)
//
// 아래 두 패턴은 TypeScript 컴파일러가 타입 에러를 발생시키지 않으면
// AnthropicJudgeClient가 JudgeClient 계약을 완전 이행함을 증명한다.
// ─────────────────────────────────────────────────────────────────────────────

// 1. 직접 할당 단언 — "JudgeClient 변수에 AnthropicJudgeClient 할당 가능"
const _typeAssert1: JudgeClient = new AnthropicJudgeClient(FAKE_API_KEY)
void _typeAssert1 // 미사용 경고 방지

// 2. satisfies 패턴 — 타입이 인터페이스를 완전 충족
const _satisfiesFactory: () => JudgeClient = () =>
  new AnthropicJudgeClient(FAKE_API_KEY)
void _satisfiesFactory

// 3. judge 메서드 시그니처 타입 단언:
//    JudgeClient['judge']는 (req: JudgeRequest) => Promise<JudgeVerdict>
//    AnthropicJudgeClient.prototype.judge에 JudgeRequest를 넘겼을 때
//    Promise<JudgeVerdict>가 반환되는지 컴파일러가 검증한다.
type _JudgeMethodType = JudgeClient['judge']
// AnthropicJudgeClient의 judge 메서드가 _JudgeMethodType에 할당 가능한지 확인
const _judgeMethodAssign: _JudgeMethodType =
  AnthropicJudgeClient.prototype.judge.bind(
    new AnthropicJudgeClient(FAKE_API_KEY)
  )
void _judgeMethodAssign

// ─────────────────────────────────────────────────────────────────────────────
// B. 런타임 반사 — 메서드 존재·파라미터 수·반환 타입 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-AC 2c-3: AnthropicJudgeClient 런타임 반사 — 메서드 존재', () => {
  it('AnthropicJudgeClient 프로토타입에 "judge" 메서드가 존재한다', () => {
    expect(typeof AnthropicJudgeClient.prototype.judge).toBe('function')
  })

  it('"judge" 메서드가 정확히 1개의 파라미터(req)를 선언한다', () => {
    // Function.length는 선언된 파라미터 수를 반환한다.
    // JudgeClient 인터페이스: judge(req: JudgeRequest): Promise<JudgeVerdict>
    // → 파라미터 1개 (_req)
    expect(AnthropicJudgeClient.prototype.judge.length).toBe(1)
  })

  it('"judge" 메서드는 항상 Promise를 반환한다 (async 시그니처 보장)', async () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY)
    const req: JudgeRequest = {
      kind: 'false_success',
      cacheableBlock: '루브릭',
      volatileBlock: '컨텍스트',
      modelId: MODEL_ID,
    }
    const result = client.judge(req)
    // 반환 즉시 Promise여야 한다 (JudgeClient 인터페이스 반환 타입 준수)
    expect(result).toBeInstanceOf(Promise)
    // Promise를 소비하여 UnhandledPromiseRejection 방지
    await result.catch(() => undefined)
  })

  it('"judge" 메서드 이름이 "judge"이다 (메서드명 불변성)', () => {
    expect(AnthropicJudgeClient.prototype.judge.name).toBe('judge')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C. 인터페이스 메서드 집합 vs 프로토타입 메서드 집합 비교
//
// JudgeClient 인터페이스가 요구하는 메서드 목록을 SPEC 정본에서 수동 열거하고,
// AnthropicJudgeClient 프로토타입에 해당 메서드가 모두 존재하는지 검증한다.
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-AC 2c-3: JudgeClient 인터페이스 메서드 집합 완전성 검증', () => {
  // JudgeClient 인터페이스가 요구하는 메서드 목록 (SPEC §4 + judge-client.ts 정본)
  const REQUIRED_JUDGE_CLIENT_METHODS: ReadonlyArray<keyof JudgeClient> = [
    'judge',
  ] as const

  it('AnthropicJudgeClient 프로토타입이 JudgeClient의 모든 메서드를 구현한다', () => {
    for (const method of REQUIRED_JUDGE_CLIENT_METHODS) {
      const proto = AnthropicJudgeClient.prototype as unknown as Record<string, unknown>
      const methodType = typeof proto[method]
      if (methodType !== 'function') {
        throw new Error(`메서드 "${method}"가 AnthropicJudgeClient.prototype에 없음 (type=${methodType})`)
      }
      expect(methodType).toBe('function')
    }
  })

  it('인스턴스에서도 JudgeClient의 모든 메서드에 접근 가능하다', () => {
    const instance = new AnthropicJudgeClient(FAKE_API_KEY)
    for (const method of REQUIRED_JUDGE_CLIENT_METHODS) {
      const inst = instance as unknown as Record<string, unknown>
      const methodType = typeof inst[method]
      if (methodType !== 'function') {
        throw new Error(`인스턴스에서 메서드 "${method}"에 접근 불가 (type=${methodType})`)
      }
      expect(methodType).toBe('function')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// D. 파라미터 타입 호환성 — JudgeRequest의 모든 필수 필드로 호출 가능
//
// judge(req: JudgeRequest)에서 JudgeRequest의 필수 필드(kind, cacheableBlock,
// volatileBlock, modelId)가 모두 있어야 컴파일 에러 없이 호출된다.
// 이를 런타임에서 다양한 req 형태로 검증한다.
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-AC 2c-3: judge() 파라미터 타입 호환성 — JudgeRequest 필드', () => {
  const client = new AnthropicJudgeClient(FAKE_API_KEY)

  const MINIMAL_REQ_THRASHING: JudgeRequest = {
    kind: 'thrashing',
    cacheableBlock: '루브릭 thrashing',
    volatileBlock: '컨텍스트 thrashing',
    modelId: MODEL_ID,
  }

  const MINIMAL_REQ_FALSE_SUCCESS: JudgeRequest = {
    kind: 'false_success',
    cacheableBlock: '루브릭 false_success',
    volatileBlock: '컨텍스트 false_success',
    modelId: MODEL_ID,
  }

  const REQ_WITH_TEMPERATURE: JudgeRequest = {
    kind: 'false_success',
    cacheableBlock: '루브릭',
    volatileBlock: '컨텍스트',
    modelId: MODEL_ID,
    temperature: 0.4,
  }

  for (const [label, req] of [
    ['kind=thrashing 최소 필드', MINIMAL_REQ_THRASHING],
    ['kind=false_success 최소 필드', MINIMAL_REQ_FALSE_SUCCESS],
    ['temperature 옵션 포함', REQ_WITH_TEMPERATURE],
  ] as const) {
    it(`judge()가 "${label}" JudgeRequest를 받아 Promise를 반환한다`, async () => {
      const result = client.judge(req)
      expect(result).toBeInstanceOf(Promise)
      await result.catch(() => undefined)
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// E. 반환 타입 호환성 — Promise<JudgeVerdict> 계약
//
// AnthropicJudgeClient.judge()가 반환하는 Promise의 rejection이
// NotImplementedError(골격)임을 확인하고, 성공 경로라면
// JudgeVerdict 타입의 값이 resolve되어야 함을 타입 레벨에서 단언한다.
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-AC 2c-3: judge() 반환 타입 — Promise<JudgeVerdict> 계약', () => {
  it('judge()의 반환값은 Promise<JudgeVerdict> 타입 변수에 할당 가능하다', () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY)
    const req: JudgeRequest = {
      kind: 'false_success',
      cacheableBlock: '루브릭',
      volatileBlock: '컨텍스트',
      modelId: MODEL_ID,
    }
    // 타입 단언: judge()의 반환 타입이 Promise<JudgeVerdict>에 할당 가능
    const result: Promise<JudgeVerdict> = client.judge(req)
    expect(result).toBeInstanceOf(Promise)
    result.catch(() => undefined)
  })

  it('골격 상태에서 judge()는 NotImplementedError로 reject된다', async () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY)
    const req: JudgeRequest = {
      kind: 'false_success',
      cacheableBlock: '루브릭',
      volatileBlock: '컨텍스트',
      modelId: MODEL_ID,
    }
    await expect(client.judge(req)).rejects.toThrow(NotImplementedError)
  })

  it('JudgeClient 인터페이스 변수를 통해 호출해도 동일하게 동작한다', async () => {
    // JudgeClient 인터페이스 타입으로만 접근 — 실제 구현 타입을 숨김
    const client: JudgeClient = new AnthropicJudgeClient(FAKE_API_KEY)
    const req: JudgeRequest = {
      kind: 'false_success',
      cacheableBlock: '루브릭',
      volatileBlock: '컨텍스트',
      modelId: MODEL_ID,
    }
    const result: Promise<JudgeVerdict> = client.judge(req)
    expect(result).toBeInstanceOf(Promise)
    await expect(result).rejects.toThrow(NotImplementedError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// F. instanceof 기반 클래스 계층 반사 검증
// ─────────────────────────────────────────────────────────────────────────────

describe('Sub-AC 2c-3: AnthropicJudgeClient 클래스 계층 반사', () => {
  it('AnthropicJudgeClient 인스턴스는 AnthropicJudgeClient의 instance이다', () => {
    const client = new AnthropicJudgeClient(FAKE_API_KEY)
    expect(client).toBeInstanceOf(AnthropicJudgeClient)
  })

  it('AnthropicJudgeClient는 클래스(함수 타입)이다', () => {
    expect(typeof AnthropicJudgeClient).toBe('function')
  })

  it('AnthropicJudgeClient.prototype.constructor는 AnthropicJudgeClient 자신이다', () => {
    expect(AnthropicJudgeClient.prototype.constructor).toBe(AnthropicJudgeClient)
  })

  it('AnthropicJudgeClient.prototype에 "judge"가 own property로 정의되어 있다', () => {
    expect(
      Object.prototype.hasOwnProperty.call(AnthropicJudgeClient.prototype, 'judge')
    ).toBe(true)
  })
})
