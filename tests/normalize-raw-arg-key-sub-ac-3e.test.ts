/**
 * tests/normalize-raw-arg-key-sub-ac-3e.test.ts
 *
 * Sub-AC 3e: normalizeRawArgKey(rawArg: string): string 통합 단위 테스트
 *
 * 검증 범위:
 *   - 마스커 4종(timestamps, ports, tmpPaths, hashes)의 순서대로 합성 적용
 *   - 복합 입력: 타임스탬프+해시 혼재, 포트+경로 혼재, 전체 4종 혼재
 *   - 순서 의존성: 타임스탬프를 먼저 처리해야 포트와 충돌하지 않음
 *   - 결정론성 및 순수함수 검증
 *   - 멱등성: 이미 마스킹된 문자열에 재적용해도 추가 변경 없음
 *   - _internal 노출 확인
 *
 * 마스킹 적용 순서 (SPEC §4 §1a):
 *   1. maskTimestamps → 2. maskPorts → 3. maskTmpPaths → 4. maskHashes
 */

import { normalizeRawArgKey, _internal } from '../src/detect/triple-builder.js'

// ─── 헬퍼: 단계별 마스커를 개별 적용해 기대값 계산 ──────────────────

const { maskTimestamps, maskPorts, maskTmpPaths, maskHashes } = _internal

/** 4종 마스커를 순서대로 합성 적용한 기대값 계산 (참조 구현) */
function applyAllMaskers(s: string): string {
  return maskHashes(maskTmpPaths(maskPorts(maskTimestamps(s))))
}

// ─── 단일 마스커 통과: 각 마스커가 개별적으로 동작함 ────────────────────

describe('normalizeRawArgKey — 단일 타임스탬프 패턴', () => {
  it('ISO 8601 datetime (UTC Z)를 마스킹한다', () => {
    const result = normalizeRawArgKey('event at 2024-01-15T10:30:45Z')
    expect(result).toBe('event at <TIMESTAMP>')
  })

  it('ISO 8601 datetime (밀리초 + 오프셋)을 마스킹한다', () => {
    const result = normalizeRawArgKey('2024-03-20T15:00:00.123+09:00')
    expect(result).toBe('<TIMESTAMP>')
  })

  it('ISO 8601 date-only를 마스킹한다', () => {
    const result = normalizeRawArgKey('date: 2024-06-01')
    expect(result).toBe('date: <TIMESTAMP>')
  })

  it('Unix epoch 밀리초(13자리)를 마스킹한다', () => {
    const result = normalizeRawArgKey('ts=1717200000000')
    expect(result).toBe('ts=<TIMESTAMP>')
  })

  it('Unix epoch 초(10자리)를 마스킹한다', () => {
    const result = normalizeRawArgKey('created_at=1717200000')
    expect(result).toBe('created_at=<TIMESTAMP>')
  })
})

describe('normalizeRawArgKey — 단일 포트 패턴', () => {
  it('--port 옵션을 마스킹한다', () => {
    const result = normalizeRawArgKey('node server.js --port 3000')
    expect(result).toBe('node server.js --port <PORT>')
  })

  it('--port= 형식을 마스킹한다', () => {
    const result = normalizeRawArgKey('npx next dev --port=8080')
    expect(result).toBe('npx next dev --port <PORT>')
  })

  it('-p 옵션을 마스킹한다', () => {
    const result = normalizeRawArgKey('docker run -p 4000 image')
    expect(result).toBe('docker run -p <PORT> image')
  })

  it(':PORT 형식을 마스킹한다', () => {
    const result = normalizeRawArgKey('curl http://localhost:8080/api')
    expect(result).toBe('curl http://localhost:<PORT>/api')
  })

  it('범위 밖 포트(0, 65536+)는 마스킹하지 않는다', () => {
    const result = normalizeRawArgKey('--port 0 --port 65536')
    expect(result).toBe('--port 0 --port 65536')
  })
})

describe('normalizeRawArgKey — 단일 임시 경로 패턴', () => {
  it('/tmp/... 경로를 마스킹한다', () => {
    const result = normalizeRawArgKey('cat /tmp/output-1234.log')
    expect(result).toBe('cat <TMP_PATH>')
  })

  it('/var/folders/... macOS 임시 경로를 마스킹한다', () => {
    const result = normalizeRawArgKey('open /var/folders/xy/abc123/T/file.tmp')
    expect(result).toBe('open <TMP_PATH>')
  })

  it('/var/tmp/... 경로를 마스킹한다', () => {
    const result = normalizeRawArgKey('ls /var/tmp/session-data')
    expect(result).toBe('ls <TMP_PATH>')
  })

  it('Windows Temp 경로(백슬래시)를 마스킹한다', () => {
    const result = normalizeRawArgKey('copy C:\\Users\\user\\AppData\\Local\\Temp\\file.tmp dst')
    expect(result).toBe('copy <TMP_PATH> dst')
  })
})

describe('normalizeRawArgKey — 단일 해시 패턴', () => {
  it('SHA-256(64자 hex)을 마스킹한다', () => {
    const sha256 = 'a'.repeat(64)
    const result = normalizeRawArgKey(`hash: ${sha256}`)
    expect(result).toBe('hash: <HASH>')
  })

  it('SHA-1(40자 hex)을 마스킹한다', () => {
    const sha1 = 'b'.repeat(40)
    const result = normalizeRawArgKey(`commit ${sha1}`)
    expect(result).toBe('commit <HASH>')
  })

  it('MD5(32자 hex)을 마스킹한다', () => {
    const md5 = 'c'.repeat(32)
    const result = normalizeRawArgKey(`checksum: ${md5}`)
    expect(result).toBe('checksum: <HASH>')
  })

  it('UUID를 마스킹한다', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const result = normalizeRawArgKey(`session: ${uuid}`)
    expect(result).toBe('session: <HASH>')
  })
})

// ─── 복합 입력: 타임스탬프 + 해시 혼재 ─────────────────────────────────

describe('normalizeRawArgKey — 복합: 타임스탬프 + 해시 혼재', () => {
  it('ISO datetime과 SHA-256이 같은 문자열에 있을 때 둘 다 마스킹한다', () => {
    const sha256 = 'deadbeef'.repeat(8) // 64자
    const input = `event 2024-01-15T10:30:45Z hash=${sha256}`
    const result = normalizeRawArgKey(input)
    expect(result).toBe('event <TIMESTAMP> hash=<HASH>')
  })

  it('epoch 밀리초와 UUID가 혼재할 때 둘 다 마스킹한다', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const input = `ts=1717200000000 id=${uuid}`
    const result = normalizeRawArgKey(input)
    expect(result).toBe('ts=<TIMESTAMP> id=<HASH>')
  })

  it('날짜와 git commit SHA-1이 혼재할 때 둘 다 마스킹한다', () => {
    const sha1 = 'f'.repeat(40)
    const input = `deployed on 2024-03-15 commit=${sha1}`
    const result = normalizeRawArgKey(input)
    expect(result).toBe('deployed on <TIMESTAMP> commit=<HASH>')
  })

  it('복수의 타임스탬프와 복수의 해시가 혼재할 때 모두 마스킹한다', () => {
    const sha256 = 'a'.repeat(64)
    const md5 = 'b'.repeat(32)
    const input = `start=2024-01-01T00:00:00Z end=2024-12-31T23:59:59Z h1=${sha256} h2=${md5}`
    const result = normalizeRawArgKey(input)
    expect(result).toBe('start=<TIMESTAMP> end=<TIMESTAMP> h1=<HASH> h2=<HASH>')
  })
})

// ─── 복합 입력: 포트 + 임시 경로 혼재 ──────────────────────────────────

describe('normalizeRawArgKey — 복합: 포트 + 임시 경로 혼재', () => {
  it('--port와 /tmp 경로가 혼재할 때 둘 다 마스킹한다', () => {
    const input = 'node server.js --port 3000 --log /tmp/server.log'
    const result = normalizeRawArgKey(input)
    expect(result).toBe('node server.js --port <PORT> --log <TMP_PATH>')
  })

  it(':PORT가 있는 URL과 /tmp 경로가 혼재할 때 둘 다 마스킹한다', () => {
    const input = 'curl http://localhost:8080/api > /tmp/response.json'
    const result = normalizeRawArgKey(input)
    expect(result).toBe('curl http://localhost:<PORT>/api > <TMP_PATH>')
  })

  it('/var/folders 임시 경로와 포트 옵션이 혼재할 때 둘 다 마스킹한다', () => {
    const input = 'app --port=4000 --tmp /var/folders/xy/abc/T/cache'
    const result = normalizeRawArgKey(input)
    expect(result).toBe('app --port <PORT> --tmp <TMP_PATH>')
  })
})

// ─── 복합 입력: 4종 전체 혼재 ──────────────────────────────────────────

describe('normalizeRawArgKey — 복합: 4종 전체 혼재', () => {
  it('타임스탬프+포트+임시경로+해시가 모두 혼재할 때 모두 마스킹한다', () => {
    const sha1 = 'a'.repeat(40)
    const input = `2024-01-15T10:30:45Z --port 3000 /tmp/test.log ${sha1}`
    const result = normalizeRawArgKey(input)
    expect(result).toBe('<TIMESTAMP> --port <PORT> <TMP_PATH> <HASH>')
  })

  it('Bash 명령어 스타일 복합 입력: 전체 마스킹', () => {
    const sha256 = 'deadbeef'.repeat(8)
    const input = `curl -X POST http://api.example.com:8080/data -H "Date: 2024-06-01T12:00:00Z" --output /tmp/result-${sha256}.json`
    const result = normalizeRawArgKey(input)
    // timestamp → port → tmp path → hash 순으로 처리
    expect(result).toContain('<TIMESTAMP>')
    expect(result).toContain('<PORT>')
    expect(result).toContain('<TMP_PATH>')
    // sha256은 /tmp/ 경로 안에 포함되어 <TMP_PATH>로 흡수됨 (경로 패턴이 더 넓음)
  })

  it('로그 라인 스타일 복합 입력', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const input = `[2024-03-20T15:00:00.123Z] session=${uuid} server=:3000 tmp=/tmp/sess.lock`
    const result = normalizeRawArgKey(input)
    expect(result).toContain('<TIMESTAMP>')
    expect(result).toContain('<HASH>')    // uuid → <HASH>
    expect(result).toContain('<PORT>')   // :3000 → :<PORT>
    expect(result).toContain('<TMP_PATH>') // /tmp/sess.lock → <TMP_PATH>
  })

  it('모든 마스킹 후 결과는 기대값과 일치한다 (참조 구현 비교)', () => {
    const sha1 = '1234567890abcdef1234567890abcdef12345678' // 40자
    const inputs = [
      `ts=1717200000000 port=:8080 path=/tmp/file.log hash=${sha1}`,
      `2024-01-01T00:00:00Z --port=9090 /var/folders/x/y/T/tmp.bin ${'f'.repeat(32)}`,
      `event 2024-06-01 commit=${'a'.repeat(40)} --port 443 output=/tmp/out`,
    ]
    for (const input of inputs) {
      expect(normalizeRawArgKey(input)).toBe(applyAllMaskers(input))
    }
  })
})

// ─── 순서 의존성: 타임스탬프가 먼저 처리되어야 함 ───────────────────────

describe('normalizeRawArgKey — 마스커 적용 순서 의존성', () => {
  it('10자리 epoch는 포트보다 먼저 타임스탬프로 마스킹된다', () => {
    // 1717200000 (10자리) → 타임스탬프로 먼저 흡수, 포트(:1717200000)로 처리 안 됨
    const input = 'at=1717200000 next'
    const result = normalizeRawArgKey(input)
    expect(result).toBe('at=<TIMESTAMP> next')
    expect(result).not.toContain('<PORT>')
  })

  it('ISO datetime이 해시보다 먼저 처리된다 (datetime에 hex 문자 포함 가능)', () => {
    // YYYY-MM-DDTHH:MM:SS에는 a-f가 포함되지 않으므로 일반적으로 충돌 없음
    // 타임스탬프 먼저 마스킹 → 결과에 <TIMESTAMP> 포함
    const input = '2024-01-15T10:30:45Z'
    const result = normalizeRawArgKey(input)
    expect(result).toBe('<TIMESTAMP>')
  })

  it('이미 <TIMESTAMP>로 마스킹된 플레이스홀더는 해시 패턴으로 재처리되지 않는다', () => {
    // <TIMESTAMP>는 hex 문자만으로 이루어지지 않으므로 해시 마스커에 걸리지 않음
    const input = '<TIMESTAMP>'
    const result = normalizeRawArgKey(input)
    expect(result).toBe('<TIMESTAMP>')
  })

  it('이미 <PORT>로 마스킹된 플레이스홀더는 경로나 해시로 재처리되지 않는다', () => {
    const input = '--port <PORT>'
    const result = normalizeRawArgKey(input)
    expect(result).toBe('--port <PORT>')
  })
})

// ─── 결정론성 및 순수함수 검증 ───────────────────────────────────────────

describe('normalizeRawArgKey — 결정론성', () => {
  it('같은 입력은 항상 같은 출력을 반환한다', () => {
    const sha256 = 'deadbeef'.repeat(8)
    const input = `2024-01-15T10:30:45Z --port 3000 /tmp/file.log ${sha256}`
    const r1 = normalizeRawArgKey(input)
    const r2 = normalizeRawArgKey(input)
    const r3 = normalizeRawArgKey(input)
    expect(r1).toBe(r2)
    expect(r2).toBe(r3)
  })

  it('입력 문자열을 변경하지 않는다 (불변성)', () => {
    const original = '2024-01-15T10:30:45Z --port 3000'
    const frozen = Object.freeze({ value: original })
    const result = normalizeRawArgKey(frozen.value)
    expect(frozen.value).toBe(original) // 원본 불변
    expect(result).not.toBe(original)   // 결과는 달라야 함
  })

  it('빈 문자열을 입력하면 빈 문자열을 반환한다', () => {
    expect(normalizeRawArgKey('')).toBe('')
  })

  it('마스킹 대상이 없는 문자열은 그대로 반환한다', () => {
    const clean = 'git commit -m "refactor: improve performance"'
    expect(normalizeRawArgKey(clean)).toBe(clean)
  })

  it('숫자가 없는 순수 텍스트는 그대로 반환한다', () => {
    const text = 'hello world foo bar'
    expect(normalizeRawArgKey(text)).toBe(text)
  })
})

// ─── 멱등성: 이미 마스킹된 출력에 재적용해도 동일 ─────────────────────────

describe('normalizeRawArgKey — 멱등성', () => {
  it('한 번 마스킹한 결과에 재적용해도 동일한 출력을 반환한다', () => {
    const sha256 = 'a'.repeat(64)
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const inputs = [
      `2024-01-15T10:30:45Z --port 3000 /tmp/file.log ${sha256}`,
      `event at 1717200000000 session=${uuid}`,
      'node server.js --port=8080',
      `sha=${sha256}`,
    ]
    for (const input of inputs) {
      const once = normalizeRawArgKey(input)
      const twice = normalizeRawArgKey(once)
      expect(twice).toBe(once)
    }
  })

  it('<HASH> 플레이스홀더는 해시 패턴으로 재마스킹되지 않는다', () => {
    // <HASH>는 32/40/64자 hex가 아니므로 재마스킹 대상이 아님
    expect(normalizeRawArgKey('<HASH>')).toBe('<HASH>')
  })

  it('<TMP_PATH> 플레이스홀더는 경로 패턴으로 재처리되지 않는다', () => {
    expect(normalizeRawArgKey('<TMP_PATH>')).toBe('<TMP_PATH>')
  })
})

// ─── 비마스킹 문자열 보존 ────────────────────────────────────────────────

describe('normalizeRawArgKey — 비마스킹 문자열 보존', () => {
  it('버전 번호(짧은 숫자)는 마스킹하지 않는다', () => {
    expect(normalizeRawArgKey('v1.2.3')).toBe('v1.2.3')
  })

  it('9자리 이하 숫자는 타임스탬프로 마스킹하지 않는다', () => {
    expect(normalizeRawArgKey('count=123456789')).toBe('count=123456789')
  })

  it('63자 hex 문자열(SHA-256보다 1자 짧음)은 마스킹하지 않는다', () => {
    const notHash = 'a'.repeat(63)
    expect(normalizeRawArgKey(notHash)).toBe(notHash)
  })

  it('31자 hex 문자열(MD5보다 1자 짧음)은 마스킹하지 않는다', () => {
    const notHash = 'b'.repeat(31)
    expect(normalizeRawArgKey(notHash)).toBe(notHash)
  })

  it('파일 경로(비임시)는 마스킹하지 않는다', () => {
    expect(normalizeRawArgKey('/project/src/foo.ts')).toBe('/project/src/foo.ts')
  })

  it('일반 URL(포트 없음)은 마스킹하지 않는다', () => {
    expect(normalizeRawArgKey('https://example.com/api/v1/users')).toBe('https://example.com/api/v1/users')
  })
})

// ─── 참조 구현과의 일치 검증 ─────────────────────────────────────────────

describe('normalizeRawArgKey — 참조 구현(applyAllMaskers) 일치 검증', () => {
  const testCases = [
    // [description, input]
    ['빈 문자열', ''],
    ['타임스탬프만', '2024-01-15T10:30:45Z'],
    ['epoch 밀리초만', '1717200000000'],
    ['포트만', 'server --port 3000'],
    ['임시경로만', 'log=/tmp/app.log'],
    ['SHA-256만', `hash=${'a'.repeat(64)}`],
    ['UUID만', '550e8400-e29b-41d4-a716-446655440000'],
    ['복합: timestamp+port', '2024-01-01T00:00:00Z :8080'],
    ['복합: port+tmpPath', '--port 3000 /tmp/cache'],
    ['복합: tmpPath+hash', `/tmp/file ${'b'.repeat(32)}`],
    ['복합: timestamp+hash', `2024-06-01 ${'c'.repeat(40)}`],
    ['복합: 전체 4종', `2024-01-15T10:30:45Z :3000 /tmp/x ${'d'.repeat(64)}`],
    ['일반 텍스트', 'git status --short'],
    ['버전 번호', 'v2.0.0-rc.1'],
    ['혼합 보존+마스킹', `version=2.0.0 ts=1717200000000 key=${'f'.repeat(32)}`],
  ]

  for (const [description, input] of testCases) {
    it(`참조 구현과 일치: ${description}`, () => {
      expect(normalizeRawArgKey(input)).toBe(applyAllMaskers(input))
    })
  }
})

// ─── _internal 노출 확인 ─────────────────────────────────────────────────

describe('_internal — normalizeRawArgKey 노출 확인', () => {
  it('_internal에 normalizeRawArgKey가 존재한다', () => {
    expect(typeof _internal.normalizeRawArgKey).toBe('function')
  })

  it('_internal.normalizeRawArgKey는 top-level normalizeRawArgKey와 동일하다', () => {
    const input = '2024-01-15T10:30:45Z --port 3000'
    expect(_internal.normalizeRawArgKey(input)).toBe(normalizeRawArgKey(input))
  })

  it('_internal의 개별 마스커 함수들이 모두 존재한다', () => {
    expect(typeof _internal.maskTimestamps).toBe('function')
    expect(typeof _internal.maskPorts).toBe('function')
    expect(typeof _internal.maskTmpPaths).toBe('function')
    expect(typeof _internal.maskHashes).toBe('function')
  })

  it('_internal 마스커 합성 결과는 normalizeRawArgKey와 동일하다', () => {
    const input = `event 2024-06-01T12:00:00Z session=${'a'.repeat(40)} --port 8080 tmp=/tmp/x`
    const manual = _internal.maskHashes(
      _internal.maskTmpPaths(
        _internal.maskPorts(
          _internal.maskTimestamps(input)
        )
      )
    )
    expect(normalizeRawArgKey(input)).toBe(manual)
  })
})
