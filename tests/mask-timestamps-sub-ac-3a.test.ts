/**
 * tests/mask-timestamps-sub-ac-3a.test.ts
 *
 * Sub-AC 3a: maskTimestamps(arg: string): string 단위 테스트
 *
 * 검증 범위:
 *   - ISO 8601 datetime 패턴 (T 구분자, Z / 오프셋 / 오프셋 없음)
 *   - ISO 8601 date-only (YYYY-MM-DD)
 *   - Unix epoch 밀리초 (13자리)
 *   - Unix epoch 초 (10자리)
 *   - 여러 패턴 혼합 문자열
 *   - 비타임스탬프 숫자/문자열 보존
 *   - 결정론성 및 순수함수 검증
 */

import { maskTimestamps, _internal } from '../src/detect/triple-builder.js'

// ─── ISO 8601 datetime ────────────────────────────────────────────

describe('maskTimestamps — ISO 8601 datetime', () => {
  it('UTC Z 접미사 datetime을 마스킹한다', () => {
    expect(maskTimestamps('2024-01-15T10:30:45Z')).toBe('<TIMESTAMP>')
  })

  it('밀리초 포함 UTC datetime을 마스킹한다', () => {
    expect(maskTimestamps('2024-01-15T10:30:45.123Z')).toBe('<TIMESTAMP>')
  })

  it('마이크로초 포함 UTC datetime을 마스킹한다', () => {
    expect(maskTimestamps('2024-01-15T10:30:45.123456Z')).toBe('<TIMESTAMP>')
  })

  it('+HH:MM 오프셋 datetime을 마스킹한다', () => {
    expect(maskTimestamps('2024-01-15T10:30:45+09:00')).toBe('<TIMESTAMP>')
  })

  it('-HH:MM 오프셋 datetime을 마스킹한다', () => {
    expect(maskTimestamps('2024-01-15T10:30:45-05:30')).toBe('<TIMESTAMP>')
  })

  it('밀리초 + 오프셋 datetime을 마스킹한다', () => {
    expect(maskTimestamps('2024-01-15T10:30:45.999+09:00')).toBe('<TIMESTAMP>')
  })

  it('오프셋 없는 로컬 datetime을 마스킹한다', () => {
    expect(maskTimestamps('2024-01-15T10:30:45')).toBe('<TIMESTAMP>')
  })

  it('문장 중간의 ISO datetime을 마스킹한다', () => {
    const result = maskTimestamps('Event at 2024-03-20T15:00:00Z occurred')
    expect(result).toBe('Event at <TIMESTAMP> occurred')
  })

  it('여러 ISO datetime을 모두 마스킹한다', () => {
    const result = maskTimestamps('start=2024-01-01T00:00:00Z end=2024-12-31T23:59:59Z')
    expect(result).toBe('start=<TIMESTAMP> end=<TIMESTAMP>')
  })
})

// ─── ISO 8601 date-only ───────────────────────────────────────────

describe('maskTimestamps — ISO 8601 date-only', () => {
  it('YYYY-MM-DD 날짜를 마스킹한다', () => {
    expect(maskTimestamps('2024-01-15')).toBe('<TIMESTAMP>')
  })

  it('문장 중간의 날짜를 마스킹한다', () => {
    const result = maskTimestamps('Created on 2024-03-20 by user')
    expect(result).toBe('Created on <TIMESTAMP> by user')
  })

  it('여러 날짜를 모두 마스킹한다', () => {
    const result = maskTimestamps('from 2024-01-01 to 2024-12-31')
    expect(result).toBe('from <TIMESTAMP> to <TIMESTAMP>')
  })

  it('연도 시작 날짜를 마스킹한다', () => {
    expect(maskTimestamps('2000-01-01')).toBe('<TIMESTAMP>')
  })

  it('연도 끝 날짜를 마스킹한다', () => {
    expect(maskTimestamps('1999-12-31')).toBe('<TIMESTAMP>')
  })
})

// ─── Unix epoch 밀리초 (13자리) ───────────────────────────────────

describe('maskTimestamps — Unix epoch 밀리초 (13자리)', () => {
  it('13자리 epoch 밀리초를 마스킹한다', () => {
    expect(maskTimestamps('1705312245123')).toBe('<TIMESTAMP>')
  })

  it('문장 중간의 13자리 숫자를 마스킹한다', () => {
    const result = maskTimestamps('ts=1705312245123 value=42')
    expect(result).toBe('ts=<TIMESTAMP> value=42')
  })

  it('현재 시각 밀리초(2024년 범위)를 마스킹한다', () => {
    // 2024-01-01 00:00:00 UTC = 1704067200000
    expect(maskTimestamps('1704067200000')).toBe('<TIMESTAMP>')
  })

  it('여러 13자리 숫자를 모두 마스킹한다', () => {
    const result = maskTimestamps('start=1704067200000 end=1735689600000')
    expect(result).toBe('start=<TIMESTAMP> end=<TIMESTAMP>')
  })

  it('13자리 경계 최솟값을 마스킹한다', () => {
    expect(maskTimestamps('1000000000000')).toBe('<TIMESTAMP>')
  })

  it('13자리 경계 최댓값을 마스킹한다', () => {
    expect(maskTimestamps('9999999999999')).toBe('<TIMESTAMP>')
  })
})

// ─── Unix epoch 초 (10자리) ───────────────────────────────────────

describe('maskTimestamps — Unix epoch 초 (10자리)', () => {
  it('10자리 epoch 초를 마스킹한다', () => {
    expect(maskTimestamps('1705312245')).toBe('<TIMESTAMP>')
  })

  it('문장 중간의 10자리 숫자를 마스킹한다', () => {
    const result = maskTimestamps('expires=1705312245 token=abc')
    expect(result).toBe('expires=<TIMESTAMP> token=abc')
  })

  it('10자리 경계 최솟값을 마스킹한다', () => {
    expect(maskTimestamps('1000000000')).toBe('<TIMESTAMP>')
  })

  it('10자리 경계 최댓값을 마스킹한다', () => {
    expect(maskTimestamps('9999999999')).toBe('<TIMESTAMP>')
  })

  it('여러 10자리 epoch를 모두 마스킹한다', () => {
    const result = maskTimestamps('a=1704067200 b=1735689600')
    expect(result).toBe('a=<TIMESTAMP> b=<TIMESTAMP>')
  })
})

// ─── 비타임스탬프 값 보존 ─────────────────────────────────────────

describe('maskTimestamps — 비타임스탬프 값 보존', () => {
  it('9자리 이하 숫자는 변경하지 않는다', () => {
    expect(maskTimestamps('999999999')).toBe('999999999')
  })

  it('8자리 숫자는 변경하지 않는다', () => {
    expect(maskTimestamps('12345678')).toBe('12345678')
  })

  it('11자리 숫자는 변경하지 않는다 (10·13 사이)', () => {
    // 11자리는 epoch 초도 밀리초도 아님
    expect(maskTimestamps('12345678901')).toBe('12345678901')
  })

  it('12자리 숫자는 변경하지 않는다', () => {
    expect(maskTimestamps('123456789012')).toBe('123456789012')
  })

  it('14자리 이상 숫자는 변경하지 않는다', () => {
    expect(maskTimestamps('12345678901234')).toBe('12345678901234')
  })

  it('일반 텍스트를 변경하지 않는다', () => {
    expect(maskTimestamps('hello world')).toBe('hello world')
  })

  it('빈 문자열을 변경하지 않는다', () => {
    expect(maskTimestamps('')).toBe('')
  })

  it('파일 경로를 변경하지 않는다', () => {
    const path = '/project/src/foo.ts'
    expect(maskTimestamps(path)).toBe(path)
  })

  it('포트 번호(:NNNN)를 변경하지 않는다', () => {
    // 포트는 4~5자리 — epoch 패턴(10·13자리)에 해당 없음
    expect(maskTimestamps('localhost:3000')).toBe('localhost:3000')
  })

  it('버전 문자열을 변경하지 않는다', () => {
    expect(maskTimestamps('v1.2.3')).toBe('v1.2.3')
  })

  it('일반 날짜 형식이 아닌 YYYY/MM/DD는 변경하지 않는다', () => {
    // 슬래시 구분자 — ISO 8601 하이픈 패턴이 아님
    expect(maskTimestamps('2024/01/15')).toBe('2024/01/15')
  })
})

// ─── 혼합 패턴 ────────────────────────────────────────────────────

describe('maskTimestamps — 혼합 패턴', () => {
  it('ISO datetime과 epoch 밀리초가 함께 있는 문자열을 마스킹한다', () => {
    const result = maskTimestamps('at=2024-01-15T10:30:45Z ms=1705312245123')
    expect(result).toBe('at=<TIMESTAMP> ms=<TIMESTAMP>')
  })

  it('ISO date-only와 epoch 초가 함께 있는 문자열을 마스킹한다', () => {
    const result = maskTimestamps('date=2024-01-15 ts=1705312245')
    expect(result).toBe('date=<TIMESTAMP> ts=<TIMESTAMP>')
  })

  it('Bash 명령어 안의 타임스탬프를 마스킹한다', () => {
    const cmd = 'curl -H "Date: 2024-01-15T10:30:45Z" https://api.example.com'
    const result = maskTimestamps(cmd)
    expect(result).toBe('curl -H "Date: <TIMESTAMP>" https://api.example.com')
  })

  it('로그 라인의 타임스탬프를 마스킹한다', () => {
    const log = '[2024-03-15T08:22:11.456Z] INFO: process started pid=1234567890'
    const result = maskTimestamps(log)
    expect(result).toBe('[<TIMESTAMP>] INFO: process started pid=<TIMESTAMP>')
  })

  it('JSON 값 안의 타임스탬프를 마스킹한다', () => {
    const json = '{"created":"2024-01-15T00:00:00Z","ts":1704067200000}'
    const result = maskTimestamps(json)
    expect(result).toBe('{"created":"<TIMESTAMP>","ts":<TIMESTAMP>}')
  })

  it('비타임스탬프 값과 타임스탬프가 혼재할 때 타임스탬프만 마스킹한다', () => {
    const result = maskTimestamps('count=42 ts=1705312245 name=foo')
    expect(result).toBe('count=42 ts=<TIMESTAMP> name=foo')
  })
})

// ─── 결정론성 ─────────────────────────────────────────────────────

describe('maskTimestamps — 결정론성', () => {
  it('동일 입력은 항상 동일 출력을 반환한다', () => {
    const input = 'ts=2024-01-15T10:30:45Z epoch=1705312245'
    expect(maskTimestamps(input)).toBe(maskTimestamps(input))
  })

  it('입력 문자열을 변경하지 않는다 (순수함수)', () => {
    const input = 'created=2024-01-15'
    const original = input
    maskTimestamps(input)
    expect(input).toBe(original)
  })

  it('여러 번 호출해도 동일한 결과를 반환한다', () => {
    const input = '1705312245123'
    const first = maskTimestamps(input)
    const second = maskTimestamps(input)
    const third = maskTimestamps(input)
    expect(first).toBe(second)
    expect(second).toBe(third)
  })
})

// ─── _internal 노출 확인 ──────────────────────────────────────────

describe('maskTimestamps — _internal 노출', () => {
  it('_internal에 maskTimestamps가 존재한다', () => {
    expect(typeof _internal.maskTimestamps).toBe('function')
  })

  it('_internal.maskTimestamps는 top-level maskTimestamps와 동일하다', () => {
    const input = '2024-01-15T10:30:45Z'
    expect(_internal.maskTimestamps(input)).toBe(maskTimestamps(input))
  })

  it('_internal.maskTimestamps도 동일한 결과를 반환한다', () => {
    expect(_internal.maskTimestamps('1705312245')).toBe('<TIMESTAMP>')
  })
})
