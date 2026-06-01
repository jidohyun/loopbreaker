/**
 * tests/retry-sub-ac-7a.test.ts
 *
 * Sub-AC 7a: withRetry 함수 — API 호출 재시도 로직 검증.
 *
 * 검증 항목:
 * 1. maxRetries 회 소진 후 RetryExhaustedError throw
 * 2. maxRetries 회 이전에 성공하면 결과 반환 (조기 성공)
 * 3. 첫 번째 시도에서 성공하면 재시도 없이 반환
 * 4. 총 시도 횟수가 정확히 maxRetries + 1 임
 * 5. fail-closed: 예외를 삼키지 않음
 * 6. computeBackoffMs 지수 백오프 계산
 */

import { jest, describe, it, expect } from '@jest/globals'
import {
  withRetry,
  RetryExhaustedError,
  computeBackoffMs,
} from '../src/api/retry.js'

// ─── 헬퍼: fake sleep (즉시 resolve, 호출 횟수 추적) ─────────────────────────

function makeFakeSleep(): { sleep: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = []
  const sleep = (ms: number): Promise<void> => {
    calls.push(ms)
    return Promise.resolve()
  }
  return { sleep, calls }
}

// ─── 1. maxRetries 소진 후 RetryExhaustedError throw ─────────────────────────

describe('withRetry — retry exhaustion', () => {
  it('maxRetries=0: 1회 시도 후 실패하면 RetryExhaustedError를 throw한다', async () => {
    const { sleep } = makeFakeSleep()
    let callCount = 0
    const fn = async (): Promise<number> => {
      callCount++
      throw new Error('fail')
    }

    await expect(withRetry(fn, { maxRetries: 0 }, sleep)).rejects.toBeInstanceOf(RetryExhaustedError)
    expect(callCount).toBe(1)
  })

  it('maxRetries=3: 4회 시도 후 모두 실패하면 RetryExhaustedError를 throw한다', async () => {
    const { sleep } = makeFakeSleep()
    let callCount = 0
    const fn = async (): Promise<number> => {
      callCount++
      throw new Error('always fails')
    }

    await expect(withRetry(fn, { maxRetries: 3 }, sleep)).rejects.toBeInstanceOf(RetryExhaustedError)
    // 총 시도 횟수: maxRetries + 1 = 4
    expect(callCount).toBe(4)
  })

  it('RetryExhaustedError.attempts는 총 시도 횟수(maxRetries + 1)와 같다', async () => {
    const { sleep } = makeFakeSleep()
    const fn = async (): Promise<string> => {
      throw new Error('fail')
    }

    let error: RetryExhaustedError | undefined
    try {
      await withRetry(fn, { maxRetries: 2 }, sleep)
    } catch (e) {
      error = e as RetryExhaustedError
    }

    expect(error).toBeInstanceOf(RetryExhaustedError)
    expect(error!.attempts).toBe(3) // maxRetries=2 → 총 3회
  })

  it('RetryExhaustedError.lastCause는 마지막 실패 원인을 담는다', async () => {
    const { sleep } = makeFakeSleep()
    const errors = [new Error('first'), new Error('second'), new Error('final failure')]
    let callIndex = 0
    const fn = async (): Promise<number> => {
      throw errors[Math.min(callIndex++, errors.length - 1)]
    }

    let caught: RetryExhaustedError | undefined
    try {
      await withRetry(fn, { maxRetries: 2 }, sleep)
    } catch (e) {
      caught = e as RetryExhaustedError
    }

    expect(caught).toBeInstanceOf(RetryExhaustedError)
    expect(caught!.lastCause).toBe(errors[2])
  })
})

// ─── 2. 조기 성공 (maxRetries 이전) ─────────────────────────────────────────

describe('withRetry — early success', () => {
  it('첫 번째 시도에서 성공하면 fn을 1회만 호출하고 결과를 반환한다', async () => {
    const { sleep, calls } = makeFakeSleep()
    let callCount = 0
    const fn = async (): Promise<number> => {
      callCount++
      return 42
    }

    const result = await withRetry(fn, { maxRetries: 3 }, sleep)

    expect(result).toBe(42)
    expect(callCount).toBe(1)
    expect(calls).toHaveLength(0) // sleep 미호출
  })

  it('두 번째 시도에서 성공하면 fn을 2회 호출하고 결과를 반환한다 (maxRetries=3)', async () => {
    const { sleep } = makeFakeSleep()
    let callCount = 0
    const fn = async (): Promise<string> => {
      callCount++
      if (callCount === 1) throw new Error('first fail')
      return 'success'
    }

    const result = await withRetry(fn, { maxRetries: 3 }, sleep)

    expect(result).toBe('success')
    expect(callCount).toBe(2)
  })

  it('maxRetries번째 시도에서 성공하면 RetryExhaustedError 없이 반환한다', async () => {
    const { sleep } = makeFakeSleep()
    let callCount = 0
    const fn = async (): Promise<number> => {
      callCount++
      if (callCount < 3) throw new Error(String(callCount))
      return 99 // 세 번째 시도에서 성공 (maxRetries=2이면 마지막 허용 재시도)
    }

    const result = await withRetry(fn, { maxRetries: 2 }, sleep)

    expect(result).toBe(99)
    expect(callCount).toBe(3)
  })
})

// ─── 3. 정확한 재시도 횟수 검증 ──────────────────────────────────────────────

describe('withRetry — exact retry count', () => {
  it('maxRetries=1: 실패 시 정확히 2회 시도한다', async () => {
    const { sleep } = makeFakeSleep()
    let callCount = 0
    const fn = async (): Promise<void> => {
      callCount++
      throw new Error('x')
    }

    await expect(withRetry(fn, { maxRetries: 1 }, sleep)).rejects.toBeInstanceOf(RetryExhaustedError)
    expect(callCount).toBe(2)
  })

  it('maxRetries=5: 실패 시 정확히 6회 시도한다', async () => {
    const { sleep } = makeFakeSleep()
    let callCount = 0
    const fn = async (): Promise<void> => {
      callCount++
      throw new Error('x')
    }

    await expect(withRetry(fn, { maxRetries: 5 }, sleep)).rejects.toBeInstanceOf(RetryExhaustedError)
    expect(callCount).toBe(6)
  })
})

// ─── 4. 지수 백오프 sleep 호출 순서 검증 ─────────────────────────────────────

describe('withRetry — exponential backoff sleep calls', () => {
  it('재시도마다 지수 백오프 대기 시간이 호출된다 (baseDelayMs=100)', async () => {
    const { sleep, calls } = makeFakeSleep()
    const fn = async (): Promise<void> => { throw new Error('fail') }

    await expect(
      withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10_000 }, sleep)
    ).rejects.toBeInstanceOf(RetryExhaustedError)

    // 시도 0→1: 100ms, 시도 1→2: 200ms, 시도 2→3: 400ms (마지막 후 sleep 없음)
    expect(calls).toEqual([100, 200, 400])
  })

  it('maxDelayMs 상한을 초과하지 않는다', async () => {
    const { sleep, calls } = makeFakeSleep()
    const fn = async (): Promise<void> => { throw new Error('fail') }

    await expect(
      withRetry(fn, { maxRetries: 4, baseDelayMs: 1000, maxDelayMs: 2000 }, sleep)
    ).rejects.toBeInstanceOf(RetryExhaustedError)

    // 1000, 2000(캡), 2000(캡), 2000(캡)
    expect(calls).toEqual([1000, 2000, 2000, 2000])
  })

  it('maxRetries=0이면 sleep을 호출하지 않는다', async () => {
    const { sleep, calls } = makeFakeSleep()
    const fn = async (): Promise<void> => { throw new Error('fail') }

    await expect(withRetry(fn, { maxRetries: 0 }, sleep)).rejects.toBeInstanceOf(RetryExhaustedError)
    expect(calls).toHaveLength(0)
  })
})

// ─── 5. fail-closed: 예외를 삼키지 않음 ──────────────────────────────────────

describe('withRetry — fail-closed', () => {
  it('모든 시도 실패 후 성공 결과를 반환하지 않는다 (fail-open 금지)', async () => {
    const { sleep } = makeFakeSleep()
    const fn = async (): Promise<number> => { throw new Error('fail') }

    let result: number | undefined
    try {
      result = await withRetry(fn, { maxRetries: 2 }, sleep)
    } catch {
      // expected
    }

    expect(result).toBeUndefined()
  })

  it('RetryExhaustedError는 Error의 서브클래스이다', () => {
    const err = new RetryExhaustedError('test', 1, new Error('cause'))
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('RetryExhaustedError')
  })
})

// ─── 6. computeBackoffMs 단위 테스트 ─────────────────────────────────────────

describe('computeBackoffMs', () => {
  it('attempt=0: baseMs * 2^0 = baseMs', () => {
    expect(computeBackoffMs(0, 100, 10_000)).toBe(100)
  })

  it('attempt=1: baseMs * 2^1 = 2*baseMs', () => {
    expect(computeBackoffMs(1, 100, 10_000)).toBe(200)
  })

  it('attempt=2: baseMs * 2^2 = 4*baseMs', () => {
    expect(computeBackoffMs(2, 100, 10_000)).toBe(400)
  })

  it('maxMs 상한을 초과하지 않는다', () => {
    expect(computeBackoffMs(10, 100, 500)).toBe(500)
  })

  it('maxMs와 정확히 같으면 maxMs를 반환한다', () => {
    expect(computeBackoffMs(2, 100, 400)).toBe(400)
  })
})

// Suppress unused jest import warning — jest is needed for ESM globals in this test environment
void jest
