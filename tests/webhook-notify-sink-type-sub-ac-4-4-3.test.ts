/**
 * tests/webhook-notify-sink-type-sub-ac-4-4-3.test.ts
 *
 * Sub-AC 4.4.3: WebhookNotifySink 인터페이스 적합성 및 어댑터 격리 검증
 *
 * 검증 항목:
 *   1. WebhookNotifySink가 NotifySink 타입으로 할당 가능함 (컴파일 타임 타입 테스트)
 *   2. WebhookNotifySink 테스트 파일들이 fetch/HTTP 클라이언트를 직접 import하지 않음 (정적 분석)
 *   3. WebhookNotifySink 구현체 자체도 fetch를 import하지 않고 globalThis.fetch를 사용함
 *   4. fetchFn DI 주입 시 NotifySink 인터페이스로 완전히 동작함
 *
 * 부수효과 절대 없음:
 *   - 실제 OS 알림 없음
 *   - 실제 네트워크 요청 없음 (mock FetchFn 주입)
 *   - fetch/node-fetch/axios 등 HTTP 모듈 직접 import 없음
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import { WebhookNotifySink, type FetchFn } from '../src/notify/sinks/webhook-notify-sink.js'
import type { NotifySink, NotificationPayload, NotifyResult } from '../src/contracts.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..')

// ── 컴파일 타임 타입 검증 헬퍼 ───────────────────────────────────────────────

/**
 * TypeScript 구조적 타입 시스템으로 T가 U에 할당 가능한지 컴파일 타임 검증.
 * 잘못된 할당은 빌드 오류로 즉시 감지됨.
 */
function assertAssignable<T>(_value: T): void {
  // 런타임 로직 없음 — 타입 검사만 수행
}

/** mock FetchFn 팩토리 (실제 네트워크 없음) */
function makeMockFetch(ok = true, status = 200): { fn: FetchFn } {
  const fn: FetchFn = async (_url, _init) => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
  })
  return { fn }
}

/** 최소 NotificationPayload */
function makePayload(overrides?: Partial<NotificationPayload>): NotificationPayload {
  return {
    sessionId: 'type-test-session',
    kind: 'thrashing',
    subtype: 'edit_thrashing',
    confidence: 0.9,
    reason: '타입 테스트용 페이로드',
    evidence: [{ uuid: 'ev-001', ts: Date.now(), note: '타입 검증 근거' }],
    ts: Date.now(),
    severity: 'warning',
    dedupeKey: 'type-test-session\x1fthrashing',
    ...overrides,
  }
}

// ── 컴파일 타임: 모듈 수준 타입 할당 ────────────────────────────────────────

// WebhookNotifySink 인스턴스가 NotifySink에 할당 가능한지 컴파일 타임 검증
const webhookSink = new WebhookNotifySink('https://example.com/hook', makeMockFetch().fn)
assertAssignable<NotifySink>(webhookSink)

// satisfies 연산자를 이용한 추가 컴파일 타임 검증 (TS 4.9+)
const webhookSink2 = new WebhookNotifySink(
  'https://example.com/hook',
  makeMockFetch().fn,
) satisfies NotifySink
void webhookSink2

// NotifySink 타입 변수에 직접 할당
const sinkVar: NotifySink = new WebhookNotifySink('https://example.com/hook', makeMockFetch().fn)
void sinkVar

// ── 테스트 스위트 ─────────────────────────────────────────────────────────

describe('WebhookNotifySink 인터페이스 적합성 (Sub-AC 4.4.3)', () => {
  describe('1. NotifySink 타입 할당 가능성', () => {
    it('WebhookNotifySink 인스턴스가 NotifySink 타입으로 할당 가능하다 (컴파일 검증)', () => {
      // 이 테스트가 컴파일·실행되면 타입 적합성이 증명됨
      const sink: NotifySink = new WebhookNotifySink(
        'https://hooks.example.com/notify',
        makeMockFetch().fn,
      )
      expect(sink).toBeDefined()
      expect(typeof sink.send).toBe('function')
    })

    it('satisfies 연산자로 NotifySink 구조적 타입 일치를 강제한다', () => {
      // satisfies NotifySink 가 위에서 컴파일되었으므로 구조 일치 증명됨
      expect(webhookSink2).toBeDefined()
      expect(typeof webhookSink2.send).toBe('function')
    })

    it('NotifySink 배열에 WebhookNotifySink를 담을 수 있다', () => {
      const sinks: NotifySink[] = [
        new WebhookNotifySink('https://hooks-a.example.com', makeMockFetch().fn),
        new WebhookNotifySink('https://hooks-b.example.com', makeMockFetch().fn),
      ]
      expect(sinks).toHaveLength(2)
      sinks.forEach((s) => expect(typeof s.send).toBe('function'))
    })

    it('NotifySink 타입으로 send()를 호출하면 Promise<NotifyResult>가 반환된다', async () => {
      const sink: NotifySink = new WebhookNotifySink(
        'https://hooks.example.com/notify',
        makeMockFetch().fn,
      )
      const payload = makePayload()

      // NotifySink 타입을 통한 호출 — 반환 타입도 컴파일 타임 검증
      const resultPromise: Promise<NotifyResult> = sink.send(payload)
      expect(resultPromise).toBeInstanceOf(Promise)

      const result: NotifyResult = await resultPromise
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('channel')
      expect(result.channel).toBe('webhook')
    })

    it('send 메서드 시그니처가 NotifySink 인터페이스와 정확히 일치한다', () => {
      const sink: NotifySink = new WebhookNotifySink(
        'https://hooks.example.com/notify',
        makeMockFetch().fn,
      )
      // send 메서드 존재 및 매개변수 수 확인
      expect(typeof sink.send).toBe('function')
      expect(sink.send.length).toBe(1)
    })

    it('NotifySink Map에 WebhookNotifySink를 저장할 수 있다', () => {
      const sinkMap = new Map<string, NotifySink>()
      sinkMap.set('webhook', new WebhookNotifySink('https://hooks.example.com', makeMockFetch().fn))

      expect(sinkMap.size).toBe(1)
      const s = sinkMap.get('webhook')!
      expect(typeof s.send).toBe('function')
    })
  })

  describe('2. 어댑터 격리 — 구현체 소스 파일에 fetch import 없음', () => {
    it('webhook-notify-sink.ts 소스 파일이 fetch를 직접 import하지 않는다', () => {
      const sinkSource = readFileSync(
        resolve(PROJECT_ROOT, 'src/notify/sinks/webhook-notify-sink.ts'),
        'utf-8',
      )

      // "import fetch" 또는 "import { fetch" 패턴이 없어야 함
      expect(sinkSource).not.toMatch(/import\s+fetch\s+from/)
      expect(sinkSource).not.toMatch(/import\s+\{[^}]*fetch[^}]*\}\s+from/)
    })

    it('webhook-notify-sink.ts 소스 파일이 node-fetch를 import하지 않는다', () => {
      const sinkSource = readFileSync(
        resolve(PROJECT_ROOT, 'src/notify/sinks/webhook-notify-sink.ts'),
        'utf-8',
      )

      expect(sinkSource).not.toMatch(/from\s+['"]node-fetch['"]/)
      expect(sinkSource).not.toMatch(/require\s*\(\s*['"]node-fetch['"]\s*\)/)
    })

    it('webhook-notify-sink.ts 소스 파일이 axios를 import하지 않는다', () => {
      const sinkSource = readFileSync(
        resolve(PROJECT_ROOT, 'src/notify/sinks/webhook-notify-sink.ts'),
        'utf-8',
      )

      expect(sinkSource).not.toMatch(/from\s+['"]axios['"]/)
      expect(sinkSource).not.toMatch(/require\s*\(\s*['"]axios['"]\s*\)/)
    })

    it('webhook-notify-sink.ts 소스 파일이 got, ky, undici 등 HTTP 클라이언트를 import하지 않는다', () => {
      const sinkSource = readFileSync(
        resolve(PROJECT_ROOT, 'src/notify/sinks/webhook-notify-sink.ts'),
        'utf-8',
      )

      // HTTP 클라이언트 라이브러리 패턴
      const httpClientPatterns = [
        /from\s+['"]got['"]/,
        /from\s+['"]ky['"]/,
        /from\s+['"]undici['"]/,
        /from\s+['"]superagent['"]/,
        /from\s+['"]request['"]/,
      ]

      for (const pattern of httpClientPatterns) {
        expect(sinkSource).not.toMatch(pattern)
      }
    })

    it('webhook-notify-sink.ts의 유일한 import는 contracts.js이다', () => {
      const sinkSource = readFileSync(
        resolve(PROJECT_ROOT, 'src/notify/sinks/webhook-notify-sink.ts'),
        'utf-8',
      )

      // import 구문 추출
      const importLines = sinkSource
        .split('\n')
        .filter((line) => line.trim().startsWith('import'))

      // 모든 import가 contracts.js에서만 와야 함
      for (const line of importLines) {
        expect(line).toMatch(/contracts\.js/)
      }
    })

    it('fetch는 globalThis.fetch를 통해서만 접근하고 DI로 대체 가능하다', () => {
      const sinkSource = readFileSync(
        resolve(PROJECT_ROOT, 'src/notify/sinks/webhook-notify-sink.ts'),
        'utf-8',
      )

      // globalThis.fetch 패턴이 있어야 함 (폴백)
      expect(sinkSource).toMatch(/globalThis\.fetch/)
    })
  })

  describe('3. 테스트 파일 격리 — 테스트 파일에 fetch/HTTP 직접 import 없음', () => {
    const webhookTestFiles = [
      'tests/webhook-notify-sink-sub-ac-3a.test.ts',
      'tests/webhook-notify-sink-sub-ac-3b.test.ts',
      'tests/webhook-notify-sink-sub-ac-3c.test.ts',
    ]

    for (const relPath of webhookTestFiles) {
      it(`${relPath}가 fetch를 직접 import하지 않는다`, () => {
        const source = readFileSync(resolve(PROJECT_ROOT, relPath), 'utf-8')

        // "import fetch from ..." 패턴 없어야 함
        expect(source).not.toMatch(/import\s+fetch\s+from/)
        // "import { fetch" 패턴 없어야 함
        expect(source).not.toMatch(/import\s+\{[^}]*\bfetch\b[^}]*\}\s+from/)
        // node-fetch import 없어야 함
        expect(source).not.toMatch(/from\s+['"]node-fetch['"]/)
        // axios import 없어야 함
        expect(source).not.toMatch(/from\s+['"]axios['"]/)
      })

      it(`${relPath}는 mock FetchFn 어댑터를 통해서만 HTTP를 테스트한다`, () => {
        const source = readFileSync(resolve(PROJECT_ROOT, relPath), 'utf-8')

        // FetchFn 타입을 사용하고 있어야 함 (DI 방식 사용 증거)
        expect(source).toMatch(/FetchFn/)
      })
    }

    it('이 테스트 파일(sub-ac-4-4-3)은 node:fs만 import하고 HTTP 클라이언트를 사용하지 않는다', () => {
      // 이 파일의 import 목록을 확인:
      // - node:fs (readFileSync), node:path (resolve), node:url (fileURLToPath) — 정적 분석용
      // - webhook-notify-sink.ts (검증 대상)
      // - contracts.ts (타입만)
      // fetch, node-fetch, axios 등 HTTP 클라이언트는 import하지 않음
      const selfSource = readFileSync(
        resolve(PROJECT_ROOT, 'tests/webhook-notify-sink-type-sub-ac-4-4-3.test.ts'),
        'utf-8',
      )

      // node-fetch 패키지 import 없어야 함
      expect(selfSource).not.toMatch(/from\s+['"]node-fetch['"]/)
      // axios 패키지 import 없어야 함
      expect(selfSource).not.toMatch(/from\s+['"]axios['"]/)
      // got/ky 등 HTTP 클라이언트 없어야 함
      expect(selfSource).not.toMatch(/from\s+['"]got['"]/)
      expect(selfSource).not.toMatch(/from\s+['"]ky['"]/)
    })
  })

  describe('4. end-to-end: NotifySink 인터페이스를 통한 WebhookNotifySink 동작', () => {
    it('thrashing 알림을 NotifySink 인터페이스로 성공 발송한다', async () => {
      const sink: NotifySink = new WebhookNotifySink(
        'https://hooks.example.com/notify',
        makeMockFetch(true).fn,
      )

      const result = await sink.send(makePayload({ kind: 'thrashing', severity: 'warning' }))

      expect(result.success).toBe(true)
      expect(result.channel).toBe('webhook')
    })

    it('false_success 알림을 NotifySink 인터페이스로 성공 발송한다', async () => {
      const sink: NotifySink = new WebhookNotifySink(
        'https://hooks.example.com/notify',
        makeMockFetch(true).fn,
      )

      const result = await sink.send(
        makePayload({
          kind: 'false_success',
          severity: 'critical',
          dedupeKey: 'type-test-session\x1ffalse_success',
        }),
      )

      expect(result.success).toBe(true)
      expect(result.channel).toBe('webhook')
    })

    it('발송 실패 시에도 NotifySink 계약대로 result를 반환한다 (throw 없음)', async () => {
      const failFetch: FetchFn = async () => {
        throw new Error('connection refused')
      }
      const sink: NotifySink = new WebhookNotifySink('https://hooks.example.com/notify', failFetch)

      // NotifySink 계약: 실패해도 throw 대신 result 반환
      await expect(sink.send(makePayload())).resolves.toMatchObject({
        success: false,
        channel: 'webhook',
      })
    })
  })
})
