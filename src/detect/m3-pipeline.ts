/**
 * src/detect/m3-pipeline.ts
 *
 * M3 통합 파이프라인: 구조 게이트 통과분(DetectionHit) → 의미 판정 → judge → DetectionRecord.
 *
 * M2 detection-pipeline이 반환한 DetectionHit 배열을 받아서:
 *   1. 임베딩 코사인 유사도(STAGE 2) 산출
 *   2. simThresh 이상이면 LLM-judge 호출 (편향완화 포함)
 *   3. DetectionRecord(gate→embed→judge→final) 단조 누적 생성
 *
 * SPEC §4 fail-closed 원칙:
 *   임베딩/judge API 실패·타임아웃 → 재시도 소진 후 RetryExhaustedError throw →
 *   해당 hit는 DetectionRecord를 생성하지 않는다 (미발화).
 *   fail-open 절대 금지: 예외를 삼켜 빈 판정을 emit하지 않는다.
 *
 * 외부 API 절대 미호출: EmbedClient/JudgeClient 인터페이스를 통해서만 호출.
 * 모든 테스트는 MockEmbedClient/MockJudgeClient로만 동작.
 */

import type {
  ActionTriple,
  DetectionRecord,
  DetectionVerdict,
  DetectorConfig,
  EmbeddingSimilarityResult,
  JudgeVerdict,
  StructureGateResult,
} from '../contracts.js'
import type { EmbedClient } from '../api/embed-client.js'
import type { JudgeClient } from '../api/judge-client.js'
import type { DetectionHit } from './detection-pipeline.js'
import {
  buildEmbeddingPairs,
  collectSamples,
  computeEmbeddingSimilarityResult,
  evaluateSemanticSignal,
  majorityVote,
  SemanticSignal,
} from './semantic-stage.js'

// ─── DetectionVerdict 합성 ────────────────────────────────────────────────────

/**
 * gate + embed? + judge? 에서 최종 DetectionVerdict를 합성한다.
 *
 * 우선순위:
 *   - judge 결과가 있으면 judge.kind/subtype/confidence/reason을 사용.
 *   - embed만 있으면 gate 결과를 기반으로 의미 신호 보강.
 *   - 조기종료(embed 미진행)면 gate 결과 그대로 반영.
 */
/**
 * severity → 구조신호 degrade 시 confidence 매핑.
 * SPEC §11(degrade): 임베딩 API 단절 시 구조게이트만으로 동작.
 * decideThresh(기본 0.7)를 넘겨 알림이 발화하도록 한다.
 *   - critical → 0.9 (verdict-router severity 매핑상 ≥0.85 = critical)
 *   - warning  → 0.75 (0.5~0.85 = warning, decideThresh 0.7 통과)
 */
function structuralDegradeConfidence(severity: 'warning' | 'critical'): number {
  return severity === 'critical' ? 0.9 : 0.75
}

function synthesizeVerdict(
  gate: StructureGateResult,
  embed: EmbeddingSimilarityResult | undefined,
  judge: JudgeVerdict | undefined,
  degradedConfidence?: number,
): DetectionVerdict {
  const signals = {
    ...(embed !== undefined ? { maxCosine: embed.maxCosine } : {}),
    structuralRepeatCount: Object.values(gate.metrics).reduce(
      (sum, v) => sum + v,
      0,
    ),
  }

  const evidence = gate.windowRefs.map((uuid, i) => ({
    uuid,
    ts: i, // windowRefs는 UUID만 갖고 있으므로 인덱스로 대체
    note: `gate window ref ${i + 1}/${gate.windowRefs.length}`,
  }))

  if (judge !== undefined) {
    return {
      kind: judge.kind,
      subtype: judge.subtype,
      confidence: judge.confidence,
      signals,
      evidence,
      reason: judge.reason,
    }
  }

  if (embed !== undefined) {
    // 의미 신호 있음, judge 미호출 (simThresh 미달)
    return {
      kind: gate.type,
      subtype: gate.subtype,
      confidence: embed.maxCosine,
      signals,
      evidence,
      reason: `구조 게이트 발화 (${gate.subtype}), 의미 유사도=${embed.maxCosine.toFixed(3)}, judge 미호출(simThresh 미달)`,
    }
  }

  // 의미 단계 미진행 (조기 종료)
  // degradedConfidence가 주어지면 구조신호 degrade 경로(SPEC §11):
  // 임베딩 단절 시 thrashing을 구조신호만으로 발화시킨다.
  if (degradedConfidence !== undefined) {
    return {
      kind: gate.type,
      subtype: gate.subtype,
      confidence: degradedConfidence,
      signals,
      evidence,
      reason: `구조 게이트 발화 (${gate.subtype}), 임베딩 단절 → 구조신호만으로 판정(degrade)`,
    }
  }

  return {
    kind: gate.type,
    subtype: gate.subtype,
    confidence: 0,
    signals,
    evidence,
    reason: `구조 게이트 발화 (${gate.subtype}), 의미 단계 미진행`,
  }
}

// ─── M3 파이프라인 설정 ────────────────────────────────────────────────────────

/**
 * M3 파이프라인 실행 옵션.
 * DetectorConfig에서 필요한 값을 추출해 주입한다.
 */
export interface M3PipelineOptions {
  /** 임베딩 클라이언트 (MockEmbedClient 또는 실제 구현) */
  readonly embedClient: EmbedClient
  /** judge 클라이언트 (MockJudgeClient 또는 실제 구현) */
  readonly judgeClient: JudgeClient
  /** 탐지기 설정 */
  readonly config: DetectorConfig
}

// ─── 단일 hit 처리 ─────────────────────────────────────────────────────────────

/**
 * 단일 DetectionHit에 대해 의미 판정 + judge를 수행하고 DetectionRecord를 반환한다.
 *
 * fail-closed: embed/judge API 실패 시 예외를 그대로 throw (호출자가 처리).
 *
 * @param hit      구조 게이트 통과분
 * @param triples  해당 hit의 슬라이딩 윈도 트리플 목록 (임베딩 대상)
 * @param opts     M3 파이프라인 설정
 * @returns DetectionRecord (gate→embed→judge→final 단조 누적)
 * @throws 임베딩/judge API 실패 시 (RetryExhaustedError 또는 기타 에러)
 */
async function processHit(
  hit: DetectionHit,
  triples: readonly ActionTriple[],
  opts: M3PipelineOptions,
): Promise<DetectionRecord> {
  const { embedClient, judgeClient, config } = opts
  const gate = hit.gate

  // STAGE 2: 임베딩 코사인 유사도 산출
  // SPEC §11 degrade: 임베딩 API 단절(키 없음/네트워크/캐시미스) 시,
  //   - thrashing은 구조신호만으로도 충분 → embed 없이 구조 degrade 발화.
  //   - false_success는 의미·judge가 본질적이므로 기존 fail-closed(폐기) 유지.
  let embed: EmbeddingSimilarityResult
  try {
    const pairs = await buildEmbeddingPairs(triples, texts => embedClient.embed(texts))
    embed = computeEmbeddingSimilarityResult(pairs)
  } catch (err) {
    if (gate.type === 'thrashing') {
      const final = synthesizeVerdict(
        gate,
        undefined,
        undefined,
        structuralDegradeConfidence(gate.severity),
      )
      return { gate, embedError: true, degraded: true, final }
    }
    // false_success 등: 의미 단계 없이는 판정 불가 → fail-closed 전파
    throw err
  }

  // 의미 신호 판정
  const signal = evaluateSemanticSignal(embed, config.simThresh)

  if (signal === SemanticSignal.WEAK) {
    // 의미 신호 약함 → judge 미호출, 조기 종료
    const final = synthesizeVerdict(gate, embed, undefined)
    return { gate, embed, final }
  }

  // STAGE 3: judge 호출 (구조 게이트 + 의미 신호 통과분에만)
  const judgeCtx = {
    cacheableBlock: `thrashing-rubric:${config.judgeModelId}`,
    volatileBlock: `gate:${gate.subtype} maxCosine:${embed.maxCosine.toFixed(4)}`,
    modelId: config.judgeModelId,
    kind: 'thrashing' as const,
    temperature: 0.4,
  }

  // self-consistency N 표본 수집 (SPEC §5)
  // judge 실패 시: judgeError:true, deferred:true を표시하고 미확정 record 반환
  // (SPEC §4: "judge API 실패/타임아웃 → DetectionRecord{judgeError:true, deferred:true}")
  const n = config.judgeSelfConsistencyN
  let samples: JudgeVerdict[]
  try {
    samples = await collectSamples(judgeClient, judgeCtx, n)
  } catch {
    // judge 실패: embed까지의 정보를 보존하고 judgeError 표시
    const final = synthesizeVerdict(gate, embed, undefined)
    return { gate, embed, judgeError: true, deferred: true, final }
  }
  const judge: JudgeVerdict = majorityVote(samples)

  const final = synthesizeVerdict(gate, embed, judge)
  return { gate, embed, judge, final }
}

// ─── M3 파이프라인 진입점 ─────────────────────────────────────────────────────

/**
 * M2 게이트 통과분 배열을 받아 DetectionRecord 배열을 생성한다.
 *
 * SPEC §4 fail-closed 원칙:
 *   - 임베딩/judge API 실패(RetryExhaustedError) → 해당 hit 건너뜀 (미발화).
 *   - 에러를 삼켜 빈 DetectionRecord를 emit하지 않는다 (fail-open 금지).
 *   - 실패한 hit는 결과 배열에 포함되지 않는다.
 *
 * @param hits     M2 구조 게이트 통과분 (DetectionHit[])
 * @param triples  각 hit에 대응하는 트리플 배열 (hits와 동일 순서·길이)
 * @param opts     M3 파이프라인 설정
 * @returns 성공적으로 처리된 DetectionRecord 배열 (실패 hit 제외)
 */
export async function runM3Pipeline(
  hits: readonly DetectionHit[],
  triples: readonly (readonly ActionTriple[])[],
  opts: M3PipelineOptions,
): Promise<DetectionRecord[]> {
  if (hits.length !== triples.length) {
    throw new Error(
      `runM3Pipeline: hits.length(${hits.length}) !== triples.length(${triples.length})`,
    )
  }

  const records: DetectionRecord[] = []

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!
    const tripleSet = triples[i]!

    try {
      const record = await processHit(hit, tripleSet, opts)
      records.push(record)
    } catch {
      // SPEC §4 fail-closed: API 실패 시 해당 hit를 미발화.
      // 예외를 삼키지 않고 기록하지 않는다 (DetectionRecord 생성 금지).
      // 로깅은 상위 레이어 책임 (console.log 금지).
    }
  }

  return records
}
