/**
 * session-state.ts — 세션·agentScope 단위 슬라이딩 윈도 상태
 *
 * 개념:
 *   - RingBuffer(historySize) — 최근 N개 ActionTriple 보관
 *   - argKey → {n, firstTs, lastTs, uuids[]} 카운트 맵
 *   - file_path 편집 카운트 맵
 *
 * 불변성: 모든 업데이트는 새 객체를 반환하지 않고 SessionState 내부를 갱신.
 * SessionState 자체는 파이프라인에서 1개씩 소유하므로 세션 격리 보장.
 */

import type { ActionTriple } from '../contracts.js'

/** argKey 또는 fullKey(argKey#resultClass) 단위 반복 카운트 항목 */
export interface CountEntry {
  n: number
  firstTs: number
  lastTs: number
  uuids: readonly string[]
}

/** 파일별 편집 추적 상태 */
export interface FileEditState {
  /** 파일 총 편집 횟수 */
  count: number
  /** editFingerprint → 동일 변형 반복 횟수 */
  variantGroups: Map<string, number>
  /** 현재 같은 영역 연속 재편집 스트릭 */
  sameRegionStreak: number
  /** 직전 편집 정보 (old/new 정규화 텍스트) */
  prevEdit: { oldNorm: string; newNorm: string } | null
}

/** 세션·agentScope 단위 슬라이딩 윈도 상태 */
export interface SessionState {
  readonly sessionId: string
  readonly agentScope: string
  /** 슬라이딩 윈도 히스토리 (RingBuffer — 최근 historySize개) */
  readonly history: ActionTriple[]
  /** historySize 설정 (불변 — 생성 시 고정) */
  readonly historySize: number
  /** argKey → CountEntry (result 무관 반복) */
  readonly argKeyCounts: Map<string, CountEntry>
  /** argKey#resultClass → CountEntry (동일에러 수렴) */
  readonly fullKeyCounts: Map<string, CountEntry>
  /** file_path → FileEditState */
  readonly fileEditStates: Map<string, FileEditState>
}

/** SessionState 초기화 */
export function createSessionState(
  sessionId: string,
  agentScope: string,
  historySize: number,
): SessionState {
  return {
    sessionId,
    agentScope,
    history: [],
    historySize,
    argKeyCounts: new Map(),
    fullKeyCounts: new Map(),
    fileEditStates: new Map(),
  }
}

/** CountEntry 업데이트 (불변적으로 새 항목 반환) */
function bumpEntry(
  existing: CountEntry | undefined,
  ts: number,
  uuid: string,
): CountEntry {
  if (existing === undefined) {
    return { n: 1, firstTs: ts, lastTs: ts, uuids: [uuid] }
  }
  return {
    n: existing.n + 1,
    firstTs: existing.firstTs,
    lastTs: ts,
    uuids: [...existing.uuids, uuid],
  }
}

/** CountEntry 감소 (윈도에서 빠질 때) */
function decrementEntry(
  existing: CountEntry | undefined,
  uuid: string,
): CountEntry | null {
  if (existing === undefined || existing.n <= 1) return null
  const newUuids = existing.uuids.filter((u) => u !== uuid)
  if (newUuids.length === 0) return null
  return {
    n: newUuids.length,
    firstTs: existing.firstTs,
    lastTs: existing.lastTs,
    uuids: newUuids,
  }
}

/**
 * 윈도에서 빠진 트리플의 카운트를 감소시킨다.
 * history에서 pop된 triple에 대해 호출.
 */
function evictTriple(state: SessionState, evicted: ActionTriple): void {
  const uuid = evicted.ref.uuid

  // argKey 카운트 감소
  const akEntry = decrementEntry(state.argKeyCounts.get(evicted.argKey), uuid)
  if (akEntry === null) {
    state.argKeyCounts.delete(evicted.argKey)
  } else {
    state.argKeyCounts.set(evicted.argKey, akEntry)
  }

  // fullKey 카운트 감소
  const fullKey = `${evicted.argKey}#${evicted.resultClass}`
  const fkEntry = decrementEntry(state.fullKeyCounts.get(fullKey), uuid)
  if (fkEntry === null) {
    state.fullKeyCounts.delete(fullKey)
  } else {
    state.fullKeyCounts.set(fullKey, fkEntry)
  }
}

/**
 * SessionState에 새 ActionTriple을 추가하고 슬라이딩 윈도를 유지한다.
 *
 * - historySize를 초과하면 가장 오래된 triple을 evict하고 카운트를 감소시킨다.
 * - 변이(mutation)를 허용하는 단일 소유 객체로 설계되어 있다.
 */
export function pushTriple(state: SessionState, triple: ActionTriple): void {
  // 히스토리 추가 및 윈도 초과 시 evict
  ;(state.history as ActionTriple[]).push(triple)
  if (state.history.length > state.historySize) {
    const evicted = (state.history as ActionTriple[]).shift()
    if (evicted !== undefined) {
      evictTriple(state, evicted)
    }
  }

  // argKey 카운트 증가
  const akEntry = bumpEntry(
    state.argKeyCounts.get(triple.argKey),
    triple.ref.ts,
    triple.ref.uuid,
  )
  state.argKeyCounts.set(triple.argKey, akEntry)

  // fullKey(argKey#resultClass) 카운트 증가
  const fullKey = `${triple.argKey}#${triple.resultClass}`
  const fkEntry = bumpEntry(
    state.fullKeyCounts.get(fullKey),
    triple.ref.ts,
    triple.ref.uuid,
  )
  state.fullKeyCounts.set(fullKey, fkEntry)
}

/** 현재 윈도 내 argKey 반복 횟수 */
export function getRepeatN(state: SessionState, argKey: string): number {
  return state.argKeyCounts.get(argKey)?.n ?? 0
}

/** 현재 윈도 내 argKey+error 반복 횟수 */
export function getErrLoopN(state: SessionState, argKey: string): number {
  return state.fullKeyCounts.get(`${argKey}#error`)?.n ?? 0
}

/** argKey에 해당하는 윈도 내 uuid 목록 */
export function getWindowUuids(state: SessionState, argKey: string): readonly string[] {
  return state.argKeyCounts.get(argKey)?.uuids ?? []
}

// ─── SessionState 레지스트리 ──────────────────────────────────

/**
 * (sessionId, agentScope) 복합 키 → SessionState 인스턴스 레지스트리.
 * 단일 Map으로 관리. 외부에 직접 노출하지 않음.
 */
export type SessionRegistry = Map<string, SessionState>

/**
 * 새 빈 SessionRegistry를 생성한다.
 */
export function createSessionRegistry(): SessionRegistry {
  return new Map<string, SessionState>()
}

/**
 * (sessionId, agentScope) 복합 키를 구성한다.
 * 두 값을 '\0' (NUL) 구분자로 결합해 충돌을 방지한다.
 */
function registryKey(sessionId: string, agentScope: string): string {
  return `${sessionId}\0${agentScope}`
}

/**
 * 레지스트리에서 (sessionId, agentScope) 키로 SessionState를 조회한다.
 * 존재하지 않으면 새 인스턴스를 생성해 등록하고 반환한다 (get-or-create).
 *
 * 멱등성 보장:
 *   - 같은 키로 두 번 이상 호출해도 항상 동일한 인스턴스를 반환한다.
 *   - historySize는 최초 생성 시에만 적용된다.
 */
export function getOrCreateSession(
  registry: SessionRegistry,
  sessionId: string,
  agentScope: string,
  historySize: number,
): SessionState {
  const key = registryKey(sessionId, agentScope)
  const existing = registry.get(key)
  if (existing !== undefined) {
    return existing
  }
  const fresh = createSessionState(sessionId, agentScope, historySize)
  registry.set(key, fresh)
  return fresh
}

/**
 * 레지스트리에서 (sessionId, agentScope) 키에 해당하는 SessionState를 조회한다.
 * 존재하지 않으면 undefined를 반환한다.
 */
export function lookupSession(
  registry: SessionRegistry,
  sessionId: string,
  agentScope: string,
): SessionState | undefined {
  return registry.get(registryKey(sessionId, agentScope))
}

/**
 * 레지스트리에서 (sessionId, agentScope) 키를 삭제한다.
 * 세션 종료·테스트 정리 시 사용.
 */
export function deleteSession(
  registry: SessionRegistry,
  sessionId: string,
  agentScope: string,
): boolean {
  return registry.delete(registryKey(sessionId, agentScope))
}
