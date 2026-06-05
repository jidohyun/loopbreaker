// src/eval/report.ts
// M6 평가 리포트 렌더러 — EvalMetricsResult + 캘리브레이션 + 리플레이 → md/json.
//
// SPEC §8 정직성: 평가 방법론 6대 한계를 md 리포트에 명시 인용.
// 소표본(skipped) 클래스는 정성분석 + Wilson CI로 표기.
//
// 규칙:
//   - 순수 렌더러 — fs/DB/네트워크 import 0 (부수효과 없음).
//   - console.log 금지. 불변성(입력 수정 없음, 문자열 반환).

import type {
  EvalMetricsResult,
  CalibrationResult,
  ReportContext,
  PerClassMetric,
  ErrorSample,
  GoldSetSummary,
} from './eval-contracts.js'

// ---- 평가 방법론 6대 한계 (SPEC §8 정직성, md 리포트 필수 인용) ----

/**
 * 평가 결과 해석 시 반드시 동반해야 할 6대 한계.
 * renderReportMd가 §6 절에 인용하고, renderReportJson이 구조화 배열로 포함.
 */
export const EVAL_LIMITATIONS: readonly string[] = [
  '참조 상한: IBM 하이브리드 사이클 탐지(arXiv:2511.10650)의 F1=0.72는 우리 목표가 아니다. 도메인·골드셋이 다르므로 참고점일 뿐, 초과를 주장하지 않는다.',
  '골드셋 규모: n=30~200, 단일 라벨러(본인). 검정력이 낮아 모든 지표에 Wilson 95% CI를 동반하며, support 작은 클래스(특히 false_success)는 CI가 넓다 — 점추정이며 구간이 넓다.',
  '라벨 신뢰 상한: intra-rater κ가 모델 성능의 천장이다. 모델 κ ≈ 라벨 κ면 "사람만큼 일관적"이지 그 이상이 아니다.',
  '합성 분리: synthetic 양성으로 부풀린 수치를 주 지표로 쓰지 않는다. 실데이터-only 표가 결론, 실+합성은 부록.',
  '캘리브레이션 과적합: 임계는 이 골드셋에 fit됐다. 새 프로젝트/스타일에서 재캘리브 필요. nested-CV 외부 폴드 수치만 일반화 추정으로 인용.',
  '정량 목표 미설정: "정밀도 X% 달성"식 약속을 박지 않는다. "이 방법으로 측정했고, 측정값은 이렇고, 이 한계 안에서 해석하라"가 정량 증거다.',
]

// ---- 포맷 헬퍼 ----

function fmt(n: number | undefined, digits = 3): string {
  if (n === undefined || Number.isNaN(n)) return 'N/A'
  return n.toFixed(digits)
}

function isoOrEmpty(ms: number | undefined): string {
  if (ms === undefined) return '—'
  return new Date(ms).toISOString()
}

// ---- 섹션 렌더러 ----

function renderGoldSetSummary(s: GoldSetSummary): string {
  const lines: string[] = []
  lines.push('## 1. 골드셋 요약')
  lines.push('')
  lines.push(`- 전체 라벨: ${s.totalLabels}`)
  lines.push(
    `- 소스별: live_jsonl=${s.bySource.live_jsonl}, synthetic=${s.bySource.synthetic}, dohyun_adapted=${s.bySource.dohyun_adapted}`,
  )
  lines.push(
    `- 클래스별: thrashing=${s.byKind.thrashing}, false_success=${s.byKind.false_success}, none=${s.byKind.none}`,
  )
  lines.push(`- 라운드: [${s.rounds.join(', ')}] | 라벨러: [${s.labelers.join(', ')}]`)
  lines.push(`- 기간: ${isoOrEmpty(s.periodStart)} ~ ${isoOrEmpty(s.periodEnd)}`)
  lines.push(
    '- ⚠️ 단일 라벨러(본인) · n=30~200 소표본 → 모든 지표 Wilson 95% CI 동반',
  )
  return lines.join('\n')
}

function renderMainMetrics(m: EvalMetricsResult): string {
  const lines: string[] = []
  lines.push('## 2. 핵심 지표 (실데이터만)')
  lines.push('')
  if (m.hasQualitativeFallback) {
    lines.push('⚠️ 소표본 정성폴백 적용 — 일부 클래스 F1/κ 생략 (정성분석+CI만)')
    lines.push('')
  }
  lines.push(`- Macro F1: ${fmt(m.macroF1)}`)
  lines.push(`- Micro F1: ${fmt(m.microF1)}`)
  lines.push(`- Cohen's κ: ${fmt(m.cohenKappa)}   (라벨 천장: intra-rater κ가 모델 상한)`)
  lines.push(`- Balanced Accuracy: ${fmt(m.balancedAccuracy)}`)
  lines.push(`- (부록) Accuracy: ${fmt(m.accuracy)}  ← 클래스 불균형으로 주 지표 아님`)
  return lines.join('\n')
}

function renderPerClassTable(perClass: readonly PerClassMetric[]): string {
  const lines: string[] = []
  lines.push('## 3. 클래스별 지표 + 오류')
  lines.push('')
  lines.push('| kind | TP | FP | FN | TN | Precision (95% CI) | Recall (95% CI) | F1 | 비고 |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const p of perClass) {
    const precCi = `${fmt(p.wilsonPrecisionLow, 2)}~${fmt(p.wilsonPrecisionHigh, 2)}`
    const recCi = `${fmt(p.wilsonRecallLow, 2)}~${fmt(p.wilsonRecallHigh, 2)}`
    if (p.skipped) {
      lines.push(
        `| ${p.kind} | ${p.tp} | ${p.fp} | ${p.fn} | ${p.tn} | —(정성) [${precCi}] | —(정성) [${recCi}] | —(정성) | ${p.skippedReason ?? '소표본'} |`,
      )
    } else {
      lines.push(
        `| ${p.kind} | ${p.tp} | ${p.fp} | ${p.fn} | ${p.tn} | ${fmt(p.precision)} (${precCi}) | ${fmt(p.recall)} (${recCi}) | ${fmt(p.f1)} | support=${p.positiveCount} |`,
      )
    }
  }
  return lines.join('\n')
}

function renderErrorSamples(samples: readonly ErrorSample[]): string {
  const lines: string[] = []
  lines.push('')
  lines.push('### 오류 사례 (정성 분석)')
  lines.push('')
  if (samples.length === 0) {
    lines.push('- (없음)')
    return lines.join('\n')
  }
  for (const s of samples) {
    lines.push(
      `- [${s.errorType.toUpperCase()}] session=${s.sessionId} gold=${s.goldKind} pred=${s.predKind} conf=${fmt(s.predConfidence, 2)} — ${s.notes ?? ''}`,
    )
  }
  return lines.join('\n')
}

function renderCalibration(c: CalibrationResult | undefined): string {
  const lines: string[] = []
  lines.push('## 4. 캘리브레이션')
  lines.push('')
  if (c === undefined) {
    lines.push('- (없음)')
    return lines.join('\n')
  }
  lines.push(
    `- 목적함수: objective = macroF1 − λ·FPR_none  (λ=${c.lambda}), k=${c.k}-fold stratified`,
  )
  lines.push(
    `- 선택 candidate #${c.bestCandidateIndex} (objective=${fmt(c.bestObjective)})`,
  )
  lines.push('')
  lines.push('| candidate | meanMacroF1 | meanFPR_none | meanObjective |')
  lines.push('|---|---|---|---|')
  for (const cr of c.candidateResults) {
    const mark = cr.candidateIndex === c.bestCandidateIndex ? ' ⭐' : ''
    lines.push(
      `| #${cr.candidateIndex}${mark} | ${fmt(cr.meanMacroF1)} | ${fmt(cr.meanFprNone)} | ${fmt(cr.meanObjective)} |`,
    )
  }
  if (c.qualitativeFallback) {
    lines.push('')
    lines.push(
      '- ⚠️ 소표본: grid 축소 + nested-CV 외부폴드만 일반화 추정 (과적합 위험).',
    )
  }
  return lines.join('\n')
}

function renderReplayRegression(ctx: ReportContext): string {
  const lines: string[] = []
  lines.push('## 5. 리플레이 회귀')
  lines.push('')
  const total = ctx.replaySessions.reduce((acc, r) => acc + r.detections.length, 0)
  lines.push(`- 세션 ${ctx.replaySessions.length}개, 총 detections=${total}`)
  return lines.join('\n')
}

function renderLimitations(): string {
  const lines: string[] = []
  lines.push('## 6. 한계 (정직성)')
  lines.push('')
  EVAL_LIMITATIONS.forEach((lim, i) => {
    lines.push(`${i + 1}. ${lim}`)
  })
  return lines.join('\n')
}

// ---- 공개 API ----

/**
 * ReportContext를 마크다운 리포트 문자열로 렌더한다.
 *
 * 구조: 헤더 → §1 골드셋요약 → §2 핵심지표 → §3 클래스별+오류 →
 *       §4 캘리브레이션 → §5 리플레이회귀 → §6 한계(6대).
 *
 * 소표본(skipped) 클래스는 P/R/F1 칸에 '—(정성)' + Wilson CI 표기.
 * §6은 평가 6대 한계를 반드시 명시 인용한다.
 */
export function renderReportMd(ctx: ReportContext): string {
  const m = ctx.metrics
  const title = ctx.title ?? 'LoopBreaker 평가 리포트'
  const mode = m.isReplay ? 'replay' : 'live'

  const parts: string[] = []
  parts.push(`# ${title}`)
  parts.push('')
  parts.push(
    `생성: ${isoOrEmpty(ctx.generatedAt)} | runId: ${m.runId} | n=${m.goldCount} | mode: ${mode}`,
  )
  parts.push('')
  parts.push(renderGoldSetSummary(m.goldSetSummary))
  parts.push('')
  parts.push(renderMainMetrics(m))
  parts.push('')
  parts.push(renderPerClassTable(m.perClass))
  parts.push(renderErrorSamples(m.errorSamples))
  parts.push('')
  parts.push(renderCalibration(ctx.calibration))
  parts.push('')
  parts.push(renderReplayRegression(ctx))
  parts.push('')
  parts.push(renderLimitations())
  parts.push('')
  return parts.join('\n')
}

/**
 * ReportContext를 JSON 리포트 문자열로 렌더한다.
 * eval_metrics row + 부록(캘리브레이션/리플레이요약/6대 한계).
 */
export function renderReportJson(ctx: ReportContext): string {
  return JSON.stringify(
    {
      title: ctx.title ?? 'LoopBreaker 평가 리포트',
      generatedAt: ctx.generatedAt,
      ...(ctx.generatedBy !== undefined ? { generatedBy: ctx.generatedBy } : {}),
      metrics: ctx.metrics,
      ...(ctx.calibration !== undefined ? { calibration: ctx.calibration } : {}),
      replaySessions: ctx.replaySessions.map((r) => ({
        sessionId: r.sessionId,
        eventCount: r.eventCount,
        detectionCount: r.detections.length,
        durationMs: r.durationMs,
        errors: r.errors,
      })),
      limitations: EVAL_LIMITATIONS,
    },
    null,
    2,
  )
}
