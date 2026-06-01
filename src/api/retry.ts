/**
 * api/retry.ts — API 호출 재시도 유틸리티 (지수 백오프)
 *
 * SPEC §4: 임베딩/judge 실패·타임아웃 시 재시도(지수백오프, 상한 apiMaxRetries) 후
 * fail-closed(미발화) — fail-open 금지.
 *
 * 외부 API 절대 미호출: 이 파일은 retry 로직만 포함. 네트워크 코드 없음.
 */

/**
 * 재시도 옵션.
 */
export interface RetryOptions {
  /**
   * 최대 재시도 횟수 (DetectorConfig.apiMaxRetries 또는 apiConfigSchema.apiMaxRetries).
   * 0이면 재시도 없이 1회만 시도.
   */
  readonly maxRetries: number

  /**
   * 첫 번째 재시도 전 대기 시간(ms). 지수 백오프의 기저.
   * 기본값: 100ms
   */
  readonly baseDelayMs?: number

  /**
   * 최대 대기 시간(ms) 상한. 지수 백오프가 이 값을 초과하지 않음.
   * 기본값: 10000ms (10초)
   */
  readonly maxDelayMs?: number
}

/**
 * API 호출 재시도 실패 시 던지는 에러.
 * 마지막 실패 원인(lastCause)을 보존한다.
 */
export class RetryExhaustedError extends Error {
  public readonly lastCause: unknown
  public readonly attempts: number

  constructor(message: string, attempts: number, lastCause?: unknown) {
    super(message)
    this.name = 'RetryExhaustedError'
    this.attempts = attempts
    this.lastCause = lastCause
  }
}

/**
 * 지수 백오프 대기 시간을 계산한다.
 *
 * @param attempt  - 0부터 시작하는 시도 인덱스
 * @param baseMs   - 기저 대기 시간(ms)
 * @param maxMs    - 최대 대기 시간(ms)
 * @returns 대기할 밀리초
 */
export function computeBackoffMs(
  attempt: number,
  baseMs: number,
  maxMs: number
): number {
  const raw = baseMs * Math.pow(2, attempt)
  return Math.min(raw, maxMs)
}

/**
 * API 호출 fn을 최대 maxRetries 회까지 재시도한다 (지수 백오프).
 *
 * - 첫 번째 시도(attempt 0)가 성공하면 즉시 반환.
 * - 실패하면 지수 백오프 후 재시도.
 * - maxRetries 회 소진 후에도 실패하면 RetryExhaustedError throw (fail-closed).
 * - fail-open 금지: 예외를 삼키지 않는다.
 *
 * @param fn         - API 호출 함수. 실패 시 throw.
 * @param options    - 재시도 옵션 (maxRetries, baseDelayMs, maxDelayMs)
 * @param sleepFn    - 대기 함수. 테스트에서 override 가능 (기본: 실제 sleep).
 * @returns API 호출 결과
 * @throws {RetryExhaustedError} maxRetries 소진 후 모든 시도가 실패한 경우
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  sleepFn: (ms: number) => Promise<void> = defaultSleep
): Promise<T> {
  const { maxRetries, baseDelayMs = 100, maxDelayMs = 10_000 } = options

  let lastError: unknown
  const totalAttempts = maxRetries + 1 // 첫 시도 + 재시도 횟수

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      const isLastAttempt = attempt === totalAttempts - 1
      if (isLastAttempt) {
        break
      }

      // 지수 백오프 대기 (마지막 시도 전에는 대기하지 않음)
      const delayMs = computeBackoffMs(attempt, baseDelayMs, maxDelayMs)
      await sleepFn(delayMs)
    }
  }

  throw new RetryExhaustedError(
    `API 호출이 ${totalAttempts}회 시도 후 실패했습니다 (maxRetries=${maxRetries}). ` +
      `마지막 오류: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    totalAttempts,
    lastError
  )
}

/**
 * 기본 sleep 구현 (실제 대기).
 * 테스트에서는 fake sleep으로 교체한다.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
