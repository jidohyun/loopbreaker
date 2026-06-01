/**
 * src/detect/structure-gate.ts
 *
 * StructureGate — SPEC §4 STAGE 1 구조 게이트
 *
 * NormalizedEvent 스트림을 슬라이딩 윈도(historySize)로 관찰하며
 * thrashing 후보를 StructureGateResult로 플래그한다.
 *
 * 탐지 항목 (SPEC §4 1b, 1c):
 *   1b. (tool, argKey) 반복 — repeatN
 *   1b. (tool, argKey, resultClass='error') 반복 — errLoopN
 *   1c. 동일 file_path N회 편집 — fileEditN + Jaccard '같은 영역 재편집' 판정
 *
 * 설계 원칙:
 *   - LLM 호출 0, 결정론적, 읽기 전용
 *   - 임계값 전부 DetectorConfig 주입 (코드 상수 하드코딩 금지)
 *   - 불변성: new 객체 반환, 입력 변경 금지
 *   - console.log 금지
 *   - 파일 200~400줄 목표
 */

import type {
  ActionTriple,
  DetectorConfig,
  NormalizedEvent,
  StructureGateResult,
} from '../contracts.js'
import { buildTriple } from './triple-builder.js'

// ─── 내부 타입 ───────────────────────────────────────────────────────────────

/** 슬라이딩 윈도 내 단일 트리플 항목 */
interface WindowEntry {
  readonly triple: ActionTriple
  /** Edit 툴일 때 file_path (1c 탐지용) */
  readonly filePath: string | null
  /** Edit 툴일 때 old/new 토큰 집합 (Jaccard 판정용) */
  readonly editTokens: ReadonlySet<string> | null
}

// ─── Jaccard 유틸리티 ─────────────────────────────────────────────────────────

/**
 * 두 집합의 Jaccard 유사도 (0~1).
 * 두 집합이 모두 빈 경우 1.0 반환.
 */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0
  let intersection = 0
  for (const tok of a) {
    if (b.has(tok)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 1.0 : intersection / union
}

/**
 * 토큰 집합 목록 중 임의 두 쌍의 최대 Jaccard 유사도를 반환.
 * SPEC §4 1c: '같은 영역 재편집' 판정에 사용.
 */
function maxPairwiseJaccard(sets: ReadonlySet<string>[]): number {
  if (sets.length < 2) return 0
  let max = 0
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const sim = jaccard(sets[i]!, sets[j]!)
      if (sim > max) max = sim
    }
  }
  return max
}

// ─── 토크나이저 (triple-builder 내부와 동일 로직) ─────────────────────────────

function tokenizeForJaccard(s: string): ReadonlySet<string> {
  const tokens = s
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(t => t.length > 0)
  return new Set(tokens)
}

/** Edit 이벤트에서 old+new 통합 토큰 집합을 추출한다. */
function extractEditTokens(event: NormalizedEvent): ReadonlySet<string> | null {
  if (event.tool !== 'Edit' && event.tool !== 'MultiEdit') return null
  const input = event.input as Record<string, unknown> | null | undefined
  if (!input || typeof input !== 'object') return null
  const oldStr = typeof input['old_string'] === 'string' ? input['old_string'] : ''
  const newStr = typeof input['new_string'] === 'string' ? input['new_string'] : ''
  return tokenizeForJaccard(oldStr + ' ' + newStr)
}

/** Edit 이벤트에서 file_path를 추출한다. */
function extractFilePath(event: NormalizedEvent): string | null {
  if (event.tool !== 'Edit' && event.tool !== 'MultiEdit') return null
  const input = event.input as Record<string, unknown> | null | undefined
  if (!input || typeof input !== 'object') return null
  const fp = input['file_path']
  return typeof fp === 'string' && fp.length > 0 ? fp : null
}

// ─── SessionState ─────────────────────────────────────────────────────────────

/**
 * 세션·agentScope 단위 슬라이딩 윈도 상태.
 * 불변 업데이트 패턴: push()가 새 SessionState를 반환한다.
 */
export interface SessionState {
  readonly sessionId: string
  readonly agentScope: string
  readonly window: readonly WindowEntry[]
  readonly historySize: number
}

/** 초기 SessionState 생성 */
export function createSessionState(
  sessionId: string,
  agentScope: string,
  historySize: number,
): SessionState {
  return Object.freeze({
    sessionId,
    agentScope,
    window: Object.freeze([]),
    historySize,
  })
}

/** 새 WindowEntry를 슬라이딩 윈도에 추가하고 새 SessionState를 반환 */
function pushEntry(state: SessionState, entry: WindowEntry): SessionState {
  const next = [...state.window, entry]
  const sliced = next.length > state.historySize ? next.slice(next.length - state.historySize) : next
  return Object.freeze({
    ...state,
    window: Object.freeze(sliced),
  })
}

// ─── StructureGate 클래스 ─────────────────────────────────────────────────────

/**
 * StructureGate — 구조 게이트 팩토리.
 *
 * 생성 시 DetectorConfig를 주입받아 내부에 보관하며,
 * 두 인스턴스를 서로 다른 config로 생성해도 교차 오염이 없음을 보장한다.
 *
 * Sub-AC 6b: constructor가 DetectorConfig를 받아 내부에 저장하고,
 *   서로 다른 config를 가진 두 인스턴스가 각자의 값을 유지한다.
 */
export class StructureGate {
  /** 주입된 설정 (불변 참조 보관) */
  private readonly config: Readonly<DetectorConfig>

  constructor(config: DetectorConfig) {
    // 방어적 복사: 외부에서 config 객체를 변경해도 영향 없음
    this.config = Object.freeze({ ...config })
  }

  /** 현재 보관 중인 DetectorConfig를 반환 (읽기 전용 뷰). */
  getConfig(): Readonly<DetectorConfig> {
    return this.config
  }

  /**
   * NormalizedEvent를 처리해 SessionState를 업데이트하고,
   * thrashing 후보가 탐지되면 StructureGateResult를 반환한다.
   *
   * @returns StructureGateResult | null
   *   - null: thrashing 미탐지
   *   - StructureGateResult: thrashing 후보 (severity: 'warning' | 'critical')
   */
  process(
    event: NormalizedEvent,
    state: SessionState,
  ): { nextState: SessionState; result: StructureGateResult | null } {
    // tool_use 이벤트만 처리 (다른 이벤트는 상태 변경 없이 통과)
    if (event.kind !== 'tool_use') {
      return { nextState: state, result: null }
    }

    const triple = buildTriple(event)
    if (triple === null) {
      return { nextState: state, result: null }
    }

    const filePath = extractFilePath(event)
    const editTokens = extractEditTokens(event)

    const entry: WindowEntry = Object.freeze({
      triple,
      filePath,
      editTokens,
    })

    const nextState = pushEntry(state, entry)

    // ── 1b: (tool, argKey) 반복 카운트 ────────────────────────────────────────
    const repeatResult = this.checkRepeat(nextState, triple)

    // ── 1c: 동일 file_path 편집 카운트 ──────────────────────────────────────
    const fileEditResult = filePath !== null
      ? this.checkFileEdit(nextState, filePath)
      : null

    // 더 심각한 결과 선택 (critical > warning > null)
    const result = pickSeverer(repeatResult, fileEditResult)

    return { nextState, result }
  }

  // ─── 1b: 반복 행동 탐지 ──────────────────────────────────────────────────

  private checkRepeat(
    state: SessionState,
    current: ActionTriple,
  ): StructureGateResult | null {
    const window = state.window

    // (tool, argKey) 동일 항목 수집
    const repeatEntries = window.filter(
      e => e.triple.tool === current.tool && e.triple.argKey === current.argKey,
    )
    const repeatN = repeatEntries.length

    // (tool, argKey, resultClass='error') 동일 항목 수집
    const errEntries = repeatEntries.filter(
      e => e.triple.resultClass === 'error',
    )
    const errLoopN = errEntries.length

    // errLoop 임계 판정
    if (errLoopN >= this.config.errLoopCrit) {
      return this.buildResult(state, 'repeat_error', 'critical', errEntries.map(e => e.triple.ref.uuid), {
        repeatN,
        errLoopN,
      })
    }
    if (errLoopN >= this.config.errLoopWarn) {
      return this.buildResult(state, 'repeat_error', 'warning', errEntries.map(e => e.triple.ref.uuid), {
        repeatN,
        errLoopN,
      })
    }

    // 일반 반복 임계 판정
    if (repeatN >= this.config.CRITICAL) {
      return this.buildResult(state, 'repeat_action', 'critical', repeatEntries.map(e => e.triple.ref.uuid), {
        repeatN,
        errLoopN,
      })
    }
    if (repeatN >= this.config.WARNING) {
      return this.buildResult(state, 'repeat_action', 'warning', repeatEntries.map(e => e.triple.ref.uuid), {
        repeatN,
        errLoopN,
      })
    }

    return null
  }

  // ─── 1c: 동일 파일 편집 탐지 ─────────────────────────────────────────────

  /**
   * SPEC §4 1c: file_path 단위 카운트 + "같은 영역 재편집" 판정.
   * substring 단순 규칙 금지 — 정규화 토큰 Jaccard로 오탐 방지.
   *
   * 발화 조건: 같은 파일을 fileEditWarn회 이상 편집 + 편집들이 같은 영역을 맴돔
   * (토큰 Jaccard >= 0.1). 완전히 다른 영역(Jaccard < 0.1)을 N번 편집하는 것은
   * 정상 작업 진행이므로 미발화(오탐 방지).
   *
   * 주의: 매번 미세 변형된(서로 다른) 편집이라도 같은 영역을 맴돌면 thrashing이다.
   * "단일 deltaHash 완전 반복"만 요구하면 진짜 thrashing(비슷하지만 다른 반복 편집)을
   * 놓치므로, deltaHash 완전일치가 아니라 Jaccard 유사도로 판정한다.
   */
  private checkFileEdit(
    state: SessionState,
    filePath: string,
  ): StructureGateResult | null {
    const fileEntries = state.window.filter(e => e.filePath === filePath)
    const fileEditN = fileEntries.length

    if (fileEditN < this.config.fileEditWarn) return null

    // ── Jaccard 토큰 유사도 기반 "같은 영역 재편집" 판정 ────────────────────
    // 편집 토큰 집합들의 최대 쌍별 Jaccard로 "같은 영역을 맴도는가"를 본다.
    // 토큰 정보가 2개 미만이면(추출 불가) 보수적으로 파일 카운트만으로 발화.
    const tokenSets = fileEntries
      .map(e => e.editTokens)
      .filter((s): s is ReadonlySet<string> => s !== null)

    const maxJaccard = tokenSets.length >= 2
      ? maxPairwiseJaccard(tokenSets)
      : 1

    // "같은 영역 재편집" 판정 임계.
    // 측정 근거: 같은 함수를 미세 변형하며 맴도는 thrashing은 maxJaccard ~0.56,
    // 서로 다른 줄/심볼을 편집하는 정상 진행은 ~0.11. 그 사이 0.3을 임계로 둔다.
    // maxJaccard < 0.3 = 서로 다른 영역 편집 → 정상 진행 → 오탐 방지, 미발화.
    // (SPEC §4 1c isNearDuplicateRegion: 같은 영역 반복만 thrashing)
    if (maxJaccard < 0.3 && tokenSets.length >= 2) return null

    const uuids = fileEntries.map(e => e.triple.ref.uuid)

    if (fileEditN >= this.config.fileEditCrit) {
      return this.buildResult(state, 'file_edit_loop', 'critical', uuids, {
        fileEditN,
        maxJaccard,
      })
    }
    if (fileEditN >= this.config.fileEditWarn) {
      return this.buildResult(state, 'file_edit_loop', 'warning', uuids, {
        fileEditN,
        maxJaccard,
      })
    }

    return null
  }

  // ─── 결과 생성 헬퍼 ──────────────────────────────────────────────────────

  private buildResult(
    state: SessionState,
    subtype: string,
    severity: 'warning' | 'critical',
    windowRefs: string[],
    metrics: Record<string, number>,
  ): StructureGateResult {
    return Object.freeze({
      type: 'thrashing' as const,
      subtype,
      severity,
      sessionId: state.sessionId,
      agentScope: state.agentScope,
      windowRefs: [...windowRefs],
      metrics: { ...metrics },
    })
  }
}

// ─── 유틸리티 ─────────────────────────────────────────────────────────────────

/**
 * 두 StructureGateResult 중 더 심각한 것을 반환한다.
 * critical > warning > null
 */
function pickSeverer(
  a: StructureGateResult | null,
  b: StructureGateResult | null,
): StructureGateResult | null {
  if (a === null) return b
  if (b === null) return a
  if (a.severity === 'critical') return a
  if (b.severity === 'critical') return b
  return a
}

/**
 * StructureGate 팩토리 함수.
 * 클래스를 직접 노출하지 않고 팩토리 패턴으로 사용할 수 있다.
 */
export function createStructureGate(config: DetectorConfig): StructureGate {
  return new StructureGate(config)
}
