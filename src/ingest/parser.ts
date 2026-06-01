/**
 * src/ingest/parser.ts
 *
 * normalize(rawRecord) → NormalizedEvent
 * classifyResult(...)  → ResultClass
 * orderEvents(events)  → NormalizedEvent[]
 *
 * SPEC §4 탐지 파서 계약 + §1-1 정합화 패치노트(C5/classifyResult 우선순위/M5/정렬계약) 구현.
 *
 * 불변 원칙:
 *   - contracts.ts가 SSOT. NormalizedEvent/ResultClass/AgentScope를 그대로 사용.
 *   - classifyResult 우선순위: blocked > rejected > error > empty > ok > unknown
 *   - is_error는 선택키(53.7%만 존재) → 단일 신호 금지. 3채널 병행.
 *   - 알 수 없는 record type → kind='other' (중단 금지)
 *   - 버전 가드: top-level version 필드 확인, 미지 타입 허용
 *   - console.log 금지 (CLI 진입점 제외)
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { NormalizedEvent, ResultClass, AgentScope } from '../contracts.js'

// ============================================================
// § 원시 JSONL 레코드 스키마 (zod 검증)
// ============================================================

/**
 * Claude Code JSONL 공통 봉투.
 * 실측 확인된 키: type, uuid, parentUuid, timestamp, sessionId,
 *   cwd, gitBranch, version, isSidechain, message
 * SPEC §4 §0: version 필드 가드, unknown type 허용.
 */
const RawEnvelopeSchema = z.object({
  type: z.string(),
  uuid: z.string().optional(),
  parentUuid: z.string().nullable().optional(),
  timestamp: z.string().optional(),       // ISO 8601
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  version: z.number().optional(),
  isSidechain: z.boolean().optional(),
  message: z.unknown().optional(),
}).passthrough()

type RawEnvelope = z.infer<typeof RawEnvelopeSchema>

/** tool_use content 블록 */
const ToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().optional(),
  name: z.string(),
  input: z.unknown().optional(),
}).passthrough()

/** tool_result content 블록 */
const ToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string().optional(),
  content: z.union([
    z.string(),
    z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
  ]).optional(),
  is_error: z.boolean().optional(),
}).passthrough()

/** assistant/user message 봉투 */
const MessageSchema = z.object({
  role: z.string().optional(),
  content: z.union([
    z.string(),
    z.array(z.unknown()),
  ]).optional(),
  model: z.string().optional(),
  usage: z.unknown().optional(),
  stop_reason: z.string().optional(),
}).passthrough()

// ============================================================
// § 내부 헬퍼
// ============================================================

/** UUID 합성 (파서가 uuid 없는 레코드에 부여) */
function syntheticUuid(line: string, byteOffset: number): string {
  const h = createHash('sha256')
    .update(`${byteOffset}:${line}`)
    .digest('hex')
  return `synth-${h.slice(0, 16)}`
}

/** ISO timestamp → epoch ms. 파싱 실패 시 Date.now() */
function parseTimestamp(ts: string | undefined): number {
  if (!ts) return Date.now()
  const n = Date.parse(ts)
  return isNaN(n) ? Date.now() : n
}

/**
 * agentScope 도출.
 * SPEC §1 C5: isSidechain + 서브에이전트 경로에서 도출.
 * 서브에이전트 파일 경로 패턴: subagents/[id]/agent-*.jsonl
 * → 그 경로를 agentScope 식별자로 사용.
 * isSidechain=false + 서브에이전트 경로 없음 → 'root'
 */
function deriveAgentScope(
  isSidechain: boolean,
  sourcePath: string | undefined,
): AgentScope {
  if (!isSidechain && !sourcePath) return 'root'
  // 서브에이전트 경로에서 agent-id 추출
  if (sourcePath) {
    const match = /subagents[/\\](.+?)[/\\]agent-[^/\\]+\.jsonl$/.exec(sourcePath)
    if (match) return match[1] ?? sourcePath
    // isSidechain이지만 경로 없으면 sidechain 표시
    if (isSidechain) return `sidechain:${sourcePath}`
  }
  return isSidechain ? 'sidechain' : 'root'
}

/**
 * content 배열 또는 문자열에서 텍스트 추출.
 * tool_result.content 형식 지원.
 */
function extractText(
  content: unknown,
): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as Record<string, unknown>)['text'] ?? '')
        }
        return ''
      })
      .join('')
  }
  return ''
}

// ============================================================
// § classifyResult
// ============================================================

/**
 * ResultClass 분류.
 *
 * SPEC §1-1 C5 + §4 §1a classifyResult 우선순위:
 *   blocked(hook deny) > rejected(perm 거부)
 *   > error(is_error || toolUseResult.error || isApiErrorMessage)
 *   > empty(빈 tool_result) > ok > unknown
 *
 * is_error는 선택적 키(53.7%만 존재) → 단일 신호 금지. 3채널 병행.
 *
 * @param toolResultBlock  tool_result content 블록 (zod 파싱 전 raw)
 * @param toolUseResult    toolUseResult 사이드카 (optional)
 * @param asstMeta         assistant 메시지 메타 (optional)
 */
export function classifyResult(
  toolResultBlock: unknown,
  toolUseResult?: unknown,
  _asstMeta?: unknown,
): ResultClass {
  const block = ToolResultBlockSchema.safeParse(toolResultBlock)
  const content = block.success ? block.data.content : undefined
  const isError = block.success ? block.data.is_error : undefined
  const text = extractText(content)

  // 채널 1: 명시적 is_error 키 (존재할 때만 신뢰)
  // 채널 2: <tool_use_error> 래퍼 텍스트
  // 채널 3: toolUseResult 사이드카의 isApiErrorMessage

  // ① blocked: "Blocked" 키워드 (hook deny)
  if (isError === true && /\bBlocked\b/.test(text)) return 'blocked'
  if (/<tool_use_error>/.test(text) && /\bBlocked\b/.test(text)) return 'blocked'

  // ② rejected: permission 거부
  if (isError === true && /\brejected\b/i.test(text)) return 'rejected'
  if (/<tool_use_error>/.test(text) && /\brejected\b/i.test(text)) return 'rejected'

  // ③ error: is_error || <tool_use_error> 래퍼 || sidecar.isApiErrorMessage
  if (isError === true) return 'error'
  if (/<tool_use_error>/.test(text)) return 'error'

  // 채널 3 (isApiErrorMessage 사이드카): rejected 우선 확인 후 error 폴백
  // SPEC §4 §1a + Sub-AC 2b: rejected(perm 거부) > error 우선순위 준수
  // isApiErrorMessage=true + "rejected" 텍스트 → API-level rejection → 'rejected'
  // isApiErrorMessage=true + 그 외 → generic API error → 'error'
  if (
    toolUseResult !== undefined &&
    toolUseResult !== null &&
    typeof toolUseResult === 'object' &&
    'isApiErrorMessage' in toolUseResult &&
    (toolUseResult as Record<string, unknown>)['isApiErrorMessage'] === true
  ) {
    if (/\brejected\b/i.test(text)) return 'rejected'
    return 'error'
  }

  // ④ empty: tool_result 블록이 파싱 성공했고 content가 비어 있음
  // block.success가 false이면 unknown으로 폴백 (툴 결과 블록 자체가 없는 경우)
  if (!block.success) return 'unknown'
  if (text.trim() === '') return 'empty'
  if (/\b0\s+(results|matches)\b/.test(text)) return 'empty'

  // ⑤ ok: is_error 키 없음 + 내용 있음
  if (isError === undefined && text.length > 0) return 'ok'

  // ⑥ fallback
  return 'unknown'
}

// ============================================================
// § KIND 도출
// ============================================================

type EventKind = NormalizedEvent['kind']

/** JSONL type 문자열 → NormalizedEvent.kind 매핑 */
function deriveKind(
  rawType: string,
  role?: string,
  contentBlocks?: unknown[],
): EventKind {
  switch (rawType) {
    case 'user':        return 'user'
    case 'assistant':   return 'assistant'
    case 'system':      return 'system'
    case 'attachment':  return 'attachment'
    default:
      // role 기반 추론
      if (role === 'user')      return 'user'
      if (role === 'assistant') return 'assistant'
      // content 블록 타입 기반 추론
      if (Array.isArray(contentBlocks)) {
        for (const blk of contentBlocks) {
          if (blk && typeof blk === 'object' && 'type' in blk) {
            const t = (blk as Record<string, unknown>)['type']
            if (t === 'tool_use')    return 'tool_use'
            if (t === 'tool_result') return 'tool_result'
          }
        }
      }
      // 알 수 없는 type → other (중단 금지, SPEC §2 §4 §6 버전 가드)
      return 'other'
  }
}

// ============================================================
// § normalize
// ============================================================

/**
 * normalize(rawRecord) → NormalizedEvent
 *
 * SPEC §4 §1a + §1-1 C5:
 *   - Claude Code JSONL 원시키 → contracts 컬럼명 매핑
 *   - cwd, agent_scope, is_sidechain, kind, tool, input_json, result_class
 *   - agentScope는 isSidechain + 서브에이전트 경로에서 도출
 *   - uuid 없으면 파서가 합성
 *   - 알 수 없는 record type → kind='other'
 *   - 버전 필드 가드 (미지 버전도 허용, 중단 금지)
 *
 * @param rawRecord  JSONL 한 줄을 JSON.parse한 객체 (unknown)
 * @param byteOffset 파일 내 바이트 오프셋 (정렬 3차 키)
 * @param sourcePath 파싱 출처 JSONL 절대경로 (agentScope 도출용)
 * @param rawLine    원본 라인 문자열 (uuid 합성용)
 */
export function normalize(
  rawRecord: unknown,
  byteOffset: number = 0,
  sourcePath?: string,
  rawLine?: string,
): NormalizedEvent {
  // zod 파싱 (실패해도 최대한 복원)
  const parsed = RawEnvelopeSchema.safeParse(rawRecord)
  const raw: RawEnvelope = parsed.success
    ? parsed.data
    : (typeof rawRecord === 'object' && rawRecord !== null
        ? (rawRecord as RawEnvelope)
        : {} as RawEnvelope)

  const uuid = raw.uuid ?? syntheticUuid(rawLine ?? JSON.stringify(rawRecord), byteOffset)
  const parentUuid = raw.parentUuid ?? null
  const sessionId = raw.sessionId ?? ''
  const cwd = raw.cwd ?? ''
  const isSidechain = raw.isSidechain ?? false
  const agentScope = deriveAgentScope(isSidechain, sourcePath)
  const ts = parseTimestamp(raw.timestamp)

  // message 분해
  const msgParsed = MessageSchema.safeParse(raw.message)
  const msg = msgParsed.success ? msgParsed.data : undefined
  const role = msg?.role
  const contentRaw = msg?.content

  // content blocks 배열 추출
  const contentBlocks: unknown[] = Array.isArray(contentRaw)
    ? contentRaw
    : (typeof contentRaw === 'string' ? [{ type: 'text', text: contentRaw }] : [])

  // kind 도출
  const kind = deriveKind(raw.type, role, contentBlocks)

  // tool_use 블록 추출
  let tool: string | undefined
  let input: unknown | undefined
  let toolUseId: string | undefined

  // tool_result 블록 추출
  let resultClass: ResultClass | undefined
  let toolUseIdResult: string | undefined

  // text 추출 (완료선언/메시지)
  let text: string | undefined
  let reasoning: string | undefined
  let systemSubtype: string | undefined
  let interruptedMessageId: string | undefined

  if (kind === 'system') {
    // system 이벤트
    const sysData = raw as unknown as Record<string, unknown>
    systemSubtype = typeof sysData['subtype'] === 'string' ? sysData['subtype'] : undefined
    if (typeof contentRaw === 'string') {
      text = contentRaw
    } else if (msg && typeof (msg as Record<string, unknown>)['content'] === 'string') {
      text = String((msg as Record<string, unknown>)['content'])
    }
  } else if (kind === 'user' || kind === 'assistant') {
    // content 블록들 순회
    for (const blk of contentBlocks) {
      if (!blk || typeof blk !== 'object') continue
      const b = blk as Record<string, unknown>
      const bType = b['type']

      if (bType === 'text' && typeof b['text'] === 'string') {
        text = (text ?? '') + b['text']
      } else if (bType === 'thinking' && typeof b['thinking'] === 'string') {
        reasoning = b['thinking'] as string
      } else if (bType === 'tool_use') {
        const tuParsed = ToolUseBlockSchema.safeParse(blk)
        if (tuParsed.success) {
          tool = tuParsed.data.name
          input = tuParsed.data.input
          toolUseId = tuParsed.data.id
        }
      } else if (bType === 'tool_result') {
        const trParsed = ToolResultBlockSchema.safeParse(blk)
        if (trParsed.success) {
          toolUseIdResult = trParsed.data.tool_use_id
          resultClass = classifyResult(blk)
        }
      }
    }
  } else if (kind === 'tool_use') {
    // 직접 tool_use record인 경우
    const tuParsed = ToolUseBlockSchema.safeParse(raw.message ?? rawRecord)
    if (tuParsed.success) {
      tool = tuParsed.data.name
      input = tuParsed.data.input
      toolUseId = tuParsed.data.id
    }
  } else if (kind === 'tool_result') {
    // 직접 tool_result record인 경우
    const trParsed = ToolResultBlockSchema.safeParse(raw.message ?? rawRecord)
    if (trParsed.success) {
      toolUseIdResult = trParsed.data.tool_use_id
      resultClass = classifyResult(raw.message ?? rawRecord)
    }
  }

  // stop_reason="interrupted" → interruptedMessageId
  if (msg && (msg as Record<string, unknown>)['stop_reason'] === 'interrupted') {
    interruptedMessageId = uuid
  }

  // tool_result 이면 toolUseId는 결과가 가리키는 tool_use의 id
  const finalToolUseId = kind === 'tool_result' ? toolUseIdResult : toolUseId

  const event: NormalizedEvent = {
    uuid,
    parentUuid,
    sessionId,
    cwd,
    agentScope,
    isSidechain,
    ts,
    byteOffset,
    kind,
  }

  // 선택 필드: undefined이면 포함하지 않음 (exactOptionalPropertyTypes=false이지만 일관성)
  if (tool !== undefined) event.tool = tool
  if (input !== undefined) event.input = input
  if (resultClass !== undefined) event.resultClass = resultClass
  if (finalToolUseId !== undefined) event.toolUseId = finalToolUseId
  if (text !== undefined) event.text = text
  if (reasoning !== undefined) event.reasoning = reasoning
  if (systemSubtype !== undefined) event.systemSubtype = systemSubtype
  if (interruptedMessageId !== undefined) event.interruptedMessageId = interruptedMessageId

  return event
}

// ============================================================
// § topoSortByParentUuid
// ============================================================

/**
 * topoSortByParentUuid(events) → NormalizedEvent[]
 *
 * parentUuid 관계에 기반한 위상 정렬 (topological sort).
 * 부모가 자식보다 항상 앞에 위치한다.
 *
 * 알고리즘:
 *   - 부모가 없거나(null) 부모가 입력 집합에 없는 노드 → 루트
 *   - Kahn's BFS: 루트부터 시작해 의존성 해소 순서로 확장
 *   - 동일 depth 내 순서는 byteOffset(파일 내 append 순서) 기준
 *   - 고아(부모가 집합 외부) 노드 → 독립 루트로 처리 (중단 금지)
 *   - 순환 참조(cycle) → 잔여 노드를 byteOffset 순서로 append (중단 금지)
 *
 * SPEC §1-1 정렬 계약 2차 키: parentUuid 위상순서 (부모 > 자식).
 * orderEvents()의 2차 정렬 기반으로 사용된다.
 *
 * @param events  정렬할 NormalizedEvent 배열 (입력 불변 — 복사본 반환)
 */
export function topoSortByParentUuid(events: readonly NormalizedEvent[]): NormalizedEvent[] {
  if (events.length === 0) return []

  // uuid → event 인덱스
  const byUuid = new Map<string, NormalizedEvent>()
  for (const ev of events) {
    byUuid.set(ev.uuid, ev)
  }

  // children map: parentUuid → child events (byteOffset 순 정렬)
  const children = new Map<string, NormalizedEvent[]>()
  // in-degree: uuid → 해소되지 않은 부모 수 (0 = 루트 or 고아)
  const inDegree = new Map<string, number>()

  for (const ev of events) {
    inDegree.set(ev.uuid, 0)
  }

  for (const ev of events) {
    const pid = ev.parentUuid
    if (pid !== null && byUuid.has(pid)) {
      // 유효한 부모-자식 관계
      const siblings = children.get(pid) ?? []
      siblings.push(ev)
      children.set(pid, siblings)
      inDegree.set(ev.uuid, (inDegree.get(ev.uuid) ?? 0) + 1)
    }
    // 고아(부모가 집합 외부) → inDegree=0 유지 → 루트로 처리
  }

  // 같은 부모를 가진 형제들을 byteOffset 순으로 정렬 (결정적 순서 보장)
  for (const [, siblings] of children) {
    siblings.sort((a, b) => a.byteOffset - b.byteOffset)
  }

  // Kahn's BFS 초기 큐: inDegree=0인 노드, byteOffset 순
  const queue: NormalizedEvent[] = []
  for (const ev of events) {
    if ((inDegree.get(ev.uuid) ?? 0) === 0) {
      queue.push(ev)
    }
  }
  queue.sort((a, b) => a.byteOffset - b.byteOffset)

  const result: NormalizedEvent[] = []

  while (queue.length > 0) {
    // queue는 이미 정렬되어 있으므로 shift (FIFO BFS)
    const ev = queue.shift()!
    result.push(ev)

    // 자식들의 inDegree를 감소시키고 0이 된 것을 큐에 삽입
    const childList = children.get(ev.uuid) ?? []
    const newlyReady: NormalizedEvent[] = []
    for (const child of childList) {
      const deg = (inDegree.get(child.uuid) ?? 1) - 1
      inDegree.set(child.uuid, deg)
      if (deg === 0) {
        newlyReady.push(child)
      }
    }
    // 새로 준비된 자식들을 byteOffset 순으로 큐에 삽입
    newlyReady.sort((a, b) => a.byteOffset - b.byteOffset)
    queue.push(...newlyReady)
  }

  // 순환 참조 잔여 노드: byteOffset 순으로 append (중단 금지)
  if (result.length < events.length) {
    const remaining: NormalizedEvent[] = []
    for (const ev of events) {
      if ((inDegree.get(ev.uuid) ?? 0) > 0) {
        remaining.push(ev)
      }
    }
    remaining.sort((a, b) => a.byteOffset - b.byteOffset)
    result.push(...remaining)
  }

  return result
}

// ============================================================
// § sortByByteOffset
// ============================================================

/**
 * sortByByteOffset(events) → NormalizedEvent[]
 *
 * SPEC §1-1 정렬 계약 3차 키: byteOffset (파일 내 append 순서 = 진실의 원천).
 * orderEvents()의 최종 tiebreaker로 사용된다.
 *
 * 특성:
 *   - 입력 불변 (새 배열 반환)
 *   - byteOffset 오름차순 정렬
 *   - byteOffset이 동일한 이벤트는 입력 순서(안정 정렬)를 유지한다
 *
 * @param events  정렬할 NormalizedEvent 배열 (입력 불변 — 복사본 반환)
 */
export function sortByByteOffset(events: readonly NormalizedEvent[]): NormalizedEvent[] {
  return [...events].sort((a, b) => a.byteOffset - b.byteOffset)
}

// ============================================================
// § orderEvents
// ============================================================

/**
 * 고아 버퍼 엔트리.
 * 부모(parentUuid) 미도착으로 정렬 보류된 레코드.
 */
interface OrphanEntry {
  event: NormalizedEvent
  bufferedAt: number  // Date.now() ms
}

/**
 * orderEvents(events, options) → NormalizedEvent[]
 *
 * SPEC §1-1 정렬 계약 (결정 f):
 *   1차: ts (epoch ms)
 *   2차: parentUuid 위상순서 (부모가 자식보다 앞)
 *   3차: byteOffset (파일 내 append 순서 = 진실의 원천)
 *
 * 고아(부모 미도착) 레코드는 orphanTimeoutMs까지 버퍼 후 flag 부착 flush.
 * live tail과 replay가 동일 정렬기 통과.
 *
 * @param events          정렬할 NormalizedEvent 배열
 * @param options.orphanTimeoutMs  고아 버퍼 타임아웃 (기본 5000ms)
 * @param options.orphanBuffer     외부에서 주입 가능한 버퍼 (live tail용 상태 유지)
 * @param options.seenUuids        이전 배치에서 이미 처리된 uuid 집합 (live tail 연속 호출용)
 * @param options.nowMs            현재 시각 (테스트 주입용, 기본 Date.now())
 */
export function orderEvents(
  events: readonly NormalizedEvent[],
  options?: {
    orphanTimeoutMs?: number
    orphanBuffer?: Map<string, OrphanEntry>
    seenUuids?: Set<string>
    nowMs?: number
  },
): NormalizedEvent[] {
  const orphanTimeoutMs = options?.orphanTimeoutMs ?? 5000
  const orphanBuffer: Map<string, OrphanEntry> = options?.orphanBuffer ?? new Map()
  const nowMs = options?.nowMs ?? Date.now()

  // allUuids: 현재 배치 + 이전 배치에서 처리된 uuid + 버퍼에 있는 uuid
  // seenUuids가 주입되면 이전 배치 uuid를 포함해 부모 존재 여부를 올바르게 판단
  const allUuids = new Set<string>(options?.seenUuids)
  for (const ev of events) allUuids.add(ev.uuid)
  for (const [uuid] of orphanBuffer) allUuids.add(uuid)

  // 신규 이벤트를 버퍼에 추가하거나 즉시 처리
  const toSort: NormalizedEvent[] = []

  for (const ev of events) {
    if (ev.parentUuid !== null && !allUuids.has(ev.parentUuid)) {
      // 부모 미도착 → 고아 버퍼
      orphanBuffer.set(ev.uuid, { event: ev, bufferedAt: nowMs })
    } else {
      toSort.push(ev)
      // seenUuids에 추가해 다음 배치에서도 부모로 인식되도록
      options?.seenUuids?.add(ev.uuid)
    }
  }

  // 버퍼에서 부모가 등장한 것들을 flush (반복하여 체인 해소)
  let flushed = true
  while (flushed) {
    flushed = false
    for (const [uuid, entry] of orphanBuffer) {
      const { event } = entry
      if (event.parentUuid === null || allUuids.has(event.parentUuid)) {
        toSort.push(event)
        allUuids.add(uuid)
        options?.seenUuids?.add(uuid)
        orphanBuffer.delete(uuid)
        flushed = true
      }
    }
  }

  // 타임아웃 초과 고아 강제 flush (flag 부착)
  for (const [uuid, entry] of orphanBuffer) {
    if (nowMs - entry.bufferedAt >= orphanTimeoutMs) {
      // orphan flag는 이벤트에 직접 추가하지 않고 (NormalizedEvent 타입 고정)
      // toSort에 포함시켜 정렬 후 반환. M2에서 orphan 마킹 처리.
      toSort.push(entry.event)
      allUuids.add(uuid)
      options?.seenUuids?.add(uuid)
      orphanBuffer.delete(uuid)
    }
  }

  // 3단계 정렬
  return toSort.sort((a, b) => {
    // 1차: ts
    if (a.ts !== b.ts) return a.ts - b.ts

    // 2차: parentUuid 위상순서 (부모가 자식보다 앞)
    // a가 b의 부모이면 a가 앞, b가 a의 부모이면 b가 앞
    if (b.parentUuid === a.uuid) return -1   // a가 b의 부모 → a 앞
    if (a.parentUuid === b.uuid) return 1    // b가 a의 부모 → b 앞

    // 3차: byteOffset
    return a.byteOffset - b.byteOffset
  })
}

// ============================================================
// § parseLine: JSONL 한 줄 → NormalizedEvent (parse 실패 포함)
// ============================================================

export interface ParseLineResult {
  event: NormalizedEvent
  parseOk: boolean
  parseError?: string
}

/**
 * JSONL 한 줄을 파싱해 NormalizedEvent를 반환한다.
 * JSON.parse 실패나 스키마 오류는 parse_ok=false로 격리하고
 * 파이프라인을 중단하지 않는다.
 *
 * SPEC §4 §6: 파싱 실패 라인은 parse_ok=0으로 저장하고 건너뜀(전체 중단 금지).
 */
export function parseLine(
  line: string,
  byteOffset: number,
  sourcePath?: string,
): ParseLineResult {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch (err) {
    const parseError = err instanceof Error ? err.message : String(err)
    // 파싱 실패 → 최소 NormalizedEvent (parse_ok=0 신호용)
    const fallback: NormalizedEvent = {
      uuid: syntheticUuid(line, byteOffset),
      parentUuid: null,
      sessionId: '',
      cwd: '',
      agentScope: 'root',
      isSidechain: false,
      ts: Date.now(),
      byteOffset,
      kind: 'other',
    }
    return { event: fallback, parseOk: false, parseError }
  }

  try {
    const event = normalize(raw, byteOffset, sourcePath, line)
    return { event, parseOk: true }
  } catch (err) {
    const parseError = err instanceof Error ? err.message : String(err)
    const fallback: NormalizedEvent = {
      uuid: syntheticUuid(line, byteOffset),
      parentUuid: null,
      sessionId: '',
      cwd: '',
      agentScope: 'root',
      isSidechain: false,
      ts: Date.now(),
      byteOffset,
      kind: 'other',
    }
    return { event: fallback, parseOk: false, parseError }
  }
}

// ============================================================
// § parseChunk: 바이너리 청크 → 완성된 JSONL 라인 배열
// ============================================================

export interface ParseChunkResult {
  /** 이번 청크에서 완성된 JSONL 라인 문자열 배열 (개행 미포함) */
  lines: readonly string[]
  /** 다음 청크로 이어질 미완성 부분 라인 (개행 없이 끝난 마지막 세그먼트) */
  partialLine: string
}

/**
 * parseChunk(buffer, partialLine) → ParseChunkResult
 *
 * 바이너리 청크와 이전 미완성 라인을 받아 완성된 JSON 라인 배열과
 * 새로운 partialLine을 반환한다.
 *
 * 핵심 불변:
 *   - 빈 Buffer → lines=[], partialLine 그대로 반환
 *   - 개행(\n)으로 분리, \r\n 및 \r 도 처리
 *   - 마지막 세그먼트가 개행 없이 끝나면 → partialLine로 보류
 *   - 빈 라인(공백만 있는 라인)은 건너뜀
 *   - fsync 전 부분 쓰기(파일 끝 개행 없음) 대응
 *
 * SPEC §4 §6: 증분 파싱 — 미완성 부분 라인 버퍼링.
 *
 * @param chunk       파일에서 읽은 Buffer (빈 Buffer 허용)
 * @param partialLine 이전 호출에서 미완성으로 남겨진 라인 부분 (초기값 '')
 */
export function parseChunk(
  chunk: Buffer,
  partialLine: string,
): ParseChunkResult {
  // 빈 청크 처리
  if (chunk.length === 0) {
    return { lines: [], partialLine }
  }

  // Buffer → UTF-8 문자열
  const text = chunk.toString('utf8')

  // 이전 partialLine과 새 청크 합산
  const combined = partialLine + text

  // \r\n, \r, \n 모두 처리하여 세그먼트 분리
  // split 후 마지막 세그먼트는 미완성 부분으로 보류
  const segments = combined.split(/\r?\n|\r/)

  // 마지막 세그먼트가 개행으로 끝나지 않으면 미완성 → 보류
  // split 결과: "a\nb\n" → ["a","b",""] (마지막 빈 문자열)
  // "a\nb" → ["a","b"] (마지막이 비어있지 않으면 미완성)
  const lastSegment = segments[segments.length - 1] ?? ''
  const completedSegments = segments.slice(0, segments.length - 1)

  // 빈 라인(공백만 있는 라인) 필터링
  const lines = completedSegments.filter((seg) => seg.trim().length > 0)

  return {
    lines,
    partialLine: lastSegment,
  }
}

// ============================================================
// § 버전 가드
// ============================================================

/**
 * JSONL top-level version 필드 확인.
 * 알 수 없는 버전이어도 true 반환 (중단 금지).
 * 미지 버전은 경고 정보를 반환값에 담는다.
 */
export function checkVersion(raw: unknown): { ok: boolean; version: number | undefined; warning?: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: true, version: undefined }
  }
  const version = (raw as Record<string, unknown>)['version']
  if (version === undefined) {
    return { ok: true, version: undefined }
  }
  if (typeof version !== 'number') {
    return { ok: true, version: undefined, warning: `unexpected version type: ${typeof version}` }
  }
  // 현재 알려진 버전: 1, 2, 2.x
  // 알 수 없는 버전도 ok=true (중단 금지)
  return { ok: true, version }
}
