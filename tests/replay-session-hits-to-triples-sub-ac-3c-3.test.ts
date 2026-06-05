// tests/replay-session-hits-to-triples-sub-ac-3c-3.test.ts
//
// Sub-AC 3c-3: 구조 신호 히트 목록에 hitsToTriples를 적용해
// 트리플 배열을 반환하는 단계 단위 테스트.
//
// 검증 목표:
//   - 합성 히트 픽스처 입력에 대해 결정론적으로 동일한 트리플 배열을 반환
//   - 동일 입력으로 두 번 호출 → 결과 동일 (결정론 보장)
//   - hits.length === triples.length 항상 유지 (runM3Pipeline 길이 계약)
//   - 빈 windowRefs hit → 빈 triples 포함 (excludeEmpty=false)
//   - excludeEmpty=true 시 빈 triples hit 제외 + excludedEmptyCount 정확
//   - tool_use 이벤트 → triples에 포함, 비-tool_use → triples에서 제외
//   - 여러 히트의 트리플 순서 보존
//   - events에 없는 UUID → 조용히 건너뜀 (empty triples)
//
// 제약:
//   - 실경로(~/.claude 등) 리터럴 없음
//   - @anthropic-ai/sdk 없음
//   - FS/API/DB 접근 없음 — 합성 픽스처 + 인메모리만 사용

import { applyHitsToTriples } from '../src/eval/replay-session.js'
import type { DetectionHit } from '../src/detect/detection-pipeline.js'
import type { StoredEvent } from '../src/ingest/event-store.js'
import type { StructureGateResult } from '../src/contracts.js'

// ─── 합성 픽스처 헬퍼 ──────────────────────────────────────────────────────────

const SESSION_ID = 'test-session-3c3'

/** 합성 StoredEvent 생성 헬퍼 */
function makeStoredEvent(
  uuid: string,
  opts: {
    tool?: string
    kind?: 'tool_use' | 'user' | 'assistant' | 'tool_result'
    filePath?: string
  } = {},
): StoredEvent {
  const kind = opts.tool !== undefined ? 'tool_use' : (opts.kind ?? 'user')
  return {
    uuid,
    parentUuid: null,
    sessionId: SESSION_ID,
    cwd: '/synthetic/proj',
    agentScope: 'root',
    isSidechain: false,
    ts: 1_700_000_000_000 + parseInt(uuid.slice(-2) || '0', 16),
    byteOffset: 0,
    kind,
    tool: opts.tool,
    input:
      opts.tool !== undefined
        ? {
            file_path: opts.filePath ?? `/proj/file-${uuid}.ts`,
            old_string: 'before',
            new_string: 'after',
          }
        : undefined,
    parseOk: true,
    ingestedAt: 1_700_000_000_000,
  }
}

/** 合성 DetectionHit 생성 헬퍼 */
function makeHit(
  windowRefs: string[],
  triggerUuid = 'trigger-default',
  type: StructureGateResult['type'] = 'thrashing',
): DetectionHit {
  const gate: StructureGateResult = {
    sessionId: SESSION_ID,
    agentScope: 'root',
    type,
    subtype: 'edit_repeat',
    severity: 'warning',
    metrics: { editRepeat: windowRefs.length },
    windowRefs,
  }
  return {
    gate,
    triggerUuid,
    ts: 1_700_000_000_000,
  }
}

// ─── 테스트 스위트 ─────────────────────────────────────────────────────────────

describe('applyHitsToTriples (Sub-AC 3c-3)', () => {
  // ── 기본 케이스: tool_use 이벤트가 트리플로 변환됨 ─────────────────────────
  test('tool_use 이벤트가 포함된 hit → triples에 ActionTriple 포함', async () => {
    const ev1 = makeStoredEvent('ev-01', { tool: 'Edit' })
    const ev2 = makeStoredEvent('ev-02', { tool: 'Edit' })
    const hit = makeHit(['ev-01', 'ev-02'], 'trigger-01')

    const result = await applyHitsToTriples([hit], [ev1, ev2])

    expect(result.hits).toHaveLength(1)
    expect(result.triples).toHaveLength(1)
    expect(result.triples[0]).toHaveLength(2)
    expect(result.triples[0]![0]!.tool).toBe('Edit')
    expect(result.triples[0]![1]!.tool).toBe('Edit')
    expect(result.excludedEmptyCount).toBe(0)
  })

  // ── 결정론 보장: 동일 입력으로 두 번 호출 → 동일 결과 ───────────────────────
  test('동일 합성 히트 픽스처 입력으로 두 번 호출 → 동일 트리플 배열 반환 (결정론)', async () => {
    const ev1 = makeStoredEvent('ev-10', { tool: 'Edit', filePath: '/proj/a.ts' })
    const ev2 = makeStoredEvent('ev-11', { tool: 'Bash' })
    const hit = makeHit(['ev-10', 'ev-11'], 'trigger-10')

    const result1 = await applyHitsToTriples([hit], [ev1, ev2])
    const result2 = await applyHitsToTriples([hit], [ev1, ev2])

    // 같은 수의 히트/트리플
    expect(result1.hits.length).toBe(result2.hits.length)
    expect(result1.triples.length).toBe(result2.triples.length)
    expect(result1.triples[0]!.length).toBe(result2.triples[0]!.length)

    // 각 트리플의 tool과 argKey가 동일
    for (let i = 0; i < result1.triples[0]!.length; i++) {
      expect(result1.triples[0]![i]!.tool).toBe(result2.triples[0]![i]!.tool)
      expect(result1.triples[0]![i]!.argKey).toBe(result2.triples[0]![i]!.argKey)
    }
  })

  // ── 빈 hits 배열 → 빈 결과 ──────────────────────────────────────────────────
  test('빈 hits 배열 → hits/triples 모두 빈 배열, excludedEmptyCount=0', async () => {
    const result = await applyHitsToTriples([], [])

    expect(result.hits).toHaveLength(0)
    expect(result.triples).toHaveLength(0)
    expect(result.excludedEmptyCount).toBe(0)
  })

  // ── 길이 계약: hits.length === triples.length ────────────────────────────────
  test('hits.length === triples.length 항상 유지 (runM3Pipeline 길이 계약)', async () => {
    const evA = makeStoredEvent('ev-a0', { tool: 'Edit' })
    const evB = makeStoredEvent('ev-b0', { kind: 'user' })  // 비-tool_use
    const evC = makeStoredEvent('ev-c0', { tool: 'Bash' })

    const hitA = makeHit(['ev-a0'], 'trigger-a')
    const hitB = makeHit(['ev-b0'], 'trigger-b')
    const hitC = makeHit(['ev-c0'], 'trigger-c')

    const result = await applyHitsToTriples([hitA, hitB, hitC], [evA, evB, evC])

    expect(result.hits.length).toBe(result.triples.length)
    expect(result.hits.length).toBe(3)
  })

  // ── 비-tool_use 이벤트 → 해당 hit의 triples는 빈 배열 ─────────────────────
  test('비-tool_use 이벤트만 참조하는 hit → triples[i]는 빈 배열', async () => {
    const userEv = makeStoredEvent('ev-user', { kind: 'user' })
    const hit = makeHit(['ev-user'], 'trigger-user')

    const result = await applyHitsToTriples([hit], [userEv], false)

    expect(result.hits).toHaveLength(1)
    expect(result.triples).toHaveLength(1)
    expect(result.triples[0]).toHaveLength(0)
    expect(result.excludedEmptyCount).toBe(0)
  })

  // ── excludeEmpty=true: 빈 triples hit 제외 + excludedEmptyCount 정확 ────────
  test('excludeEmpty=true → 빈 triples hit 제외, excludedEmptyCount 정확', async () => {
    const evTool = makeStoredEvent('ev-t1', { tool: 'Edit' })
    const evUser = makeStoredEvent('ev-u1', { kind: 'user' })

    const hitWithTriples = makeHit(['ev-t1'], 'trigger-t')
    const hitEmpty = makeHit(['ev-u1'], 'trigger-u')

    const result = await applyHitsToTriples(
      [hitWithTriples, hitEmpty],
      [evTool, evUser],
      true,
    )

    // hitEmpty 제외됨
    expect(result.hits).toHaveLength(1)
    expect(result.triples).toHaveLength(1)
    expect(result.hits[0]).toBe(hitWithTriples)
    expect(result.triples[0]).toHaveLength(1)
    expect(result.excludedEmptyCount).toBe(1)
    // 길이 계약 유지
    expect(result.hits.length).toBe(result.triples.length)
  })

  // ── excludeEmpty=false(기본값): 빈 triples hit 유지 ─────────────────────────
  test('excludeEmpty=false(기본) → 빈 triples hit 유지, excludedEmptyCount=0', async () => {
    const evUser = makeStoredEvent('ev-u2', { kind: 'user' })
    const hit = makeHit(['ev-u2'], 'trigger-u2')

    const result = await applyHitsToTriples([hit], [evUser])

    expect(result.hits).toHaveLength(1)
    expect(result.triples).toHaveLength(1)
    expect(result.triples[0]).toHaveLength(0)
    expect(result.excludedEmptyCount).toBe(0)
  })

  // ── 다중 히트 순서 보존 ──────────────────────────────────────────────────────
  test('다중 히트 순서 보존 — hits[i]와 triples[i]가 동일 인덱스 대응', async () => {
    const evEdit = makeStoredEvent('ev-edit', { tool: 'Edit', filePath: '/p/x.ts' })
    const evBash = makeStoredEvent('ev-bash', { tool: 'Bash' })
    const evRead = makeStoredEvent('ev-read', { tool: 'Read', filePath: '/p/y.ts' })

    const hitEdit = makeHit(['ev-edit'], 'trigger-edit')
    const hitBash = makeHit(['ev-bash'], 'trigger-bash')
    const hitRead = makeHit(['ev-read'], 'trigger-read')

    const result = await applyHitsToTriples(
      [hitEdit, hitBash, hitRead],
      [evEdit, evBash, evRead],
    )

    expect(result.hits[0]).toBe(hitEdit)
    expect(result.hits[1]).toBe(hitBash)
    expect(result.hits[2]).toBe(hitRead)

    expect(result.triples[0]![0]!.tool).toBe('Edit')
    expect(result.triples[1]![0]!.tool).toBe('Bash')
    expect(result.triples[2]![0]!.tool).toBe('Read')
  })

  // ── events에 없는 UUID → 조용히 건너뜀 → 빈 triples ────────────────────────
  test('events에 없는 UUID 참조 hit → 빈 triples, 에러 없음', async () => {
    const hit = makeHit(['unknown-uuid-x', 'unknown-uuid-y'], 'trigger-unknown')

    const result = await applyHitsToTriples([hit], [])

    expect(result.hits).toHaveLength(1)
    expect(result.triples).toHaveLength(1)
    expect(result.triples[0]).toHaveLength(0)
    expect(result.excludedEmptyCount).toBe(0)
  })

  // ── 빈 windowRefs hit → 빈 triples ──────────────────────────────────────────
  test('빈 windowRefs hit → triples[0]은 빈 배열', async () => {
    const hit = makeHit([], 'trigger-empty-refs')

    const result = await applyHitsToTriples([hit], [])

    expect(result.hits).toHaveLength(1)
    expect(result.triples[0]).toHaveLength(0)
  })

  // ── false_success 타입 히트도 동일하게 처리 ──────────────────────────────────
  test('false_success 타입 hit도 동일하게 hitsToTriples 처리', async () => {
    const ev = makeStoredEvent('ev-fs', { tool: 'Bash' })
    const hit = makeHit(['ev-fs'], 'anchor-fs', 'false_success')

    const result = await applyHitsToTriples([hit], [ev])

    expect(result.hits).toHaveLength(1)
    expect(result.triples[0]).toHaveLength(1)
    expect(result.triples[0]![0]!.tool).toBe('Bash')
  })

  // ── excludeEmpty=true 모두 비어있으면 전부 제외 ──────────────────────────────
  test('excludeEmpty=true + 모든 hit의 triples가 빈 경우 → 전부 제외', async () => {
    const evUser1 = makeStoredEvent('ev-u3', { kind: 'user' })
    const evUser2 = makeStoredEvent('ev-u4', { kind: 'user' })

    const hit1 = makeHit(['ev-u3'], 'trigger-u3')
    const hit2 = makeHit(['ev-u4'], 'trigger-u4')

    const result = await applyHitsToTriples([hit1, hit2], [evUser1, evUser2], true)

    expect(result.hits).toHaveLength(0)
    expect(result.triples).toHaveLength(0)
    expect(result.excludedEmptyCount).toBe(2)
  })

  // ── argKey 결정론: 동일 Edit 이벤트 → argKey 항상 동일 ─────────────────────
  test('동일 Edit 이벤트 → 두 번 호출에서 argKey 항상 동일 (결정론적 argKey)', async () => {
    const ev = makeStoredEvent('ev-det', {
      tool: 'Edit',
      filePath: '/proj/deterministic.ts',
    })
    const hit = makeHit(['ev-det'], 'trigger-det')

    const r1 = await applyHitsToTriples([hit], [ev])
    const r2 = await applyHitsToTriples([hit], [ev])

    const argKey1 = r1.triples[0]![0]!.argKey
    const argKey2 = r2.triples[0]![0]!.argKey

    expect(argKey1).toBe(argKey2)
    expect(typeof argKey1).toBe('string')
    expect(argKey1.length).toBeGreaterThan(0)
  })
})
