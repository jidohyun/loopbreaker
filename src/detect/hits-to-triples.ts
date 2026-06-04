/**
 * src/detect/hits-to-triples.ts
 *
 * M5 hits→triples bridge glue.
 *
 * DetectionHit.gate.windowRefs(이벤트 UUID 배열)로 해당 세션 이벤트들을 조회하고
 * buildTriple(storedEvent)로 ActionTriple을 생성한다.
 *
 * runM3Pipeline은 hits와 동일 순서·길이의 (readonly ActionTriple[])[] 를 요구하므로
 * hits를 순회해 같은 순서로 triples 배열을 구성해 길이 계약을 자동 충족한다.
 *
 * 설계 원칙:
 *   - LLM 호출 0, 결정론적
 *   - 불변성: 새 객체 반환, 입력 변경 금지
 *   - console.log 금지
 *   - detect 영역 함수(buildTriple)를 호출만 하고 탐지 알고리즘 재정의 금지
 */

import type { ActionTriple } from '../contracts.js'
import type { StoredEvent } from '../ingest/event-store.js'
import type { DetectionHit } from './detection-pipeline.js'
import { buildTriple } from './triple-builder.js'

// ─── EventStore 조회 인터페이스 ───────────────────────────────────────────────

/**
 * UUID 배열로 StoredEvent를 조회하는 함수 시그니처.
 * 실제 DB 조회 또는 인메모리 맵을 통해 구현할 수 있어 테스트에서 DI가 가능하다.
 */
export type EventLookup = (uuids: readonly string[]) => readonly StoredEvent[]

// ─── fetchEventsForWindowRefs ─────────────────────────────────────────────────

/**
 * windowRefs(이벤트 UUID 배열)로 해당 세션 이벤트들을 조회한다.
 *
 * Sub-AC 4a:
 *   - 비어있지 않은 UUID 목록 → 해당 UUID의 StoredEvent 배열 반환
 *   - 알 수 없는 UUID는 빈 배열 반환 (조용한 무시)
 *   - 빈 UUID 목록 → 빈 배열 반환
 *
 * @param windowRefs  조회할 이벤트 UUID 배열 (StructureGateResult.windowRefs)
 * @param store       UUID → StoredEvent 조회 함수 (DI, 테스트에서 인메모리 맵으로 주입)
 * @returns           매칭된 StoredEvent 배열 (windowRefs 순서 보존, 미매칭 UUID 제외)
 */
export function fetchEventsForWindowRefs(
  windowRefs: readonly string[],
  store: EventLookup,
): readonly StoredEvent[] {
  if (windowRefs.length === 0) {
    return Object.freeze([])
  }
  return store(windowRefs)
}

// ─── buildTriplesForHit ───────────────────────────────────────────────────────

/**
 * 단일 DetectionHit에 대해 windowRefs→events→triples를 생성한다.
 *
 * buildTriple이 null을 반환하는 이벤트(tool_use 이외)는 제외한다.
 * StoredEvent는 NormalizedEvent를 extends하므로 buildTriple에 그대로 전달 가능하다.
 *
 * @param hit    구조 게이트 발화 결과
 * @param store  UUID → StoredEvent 조회 함수
 * @returns      해당 hit의 ActionTriple 배열 (null 제거 후)
 */
export function buildTriplesForHit(
  hit: DetectionHit,
  store: EventLookup,
): readonly ActionTriple[] {
  const events = fetchEventsForWindowRefs(hit.gate.windowRefs, store)
  const triples: ActionTriple[] = []
  for (const ev of events) {
    const triple = buildTriple(ev)
    if (triple !== null) {
      triples.push(triple)
    }
  }
  return Object.freeze(triples)
}

// ─── buildTriplesForHits ──────────────────────────────────────────────────────

/**
 * DetectionHit 배열에 대해 각 hit의 triples를 생성한다.
 *
 * runM3Pipeline 길이 계약 충족:
 *   hits를 순회해 같은 순서로 triples 배열을 구성하므로
 *   결과 배열의 길이는 항상 hits.length와 동일하다.
 *
 * 빈 triples가 나오는 hit도 결과에 포함된다
 * (buildEmbeddingPairs가 빈 입력을 처리하므로 제외 불필요).
 *
 * @param hits   구조 게이트 통과분
 * @param store  UUID → StoredEvent 조회 함수
 * @returns      hits와 동일 순서·길이의 ActionTriple[][] (runM3Pipeline에 직접 전달 가능)
 */
export function buildTriplesForHits(
  hits: readonly DetectionHit[],
  store: EventLookup,
): readonly (readonly ActionTriple[])[] {
  return Object.freeze(
    hits.map(hit => buildTriplesForHit(hit, store)),
  )
}

// ─── hitsToTriples (Sub-AC 4c public API) ────────────────────────────────────

/**
 * DetectionHit[] → ActionTriple[][] bridge (Sub-AC 4c).
 *
 * runM3Pipeline 길이 계약 충족:
 *   hits를 순회해 같은 순서로 triples 배열을 구성하므로
 *   결과 배열의 길이는 항상 hits.length와 동일하다.
 *
 * 빈 triples가 나오는 hit도 결과에 포함된다
 * (buildEmbeddingPairs가 triples.length < 2이면 [] 반환하므로 안전).
 *
 * excludeEmpty=true를 전달하면 빈 triples hit를 hits/triples 양쪽에서
 * 동시 제외해 길이 일치를 유지한다 (선택적 페어 제외).
 *
 * @param hits         구조 게이트 통과분
 * @param store        UUID → StoredEvent 조회 함수 (EventLookup 인터페이스)
 * @param excludeEmpty 빈 triples hit를 결과에서 제외할지 여부 (기본 false)
 * @returns            { hits, triples } — 동일 순서·길이 쌍
 */
export async function hitsToTriples(
  hits: readonly DetectionHit[],
  store: EventLookup,
  excludeEmpty = false,
): Promise<{ hits: readonly DetectionHit[]; triples: readonly (readonly ActionTriple[])[] }> {
  const resultHits: DetectionHit[] = []
  const resultTriples: (readonly ActionTriple[])[] = []

  for (const hit of hits) {
    const triples = buildTriplesForHit(hit, store)
    if (excludeEmpty && triples.length === 0) {
      // 빈 triples hit를 hits/triples 양쪽에서 동시 제외 (길이 일치 유지)
      continue
    }
    resultHits.push(hit)
    resultTriples.push(triples)
  }

  return {
    hits: Object.freeze(resultHits),
    triples: Object.freeze(resultTriples),
  }
}

// ─── makeEventLookupFromArray ─────────────────────────────────────────────────

/**
 * StoredEvent 배열에서 UUID → StoredEvent 맵을 구성하고 EventLookup을 반환한다.
 *
 * 테스트 및 인메모리 경우에 사용한다.
 * windowRefs 순서를 보존하며, 알 수 없는 UUID는 조용히 건너뛴다.
 *
 * @param events  StoredEvent 배열 (세션 전체 이벤트)
 * @returns       EventLookup 함수
 */
export function makeEventLookupFromArray(
  events: readonly StoredEvent[],
): EventLookup {
  const map = new Map<string, StoredEvent>()
  for (const ev of events) {
    map.set(ev.uuid, ev)
  }
  return (uuids: readonly string[]): readonly StoredEvent[] => {
    const result: StoredEvent[] = []
    for (const uuid of uuids) {
      const ev = map.get(uuid)
      if (ev !== undefined) {
        result.push(ev)
      }
    }
    return Object.freeze(result)
  }
}
