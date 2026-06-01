/**
 * tests/majority-vote-sub-ac-4d.test.ts
 *
 * Sub-AC 4d: `majorityVote(samples: RawSample[]): JudgeVerdict`
 *   - position-swap 쌍을 포함한 N개 샘플에서 다수결로 JudgeVerdict를 산출한다
 *   - rawSamples에 입력 전체를 보존한다 (감사용, SPEC §5)
 *
 * SPEC §5: position swap + self-consistency 편향완화.
 *   다수결 kind 선택, 동수 시 우선순위(thrashing > false_success > none),
 *   winning samples의 confidence 평균, rawSamples 전체 보존.
 *
 * 외부 API 절대 미호출 — 순수 함수, 네트워크·API 키 불필요.
 * BLOCKER C1: kind는 'thrashing' | 'false_success' | 'none'.
 * BLOCKER C2: JudgeVerdict는 contracts.ts 정본.
 */

import { majorityVote, type RawSample } from '../src/detect/semantic-stage.js'
import type { JudgeVerdict } from '../src/contracts.js'

// ── 테스트 픽스처 ──────────────────────────────────────────────────────────────

function makeSample(
  kind: JudgeVerdict['kind'],
  opts: Partial<Omit<JudgeVerdict, 'kind'>> = {},
): RawSample {
  return {
    kind,
    subtype: opts.subtype ?? `subtype-${kind}`,
    confidence: opts.confidence ?? 0.8,
    reason: opts.reason ?? `reason-${kind}`,
    rawSamples: opts.rawSamples ?? [],
    ...(opts.topicDivergence !== undefined ? { topicDivergence: opts.topicDivergence } : {}),
    ...(opts.circularReference !== undefined ? { circularReference: opts.circularReference } : {}),
  }
}

// ── 빈 배열 엣지케이스 ─────────────────────────────────────────────────────────

describe('majorityVote — 빈 배열 입력', () => {
  test('빈 배열이면 kind=none, confidence=0, rawSamples=[]를 반환한다', () => {
    const result = majorityVote([])

    expect(result.kind).toBe('none')
    expect(result.confidence).toBe(0)
    expect(result.rawSamples).toEqual([])
  })

  test('빈 배열 결과도 JudgeVerdict 계약을 준수한다 (BLOCKER C1/C2)', () => {
    const result = majorityVote([])

    expect(typeof result.kind).toBe('string')
    expect(['thrashing', 'false_success', 'none']).toContain(result.kind)
    expect(typeof result.subtype).toBe('string')
    expect(typeof result.confidence).toBe('number')
    expect(typeof result.reason).toBe('string')
    expect(Array.isArray(result.rawSamples)).toBe(true)
  })
})

// ── 단일 샘플 ─────────────────────────────────────────────────────────────────

describe('majorityVote — 단일 샘플', () => {
  test('샘플 1개이면 그 sample의 kind·subtype·reason을 반환한다', () => {
    const sample = makeSample('thrashing', {
      subtype: 'stuck_error_loop',
      confidence: 0.9,
      reason: '에러 루프 감지',
    })
    const result = majorityVote([sample])

    expect(result.kind).toBe('thrashing')
    expect(result.subtype).toBe('stuck_error_loop')
    expect(result.confidence).toBeCloseTo(0.9)
    expect(result.reason).toBe('에러 루프 감지')
  })

  test('단일 샘플의 rawSamples에 해당 sample이 포함된다', () => {
    const sample = makeSample('false_success', { confidence: 0.75 })
    const result = majorityVote([sample])

    expect(result.rawSamples).toHaveLength(1)
    expect(result.rawSamples[0]).toBe(sample)
  })
})

// ── 명확한 다수결 (clear majority) ────────────────────────────────────────────

describe('majorityVote — 명확한 다수결', () => {
  test('3개 중 2개가 thrashing이면 thrashing을 반환한다', () => {
    const samples: RawSample[] = [
      makeSample('thrashing', { confidence: 0.9 }),
      makeSample('thrashing', { confidence: 0.8 }),
      makeSample('none', { confidence: 0.1 }),
    ]
    const result = majorityVote(samples)

    expect(result.kind).toBe('thrashing')
  })

  test('3개 중 2개가 false_success이면 false_success를 반환한다', () => {
    const samples: RawSample[] = [
      makeSample('false_success', { confidence: 0.92 }),
      makeSample('false_success', { confidence: 0.88 }),
      makeSample('thrashing', { confidence: 0.5 }),
    ]
    const result = majorityVote(samples)

    expect(result.kind).toBe('false_success')
  })

  test('5개 중 4개가 none이면 none을 반환한다', () => {
    const samples: RawSample[] = [
      makeSample('none', { confidence: 0.05 }),
      makeSample('none', { confidence: 0.1 }),
      makeSample('none', { confidence: 0.08 }),
      makeSample('none', { confidence: 0.07 }),
      makeSample('thrashing', { confidence: 0.6 }),
    ]
    const result = majorityVote(samples)

    expect(result.kind).toBe('none')
  })
})

// ── position-swap 쌍 시나리오 (SPEC §5 핵심) ──────────────────────────────────

describe('majorityVote — position-swap 쌍 (SPEC §5 편향완화)', () => {
  test('position-swap 쌍 2개 + self-consistency 1개 = 3개에서 다수결이 동작한다', () => {
    // 시나리오: AB순서 → thrashing, BA순서 → thrashing, 추가샘플 → none
    // 다수결: thrashing(2) > none(1) → thrashing
    const sampleAB = makeSample('thrashing', { confidence: 0.85, subtype: 'ab_order' })
    const sampleBA = makeSample('thrashing', { confidence: 0.80, subtype: 'ba_order' })
    const sampleExtra = makeSample('none', { confidence: 0.1 })
    const result = majorityVote([sampleAB, sampleBA, sampleExtra])

    expect(result.kind).toBe('thrashing')
    expect(result.rawSamples).toHaveLength(3)
  })

  test('position-swap 쌍이 의견 불일치할 때 나머지 샘플이 결정한다', () => {
    // AB → thrashing, BA → none (위치 편향 불일치)
    // self-consistency 3개 모두 thrashing → 다수결: thrashing(4) > none(1)
    const sampleAB = makeSample('thrashing', { confidence: 0.8 })
    const sampleBA = makeSample('none', { confidence: 0.1 })
    const sc1 = makeSample('thrashing', { confidence: 0.85 })
    const sc2 = makeSample('thrashing', { confidence: 0.82 })
    const sc3 = makeSample('thrashing', { confidence: 0.78 })
    const result = majorityVote([sampleAB, sampleBA, sc1, sc2, sc3])

    expect(result.kind).toBe('thrashing')
    expect(result.rawSamples).toHaveLength(5)
  })

  test('position-swap 2개가 불일치하고 나머지도 1:1이면 우선순위 규칙 적용', () => {
    // thrashing: 2표, none: 2표 → 동수 → thrashing 우선
    const samples: RawSample[] = [
      makeSample('thrashing', { confidence: 0.7 }),
      makeSample('none', { confidence: 0.3 }),
      makeSample('thrashing', { confidence: 0.75 }),
      makeSample('none', { confidence: 0.2 }),
    ]
    const result = majorityVote(samples)

    expect(result.kind).toBe('thrashing')
  })
})

// ── 동수(tie) 우선순위: thrashing > false_success > none ─────────────────────

describe('majorityVote — 동수(tie) 우선순위 규칙', () => {
  test('thrashing과 false_success 동수 → thrashing 선택', () => {
    const samples: RawSample[] = [
      makeSample('thrashing', { confidence: 0.7 }),
      makeSample('false_success', { confidence: 0.75 }),
    ]
    const result = majorityVote(samples)

    expect(result.kind).toBe('thrashing')
  })

  test('thrashing과 none 동수 → thrashing 선택', () => {
    const samples: RawSample[] = [
      makeSample('thrashing', { confidence: 0.6 }),
      makeSample('none', { confidence: 0.4 }),
    ]
    const result = majorityVote(samples)

    expect(result.kind).toBe('thrashing')
  })

  test('false_success와 none 동수 → false_success 선택', () => {
    const samples: RawSample[] = [
      makeSample('false_success', { confidence: 0.65 }),
      makeSample('none', { confidence: 0.35 }),
    ]
    const result = majorityVote(samples)

    expect(result.kind).toBe('false_success')
  })

  test('3종류 모두 동수(1:1:1) → thrashing 선택', () => {
    const samples: RawSample[] = [
      makeSample('thrashing', { confidence: 0.8 }),
      makeSample('false_success', { confidence: 0.7 }),
      makeSample('none', { confidence: 0.1 }),
    ]
    const result = majorityVote(samples)

    expect(result.kind).toBe('thrashing')
  })
})

// ── confidence 평균 계산 ──────────────────────────────────────────────────────

describe('majorityVote — winning samples의 confidence 평균', () => {
  test('thrashing 2개의 confidence 평균을 반환한다', () => {
    const samples: RawSample[] = [
      makeSample('thrashing', { confidence: 0.8 }),
      makeSample('thrashing', { confidence: 0.6 }),
      makeSample('none', { confidence: 0.1 }),
    ]
    const result = majorityVote(samples)

    expect(result.confidence).toBeCloseTo(0.7) // (0.8 + 0.6) / 2
  })

  test('단일 winning sample이면 그 confidence를 그대로 반환한다', () => {
    const samples: RawSample[] = [
      makeSample('false_success', { confidence: 0.93 }),
      makeSample('none', { confidence: 0.05 }),
    ]
    const result = majorityVote(samples)

    expect(result.confidence).toBeCloseTo(0.93)
  })

  test('3개 winning sample의 confidence 평균 계산', () => {
    const samples: RawSample[] = [
      makeSample('thrashing', { confidence: 0.9 }),
      makeSample('thrashing', { confidence: 0.7 }),
      makeSample('thrashing', { confidence: 0.8 }),
    ]
    const result = majorityVote(samples)

    expect(result.confidence).toBeCloseTo(0.8) // (0.9+0.7+0.8)/3
  })
})

// ── rawSamples 보존 (감사용, SPEC §5 핵심) ────────────────────────────────────

describe('majorityVote — rawSamples 보존 (SPEC §5)', () => {
  test('반환된 rawSamples에 입력 samples 전체가 보존된다', () => {
    const s1 = makeSample('thrashing', { confidence: 0.9 })
    const s2 = makeSample('thrashing', { confidence: 0.8 })
    const s3 = makeSample('none', { confidence: 0.1 })
    const result = majorityVote([s1, s2, s3])

    expect(result.rawSamples).toHaveLength(3)
    expect(result.rawSamples[0]).toBe(s1)
    expect(result.rawSamples[1]).toBe(s2)
    expect(result.rawSamples[2]).toBe(s3)
  })

  test('rawSamples는 입력 순서를 보존한다', () => {
    const samples: RawSample[] = [
      makeSample('none', { confidence: 0.1 }),
      makeSample('thrashing', { confidence: 0.9 }),
      makeSample('false_success', { confidence: 0.8 }),
    ]
    const result = majorityVote(samples)

    // 순서 보존 검증
    expect((result.rawSamples[0] as RawSample).kind).toBe('none')
    expect((result.rawSamples[1] as RawSample).kind).toBe('thrashing')
    expect((result.rawSamples[2] as RawSample).kind).toBe('false_success')
  })

  test('minority kind 샘플도 rawSamples에 포함된다 (감사용)', () => {
    const minority = makeSample('none', { confidence: 0.05 })
    const maj1 = makeSample('thrashing', { confidence: 0.9 })
    const maj2 = makeSample('thrashing', { confidence: 0.85 })
    const result = majorityVote([maj1, minority, maj2])

    expect(result.kind).toBe('thrashing')
    // minority sample도 rawSamples에 보존됨
    expect(result.rawSamples).toHaveLength(3)
    expect(result.rawSamples).toContain(minority)
  })

  test('N=5 position-swap+self-consistency 시나리오: rawSamples 길이 = 5', () => {
    const samples: RawSample[] = Array.from({ length: 5 }, (_, i) =>
      makeSample(i < 3 ? 'thrashing' : 'none', { confidence: 0.8 - i * 0.1 }),
    )
    const result = majorityVote(samples)

    expect(result.rawSamples).toHaveLength(5)
  })
})

// ── 불변성: 입력 배열을 변경하지 않는다 ──────────────────────────────────────

describe('majorityVote — 입력 불변성', () => {
  test('majorityVote 호출 후 입력 배열이 변경되지 않는다', () => {
    const s1 = makeSample('thrashing', { confidence: 0.9 })
    const s2 = makeSample('none', { confidence: 0.1 })
    const input = [s1, s2]
    const originalLength = input.length

    majorityVote(input)

    expect(input).toHaveLength(originalLength)
    expect(input[0]).toBe(s1)
    expect(input[1]).toBe(s2)
  })

  test('Object.freeze된 배열에서도 동작한다', () => {
    const samples = Object.freeze([
      makeSample('false_success', { confidence: 0.88 }),
      makeSample('false_success', { confidence: 0.82 }),
      makeSample('none', { confidence: 0.1 }),
    ])
    const result = majorityVote(samples)

    expect(result.kind).toBe('false_success')
    expect(result.rawSamples).toHaveLength(3)
  })
})

// ── JudgeVerdict 계약 준수 (BLOCKER C1/C2) ───────────────────────────────────

describe('majorityVote — JudgeVerdict 계약 준수 (BLOCKER C1/C2)', () => {
  test("kind에 'fake_success'나 'fakeSuccess'가 나오지 않는다 (BLOCKER C1)", () => {
    const samples: RawSample[] = [
      makeSample('false_success', { confidence: 0.9 }),
      makeSample('thrashing', { confidence: 0.7 }),
    ]
    const result = majorityVote(samples)

    expect(result.kind).not.toBe('fake_success')
    expect(result.kind).not.toBe('fakeSuccess')
  })

  test('결과는 JudgeVerdict 필수 필드를 모두 포함한다 (BLOCKER C2)', () => {
    const samples: RawSample[] = [
      makeSample('thrashing', { confidence: 0.85 }),
      makeSample('thrashing', { confidence: 0.80 }),
    ]
    const result = majorityVote(samples)

    expect(typeof result.kind).toBe('string')
    expect(['thrashing', 'false_success', 'none']).toContain(result.kind)
    expect(typeof result.subtype).toBe('string')
    expect(typeof result.confidence).toBe('number')
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(typeof result.reason).toBe('string')
    expect(Array.isArray(result.rawSamples)).toBe(true)
  })

  test('confidence는 항상 [0, 1] 범위 내에 있다', () => {
    const samples: RawSample[] = [
      makeSample('thrashing', { confidence: 1.0 }),
      makeSample('thrashing', { confidence: 0.0 }),
    ]
    const result = majorityVote(samples)

    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })
})

// ── 대표값(subtype/reason) 선택 ───────────────────────────────────────────────

describe('majorityVote — 대표값(subtype/reason) 선택', () => {
  test('winning kind의 첫 번째 sample subtype/reason을 대표값으로 사용한다', () => {
    const first = makeSample('thrashing', {
      subtype: 'first_winner',
      reason: '첫 번째 winning 이유',
      confidence: 0.9,
    })
    const second = makeSample('thrashing', {
      subtype: 'second_winner',
      reason: '두 번째 winning 이유',
      confidence: 0.8,
    })
    const loser = makeSample('none', { confidence: 0.1 })
    const result = majorityVote([first, second, loser])

    expect(result.subtype).toBe('first_winner')
    expect(result.reason).toBe('첫 번째 winning 이유')
  })

  test('topicDivergence가 있는 첫 번째 winning sample의 값을 전파한다', () => {
    const sample = makeSample('false_success', {
      topicDivergence: 0.42,
      confidence: 0.88,
    })
    const result = majorityVote([sample])

    expect(result.topicDivergence).toBeCloseTo(0.42)
  })

  test('circularReference가 있는 첫 번째 winning sample의 값을 전파한다', () => {
    const sample = makeSample('thrashing', {
      circularReference: true,
      confidence: 0.77,
    })
    const result = majorityVote([sample])

    expect(result.circularReference).toBe(true)
  })
})

// ── 결정론 (determinism) ──────────────────────────────────────────────────────

describe('majorityVote — 결정론', () => {
  test('동일 입력을 여러 번 호출해도 항상 같은 kind를 반환한다', () => {
    const samples: RawSample[] = [
      makeSample('thrashing', { confidence: 0.9 }),
      makeSample('thrashing', { confidence: 0.8 }),
      makeSample('none', { confidence: 0.1 }),
    ]
    const results = Array.from({ length: 5 }, () => majorityVote(samples))

    for (const r of results) {
      expect(r.kind).toBe('thrashing')
    }
  })
})
