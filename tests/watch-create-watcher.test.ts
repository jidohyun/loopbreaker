/**
 * watch-create-watcher.test.ts — Sub-AC 6a 단위 테스트
 *
 * createWatcher(paths, options) 함수가 chokidar 인스턴스를 생성하고
 * ~/.claude/projects/** 를 재귀(recursive) 감시하도록 설정하며,
 * 반환된 watcher의 감시 경로 목록에 해당 glob이 포함되는지 검증.
 */

import { createWatcher } from '../src/watch/index.js'

describe('createWatcher (Sub-AC 6a)', () => {
  it('기본 패턴(빈 배열)으로 호출하면 ~/.claude/projects/** 를 감시 대상에 포함한다', async () => {
    const handle = createWatcher([])

    // 반환된 patterns에 기본 glob이 포함되어야 한다
    expect(handle.patterns).toContain('~/.claude/projects/**')

    // chokidar FSWatcher 인스턴스가 반환되어야 한다
    expect(handle.watcher).toBeDefined()
    expect(typeof handle.watcher.on).toBe('function')
    expect(typeof handle.watcher.close).toBe('function')

    await handle.close()
  })

  it('명시적으로 ~/.claude/projects/** 패턴을 전달하면 감시 목록에 포함된다', async () => {
    const pattern = '~/.claude/projects/**'
    const handle = createWatcher([pattern])

    expect(handle.patterns).toContain(pattern)
    expect(handle.patterns).toHaveLength(1)

    await handle.close()
  })

  it('여러 패턴을 전달하면 모두 감시 목록에 포함된다', async () => {
    const patterns = ['~/.claude/projects/**', '/tmp/test-session.jsonl']
    const handle = createWatcher(patterns)

    expect(handle.patterns).toEqual(patterns)
    expect(handle.patterns).toHaveLength(2)

    await handle.close()
  })

  it('close()를 호출하면 watcher가 정상 종료된다', async () => {
    const handle = createWatcher([])

    // close가 Promise를 반환하고 정상 종료되어야 한다
    await expect(handle.close()).resolves.toBeUndefined()
  })

  it('createWatcher가 WatcherHandle 인터페이스를 충족한다', async () => {
    const handle = createWatcher([])

    // WatcherHandle 인터페이스 구조 검증
    expect(handle).toHaveProperty('watcher')
    expect(handle).toHaveProperty('patterns')
    expect(handle).toHaveProperty('close')
    expect(typeof handle.close).toBe('function')
    expect(Array.isArray(handle.patterns) || typeof handle.patterns[Symbol.iterator] === 'function').toBe(true)

    await handle.close()
  })

  it('options.usePolling=true로 설정하면 폴링 백업을 사용한다 (macOS 대응)', async () => {
    const handle = createWatcher([], { usePolling: true, pollIntervalMs: 500 })

    // 인스턴스가 정상 생성되어야 한다
    expect(handle.watcher).toBeDefined()
    expect(handle.patterns).toContain('~/.claude/projects/**')

    await handle.close()
  })

  it('ignoreInitial 옵션 없이도 watcher가 정상 생성된다', async () => {
    const handle = createWatcher(['~/.claude/projects/**'], { ignoreInitial: false })

    expect(handle.watcher).toBeDefined()
    expect(handle.patterns).toContain('~/.claude/projects/**')

    await handle.close()
  })
})
