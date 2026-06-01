/**
 * tests/mask-ports-sub-ac-3b.test.ts
 *
 * Sub-AC 3b: maskPorts(arg: string): string 단위 테스트
 *
 * 검증 범위:
 *   - --port <N> / --port=<N> 패턴
 *   - -p <N> / -p=<N> 패턴
 *   - :PORT (콜론 접두 포트) 패턴
 *   - 포트 범위 경계 (1~65535)
 *   - 비포트 값 보존
 *   - 혼합 패턴
 *   - 결정론성 및 순수함수 검증
 *   - _internal 노출 확인
 */

import { maskPorts, _internal } from '../src/detect/triple-builder.js'

// ─── --port 플래그 패턴 ───────────────────────────────────────────

describe('maskPorts — --port 플래그', () => {
  it('--port 3000을 마스킹한다', () => {
    expect(maskPorts('--port 3000')).toBe('--port <PORT>')
  })

  it('--port=8080을 마스킹한다', () => {
    expect(maskPorts('--port=8080')).toBe('--port <PORT>')
  })

  it('--port 80을 마스킹한다', () => {
    expect(maskPorts('--port 80')).toBe('--port <PORT>')
  })

  it('--port 443을 마스킹한다', () => {
    expect(maskPorts('--port 443')).toBe('--port <PORT>')
  })

  it('--port 65535 (최대값)을 마스킹한다', () => {
    expect(maskPorts('--port 65535')).toBe('--port <PORT>')
  })

  it('--port 1 (최소값)을 마스킹한다', () => {
    expect(maskPorts('--port 1')).toBe('--port <PORT>')
  })

  it('명령어 중간의 --port를 마스킹한다', () => {
    const result = maskPorts('node server.js --port 4000 --env prod')
    expect(result).toBe('node server.js --port <PORT> --env prod')
  })

  it('여러 --port를 모두 마스킹한다', () => {
    const result = maskPorts('--port 3000 --port=8080')
    expect(result).toBe('--port <PORT> --port <PORT>')
  })
})

// ─── -p 플래그 패턴 ──────────────────────────────────────────────

describe('maskPorts — -p 플래그', () => {
  it('-p 3000을 마스킹한다', () => {
    expect(maskPorts('-p 3000')).toBe('-p <PORT>')
  })

  it('-p=8080을 마스킹한다', () => {
    expect(maskPorts('-p=8080')).toBe('-p <PORT>')
  })

  it('-p 80을 마스킹한다', () => {
    expect(maskPorts('-p 80')).toBe('-p <PORT>')
  })

  it('-p 65535 (최대값)을 마스킹한다', () => {
    expect(maskPorts('-p 65535')).toBe('-p <PORT>')
  })

  it('-p 1 (최소값)을 마스킹한다', () => {
    expect(maskPorts('-p 1')).toBe('-p <PORT>')
  })

  it('명령어 앞부분의 -p를 마스킹한다', () => {
    const result = maskPorts('docker run -p 8080 nginx')
    expect(result).toBe('docker run -p <PORT> nginx')
  })
})

// ─── :PORT 콜론 패턴 ─────────────────────────────────────────────

describe('maskPorts — :PORT 콜론 패턴', () => {
  it(':8080을 마스킹한다', () => {
    expect(maskPorts(':8080')).toBe(':<PORT>')
  })

  it(':3000을 마스킹한다', () => {
    expect(maskPorts(':3000')).toBe(':<PORT>')
  })

  it('localhost:3000을 마스킹한다', () => {
    expect(maskPorts('localhost:3000')).toBe('localhost:<PORT>')
  })

  it('0.0.0.0:8080을 마스킹한다', () => {
    expect(maskPorts('0.0.0.0:8080')).toBe('0.0.0.0:<PORT>')
  })

  it('127.0.0.1:443을 마스킹한다', () => {
    expect(maskPorts('127.0.0.1:443')).toBe('127.0.0.1:<PORT>')
  })

  it('URL 안의 포트를 마스킹한다', () => {
    const result = maskPorts('http://localhost:3000/api')
    expect(result).toBe('http://localhost:<PORT>/api')
  })

  it(':65535 (최대값)을 마스킹한다', () => {
    expect(maskPorts(':65535')).toBe(':<PORT>')
  })

  it(':1 (최소값)을 마스킹한다', () => {
    expect(maskPorts(':1')).toBe(':<PORT>')
  })

  it('여러 :PORT를 모두 마스킹한다', () => {
    const result = maskPorts('listen :3000 forward :8080')
    expect(result).toBe('listen :<PORT> forward :<PORT>')
  })
})

// ─── 포트 범위 경계 — 비포트 값 보존 ────────────────────────────

describe('maskPorts — 범위 밖 값 보존', () => {
  it(':0은 마스킹하지 않는다 (범위 밖)', () => {
    expect(maskPorts(':0')).toBe(':0')
  })

  it(':65536은 마스킹하지 않는다 (범위 밖)', () => {
    expect(maskPorts(':65536')).toBe(':65536')
  })

  it(':99999는 마스킹하지 않는다', () => {
    expect(maskPorts(':99999')).toBe(':99999')
  })

  it('일반 텍스트를 변경하지 않는다', () => {
    expect(maskPorts('hello world')).toBe('hello world')
  })

  it('빈 문자열을 변경하지 않는다', () => {
    expect(maskPorts('')).toBe('')
  })

  it('파일 경로를 변경하지 않는다', () => {
    const path = '/project/src/foo.ts'
    expect(maskPorts(path)).toBe(path)
  })

  it('버전 문자열을 변경하지 않는다', () => {
    expect(maskPorts('v1.2.3')).toBe('v1.2.3')
  })

  it('일반 숫자를 변경하지 않는다', () => {
    expect(maskPorts('count=42')).toBe('count=42')
  })

  it('ISO 날짜 형식을 변경하지 않는다', () => {
    // 2024-01-15 — 하이픈 구분자, 콜론 없음
    expect(maskPorts('2024-01-15')).toBe('2024-01-15')
  })
})

// ─── 혼합 패턴 ────────────────────────────────────────────────────

describe('maskPorts — 혼합 패턴', () => {
  it('--port와 :PORT가 함께 있는 명령어를 마스킹한다', () => {
    const result = maskPorts('node --port 3000 connect localhost:8080')
    expect(result).toBe('node --port <PORT> connect localhost:<PORT>')
  })

  it('-p와 :PORT가 함께 있는 docker 명령어를 마스킹한다', () => {
    const result = maskPorts('docker run -p 8080 nginx:latest')
    // nginx:latest — "latest"는 숫자가 아니므로 마스킹 안 됨
    expect(result).toBe('docker run -p <PORT> nginx:latest')
  })

  it('Bash 명령어 안의 포트를 마스킹한다', () => {
    const cmd = 'curl http://localhost:3000/health --port 443'
    const result = maskPorts(cmd)
    expect(result).toBe('curl http://localhost:<PORT>/health --port <PORT>')
  })

  it('환경변수 형태 포트를 마스킹한다', () => {
    const result = maskPorts('PORT=3000 node server.js')
    // PORT=3000은 --port/−p/:PORT 패턴에 해당하지 않음
    expect(result).toBe('PORT=3000 node server.js')
  })

  it('여러 다른 패턴이 혼재할 때 포트만 마스킹한다', () => {
    const result = maskPorts('ts=1705312245 host:3000 --port 8080')
    expect(result).toBe('ts=1705312245 host:<PORT> --port <PORT>')
  })
})

// ─── 결정론성 ─────────────────────────────────────────────────────

describe('maskPorts — 결정론성', () => {
  it('동일 입력은 항상 동일 출력을 반환한다', () => {
    const input = '--port 3000 localhost:8080'
    expect(maskPorts(input)).toBe(maskPorts(input))
  })

  it('입력 문자열을 변경하지 않는다 (순수함수)', () => {
    const input = '--port 4000'
    const original = input
    maskPorts(input)
    expect(input).toBe(original)
  })

  it('여러 번 호출해도 동일한 결과를 반환한다', () => {
    const input = 'localhost:3000'
    const first = maskPorts(input)
    const second = maskPorts(input)
    const third = maskPorts(input)
    expect(first).toBe(second)
    expect(second).toBe(third)
  })

  it('멱등성: 이미 마스킹된 문자열을 다시 마스킹해도 변하지 않는다', () => {
    // <PORT>는 숫자가 아니므로 두 번 마스킹해도 결과가 같아야 함
    const once = maskPorts('--port 3000')
    const twice = maskPorts(once)
    expect(once).toBe(twice)
  })
})

// ─── _internal 노출 확인 ──────────────────────────────────────────

describe('maskPorts — _internal 노출', () => {
  it('_internal에 maskPorts가 존재한다', () => {
    expect(typeof _internal.maskPorts).toBe('function')
  })

  it('_internal.maskPorts는 top-level maskPorts와 동일하다', () => {
    const input = '--port 3000'
    expect(_internal.maskPorts(input)).toBe(maskPorts(input))
  })

  it('_internal.maskPorts도 동일한 결과를 반환한다', () => {
    expect(_internal.maskPorts('localhost:8080')).toBe('localhost:<PORT>')
  })
})
