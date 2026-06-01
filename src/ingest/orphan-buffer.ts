/**
 * src/ingest/orphan-buffer.ts
 *
 * Sorting utilities for NormalizedEvent arrays + OrphanBuffer class.
 *
 * sortByTimestamp: 1차 ts 오름차순 단순 정렬.
 *   동일 ts인 경우 2차 키(parentUuid 위상) → 3차 키(byteOffset)로 자동 폴스루.
 *
 * OrphanBuffer: 부모(parentUuid) 미도착 레코드를 orphanTimeoutMs까지 버퍼링한 뒤
 *   flag 부착 flush하는 고아 버퍼.
 *
 * SPEC §1-1 정렬 계약 (결정 f):
 *   1차: ts (epoch ms) ascending
 *   2차: parentUuid 위상순서 (부모가 자식보다 앞)
 *   3차: byteOffset (파일 내 append 순서 = 진실의 원천)
 *
 * 불변 원칙:
 *   - contracts.ts의 NormalizedEvent를 import, 재정의 금지
 *   - 입력 배열 원본 변경 금지 (불변 정렬)
 *   - console.log 금지
 */

import type { NormalizedEvent } from '../contracts.js'

/**
 * sortByTimestamp(events) → NormalizedEvent[]
 *
 * 이벤트 배열을 인과순서로 정렬한다.
 *
 * 정렬 키 (SPEC §1-1 결정 f):
 *   1차: ts ascending (epoch ms)
 *   2차: parentUuid 위상순서 — a가 b의 부모이면 a가 앞, b가 a의 부모이면 b가 앞
 *   3차: byteOffset ascending (파일 내 append 순서)
 *
 * - 입력 배열은 변경하지 않는다 (새 배열 반환).
 * - live tail과 replay 모두 이 함수를 통과한다.
 *
 * @param events 정렬할 NormalizedEvent 배열 (원본 불변)
 * @returns 정렬된 새 NormalizedEvent 배열
 */
export function sortByTimestamp(events: readonly NormalizedEvent[]): NormalizedEvent[] {
  return [...events].sort((a, b) => {
    // 1차: ts 오름차순
    if (a.ts !== b.ts) return a.ts - b.ts

    // 2차: parentUuid 위상순서 (부모가 자식보다 앞)
    if (b.parentUuid === a.uuid) return -1  // a가 b의 부모 → a 앞
    if (a.parentUuid === b.uuid) return 1   // b가 a의 부모 → b 앞

    // 3차: byteOffset 오름차순
    return a.byteOffset - b.byteOffset
  })
}

// ============================================================
// § OrphanBuffer — 고아 이벤트 버퍼
// ============================================================

/**
 * OrphanBuffer
 *
 * 부모(parentUuid)가 아직 도착하지 않은 이벤트를 orphanTimeoutMs까지
 * 버퍼링한 뒤, 타임아웃 경과 시 onFlush 콜백을 통해 flag 부착 flush한다.
 *
 * 내부 구조:
 *   _buffer  : Map<parentUuid, NormalizedEvent[]>  — 대기 중인 고아 이벤트
 *   _timers  : Map<parentUuid, NodeJS.Timeout>     — 타임아웃 타이머 레지스트리
 *
 * drain() : 현재 버퍼에 있는 모든 이벤트를 즉시 반환하고 버퍼를 비운다.
 *           타이머도 모두 취소한다.
 */
export class OrphanBuffer {
  /** parentUuid → 대기 중인 고아 이벤트 배열 */
  private readonly _buffer: Map<string, NormalizedEvent[]> = new Map()

  /** parentUuid → flush 타이머 핸들 */
  private readonly _timers: Map<string, NodeJS.Timeout> = new Map()

  /** 타임아웃 경과 시 호출되는 콜백 (선택적 — 미지정 시 drain만 동작) */
  private readonly _onFlush: ((events: NormalizedEvent[]) => void) | undefined

  /** 고아 버퍼 대기 최대 시간 (ms) */
  private readonly _orphanTimeoutMs: number

  constructor(opts?: {
    orphanTimeoutMs?: number
    onFlush?: (events: NormalizedEvent[]) => void
  }) {
    this._orphanTimeoutMs = opts?.orphanTimeoutMs ?? 5000
    this._onFlush = opts?.onFlush
  }

  /**
   * 현재 버퍼에 대기 중인 모든 고아 이벤트를 즉시 수집하고
   * 버퍼와 타이머를 모두 초기화한다.
   *
   * @returns 버퍼에 있던 NormalizedEvent 배열 (빈 버퍼면 [])
   */
  drain(): NormalizedEvent[] {
    if (this._buffer.size === 0) return []

    const collected: NormalizedEvent[] = []
    for (const events of this._buffer.values()) {
      collected.push(...events)
    }

    // 모든 타이머 취소
    for (const timer of this._timers.values()) {
      clearTimeout(timer)
    }

    this._buffer.clear()
    this._timers.clear()

    return collected
  }

  /**
   * 이벤트를 버퍼에 추가한다.
   * 해당 parentUuid에 대한 타이머가 없으면 새로 등록한다.
   *
   * @param event 부모 미도착으로 보류할 NormalizedEvent
   */
  add(event: NormalizedEvent): void {
    const key = event.parentUuid ?? '__root__'

    const existing = this._buffer.get(key)
    if (existing !== undefined) {
      existing.push(event)
    } else {
      this._buffer.set(key, [event])
    }

    // 해당 key에 타이머가 없을 때만 신규 등록
    if (!this._timers.has(key)) {
      const timer = setTimeout(() => {
        this._flushKey(key)
      }, this._orphanTimeoutMs)
      // Node.js 환경에서 타이머가 프로세스 종료를 막지 않도록 unref
      if (typeof timer === 'object' && 'unref' in timer) {
        (timer as NodeJS.Timeout).unref()
      }
      this._timers.set(key, timer)
    }
  }

  /**
   * 특정 parentUuid 키에 대기 중인 이벤트를 즉시 flush한다.
   * onFlush 콜백이 등록된 경우 호출한다.
   *
   * @param key parentUuid (또는 '__root__')
   */
  private _flushKey(key: string): void {
    const events = this._buffer.get(key)
    this._buffer.delete(key)

    const timer = this._timers.get(key)
    if (timer !== undefined) {
      clearTimeout(timer)
      this._timers.delete(key)
    }

    if (events !== undefined && events.length > 0 && this._onFlush !== undefined) {
      this._onFlush(events)
    }
  }

  /** 현재 버퍼에 대기 중인 이벤트 총 개수 */
  get size(): number {
    let total = 0
    for (const events of this._buffer.values()) {
      total += events.length
    }
    return total
  }

  /**
   * 부모 이벤트가 도착했을 때 해당 parentUuid에 대기 중인 모든 자식을 flush한다.
   *
   * 동작:
   *   1. _buffer에서 parentUuid 키에 해당하는 이벤트 배열을 꺼낸다.
   *   2. 해당 키의 타이머를 취소한다.
   *   3. 버퍼와 타이머 맵에서 해당 키를 삭제한다.
   *   4. 대기 중이던 자식 이벤트 배열을 반환한다 (없으면 []).
   *
   * 이 메서드는 onFlush 콜백을 호출하지 않는다.
   * 호출자(ingest 파이프라인)가 반환된 이벤트를 직접 처리할 책임을 진다.
   *
   * @param parentUuid 도착한 부모 이벤트의 uuid
   * @returns 해당 parentUuid를 기다리던 NormalizedEvent 배열 (없으면 [])
   */
  notifyParent(parentUuid: string): NormalizedEvent[] {
    const events = this._buffer.get(parentUuid)
    if (events === undefined) return []

    // 타이머 취소 및 맵 정리
    const timer = this._timers.get(parentUuid)
    if (timer !== undefined) {
      clearTimeout(timer)
      this._timers.delete(parentUuid)
    }

    this._buffer.delete(parentUuid)

    return events
  }

  /** 버퍼가 비어 있으면 true */
  get isEmpty(): boolean {
    return this._buffer.size === 0
  }
}
