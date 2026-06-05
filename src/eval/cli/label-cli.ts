/**
 * src/eval/cli/label-cli.ts
 *
 * M6 라벨링 CLI — 후보 직렬화 + io 주입 기반 라벨링 루프.
 *
 * 규칙:
 *   - console.log 금지 — 주입된 io.write 사용.
 *   - 부수효과 완전 격리: DB/FS 접근은 인자/주입으로만.
 *   - 불변성: 새 객체 반환, 입력 변경 금지.
 *   - 200~400줄 목표.
 *
 * ⚠️ MANUAL-ONLY: mine-real-sessions.ts 는 이 파일이 아님.
 */

import type { CandidateSignal } from '../eval-contracts.js'

// ─── IO 인터페이스 ────────────────────────────────────────────────────────────

/**
 * 라벨링 CLI에 주입되는 IO 인터페이스.
 * 테스트에서 Mock으로 교체해 부수효과를 0으로 유지한다.
 */
export interface LabelCliIO {
  /** 텍스트를 출력 스트림에 쓴다 */
  write(text: string): void
  /** 프롬프트를 표시하고 사용자 입력을 읽는다 */
  read(prompt: string): Promise<string>
}

// ─── formatCandidate ─────────────────────────────────────────────────────────

/**
 * 후보 객체를 io.write에 넘길 사람이 읽기 쉬운 문자열로 직렬화한다.
 *
 * 출력 형식:
 * ```
 * ┌─ Candidate <candidateId> ─────────────────────────────
 * │  kind      : thrashing
 * │  subtype   : rapid_back_and_forth
 * │  sessionId : sess-abc123
 * │  severity  : critical
 * │  anchor    : uuid-001          (false_success 전용)
 * │  start     : uuid-002          (thrashing 전용)
 * │  end       : uuid-003          (thrashing 전용)
 * │  windowRefs: [uuid-002, uuid-003, uuid-004]  (최대 5개 표시)
 * │  metrics   : repCount=4, deltaMs=120
 * └────────────────────────────────────────────────────────
 * ```
 *
 * Sub-AC 1 규칙:
 *   - 단순 직렬화 함수, 외부 상태/API 접근 없음.
 *   - 불변: 입력 candidate 변경 금지.
 *   - windowRefs 5개 초과 시 '...(N more)' 트렁케이션.
 *   - metrics는 key=value 쌍으로 콤마 구분.
 *   - 출력은 반드시 '\n'으로 끝난다.
 *
 * @param candidate  CandidateSignal 객체
 * @returns          사람이 읽을 수 있는 직렬화 문자열
 */
export function formatCandidate(candidate: CandidateSignal): string {
  const MAX_WINDOW_REFS = 5
  const LINE_WIDTH = 56

  // 헤더 구분선
  const header = `┌─ Candidate ${candidate.candidateId} `
  const headerPad = '─'.repeat(Math.max(0, LINE_WIDTH - header.length))
  const footer = '└' + '─'.repeat(LINE_WIDTH - 1)

  const lines: string[] = []
  lines.push(`${header}${headerPad}`)

  // 필수 필드
  lines.push(`│  kind      : ${candidate.kind}`)
  lines.push(`│  subtype   : ${candidate.subtype}`)
  lines.push(`│  sessionId : ${candidate.sessionId}`)
  lines.push(`│  severity  : ${candidate.severity}`)

  // 종류별 선택 필드
  if (candidate.anchorUuid !== undefined) {
    lines.push(`│  anchor    : ${candidate.anchorUuid}`)
  }
  if (candidate.startUuid !== undefined) {
    lines.push(`│  start     : ${candidate.startUuid}`)
  }
  if (candidate.endUuid !== undefined) {
    lines.push(`│  end       : ${candidate.endUuid}`)
  }

  // windowRefs (최대 5개 표시, 초과 시 트렁케이션)
  const refs = candidate.windowRefs
  if (refs.length > 0) {
    const displayed = refs.slice(0, MAX_WINDOW_REFS)
    const extra = refs.length - displayed.length
    const refStr = displayed.join(', ') + (extra > 0 ? `, ...(${extra} more)` : '')
    lines.push(`│  windowRefs: [${refStr}]`)
  } else {
    lines.push(`│  windowRefs: []`)
  }

  // metrics (key=value 쌍, 콤마 구분)
  const metricEntries = Object.entries(candidate.metrics)
  if (metricEntries.length > 0) {
    const metricStr = metricEntries
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')
    lines.push(`│  metrics   : ${metricStr}`)
  } else {
    lines.push(`│  metrics   : (none)`)
  }

  lines.push(footer)

  return lines.join('\n') + '\n'
}

// ─── parseLabelInput ──────────────────────────────────────────────────────────

/** 유효한 라벨 입력값 */
export type LabelInput = 'positive' | 'negative' | 'skip'

/**
 * 사용자 입력 문자열을 LabelInput으로 파싱한다.
 * 대소문자 무시, 앞뒤 공백 제거.
 *
 * 유효값: 'positive'|'p', 'negative'|'n', 'skip'|'s'
 * 유효하지 않으면 null 반환 (재시도 유도).
 *
 * @param raw  io.read에서 받은 원시 문자열
 * @returns    LabelInput 또는 null (파싱 실패)
 */
export function parseLabelInput(raw: string): LabelInput | null {
  const normalized = raw.trim().toLowerCase()
  switch (normalized) {
    case 'positive':
    case 'p':
      return 'positive'
    case 'negative':
    case 'n':
      return 'negative'
    case 'skip':
    case 's':
      return 'skip'
    default:
      return null
  }
}

// ─── formatLabelPrompt ────────────────────────────────────────────────────────

/**
 * 라벨 입력 프롬프트 문자열을 반환한다.
 * io.read에 넘기는 표준 프롬프트.
 *
 * @returns 라벨 입력 프롬프트 문자열
 */
export function formatLabelPrompt(): string {
  return 'Label [p]ositive / [n]egative / [s]kip: '
}

// ─── parseLabel ───────────────────────────────────────────────────────────────

/**
 * 혼동행렬 셀 라벨 값.
 * 메트릭 계산에서 사용하는 4가지 분류.
 */
export type LabelValue = 'tp' | 'fp' | 'tn' | 'fn'

/** 유효한 LabelValue 집합 (불변) */
const VALID_LABEL_VALUES: ReadonlySet<string> = new Set<LabelValue>([
  'tp',
  'fp',
  'tn',
  'fn',
])

/**
 * 원시 문자열을 유효한 LabelValue로 파싱한다.
 *
 * - 앞뒤 공백 제거 후 소문자 정규화.
 * - 유효값: 'tp' | 'fp' | 'tn' | 'fn'
 * - 유효하지 않은 입력이면 에러를 던진다 (null 반환 없음).
 *
 * @param raw  io.read가 반환한 원시 문자열
 * @returns    파싱된 LabelValue
 * @throws     {Error}  입력이 유효하지 않은 경우
 *
 * @example
 * parseLabel('tp')   // → 'tp'
 * parseLabel(' FP ') // → 'fp'
 * parseLabel('yes')  // → throws Error
 */
export function parseLabel(raw: string): LabelValue {
  const normalized = raw.trim().toLowerCase()

  if (VALID_LABEL_VALUES.has(normalized)) {
    return normalized as LabelValue
  }

  throw new Error(
    `Invalid label value: "${raw}". ` +
      `Expected one of: ${[...VALID_LABEL_VALUES].join(', ')}.`,
  )
}
