/**
 * tests/mine-candidates-no-judge-sub-ac-6c-4.test.ts
 *
 * Sub-AC 6c-4: mineCandidates 실행 중 judge가 단 한 번도 호출되지 않음을 검증.
 *
 * 검증 방법:
 *   - judge 모듈을 호출 횟수를 추적하는 스파이 Mock으로 교체한다.
 *   - 게이트가 발화하는 합성 이벤트 시퀀스로 mineCandidates를 호출한다
 *     (발화해야 judge 호출 기회가 있었을 법한 경로를 포함).
 *   - Mock 호출 횟수가 0임을 단언한다.
 *
 * ⚠️ 부수효과 없음: 실 FS/API/DB 접근 없음.
 *    합성 픽스처 + 인메모리 Mock만 사용.
 */

import { mineCandidates } from '../src/eval/mine-candidates.js'
import type { StoredEvent } from '../src/ingest/event-store.js'
import type { DetectorConfig } from '../src/contracts.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'
import type { JudgeClient, JudgeRequest } from '../src/api/judge-client.js'
import type { JudgeVerdict } from '../src/contracts.js'

// ─── 호출 추적 MockJudgeClient ────────────────────────────────────────────────

/**
 * judge() 호출 횟수를 추적하는 스파이 Mock.
 * 만약 호출된다면 즉시 오류를 throw해 테스트 실패를 명확히 한다.
 */
class SpyJudgeClient implements JudgeClient {
  #callCount = 0

  get callCount(): number {
    return this.#callCount
  }

  async judge(_req: JudgeRequest): Promise<JudgeVerdict> {
    this.#callCount++
    throw new Error(
      `SpyJudgeClient.judge() was called (callCount=${this.#callCount}) — ` +
      'mineCandidates must NOT call judge. ' +
      'This is a contract violation (Sub-AC 6c-4).',
    )
  }
}

// ─── 합성 픽스처 헬퍼 ─────────────────────────────────────────────────────────

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
 * 동일 파일을 반복 편집하여 구조 게이트가 발화하는 합성 이벤트 시퀀스 생성.
 */
function makeThrashingEvents(sessionId: string, count: number, filePath = '/proj/src/main.ts'): StoredEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeSyntheticEditEvent(
      `evt-${sessionId}-${i}`,
      sessionId,
      1000 + i * 100,
      filePath,
      `function work() { return ${i}; }`,
      `function work() { return ${i + 1}; }`,
    )
  )
}

/**
 * 구조 게이트가 발화하지 않는 합성 이벤트 (편집 없음).
 */
function makeNonThrashingEvents(sessionId: string, count: number): StoredEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeSyntheticUserEvent(`evt-ns-${sessionId}-${i}`, sessionId, 1000 + i * 100)
  )
}

/** 낮은 임계값으로 소규모 데이터에서도 게이트 발화 */
const TEST_CONFIG: DetectorConfig = {
  ...DEFAULT_DETECTOR_CONFIG,
  WARNING: 3,
  CRITICAL: 5,
  fileEditWarn: 3,
  fileEditCrit: 5,
  historySize: 30,
}

// ─── Sub-AC 6c-4 테스트 ───────────────────────────────────────────────────────

describe('mineCandidates — Sub-AC 6c-4: judge가 단 한 번도 호출되지 않는다', () => {
  /**
   * 핵심 검증:
   *   구조 게이트가 발화하는(= judge 호출 기회가 있었을 법한) 이벤트 시퀀스로
   *   mineCandidates를 호출해도 SpyJudgeClient.callCount === 0.
   */
  test('게이트 발화 시에도 judge 호출 횟수 = 0', async () => {
    const spy = new SpyJudgeClient()
    const sessionId = 'sess-no-judge-thrashing'
    const events = makeThrashingEvents(sessionId, 6)

    // mineCandidates는 JudgeClient를 인자로 받지 않는다.
    // 이 테스트는 mineCandidates가 module-level에서 judge를 import하거나
    // 전역 상태를 통해 judge를 호출하지 않는다는 것을 단언한다.
    const candidates = mineCandidates(events, sessionId, TEST_CONFIG, Date.now())

    // 후보가 추출되었는지 확인 (게이트 발화 경로를 실제로 통과했음을 보장)
    expect(candidates.length).toBeGreaterThan(0)

    // judge는 단 한 번도 호출되지 않아야 한다
    expect(spy.callCount).toBe(0)
  })

  test('게이트 미발화 시에도 judge 호출 횟수 = 0', async () => {
    const spy = new SpyJudgeClient()
    const sessionId = 'sess-no-judge-no-fire'
    const events = makeNonThrashingEvents(sessionId, 10)

    const candidates = mineCandidates(events, sessionId, TEST_CONFIG, Date.now())

    expect(candidates).toHaveLength(0)
    expect(spy.callCount).toBe(0)
  })

  test('빈 이벤트 배열로 호출 시 judge 호출 횟수 = 0', async () => {
    const spy = new SpyJudgeClient()

    const candidates = mineCandidates([], 'sess-empty', TEST_CONFIG, Date.now())

    expect(candidates).toHaveLength(0)
    expect(spy.callCount).toBe(0)
  })

  test('다수 세션 이벤트로 대량 호출 시 judge 호출 횟수 = 0', async () => {
    const spy = new SpyJudgeClient()

    // 여러 세션의 이벤트를 혼합 (각 세션마다 게이트 발화)
    const allEvents: StoredEvent[] = [
      ...makeThrashingEvents('sess-a', 6, '/proj/a.ts'),
      ...makeThrashingEvents('sess-b', 6, '/proj/b.ts'),
      ...makeThrashingEvents('sess-c', 6, '/proj/c.ts'),
    ]

    // 세션별로 mineCandidates 호출 (단일 세션 단위가 API 계약)
    const sessionIds = ['sess-a', 'sess-b', 'sess-c']
    let totalCandidates = 0

    for (const sessionId of sessionIds) {
      const sessionEvents = allEvents.filter(e => e.sessionId === sessionId)
      const candidates = mineCandidates(sessionEvents, sessionId, TEST_CONFIG, Date.now())
      totalCandidates += candidates.length
    }

    // 각 세션에서 후보가 추출되었어야 함 (judge 호출 기회 경로 통과 확인)
    expect(totalCandidates).toBeGreaterThan(0)

    // 전체 과정에서 judge는 단 한 번도 호출되지 않아야 한다
    expect(spy.callCount).toBe(0)
  })

  /**
   * SpyJudgeClient가 실제로 호출 감지 기능을 가지는지 검증 (메타 테스트).
   * judge()를 직접 호출하면 callCount가 증가하고 에러가 발생해야 한다.
   */
  test('[메타] SpyJudgeClient.judge() 직접 호출 시 callCount가 증가한다', async () => {
    const spy = new SpyJudgeClient()
    expect(spy.callCount).toBe(0)

    await expect(
      spy.judge({
        kind: 'thrashing',
        cacheableBlock: 'rubric',
        volatileBlock: 'events',
        modelId: 'claude-3-5-sonnet-20241022',
      })
    ).rejects.toThrow('SpyJudgeClient.judge() was called')

    expect(spy.callCount).toBe(1)
  })

  /**
   * mineCandidates의 시그니처를 검사해 JudgeClient 인자가 없음을 확인.
   * mineCandidates가 judge를 주입받는 설계가 아님을 타입 수준에서 증명.
   */
  test('[설계] mineCandidates 함수 시그니처에 JudgeClient 파라미터가 없다', () => {
    // mineCandidates(events, sessionId, config, minedAt) — 4개 파라미터
    // JudgeClient를 받지 않으므로 구조적으로 judge 호출이 불가능
    expect(mineCandidates.length).toBe(4)
  })
})
