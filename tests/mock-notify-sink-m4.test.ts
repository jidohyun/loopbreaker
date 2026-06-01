/**
 * tests/mock-notify-sink-m4.test.ts
 *
 * MockNotifySink 단위 테스트.
 * 부수효과 없음 검증 — 실제 OS 알림·네트워크 없음.
 */

import { describe, expect, it } from '@jest/globals'
import { MockNotifySink } from '../src/notify/sinks/mock-notify-sink.js'
import type { NotificationPayload } from '../src/contracts.js'

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    sessionId: 'session-test',
    kind: 'thrashing',
    subtype: 'argkey_repeat',
    confidence: 0.92,
    reason: 'test reason',
    evidence: [{ uuid: 'uuid-1', ts: 1000, note: 'test note' }],
    ts: Date.now(),
    severity: 'critical',
    dedupeKey: 'session-test\x1fthrashing',
    ...overrides,
  }
}

describe('MockNotifySink', () => {
  it('초기 상태에서 count=0, records=[]', () => {
    const sink = new MockNotifySink()
    expect(sink.count).toBe(0)
    expect(sink.records).toHaveLength(0)
    expect(sink.last).toBeUndefined()
  })

  it('send() 후 records에 추가된다', async () => {
    const sink = new MockNotifySink()
    const payload = makePayload()

    const result = await sink.send(payload)

    expect(result.success).toBe(true)
    expect(result.channel).toBe('mock')
    expect(sink.count).toBe(1)
    expect(sink.last!.payload).toBe(payload)
  })

  it('여러 번 send() 하면 records가 쌓인다', async () => {
    const sink = new MockNotifySink()

    await sink.send(makePayload({ kind: 'thrashing' }))
    await sink.send(makePayload({ kind: 'false_success' }))

    expect(sink.count).toBe(2)
    expect(sink.records[0].payload.kind).toBe('thrashing')
    expect(sink.records[1].payload.kind).toBe('false_success')
  })

  it('setFailMode(true) 이면 send()가 success=false를 반환한다', async () => {
    const sink = new MockNotifySink()
    sink.setFailMode(true, 'test error')

    const result = await sink.send(makePayload())

    expect(result.success).toBe(false)
    expect(result.error).toBe('test error')
    expect(result.channel).toBe('mock')
    // 실패한 경우에도 records에 기록됨
    expect(sink.count).toBe(1)
  })

  it('reset() 후 초기 상태로 돌아간다', async () => {
    const sink = new MockNotifySink()
    sink.setFailMode(true)
    await sink.send(makePayload())

    sink.reset()

    expect(sink.count).toBe(0)
    expect(sink.last).toBeUndefined()
    // failMode도 리셋
    const result = await sink.send(makePayload())
    expect(result.success).toBe(true)
  })

  it('records는 읽기 전용 배열이다 (타입 레벨)', () => {
    const sink = new MockNotifySink()
    // TypeScript 컴파일 타임에 readonly 보장
    const records: readonly unknown[] = sink.records
    expect(Array.isArray(records)).toBe(true)
  })
})
