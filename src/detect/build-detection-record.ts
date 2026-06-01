/**
 * src/detect/build-detection-record.ts
 *
 * DetectionRecord 단조 누적 빌더.
 *
 * SPEC §4 DetectionRecord 단조 누적 원칙:
 *   - gate/embed/judge 각 단계는 자기 산출만 append.
 *   - final은 FinalVerdictResolver가 세 단계 결과를 종합하여 산출.
 *   - 조기 종료 시 해당 시점까지 보존.
 *
 * buildDetectionRecord_gate  → gate 결과만 보존, embed/judge/final = undefined
 * buildDetectionRecord_embed → gate + embed 보존, judge/final = undefined
 * buildDetectionRecord_judge → gate + embed + judge 보존, final = undefined
 *
 * FinalVerdictResolver가 final을 채워 완전한 DetectionRecord를 반환한다.
 */

import type {
  DetectionRecord,
  DetectionSignals,
  DetectionVerdict,
  EmbeddingSimilarityResult,
  JudgeVerdict,
  StructureGateResult,
} from '../contracts.js'

/**
 * 파이프라인 단계별로 누적되는 중간 DetectionRecord.
 * final은 FinalVerdictResolver 호출 전까지 undefined.
 *
 * DetectionRecord.final은 contracts에서 required이므로,
 * 빌더 단계에서는 PendingDetectionRecord를 사용하고
 * resolve() 호출 후 완전한 DetectionRecord를 반환한다.
 */
export interface PendingDetectionRecord {
  /** 구조 게이트 결과 (항상 존재) */
  readonly gate: StructureGateResult
  /** 임베딩 유사도 결과 (의미 단계 미진행 시 undefined) */
  readonly embed?: EmbeddingSimilarityResult
  /** judge 결과 (judge 단계 미진행 시 undefined) */
  readonly judge?: JudgeVerdict
  /** judge 실패 여부 (fail-closed) */
  readonly judgeError?: boolean
  /** judge 판정 미확정(지연) 여부 */
  readonly deferred?: boolean
  /** 최종 판정 (FinalVerdictResolver 호출 후 채워짐) */
  readonly final?: DetectionVerdict
}

/**
 * gate 결과만으로 PendingDetectionRecord를 초기화한다.
 *
 * embed / judge / final 필드는 undefined로 초기화된다.
 * 후속 단계(buildDetectionRecord_embed, buildDetectionRecord_judge,
 * resolveDetectionRecord)가 각 단계 결과를 append한다.
 *
 * @param gate  구조 게이트 판정 결과
 * @returns     gate만 채워진 PendingDetectionRecord
 */
export function buildDetectionRecord_gate(
  gate: StructureGateResult,
): PendingDetectionRecord {
  return Object.freeze({ gate })
}

/**
 * embed 결과를 append한다.
 *
 * gate 단계 record에 embed를 추가한 새 PendingDetectionRecord를 반환한다.
 * 원본 record는 변경하지 않는다 (불변).
 *
 * @param record  gate 단계 PendingDetectionRecord
 * @param embed   임베딩 유사도 결과
 * @returns       gate + embed가 채워진 PendingDetectionRecord
 */
export function buildDetectionRecord_embed(
  record: PendingDetectionRecord,
  embed: EmbeddingSimilarityResult,
): PendingDetectionRecord {
  return Object.freeze({ ...record, embed })
}

/**
 * judge 결과를 append한다.
 *
 * gate + embed 단계 record에 judge를 추가한 새 PendingDetectionRecord를 반환한다.
 * 원본 record는 변경하지 않는다 (불변).
 *
 * @param record  gate + embed 단계 PendingDetectionRecord
 * @param judge   LLM-judge 판정 결과
 * @returns       gate + embed + judge가 채워진 PendingDetectionRecord
 */
export function buildDetectionRecord_judge(
  record: PendingDetectionRecord,
  judge: JudgeVerdict,
): PendingDetectionRecord {
  return Object.freeze({ ...record, judge })
}

/**
 * 기존 gate-only PendingDetectionRecord에 EmbeddingSimilarityResult를 병합한다.
 *
 * SPEC §4 단조 누적 원칙:
 *   - gate 필드는 절대 변경하지 않는다 (불변).
 *   - embed 필드가 채워진 새 PendingDetectionRecord를 반환한다.
 *   - simThresh 미달(의미 약함) 시 embed 필드를 undefined로 유지한다.
 *
 * 동작:
 *   1. embedResult.maxCosine >= simThresh → embed 필드를 채운 새 레코드 반환.
 *   2. embedResult.maxCosine < simThresh  → 원본 레코드 그대로 반환 (embed = undefined).
 *   3. 원본 record는 절대 변경하지 않는다 (불변성 보장).
 *
 * @param record      gate 단계 PendingDetectionRecord (gate만 채워진 상태)
 * @param embedResult 임베딩 유사도 결과 (EmbeddingSimilarityResult)
 * @param simThresh   의미 반복 판정 임계값 (DetectorConfig.simThresh)
 * @returns           simThresh 이상이면 embed 채워진 PendingDetectionRecord,
 *                    미달이면 원본 record (embed = undefined 유지)
 */
export function mergeEmbedResult(
  record: PendingDetectionRecord,
  embedResult: EmbeddingSimilarityResult,
  simThresh: number,
): PendingDetectionRecord {
  if (embedResult.maxCosine >= simThresh) {
    return Object.freeze({ ...record, embed: embedResult })
  }
  return record
}

/**
 * embed가 채워진 DetectionRecord에 JudgeVerdict를 병합한다.
 *
 * SPEC §4 단조 누적 원칙:
 *   - gate/embed 필드는 절대 변경하지 않는다 (불변).
 *   - judge 필드가 채워진 새 PendingDetectionRecord를 반환한다.
 *   - judge 미진행 시 judge 필드를 undefined로 유지한다.
 *
 * 동작:
 *   1. judgeVerdict가 제공되면 judge 필드를 채운 새 레코드 반환.
 *   2. judgeVerdict가 undefined이면 원본 레코드 그대로 반환 (judge = undefined).
 *   3. 원본 record는 절대 변경하지 않는다 (불변성 보장).
 *
 * @param record        embed 단계 PendingDetectionRecord (gate + embed가 채워진 상태)
 * @param judgeVerdict  LLM-judge 판정 결과. undefined이면 judge 미진행 처리.
 * @returns             judgeVerdict가 있으면 judge 채워진 PendingDetectionRecord,
 *                      없으면 원본 record (judge = undefined 유지)
 */
export function mergeJudgeVerdict(
  record: PendingDetectionRecord,
  judgeVerdict: JudgeVerdict | undefined,
): PendingDetectionRecord {
  if (judgeVerdict !== undefined) {
    return Object.freeze({ ...record, judge: judgeVerdict })
  }
  return record
}

/**
 * judge 실패(fail-closed) 상태를 append한다.
 *
 * judge API 실패 시 judgeError:true, deferred:true를 표시한다.
 * 원본 record는 변경하지 않는다 (불변).
 *
 * @param record  gate + embed 단계 PendingDetectionRecord
 * @returns       judgeError + deferred가 표시된 PendingDetectionRecord
 */
export function buildDetectionRecord_judgeError(
  record: PendingDetectionRecord,
): PendingDetectionRecord {
  return Object.freeze({ ...record, judgeError: true as const, deferred: true as const })
}

/**
 * FinalVerdictResolver (embed-only variant): judge 결과가 없고 embed 결과만 있을 때
 * embed 기반으로 DetectionVerdict를 반환한다.
 *
 * Sub-AC 9b: judge=undefined, embed=valid → verdict는 embed.maxCosine을 confidence로,
 * gate.type/subtype을 kind/subtype으로 사용하는 embed 기반 DetectionVerdict를 반환한다.
 *
 * @param gate   구조 게이트 결과
 * @param embed  임베딩 유사도 결과 (항상 제공됨)
 * @returns      embed 기반 DetectionVerdict
 */
export function resolveWithEmbedOnly(
  gate: StructureGateResult,
  embed: EmbeddingSimilarityResult,
): DetectionVerdict {
  const signals: DetectionSignals = {
    maxCosine: embed.maxCosine,
    structuralRepeatCount: Object.values(gate.metrics).reduce(
      (sum, v) => sum + v,
      0,
    ),
  }

  const evidence = gate.windowRefs.map((uuid, i) => ({
    uuid,
    ts: i,
    note: `gate window ref ${i + 1}/${gate.windowRefs.length}`,
  }))

  return Object.freeze({
    kind: gate.type,
    subtype: gate.subtype,
    confidence: embed.maxCosine,
    signals,
    evidence,
    reason: `구조 게이트 발화 (${gate.subtype}), 의미 유사도=${embed.maxCosine.toFixed(3)}, judge 미호출`,
  })
}

/**
 * FinalVerdictResolver (explicit params variant): judge 결과가 존재하고 에러가 없을 때
 * judge 기반으로 DetectionVerdict를 반환한다.
 *
 * Sub-AC 9a: judge=valid → verdict는 judge.kind/subtype/confidence/reason 사용.
 *
 * 우선순위:
 *   - judge 존재 → judge 기반 DetectionVerdict
 *   - embed만 있으면 embed.maxCosine을 confidence로 gate 기반
 *   - gate만 있으면 gate 기반, confidence = 0
 *
 * @param gate   구조 게이트 결과
 * @param embed  임베딩 유사도 결과 (없으면 undefined)
 * @param judge  LLM-judge 판정 결과 (없으면 undefined)
 * @returns      DetectionVerdict
 */
export function resolveWithJudge(
  gate: StructureGateResult,
  embed: EmbeddingSimilarityResult | undefined,
  judge: JudgeVerdict | undefined,
): DetectionVerdict {
  const signals: DetectionSignals = {
    ...(embed !== undefined ? { maxCosine: embed.maxCosine } : {}),
    structuralRepeatCount: Object.values(gate.metrics).reduce(
      (sum, v) => sum + v,
      0,
    ),
  }

  const evidence = gate.windowRefs.map((uuid, i) => ({
    uuid,
    ts: i,
    note: `gate window ref ${i + 1}/${gate.windowRefs.length}`,
  }))

  if (judge !== undefined) {
    return Object.freeze({
      kind: judge.kind,
      subtype: judge.subtype,
      confidence: judge.confidence,
      signals,
      evidence,
      reason: judge.reason,
    })
  }

  if (embed !== undefined) {
    return Object.freeze({
      kind: gate.type,
      subtype: gate.subtype,
      confidence: embed.maxCosine,
      signals,
      evidence,
      reason: `구조 게이트 발화 (${gate.subtype}), 의미 유사도=${embed.maxCosine.toFixed(3)}, judge 미호출`,
    })
  }

  return Object.freeze({
    kind: gate.type,
    subtype: gate.subtype,
    confidence: 0,
    signals,
    evidence,
    reason: `구조 게이트 발화 (${gate.subtype}), 의미 단계 미진행`,
  })
}

/**
 * FinalVerdictResolver (judge error variant): judge 결과가 에러일 때
 * 'inconclusive'를 반환한다.
 *
 * Sub-AC 9c: judge=error → verdict='inconclusive'
 *   - kind = 'none', subtype = 'inconclusive', confidence = 0
 *   - gate/embed는 그대로 보존
 *   - reason은 'judge API 실패: 판정 미확정(deferred)'
 *
 * @param gate        구조 게이트 결과
 * @param embed       임베딩 유사도 결과 (없으면 undefined)
 * @param judgeError  judge 에러 객체 (Error 인스턴스 또는 unknown)
 * @returns           inconclusive DetectionVerdict
 */
export function resolveWithJudgeError(
  gate: StructureGateResult,
  embed: EmbeddingSimilarityResult | undefined,
  judgeError: unknown,
): DetectionVerdict {
  const signals: DetectionSignals = {
    ...(embed !== undefined ? { maxCosine: embed.maxCosine } : {}),
    structuralRepeatCount: Object.values(gate.metrics).reduce(
      (sum, v) => sum + v,
      0,
    ),
  }

  const evidence = gate.windowRefs.map((uuid, i) => ({
    uuid,
    ts: i,
    note: `gate window ref ${i + 1}/${gate.windowRefs.length}`,
  }))

  const errorMessage =
    judgeError instanceof Error ? judgeError.message : String(judgeError)

  return Object.freeze({
    kind: 'none' as const,
    subtype: 'inconclusive',
    confidence: 0,
    signals,
    evidence,
    reason: `judge API 실패: 판정 미확정(deferred) — ${errorMessage}`,
  })
}

/**
 * resolveFinalVerdict — 통합 분기 라우터 (Sub-AC 9d).
 *
 * gate/embed?/judge? 세 단계 결과를 받아 DetectionRecord.final(DetectionVerdict)을
 * 산출하는 최상위 라우팅 함수. 세 하위 resolver를 단일 진입점으로 묶는다.
 *
 * 분기 우선순위:
 *   1. judgeError=true (에러 객체 전달) → resolveWithJudgeError → final.kind='none', subtype='inconclusive'
 *   2. judge가 있고 에러 없음         → resolveWithJudge       → judge.kind/subtype/confidence/reason 사용
 *   3. embed만 있고 judge 없음        → resolveWithEmbedOnly   → embed.maxCosine을 confidence로 사용
 *   4. gate만 있음 (의미 단계 미진행)  → resolveWithJudge(fallback) → gate 기반, confidence=0
 *
 * @param gate        구조 게이트 결과 (항상 필수)
 * @param embed       임베딩 유사도 결과 (의미 단계 미진행 시 undefined)
 * @param judge       LLM-judge 판정 결과 (judge 미호출 시 undefined)
 * @param judgeError  judge 실패 에러 객체 (fail-closed; 에러 없으면 undefined)
 * @returns           DetectionVerdict (항상 Object.isFrozen)
 */
export function resolveFinalVerdict(
  gate: StructureGateResult,
  embed: EmbeddingSimilarityResult | undefined,
  judge: JudgeVerdict | undefined,
  judgeError?: unknown,
): DetectionVerdict {
  // Branch 1: judge API 실패 → fail-closed → inconclusive
  if (judgeError !== undefined) {
    return resolveWithJudgeError(gate, embed, judgeError)
  }

  // Branch 2: judge 결과 있음 → judge 기반 verdict
  if (judge !== undefined) {
    return resolveWithJudge(gate, embed, judge)
  }

  // Branch 3: embed만 있음 → embed 기반 verdict
  if (embed !== undefined) {
    return resolveWithEmbedOnly(gate, embed)
  }

  // Branch 4: gate만 있음 (의미 단계 미진행) → gate 기반, confidence=0
  return resolveWithJudge(gate, undefined, undefined)
}

/**
 * FinalVerdictResolver: gate/embed/judge 세 단계 결과를 종합해 final을 산출한다.
 *
 * 우선순위:
 *   - judgeError → final.kind = 'none', reason = 'inconclusive'
 *   - judge 존재 → judge.kind/subtype/confidence/reason 사용
 *   - embed만 있으면 gate 결과 기반, embed.maxCosine을 confidence로 사용
 *   - gate만 있으면 gate 결과 기반, confidence = 0
 *
 * @param record  완전히 누적된 PendingDetectionRecord
 * @returns       final이 채워진 완전한 DetectionRecord
 */
export function resolveDetectionRecord(
  record: PendingDetectionRecord,
): DetectionRecord {
  const { gate, embed, judge, judgeError, deferred } = record

  const signals = {
    ...(embed !== undefined ? { maxCosine: embed.maxCosine } : {}),
    structuralRepeatCount: Object.values(gate.metrics).reduce(
      (sum, v) => sum + v,
      0,
    ),
  }

  const evidence = gate.windowRefs.map((uuid, i) => ({
    uuid,
    ts: i,
    note: `gate window ref ${i + 1}/${gate.windowRefs.length}`,
  }))

  let final: DetectionVerdict

  if (judgeError === true) {
    // fail-closed: judge 실패 → inconclusive
    final = {
      kind: 'none' as const,
      subtype: 'inconclusive',
      confidence: 0,
      signals,
      evidence,
      reason: 'judge API 실패: 판정 미확정(deferred)',
    }
  } else if (judge !== undefined) {
    // judge 결과 기반
    final = {
      kind: judge.kind,
      subtype: judge.subtype,
      confidence: judge.confidence,
      signals,
      evidence,
      reason: judge.reason,
    }
  } else if (embed !== undefined) {
    // embed만 있고 judge 미호출 (simThresh 미달)
    final = {
      kind: gate.type,
      subtype: gate.subtype,
      confidence: embed.maxCosine,
      signals,
      evidence,
      reason: `구조 게이트 발화 (${gate.subtype}), 의미 유사도=${embed.maxCosine.toFixed(3)}, judge 미호출`,
    }
  } else {
    // gate만 있음 (의미 단계 미진행)
    final = {
      kind: gate.type,
      subtype: gate.subtype,
      confidence: 0,
      signals,
      evidence,
      reason: `구조 게이트 발화 (${gate.subtype}), 의미 단계 미진행`,
    }
  }

  return Object.freeze({
    gate,
    ...(embed !== undefined ? { embed } : {}),
    ...(judge !== undefined ? { judge } : {}),
    ...(judgeError === true ? { judgeError: true as const } : {}),
    ...(deferred === true ? { deferred: true as const } : {}),
    final,
  }) as DetectionRecord
}
