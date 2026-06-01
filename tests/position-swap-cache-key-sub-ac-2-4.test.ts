/**
 * tests/position-swap-cache-key-sub-ac-2-4.test.ts
 *
 * Sub-AC 2.4: position swap 별도 캐시 엔트리
 *
 * 검증 항목:
 *   prompt A+B와 swap된 prompt B+A가 각각 다른 sha256 키를 생성하여
 *   독립적인 캐시 엔트리로 조회됨을 단위 테스트로 검증한다.
 *
 * SPEC §5 position swap 편향완화 설계 요건:
 *   - 원본 prompt(cacheableBlock + volatileBlock_A+B)와
 *     swap prompt(cacheableBlock + volatileBlock_B+A)는
 *     서로 다른 sha256 해시를 생성한다.
 *   - 두 프롬프트는 MockJudgeClientWithHashKey에 독립적인 캐시 엔트리로 등록된다.
 *   - 각각 다른 JudgeVerdict를 반환할 수 있다(독립 조회).
 *   - 미등록 swap 키는 CacheMissError를 throw한다(조용한 폴백 금지).
 *
 * 외부 API 절대 미호출 — 모든 테스트는 MockJudgeClientWithHashKey + sha256Prompt만 사용.
 * 네트워크·API 키 불필요.
 */

import { createHash } from 'node:crypto'
import {
  MockJudgeClientWithHashKey,
  sha256Prompt,
  type JudgeRequest,
  type JudgeVerdict,
  type MockJudgeHashEntry,
} from '../src/api/judge-client.js'

// ── 테스트 픽스처 ─────────────────────────────────────────────────────────────

const MODEL_ID = 'claude-3-5-sonnet-20241022'

/** 원본 순서(A→B) 판정 결과 */
const VERDICT_ORIGINAL: JudgeVerdict = {
  kind: 'false_success',
  subtype: 'unverified_completion',
  confidence: 0.88,
  topicDivergence: 0.1,
  circularReference: false,
  reason: '원본 순서(A→B) 판정: 완료선언 직전 검증 근거 없음',
  rawSamples: ['original-order-sample'],
}

/** swap 순서(B→A) 판정 결과 */
const VERDICT_SWAPPED: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'stuck_error_loop',
  confidence: 0.75,
  topicDivergence: 0.3,
  circularReference: true,
  reason: 'swap 순서(B→A) 판정: 동일 패턴 반복 감지',
  rawSamples: ['swapped-order-sample'],
}

// ── 헬퍼 함수 ─────────────────────────────────────────────────────────────────

/**
 * SPEC §1 표준 e: cacheKey = sha256(cacheableBlock + volatileBlock) + ':' + modelId
 */
function makeCacheKey(cacheableBlock: string, volatileBlock: string, modelId: string): string {
  const prompt = cacheableBlock + volatileBlock
  return `${sha256Prompt(prompt)}:${modelId}`
}

function makeReq(
  cacheableBlock: string,
  volatileBlock: string,
  modelId = MODEL_ID,
): JudgeRequest {
  return {
    kind: 'false_success',
    cacheableBlock,
    volatileBlock,
    modelId,
  }
}

// ── 핵심: position swap 캐시 키 독립성 ─────────────────────────────────────────

describe('position swap 캐시 키 독립성 (Sub-AC 2.4)', () => {
  const CACHEABLE = '루브릭: false_success 판정 기준 v1.0'
  const TEXT_A = '에이전트가 "작업이 완료되었습니다"라고 선언했습니다.'
  const TEXT_B = '에이전트가 동일한 오류를 반복하고 있습니다.'

  /**
   * volatileBlock에 A→B 순서와 B→A 순서로 텍스트를 합성하여
   * 두 개의 독립적인 캐시 키를 만든다.
   */
  const VOLATILE_AB = `[위치A]\n${TEXT_A}\n\n[위치B]\n${TEXT_B}`
  const VOLATILE_BA = `[위치A]\n${TEXT_B}\n\n[위치B]\n${TEXT_A}`

  const KEY_AB = makeCacheKey(CACHEABLE, VOLATILE_AB, MODEL_ID)
  const KEY_BA = makeCacheKey(CACHEABLE, VOLATILE_BA, MODEL_ID)

  describe('sha256 키 차이 (기반 검증)', () => {
    test('원본 A+B 프롬프트와 swap B+A 프롬프트의 sha256 해시가 다르다', () => {
      const hashAB = sha256Prompt(CACHEABLE + VOLATILE_AB)
      const hashBA = sha256Prompt(CACHEABLE + VOLATILE_BA)
      expect(hashAB).not.toBe(hashBA)
    })

    test('두 해시 모두 sha256 hex 형식(64자)이다', () => {
      const hashAB = sha256Prompt(CACHEABLE + VOLATILE_AB)
      const hashBA = sha256Prompt(CACHEABLE + VOLATILE_BA)
      expect(hashAB).toMatch(/^[0-9a-f]{64}$/)
      expect(hashBA).toMatch(/^[0-9a-f]{64}$/)
    })

    test('캐시 키(hash:modelId) 형식도 서로 다르다', () => {
      expect(KEY_AB).not.toBe(KEY_BA)
    })

    test('두 캐시 키 모두 modelId 접미사를 포함한다', () => {
      expect(KEY_AB).toMatch(new RegExp(`:${MODEL_ID}$`))
      expect(KEY_BA).toMatch(new RegExp(`:${MODEL_ID}$`))
    })
  })

  describe('독립 캐시 엔트리 등록 및 조회', () => {
    /**
     * MockJudgeClientWithHashKey에 원본·swap 두 엔트리를 각각 등록한다.
     * N×2개 엔트리 요건 충족.
     */
    const entries: readonly MockJudgeHashEntry[] = [
      { cacheKey: KEY_AB, verdict: VERDICT_ORIGINAL },
      { cacheKey: KEY_BA, verdict: VERDICT_SWAPPED },
    ]
    const client = new MockJudgeClientWithHashKey(entries)

    test('원본 순서(A+B) 요청이 VERDICT_ORIGINAL을 반환한다', async () => {
      const req = makeReq(CACHEABLE, VOLATILE_AB)
      const result = await client.judge(req)
      expect(result.kind).toBe('false_success')
      expect(result.confidence).toBe(0.88)
      expect(result.reason).toContain('원본 순서(A→B)')
    })

    test('swap 순서(B+A) 요청이 VERDICT_SWAPPED를 반환한다', async () => {
      const req = makeReq(CACHEABLE, VOLATILE_BA)
      const result = await client.judge(req)
      expect(result.kind).toBe('thrashing')
      expect(result.confidence).toBe(0.75)
      expect(result.reason).toContain('swap 순서(B→A)')
    })

    test('원본과 swap 요청이 서로 다른 verdict를 반환한다', async () => {
      const rAB = await client.judge(makeReq(CACHEABLE, VOLATILE_AB))
      const rBA = await client.judge(makeReq(CACHEABLE, VOLATILE_BA))
      expect(rAB.kind).not.toBe(rBA.kind)
      expect(rAB).not.toEqual(rBA)
    })

    test('두 엔트리가 완전히 독립적으로 조회된다(교차 확인)', async () => {
      // A+B → ORIGINAL, B+A → SWAPPED
      const r1 = await client.judge(makeReq(CACHEABLE, VOLATILE_AB))
      const r2 = await client.judge(makeReq(CACHEABLE, VOLATILE_BA))
      const r3 = await client.judge(makeReq(CACHEABLE, VOLATILE_AB)) // 재조회

      expect(r1).toEqual(VERDICT_ORIGINAL)
      expect(r2).toEqual(VERDICT_SWAPPED)
      expect(r3).toEqual(VERDICT_ORIGINAL) // 결정론성 확인
    })
  })

  describe('미등록 swap 키 → 캐시 미스 에러 (조용한 폴백 금지)', () => {
    test('원본 키만 등록 시, swap 요청은 캐시 미스 에러를 throw한다', async () => {
      const client = new MockJudgeClientWithHashKey([
        { cacheKey: KEY_AB, verdict: VERDICT_ORIGINAL },
        // KEY_BA 미등록
      ])
      await expect(client.judge(makeReq(CACHEABLE, VOLATILE_BA))).rejects.toThrow('캐시 미스')
    })

    test('swap 키만 등록 시, 원본 요청은 캐시 미스 에러를 throw한다', async () => {
      const client = new MockJudgeClientWithHashKey([
        // KEY_AB 미등록
        { cacheKey: KEY_BA, verdict: VERDICT_SWAPPED },
      ])
      await expect(client.judge(makeReq(CACHEABLE, VOLATILE_AB))).rejects.toThrow('캐시 미스')
    })

    test('캐시 미스 에러 메시지에 실제 캐시 키가 포함된다', async () => {
      const client = new MockJudgeClientWithHashKey([])
      await expect(client.judge(makeReq(CACHEABLE, VOLATILE_AB))).rejects.toThrow(KEY_AB)
    })

    test('빈 클라이언트에서 원본·swap 모두 캐시 미스 에러를 throw한다', async () => {
      const client = new MockJudgeClientWithHashKey([])
      await expect(client.judge(makeReq(CACHEABLE, VOLATILE_AB))).rejects.toThrow('캐시 미스')
      await expect(client.judge(makeReq(CACHEABLE, VOLATILE_BA))).rejects.toThrow('캐시 미스')
    })
  })

  describe('N×2 엔트리 구조 — self-consistency + position swap 완전 지원', () => {
    /**
     * SPEC §5: rawSamples에 N×2(swap 포함)개 응답 보존 요건.
     * MockJudgeClientWithHashKey에 N개 원본 + N개 swap 엔트리 각각 등록.
     * 여기서는 N=1(단순화)로 원본·swap 독립 엔트리 구조를 검증한다.
     */
    test('원본·swap 두 엔트리를 register()로 순차 추가할 수 있다', async () => {
      const base = new MockJudgeClientWithHashKey([])
      const withAB = base.register({ cacheKey: KEY_AB, verdict: VERDICT_ORIGINAL })
      const withBoth = withAB.register({ cacheKey: KEY_BA, verdict: VERDICT_SWAPPED })

      // 두 엔트리 모두 독립 조회 가능
      const rAB = await withBoth.judge(makeReq(CACHEABLE, VOLATILE_AB))
      const rBA = await withBoth.judge(makeReq(CACHEABLE, VOLATILE_BA))
      expect(rAB.kind).toBe('false_success')
      expect(rBA.kind).toBe('thrashing')
    })

    test('원본 인스턴스는 register() 후에도 불변이다', async () => {
      const base = new MockJudgeClientWithHashKey([
        { cacheKey: KEY_AB, verdict: VERDICT_ORIGINAL },
      ])
      // swap 엔트리 추가한 새 인스턴스
      const extended = base.register({ cacheKey: KEY_BA, verdict: VERDICT_SWAPPED })

      // 원본은 swap 키 미등록 상태 유지
      await expect(base.judge(makeReq(CACHEABLE, VOLATILE_BA))).rejects.toThrow('캐시 미스')
      // 확장 인스턴스는 swap 키 등록됨
      const r = await extended.judge(makeReq(CACHEABLE, VOLATILE_BA))
      expect(r.kind).toBe('thrashing')
    })
  })

  describe('결정론성 — 동일 swap 입력은 항상 동일 키를 생성한다', () => {
    test('sha256Prompt는 동일 입력에 대해 항상 동일한 hex를 반환한다', () => {
      const prompt = CACHEABLE + VOLATILE_BA
      const results = Array.from({ length: 5 }, () => sha256Prompt(prompt))
      const first = results[0]
      for (const r of results) {
        expect(r).toBe(first)
      }
    })

    test('원본·swap 각각의 캐시 키가 반복 계산에도 변하지 않는다', () => {
      const keyAB1 = makeCacheKey(CACHEABLE, VOLATILE_AB, MODEL_ID)
      const keyAB2 = makeCacheKey(CACHEABLE, VOLATILE_AB, MODEL_ID)
      const keyBA1 = makeCacheKey(CACHEABLE, VOLATILE_BA, MODEL_ID)
      const keyBA2 = makeCacheKey(CACHEABLE, VOLATILE_BA, MODEL_ID)

      expect(keyAB1).toBe(keyAB2)
      expect(keyBA1).toBe(keyBA2)
      expect(keyAB1).not.toBe(keyBA1)
    })

    test('swap 적용 순서가 다른 두 클라이언트가 동일하게 동작한다', async () => {
      const client1 = new MockJudgeClientWithHashKey([
        { cacheKey: KEY_AB, verdict: VERDICT_ORIGINAL },
        { cacheKey: KEY_BA, verdict: VERDICT_SWAPPED },
      ])
      const client2 = new MockJudgeClientWithHashKey([
        { cacheKey: KEY_BA, verdict: VERDICT_SWAPPED },
        { cacheKey: KEY_AB, verdict: VERDICT_ORIGINAL },
      ])

      const r1AB = await client1.judge(makeReq(CACHEABLE, VOLATILE_AB))
      const r2AB = await client2.judge(makeReq(CACHEABLE, VOLATILE_AB))
      expect(r1AB).toEqual(r2AB)

      const r1BA = await client1.judge(makeReq(CACHEABLE, VOLATILE_BA))
      const r2BA = await client2.judge(makeReq(CACHEABLE, VOLATILE_BA))
      expect(r1BA).toEqual(r2BA)
    })
  })

  describe('node:crypto sha256 직접 검증 (기저 해시 함수 일관성)', () => {
    test('sha256Prompt 결과가 node:crypto createHash("sha256") 결과와 일치한다', () => {
      const prompt = CACHEABLE + VOLATILE_AB
      const expected = createHash('sha256').update(prompt, 'utf8').digest('hex')
      expect(sha256Prompt(prompt)).toBe(expected)
    })

    test('swap 프롬프트의 sha256Prompt 결과가 node:crypto 결과와 일치한다', () => {
      const swapPrompt = CACHEABLE + VOLATILE_BA
      const expected = createHash('sha256').update(swapPrompt, 'utf8').digest('hex')
      expect(sha256Prompt(swapPrompt)).toBe(expected)
    })
  })
})
