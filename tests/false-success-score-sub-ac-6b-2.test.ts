/**
 * tests/false-success-score-sub-ac-6b-2.test.ts
 *
 * Sub-AC 6b-2: falseSuccessScore 단위 테스트.
 *
 * 검증 항목:
 *   1. 패턴 없는 픽스처에서 0 반환
 *   2. 패턴 있는 픽스처에서 양수 반환
 *   3. 윈도 ±k 범위 경계 조건
 *   4. anchorUuid 미발견 → 0 반환
 *   5. 빈 이벤트 배열 → 0 반환
 *   6. 텍스트 없는 이벤트(tool_use) → 패턴 없음 처리
 *   7. 반환값 0~1 범위 보장
 *   8. 전체 윈도 패턴 → 1.0 반환
 *
 * ⚠️ 부수효과 없음: 실 FS/API/DB 접근 없음.
 * 합성 픽스처 + 순수 함수 테스트만.
 */

import { falseSuccessScore } from '../src/eval/mine-candidates.js'
import type { StoredEvent } from '../src/ingest/event-store.js'

// ─── 합성 픽스처 헬퍼 ─────────────────────────────────────────────────────────

/**
 * 텍스트 이벤트(assistant 메시지) 생성.
 * text 필드에 false success 패턴을 넣거나 중립 문장을 넣는다.
 */
function makeTextEvent(
  uuid: string,
  sessionId: string,
  ts: number,
  text: string,
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
    kind: 'assistant',
    text,
    parseOk: true,
    ingestedAt: ts + 1,
  }
}

/**
 * tool_use 이벤트 생성 (text 필드 없음).
 */
function makeToolEvent(
  uuid: string,
  sessionId: string,
  ts: number,
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
    input: { file_path: '/proj/src/foo.ts', old_string: 'a', new_string: 'b' },
    parseOk: true,
    ingestedAt: ts + 1,
  }
}

// false success 패턴이 포함된 텍스트 샘플
const FALSE_SUCCESS_TEXTS = [
  '작업이 완료되었습니다.',
  '성공적으로 처리됨.',
  '내가 확인한 결과 정상입니다.',
  '모든 설정이 성공적으로 완료되었습니다.',
  '제가 검토한 결과 문제없습니다.',
]

// 중립적인 텍스트 샘플 (패턴 없음)
const NEUTRAL_TEXTS = [
  '다음 파일을 분석합니다.',
  'TypeScript 코드를 확인 중입니다.',
  '빌드 에러가 발생했습니다.',
  '의존성을 설치하겠습니다.',
  '테스트를 실행합니다.',
]

// ─── 1. 패턴 없는 픽스처에서 0 반환 ──────────────────────────────────────────

describe('falseSuccessScore — 패턴 없는 픽스처', () => {
  test('중립 텍스트만 있는 이벤트 → 0 반환', () => {
    const sessionId = 'sess-neutral'
    const events: StoredEvent[] = NEUTRAL_TEXTS.map((text, i) =>
      makeTextEvent(`uuid-neutral-${i}`, sessionId, 1000 + i * 100, text),
    )
    const anchorUuid = events[2]!.uuid
    const score = falseSuccessScore(events, anchorUuid, 5)
    expect(score).toBe(0)
  })

  test('tool_use 이벤트만 있는 윈도 → 0 반환', () => {
    const sessionId = 'sess-tool-only'
    const events: StoredEvent[] = Array.from({ length: 11 }, (_, i) =>
      makeToolEvent(`uuid-tool-${i}`, sessionId, 1000 + i * 100),
    )
    const anchorUuid = events[5]!.uuid
    const score = falseSuccessScore(events, anchorUuid, 5)
    expect(score).toBe(0)
  })

  test('빈 텍스트 이벤트들 → 0 반환', () => {
    const sessionId = 'sess-empty-text'
    const events: StoredEvent[] = Array.from({ length: 5 }, (_, i) =>
      makeTextEvent(`uuid-empty-${i}`, sessionId, 1000 + i * 100, '   '),
    )
    const anchorUuid = events[2]!.uuid
    const score = falseSuccessScore(events, anchorUuid, 5)
    expect(score).toBe(0)
  })

  test('에러 보고 문장만 있는 윈도 → 0 반환', () => {
    const sessionId = 'sess-errors'
    const texts = [
      '빌드가 실패했습니다.',
      '타입 에러가 발생했습니다.',
      'npm install이 실패했습니다.',
    ]
    const events: StoredEvent[] = texts.map((text, i) =>
      makeTextEvent(`uuid-err-${i}`, sessionId, 1000 + i * 100, text),
    )
    const anchorUuid = events[1]!.uuid
    const score = falseSuccessScore(events, anchorUuid, 2)
    expect(score).toBe(0)
  })
})

// ─── 2. 패턴 있는 픽스처에서 양수 반환 ─────────────────────────────────────────

describe('falseSuccessScore — 패턴 있는 픽스처', () => {
  test('완료선언 텍스트가 anchor 이벤트에 있으면 양수 반환', () => {
    const sessionId = 'sess-pattern-anchor'
    const events: StoredEvent[] = [
      makeTextEvent('uuid-before-1', sessionId, 900, '분석을 시작합니다.'),
      makeTextEvent('uuid-before-2', sessionId, 1000, '파일을 읽는 중입니다.'),
      makeTextEvent('uuid-anchor', sessionId, 1100, '작업이 완료되었습니다.'), // anchor, 패턴
      makeTextEvent('uuid-after-1', sessionId, 1200, '다음 단계입니다.'),
      makeTextEvent('uuid-after-2', sessionId, 1300, '처리 완료.'),
    ]
    const score = falseSuccessScore(events, 'uuid-anchor', 5)
    expect(score).toBeGreaterThan(0)
  })

  test('자기검증 순환참조 텍스트가 있으면 양수 반환', () => {
    const sessionId = 'sess-self-ref'
    const events: StoredEvent[] = [
      makeTextEvent('uuid-a', sessionId, 1000, '코드를 분석합니다.'),
      makeTextEvent('uuid-b', sessionId, 1100, '내가 확인한 결과 정상입니다.'), // 패턴
      makeTextEvent('uuid-c', sessionId, 1200, '다음 작업으로 이동합니다.'),
    ]
    const score = falseSuccessScore(events, 'uuid-b', 5)
    expect(score).toBeGreaterThan(0)
  })

  test('윈도 내 여러 이벤트에 패턴 있으면 양수 반환', () => {
    const sessionId = 'sess-multi-pattern'
    const events: StoredEvent[] = FALSE_SUCCESS_TEXTS.map((text, i) =>
      makeTextEvent(`uuid-fp-${i}`, sessionId, 1000 + i * 100, text),
    )
    const anchorUuid = events[2]!.uuid
    const score = falseSuccessScore(events, anchorUuid, 5)
    expect(score).toBeGreaterThan(0)
  })

  test('영어 false success 패턴도 양수 반환', () => {
    const sessionId = 'sess-english'
    const events: StoredEvent[] = [
      makeTextEvent('uuid-en-1', sessionId, 1000, 'Analyzing the code.'),
      makeTextEvent('uuid-en-2', sessionId, 1100, 'The task was successfully completed.'), // 패턴
      makeTextEvent('uuid-en-3', sessionId, 1200, 'Moving on to the next step.'),
    ]
    const score = falseSuccessScore(events, 'uuid-en-2', 5)
    expect(score).toBeGreaterThan(0)
  })

  test('anchor 인근(±k 내)에 패턴 있으면 양수 반환', () => {
    const sessionId = 'sess-nearby'
    // anchor는 중립, 바로 다음 이벤트가 패턴
    const events: StoredEvent[] = [
      makeTextEvent('uuid-n-0', sessionId, 1000, '분석을 시작합니다.'),
      makeTextEvent('uuid-n-1', sessionId, 1100, '파일 확인 중.'),
      makeTextEvent('uuid-n-2', sessionId, 1200, '처리 중입니다.'), // anchor (중립)
      makeTextEvent('uuid-n-3', sessionId, 1300, '성공적으로 처리됨.'), // 패턴 (+1)
      makeTextEvent('uuid-n-4', sessionId, 1400, '다음 단계.'),
    ]
    const score = falseSuccessScore(events, 'uuid-n-2', 5)
    expect(score).toBeGreaterThan(0)
  })
})

// ─── 3. 윈도 ±k 범위 경계 조건 ────────────────────────────────────────────────

describe('falseSuccessScore — ±k 윈도 경계', () => {
  test('k=0이면 anchor 단일 이벤트만 검사', () => {
    const sessionId = 'sess-k0'
    const events: StoredEvent[] = [
      makeTextEvent('uuid-k0-0', sessionId, 1000, '작업이 완료되었습니다.'), // 패턴
      makeTextEvent('uuid-k0-1', sessionId, 1100, '다음 단계입니다.'), // anchor (중립)
      makeTextEvent('uuid-k0-2', sessionId, 1200, '성공적으로 완료.'), // 패턴
    ]
    // anchor가 중립이고 k=0이면 0 반환
    const score = falseSuccessScore(events, 'uuid-k0-1', 0)
    expect(score).toBe(0)
  })

  test('k=0이면 anchor 단일 이벤트 패턴 → 1.0 반환', () => {
    const sessionId = 'sess-k0-pattern'
    const events: StoredEvent[] = [
      makeTextEvent('uuid-k0p-0', sessionId, 1000, '중립 문장입니다.'),
      makeTextEvent('uuid-k0p-1', sessionId, 1100, '작업이 완료되었습니다.'), // anchor, 패턴
      makeTextEvent('uuid-k0p-2', sessionId, 1200, '중립 문장입니다.'),
    ]
    const score = falseSuccessScore(events, 'uuid-k0p-1', 0)
    expect(score).toBe(1.0)
  })

  test('anchor가 첫 번째 이벤트 → 음수 인덱스 클램핑 정상 처리', () => {
    const sessionId = 'sess-first'
    const events: StoredEvent[] = [
      makeTextEvent('uuid-first-0', sessionId, 1000, '작업이 완료되었습니다.'), // anchor, 패턴
      makeTextEvent('uuid-first-1', sessionId, 1100, '다음 단계입니다.'),
      makeTextEvent('uuid-first-2', sessionId, 1200, '분석 중.'),
    ]
    const score = falseSuccessScore(events, 'uuid-first-0', 5)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test('anchor가 마지막 이벤트 → 범위 초과 클램핑 정상 처리', () => {
    const sessionId = 'sess-last'
    const events: StoredEvent[] = [
      makeTextEvent('uuid-last-0', sessionId, 1000, '중립 문장.'),
      makeTextEvent('uuid-last-1', sessionId, 1100, '중립 문장.'),
      makeTextEvent('uuid-last-2', sessionId, 1200, '내가 확인한 결과 정상입니다.'), // anchor, 패턴
    ]
    const score = falseSuccessScore(events, 'uuid-last-2', 5)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(1)
  })

  test('k 범위 밖의 패턴 이벤트는 점수에 영향 안 줌', () => {
    const sessionId = 'sess-outofrange'
    // anchor=idx 5, k=1이면 [4..6]만 검사
    const events: StoredEvent[] = Array.from({ length: 11 }, (_, i) => {
      // idx 0, 1, 2, 3 (k=1 범위 밖): 패턴
      // idx 4, 5, 6 (k=1 범위 내): 중립
      // idx 7, 8, 9, 10 (k=1 범위 밖): 패턴
      const isOutOfRange = i < 4 || i > 6
      const text = isOutOfRange ? '작업이 완료되었습니다.' : '다음 단계입니다.'
      return makeTextEvent(`uuid-oor-${i}`, sessionId, 1000 + i * 100, text)
    })
    const anchorUuid = events[5]!.uuid
    const score = falseSuccessScore(events, anchorUuid, 1)
    expect(score).toBe(0)
  })
})

// ─── 4. anchorUuid 미발견 ─────────────────────────────────────────────────────

describe('falseSuccessScore — anchorUuid 미발견', () => {
  test('존재하지 않는 anchorUuid → 0 반환', () => {
    const sessionId = 'sess-notfound'
    const events: StoredEvent[] = FALSE_SUCCESS_TEXTS.map((text, i) =>
      makeTextEvent(`uuid-nf-${i}`, sessionId, 1000 + i * 100, text),
    )
    const score = falseSuccessScore(events, 'uuid-does-not-exist', 5)
    expect(score).toBe(0)
  })

  test('빈 anchorUuid 문자열 → 0 반환', () => {
    const sessionId = 'sess-empty-anchor'
    const events: StoredEvent[] = [
      makeTextEvent('uuid-ea-0', sessionId, 1000, '작업이 완료되었습니다.'),
    ]
    const score = falseSuccessScore(events, '', 5)
    expect(score).toBe(0)
  })
})

// ─── 5. 빈 이벤트 배열 ───────────────────────────────────────────────────────

describe('falseSuccessScore — 빈 이벤트 배열', () => {
  test('이벤트 배열이 빈 배열 → 0 반환', () => {
    const score = falseSuccessScore([], 'any-uuid', 5)
    expect(score).toBe(0)
  })
})

// ─── 6. tool_use 이벤트(text 없음) 처리 ──────────────────────────────────────

describe('falseSuccessScore — text 없는 이벤트', () => {
  test('tool_use 이벤트는 패턴 없음으로 처리 (점수 0 기여)', () => {
    const sessionId = 'sess-tool-neutral'
    const events: StoredEvent[] = [
      makeToolEvent('uuid-t-0', sessionId, 1000),
      makeToolEvent('uuid-t-1', sessionId, 1100), // anchor
      makeToolEvent('uuid-t-2', sessionId, 1200),
    ]
    const score = falseSuccessScore(events, 'uuid-t-1', 5)
    expect(score).toBe(0)
  })

  test('혼합 윈도: 패턴 텍스트 + tool_use → score는 패턴 이벤트 비율', () => {
    const sessionId = 'sess-mixed'
    const events: StoredEvent[] = [
      makeToolEvent('uuid-m-0', sessionId, 1000),                            // tool, 패턴 없음
      makeTextEvent('uuid-m-1', sessionId, 1100, '작업이 완료되었습니다.'), // text, 패턴
      makeToolEvent('uuid-m-2', sessionId, 1200),                            // anchor, tool
      makeTextEvent('uuid-m-3', sessionId, 1300, '다음 단계입니다.'),        // text, 중립
      makeToolEvent('uuid-m-4', sessionId, 1400),                            // tool, 패턴 없음
    ]
    // anchor=uuid-m-2, k=2 → 윈도=[uuid-m-0..uuid-m-4] (5개)
    // 패턴 있는 이벤트: uuid-m-1 (1개) → 1/5 = 0.2
    const score = falseSuccessScore(events, 'uuid-m-2', 2)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeCloseTo(0.2, 5)
  })
})

// ─── 7. 반환값 0~1 범위 보장 ─────────────────────────────────────────────────

describe('falseSuccessScore — 반환값 범위', () => {
  test('반환값은 숫자 타입이다', () => {
    const events: StoredEvent[] = [
      makeTextEvent('uuid-type-0', 'sess-type', 1000, '작업이 완료되었습니다.'),
    ]
    const score = falseSuccessScore(events, 'uuid-type-0', 5)
    expect(typeof score).toBe('number')
  })

  test('반환값은 0 이상이다', () => {
    const events: StoredEvent[] = [
      makeTextEvent('uuid-range-0', 'sess-range', 1000, '중립 문장입니다.'),
    ]
    const score = falseSuccessScore(events, 'uuid-range-0', 5)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  test('반환값은 1 이하이다', () => {
    const events: StoredEvent[] = FALSE_SUCCESS_TEXTS.map((text, i) =>
      makeTextEvent(`uuid-max-${i}`, 'sess-max', 1000 + i * 100, text),
    )
    const score = falseSuccessScore(events, events[2]!.uuid, 5)
    expect(score).toBeLessThanOrEqual(1)
  })

  test('다양한 k 값에서 항상 0~1 범위 유지', () => {
    const events: StoredEvent[] = [
      ...NEUTRAL_TEXTS.map((text, i) =>
        makeTextEvent(`uuid-kvar-n-${i}`, 'sess-kvar', 1000 + i * 100, text),
      ),
      ...FALSE_SUCCESS_TEXTS.map((text, i) =>
        makeTextEvent(`uuid-kvar-p-${i}`, 'sess-kvar', 2000 + i * 100, text),
      ),
    ]
    const anchorUuid = events[4]!.uuid
    for (const k of [0, 1, 3, 5, 10, 100]) {
      const score = falseSuccessScore(events, anchorUuid, k)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })
})

// ─── 8. 전체 윈도 패턴 → 1.0 반환 ────────────────────────────────────────────

describe('falseSuccessScore — 전체 패턴', () => {
  test('윈도 내 모든 이벤트에 패턴 있으면 1.0 반환', () => {
    const sessionId = 'sess-all-pattern'
    // k=1이면 윈도=[0..2] (3개), 전부 패턴
    const events: StoredEvent[] = [
      makeTextEvent('uuid-ap-0', sessionId, 1000, '작업이 완료되었습니다.'),   // 패턴
      makeTextEvent('uuid-ap-1', sessionId, 1100, '내가 확인한 결과 정상입니다.'), // anchor + 패턴
      makeTextEvent('uuid-ap-2', sessionId, 1200, '성공적으로 처리됨.'),        // 패턴
    ]
    const score = falseSuccessScore(events, 'uuid-ap-1', 1)
    expect(score).toBe(1.0)
  })

  test('단일 이벤트 윈도(k=0)에 패턴 → 1.0 반환', () => {
    const events: StoredEvent[] = [
      makeTextEvent('uuid-single', 'sess-single', 1000, '마쳤습니다.'),
    ]
    const score = falseSuccessScore(events, 'uuid-single', 0)
    expect(score).toBe(1.0)
  })
})
