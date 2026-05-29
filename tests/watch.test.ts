/**
 * watch.test.ts — src/watch/index.ts 모듈 스텁 존재 검증
 */

import watchStub, { type WatchStatus, type WatchOptions, type Watcher } from '../src/watch/index.js'

describe('watch module stub', () => {
  it('기본 export가 존재하고 version과 description을 포함한다', () => {
    expect(watchStub).toBeDefined()
    expect(watchStub.version).toBe('0.0.0-m0')
    expect(typeof watchStub.description).toBe('string')
    expect(watchStub.description.length).toBeGreaterThan(0)
  })

  it('WatchStatus 타입이 올바른 리터럴 값을 갖는다', () => {
    const statuses: WatchStatus[] = ['idle', 'watching', 'error']
    expect(statuses).toHaveLength(3)
  })

  it('WatchOptions 인터페이스 형태를 만족하는 객체를 생성할 수 있다', () => {
    const opts: WatchOptions = { sessionPath: '/tmp/session.jsonl' }
    expect(opts.sessionPath).toBe('/tmp/session.jsonl')
    expect(opts.pollIntervalMs).toBeUndefined()

    const optsWithInterval: WatchOptions = { sessionPath: '/tmp/session.jsonl', pollIntervalMs: 500 }
    expect(optsWithInterval.pollIntervalMs).toBe(500)
  })

  it('Watcher 인터페이스 형태를 만족하는 객체를 생성할 수 있다', () => {
    const mockWatcher: Watcher = {
      status: 'idle',
      start: async (_opts: WatchOptions) => { /* stub */ },
      stop: async () => { /* stub */ },
    }
    expect(mockWatcher.status).toBe('idle')
    expect(typeof mockWatcher.start).toBe('function')
    expect(typeof mockWatcher.stop).toBe('function')
  })
})
