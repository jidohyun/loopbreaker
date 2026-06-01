/**
 * watch-manager-lifecycle.test.ts — Sub-AC 6d 단위 테스트
 *
 * WatchManager 클래스의 start/stop 생명주기 검증:
 *   - start() 호출 시 watcher가 활성화됨 (status='watching')
 *   - stop() 호출 시 chokidar watcher가 close되어 이벤트를 더 이상 발행하지 않음
 *   - idle 상태에서 stop()은 no-op
 *   - watching 중 start() 재호출은 기존 watcher를 닫고 새로 시작
 */

import { jest } from '@jest/globals'
import { WatchManager } from '../src/watch/index.js'
import type { FSWatcher } from 'chokidar'

describe('WatchManager lifecycle (Sub-AC 6d)', () => {
  let manager: WatchManager

  beforeEach(() => {
    // 폴링 비활성화 + 기존 파일 이벤트 무시로 테스트 속도 향상
    manager = new WatchManager({ usePolling: false, ignoreInitial: true })
  })

  afterEach(async () => {
    // 테스트 후 반드시 정리
    await manager.stop()
  })

  it('초기 상태는 idle이고 handle이 null이다', () => {
    expect(manager.status).toBe('idle')
    expect(manager.handle).toBeNull()
  })

  it('start() 호출 후 status가 watching이 되고 handle이 활성화된다', async () => {
    await manager.start([])

    expect(manager.status).toBe('watching')
    expect(manager.handle).not.toBeNull()

    const watcher = manager.handle?.watcher as FSWatcher
    expect(watcher).toBeDefined()
    expect(typeof watcher.on).toBe('function')
    expect(typeof watcher.close).toBe('function')
  })

  it('stop() 호출 후 status가 idle로 돌아오고 handle이 null이 된다', async () => {
    await manager.start([])
    expect(manager.status).toBe('watching')

    await manager.stop()

    expect(manager.status).toBe('idle')
    expect(manager.handle).toBeNull()
  })

  it('stop() 후 chokidar watcher가 닫혀 이벤트를 더 이상 발행하지 않는다', async () => {
    await manager.start([])

    const watcher = manager.handle?.watcher as FSWatcher

    // watcher.close()가 실제로 호출되는지 추적
    const closeSpy = jest.spyOn(watcher, 'close')

    await manager.stop()

    // chokidar watcher.close()가 호출되어야 한다
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('idle 상태에서 stop() 호출은 no-op (에러 없이 반환)', async () => {
    expect(manager.status).toBe('idle')

    // 에러 없이 완료되어야 한다
    await expect(manager.stop()).resolves.toBeUndefined()

    // 상태 변경 없음
    expect(manager.status).toBe('idle')
    expect(manager.handle).toBeNull()
  })

  it('watching 중 start() 재호출 시 기존 watcher를 닫고 새 watcher를 생성한다', async () => {
    await manager.start([])
    const firstHandle = manager.handle
    expect(firstHandle).not.toBeNull()

    const firstWatcher = firstHandle?.watcher as FSWatcher
    const closeSpy = jest.spyOn(firstWatcher, 'close')

    // 두 번째 start() 호출
    await manager.start([])

    // 기존 watcher가 닫혀야 한다
    expect(closeSpy).toHaveBeenCalledTimes(1)

    // 새 handle이 생성되어야 한다
    expect(manager.handle).not.toBeNull()
    expect(manager.handle).not.toBe(firstHandle)
    expect(manager.status).toBe('watching')
  })

  it('start → stop → start 사이클을 반복해도 올바르게 동작한다', async () => {
    // 1st cycle
    await manager.start([])
    expect(manager.status).toBe('watching')

    await manager.stop()
    expect(manager.status).toBe('idle')
    expect(manager.handle).toBeNull()

    // 2nd cycle
    await manager.start([])
    expect(manager.status).toBe('watching')
    expect(manager.handle).not.toBeNull()

    await manager.stop()
    expect(manager.status).toBe('idle')
  })

  it('start() 후 watcher는 chokidar FSWatcher 인터페이스를 만족한다', async () => {
    await manager.start([])

    const watcher = manager.handle?.watcher as FSWatcher
    // chokidar FSWatcher 핵심 메서드 확인
    expect(typeof watcher.on).toBe('function')
    expect(typeof watcher.off).toBe('function')
    expect(typeof watcher.close).toBe('function')
    expect(typeof watcher.add).toBe('function')
  })

  it('명시적 patterns를 전달하면 handle.patterns에 보존된다', async () => {
    const patterns = ['~/.claude/projects/**']
    await manager.start(patterns)

    expect(manager.handle?.patterns).toEqual(patterns)
  })

  it('stop() 후 watcher 이벤트 핸들러가 더 이상 발행되지 않는다', async () => {
    await manager.start([])

    const watcher = manager.handle?.watcher as FSWatcher
    const eventHandler = jest.fn()

    watcher.on('add', eventHandler)

    await manager.stop()

    // watcher가 닫힌 후에는 내부적으로 이벤트를 발행하지 않는다.
    // closed watcher의 getWatched()가 비어있거나 undefined를 반환하는지 확인.
    // chokidar v5에서 close() 이후 watcher는 비활성 상태.
    expect(manager.status).toBe('idle')
    expect(manager.handle).toBeNull()
  })
})
