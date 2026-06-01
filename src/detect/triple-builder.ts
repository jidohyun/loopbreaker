/**
 * src/detect/triple-builder.ts
 *
 * buildTriple(event: NormalizedEvent): ActionTriple | null
 *
 * NormalizedEvent(tool_use 이벤트)를 ActionTriple로 변환한다.
 * SPEC §4 §1a argKey 정규화 규칙을 결정론적으로 구현:
 *   - Edit/MultiEdit: file_path 보존 + editDelta 멀티셋 해시
 *   - Bash: 휘발성 인자 마스킹 후 해시
 *   - Read/Glob/Grep: 정규화 경로/패턴 해시
 *   - Write: file_path + content 해시
 *   - 기타(mcp__* 등): tool + stableStringify 해시
 *   - 큰 payload는 SHA-256(sha256:<hex>)으로 축약
 *
 * 불변 원칙:
 *   - LLM 호출 0, 결정론적
 *   - console.log 금지
 *   - 불변성: 새 객체 반환, 입력 변경 금지
 *   - tool_use 이외 이벤트는 null 반환
 */

import { createHash } from 'node:crypto'
import { normalize as normalizePath } from 'node:path'
import type { ActionTriple, NormalizedEvent, ResultClass } from '../contracts.js'

// ─── 내부 상수 ──────────────────────────────────────────────

/** SHA-256 해시를 반환한다. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 큰 payload를 SHA-256 지문으로 축약하는 임계값(바이트). */
const LARGE_PAYLOAD_THRESHOLD = 256

/** argKey용 짧은 지문 길이(16 hex chars = 64bits). */
const FINGERPRINT_LEN = 16

/** 지문 해시: 전체 SHA-256 hex의 앞 16자. */
function fingerprint(text: string): string {
  return sha256(text).slice(0, FINGERPRINT_LEN)
}

// ─── 정규화 유틸리티 ─────────────────────────────────────────

/**
 * 경로를 정규화한다 (내부용).
 * - 절대경로화(상대경로는 cwd 기준으로 해석하지 않고 normalize만)
 * - 심볼릭 링크 해소는 동기 fs 호출이 필요해 여기서는 lexical normalize만 수행
 * - trailing slash 제거 (루트 '/' 제외)
 * - '..' 세그먼트 lexical 해소
 */
function normPath(p: unknown): string {
  if (typeof p !== 'string' || p === '') return '<unknown_path>'
  const normalized = normalizePath(p)
  // strip trailing slash except for root '/'
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

/**
 * 파일경로 기반 도구(Edit, Read, Write)에서 표준 파일 경로를 추출·정규화한다.
 *
 * SPEC §4 §1a: 반복 편집 탐지의 축인 file_path를 정규화하여
 * argKey 생성의 입력으로 사용한다.
 *
 * 정규화 규칙:
 *   - args.file_path를 추출
 *   - node:path normalize()로 '..' 세그먼트와 중복 슬래시 lexical 해소
 *   - trailing slash 제거 (루트 '/' 제외)
 *   - file_path가 없거나 빈 문자열이면 '<unknown_path>' 반환
 *
 * @param args - 도구 입력 객체 (tool_use 이벤트의 input 필드)
 * @returns 정규화된 파일 경로 문자열
 */
export function normalizeArgKey(args: Record<string, unknown>): string {
  return normPath(args['file_path'])
}

/**
 * 원시 argKey 문자열에 마스커 4종을 순서대로 합성 적용해 최종 argKey를 반환한다.
 * Sub-AC 3e: 마스커 합성 파이프라인
 *
 * 적용 순서 (SPEC §4 §1a):
 *   1. maskTimestamps — ISO8601·epoch 타임스탬프 → <TIMESTAMP>
 *   2. maskPorts      — --port/–p/:PORT 패턴 → <PORT>
 *   3. maskTmpPaths   — /tmp/·/var/folders/·Windows Temp → <TMP_PATH>
 *   4. maskHashes     — SHA-256/SHA-1/MD5/UUID hex → <HASH>
 *
 * 순서 근거:
 *   - 타임스탬프를 먼저 마스킹해야 13/10자리 숫자를 포트 패턴보다 먼저 흡수한다.
 *   - 경로 마스킹 전에 포트를 처리해 URL의 포트(:4000)가 경로 일부로 오인되지 않는다.
 *   - 해시는 마지막에 처리해 앞 단계에서 삽입된 플레이스홀더(<TIMESTAMP> 등)가
 *     해시 패턴으로 재처리되지 않도록 한다(멱등성 보장).
 *
 * 결정론적·순수함수: LLM 호출 0, 부수효과 없음, 항상 같은 입력 → 같은 출력.
 *
 * @param rawArg - 마스킹할 원본 인자 문자열
 * @returns 4종 마스커가 순서대로 적용된 정규화된 argKey 문자열
 */
export function normalizeRawArgKey(rawArg: string): string {
  return maskHashes(maskTmpPaths(maskPorts(maskTimestamps(rawArg))))
}

/**
 * 연속 공백(스페이스·탭·줄바꿈)을 단일 공백으로 붕괴하고 양쪽 트림.
 * SPEC §4 §1a collapseWS
 */
function collapseWS(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Strip simple comments from source code strings.
 * SPEC §4 §1a stripComments
 */
function stripComments(s: string): string {
  // block comments: /* ... */
  let result = s.replace(/\/\*[\s\S]*?\*\//g, ' ')
  // line comments: // ...
  result = result.replace(/\/\/[^\n]*/g, ' ')
  return result
}

/**
 * 텍스트를 토큰 집합(공백 분리 단어들)으로 분해한다.
 * editDelta 멀티셋·Jaccard 계산에 사용.
 */
function tokenize(s: string): string[] {
  return collapseWS(s).split(' ').filter(t => t.length > 0)
}

/**
 * editDelta: old→new 의 토큰 add/remove 멀티셋(순서 무시).
 * SPEC §4 §1a: 미세 위치이동 흡수 — 같은 토큰 변경이면 동일 지문 생성.
 * 반환: 정렬된 "+(token)" / "-(token)" 문자열 배열의 해시.
 */
function editDelta(oldNorm: string, newNorm: string): string {
  const oldTokens = tokenize(oldNorm)
  const newTokens = tokenize(newNorm)

  // 멀티셋 차이: added = new - old, removed = old - new
  const oldMap = buildMultiset(oldTokens)
  const newMap = buildMultiset(newTokens)

  const delta: string[] = []

  for (const [tok, cnt] of oldMap.entries()) {
    const newCnt = newMap.get(tok) ?? 0
    const removed = cnt - newCnt
    for (let i = 0; i < removed; i++) delta.push(`-(${tok})`)
  }
  for (const [tok, cnt] of newMap.entries()) {
    const oldCnt = oldMap.get(tok) ?? 0
    const added = cnt - oldCnt
    for (let i = 0; i < added; i++) delta.push(`+(${tok})`)
  }

  // 정렬 → 순서 무시 지문
  delta.sort()
  return delta.join('\x1f')
}

function buildMultiset(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const t of tokens) {
    map.set(t, (map.get(t) ?? 0) + 1)
  }
  return map
}

/**
 * SHA1/SHA256/MD5 형식의 16진수 해시를 `<HASH>`로 치환한다.
 * Sub-AC 3d: 독립 단위 테스트로 검증 가능한 순수함수.
 *
 * 처리 패턴 (구체적인 패턴 먼저):
 *   1. UUID 형식: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (8-4-4-4-12 hex 그룹)
 *   2. SHA-256: 정확히 64자 연속 hex 문자열 (단어 경계)
 *   3. SHA-1:   정확히 40자 연속 hex 문자열 (단어 경계)
 *   4. MD5:     정확히 32자 연속 hex 문자열 (단어 경계)
 *
 * 단어 경계(\b)를 사용해 부분 매칭으로 인한 오탐을 방지한다.
 * 이미 `<HASH>`로 치환된 문자열에는 재적용되지 않는다 (멱등성).
 *
 * @param arg - 마스킹할 원본 문자열
 * @returns SHA1/SHA256/MD5 해시가 `<HASH>`로 치환된 문자열
 */
export function maskHashes(arg: string): string {
  let result = arg

  // 1. UUID 형식 (8-4-4-4-12 hex, 대소문자 무관)
  result = result.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '<HASH>',
  )

  // 2. SHA-256: 정확히 64자 hex (단어 경계)
  result = result.replace(/\b[0-9a-f]{64}\b/gi, '<HASH>')

  // 3. SHA-1: 정확히 40자 hex (단어 경계)
  result = result.replace(/\b[0-9a-f]{40}\b/gi, '<HASH>')

  // 4. MD5: 정확히 32자 hex (단어 경계)
  result = result.replace(/\b[0-9a-f]{32}\b/gi, '<HASH>')

  return result
}

/**
 * 타임스탬프 패턴을 `<TIMESTAMP>`로 치환한다.
 * Sub-AC 3a: ISO8601·Unix epoch(초)·밀리초 epoch 패턴을 마스킹.
 *
 * 처리 순서 (겹침 방지를 위해 긴 패턴 먼저):
 *   1. ISO 8601 datetime: YYYY-MM-DDTHH:MM:SS(.sss)?(Z|±HH:MM)?
 *      예: 2024-01-15T10:30:45.123Z, 2024-01-15T10:30:45+09:00
 *   2. ISO 8601 date-only: YYYY-MM-DD (단독 단어 경계)
 *   3. Unix epoch 밀리초: 정확히 13자리 숫자
 *   4. Unix epoch 초:     정확히 10자리 숫자
 *
 * @param arg - 마스킹할 원본 문자열
 * @returns 타임스탬프가 `<TIMESTAMP>`로 치환된 문자열
 */
export function maskTimestamps(arg: string): string {
  let result = arg

  // 1. ISO 8601 datetime (가장 구체적인 패턴 먼저)
  //    YYYY-MM-DDTHH:MM:SS(.fractional)?(Z | ±HH:MM | ±HHMM)?
  result = result.replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    '<TIMESTAMP>',
  )

  // 2. ISO 8601 date-only: YYYY-MM-DD
  result = result.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<TIMESTAMP>')

  // 3. Unix epoch 밀리초: 정확히 13자리 숫자
  result = result.replace(/\b\d{13}\b/g, '<TIMESTAMP>')

  // 4. Unix epoch 초: 정확히 10자리 숫자
  result = result.replace(/\b\d{10}\b/g, '<TIMESTAMP>')

  return result
}

/**
 * 임시 경로 패턴을 `<TMP_PATH>`로 치환한다.
 * Sub-AC 3c: `/tmp/...`, `/var/folders/...`, `os.TempDir()` 등 임시 경로 마스킹.
 *
 * 처리 패턴 (구체적인 패턴 먼저):
 *   1. /var/folders/... — macOS 시스템 임시 디렉토리 (os.TempDir() 결과)
 *   2. /tmp/...         — Linux/macOS 표준 임시 경로
 *   3. /var/tmp/...     — Linux/macOS 대체 임시 경로
 *   4. C:\Users\...\AppData\Local\Temp\... — Windows 임시 경로 (백슬래시)
 *   5. C:/Users/.../AppData/Local/Temp/... — Windows 임시 경로 (슬래시)
 *
 * 각 패턴은 경로 구분자 이후의 비공백 문자열까지 포함해 치환한다.
 *
 * @param arg - 마스킹할 원본 문자열
 * @returns 임시 경로가 `<TMP_PATH>`로 치환된 문자열
 */
export function maskTmpPaths(arg: string): string {
  let result = arg

  // 1. /var/folders/... — macOS os.TempDir() 결과 (가장 구체적인 패턴 먼저)
  result = result.replace(/\/var\/folders\/\S*/g, '<TMP_PATH>')

  // 2. /var/tmp/... — Linux/macOS 대체 임시 경로 (var/tmp는 var/folders 이후)
  result = result.replace(/\/var\/tmp\/\S*/g, '<TMP_PATH>')

  // 3. /tmp/... — 표준 임시 경로
  result = result.replace(/\/tmp\/\S*/g, '<TMP_PATH>')

  // 4. Windows 임시 경로 — 백슬래시 형식
  //    C:\Users\<name>\AppData\Local\Temp\...
  result = result.replace(/[A-Za-z]:\\[^\s]*\\AppData\\Local\\Temp\\\S*/g, '<TMP_PATH>')

  // 5. Windows 임시 경로 — 슬래시 형식 (WSL/msys 등에서도 사용)
  //    C:/Users/<name>/AppData/Local/Temp/...
  result = result.replace(/[A-Za-z]:\/[^\s]*\/AppData\/Local\/Temp\/\S*/g, '<TMP_PATH>')

  return result
}

/**
 * 포트 지정 패턴을 `<PORT>`로 치환한다.
 * Sub-AC 3b: 독립 단위 테스트로 검증 가능한 순수함수.
 *
 * 처리 순서 (겹침 방지를 위해 구체적인 패턴 먼저):
 *   1. --port <N> / --port=<N> 형태 (1~65535 범위)
 *   2. -p <N> / -p=<N> 형태 (1~65535 범위)
 *   3. HOST:PORT 또는 :PORT 형태 (콜론 + 1~65535)
 *
 * 범위: 1~65535 (표준 포트 범위). 0 및 65536 이상은 마스킹하지 않는다.
 *
 * @param arg - 마스킹할 원본 문자열
 * @returns 포트 패턴이 `<PORT>`로 치환된 문자열
 */
export function maskPorts(arg: string): string {
  let result = arg

  // 1. --port <N> 또는 --port=<N> (1~65535)
  result = result.replace(
    /--port[= ](\d+)/g,
    (_, p) => {
      const n = parseInt(p, 10)
      return n >= 1 && n <= 65535 ? '--port <PORT>' : `--port ${p}`
    },
  )

  // 2. -p <N> 또는 -p=<N> (1~65535) — 단어 경계 인접
  result = result.replace(
    /(?<!\w)-p[= ](\d+)/g,
    (_, p) => {
      const n = parseInt(p, 10)
      return n >= 1 && n <= 65535 ? '-p <PORT>' : `-p ${p}`
    },
  )

  // 3. :PORT 형태 (콜론 + 1~65535 + 단어경계)
  result = result.replace(
    /:(\d{1,5})\b/g,
    (match, p) => {
      const n = parseInt(p, 10)
      return n >= 1 && n <= 65535 ? ':<PORT>' : match
    },
  )

  return result
}

/**
 * Bash 명령어에서 휘발성 인자를 마스킹한다.
 * SPEC §4 §1a maskVolatile:
 *   - 10자리 이상 숫자(타임스탬프 등) → <N>
 *   - /tmp/... 경로 → <TMP>
 *   - :4000~:65535 포트 → <PORT>
 *   - sha/uuid 패턴(32+ hex 또는 uuid) → <HASH>
 *   - sleep \d+ → sleep <N>
 */
function maskVolatile(cmd: string): string {
  let result = cmd
  // UUID 패턴 (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  result = result.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<HASH>')
  // 32자 이상 hex 문자열 (sha256 등)
  result = result.replace(/\b[0-9a-f]{32,}\b/gi, '<HASH>')
  // /tmp/... 경로
  result = result.replace(/\/tmp\/\S*/g, '<TMP>')
  // 포트 번호 (:4자리+)
  result = result.replace(/:\d{4,5}\b/g, ':<PORT>')
  // 10자리 이상 숫자 (epoch timestamp 등)
  result = result.replace(/\b\d{10,}\b/g, '<N>')
  // sleep N
  result = result.replace(/\bsleep\s+\d+\b/g, 'sleep <N>')
  return result
}

/**
 * JSON을 키 정렬해 직렬화 (stableStringify).
 * 큰 payload 해시용.
 */
function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return String(v)
  if (typeof v !== 'object' && !Array.isArray(v)) return String(v)
  try {
    return JSON.stringify(v, (_, val) => {
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        return Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        )
      }
      return val as unknown
    })
  } catch {
    return '<unserializable>'
  }
}

/**
 * payload가 크면 sha256:<hex> 형식으로 축약한다.
 * SPEC §4 §1a: 큰 payload는 SHA-256(sha256:<hex>).
 */
function maybeHash(s: string): string {
  if (s.length > LARGE_PAYLOAD_THRESHOLD) {
    return `sha256:${sha256(s)}`
  }
  return s
}

// ─── tool별 argKey 생성 ──────────────────────────────────────

/** Edit/MultiEdit argKey: "Edit:{fp}:{editFingerprint[:16]}" */
function argKeyEdit(input: Record<string, unknown>): string {
  const fp = normPath(input['file_path'])
  const oldStr = typeof input['old_string'] === 'string' ? input['old_string'] : ''
  const newStr = typeof input['new_string'] === 'string' ? input['new_string'] : ''

  const oldNorm = collapseWS(stripComments(oldStr))
  const newNorm = collapseWS(stripComments(newStr))
  const delta = editDelta(oldNorm, newNorm)
  const editFp = fingerprint(fp + '|' + delta)

  return `Edit:${fp}:${editFp}`
}

/** Bash argKey: "Bash:{sha256(normalizedCmd)[:16]}" */
function argKeyBash(input: Record<string, unknown>): string {
  const cmd = typeof input['command'] === 'string' ? input['command'] : stableStringify(input)
  const masked = collapseWS(maskVolatile(cmd))
  return `Bash:${fingerprint(masked)}`
}

/** Read/Glob/Grep argKey: "{tool}:{sha256(normPath)[:16]}" */
function argKeyReadFamily(tool: string, input: Record<string, unknown>): string {
  // Read uses file_path; Glob uses pattern; Grep uses pattern or path
  const target =
    (typeof input['file_path'] === 'string' ? input['file_path'] : null) ??
    (typeof input['pattern'] === 'string' ? input['pattern'] : null) ??
    stableStringify(input)
  const normalized = normPath(target)
  return `${tool}:${fingerprint(normalized)}`
}

/** Write argKey: "Write:{fp}:{sha256(collapseWS(content))[:16]}" */
function argKeyWrite(input: Record<string, unknown>): string {
  const fp = normPath(input['file_path'])
  const content = typeof input['content'] === 'string' ? input['content'] : stableStringify(input['content'])
  const contentFp = fingerprint(collapseWS(content))
  return `Write:${fp}:${contentFp}`
}

/** 기타 툴(mcp__* 등) argKey: "{tool}:{sha256(stableStringify(input))[:16]}" */
function argKeyDefault(tool: string, input: Record<string, unknown>): string {
  const serialized = collapseWS(stableStringify(input))
  const hashed = maybeHash(serialized)
  return `${tool}:${fingerprint(hashed)}`
}

// ─── 메인 함수 ───────────────────────────────────────────────

/**
 * tool名과 input을 받아 SPEC §4 §1a 규칙에 따른 argKey를 반환한다.
 *
 * Sub-AC 2c: 지원하는 모든 도구 타입(Edit, MultiEdit, Bash, Read, Glob, Grep,
 *            Write, Agent, mcp__* 등)에 대한 canonical key 생성.
 *
 * 규칙 요약:
 *   - Edit/MultiEdit: "Edit:{normPath}:{editFingerprint[:16]}"
 *   - Bash:           "Bash:{sha256(maskedCmd)[:16]}"
 *   - Read/Glob/Grep: "{tool}:{sha256(normPath(file_path|pattern))[:16]}"
 *   - Write:          "Write:{normPath}:{sha256(collapseWS(content))[:16]}"
 *   - Agent:          "Agent:{sha256(stableStringify(input))[:16]}"
 *   - default:        "{tool}:{sha256(stableStringify(input))[:16]}"
 *
 * @param tool  - 도구 이름 (NormalizedEvent.tool)
 * @param input - 도구 입력 객체 (NormalizedEvent.input, undefined/null는 빈 객체 처리)
 * @returns argKey 문자열
 */
export function normalizeArgKeyForTool(
  tool: string,
  input: Record<string, unknown>,
): string {
  return buildArgKey(tool, input)
}

/**
 * NormalizedEvent에서 argKey를 직접 추출하는 top-level 디스패처.
 *
 * Sub-AC 2d: event.tool 기반으로 올바른 per-tool 정규화기로 라우팅.
 *   - kind !== 'tool_use' 이거나 tool 필드가 없으면 '' (빈 문자열) 반환.
 *   - input이 없거나 비객체이면 빈 객체로 처리.
 *   - 알 수 없는 tool은 default 핸들러(argKeyDefault)로 폴백.
 *
 * @param event - NormalizedEvent
 * @returns argKey 문자열 (non-tool 이벤트는 '')
 */
export function getArgKey(event: NormalizedEvent): string {
  if (event.kind !== 'tool_use') return ''
  const tool = event.tool
  if (!tool || typeof tool !== 'string') return ''

  const input: Record<string, unknown> =
    event.input !== null &&
    event.input !== undefined &&
    typeof event.input === 'object' &&
    !Array.isArray(event.input)
      ? (event.input as Record<string, unknown>)
      : {}

  return buildArgKey(tool, input)
}

/**
 * NormalizedEvent → ActionTriple | null
 *
 * SPEC §4 §1a: tool_use 이벤트에서만 ActionTriple을 생성한다.
 * - tool_result, assistant, user, system 등 → null
 * - tool 필드 없는 tool_use → null (방어적 처리)
 * - input 없는 tool_use → 빈 객체로 처리
 *
 * resultClass:
 *   - tool_use 자체에는 resultClass가 없다 (tool_result에 있음).
 *   - M2 구조 게이트에서는 tool_use 이벤트에서 triple을 만들고,
 *     대응하는 tool_result의 resultClass를 나중에 채운다.
 *   - 현재 이벤트에 resultClass 필드가 있으면 그것을 사용하고,
 *     없으면 'unknown'으로 초기화한다 (나중에 tool_result 매칭으로 보강).
 */
export function buildTriple(event: NormalizedEvent): ActionTriple | null {
  // tool_use 이벤트만 처리
  if (event.kind !== 'tool_use') return null

  // tool 필드 필수
  const tool = event.tool
  if (!tool || typeof tool !== 'string') return null

  // input을 Record로 정규화
  const input: Record<string, unknown> =
    event.input !== null &&
    event.input !== undefined &&
    typeof event.input === 'object' &&
    !Array.isArray(event.input)
      ? (event.input as Record<string, unknown>)
      : {}

  // tool별 argKey 생성
  const argKey = buildArgKey(tool, input)

  // resultClass: tool_use 이벤트에 있으면 사용, 없으면 'unknown'
  const resultClass: ResultClass = event.resultClass ?? 'unknown'

  return Object.freeze({
    tool,
    argKey,
    resultClass,
    ref: Object.freeze({ uuid: event.uuid, ts: event.ts }),
  })
}

/**
 * tool名에 따라 argKey를 생성한다.
 * SPEC §4 §1a 규칙 적용.
 */
function buildArgKey(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Edit':
    case 'MultiEdit':
      return argKeyEdit(input)

    case 'Bash':
      return argKeyBash(input)

    case 'Read':
    case 'Glob':
    case 'Grep':
      return argKeyReadFamily(tool, input)

    case 'Write':
      return argKeyWrite(input)

    default:
      return argKeyDefault(tool, input)
  }
}

// ─── 공개 유틸리티 ────────────────────────────────────────────

/**
 * 편집 내용 문자열의 공백·줄바꿈 차이를 정규화한다.
 *
 * SPEC §4 §1a collapseWS 규칙을 공개 API로 노출.
 * 입력이 공백·탭·줄바꿈만 다를 때 동일한 출력을 반환한다.
 *
 * 정규화 규칙:
 *   - 연속 공백(스페이스·탭·CR·LF 등 모든 \s) → 단일 스페이스
 *   - 양쪽 트림
 *
 * 용례:
 *   normalizeEditContent('const  x = 1')  === normalizeEditContent('const x = 1')
 *   normalizeEditContent('a\n\nb')        === normalizeEditContent('a b')
 *   normalizeEditContent('\t  hello  \n') === 'hello'
 *
 * @param content - 편집 내용 문자열
 * @returns 정규화된 문자열
 */
export function normalizeEditContent(content: string): string {
  return collapseWS(content)
}

/**
 * 편집 delta의 결정론적 멀티셋 해시를 반환한다.
 *
 * SPEC §4 §1a editDelta 멀티셋 해시:
 *   - old/new 문자열을 stripComments → collapseWS 로 정규화
 *   - 토큰 add/remove 멀티셋을 정렬 후 SHA-256 해시
 *   - 미세변형(공백·주석·줄바꿈 차이)이 있어도 같은 해시 반환 → 오탐 방지
 *   - 진짜 다른 편집(다른 토큰 변경)은 반드시 다른 해시 반환
 *
 * 반환 형식: SHA-256 hex 문자열 (64자)
 *
 * 용례:
 *   computeEditDeltaHash('const x = 1', 'const x = 2')
 *   // === computeEditDeltaHash('const  x  =  1', 'const  x  =  2')  ← 공백만 다름, 같은 해시
 *   // !== computeEditDeltaHash('const x = 1', 'const y = 2')       ← 다른 토큰, 다른 해시
 *
 * @param oldContent - 편집 전 문자열
 * @param newContent - 편집 후 문자열
 * @returns SHA-256 hex 문자열 (64자)
 */
export function computeEditDeltaHash(oldContent: string, newContent: string): string {
  const oldNorm = collapseWS(stripComments(typeof oldContent === 'string' ? oldContent : ''))
  const newNorm = collapseWS(stripComments(typeof newContent === 'string' ? newContent : ''))
  const delta = editDelta(oldNorm, newNorm)
  return sha256(delta)
}

// ─── groupEditsByArgKey ───────────────────────────────────────

/**
 * Edit 이벤트 목록에서 ActionTriple을 생성하고,
 * 정규화된 파일 경로(grouping key)로 그룹화한다.
 *
 * SPEC §4 §1c: 동일 file_path N회 편집 탐지의 전처리 단계.
 *
 * 그룹화 규칙:
 *   - Edit/MultiEdit 이벤트만 처리 (다른 tool은 무시)
 *   - 그룹화 키 = normalizeArgKey(input) = normPath(args.file_path)
 *     → 파일 경로 기반 그룹화. 편집 내용(delta)과 무관하게 동일 파일은 동일 그룹.
 *   - 반환 Map의 key는 정규화된 파일 경로 문자열 (예: '/project/src/foo.ts')
 *   - 반환 Map의 value는 해당 파일에 대한 ActionTriple 배열 (입력 순서 보존)
 *
 * 결정론성:
 *   - LLM 호출 0, 입력 이벤트 순서 보존, 불변(새 Map 반환)
 *
 * @param events - NormalizedEvent 배열 (tool_use 외 이벤트는 조용히 무시)
 * @returns Map<filePath, ActionTriple[]> — 정규화된 파일 경로 → 트리플 목록
 */
export function groupEditsByArgKey(
  events: readonly NormalizedEvent[],
): Map<string, ActionTriple[]> {
  const result = new Map<string, ActionTriple[]>()

  for (const event of events) {
    // Edit/MultiEdit tool_use 이벤트만 처리
    if (event.kind !== 'tool_use') continue
    if (event.tool !== 'Edit' && event.tool !== 'MultiEdit') continue

    const triple = buildTriple(event)
    if (triple === null) continue

    // 그룹화 키: 정규화된 파일 경로 (delta 무관)
    const input: Record<string, unknown> =
      event.input !== null &&
      event.input !== undefined &&
      typeof event.input === 'object' &&
      !Array.isArray(event.input)
        ? (event.input as Record<string, unknown>)
        : {}

    const groupKey = normalizeArgKey(input)

    const existing = result.get(groupKey)
    if (existing !== undefined) {
      existing.push(triple)
    } else {
      result.set(groupKey, [triple])
    }
  }

  return result
}

// ─── buildEditDeltaMultiset ───────────────────────────────────

/**
 * Edit 이벤트의 ActionTriple 배열에서 argKey별 editDeltaHash 멀티셋을 구성한다.
 *
 * Sub-AC 2.4.2: Edit/MultiEdit 트리플을 argKey로 그룹화하고,
 *   각 그룹 내에서 editDeltaHash(argKey 마지막 16hex 지문) 단위로 카운트한다.
 *
 * 반환 구조:
 *   Map<argKey, Map<editDeltaHash, count>>
 *
 *   - 외부 키(argKey):  "Edit:{filePath}:{deltaFingerprint}" 전체 문자열.
 *     같은 파일을 동일 delta 변형으로 편집한 트리플들이 같은 그룹을 공유한다.
 *   - 내부 키(editDeltaHash): argKey 마지막 ':' 이후의 16hex 지문.
 *     같은 그룹 내에서 미세변형 여부를 추가로 구분할 목적으로 보존한다.
 *     (argKey 자체가 이미 delta를 포함하므로 동일 외부키 → 동일 내부키가 됨)
 *   - 값(count): 해당 (argKey, deltaHash) 조합이 등장한 횟수.
 *
 * 처리 규칙:
 *   - tool이 'Edit' 또는 'MultiEdit'인 트리플만 처리한다.
 *   - argKey 형식이 'Edit:{path}:{16hex}' 또는 'MultiEdit:{path}:{16hex}'가 아니면
 *     해당 트리플은 조용히 무시한다 (방어적 처리).
 *   - LLM 호출 0, 결정론적, 입력 불변 (새 Map 반환, 원본 배열 미변경).
 *
 * 오탐 방지:
 *   computeEditDeltaHash / argKeyEdit에서 이미 collapseWS·stripComments·editDelta
 *   정규화가 적용됐으므로, 공백·주석만 다른 편집은 동일 argKey → 동일 내부키로 합산된다.
 *
 * @param triples - ActionTriple 배열 (순서 보존, 불변)
 * @returns Map<argKey, Map<editDeltaHash, count>>
 */
export function buildEditDeltaMultiset(
  triples: readonly ActionTriple[],
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>()

  for (const triple of triples) {
    // Edit/MultiEdit 트리플만 처리
    if (triple.tool !== 'Edit' && triple.tool !== 'MultiEdit') continue

    const argKey = triple.argKey

    // argKey 형식 검증: "{tool}:{anything}:{16hex}"
    // 마지막 ':' 이후가 정확히 16자 hex여야 함
    const lastColon = argKey.lastIndexOf(':')
    if (lastColon === -1) continue
    const deltaHash = argKey.slice(lastColon + 1)
    if (!/^[0-9a-f]{16}$/.test(deltaHash)) continue

    // 외부 맵: argKey → 내부 맵
    let inner = result.get(argKey)
    if (inner === undefined) {
      inner = new Map<string, number>()
      result.set(argKey, inner)
    }

    // 내부 맵: deltaHash → 카운트 증가
    inner.set(deltaHash, (inner.get(deltaHash) ?? 0) + 1)
  }

  return result
}

// ─── isFalsePositiveRepeat ────────────────────────────────────

/**
 * 오탐(false positive) 반복 판정 함수.
 *
 * Sub-AC 2.4.3: editDelta 멀티셋 기반 오탐 방지.
 *
 * 같은 argKey라도 서로 다른 deltaHash가 각각 threshold 미만이라면
 * "진짜 thrashing"이 아닐 수 있다. 이 함수는 argKey에 해당하는 내부 맵에서
 * **단일 deltaHash가 threshold 이상** 반복됐을 때만 true를 반환한다.
 *
 * 의도:
 *   - 각기 다른 delta로 편집이 분산된 경우(total > threshold이지만 각 delta < threshold)
 *     → 오탐 → false 반환
 *   - 동일 delta가 threshold 이상 반복된 경우
 *     → 진짜 반복 → true 반환
 *
 * @param multiset  buildEditDeltaMultiset()의 반환값
 *                  Map<argKey, Map<deltaHash, count>>
 * @param argKey    검사할 대상 argKey
 * @param threshold 단일 deltaHash 반복 횟수 임계값 (이상이면 true)
 * @returns boolean — 단일 deltaHash가 threshold 이상이면 true, 아니면 false
 */
export function isFalsePositiveRepeat(
  multiset: Map<string, Map<string, number>>,
  argKey: string,
  threshold: number,
): boolean {
  const inner = multiset.get(argKey)
  if (inner === undefined) return false
  for (const count of inner.values()) {
    if (count >= threshold) return true
  }
  return false
}

// ─── 내부 유틸 재수출 (테스트 화이트박스 접근용) ──────────────

export const _internal = {
  collapseWS,
  stripComments,
  editDelta,
  maskVolatile,
  maskTimestamps,
  maskPorts,
  maskTmpPaths,
  maskHashes,
  normPath,
  sha256,
  fingerprint,
  stableStringify,
  buildArgKey,
  tokenize,
  normalizeArgKey,
  normalizeRawArgKey,
  normalizeArgKeyForTool,
  getArgKey,
  normalizeEditContent,
  computeEditDeltaHash,
  groupEditsByArgKey,
  buildEditDeltaMultiset,
  isFalsePositiveRepeat,
} as const
