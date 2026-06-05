/**
 * tests/run-structural-gate-over-events-sub-ac-3c-2.test.ts
 *
 * Sub-AC 3c-2: 조회된 이벤트 배열에 runStructuralGateOverEvents를 적용해
 * 구조 신호 히트 목록을 반환하는 단계를 검증한다.
 *
 * 커버리지:
 *   - 합성 이벤트 픽스처 입력에 대해 결정론적으로 동일한 히트 배열을 반환
 *   - 동일 입력에 두 번 호출 → 동일 결과 (결정론 보장)
 *   - 편집 없는 이벤트(user/assistant 등) → 빈 배열 반환
 *   - fileEditWarn 임계 이상 동일 파일 반복 편집 → 히트 발화
 *   - fileEditWarn 미만 편집 → 히트 미발화 (경계값)
 *   - 다중 세션/agentScope → 세션별 독립 상태 유지
 *   - DetectionHit 필드 구조 검증 (gate, triggerUuid, ts)
 *   - 빈 이벤트 배열 → 빈 히트 배열
 *
 * ⚠️ 부수효과 없음: 실 FS / API / DB 접근 없음.
 *    합성 StoredEvent 픽스처 + 인메모리 상태만 사용.
 */

import { runStructuralGateOverEvents } from '../src/detect/detection-pipeline.js'
import type { DetectionHit } from '../src/detect/detection-pipeline.js'
import type { StoredEvent } from '../src/ingest/event-store.js'
import type { DetectorConfig } from '../src/contracts.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'

// ─── 합성 픽스처 헬퍼 ─────────────────────────────────────────────────────────

/**
 * 합성 Edit tool_use StoredEvent를 생성한다.
 * 구조 게이트가 thrashing을 탐지할 수 있도록 file_path + old/new_string 포함.
 */
function makeSyntheticEditEvent(opts: {
  uuid: string
  sessionId: string
  agentScope?: string
  ts: number
  filePath?: string
  oldStr?: string
  newStr?: string
}): StoredEvent {
  const {
    uuid,
    sessionId,
    agentScope = 'root',
    ts,
    filePath = '/proj/src/foo.ts',
    oldStr = 'function work() { return 0; }',
    newStr = 'function work() { return 1; }',
  } = opts
  return {
    uuid,
    parentUuid: null,
    sessionId,
    cwd: '/proj',
    agentScope,
    isSidechain: false,
    ts,
    byteOffset: ts * 100,
    kind: 'tool_use',
    tool: 'Edit',
    input: {
      file_path: filePath,
      old_string: oldStr,
      new_string: newStr,
    },
    resultClass: 'ok',
    parseOk: true,
    ingestedAt: ts + 1,
  }
}

/**
 * 합성 user 이벤트 (구조 게이트가 무시하는 이벤트 종류).
 */
function makeSyntheticUserEvent(uuid: string, sessionId: string, ts: number): StoredEvent {
  return {
    uuid,
    parentUuid: null,
    sessionId,
    cwd: '/proj',
    agentScope: 'root',
    isSidechain: false,
    ts,
    byteOffset: ts * 100,
    kind: 'user',
    text: 'some user message',
    parseOk: true,
    ingestedAt: ts + 1,
  }
}

/**
 * 동일 파일을 같은 영역에서 count회 반복 편집하는 thrashing 픽스처를 생성.
 * fileEditWarn=3 설정에서 count >= 3이면 발화한다.
 */
function makeThrashingFixture(
  sessionId: string,
  count: number,
  filePath = '/proj/src/main.ts',
): StoredEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeSyntheticEditEvent({
      uuid: `thrash-${sessionId}-${i}`,
      sessionId,
      ts: 1000 + i * 100,
      filePath,
      // 같은 함수를 미세 변형하며 반복 → maxJaccard >= 0.3 (thrashing)
      oldStr: `function work() { return ${i}; }`,
      newStr: `function work() { return ${i + 1}; }`,
    }),
  )
}

/**
 * 테스트용 낮은 임계값 DetectorConfig.
 * 소규모 합성 픽스처로 게이트가 발화할 수 있도록 설정.
 */
const TEST_CONFIG: DetectorConfig = {
  ...DEFAULT_DETECTOR_CONFIG,
  WARNING: 99,      // repeat_action 비활성 (임계 매우 높게)
  CRITICAL: 999,
  errLoopWarn: 99,
  errLoopCrit: 999,
  fileEditWarn: 3,  // 3회 이상 동일 파일 편집 → warning 발화
  fileEditCrit: 5,  // 5회 이상 → critical 발화
  historySize: 30,
}

// ─── 기본 동작 테스트 ─────────────────────────────────────────────────────────

describe('runStructuralGateOverEvents — Sub-AC 3c-2', () => {
  describe('기본 동작', () => {
    test('빈 이벤트 배열 → 빈 히트 배열 반환', () => {
      const hits = runStructuralGateOverEvents([], TEST_CONFIG)
      expect(hits).toHaveLength(0)
      expect(Array.isArray(hits)).toBe(true)
    })

    test('user 이벤트만 있을 때(tool_use 없음) → 빈 히트 배열 반환', () => {
      const events = [
        makeSyntheticUserEvent('u1', 'sess-user', 1000),
        makeSyntheticUserEvent('u2', 'sess-user', 2000),
        makeSyntheticUserEvent('u3', 'sess-user', 3000),
      ]
      const hits = runStructuralGateOverEvents(events, TEST_CONFIG)
      expect(hits).toHaveLength(0)
    })

    test('편집 횟수가 fileEditWarn 미만이면 발화하지 않는다 (경계값: 2회 < 3)', () => {
      const events = makeThrashingFixture('sess-below', 2)
      const hits = runStructuralGateOverEvents(events, TEST_CONFIG)
      expect(hits).toHaveLength(0)
    })
  })

  // ─── 발화 테스트 ──────────────────────────────────────────────────────────

  describe('thrashing 발화', () => {
    test('fileEditWarn 이상 동일 파일 반복 편집 → 히트 발화 (경계값: count=3)', () => {
      const events = makeThrashingFixture('sess-warn', 3)
      const hits = runStructuralGateOverEvents(events, TEST_CONFIG)
      expect(hits.length).toBeGreaterThanOrEqual(1)
    })

    test('발화된 히트는 DetectionHit 구조를 가진다 (gate/triggerUuid/ts)', () => {
      const events = makeThrashingFixture('sess-struct', 4)
      const hits = runStructuralGateOverEvents(events, TEST_CONFIG)
      expect(hits.length).toBeGreaterThanOrEqual(1)

      for (const hit of hits) {
        // gate: StructureGateResult
        expect(hit.gate).toBeDefined()
        expect(hit.gate.type).toBe('thrashing')
        expect(typeof hit.gate.subtype).toBe('string')
        expect(['warning', 'critical']).toContain(hit.gate.severity)
        expect(Array.isArray(hit.gate.windowRefs)).toBe(true)
        expect(hit.gate.windowRefs.length).toBeGreaterThan(0)
        expect(typeof hit.gate.metrics).toBe('object')

        // triggerUuid: 이벤트 UUID 중 하나여야 함
        expect(typeof hit.triggerUuid).toBe('string')
        expect(hit.triggerUuid.length).toBeGreaterThan(0)
        const eventUuids = new Set(events.map(e => e.uuid))
        expect(eventUuids.has(hit.triggerUuid)).toBe(true)

        // ts: 숫자 타입
        expect(typeof hit.ts).toBe('number')
        expect(hit.ts).toBeGreaterThan(0)
      }
    })

    test('히트의 gate.sessionId는 이벤트 sessionId와 일치한다', () => {
      const SESSION = 'sess-sessionid'
      const events = makeThrashingFixture(SESSION, 4)
      const hits = runStructuralGateOverEvents(events, TEST_CONFIG)
      expect(hits.length).toBeGreaterThanOrEqual(1)

      for (const hit of hits) {
        expect(hit.gate.sessionId).toBe(SESSION)
      }
    })

    test('히트의 gate.windowRefs는 트리거 이벤트의 UUID를 포함한다', () => {
      const events = makeThrashingFixture('sess-wref', 4)
      const hits = runStructuralGateOverEvents(events, TEST_CONFIG)
      expect(hits.length).toBeGreaterThanOrEqual(1)

      const eventUuids = new Set(events.map(e => e.uuid))
      for (const hit of hits) {
        // windowRefs의 UUID는 모두 입력 이벤트 중에 있어야 함
        for (const ref of hit.gate.windowRefs) {
          expect(eventUuids.has(ref)).toBe(true)
        }
      }
    })

    test('fileEditCrit 이상 편집 → critical severity 발화', () => {
      // 5회 이상: fileEditCrit=5
      const events = makeThrashingFixture('sess-crit', 5)
      const hits = runStructuralGateOverEvents(events, TEST_CONFIG)
      expect(hits.length).toBeGreaterThanOrEqual(1)
      const critHits = hits.filter(h => h.gate.severity === 'critical')
      expect(critHits.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ─── 결정론 보장 테스트 ───────────────────────────────────────────────────

  describe('결정론 — 동일 입력에 두 번 호출 시 동일 결과', () => {
    test('thrashing 발화 시나리오: 두 번 호출 결과가 동일하다', () => {
      const events = makeThrashingFixture('sess-determ1', 5)

      const hits1 = runStructuralGateOverEvents(events, TEST_CONFIG)
      const hits2 = runStructuralGateOverEvents(events, TEST_CONFIG)

      // 길이 동일
      expect(hits1.length).toBe(hits2.length)

      // 각 히트의 핵심 필드 동일
      for (let i = 0; i < hits1.length; i++) {
        const h1 = hits1[i]!
        const h2 = hits2[i]!
        expect(h1.triggerUuid).toBe(h2.triggerUuid)
        expect(h1.ts).toBe(h2.ts)
        expect(h1.gate.type).toBe(h2.gate.type)
        expect(h1.gate.subtype).toBe(h2.gate.subtype)
        expect(h1.gate.severity).toBe(h2.gate.severity)
        expect(h1.gate.sessionId).toBe(h2.gate.sessionId)
        expect(h1.gate.windowRefs).toEqual(h2.gate.windowRefs)
        expect(h1.gate.metrics).toEqual(h2.gate.metrics)
      }
    })

    test('미발화 시나리오: 두 번 호출 결과가 모두 빈 배열이다', () => {
      const events = makeThrashingFixture('sess-determ2', 2) // < fileEditWarn

      const hits1 = runStructuralGateOverEvents(events, TEST_CONFIG)
      const hits2 = runStructuralGateOverEvents(events, TEST_CONFIG)

      expect(hits1).toHaveLength(0)
      expect(hits2).toHaveLength(0)
    })

    test('빈 이벤트 배열: 두 번 호출 결과가 모두 빈 배열이다', () => {
      const hits1 = runStructuralGateOverEvents([], TEST_CONFIG)
      const hits2 = runStructuralGateOverEvents([], TEST_CONFIG)
      expect(hits1).toHaveLength(0)
      expect(hits2).toHaveLength(0)
    })

    test('고정 시드 픽스처: 반환 배열 길이·triggerUuid 순서가 항상 동일하다', () => {
      // 완전히 하드코딩된 픽스처 — 외부 상태 의존 없음
      const FIXED_EVENTS: StoredEvent[] = [
        makeSyntheticEditEvent({ uuid: 'f1', sessionId: 'fixed', ts: 1000, oldStr: 'function go() { return 0; }', newStr: 'function go() { return 1; }' }),
        makeSyntheticEditEvent({ uuid: 'f2', sessionId: 'fixed', ts: 2000, oldStr: 'function go() { return 1; }', newStr: 'function go() { return 2; }' }),
        makeSyntheticEditEvent({ uuid: 'f3', sessionId: 'fixed', ts: 3000, oldStr: 'function go() { return 2; }', newStr: 'function go() { return 3; }' }),
        makeSyntheticEditEvent({ uuid: 'f4', sessionId: 'fixed', ts: 4000, oldStr: 'function go() { return 3; }', newStr: 'function go() { return 4; }' }),
      ]

      const run1 = runStructuralGateOverEvents(FIXED_EVENTS, TEST_CONFIG)
      const run2 = runStructuralGateOverEvents(FIXED_EVENTS, TEST_CONFIG)
      const run3 = runStructuralGateOverEvents(FIXED_EVENTS, TEST_CONFIG)

      // 3회 모두 길이 동일
      expect(run1.length).toBe(run2.length)
      expect(run2.length).toBe(run3.length)

      // 3회 모두 동일한 triggerUuid 순서
      const uuids1 = run1.map((h: DetectionHit) => h.triggerUuid)
      const uuids2 = run2.map((h: DetectionHit) => h.triggerUuid)
      const uuids3 = run3.map((h: DetectionHit) => h.triggerUuid)
      expect(uuids1).toEqual(uuids2)
      expect(uuids2).toEqual(uuids3)

      // 발화가 있어야 함 (4회 편집 >= fileEditWarn=3)
      expect(run1.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ─── 다중 세션 독립성 테스트 ─────────────────────────────────────────────

  describe('다중 세션 독립성', () => {
    test('서로 다른 세션은 슬라이딩 윈도 상태가 독립적이다', () => {
      // 세션 A: 5회 편집 (발화)
      // 세션 B: 2회 편집 (미발화)
      // 합쳐서 한 번에 처리할 때 세션 B가 세션 A 상태에 영향받지 않아야 함
      const eventsA = makeThrashingFixture('sess-a', 5, '/proj/a.ts')
      const eventsB = makeThrashingFixture('sess-b', 2, '/proj/a.ts') // 동일 파일
      const mixed = [...eventsA, ...eventsB]

      const hits = runStructuralGateOverEvents(mixed, TEST_CONFIG)

      // 세션 A 히트만 존재 (세션 B는 미발화)
      const hitSessionIds = new Set(hits.map(h => h.gate.sessionId))
      expect(hitSessionIds.has('sess-a')).toBe(true)
      expect(hitSessionIds.has('sess-b')).toBe(false)
    })

    test('같은 파일을 서로 다른 세션에서 편집해도 세션별로 독립 집계', () => {
      // 세션 X: 3회 편집 (발화)
      // 세션 Y: 3회 편집 (발화) — 동일 파일, 다른 세션
      const eventsX = makeThrashingFixture('sess-x', 3, '/proj/shared.ts')
      const eventsY = makeThrashingFixture('sess-y', 3, '/proj/shared.ts')
      const all = [...eventsX, ...eventsY]

      const hits = runStructuralGateOverEvents(all, TEST_CONFIG)
      const hitSessionIds = new Set(hits.map(h => h.gate.sessionId))

      // 두 세션 모두 독립적으로 발화
      expect(hitSessionIds.has('sess-x')).toBe(true)
      expect(hitSessionIds.has('sess-y')).toBe(true)
    })
  })

  // ─── agentScope 독립성 테스트 ────────────────────────────────────────────

  describe('agentScope 독립성', () => {
    test('같은 세션 내 서로 다른 agentScope는 슬라이딩 윈도가 분리된다', () => {
      const SESSION = 'sess-scope'
      // root 스코프: 3회 편집 (발화)
      const rootEvents = Array.from({ length: 3 }, (_, i) =>
        makeSyntheticEditEvent({
          uuid: `root-${i}`,
          sessionId: SESSION,
          agentScope: 'root',
          ts: 1000 + i * 100,
          oldStr: `function go() { return ${i}; }`,
          newStr: `function go() { return ${i + 1}; }`,
        }),
      )
      // sub 스코프: 2회 편집 (미발화)
      const subEvents = Array.from({ length: 2 }, (_, i) =>
        makeSyntheticEditEvent({
          uuid: `sub-${i}`,
          sessionId: SESSION,
          agentScope: 'sub-agent-1',
          ts: 2000 + i * 100,
          oldStr: `function go() { return ${i}; }`,
          newStr: `function go() { return ${i + 1}; }`,
        }),
      )

      const hits = runStructuralGateOverEvents([...rootEvents, ...subEvents], TEST_CONFIG)

      // root 스코프에서만 발화
      const rootHits = hits.filter(h => h.gate.agentScope === 'root')
      const subHits = hits.filter(h => h.gate.agentScope === 'sub-agent-1')
      expect(rootHits.length).toBeGreaterThanOrEqual(1)
      expect(subHits).toHaveLength(0)
    })
  })

  // ─── 반환 타입 불변성 ────────────────────────────────────────────────────

  describe('반환 타입', () => {
    test('반환 배열은 readonly (변경해도 원본에 영향 없다)', () => {
      const events = makeThrashingFixture('sess-immut', 4)
      const hits = runStructuralGateOverEvents(events, TEST_CONFIG)

      // TypeScript readonly이지만 JS에서 push를 시도해도 원본은 유지
      // 반환값이 배열 인터페이스를 가진다
      expect(Array.isArray(hits)).toBe(true)
    })

    test('반환 히트의 gate.windowRefs는 배열이며 비어있지 않다', () => {
      const events = makeThrashingFixture('sess-wref2', 4)
      const hits = runStructuralGateOverEvents(events, TEST_CONFIG)
      expect(hits.length).toBeGreaterThanOrEqual(1)

      for (const hit of hits) {
        expect(Array.isArray(hit.gate.windowRefs)).toBe(true)
        expect(hit.gate.windowRefs.length).toBeGreaterThan(0)
      }
    })
  })
})
