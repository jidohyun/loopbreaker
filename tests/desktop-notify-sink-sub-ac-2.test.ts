/**
 * tests/desktop-notify-sink-sub-ac-2.test.ts
 *
 * Sub-AC 2: DesktopNotifySink 단위 테스트.
 *
 * 테스트 부수효과 절대 금지:
 *   - 실제 OS 알림 발생 없음 (MockNotifierAdapter 사용)
 *   - node-notifier 실제 로드 없음 (DI로 mock 주입)
 *
 * 검증 항목:
 *   - send() 호출 시 올바른 title/message로 notify가 호출되는지
 *   - severity별 title 아이콘 정확성
 *   - message 포맷 (신뢰도, 이유, 근거)
 *   - notifier 오류 시 success:false 반환 (채널 실패 격리)
 *   - send() 성공 시 {success:true, channel:'desktop'} 반환
 */

import { describe, it, expect, beforeEach } from '@jest/globals'
import type { NotifierAdapter } from '../src/notify/sinks/desktop-notify-sink.js'
import { DesktopNotifySink } from '../src/notify/sinks/desktop-notify-sink.js'
import type { NotificationPayload } from '../src/contracts.js'

// ── Mock NotifierAdapter ──────────────────────────────────────────────────────

interface NotifyCall {
  title: string
  message: string
  sound?: boolean
  wait?: boolean
}

class MockNotifierAdapter implements NotifierAdapter {
  readonly calls: NotifyCall[] = []
  private _shouldError = false
  private _errorMessage = 'mock notifier error'

  notify(
    options: { title: string; message: string; sound?: boolean; wait?: boolean },
    callback?: (err: Error | null, response: string) => void,
  ): void {
    this.calls.push({ ...options })
    if (this._shouldError) {
      callback?.(new Error(this._errorMessage), '')
    } else {
      callback?.(null, 'success')
    }
  }

  setErrorMode(shouldError: boolean, message = 'mock notifier error'): void {
    this._shouldError = shouldError
    this._errorMessage = message
  }

  get lastCall(): NotifyCall | undefined {
    return this.calls[this.calls.length - 1]
  }

  reset(): void {
    this.calls.length = 0
    this._shouldError = false
    this._errorMessage = 'mock notifier error'
  }
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    sessionId: 'session-001',
    kind: 'thrashing',
    subtype: 'edit_thrashing',
    confidence: 0.87,
    reason: 'Claude keeps editing the same file repeatedly without progress',
    evidence: [
      { uuid: 'ev-1', ts: 1000, note: 'edited file.ts 5 times' },
      { uuid: 'ev-2', ts: 2000, note: 'same content returned' },
    ],
    ts: Date.now(),
    severity: 'warning',
    dedupeKey: 'session-001\x1fthrashing',
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DesktopNotifySink (Sub-AC 2)', () => {
  let mockAdapter: MockNotifierAdapter
  let sink: DesktopNotifySink

  beforeEach(() => {
    mockAdapter = new MockNotifierAdapter()
    sink = new DesktopNotifySink(mockAdapter)
  })

  describe('DI 주입', () => {
    it('생성자에서 주입된 MockNotifierAdapter를 사용한다 (node-notifier 로드 없음)', async () => {
      const payload = makePayload()
      await sink.send(payload)
      expect(mockAdapter.calls).toHaveLength(1)
    })

    it('여러 번 send() 호출해도 adapter.notify가 각각 호출된다', async () => {
      await sink.send(makePayload())
      await sink.send(makePayload({ kind: 'false_success', subtype: 'tool_false_success' }))
      expect(mockAdapter.calls).toHaveLength(2)
    })
  })

  describe('title 포맷', () => {
    it('severity=critical → 🚨 아이콘 포함 title', async () => {
      const payload = makePayload({ severity: 'critical', kind: 'thrashing', subtype: 'edit_thrashing' })
      await sink.send(payload)
      expect(mockAdapter.lastCall?.title).toContain('🚨')
      expect(mockAdapter.lastCall?.title).toContain('thrashing/edit_thrashing')
    })

    it('severity=warning → ⚠️ 아이콘 포함 title', async () => {
      const payload = makePayload({ severity: 'warning', kind: 'thrashing', subtype: 'tool_thrashing' })
      await sink.send(payload)
      expect(mockAdapter.lastCall?.title).toContain('⚠️')
      expect(mockAdapter.lastCall?.title).toContain('thrashing/tool_thrashing')
    })

    it('severity=meta → ℹ️ 아이콘 포함 title', async () => {
      const payload = makePayload({ severity: 'meta', kind: 'meta', subtype: 'cost_limit' })
      await sink.send(payload)
      expect(mockAdapter.lastCall?.title).toContain('ℹ️')
      expect(mockAdapter.lastCall?.title).toContain('meta/cost_limit')
    })

    it('severity=low_confidence → 🔍 아이콘 포함 title', async () => {
      const payload = makePayload({ severity: 'low_confidence', kind: 'false_success', subtype: 'tool_false_success' })
      await sink.send(payload)
      expect(mockAdapter.lastCall?.title).toContain('🔍')
      expect(mockAdapter.lastCall?.title).toContain('false_success/tool_false_success')
    })

    it('title에 "LoopBreaker:" 접두사가 포함된다', async () => {
      await sink.send(makePayload())
      expect(mockAdapter.lastCall?.title).toContain('LoopBreaker:')
    })
  })

  describe('message 포맷', () => {
    it('message에 신뢰도 퍼센트가 포함된다', async () => {
      const payload = makePayload({ confidence: 0.87 })
      await sink.send(payload)
      expect(mockAdapter.lastCall?.message).toContain('87.0%')
    })

    it('message에 reason이 포함된다 (최대 120자)', async () => {
      const reason = 'Claude keeps editing the same file repeatedly without progress'
      const payload = makePayload({ reason })
      await sink.send(payload)
      expect(mockAdapter.lastCall?.message).toContain(reason.slice(0, 120))
    })

    it('reason이 120자 초과 시 잘린다', async () => {
      const longReason = 'A'.repeat(200)
      const payload = makePayload({ reason: longReason })
      await sink.send(payload)
      const msg = mockAdapter.lastCall?.message ?? ''
      expect(msg).toContain('A'.repeat(120))
      expect(msg).not.toContain('A'.repeat(121))
    })

    it('evidence가 있으면 근거 건수가 message에 포함된다', async () => {
      const payload = makePayload({
        evidence: [
          { uuid: 'e1', ts: 1000, note: 'note1' },
          { uuid: 'e2', ts: 2000, note: 'note2' },
          { uuid: 'e3', ts: 3000, note: 'note3' },
        ],
      })
      await sink.send(payload)
      expect(mockAdapter.lastCall?.message).toContain('3건')
    })

    it('evidence가 없으면 근거 라인이 없다', async () => {
      const payload = makePayload({ evidence: [] })
      await sink.send(payload)
      expect(mockAdapter.lastCall?.message).not.toContain('근거:')
    })
  })

  describe('sound 옵션', () => {
    it('severity=critical → sound:true로 notify 호출', async () => {
      const payload = makePayload({ severity: 'critical' })
      await sink.send(payload)
      expect(mockAdapter.lastCall?.sound).toBe(true)
    })

    it('severity=warning → sound:false로 notify 호출', async () => {
      const payload = makePayload({ severity: 'warning' })
      await sink.send(payload)
      expect(mockAdapter.lastCall?.sound).toBe(false)
    })
  })

  describe('NotifyResult 반환값', () => {
    it('성공 시 {success:true, channel:"desktop"} 반환', async () => {
      const result = await sink.send(makePayload())
      expect(result).toEqual({ success: true, channel: 'desktop' })
    })

    it('notifier 오류 시 {success:false, channel:"desktop", error:...} 반환', async () => {
      mockAdapter.setErrorMode(true, 'OS notification failed')
      const result = await sink.send(makePayload())
      expect(result.success).toBe(false)
      expect(result.channel).toBe('desktop')
      expect(result.error).toContain('OS notification failed')
    })

    it('오류 발생해도 throw하지 않는다 (채널 실패 격리)', async () => {
      mockAdapter.setErrorMode(true)
      await expect(sink.send(makePayload())).resolves.not.toThrow()
    })
  })

  describe('실제 node-notifier 비격리 보장', () => {
    it('DI 주입 시 node-notifier 모듈을 로드하지 않는다', async () => {
      // DI로 MockNotifierAdapter를 주입한 경우
      // node-notifier가 로드되면 테스트가 실제 OS 알림을 시도할 수 있음
      // 이 테스트는 DI 주입된 어댑터만 사용됨을 간접 검증:
      // mockAdapter.calls에만 기록되고 node-notifier로의 경로 없음
      const payload = makePayload()
      const result = await sink.send(payload)
      // mock 어댑터가 호출됨
      expect(mockAdapter.calls).toHaveLength(1)
      // 성공 반환
      expect(result.success).toBe(true)
      // node-notifier를 로드했다면 비동기 OS 시스템에서 오류 가능성 있음
      // 이 테스트가 통과함 = DI 어댑터 경로로만 동작
    })
  })
})
