/**
 * daemon.test.ts — src/daemon/index.ts 스텁 존재 및 기본 export 검증
 *
 * AC Sub-9.1: src/daemon/index.ts 파일이 존재하고 기본 export를 포함하는지 확인
 */

import daemonStub from '../src/daemon/index.js'

describe('daemon/index stub', () => {
  it('기본 export가 존재한다', () => {
    expect(daemonStub).toBeDefined()
  })

  it('version 필드를 포함한다', () => {
    expect(daemonStub).toHaveProperty('version')
    expect(typeof daemonStub.version).toBe('string')
  })

  it('description 필드를 포함한다', () => {
    expect(daemonStub).toHaveProperty('description')
    expect(typeof daemonStub.description).toBe('string')
  })
})
