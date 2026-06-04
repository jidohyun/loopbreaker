/**
 * watch/watch-source.ts — WatchSource 추상화 인터페이스
 *
 * chokidar를 직접 import하지 않는 순수 타입/인터페이스 정의.
 * - daemon.ts, SessionRegistry, SessionPipeline은 이 인터페이스에만 의존한다.
 * - 실구현(ChokidarWatchSource)은 src/watch/chokidar-watch-source.ts에 격리.
 * - 테스트는 MockWatchSource(수동 트리거)만 사용한다.
 *
 * CONSTRAINT: 이 파일에는 chokidar import가 0이어야 한다.
 */

/**
 * 세션 파일이 새로 나타났을 때 호출되는 콜백.
 * @param sessionId  세션 식별자 (파일 경로에서 도출)
 * @param filePath   감시 대상 파일의 절대 경로
 */
export type OnSessionAppear = (sessionId: string, filePath: string) => void

/**
 * 세션 파일이 변경(내용 추가)되었을 때 호출되는 콜백.
 * @param sessionId  세션 식별자
 * @param filePath   변경된 파일의 절대 경로
 */
export type OnSessionChange = (sessionId: string, filePath: string) => void

/**
 * 세션 파일이 삭제/이동되었을 때 호출되는 콜백.
 * @param sessionId  세션 식별자
 * @param filePath   삭제된 파일의 절대 경로
 */
export type OnSessionRemove = (sessionId: string, filePath: string) => void

/**
 * WatchSource에 등록하는 콜백 집합.
 */
export interface WatchCallbacks {
  readonly onSessionAppear: OnSessionAppear
  readonly onSessionChange: OnSessionChange
  readonly onSessionRemove: OnSessionRemove
}

/**
 * 파일 감시 추상화 인터페이스.
 *
 * 구현체:
 *  - ChokidarWatchSource (src/watch/chokidar-watch-source.ts) — 실 운영
 *  - MockWatchSource (테스트용, 수동 트리거) — 테스트 전용
 *
 * 계약:
 *  - start()는 콜백 등록 후 감시를 시작한다. 멱등 호출 허용.
 *  - close()는 감시를 중단하고 이후 콜백이 발화되지 않음을 보장한다.
 *  - chokidar 등 구체 구현 타입을 이 인터페이스 외부로 노출하지 않는다.
 */
export interface WatchSource {
  /**
   * 감시를 시작한다.
   * @param callbacks  세션 이벤트 콜백 집합
   */
  start(callbacks: WatchCallbacks): Promise<void>

  /**
   * 감시를 중단한다. 이후 어떤 콜백도 발화하지 않는다.
   * gracefulShutdown에서 첫 번째로 호출된다.
   */
  close(): Promise<void>
}

/**
 * 테스트용 MockWatchSource — src/watch/mock-watch-source.ts 에서 re-export.
 *
 * 이 파일에서 직접 import 하거나 mock-watch-source.ts 에서 import 해도 동일하다.
 * 기존 테스트의 import 경로('watch-source.js')를 유지하기 위해 재내보낸다.
 */
export { MockWatchSource } from './mock-watch-source.js'
