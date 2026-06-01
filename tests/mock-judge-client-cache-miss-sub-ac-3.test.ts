/**
 * tests/mock-judge-client-cache-miss-sub-ac-3.test.ts
 *
 * Sub-AC 3: MockJudgeClient 캐시 미스 에러 —
 *   캐시에 없는 키로 `judge()`를 호출하면 에러를 throw하는 동작을 독립 단위 테스트로 검증.
 *
 * 검증 사항:
 *   1. 빈 클라이언트에서 judge() 호출 시 에러를 throw한다
 *   2. 에러 메시지에 "캐시 미스" 텍스트가 포함된다
 *   3. 에러 메시지에 실제 사용된 키 정보가 포함된다
 *   4. 등록된 키는 성공하지만 미등록 키는 여전히 에러를 throw한다
 *   5. _cacheKey 오버라이드를 사용한 미등록 키도 에러를 throw한다
 *   6. 조용한 폴백(undefined 반환, null 반환)이 아닌 명시적 throw 확인
 *
 * 제약: 외부 API 절대 미호출 — MockJudgeClient만 사용.
 * SPEC 제약: 캐시 미스 시 조용한 폴백 금지, 명시적 에러 throw 필수.
 */

import {
  MockJudgeClient,
  type JudgeVerdict,
  type JudgeRequest,
  type MockJudgeCacheEntry,
} from '../src/api/judge-client.js'

// ── 테스트 픽스처 ─────────────────────────────────────────────────────────────

const MODEL_ID = 'claude-3-5-sonnet-20241022'

const VERDICT_NONE: JudgeVerdict = {
  kind: 'none',
  subtype: '',
  confidence: 0.05,
  reason: '정상입니다.',
  rawSamples: [],
}

const VERDICT_THRASHING: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'stuck_error_loop',
  confidence: 0.85,
  reason: '동일 에러가 5회 반복되었습니다.',
  rawSamples: [],
}

function makeReq(
  kind: 'thrashing' | 'false_success' = 'false_success',
  modelId = MODEL_ID,
): JudgeRequest {
  return {
    kind,
    cacheableBlock: '루브릭 텍스트',
    volatileBlock: '변동 컨텍스트',
    modelId,
  }
}

// ── 테스트: 빈 클라이언트에서 캐시 미스 ──────────────────────────────────────

describe('MockJudgeClient — 캐시 미스 시 에러 throw (빈 클라이언트)', () => {
  const client = new MockJudgeClient([])

  it('빈 클라이언트에서 judge() 호출 시 에러를 throw한다', async () => {
    const req = makeReq()
    await expect(client.judge(req)).rejects.toThrow()
  })

  it('에러 메시지에 "캐시 미스" 텍스트가 포함된다', async () => {
    const req = makeReq()
    await expect(client.judge(req)).rejects.toThrow('캐시 미스')
  })

  it('에러는 Error 인스턴스이다 (조용한 폴백 아님)', async () => {
    const req = makeReq()
    let caught: unknown = null
    try {
      await client.judge(req)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
  })

  it('반환값이 undefined/null이 아니라 throw한다', async () => {
    const req = makeReq()
    let didThrow = false
    try {
      await client.judge(req)
    } catch {
      didThrow = true
    }
    expect(didThrow).toBe(true)
  })
})

// ── 테스트: 에러 메시지에 키 정보 포함 ──────────────────────────────────────

describe('MockJudgeClient — 에러 메시지에 키 정보 포함', () => {
  const client = new MockJudgeClient([])

  it('에러 메시지에 사용된 캐시 키가 포함된다 (기본 키: kind:modelId)', async () => {
    const req = makeReq('false_success', MODEL_ID)
    const expectedKey = `false_success:${MODEL_ID}`
    await expect(client.judge(req)).rejects.toThrow(expectedKey)
  })

  it('kind=thrashing 요청의 에러 메시지에도 키가 포함된다', async () => {
    const req = makeReq('thrashing', MODEL_ID)
    const expectedKey = `thrashing:${MODEL_ID}`
    await expect(client.judge(req)).rejects.toThrow(expectedKey)
  })

  it('다른 modelId의 에러 메시지에도 해당 키가 포함된다', async () => {
    const altModel = 'claude-3-opus-20240229'
    const req = makeReq('false_success', altModel)
    const expectedKey = `false_success:${altModel}`
    await expect(client.judge(req)).rejects.toThrow(expectedKey)
  })
})

// ── 테스트: _cacheKey 오버라이드 사용 시 캐시 미스 ──────────────────────────

describe('MockJudgeClient — _cacheKey 오버라이드 미등록 시 에러 throw', () => {
  const client = new MockJudgeClient([])

  it('_cacheKey를 지정해도 미등록이면 에러를 throw한다', async () => {
    const req = {
      ...makeReq(),
      _cacheKey: 'unregistered-sha256-key:claude-model',
    } as JudgeRequest & { _cacheKey: string }
    await expect(client.judge(req)).rejects.toThrow('캐시 미스')
  })

  it('_cacheKey 오버라이드 에러 메시지에 해당 키가 포함된다', async () => {
    const customKey = 'abc123def456:claude-3-5-sonnet-20241022'
    const req = {
      ...makeReq(),
      _cacheKey: customKey,
    } as JudgeRequest & { _cacheKey: string }
    await expect(client.judge(req)).rejects.toThrow(customKey)
  })
})

// ── 테스트: 등록된 키는 성공, 미등록 키는 에러 ───────────────────────────────

describe('MockJudgeClient — 등록/미등록 키 혼재 시 동작', () => {
  const registeredKey = `false_success:${MODEL_ID}`
  const entry: MockJudgeCacheEntry = {
    cacheKey: registeredKey,
    verdict: VERDICT_NONE,
  }
  const client = new MockJudgeClient([entry])

  it('등록된 키로 judge()를 호출하면 올바른 verdict를 반환한다', async () => {
    const req = makeReq('false_success', MODEL_ID)
    const result = await client.judge(req)
    expect(result.kind).toBe('none')
  })

  it('미등록 키(다른 kind)로 호출하면 에러를 throw한다', async () => {
    const req = makeReq('thrashing', MODEL_ID) // thrashing:MODEL_ID 는 미등록
    await expect(client.judge(req)).rejects.toThrow('캐시 미스')
  })

  it('미등록 키(다른 modelId)로 호출하면 에러를 throw한다', async () => {
    const req = makeReq('false_success', 'claude-3-opus-20240229') // 다른 모델 미등록
    await expect(client.judge(req)).rejects.toThrow('캐시 미스')
  })

  it('등록 키는 여러 번 호출해도 에러 없이 반환된다', async () => {
    const req = makeReq('false_success', MODEL_ID)
    for (let i = 0; i < 3; i++) {
      const result = await client.judge(req)
      expect(result).toEqual(VERDICT_NONE)
    }
  })
})

// ── 테스트: register() 후에도 미등록 키는 에러 ───────────────────────────────

describe('MockJudgeClient — register() 후 미등록 키는 여전히 에러', () => {
  it('register() 후 새 인스턴스에서 미등록 키는 에러를 throw한다', async () => {
    const original = new MockJudgeClient([])
    const key = `false_success:${MODEL_ID}`
    const extended = original.register({ cacheKey: key, verdict: VERDICT_THRASHING })

    // 확장 인스턴스: 등록된 키는 성공
    const result = await extended.judge(makeReq('false_success', MODEL_ID))
    expect(result.kind).toBe('thrashing')

    // 확장 인스턴스: 미등록 키는 에러
    await expect(extended.judge(makeReq('thrashing', MODEL_ID))).rejects.toThrow('캐시 미스')

    // 원본 인스턴스: 여전히 미등록
    await expect(original.judge(makeReq('false_success', MODEL_ID))).rejects.toThrow('캐시 미스')
  })

  it('register()는 원본을 변경하지 않는다 (불변성)', async () => {
    const original = new MockJudgeClient([])
    const key = `false_success:${MODEL_ID}`
    original.register({ cacheKey: key, verdict: VERDICT_NONE }) // 반환값 무시

    // 원본은 여전히 미등록 상태
    await expect(original.judge(makeReq('false_success', MODEL_ID))).rejects.toThrow('캐시 미스')
  })
})
