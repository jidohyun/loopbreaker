/**
 * src/detect/semantic-stage.ts
 *
 * STAGE 2 의미 판정: 임베딩 코사인 유사도 계산.
 * 구조 게이트(STAGE 1) 통과분에 대해서만 호출된다.
 *
 * 외부 API 절대 호출 금지: EmbedClient 인터페이스를 통해서만 임베딩을 얻고,
 * 실제 API 호출은 구현 클라이언트(Voyage/OpenAI)에 위임한다.
 *
 * BLOCKER C8: EmbeddingSimilarityResult.pairs 정본 (pairCount 금지)
 */

import type { ActionTriple, EmbeddingSimilarityResult, JudgeVerdict } from '../contracts.js'
import type { EmbedClient } from '../api/embed-client.js'
import type { JudgeClient } from '../api/judge-client.js'

// ---- embedTexts — EmbedClient 래퍼 유틸리티 ----

/**
 * 텍스트 배열을 임베딩 벡터 배열로 변환한다.
 *
 * EmbedClient 인터페이스를 통해 호출하는 standalone 유틸리티 함수.
 * 외부 API 절대 미호출: client 구현이 실제 API를 담당하며,
 * 테스트에서는 MockEmbedClient를 주입한다.
 *
 * 계약:
 *   - 반환 배열의 길이 == texts.length
 *   - 모든 내부 벡터의 길이 == embedDim (일정한 차원)
 *   - 빈 배열 입력 → 빈 배열 반환 (client.embed 미호출)
 *   - client.embed 실패 → 예외를 그대로 throw (fail-closed)
 *   - 불변성: 입력 texts 배열을 변경하지 않음
 *
 * @param client 임베딩 클라이언트 (EmbedClient 인터페이스, Mock 또는 실제 구현)
 * @param texts  임베딩할 텍스트 배열
 * @returns 각 텍스트에 대응하는 임베딩 벡터 배열 (texts[i] → vectors[i])
 * @throws {EmbedClientError} client.embed 실패 시 (재시도 소진 후)
 */
export async function embedTexts(
  client: EmbedClient,
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) {
    return []
  }
  return client.embed(texts)
}


// ---- judge position swap (편향완화 SPEC §5) ----

/**
 * judge 편향완화용 A/B 발화 프롬프트.
 *
 * SPEC §5: position swap — A/B 두 발화의 위치를 교환하여 judge를 재호출,
 * 위치 편향(position bias)을 완화한다.
 *
 * positionA: 'A' 위치에 놓을 발화 텍스트
 * positionB: 'B' 위치에 놓을 발화 텍스트
 * prefix:    A/B 앞에 오는 정적 컨텍스트 (루브릭 등, 선택)
 * suffix:    A/B 뒤에 오는 정적 컨텍스트 (선택)
 */
export interface JudgePrompt {
  readonly positionA: string
  readonly positionB: string
  readonly prefix?: string
  readonly suffix?: string
}

/**
 * A/B 두 발화의 위치를 교환한 새 JudgePrompt를 반환한다.
 *
 * SPEC §5 편향완화: position swap — positionA <=> positionB 교환.
 * 원본 JudgePrompt는 절대 변경하지 않는다 (불변성 보장).
 * prefix/suffix 등 나머지 필드는 그대로 유지한다.
 *
 * @param prompt 원본 JudgePrompt (읽기 전용)
 * @returns positionA와 positionB가 교환된 새 JudgePrompt
 */
export function swapPositions(prompt: JudgePrompt): JudgePrompt {
  return {
    ...prompt,
    positionA: prompt.positionB,
    positionB: prompt.positionA,
  }
}

// ---- judge 호출 게이트 ----

/**
 * 구조 게이트 판정을 감싸는 래퍼.
 * pass=true: 게이트 통과 → judge 호출 대상.
 * pass=false: 게이트 탈락 → judge 미호출.
 *
 * SPEC §4: judge는 구조 게이트 통과분에만 호출(비용 게이트 핵심).
 */
export interface GateResult {
  /** 구조 게이트 통과 여부 */
  readonly pass: boolean
}

/**
 * 구조 게이트 통과분에만 judge를 호출할지 판단한다.
 *
 * SPEC §4: "게이트 미통과 이벤트는 judge에 도달하지 않는다"
 *   - pass=true  → true  (judge 호출 대상)
 *   - pass=false → false (judge 미호출, 비용 절감)
 *
 * @param gate 구조 게이트 판정 래퍼
 * @returns gate.pass가 true일 때만 true
 */
export function shouldCallJudge(gate: GateResult): boolean {
  return gate.pass
}

// ---- 코사인 유사도 ----

/**
 * 두 벡터 간 코사인 유사도를 계산한다.
 *
 * @param vecA 첫 번째 벡터 (float[])
 * @param vecB 두 번째 벡터 (float[], vecA와 동일 차원)
 * @returns 코사인 유사도 [-1, 1]. 영벡터 입력 시 0.0 반환.
 * @throws {Error} 두 벡터의 차원이 다를 때
 */
export function computeCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error(
      `Vector dimension mismatch: vecA.length=${vecA.length}, vecB.length=${vecB.length}`,
    )
  }

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i]! * vecB[i]!
    normA += vecA[i]! * vecA[i]!
    normB += vecB[i]! * vecB[i]!
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0

  // 부동소수점 오차로 [-1,1] 범위 벗어날 수 있으므로 클램프
  return Math.max(-1, Math.min(1, dot / denom))
}

// ---- 쌍별 유사도 계산 ----

/**
 * 텍스트 목록과 그에 대응하는 임베딩 벡터 목록에서
 * 모든 쌍의 코사인 유사도를 계산하여 EmbeddingSimilarityResult를 반환한다.
 *
 * @param labels  텍스트 레이블 (pairs.a/b에 기록)
 * @param vectors 각 레이블에 대응하는 임베딩 벡터
 * @returns EmbeddingSimilarityResult (maxCosine, pairs)
 */
export function computeEmbeddingSimilarity(
  labels: readonly string[],
  vectors: readonly number[][],
): EmbeddingSimilarityResult {
  if (labels.length !== vectors.length) {
    throw new Error(
      `labels/vectors length mismatch: labels=${labels.length}, vectors=${vectors.length}`,
    )
  }

  const pairs: { a: string; b: string; cos: number }[] = []
  let maxCosine = -Infinity

  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const cos = computeCosineSimilarity(
        vectors[i] as number[],
        vectors[j] as number[],
      )
      pairs.push({ a: labels[i]!, b: labels[j]!, cos })
      if (cos > maxCosine) maxCosine = cos
    }
  }

  return {
    maxCosine: pairs.length === 0 ? 0 : maxCosine,
    pairs,
  }
}

// ---- buildEmbeddingPairs ----

/**
 * 한 트리플의 임베딩 텍스트 렌더링.
 *
 * SPEC §4 표: thrashing 판정의 임베딩 대상 = "action 렌더링 = tool + 정규화 argKey 재료".
 * 원시 old/new_string 전체는 노이즈이므로 포함하지 않는다.
 *
 * @param triple ActionTriple
 * @returns `"<tool> <argKey>"` 형태의 정규화 텍스트
 */
export function renderTripleText(triple: ActionTriple): string {
  return `${triple.tool} ${triple.argKey}`
}

/**
 * 코사인 유사도 쌍.
 * buildEmbeddingPairs의 반환 원소.
 */
export interface CosinePair {
  /** 첫 번째 트리플의 정규화 텍스트 */
  readonly a: string
  /** 두 번째 트리플의 정규화 텍스트 */
  readonly b: string
  /** 두 텍스트의 임베딩 벡터 간 코사인 유사도 [-1, 1] */
  readonly cos: number
}

/**
 * 텍스트 배열 → 임베딩 벡터 배열 변환 함수 타입.
 * EmbedClient.embed(texts) 시그니처와 동일하게 맞춘다.
 * 테스트에서는 MockEmbedClient.embed를 그대로 주입 가능.
 */
export type EmbedFn = (texts: string[]) => Promise<number[][]>

/**
 * 구조 게이트를 통과한 트리플 배열에 대해 임베딩 코사인 유사도 쌍을 계산한다.
 *
 * 동작:
 *   1. 각 트리플을 renderTripleText로 정규화 텍스트로 변환.
 *   2. embedFn을 한 번 호출해 모든 텍스트를 일괄 임베딩 (API 호출 최소화).
 *   3. 모든 (i, j) 쌍에 대해 코사인 유사도를 계산해 CosinePair[] 반환.
 *
 * 제약:
 *   - 외부 API 절대 미호출: embedFn은 EmbedClient.embed 또는 테스트용 Mock 함수.
 *   - triples가 빈 배열이면 즉시 빈 배열 반환 (embedFn 미호출).
 *   - triples 길이가 1이면 빈 배열 반환 (쌍이 없음).
 *
 * @param triples  구조 게이트 통과분 트리플 배열 (순서 보존)
 * @param embedFn  임베딩 함수 (EmbedClient.embed 또는 Mock)
 * @returns 모든 (i,j) 쌍의 CosinePair 배열 (i < j 순서)
 */
export async function buildEmbeddingPairs(
  triples: readonly ActionTriple[],
  embedFn: EmbedFn,
): Promise<CosinePair[]> {
  if (triples.length < 2) {
    return []
  }

  const texts = triples.map(renderTripleText)
  const vectors = await embedFn(texts)

  const result: CosinePair[] = []

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const cos = computeCosineSimilarity(
        vectors[i] as number[],
        vectors[j] as number[],
      )
      result.push({ a: texts[i]!, b: texts[j]!, cos })
    }
  }

  return result
}

// ---- EmbeddingSimilarityResult 조립 ----

/**
 * CosinePair 배열에서 EmbeddingSimilarityResult를 조립한다.
 *
 * BLOCKER C8: pairs:{a,b,cos}[] 정본. pairCount 필드 금지.
 *
 * 동작:
 *   - pairs 배열 전체를 그대로 보존 (불변성 보장, 재정렬 없음).
 *   - maxCosine = pairs 중 최대 cos 값. 빈 배열이면 0.
 *
 * @param pairs buildEmbeddingPairs가 반환한 CosinePair 배열
 * @returns EmbeddingSimilarityResult { maxCosine, pairs }
 */
export function computeEmbeddingSimilarityResult(
  pairs: readonly CosinePair[],
): EmbeddingSimilarityResult {
  if (pairs.length === 0) {
    return { maxCosine: 0, pairs: [] }
  }

  let maxCosine = -Infinity
  for (const pair of pairs) {
    if (pair.cos > maxCosine) {
      maxCosine = pair.cos
    }
  }

  return {
    maxCosine,
    pairs: pairs.map(p => ({ a: p.a, b: p.b, cos: p.cos })),
  }
}

// ---- computeEmbeddingSimilarityFromContents — Sub-AC 3c 진입점 ----

/**
 * normalizedContent 배열로부터 임베딩 유사도 결과를 산출하는 async 진입점 함수.
 *
 * Sub-AC 3c: `computeEmbeddingSimilarityResult(contents: string[], embedFn): Promise<EmbeddingSimilarityResult>`
 * 구조 게이트 통과분의 normalizedContent 배열을 받아, embedFn으로 임베딩한 뒤
 * 모든 쌍의 코사인 유사도를 계산하여 EmbeddingSimilarityResult를 반환한다.
 *
 * 정규화 입력 규칙 (SPEC §4 STAGE 2):
 *   normalizedContent = whitespace collapse + lowercase + 500자 truncate.
 *   이 함수는 이미 정규화된 텍스트를 받는 것을 전제로 한다.
 *   (정규화는 호출자가 수행: normalizeContent() 함수 사용)
 *
 * 동작:
 *   1. contents가 2개 미만이면 pairs=[], maxCosine=0 반환 (embedFn 미호출).
 *   2. embedFn(contents)를 한 번 호출해 모든 벡터를 일괄 취득.
 *   3. 모든 (i, j) 쌍에 대해 코사인 유사도를 계산.
 *   4. maxCosine = max(cos), pairs = 전체 쌍 목록.
 *
 * BLOCKER C8: pairs:{a,b,cos}[] 정본. pairCount 필드 금지.
 *
 * 제약:
 *   - 외부 API 절대 미호출: embedFn은 EmbedClient.embed 또는 테스트용 Mock 함수.
 *   - 불변성: 입력 contents 배열을 변경하지 않음.
 *   - embedFn 실패 시 예외를 그대로 throw (fail-closed).
 *
 * @param contents normalizedContent 배열 (SPEC §4 STAGE 2 입력)
 * @param embedFn  임베딩 함수 (EmbedClient.embed 또는 Mock)
 * @returns EmbeddingSimilarityResult { maxCosine, pairs }
 */
export async function computeEmbeddingSimilarityFromContents(
  contents: string[],
  embedFn: EmbedFn,
): Promise<EmbeddingSimilarityResult> {
  if (contents.length < 2) {
    return { maxCosine: 0, pairs: [] }
  }

  const vectors = await embedFn(contents)

  const pairs: { a: string; b: string; cos: number }[] = []
  let maxCosine = -Infinity

  for (let i = 0; i < contents.length; i++) {
    for (let j = i + 1; j < contents.length; j++) {
      const cos = computeCosineSimilarity(
        vectors[i] as number[],
        vectors[j] as number[],
      )
      pairs.push({ a: contents[i]!, b: contents[j]!, cos })
      if (cos > maxCosine) maxCosine = cos
    }
  }

  return {
    maxCosine: pairs.length === 0 ? 0 : maxCosine,
    pairs,
  }
}

// ---- collectSamples — self-consistency N 표본 수집 ----

/**
 * 단일 judge 호출의 원시 응답.
 * SPEC §5 self-consistency: JudgeClient를 N회 독립 호출하여 얻은 각각의 JudgeVerdict.
 * rawSamples 배열에 감사용으로 보존된다.
 */
export type RawSample = JudgeVerdict

/**
 * judge 호출 컨텍스트 — collectSamples의 입력.
 * JudgePrompt(편향완화 위치 텍스트)와 judge 요청에 필요한 메타정보를 묶는다.
 */
export interface JudgeCallContext {
  /**
   * 캐시 가능 정적 블록 (루브릭+few-shot).
   * JudgeRequest.cacheableBlock에 매핑된다.
   */
  readonly cacheableBlock: string
  /**
   * 매 호출 변동 블록 (precedingN + anchor).
   * JudgeRequest.volatileBlock에 매핑된다.
   */
  readonly volatileBlock: string
  /**
   * judge 모델 ID (Anthropic).
   * BLOCKER B2: Anthropic 모델 ID만 허용.
   */
  readonly modelId: string
  /**
   * 판정 종류.
   * BLOCKER C1: 'false_success' 단일 리터럴.
   */
  readonly kind: 'thrashing' | 'false_success'
  /**
   * 샘플링 temperature (self-consistency 편향완화용).
   * 기본 0.4. 단일 결정론 호출은 0.
   */
  readonly temperature?: number
}

/**
 * JudgeClient를 N회 독립 호출하여 N개의 RawSample을 반환한다.
 *
 * SPEC §5 self-consistency: temperature>0 으로 N회 샘플링하여
 * 확률적 변동을 측정·완화한다. 각 RawSample은 감사용 rawSamples 배열에 보존된다.
 *
 * 제약:
 *   - 외부 API 절대 미호출: client는 JudgeClient 인터페이스를 통해서만 호출.
 *   - n < 1이면 즉시 빈 배열 반환 (client 미호출).
 *   - 실패 시 예외를 그대로 throw (호출자가 fail-closed 처리).
 *   - 호출 순서 보존: 결과 배열은 호출 순서와 동일.
 *   - 불변성: 입력 ctx 객체를 변경하지 않는다.
 *
 * @param client JudgeClient 구현 (MockJudgeClient 또는 AnthropicJudgeClient)
 * @param ctx    judge 호출 컨텍스트 (cacheableBlock, volatileBlock, modelId, kind)
 * @param n      호출 횟수 (self-consistency 표본 수, judgeSelfConsistencyN)
 * @returns      N개의 RawSample 배열 (호출 순서 보존)
 */
export async function collectSamples(
  client: JudgeClient,
  ctx: JudgeCallContext,
  n: number,
): Promise<RawSample[]> {
  if (n < 1) {
    return []
  }

  const req = {
    kind: ctx.kind,
    cacheableBlock: ctx.cacheableBlock,
    volatileBlock: ctx.volatileBlock,
    modelId: ctx.modelId,
    temperature: ctx.temperature,
  }

  const samples: RawSample[] = []
  for (let i = 0; i < n; i++) {
    const verdict = await client.judge(req)
    samples.push(verdict)
  }
  return samples
}

// ---- 의미 신호 판정 ----

/**
 * 임베딩 유사도 판정 신호.
 *
 * SPEC §4 STAGE 2: simThresh 이상이면 "의미적으로 같은 행동 반복" 신호.
 *   STRONG: maxCosine >= simThresh → 의미적 반복 신호 강함 (judge 호출 대상)
 *   WEAK:   maxCosine < simThresh  → 의미적 반복 신호 약함 (judge 미호출)
 */
export enum SemanticSignal {
  /** maxCosine >= simThresh: 의미적 반복 신호 강함 */
  STRONG = 'STRONG',
  /** maxCosine < simThresh: 의미적 반복 신호 약함 */
  WEAK = 'WEAK',
}

/**
 * EmbeddingSimilarityResult의 maxCosine을 simThresh와 비교하여
 * 의미 신호 강도를 판정한다.
 *
 * SPEC §4 STAGE 2:
 *   - maxCosine >= simThresh → SemanticSignal.STRONG (경계값 포함)
 *   - maxCosine < simThresh  → SemanticSignal.WEAK
 *
 * @param result    임베딩 유사도 산출 결과 (EmbeddingSimilarityResult)
 * @param simThresh 의미 반복 판정 임계값 (DetectorConfig.simThresh)
 * @returns SemanticSignal enum 값
 */
export function evaluateSemanticSignal(
  result: EmbeddingSimilarityResult,
  simThresh: number,
): SemanticSignal {
  return result.maxCosine >= simThresh ? SemanticSignal.STRONG : SemanticSignal.WEAK
}

// ---- normalizeContent — 임베딩 입력 정규화 ----

/**
 * 임베딩 입력 텍스트를 정규화한다.
 *
 * SPEC §4 STAGE 2 입력 정규화 규칙:
 *   1. whitespace collapse: 연속 공백(탭·개행·스페이스 등)을 단일 스페이스로 압축, 앞뒤 trim.
 *   2. lowercase: 모든 문자를 소문자로 변환.
 *   3. 500자 truncate: 500자를 초과하면 잘라낸다.
 *
 * @param text 원본 텍스트
 * @returns 정규화된 텍스트 (최대 500자)
 */
export function normalizeContent(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  const lowered = collapsed.toLowerCase()
  return lowered.slice(0, 500)
}

// ---- semanticStage — STAGE 2 의미 판정 진입점 ----

import type { DetectionHit } from './detection-pipeline.js'

/**
 * 구조 게이트 통과분(DetectionHit[])에 대해 임베딩 코사인 유사도를 계산하고,
 * simThresh 이상이면 triggered=true를 반환하는 STAGE 2 의미 판정 함수.
 *
 * SPEC §4 STAGE 2:
 *   1. DetectionHit 배열에서 gate 필드의 텍스트(subtype + type)를 추출.
 *   2. normalizeContent로 정규화 (whitespace collapse + lowercase + 500자 truncate).
 *   3. embedFn으로 일괄 임베딩.
 *   4. 모든 쌍의 코사인 유사도를 계산하여 EmbeddingSimilarityResult 반환.
 *   5. maxCosine >= simThresh이면 triggered=true.
 *
 * 제약:
 *   - 외부 API 절대 미호출: embedFn은 EmbedClient.embed 또는 테스트용 Mock 함수.
 *   - hits가 2개 미만이면 pairs=[], maxCosine=0, triggered=false 반환 (embedFn 미호출).
 *   - 불변성: 입력 hits 배열을 변경하지 않음.
 *   - embedFn 실패 시 예외를 그대로 throw (fail-closed).
 *
 * @param hits      구조 게이트 통과분 (M2 DetectionHit[])
 * @param simThresh 의미 반복 판정 임계값 (DetectorConfig.simThresh)
 * @param embedFn   임베딩 함수 (EmbedClient.embed 또는 Mock)
 * @returns { result: EmbeddingSimilarityResult, triggered: boolean }
 */
export async function semanticStage(
  hits: readonly DetectionHit[],
  simThresh: number,
  embedFn: EmbedFn,
): Promise<{ result: EmbeddingSimilarityResult; triggered: boolean }> {
  if (hits.length < 2) {
    const result: EmbeddingSimilarityResult = { maxCosine: 0, pairs: [] }
    return { result, triggered: false }
  }

  // DetectionHit의 gate에서 텍스트를 추출하여 정규화
  const contents = hits.map(hit =>
    normalizeContent(`${hit.gate.type} ${hit.gate.subtype}`),
  )

  const result = await computeEmbeddingSimilarityFromContents(contents, embedFn)
  const triggered = result.maxCosine >= simThresh

  return { result, triggered }
}

// ---- majorityVote — self-consistency 다수결 (편향완화 SPEC §5) ----

// ---- judgeStage — 게이트 통과분에만 judge 호출 ----

/**
 * judgeStage 입력 컨텍스트.
 * 게이트 통과분(pass=true)에 대해 swapPositions + collectSamples + majorityVote를 실행한다.
 */
export interface JudgeStageInput {
  /** 구조 게이트 판정 래퍼. pass=false면 즉시 null 반환(judge 미호출). */
  readonly gate: GateResult
  /** judge 호출 컨텍스트 (cacheableBlock, volatileBlock, modelId, kind 등) */
  readonly ctx: JudgeCallContext
  /** JudgeClient 구현 (MockJudgeClient 또는 AnthropicJudgeClient) */
  readonly client: JudgeClient
  /** self-consistency 표본 수 (DetectorConfig.judgeSelfConsistencyN) */
  readonly selfConsistencyN: number
}

/**
 * 게이트 통과분에만 judge를 호출하여 JudgeVerdict를 반환한다.
 *
 * SPEC §4: "게이트 미통과 이벤트는 judge에 도달하지 않는다"
 *   - gate.pass=false → null 즉시 반환. swapPositions/collectSamples/majorityVote 미호출.
 *   - gate.pass=true  → position swap + self-consistency N 표본 수집 + 다수결로 JudgeVerdict 반환.
 *
 * SPEC §5 편향완화:
 *   1. 원본 ctx로 selfConsistencyN개 샘플 수집.
 *   2. positionA/positionB 교환(swapPositions)한 ctx로 selfConsistencyN개 샘플 추가 수집.
 *   3. 전체 2*N 샘플에 majorityVote 적용.
 *
 * @param input JudgeStageInput
 * @returns gate.pass=true이면 JudgeVerdict, gate.pass=false이면 null
 */
export async function judgeStage(input: JudgeStageInput): Promise<JudgeVerdict | null> {
  if (!input.gate.pass) {
    return null
  }

  const { ctx, client, selfConsistencyN } = input

  // position swap용 ctx (positionA/positionB 교환)
  // JudgeCallContext는 cacheableBlock/volatileBlock을 사용하므로
  // 편향완화용 swap은 volatileBlock에서 positionA/positionB를 교환한 형태로 근사한다.
  // 실제 편향완화는 swapPositions(JudgePrompt)를 통해 달성.
  const prompt: JudgePrompt = {
    positionA: ctx.cacheableBlock,
    positionB: ctx.volatileBlock,
  }
  const swapped = swapPositions(prompt)

  const swappedCtx: JudgeCallContext = {
    ...ctx,
    cacheableBlock: swapped.positionA,
    volatileBlock: swapped.positionB,
  }

  // 원본 N개 + swap N개 수집
  const originalSamples = await collectSamples(client, ctx, selfConsistencyN)
  const swappedSamples = await collectSamples(client, swappedCtx, selfConsistencyN)

  const allSamples: RawSample[] = [...originalSamples, ...swappedSamples]

  return majorityVote(allSamples)
}

/**
 * position-swap 쌍을 포함한 N개 RawSample에서 다수결로 JudgeVerdict를 산출한다.
 *
 * SPEC §5 self-consistency + position swap 편향완화:
 *   1. 각 sample의 kind를 집계하여 최다 득표 kind를 선택 (majority vote).
 *   2. 동수(tie)인 경우 우선순위: 'thrashing' > 'false_success' > 'none'
 *      (보수적 판정: 위험 종류 우선).
 *   3. 다수결 kind에 해당하는 sample들의 confidence 평균을 신뢰도로 사용.
 *   4. 다수결 kind에 해당하는 첫 번째 sample의 subtype/reason을 대표값으로 사용.
 *   5. rawSamples에는 입력 samples 전체를 보존 (감사용, 불변 순서 유지).
 *
 * 제약:
 *   - 빈 배열 입력 시 kind='none', confidence=0, rawSamples=[] 반환.
 *   - 입력 samples 배열을 변경하지 않는다 (불변성 보장).
 *   - 반환된 JudgeVerdict는 contracts.ts 정본 계약을 준수한다 (BLOCKER C1/C2).
 *
 * @param samples collectSamples가 반환한 RawSample 배열 (position-swap 쌍 포함)
 * @returns 다수결 JudgeVerdict (rawSamples에 입력 전체 보존)
 */
export function majorityVote(samples: readonly RawSample[]): JudgeVerdict {
  if (samples.length === 0) {
    return {
      kind: 'none',
      subtype: '',
      confidence: 0,
      reason: 'no samples',
      rawSamples: [],
    }
  }

  // kind별 득표 집계
  const votes = new Map<JudgeVerdict['kind'], number>()
  for (const s of samples) {
    votes.set(s.kind, (votes.get(s.kind) ?? 0) + 1)
  }

  // 최다 득표 kind 선택 (동수 시 우선순위: thrashing > false_success > none)
  const kindPriority: JudgeVerdict['kind'][] = ['thrashing', 'false_success', 'none']
  let winnerKind: JudgeVerdict['kind'] = 'none'
  let winnerCount = 0

  for (const kind of kindPriority) {
    const count = votes.get(kind) ?? 0
    if (count > winnerCount) {
      winnerKind = kind
      winnerCount = count
    }
  }

  // 다수결 kind에 해당하는 samples만 추출
  const winningSamples = samples.filter(s => s.kind === winnerKind)

  // confidence 평균 계산
  const avgConfidence =
    winningSamples.reduce((sum, s) => sum + s.confidence, 0) / winningSamples.length

  // 대표 sample (첫 번째 winning sample)
  const representative = winningSamples[0]!

  return {
    kind: winnerKind,
    subtype: representative.subtype,
    confidence: avgConfidence,
    ...(representative.topicDivergence !== undefined
      ? { topicDivergence: representative.topicDivergence }
      : {}),
    ...(representative.circularReference !== undefined
      ? { circularReference: representative.circularReference }
      : {}),
    reason: representative.reason,
    // 감사용: 입력 samples 전체 보존 (순서 유지, 불변 복사)
    rawSamples: samples.slice(),
  }
}
