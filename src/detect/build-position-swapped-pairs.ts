/**
 * src/detect/build-position-swapped-pairs.ts
 *
 * Sub-AC 5b: `buildPositionSwappedPairs(candidate, judgeClient, ctx)`
 *
 * 게이트 통과분(GateCandidate) 1건에 대해 JudgeClient를 A/B 원본 순서 + B/A swap 순서로
 * 각각 1회씩 총 2회 호출하고, 두 응답을 PositionSwappedPair로 반환한다.
 *
 * SPEC §5 position swap 편향완화:
 *   - 원본 호출: ctx.positionA → A 위치, ctx.positionB → B 위치
 *   - swap 호출: ctx.positionB → A 위치, ctx.positionA → B 위치
 *   - 두 JudgeVerdict를 { original, swapped }으로 반환
 *
 * 설계 원칙:
 *   - 외부 API 절대 미호출: JudgeClient 인터페이스를 통해서만 호출.
 *   - 불변성: 입력 candidate·ctx를 변경하지 않는다.
 *   - fail-closed: judgeClient.judge() 실패 시 예외를 그대로 throw.
 *   - gate.gate_passed=false이면 JudgeGateNotPassedError를 throw (비용 게이트).
 *   - console.log 금지.
 *
 * BLOCKER C1: JudgeVerdict.kind는 'thrashing' | 'false_success' | 'none'.
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본.
 */

import type { JudgeVerdict } from '../contracts.js'
import type { JudgeClient, JudgeRequest } from '../api/judge-client.js'
import type { GateCandidate } from './filter-gate-passed.js'
import { swapPositions, type JudgePrompt } from './semantic-stage.js'

// ── 공개 타입 ──────────────────────────────────────────────────────────────────

/**
 * position swap 한 쌍의 judge 응답.
 *
 * original: A→A, B→B 순서로 호출한 JudgeVerdict
 * swapped:  B→A, A→B 순서(swap)로 호출한 JudgeVerdict
 *
 * rawSamples에는 두 응답이 [original, swapped] 순서로 보존된다.
 */
export interface PositionSwappedPair {
  /** 원본 A/B 순서로 호출한 JudgeVerdict */
  readonly original: JudgeVerdict
  /** A/B swap 순서로 호출한 JudgeVerdict */
  readonly swapped: JudgeVerdict
}

/**
 * buildPositionSwappedPairs 호출 컨텍스트.
 * judge 요청에 필요한 메타정보 + A/B 발화 텍스트.
 */
export interface PositionSwapContext {
  /**
   * A 위치 발화 텍스트 (원본 호출에서 A 위치에 놓임).
   * swap 호출에서는 B 위치에 놓인다.
   */
  readonly positionA: string
  /**
   * B 위치 발화 텍스트 (원본 호출에서 B 위치에 놓임).
   * swap 호출에서는 A 위치에 놓인다.
   */
  readonly positionB: string
  /**
   * 캐시 가능 정적 블록 (루브릭+few-shot).
   * 원본·swap 호출 모두 동일하게 사용.
   */
  readonly cacheableBlock: string
  /**
   * judge 모델 ID (Anthropic).
   * BLOCKER B2: Anthropic 모델 ID만 허용.
   */
  readonly modelId: string
  /**
   * 판정 종류.
   * BLOCKER C1: 'thrashing' | 'false_success'.
   */
  readonly kind: 'thrashing' | 'false_success'
  /**
   * 샘플링 temperature (self-consistency용).
   * 기본 0.4.
   */
  readonly temperature?: number
}

// ── 에러 타입 ──────────────────────────────────────────────────────────────────

/**
 * gate_passed=false인 후보에 buildPositionSwappedPairs를 호출했을 때 throw되는 에러.
 * SPEC §4: 게이트 미통과 이벤트는 judge에 도달하지 않는다.
 */
export class JudgeGateNotPassedError extends Error {
  readonly triggerUuid: string

  constructor(triggerUuid: string) {
    super(
      `buildPositionSwappedPairs: gate_passed=false인 후보에는 judge를 호출할 수 없습니다. ` +
        `triggerUuid="${triggerUuid}"`,
    )
    this.name = 'JudgeGateNotPassedError'
    this.triggerUuid = triggerUuid
  }
}

// ── 핵심 함수 ──────────────────────────────────────────────────────────────────

/**
 * gate-passed 후보 1건에 대해 JudgeClient를 원본·swap 순서로 각 1회 호출하고
 * PositionSwappedPair(두 응답)를 반환한다.
 *
 * SPEC §5 position swap 편향완화:
 *   1. candidate.gate_passed=false이면 JudgeGateNotPassedError throw (비용 게이트).
 *   2. 원본 호출: positionA→A위치, positionB→B위치 JudgeRequest 생성 → judgeClient.judge() 1회.
 *   3. swapPositions로 A/B를 교환한 JudgePrompt 생성.
 *   4. swap 호출: positionB→A위치, positionA→B위치 JudgeRequest 생성 → judgeClient.judge() 1회.
 *   5. { original, swapped } 반환.
 *
 * 제약:
 *   - 외부 API 절대 미호출: judgeClient는 JudgeClient 인터페이스를 통해서만 호출.
 *   - 불변성: 입력 candidate·ctx를 변경하지 않는다.
 *   - fail-closed: judgeClient.judge() 실패 시 예외를 그대로 throw (호출자가 처리).
 *   - 호출 순서 보장: 원본 먼저, swap 나중. 총 2회 호출.
 *
 * @param candidate  구조 게이트 후보 (gate_passed=true이어야 함)
 * @param judgeClient JudgeClient 구현 (MockJudgeClient 또는 AnthropicJudgeClient)
 * @param ctx         judge 호출 컨텍스트 (positionA, positionB, cacheableBlock, modelId, kind)
 * @returns PositionSwappedPair { original, swapped }
 * @throws {JudgeGateNotPassedError} candidate.gate_passed=false일 때
 * @throws {Error} judgeClient.judge() 실패 시 (fail-closed)
 */
export async function buildPositionSwappedPairs(
  candidate: GateCandidate,
  judgeClient: JudgeClient,
  ctx: PositionSwapContext,
): Promise<PositionSwappedPair> {
  if (!candidate.gate_passed) {
    throw new JudgeGateNotPassedError(candidate.triggerUuid)
  }

  // 원본 프롬프트 (A→A위치, B→B위치)
  const originalPrompt: JudgePrompt = {
    positionA: ctx.positionA,
    positionB: ctx.positionB,
  }

  // swap 프롬프트 (B→A위치, A→B위치)
  const swappedPrompt = swapPositions(originalPrompt)

  // 원본 JudgeRequest: volatileBlock에 positionA/positionB 정보를 인코딩
  const originalReq: JudgeRequest = {
    kind: ctx.kind,
    cacheableBlock: ctx.cacheableBlock,
    volatileBlock: buildVolatileBlock(originalPrompt),
    modelId: ctx.modelId,
    temperature: ctx.temperature ?? 0.4,
  }

  // swap JudgeRequest: volatileBlock에 swap된 positionA/positionB 정보를 인코딩
  const swappedReq: JudgeRequest = {
    kind: ctx.kind,
    cacheableBlock: ctx.cacheableBlock,
    volatileBlock: buildVolatileBlock(swappedPrompt),
    modelId: ctx.modelId,
    temperature: ctx.temperature ?? 0.4,
  }

  // 원본 먼저, swap 나중 (순서 보장)
  const original = await judgeClient.judge(originalReq)
  const swapped = await judgeClient.judge(swappedReq)

  return { original, swapped }
}

// ── 내부 유틸리티 ──────────────────────────────────────────────────────────────

/**
 * JudgePrompt에서 volatileBlock 문자열을 생성한다.
 *
 * positionA/positionB를 구조화된 형태로 인코딩하여
 * judge 모델이 두 발화를 명확히 구분할 수 있게 한다.
 * 원본·swap 호출에서 서로 다른 volatileBlock을 생성하므로
 * MockJudgeClient 캐시 키도 자동으로 달라진다.
 *
 * @param prompt JudgePrompt (positionA, positionB)
 * @returns volatileBlock 문자열
 */
function buildVolatileBlock(prompt: JudgePrompt): string {
  return `[A]: ${prompt.positionA}\n[B]: ${prompt.positionB}`
}
