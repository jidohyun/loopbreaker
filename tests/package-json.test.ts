// tests/package-json.test.ts
// Sub-AC 1: package.json 필수 필드 검증.
// Sub-AC 2: engines.node가 semver >=20을 만족함을 Node 스크립트로 검증.
// JSON.parse로 파싱하고 각 필드가 올바른지 assert.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const pkgPath = join(__dirname, '..', 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>

/**
 * engines.node 범위 문자열에서 최소 major 버전을 파싱한다.
 * ">=" 연산자로 명시된 숫자를 추출.
 * Sub-AC 2: 이 함수를 통해 semver >=20 충족 여부를 단언.
 */
function parseEnginesNodeMinMajor(nodeRange: string): number {
  // ">=20", ">=20.0.0", ">= 20" 형태 지원
  const match = nodeRange.match(/^>=\s*(\d+)/)
  if (!match || !match[1]) {
    throw new Error(`engines.node 범위를 파싱할 수 없습니다: "${nodeRange}" — ">=" 형식이어야 합니다`)
  }
  return parseInt(match[1], 10)
}

describe('package.json — Sub-AC 1 필수 필드', () => {
  test('name 필드가 존재한다', () => {
    expect(typeof pkg['name']).toBe('string')
    expect(pkg['name']).toBeTruthy()
  })

  test('name은 loopbreaker다', () => {
    expect(pkg['name']).toBe('loopbreaker')
  })

  test('version 필드가 존재한다', () => {
    expect(typeof pkg['version']).toBe('string')
    expect(pkg['version']).toBeTruthy()
  })

  test('version은 semver 형식이다', () => {
    const semver = /^\d+\.\d+\.\d+/
    expect(semver.test(pkg['version'] as string)).toBe(true)
  })

  test('"type" 필드가 "module"이다 (ESM)', () => {
    expect(pkg['type']).toBe('module')
  })

  test('engines.node >= 20이 명시되어 있다', () => {
    const engines = pkg['engines'] as Record<string, string> | undefined
    expect(engines).toBeTruthy()
    expect(engines?.['node']).toMatch(/>=\s*20/)
  })
})

describe('package.json — Sub-AC 2: engines.node semver >=20 충족 검증', () => {
  test('engines.node 필드가 존재하고 문자열이다', () => {
    const engines = pkg['engines'] as Record<string, unknown> | undefined
    expect(engines).toBeDefined()
    expect(typeof engines?.['node']).toBe('string')
  })

  test('engines.node를 파싱하면 최소 major 버전이 20 이상이다 (Sub-AC 2)', () => {
    const engines = pkg['engines'] as Record<string, string>
    const nodeRange = engines['node']
    expect(nodeRange).toBeDefined()

    // Node 스크립트 방식: engines.node 파싱 후 semver >=20 단언
    const minMajor = parseEnginesNodeMinMajor(nodeRange)
    expect(minMajor).toBeGreaterThanOrEqual(20)
  })

  test('parseEnginesNodeMinMajor가 ">=20"에서 20을 반환한다', () => {
    expect(parseEnginesNodeMinMajor('>=20')).toBe(20)
  })

  test('parseEnginesNodeMinMajor가 ">=20.0.0"에서 20을 반환한다', () => {
    expect(parseEnginesNodeMinMajor('>=20.0.0')).toBe(20)
  })

  test('parseEnginesNodeMinMajor가 ">= 20"(공백 포함)에서 20을 반환한다', () => {
    expect(parseEnginesNodeMinMajor('>= 20')).toBe(20)
  })

  test('parseEnginesNodeMinMajor가 ">=18"에서 18을 반환한다 (경계값)', () => {
    expect(parseEnginesNodeMinMajor('>=18')).toBe(18)
  })

  test('잘못된 형식이면 오류를 던진다', () => {
    expect(() => parseEnginesNodeMinMajor('^20')).toThrow()
    expect(() => parseEnginesNodeMinMajor('20')).toThrow()
  })
})

describe('package.json — Sub-AC 4: scripts 필드 검증', () => {
  test('scripts 필드가 존재한다', () => {
    expect(pkg['scripts']).toBeDefined()
    expect(typeof pkg['scripts']).toBe('object')
  })

  test('"build" 스크립트가 비어있지 않은 문자열로 존재한다 (Sub-AC 4)', () => {
    const scripts = pkg['scripts'] as Record<string, unknown>
    expect(typeof scripts['build']).toBe('string')
    expect((scripts['build'] as string).length).toBeGreaterThan(0)
  })

  test('"test" 스크립트가 비어있지 않은 문자열로 존재한다 (Sub-AC 4)', () => {
    const scripts = pkg['scripts'] as Record<string, unknown>
    expect(typeof scripts['test']).toBe('string')
    expect((scripts['test'] as string).length).toBeGreaterThan(0)
  })

  test('"typecheck" 스크립트가 비어있지 않은 문자열로 존재한다 (Sub-AC 4)', () => {
    const scripts = pkg['scripts'] as Record<string, unknown>
    expect(typeof scripts['typecheck']).toBe('string')
    expect((scripts['typecheck'] as string).length).toBeGreaterThan(0)
  })

  test('build, test, typecheck 세 스크립트가 모두 존재한다 (Sub-AC 4 통합 검증)', () => {
    const scripts = pkg['scripts'] as Record<string, unknown>
    const required = ['build', 'test', 'typecheck'] as const
    for (const key of required) {
      expect(typeof scripts[key]).toBe('string')
      expect((scripts[key] as string).length).toBeGreaterThan(0)
    }
  })
})
