/**
 * tests/notify-sink-type-sub-ac-4-4-1.test.ts
 *
 * Sub-AC 4.4.1: NotifySink 인터페이스 타입 적합성 검증
 *
 * MockNotifySink가 NotifySink 타입으로 할당 가능한지 TypeScript의
 * 구조적 타입 시스템으로 검증한다.
 *
 * - 실 어댑터(DesktopNotifySink, WebhookNotifySink, CliNotifySink) import 없음
 * - 실제 OS 알림·네트워크 요청 없음
 * - TypeScript 컴파일 타임 + 런타임 양쪽에서 검증
 */

import type { NotifySink, NotificationPayload, NotifyResult } from '../src/contracts.js'
import { MockNotifySink } from '../src/notify/sinks/mock-notify-sink.js'

// ─── 컴파일 타임 타입 검증 ──────────────────────────────────────────────────

/**
 * 타입 할당 가능성을 검증하는 헬퍼.
 * TypeScript가 T extends U를 컴파일 타임에 검사하므로,
 * 잘못된 할당은 빌드 오류로 즉시 감지된다.
 */
function assertAssignable<T>(_value: T): void {
  // 런타임 로직 없음 — 타입 검사만 수행
}

// MockNotifySink 인스턴스가 NotifySink에 할당 가능한지 컴파일 타임 검증
const mockSink = new MockNotifySink()
assertAssignable<NotifySink>(mockSink)

// satisfies 연산자를 이용한 추가 컴파일 타임 검증 (TS 4.9+)
// "mockSink2 satisfies NotifySink" 는 구조적 타입 일치를 강제한다.
const mockSink2 = new MockNotifySink() satisfies NotifySink
void mockSink2 // 사용하지 않음 경고 방지

// 인터페이스 변수에 직접 할당
const sinkVar: NotifySink = new MockNotifySink()
void sinkVar

// ─── 런타임 타입 검증 ──────────────────────────────────────────────────────

describe('NotifySink 인터페이스 타입 적합성 (Sub-AC 4.4.1)', () => {
  let sink: NotifySink

  beforeEach(() => {
    // NotifySink 타입 변수에 MockNotifySink 인스턴스를 할당
    // 이 할당이 컴파일되면 타입 적합성이 증명된다
    sink = new MockNotifySink()
  })

  it('MockNotifySink는 NotifySink 타입으로 할당 가능하다', () => {
    expect(sink).toBeDefined()
    expect(typeof sink.send).toBe('function')
  })

  it('send() 메서드는 NotificationPayload를 받아 Promise<NotifyResult>를 반환한다', async () => {
    const payload: NotificationPayload = {
      sessionId: 'test-session-001',
      kind: 'thrashing',
      subtype: '',
      confidence: 0.9,
      reason: '반복 루프 감지',
      evidence: [
        { uuid: 'evt-001', ts: Date.now(), note: '테스트 근거' },
      ],
      ts: Date.now(),
      severity: 'warning',
      dedupeKey: 'test-session-001\x1fthrashing',
    }

    // send() 의 반환 타입이 Promise<NotifyResult>임을 런타임에서도 검증
    const resultPromise: Promise<NotifyResult> = sink.send(payload)
    expect(resultPromise).toBeInstanceOf(Promise)

    const result: NotifyResult = await resultPromise
    expect(result).toHaveProperty('success')
    expect(result).toHaveProperty('channel')
  })

  it('NotifySink 배열 타입에 MockNotifySink를 담을 수 있다', async () => {
    const sinks: NotifySink[] = [new MockNotifySink(), new MockNotifySink()]
    expect(sinks).toHaveLength(2)

    const payload: NotificationPayload = {
      sessionId: 'test-session-002',
      kind: 'false_success',
      subtype: 'silent_error',
      confidence: 0.85,
      reason: '거짓 성공 감지',
      evidence: [],
      ts: Date.now(),
      severity: 'critical',
      dedupeKey: 'test-session-002\x1ffalse_success',
    }

    // 모든 싱크에 발송 — 타입이 맞으므로 컴파일·런타임 모두 통과
    const results = await Promise.all(sinks.map((s) => s.send(payload)))
    expect(results).toHaveLength(2)
    results.forEach((r) => {
      expect(r.success).toBe(true)
      expect(r.channel).toBe('mock')
    })
  })

  it('NotifySink 인터페이스의 send 시그니처와 정확히 일치한다', () => {
    // send 메서드가 존재하고 함수임을 확인
    expect(typeof sink.send).toBe('function')

    // send 메서드의 length (매개변수 수) = 1 (payload)
    expect(sink.send.length).toBe(1)
  })

  it('실 어댑터 모듈을 import하지 않고도 독립 실행 가능하다', () => {
    // 이 테스트가 통과하면, 실 어댑터 없이 MockNotifySink만으로
    // NotifySink 타입 적합성을 완전히 검증할 수 있음을 증명
    const isolated: NotifySink = new MockNotifySink()
    expect(isolated).toBeInstanceOf(MockNotifySink)
  })
})

// ─── 구조적 타입 호환성 추가 검증 ──────────────────────────────────────────

describe('NotifySink 구조적 타입 호환성 (Sub-AC 4.4.1)', () => {
  it('MockNotifySink의 send()는 NotifySink.send() 시그니처와 구조적으로 호환된다', async () => {
    // 인라인 함수가 NotifySink.send 타입과 호환되는지 확인
    const sendFn: NotifySink['send'] = new MockNotifySink().send.bind(new MockNotifySink())

    const payload: NotificationPayload = {
      sessionId: 'sig-test',
      kind: 'none',
      subtype: '',
      confidence: 0.1,
      reason: '시그니처 검증',
      evidence: [],
      ts: Date.now(),
      severity: 'low_confidence',
      dedupeKey: 'sig-test\x1fnone',
    }

    const result = await sendFn(payload)
    expect(result).toHaveProperty('success')
  })

  it('여러 MockNotifySink 인스턴스를 NotifySink 유니온 타입 맵에 저장 가능하다', () => {
    const sinkMap = new Map<string, NotifySink>()
    sinkMap.set('desktop', new MockNotifySink())
    sinkMap.set('webhook', new MockNotifySink())
    sinkMap.set('cli', new MockNotifySink())

    expect(sinkMap.size).toBe(3)
    sinkMap.forEach((s) => {
      expect(typeof s.send).toBe('function')
    })
  })
})
