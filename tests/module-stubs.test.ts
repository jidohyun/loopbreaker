/**
 * module-stubs.test.ts — src/api, src/notify, src/storage 모듈 스텁 존재 및 기본 export 검증
 *
 * AC Sub-5: 세 디렉터리 각각의 index.ts가 존재하고 기본 export를 포함하는지 확인
 */

import apiStub from '../src/api/index.js'
import notifyStub from '../src/notify/index.js'
import storageStub from '../src/storage/index.js'

describe('src/api/index 스텁', () => {
  it('기본 export가 존재한다', () => {
    expect(apiStub).toBeDefined()
  })

  it('version 필드를 포함한다', () => {
    expect(apiStub).toHaveProperty('version')
    expect(typeof apiStub.version).toBe('string')
  })

  it('description 필드를 포함한다', () => {
    expect(apiStub).toHaveProperty('description')
    expect(typeof apiStub.description).toBe('string')
  })
})

describe('src/notify/index 스텁', () => {
  it('기본 export가 존재한다', () => {
    expect(notifyStub).toBeDefined()
  })

  it('version 필드를 포함한다', () => {
    expect(notifyStub).toHaveProperty('version')
    expect(typeof notifyStub.version).toBe('string')
  })

  it('description 필드를 포함한다', () => {
    expect(notifyStub).toHaveProperty('description')
    expect(typeof notifyStub.description).toBe('string')
  })
})

describe('src/storage/index 스텁', () => {
  it('기본 export가 존재한다', () => {
    expect(storageStub).toBeDefined()
  })

  it('version 필드를 포함한다', () => {
    expect(storageStub).toHaveProperty('version')
    expect(typeof storageStub.version).toBe('string')
  })

  it('description 필드를 포함한다', () => {
    expect(storageStub).toHaveProperty('description')
    expect(typeof storageStub.description).toBe('string')
  })
})
