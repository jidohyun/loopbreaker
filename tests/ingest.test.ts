/**
 * ingest.test.ts — src/ingest/index.ts 모듈 스텁 존재 검증
 */

import ingestStub, { type IngestStatus, type IngestOptions, type IngestResult } from '../src/ingest/index.js'

describe('ingest module stub', () => {
  it('기본 export가 존재하고 version과 description을 포함한다', () => {
    expect(ingestStub).toBeDefined()
    expect(ingestStub.version).toBe('0.0.0-m0')
    expect(typeof ingestStub.description).toBe('string')
    expect(ingestStub.description.length).toBeGreaterThan(0)
  })

  it('IngestStatus 타입이 올바른 리터럴 값을 갖는다', () => {
    const statuses: IngestStatus[] = ['idle', 'running', 'error']
    expect(statuses).toHaveLength(3)
  })

  it('IngestOptions 인터페이스 형태를 만족하는 객체를 생성할 수 있다', () => {
    const opts: IngestOptions = { sessionPath: '/tmp/session.jsonl' }
    expect(opts.sessionPath).toBe('/tmp/session.jsonl')
    expect(opts.byteOffset).toBeUndefined()

    const optsWithOffset: IngestOptions = { sessionPath: '/tmp/session.jsonl', byteOffset: 1024 }
    expect(optsWithOffset.byteOffset).toBe(1024)
  })

  it('IngestResult 인터페이스 형태를 만족하는 객체를 생성할 수 있다', () => {
    const result: IngestResult = {
      status: 'idle',
      linesProcessed: 0,
      bytesRead: 0,
    }
    expect(result.status).toBe('idle')
    expect(result.linesProcessed).toBe(0)
    expect(result.bytesRead).toBe(0)
  })
})
