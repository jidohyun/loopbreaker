/**
 * detect.test.ts — src/detect/index.ts 모듈 스텁 존재·export 검증
 */

import detectStub, {
  DETECT_VERSION,
  DETECT_DESCRIPTION,
} from '../src/detect/index.js'

describe('detect/index.ts — M0 스텁', () => {
  it('기본 export가 객체이고 version·description 필드를 포함한다', () => {
    expect(detectStub).toBeDefined()
    expect(typeof detectStub).toBe('object')
    expect(detectStub.version).toBe('0.0.0-m0')
    expect(typeof detectStub.description).toBe('string')
    expect(detectStub.description.length).toBeGreaterThan(0)
  })

  it('DETECT_VERSION 상수가 m0 버전 문자열이다', () => {
    expect(DETECT_VERSION).toBe('0.0.0-m0')
  })

  it('DETECT_DESCRIPTION 상수가 비어있지 않은 문자열이다', () => {
    expect(typeof DETECT_DESCRIPTION).toBe('string')
    expect(DETECT_DESCRIPTION.length).toBeGreaterThan(0)
  })
})
