/**
 * watch/mock-watch-source.ts — 테스트 전용 MockWatchSource
 *
 * WatchSource 인터페이스를 구현하는 인메모리 구현체.
 * chokidar·실제 fs·네트워크에 의존하지 않고 수동으로 세션 이벤트를 트리거한다.
 *
 * CONSTRAINT: 이 파일에는 chokidar import가 0이어야 한다.
 *
 * 사용 예:
 *   const mock = new MockWatchSource()
 *   await mock.start({ onSessionAppear, onSessionChange, onSessionRemove })
 *   mock.triggerAppear('sid', '/tmp/session.jsonl')
 *   mock.triggerChange('sid', '/tmp/session.jsonl')
 *   mock.triggerRemove('sid', '/tmp/session.jsonl')
 *   await mock.close()
 */

import type { WatchCallbacks, WatchSource } from './watch-source.js'

/**
 * 테스트용 MockWatchSource (InMemoryWatchSource).
 *
 * 수동으로 세션 이벤트를 트리거할 수 있어 결정론적 테스트가 가능하다.
 * - chokidar 미사용
 * - 실제 파일시스템 감시 없음
 * - 실제 OS 알림 없음
 */
export class MockWatchSource implements WatchSource {
  private _callbacks: WatchCallbacks | null = null
  private _started = false
  private _closed = false

  /** 등록된 콜백 (테스트 검증용) */
  get callbacks(): WatchCallbacks | null {
    return this._callbacks
  }

  /** start()가 호출되었는지 */
  get started(): boolean {
    return this._started
  }

  /** close()가 호출되었는지 */
  get closed(): boolean {
    return this._closed
  }

  /**
   * 감시를 시작하고 콜백을 등록한다.
   * 실제 파일시스템 감시를 하지 않으므로 즉시 완료된다.
   */
  async start(callbacks: WatchCallbacks): Promise<void> {
    this._callbacks = callbacks
    this._started = true
    this._closed = false
  }

  /**
   * 감시를 중단한다. 이후 어떤 콜백도 발화하지 않는다.
   */
  async close(): Promise<void> {
    this._closed = true
    this._callbacks = null
  }

  /**
   * onSessionAppear 콜백을 수동으로 발화한다.
   * start()가 호출된 상태에서만 동작하며, close() 이후에는 무시된다.
   */
  triggerAppear(sessionId: string, filePath: string): void {
    if (this._closed || this._callbacks === null) return
    this._callbacks.onSessionAppear(sessionId, filePath)
  }

  /**
   * onSessionChange 콜백을 수동으로 발화한다.
   * start()가 호출된 상태에서만 동작하며, close() 이후에는 무시된다.
   */
  triggerChange(sessionId: string, filePath: string): void {
    if (this._closed || this._callbacks === null) return
    this._callbacks.onSessionChange(sessionId, filePath)
  }

  /**
   * onSessionRemove 콜백을 수동으로 발화한다.
   * start()가 호출된 상태에서만 동작하며, close() 이후에는 무시된다.
   */
  triggerRemove(sessionId: string, filePath: string): void {
    if (this._closed || this._callbacks === null) return
    this._callbacks.onSessionRemove(sessionId, filePath)
  }
}
