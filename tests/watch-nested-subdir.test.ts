/**
 * watch-nested-subdir.test.ts — Sub-AC 6.3c 통합 테스트
 *
 * watcher가 중첩 서브디렉터리(예: <tmpDir>/projects/foo/bar/agent-*.jsonl)
 * 변경 이벤트를 실제로 수신하는지 임시 디렉터리 픽스처로 검증한다.
 *
 * 검증 항목:
 *   1. 중첩 서브디렉터리의 신규 파일 생성 이벤트 수신
 *   2. 서브에이전트 경로 패턴 (subagents/<id>/agent-*.jsonl) 이벤트 수신
 *   3. 여러 깊이의 중첩 디렉터리에서 동시 변경 이벤트 수신
 *   4. 기존 파일에 내용 추가(append) 이벤트 수신
 *   5. resolveWatchPath() — glob 패턴을 실제 디렉터리 경로로 변환
 *
 * 구현 참고:
 *   chokidar v4+ 는 glob 지원이 제거되었다.
 *   createWatcher 는 resolveWatchPath() 로 glob 접미사를 제거하고
 *   depth:99 옵션으로 재귀 감시를 구현한다.
 */

import { describe, it, expect, afterEach } from '@jest/globals'
import { mkdir, writeFile, appendFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { createWatcher, resolveWatchPath } from '../src/watch/index.js'

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

/** 임시 디렉터리 생성 헬퍼 */
async function makeTmpDir(prefix: string): Promise<string> {
  const base = join(
    tmpdir(),
    `loopbreaker-6c-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await mkdir(base, { recursive: true })
  return base
}

/**
 * 특정 이벤트 타입을 기다리는 헬퍼.
 * timeoutMs 내에 이벤트가 오지 않으면 에러를 throw.
 */
function waitForEvent(
  watcher: import('chokidar').FSWatcher,
  eventType: 'add' | 'change' | 'addDir',
  timeoutMs: number = 6000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      watcher.off(eventType, handler)
      reject(new Error(`Timeout: '${eventType}' 이벤트가 ${timeoutMs}ms 내에 도착하지 않음`))
    }, timeoutMs)

    function handler(filePath: string): void {
      clearTimeout(timer)
      watcher.off(eventType, handler)
      resolve(filePath)
    }

    watcher.on(eventType, handler)
  })
}

/**
 * 조건을 만족하는 이벤트를 기다리는 헬퍼.
 */
function waitForEventMatching(
  watcher: import('chokidar').FSWatcher,
  eventType: 'add' | 'change' | 'addDir',
  predicate: (path: string) => boolean,
  timeoutMs: number = 6000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      watcher.off(eventType, handler)
      reject(new Error(`Timeout: '${eventType}' 조건 만족 이벤트가 ${timeoutMs}ms 내에 도착하지 않음`))
    }, timeoutMs)

    function handler(filePath: string): void {
      if (predicate(filePath)) {
        clearTimeout(timer)
        watcher.off(eventType, handler)
        resolve(filePath)
      }
    }

    watcher.on(eventType, handler)
  })
}

/** 짧은 지연 헬퍼 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── resolveWatchPath 단위 테스트 ──────────────────────────────────────────────

describe('resolveWatchPath — glob 패턴을 실제 경로로 변환 (Sub-AC 6.3c 헬퍼)', () => {
  it('/** 접미사를 제거하고 디렉터리 경로를 반환한다', () => {
    const home = homedir()
    expect(resolveWatchPath('~/.claude/projects/**')).toBe(`${home}/.claude/projects`)
  })

  it('/*.jsonl 접미사를 제거하고 디렉터리 경로를 반환한다', () => {
    expect(resolveWatchPath('/tmp/foo/*.jsonl')).toBe('/tmp/foo')
  })

  it('중첩 glob 패턴도 올바르게 처리한다', () => {
    expect(resolveWatchPath('/tmp/foo/**/*.jsonl')).toBe('/tmp/foo')
  })

  it('glob 없는 경로는 그대로 반환한다', () => {
    expect(resolveWatchPath('/tmp/exact-dir')).toBe('/tmp/exact-dir')
    expect(resolveWatchPath('/tmp/exact.jsonl')).toBe('/tmp/exact.jsonl')
  })

  it('~ 없는 절대 경로의 /** 접미사를 제거한다', () => {
    expect(resolveWatchPath('/var/folders/abc/**')).toBe('/var/folders/abc')
  })
})

// ── 통합 테스트: 실제 파일시스템 이벤트 ──────────────────────────────────────

describe('createWatcher — 중첩 서브디렉터리 통합 테스트 (Sub-AC 6.3c)', () => {
  const tmpDirs: string[] = []

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => { /* ignore */ })
    }
    tmpDirs.length = 0
  })

  it(
    '중첩 2단계 서브디렉터리 (/projects/foo/bar/*.jsonl) 신규 파일 add 이벤트를 수신한다',
    async () => {
      const tmpRoot = await makeTmpDir('nested')
      tmpDirs.push(tmpRoot)

      // /projects/foo/bar/ 구조 생성 (watcher 시작 전에 디렉터리 생성)
      const nestedDir = join(tmpRoot, 'projects', 'foo', 'bar')
      await mkdir(nestedDir, { recursive: true })

      // 디렉터리 경로를 직접 전달 (chokidar v5: glob 미지원)
      const handle = createWatcher([tmpRoot], {
        usePolling: true,
        pollIntervalMs: 100,
        ignoreInitial: true,
      })

      // watcher ready 대기
      await new Promise<void>((resolve) => {
        handle.watcher.once('ready', resolve)
        // ready가 이미 fire된 경우를 대비한 fallback
        setTimeout(resolve, 500)
      })

      const targetFile = join(nestedDir, 'session-test.jsonl')
      const eventPromise = waitForEvent(handle.watcher, 'add', 6000)

      await writeFile(targetFile, '{"type":"user","uuid":"test-001","sessionId":"sess-001"}\n', 'utf8')

      const receivedPath = await eventPromise
      expect(receivedPath).toBe(targetFile)

      await handle.close()
    },
    12000,
  )

  it(
    '서브에이전트 경로 패턴 (subagents/<id>/agent-*.jsonl) add 이벤트를 수신한다',
    async () => {
      const tmpRoot = await makeTmpDir('subagent')
      tmpDirs.push(tmpRoot)

      const agentId = 'abc123def456'
      const subagentDir = join(tmpRoot, 'projects', 'myproject', 'subagents', agentId)
      await mkdir(subagentDir, { recursive: true })

      const handle = createWatcher([tmpRoot], {
        usePolling: true,
        pollIntervalMs: 100,
        ignoreInitial: true,
      })

      await new Promise<void>((resolve) => {
        handle.watcher.once('ready', resolve)
        setTimeout(resolve, 500)
      })

      const agentFile = join(subagentDir, 'agent-session.jsonl')
      const eventPromise = waitForEventMatching(
        handle.watcher,
        'add',
        (p) => p.includes('agent-') && p.endsWith('.jsonl'),
        6000,
      )

      await writeFile(agentFile, '{"type":"assistant","uuid":"sub-001","isSidechain":true}\n', 'utf8')

      const receivedPath = await eventPromise
      expect(receivedPath).toContain('agent-')
      expect(receivedPath).toMatch(/\.jsonl$/)
      expect(receivedPath).toContain(agentId)

      await handle.close()
    },
    12000,
  )

  it(
    '여러 깊이의 중첩 디렉터리에서 동시 변경 이벤트를 모두 수신한다',
    async () => {
      const tmpRoot = await makeTmpDir('multi')
      tmpDirs.push(tmpRoot)

      const dirs = [
        join(tmpRoot, 'projects', 'proj-a', 'sessions'),
        join(tmpRoot, 'projects', 'proj-b', 'subagents', 'agent-x', 'logs'),
        join(tmpRoot, 'projects', 'proj-c'),
      ] as const

      for (const dir of dirs) {
        await mkdir(dir, { recursive: true })
      }

      const handle = createWatcher([tmpRoot], {
        usePolling: true,
        pollIntervalMs: 100,
        ignoreInitial: true,
      })

      await new Promise<void>((resolve) => {
        handle.watcher.once('ready', resolve)
        setTimeout(resolve, 500)
      })

      const receivedPaths: string[] = []
      const collectionPromise = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timeout: 3개 이벤트 중 ${receivedPaths.length}개만 수신됨`))
        }, 8000)

        handle.watcher.on('add', (p) => {
          receivedPaths.push(p)
          if (receivedPaths.length >= 3) {
            clearTimeout(timer)
            resolve()
          }
        })
      })

      await writeFile(join(dirs[0], 'session-a.jsonl'), '{"type":"user"}\n', 'utf8')
      await sleep(50)
      await writeFile(join(dirs[1], 'agent-deep.jsonl'), '{"type":"assistant"}\n', 'utf8')
      await sleep(50)
      await writeFile(join(dirs[2], 'session-c.jsonl'), '{"type":"system"}\n', 'utf8')

      await collectionPromise

      expect(receivedPaths.length).toBeGreaterThanOrEqual(3)
      expect(receivedPaths.some((p) => p.includes('proj-a'))).toBe(true)
      expect(receivedPaths.some((p) => p.includes('proj-b'))).toBe(true)
      expect(receivedPaths.some((p) => p.includes('proj-c'))).toBe(true)

      await handle.close()
    },
    15000,
  )

  it(
    '기존 파일에 내용 추가(append) 시 change 이벤트를 수신한다',
    async () => {
      const tmpRoot = await makeTmpDir('append')
      tmpDirs.push(tmpRoot)

      const sessionDir = join(tmpRoot, 'projects', 'myproj', 'sessions')
      await mkdir(sessionDir, { recursive: true })

      const sessionFile = join(sessionDir, 'live-session.jsonl')
      await writeFile(sessionFile, '{"type":"user","uuid":"init-001"}\n', 'utf8')

      // ignoreInitial=false: 기존 파일 add 이벤트 수신 후 change 감지
      const handle = createWatcher([tmpRoot], {
        usePolling: true,
        pollIntervalMs: 100,
        ignoreInitial: false,
      })

      // 기존 파일 add 이벤트가 처리될 때까지 대기
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000)
        handle.watcher.on('add', () => {
          clearTimeout(timer)
          resolve()
        })
      })

      const changePromise = waitForEventMatching(
        handle.watcher,
        'change',
        (p) => p === sessionFile,
        6000,
      )

      // 파일에 내용 추가 (tail 시뮬레이션)
      await appendFile(sessionFile, '{"type":"assistant","uuid":"msg-002"}\n', 'utf8')

      const changedPath = await changePromise
      expect(changedPath).toBe(sessionFile)

      await handle.close()
    },
    14000,
  )

  it(
    'glob 패턴(/**) 을 전달해도 resolveWatchPath()로 디렉터리를 추출하여 이벤트를 수신한다',
    async () => {
      const tmpRoot = await makeTmpDir('glob-compat')
      tmpDirs.push(tmpRoot)

      const deepDir = join(tmpRoot, 'projects', 'test-proj', 'subagents', 'sa1')
      await mkdir(deepDir, { recursive: true })

      // glob 패턴으로 createWatcher 호출 → resolveWatchPath가 tmpRoot를 추출해야 함
      const globPattern = `${tmpRoot}/**`
      const handle = createWatcher([globPattern], {
        usePolling: true,
        pollIntervalMs: 100,
        ignoreInitial: true,
      })

      // patterns에 원본 glob 패턴이 보존되어야 함
      expect(handle.patterns).toContain(globPattern)

      await new Promise<void>((resolve) => {
        handle.watcher.once('ready', resolve)
        setTimeout(resolve, 500)
      })

      const targetFile = join(deepDir, 'agent-sa1.jsonl')
      const eventPromise = waitForEvent(handle.watcher, 'add', 6000)

      await writeFile(targetFile, '{"type":"user","isSidechain":true}\n', 'utf8')

      const receivedPath = await eventPromise
      expect(receivedPath).toContain('subagents')
      expect(receivedPath).toContain('sa1')
      expect(receivedPath).toMatch(/\.jsonl$/)

      await handle.close()
    },
    12000,
  )
})
