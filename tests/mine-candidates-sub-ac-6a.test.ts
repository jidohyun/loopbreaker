/**
 * tests/mine-candidates-sub-ac-6a.test.ts
 *
 * Sub-AC 6a: thrashingScore(events) 단위 테스트.
 *
 * 커버리지:
 *   - computeIoU: 기본 케이스, 완전 일치, 겹침 없음, 단방향 포함, 빈 집합
 *   - thrashingScore: 합성 이벤트 픽스처로 IoU 기반 span 점수 계산
 *     - 게이트 미발화 → 0 반환
 *     - goldSpanUuids 빈 배열 → 0 반환
 *     - 발화하지만 gold 겹침 없음 → 0 반환
 *     - 완전 일치 → 1.0 반환
 *     - 부분 겹침 → 0~1 사이 값 반환
 *     - 여러 hit 중 최댓값 반환
 *   - mineCandidates: CandidateSignal 배열 반환, 필드 검증
 *
 * ⚠️ 부수효과 없음: 실 FS/API/DB 접근 없음.
 * 합성 이벤트 픽스처 + 인메모리 상태만 사용.
 */

import { computeIoU, thrashingScore, mineCandidates } from '../src/eval/mine-candidates.js'
import type { StoredEvent } from '../src/ingest/event-store.js'
import type { DetectorConfig } from '../src/contracts.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'

// ─── 합성 픽스처 헬퍼 ─────────────────────────────────────────────────────────

/**
 * 합성 StoredEvent 생성 (tool_use 이벤트, Edit 도구 사용).
 * 동일 file_path + old/new_string을 사용해 구조 게이트가 thrashing을 탐지할 수 있게 한다.
 */
function makeSyntheticEditEvent(
  uuid: string,
  sessionId: string,
  ts: number,
  filePath = '/proj/src/foo.ts',
  oldStr = 'function doWork() { return 1; }',
  newStr = 'function doWork() { return 2; }',
): StoredEvent {
  return {
    uuid,
    parentUuid: null,
    sessionId,
    cwd: '/proj',
    agentScope: 'root',
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
 * 합성 비편집 이벤트 (user 이벤트, 구조 게이트가 처리 안 함).
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
    text: 'hello',
    parseOk: true,
    ingestedAt: ts + 1,
  }
}

/**
 * 파일 편집 반복을 통해 구조 게이트가 발화하는 합성 이벤트 시퀀스를 생성.
 * fileEditWarn=3, fileEditCrit=5를 트리거하기 위해 동일 파일 N회 편집.
 */
function makeThrashingEvents(sessionId: string, count: number, filePath = '/proj/src/main.ts'): StoredEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeSyntheticEditEvent(
      `evt-${sessionId}-${i}`,
      sessionId,
      1000 + i * 100,
      filePath,
      // 약간씩 다른 old/new 이지만 같은 함수를 맴도는 패턴 → maxJaccard >= 0.3
      `function work() { return ${i}; }`,
      `function work() { return ${i + 1}; }`,
    )
  )
}

/**
 * 구조 게이트가 발화하지 않는 합성 이벤트 시퀀스 (편집 없음).
 */
function makeNonThrashingEvents(sessionId: string, count: number): StoredEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeSyntheticUserEvent(`evt-ns-${sessionId}-${i}`, sessionId, 1000 + i * 100)
  )
}

/**
 * 테스트용 DetectorConfig — 낮은 임계값으로 소규모 합성 데이터로도 게이트 발화.
 */
const TEST_CONFIG: DetectorConfig = {
  ...DEFAULT_DETECTOR_CONFIG,
  WARNING: 3,
  CRITICAL: 5,
  fileEditWarn: 3,
  fileEditCrit: 5,
  historySize: 30,
}

// ─── computeIoU 단위 테스트 ───────────────────────────────────────────────────

describe('computeIoU', () => {
  test('양 집합 빈 경우 → 0 반환', () => {
    expect(computeIoU(new Set(), new Set())).toBe(0)
  })

  test('pred 빈 경우 → 0 반환', () => {
    const gold = new Set(['a', 'b', 'c'])
    expect(computeIoU(new Set(), gold)).toBe(0)
  })

  test('gold 빈 경우 → 0 반환', () => {
    const pred = new Set(['a', 'b', 'c'])
    expect(computeIoU(pred, new Set())).toBe(0)
  })

  test('완전 일치 → 1.0 반환', () => {
    const pred = new Set(['a', 'b', 'c'])
    const gold = new Set(['a', 'b', 'c'])
    expect(computeIoU(pred, gold)).toBe(1.0)
  })

  test('겹침 없음 → 0 반환', () => {
    const pred = new Set(['a', 'b'])
    const gold = new Set(['c', 'd'])
    expect(computeIoU(pred, gold)).toBe(0)
  })

  test('단방향 포함 (gold ⊂ pred) → 정확한 IoU', () => {
    // pred={a,b,c,d}, gold={a,b}
    // intersection=2, union=4, IoU=0.5
    const pred = new Set(['a', 'b', 'c', 'd'])
    const gold = new Set(['a', 'b'])
    expect(computeIoU(pred, gold)).toBeCloseTo(0.5, 5)
  })

  test('부분 겹침 → 정확한 IoU', () => {
    // pred={a,b,c}, gold={b,c,d}
    // intersection=2, union=4, IoU=0.5
    const pred = new Set(['a', 'b', 'c'])
    const gold = new Set(['b', 'c', 'd'])
    expect(computeIoU(pred, gold)).toBeCloseTo(0.5, 5)
  })

  test('단일 원소 완전 일치 → 1.0', () => {
    expect(computeIoU(new Set(['x']), new Set(['x']))).toBe(1.0)
  })

  test('단일 원소 불일치 → 0', () => {
    expect(computeIoU(new Set(['x']), new Set(['y']))).toBe(0)
  })
})

// ─── thrashingScore 단위 테스트 ───────────────────────────────────────────────

describe('thrashingScore', () => {
  test('goldSpanUuids 빈 배열 → 0 반환', () => {
    const events = makeThrashingEvents('sess-empty', 6)
    const score = thrashingScore(events, [], TEST_CONFIG)
    expect(score).toBe(0)
  })

  test('이벤트 없음 → 0 반환', () => {
    const score = thrashingScore([], ['uuid-a', 'uuid-b'], TEST_CONFIG)
    expect(score).toBe(0)
  })

  test('게이트 미발화(편집 없음) → 0 반환', () => {
    const events = makeNonThrashingEvents('sess-nf', 10)
    const goldUuids = events.map(e => e.uuid)
    const score = thrashingScore(events, goldUuids, TEST_CONFIG)
    expect(score).toBe(0)
  })

  test('게이트 발화하지만 gold span 겹침 없음 → 0 반환', () => {
    const events = makeThrashingEvents('sess-nooverlap', 6)
    // gold span은 완전히 다른 UUID
    const goldUuids = ['other-uuid-1', 'other-uuid-2', 'other-uuid-3']
    const score = thrashingScore(events, goldUuids, TEST_CONFIG)
    expect(score).toBe(0)
  })

  test('게이트 발화 + 완전 일치 → 1.0 반환', () => {
    const events = makeThrashingEvents('sess-full', 6)
    // 모든 이벤트 UUID를 gold span으로 설정
    const goldUuids = events.map(e => e.uuid)
    const score = thrashingScore(events, goldUuids, TEST_CONFIG)
    expect(score).toBe(1.0)
  })

  test('게이트 발화 + 부분 겹침 → 0~1 사이 값 반환', () => {
    const events = makeThrashingEvents('sess-partial', 6)
    // gold span은 절반만 (첫 3개)
    const goldUuids = events.slice(0, 3).map(e => e.uuid)
    const score = thrashingScore(events, goldUuids, TEST_CONFIG)
    // score는 0보다 크고 1 이하여야 함
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test('반환값은 숫자 타입이다', () => {
    const events = makeThrashingEvents('sess-type', 6)
    const goldUuids = events.map(e => e.uuid)
    const score = thrashingScore(events, goldUuids, TEST_CONFIG)
    expect(typeof score).toBe('number')
  })

  test('반환값은 0~1 범위 내', () => {
    const events = makeThrashingEvents('sess-range', 6)
    const goldUuids = events.slice(0, 4).map(e => e.uuid)
    const score = thrashingScore(events, goldUuids, TEST_CONFIG)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })
})

// ─── mineCandidates 단위 테스트 ───────────────────────────────────────────────

describe('mineCandidates', () => {
  const SESSION_ID = 'sess-mine'
  const MINED_AT = 1700000000000

  test('이벤트 없음 → 빈 배열 반환', () => {
    const candidates = mineCandidates([], SESSION_ID, TEST_CONFIG, MINED_AT)
    expect(candidates).toHaveLength(0)
  })

  test('게이트 미발화 → 빈 배열 반환', () => {
    const events = makeNonThrashingEvents(SESSION_ID, 5)
    const candidates = mineCandidates(events, SESSION_ID, TEST_CONFIG, MINED_AT)
    expect(candidates).toHaveLength(0)
  })

  test('게이트 발화 → CandidateSignal 배열 반환', () => {
    const events = makeThrashingEvents(SESSION_ID, 6)
    const candidates = mineCandidates(events, SESSION_ID, TEST_CONFIG, MINED_AT)
    expect(candidates.length).toBeGreaterThan(0)
  })

  test('각 CandidateSignal은 필수 필드를 가진다', () => {
    const events = makeThrashingEvents(SESSION_ID, 6)
    const candidates = mineCandidates(events, SESSION_ID, TEST_CONFIG, MINED_AT)

    for (const c of candidates) {
      expect(typeof c.candidateId).toBe('string')
      expect(c.candidateId.length).toBeGreaterThan(0)
      expect(c.sessionId).toBe(SESSION_ID)
      expect(['thrashing', 'false_success']).toContain(c.kind)
      expect(typeof c.subtype).toBe('string')
      expect(Array.isArray(c.windowRefs)).toBe(true)
      expect(['warning', 'critical']).toContain(c.severity)
      expect(typeof c.metrics).toBe('object')
      expect(c.minedAt).toBe(MINED_AT)
    }
  })

  test('thrashing 후보는 startUuid/endUuid를 가진다', () => {
    const events = makeThrashingEvents(SESSION_ID, 6)
    const candidates = mineCandidates(events, SESSION_ID, TEST_CONFIG, MINED_AT)
    const thrashing = candidates.filter(c => c.kind === 'thrashing')

    for (const c of thrashing) {
      expect(c.startUuid).toBeDefined()
      expect(c.endUuid).toBeDefined()
      expect(c.anchorUuid).toBeUndefined()
    }
  })

  test('반환 배열은 불변이다', () => {
    const events = makeThrashingEvents(SESSION_ID, 6)
    const candidates = mineCandidates(events, SESSION_ID, TEST_CONFIG, MINED_AT)
    expect(Object.isFrozen(candidates)).toBe(true)
  })
})
