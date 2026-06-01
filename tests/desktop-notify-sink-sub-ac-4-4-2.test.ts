/**
 * tests/desktop-notify-sink-sub-ac-4-4-2.test.ts
 *
 * Sub-AC 4.4.2: DesktopNotifySink 인터페이스 적합성 및 어댑터 격리 검증.
 *
 * 두 가지 검증:
 *   1. 타입 적합성: DesktopNotifySink가 NotifySink 타입으로 할당 가능함을
 *      TypeScript 타입 테스트로 확인 (assignability check).
 *
 *   2. 정적 import 격리: desktop-notify-sink.test.ts 파일(이 파일 포함,
 *      및 desktop-notify-sink 관련 모든 테스트 파일)에서
 *      'node-notifier'가 직접 import되지 않음을 정적 분석으로 보장.
 *      (node-notifier import는 src/notify/sinks/desktop-notify-sink.ts 내부에만 격리)
 *
 * 부수효과 없음: 실제 OS 알림·네트워크 없이 결정론 동작.
 */

import { describe, test, expect } from '@jest/globals'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

import type { NotifySink } from '../src/contracts.js'
import { DesktopNotifySink } from '../src/notify/sinks/desktop-notify-sink.js'

// ─── 1. 타입 적합성 검증 ────────────────────────────────────────────────────

describe('Sub-AC 4.4.2 — DesktopNotifySink 타입 적합성', () => {
  /**
   * TypeScript 컴파일 단계에서 검증되는 assignability 테스트.
   * DesktopNotifySink 인스턴스를 NotifySink 타입 변수에 할당한다.
   * 타입 불일치 시 tsc --noEmit (typecheck) 에서 에러 발생.
   */
  test('DesktopNotifySink 인스턴스는 NotifySink 타입으로 할당 가능하다', () => {
    // MockNotifierAdapter: 부수효과 없는 DI 주입
    const mockAdapter = {
      notify(
        _opts: { title: string; message: string; sound?: boolean; wait?: boolean },
        callback?: (err: Error | null, response: string) => void,
      ): void {
        callback?.(null, 'ok')
      },
    }

    const sink = new DesktopNotifySink(mockAdapter)

    // 핵심 타입 적합성 검증: NotifySink 타입 변수에 할당
    const asSink: NotifySink = sink
    expect(asSink).toBeDefined()
    expect(typeof asSink.send).toBe('function')
  })

  test('DesktopNotifySink.send() 시그니처가 NotifySink.send()와 호환된다', async () => {
    // send(payload: NotificationPayload): Promise<NotifyResult>
    // NotifySink 인터페이스 명세와 일치하는지 런타임에서도 검증
    const mockAdapter = {
      notify(
        _opts: { title: string; message: string; sound?: boolean; wait?: boolean },
        callback?: (err: Error | null, response: string) => void,
      ): void {
        callback?.(null, 'ok')
      },
    }

    const sink: NotifySink = new DesktopNotifySink(mockAdapter)

    // send가 Promise를 반환하는지 확인
    const payload = {
      sessionId: 'test-session',
      kind: 'thrashing' as const,
      subtype: 'edit_thrashing',
      confidence: 0.9,
      reason: 'test reason',
      evidence: [],
      ts: Date.now(),
      severity: 'warning' as const,
      dedupeKey: 'test-session\x1fthrashing',
    }

    const result = sink.send(payload)
    expect(result).toBeInstanceOf(Promise)

    // Promise 정리 (부수효과 없음 보장)
    const r = await result
    expect(r).toHaveProperty('success')
    expect(r).toHaveProperty('channel')
  })
})

// ─── 2. node-notifier import 격리 정적 분석 ─────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..')
const TESTS_DIR = join(PROJECT_ROOT, 'tests')
const SRC_DIR = join(PROJECT_ROOT, 'src')

/** 모든 import/export/dynamic import 스펙을 추출한다. */
function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []

  // Static import/export-from (single or double quotes)
  const staticRe = /(?:import|export)\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = staticRe.exec(source)) !== null) {
    specifiers.push(m[1])
  }

  // Dynamic import()
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = dynamicRe.exec(source)) !== null) {
    specifiers.push(m[1])
  }

  return specifiers
}

/** node-notifier를 직접 참조하는지 판정 */
function referencesNodeNotifier(specifier: string): boolean {
  return specifier === 'node-notifier' || specifier.startsWith('node-notifier/')
}

/** 디렉터리에서 .ts 파일을 재귀 수집 */
function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

describe('Sub-AC 4.4.2 — node-notifier import 격리 정적 분석', () => {
  /**
   * node-notifier는 src/notify/sinks/desktop-notify-sink.ts 내부의
   * dynamic import() 에만 허용된다.
   * 다른 모든 src/ 파일과 tests/ 파일에서는 node-notifier를 직접 import 금지.
   */

  const DESKTOP_SINK_PATH = join(SRC_DIR, 'notify', 'sinks', 'desktop-notify-sink.ts')

  test('desktop-notify-sink.ts 파일이 존재한다 (sanity)', () => {
    expect(() => statSync(DESKTOP_SINK_PATH)).not.toThrow()
  })

  test('desktop-notify-sink.ts는 node-notifier를 static import하지 않는다 (dynamic import만 허용)', () => {
    const source = readFileSync(DESKTOP_SINK_PATH, 'utf8')

    // Static import만 추출 (dynamic import 제외)
    const staticSpecifiers: string[] = []
    const staticRe = /(?:^|\n)\s*import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = staticRe.exec(source)) !== null) {
      staticSpecifiers.push(m[1])
    }

    const staticNodeNotifier = staticSpecifiers.filter(referencesNodeNotifier)
    expect(staticNodeNotifier).toEqual([])
  })

  test('desktop-notify-sink.ts는 dynamic import()로 node-notifier를 사용한다 (격리 확인)', () => {
    const source = readFileSync(DESKTOP_SINK_PATH, 'utf8')

    // Dynamic import가 존재하는지 확인 (격리 패턴 유지 확인)
    const dynamicRe = /import\(\s*['"]node-notifier['"]\s*\)/
    expect(dynamicRe.test(source)).toBe(true)
  })

  // ── tests/ 파일들: node-notifier 직접 import 금지 ────────────────────────

  describe('tests/ 파일에 node-notifier 직접 import 없음', () => {
    const testFiles = collectTsFiles(TESTS_DIR)

    test('tests/ 디렉터리에 파일이 존재한다 (sanity)', () => {
      expect(testFiles.length).toBeGreaterThan(0)
    })

    for (const filePath of testFiles) {
      const label = relative(PROJECT_ROOT, filePath)
      test(`${label} — node-notifier 직접 import 없음`, () => {
        const source = readFileSync(filePath, 'utf8')
        const specifiers = extractImportSpecifiers(source)
        const forbidden = specifiers.filter(referencesNodeNotifier)

        if (forbidden.length > 0) {
          throw new Error(
            `${label}에서 node-notifier를 직접 import하고 있습니다: ${JSON.stringify(forbidden)}.\n` +
            `테스트 파일은 node-notifier를 직접 import해서는 안 됩니다.\n` +
            `node-notifier import는 src/notify/sinks/desktop-notify-sink.ts 내부 dynamic import에만 허용됩니다.`,
          )
        }

        expect(forbidden).toEqual([])
      })
    }
  })

  // ── src/ 파일들: desktop-notify-sink.ts를 제외하고 node-notifier import 금지 ──

  describe('src/ 파일에 node-notifier 직접 import 없음 (desktop-notify-sink.ts 제외)', () => {
    const allSrcFiles = collectTsFiles(SRC_DIR)
    // desktop-notify-sink.ts는 dynamic import로 허용 — static import가 없는지는 위 테스트에서 검증
    const srcFilesToCheck = allSrcFiles.filter(f => f !== DESKTOP_SINK_PATH)

    test('src/ 디렉터리에 파일이 존재한다 (sanity)', () => {
      expect(srcFilesToCheck.length).toBeGreaterThan(0)
    })

    for (const filePath of srcFilesToCheck) {
      const label = relative(PROJECT_ROOT, filePath)
      test(`${label} — node-notifier import 없음`, () => {
        const source = readFileSync(filePath, 'utf8')
        const specifiers = extractImportSpecifiers(source)
        const forbidden = specifiers.filter(referencesNodeNotifier)

        if (forbidden.length > 0) {
          throw new Error(
            `${label}에서 node-notifier를 import하고 있습니다: ${JSON.stringify(forbidden)}.\n` +
            `node-notifier는 src/notify/sinks/desktop-notify-sink.ts 내부 dynamic import에만 허용됩니다.\n` +
            `다른 모듈은 MockNotifySink 또는 NotifySink 인터페이스를 사용해야 합니다.`,
          )
        }

        expect(forbidden).toEqual([])
      })
    }
  })
})
