// src/api/self-check.ts
// 에이전트 자기점검(self-check): 세션 JSONL을 받아 "지금 thrashing 중인가?"를 즉답한다.
//
// 작업 중인 Claude Code 에이전트(또는 운영자)가 세션 JSONL 파일 경로(또는 라인 배열)를
// 주면, 구조 게이트만으로 thrashing 후보를 산출한다.
//
// 설계:
//   - 구조 게이트(StructureGate)만 사용 → 임베딩·judge·API 키 불필요, 결정론적.
//   - false_success는 의미·judge가 본질이라 self-check 범위 밖(구조신호만으론 못 잡음).
//   - 운영 DB·데몬과 독립: 파일만 읽어 즉시 판정(read-only).
//
// 재사용 모듈:
//   - eval/replay-session::processReplayInput / loadReplayEvents (JSONL→NormalizedEvent[])
//   - detect/detection-pipeline::runStructuralGateOverEvents (events→DetectionHit[])

import { DEFAULT_DETECTOR_CONFIG, type DetectorConfig } from '../contracts.js'
import {
  runStructuralGateOverEvents,
  type DetectionHit,
} from '../detect/detection-pipeline.js'
import type { StoredEvent } from '../ingest/event-store.js'
import {
  loadReplayEvents,
  processReplayInput,
  type ReplayInput,
} from '../eval/replay-session.js'

/** self-check 입력: JSONL 파일 경로(string) 또는 라인 배열(string[]) */
export type SelfCheckInput = ReplayInput

/** self-check 결과 */
export interface SelfCheckResult {
  /** thrashing 후보가 하나라도 있으면 true */
  readonly thrashing: boolean
  /** 최고 심각도 ('critical' > 'warning' > null=발화 없음) */
  readonly severity: 'critical' | 'warning' | null
  /** 발화된 구조 게이트 후보 (발화 순서) */
  readonly hits: readonly DetectionHit[]
  /** 파싱·발화 요약 */
  readonly summary: {
    /** 파싱 성공 이벤트 수 */
    readonly eventCount: number
    /** thrashing 후보 수 */
    readonly hitCount: number
    /** 사람이 읽는 한 줄 결론 */
    readonly verdict: string
  }
}

/** hits에서 최고 심각도를 뽑는다 (critical 우선). */
function maxSeverity(
  hits: readonly DetectionHit[],
): 'critical' | 'warning' | null {
  let result: 'critical' | 'warning' | null = null
  for (const h of hits) {
    if (h.gate.severity === 'critical') return 'critical'
    if (h.gate.severity === 'warning') result = 'warning'
  }
  return result
}

/**
 * 세션 JSONL을 받아 thrashing 여부를 판정한다 (구조 게이트만, 결정론적).
 *
 * @param input   JSONL 파일 경로(string) 또는 JSONL 라인 배열(string[])
 * @param config  탐지 임계값 (기본 DEFAULT_DETECTOR_CONFIG)
 * @returns       SelfCheckResult
 *
 * @example
 *   const r = selfCheck('/Users/me/.claude/projects/proj/abc.jsonl')
 *   if (r.thrashing) console.warn(r.summary.verdict)
 */
export function selfCheck(
  input: SelfCheckInput,
  config: DetectorConfig = DEFAULT_DETECTOR_CONFIG,
): SelfCheckResult {
  // 1. JSONL → NormalizedEvent[]
  //    파일 경로면 loadReplayEvents(파일 읽기 포함), 라인 배열이면 processReplayInput.
  const events =
    typeof input === 'string'
      ? loadReplayEvents(input).events
      : processReplayInput(input).events

  // 2. NormalizedEvent는 StoredEvent와 동일 구조 (replay-session과 동일 캐스팅).
  const storedEvents = events as unknown as StoredEvent[]

  // 3. 구조 게이트 → DetectionHit[]
  const hits = runStructuralGateOverEvents(storedEvents, config)

  const severity = maxSeverity(hits)
  const thrashing = hits.length > 0
  const verdict = thrashing
    ? `thrashing 감지: ${hits.length}건 (최고 심각도 ${severity}). 같은 영역을 반복 편집하고 있을 수 있습니다 — 접근을 바꾸거나 사람을 호출하세요.`
    : `thrashing 신호 없음 (이벤트 ${events.length}건 분석).`

  return {
    thrashing,
    severity,
    hits,
    summary: {
      eventCount: events.length,
      hitCount: hits.length,
      verdict,
    },
  }
}
