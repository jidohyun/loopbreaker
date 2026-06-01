/**
 * tests/mask-hashes-sub-ac-3d.test.ts
 *
 * Sub-AC 3d: maskHashes(arg: string): string 단위 테스트
 *
 * 검증 범위:
 *   - SHA-256 (64자 hex) 마스킹
 *   - SHA-1 (40자 hex) 마스킹
 *   - MD5 (32자 hex) 마스킹
 *   - UUID 형식 마스킹
 *   - 대소문자 무관 처리
 *   - 비해시 문자열 보존
 *   - 혼합 패턴 처리
 *   - 결정론성 및 순수함수 검증
 *   - 멱등성 검증
 *   - _internal 노출 확인
 */

import { maskHashes, _internal } from '../src/detect/triple-builder.js'

// ─── SHA-256 (64자 hex) ───────────────────────────────────────────────

describe('maskHashes — SHA-256 (64자 hex)', () => {
  const sha256 = 'a'.repeat(64)
  const sha256Upper = 'A'.repeat(64)
  const sha256Mixed = 'aAbBcCdDeEfF0123456789abcdef0123456789abcdef0123456789abcdef0123'

  it('소문자 64자 hex를 마스킹한다', () => {
    expect(maskHashes(sha256)).toBe('<HASH>')
  })

  it('대문자 64자 hex를 마스킹한다', () => {
    expect(maskHashes(sha256Upper)).toBe('<HASH>')
  })

  it('대소문자 혼합 64자 hex를 마스킹한다', () => {
    expect(maskHashes(sha256Mixed)).toBe('<HASH>')
  })

  it('실제 SHA-256 형식 해시를 마스킹한다', () => {
    const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    expect(maskHashes(hash)).toBe('<HASH>')
  })

  it('명령어 내 SHA-256 해시를 마스킹한다', () => {
    const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    const result = maskHashes(`git show ${hash}`)
    expect(result).toBe('git show <HASH>')
  })

  it('여러 SHA-256 해시를 모두 마스킹한다', () => {
    const h1 = 'a'.repeat(64)
    const h2 = 'b'.repeat(64)
    expect(maskHashes(`${h1} ${h2}`)).toBe('<HASH> <HASH>')
  })
})

// ─── SHA-1 (40자 hex) ────────────────────────────────────────────────

describe('maskHashes — SHA-1 (40자 hex)', () => {
  const sha1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
  const sha1Upper = 'DA39A3EE5E6B4B0D3255BFEF95601890AFD80709'

  it('소문자 40자 hex를 마스킹한다', () => {
    expect(maskHashes(sha1)).toBe('<HASH>')
  })

  it('대문자 40자 hex를 마스킹한다', () => {
    expect(maskHashes(sha1Upper)).toBe('<HASH>')
  })

  it('실제 git commit SHA를 마스킹한다', () => {
    const commit = 'abc1234def5678901234567890abcdef01234567'
    expect(maskHashes(commit)).toBe('<HASH>')
  })

  it('git log 출력에서 커밋 해시를 마스킹한다', () => {
    const result = maskHashes('commit abc1234def5678901234567890abcdef01234567')
    expect(result).toBe('commit <HASH>')
  })

  it('여러 SHA-1 해시를 모두 마스킹한다', () => {
    const h1 = 'a'.repeat(40)
    const h2 = 'b'.repeat(40)
    expect(maskHashes(`${h1} then ${h2}`)).toBe('<HASH> then <HASH>')
  })
})

// ─── MD5 (32자 hex) ──────────────────────────────────────────────────

describe('maskHashes — MD5 (32자 hex)', () => {
  const md5 = 'd41d8cd98f00b204e9800998ecf8427e'
  const md5Upper = 'D41D8CD98F00B204E9800998ECF8427E'

  it('소문자 32자 hex를 마스킹한다', () => {
    expect(maskHashes(md5)).toBe('<HASH>')
  })

  it('대문자 32자 hex를 마스킹한다', () => {
    expect(maskHashes(md5Upper)).toBe('<HASH>')
  })

  it('명령어 내 MD5 해시를 마스킹한다', () => {
    const result = maskHashes(`md5sum result: ${md5}`)
    expect(result).toBe('md5sum result: <HASH>')
  })

  it('여러 MD5 해시를 모두 마스킹한다', () => {
    const h1 = 'a'.repeat(32)
    const h2 = 'b'.repeat(32)
    expect(maskHashes(`${h1}:${h2}`)).toBe('<HASH>:<HASH>')
  })
})

// ─── UUID 형식 ────────────────────────────────────────────────────────

describe('maskHashes — UUID 형식', () => {
  it('표준 UUID v4를 마스킹한다', () => {
    expect(maskHashes('550e8400-e29b-41d4-a716-446655440000')).toBe('<HASH>')
  })

  it('UUID v1 형식을 마스킹한다', () => {
    expect(maskHashes('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('<HASH>')
  })

  it('대문자 UUID를 마스킹한다', () => {
    expect(maskHashes('550E8400-E29B-41D4-A716-446655440000')).toBe('<HASH>')
  })

  it('혼합 대소문자 UUID를 마스킹한다', () => {
    expect(maskHashes('550e8400-E29B-41d4-A716-446655440000')).toBe('<HASH>')
  })

  it('명령어 내 UUID를 마스킹한다', () => {
    const result = maskHashes('session id: 550e8400-e29b-41d4-a716-446655440000')
    expect(result).toBe('session id: <HASH>')
  })

  it('여러 UUID를 모두 마스킹한다', () => {
    const u1 = '550e8400-e29b-41d4-a716-446655440000'
    const u2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
    expect(maskHashes(`${u1} and ${u2}`)).toBe('<HASH> and <HASH>')
  })
})

// ─── 비해시 문자열 보존 ───────────────────────────────────────────────

describe('maskHashes — 비해시 문자열 보존', () => {
  it('일반 텍스트를 변경하지 않는다', () => {
    expect(maskHashes('hello world')).toBe('hello world')
  })

  it('빈 문자열을 변경하지 않는다', () => {
    expect(maskHashes('')).toBe('')
  })

  it('31자 hex를 변경하지 않는다 (MD5보다 짧음)', () => {
    const s = 'a'.repeat(31)
    expect(maskHashes(s)).toBe(s)
  })

  it('33자 hex를 변경하지 않는다 (MD5보다 길고 SHA-1보다 짧음)', () => {
    const s = 'a'.repeat(33)
    expect(maskHashes(s)).toBe(s)
  })

  it('41자 hex를 변경하지 않는다 (SHA-1보다 길고 SHA-256보다 짧음)', () => {
    const s = 'a'.repeat(41)
    expect(maskHashes(s)).toBe(s)
  })

  it('65자 hex를 변경하지 않는다 (SHA-256보다 길고 63자가 아님)', () => {
    // 65자: 단어 경계로 64자 서브스트링이 매칭되지 않아야 함
    const s = 'a'.repeat(65)
    expect(maskHashes(s)).toBe(s)
  })

  it('g-z 문자가 포함된 비hex 문자열을 변경하지 않는다', () => {
    const s = 'g'.repeat(64)  // 'g'는 hex가 아님
    expect(maskHashes(s)).toBe(s)
  })

  it('일반 숫자 문자열을 변경하지 않는다', () => {
    expect(maskHashes('12345678')).toBe('12345678')
  })

  it('파일 경로를 변경하지 않는다', () => {
    expect(maskHashes('/project/src/index.ts')).toBe('/project/src/index.ts')
  })

  it('URL을 변경하지 않는다', () => {
    expect(maskHashes('https://example.com/api')).toBe('https://example.com/api')
  })

  it('타임스탬프를 변경하지 않는다 (10자리 숫자)', () => {
    expect(maskHashes('1705312245')).toBe('1705312245')
  })

  it('short hex prefix (sha256:xxxx... 형식의 prefix)를 유지한다', () => {
    // sha256: prefix는 마스킹되지 않고 뒤의 hex만 마스킹
    const hash = 'a'.repeat(64)
    expect(maskHashes(`sha256:${hash}`)).toBe('sha256:<HASH>')
  })
})

// ─── 혼합 패턴 ────────────────────────────────────────────────────────

describe('maskHashes — 혼합 패턴', () => {
  it('MD5와 SHA-1이 함께 있으면 모두 마스킹한다', () => {
    const md5 = 'd41d8cd98f00b204e9800998ecf8427e'
    const sha1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
    expect(maskHashes(`${md5} ${sha1}`)).toBe('<HASH> <HASH>')
  })

  it('UUID와 SHA-256이 함께 있으면 모두 마스킹한다', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    expect(maskHashes(`session=${uuid} hash=${sha256}`)).toBe('session=<HASH> hash=<HASH>')
  })

  it('해시와 일반 텍스트가 혼재할 때 해시만 마스킹한다', () => {
    const sha1 = 'abc1234def5678901234567890abcdef01234567'
    const result = maskHashes(`git checkout ${sha1} -- src/index.ts`)
    expect(result).toBe('git checkout <HASH> -- src/index.ts')
  })

  it('git log 형식의 복합 출력을 처리한다', () => {
    const commit = 'abc1234def5678901234567890abcdef01234567'
    const result = maskHashes(`Author: user@example.com\ncommit ${commit}\nDate: 2024-01-01`)
    expect(result).toBe(`Author: user@example.com\ncommit <HASH>\nDate: 2024-01-01`)
  })

  it('sha256: 접두사가 붙은 해시를 처리한다', () => {
    const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    const result = maskHashes(`checksum sha256:${hash} ok`)
    expect(result).toBe('checksum sha256:<HASH> ok')
  })
})

// ─── 결정론성 ─────────────────────────────────────────────────────────

describe('maskHashes — 결정론성', () => {
  it('동일 입력은 항상 동일 출력을 반환한다', () => {
    const input = 'da39a3ee5e6b4b0d3255bfef95601890afd80709'
    expect(maskHashes(input)).toBe(maskHashes(input))
  })

  it('입력 문자열을 변경하지 않는다 (순수함수)', () => {
    const input = 'd41d8cd98f00b204e9800998ecf8427e'
    const original = input
    maskHashes(input)
    expect(input).toBe(original)
  })

  it('여러 번 호출해도 동일한 결과를 반환한다', () => {
    const input = '550e8400-e29b-41d4-a716-446655440000'
    const first = maskHashes(input)
    const second = maskHashes(input)
    const third = maskHashes(input)
    expect(first).toBe(second)
    expect(second).toBe(third)
  })

  it('멱등성: 이미 마스킹된 문자열을 다시 마스킹해도 변하지 않는다', () => {
    // <HASH>는 어떤 hex 패턴에도 해당하지 않음
    const once = maskHashes('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    const twice = maskHashes(once)
    expect(once).toBe(twice)
    expect(once).toBe('<HASH>')
  })
})

// ─── _internal 노출 확인 ──────────────────────────────────────────────

describe('maskHashes — _internal 노출', () => {
  it('_internal에 maskHashes가 존재한다', () => {
    expect(typeof _internal.maskHashes).toBe('function')
  })

  it('_internal.maskHashes는 top-level maskHashes와 동일하다', () => {
    const input = 'd41d8cd98f00b204e9800998ecf8427e'
    expect(_internal.maskHashes(input)).toBe(maskHashes(input))
  })

  it('_internal.maskHashes도 동일한 결과를 반환한다', () => {
    expect(_internal.maskHashes('da39a3ee5e6b4b0d3255bfef95601890afd80709')).toBe('<HASH>')
  })
})
