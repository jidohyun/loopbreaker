// src/eval/replay-session.ts
//
// replaySession — 녹화 JSONL → 동일 파이프라인 재구동 (Sub-AC 3a/3b/3c).
//
// SPEC §5(f): 녹화 JSONL → parseLine → insertParsedLines → queryEventsBySession → …
//   live=replay 동일 정렬기 통과.
//   dispatcher.dispatch 호출 금지 — 평가는 메트릭만 산출.
//   is_replay=true 로 detections.is_replay=1 기록.
//
// 재사용(재정의·수정 절대 금지):
//   - parseLine (src/ingest/parser.ts)
//   - ParseLineResult (src/ingest/parser.ts)
//   - insertParsedLines, queryEventsBySession (src/ingest/event-store.ts)
//   - NormalizedEvent, DetectionRecord (src/contracts.ts)
//
// 부수효과 격리:
//   - readLines 함수는 외부 주입(파일 읽기 의존성 분리).
//   - loadReplayEvents는 fs.readFileSync를 사용하되 임시경로·픽스처로만 테스트.
//   - DB는 외부 주입(테스트는 인메모리 DB, 실운영은 StorageLayer).
//   - 테스트는 문자열 배열 + Mock DB 직접 주입 → 실경로 접근 0.
//   - 실 마이닝은 mine-real-sessions.ts(MANUAL-ONLY)에서만.

import { readFileSync } from 'node:fs'
import { parseLine } from '../ingest/parser.js'
import type { ParseLineResult } from '../ingest/parser.js'
import type { NormalizedEvent, ActionTriple, DetectionRecord } from '../contracts.js'
import type { DetectionHit } from '../detect/detection-pipeline.js'
import { runStructuralGateOverEvents } from '../detect/detection-pipeline.js'
import {
  hitsToTriples,
  makeEventLookupFromArray,
} from '../detect/hits-to-triples.js'
import type { StoredEvent } from '../ingest/event-store.js'
import { runM3Pipeline, type M3PipelineOptions } from '../detect/m3-pipeline.js'
import type { ReplayDetectionRecord } from './eval-contracts.js'

// ============================================================
// § 입력 소스 타입
// ============================================================

/**
 * replaySession 입력 소스.
 * - `string[]` : JSONL 라인 배열 (테스트·인메모리 경로)
 * - `string`   : JSONL 파일 절대경로 (실운영 경로, readLines 주입 필요)
 *
 * 테스트는 항상 `string[]`를 사용한다(파일시스템 접근 0).
 */
export type ReplayInput = string[] | string

/**
 * 파일에서 JSONL 라인을 읽는 함수 시그니처.
 * 파일 경로 입력일 때만 사용된다.
 * 테스트에서는 주입하지 않아도 됨(string[] 입력 사용).
 */
export type ReadLinesFunc = (filePath: string) => string[]

// ============================================================
// § 입력 처리 결과
// ============================================================

/**
 * replaySession 입력 처리 단계 결과.
 * parseLine 호출 결과 배열 + 정규화 이벤트 배열을 담는다.
 */
export interface ReplayInputResult {
  /** 원본 라인 배열 (빈 라인·공백 라인 제거 후) */
  rawLines: string[]
  /** parseLine 호출 결과 배열 (rawLines 순서와 1:1 대응) */
  parseResults: ParseLineResult[]
  /** parseOk=true인 정규화 이벤트 배열 (실패 라인 제외) */
  events: NormalizedEvent[]
  /** 파싱 실패 수 */
  parseFailCount: number
  /** 소스 경로 또는 '<inline>' */
  sourcePath: string
}

// ============================================================
// § 입력 처리 단계: processReplayInput
// ============================================================

/**
 * replaySession 입력 처리 단계 (Sub-AC 3a).
 *
 * 동작:
 *   1. input이 string[]이면 그대로 사용 (파일시스템 접근 0).
 *      input이 string(파일 경로)이면 readLines(input)으로 읽는다.
 *   2. 빈 라인·공백만 있는 라인을 제거한다.
 *   3. 각 라인에 parseLine(line, byteOffset, sourcePath)를 호출한다.
 *      byteOffset은 이전 라인들의 UTF-8 바이트 누적합 (Buffer.byteLength 사용).
 *   4. parseOk=true인 이벤트만 events 배열에 포함한다.
 *      (parseOk=false 라인은 parseFailCount에 집계, 파이프라인 중단 금지)
 *
 * SPEC §4 §6: 파싱 실패 라인은 건너뛰고 전체 중단 금지.
 * SPEC §5(f): live tail과 동일 정렬기(parseLine)를 거친다.
 *
 * @param input       JSONL 라인 배열 또는 JSONL 파일 절대경로
 * @param readLines   파일 경로 입력 시 라인을 읽는 함수 (테스트에서는 불필요)
 * @returns           입력 처리 결과
 */
export function processReplayInput(
  input: ReplayInput,
  readLines?: ReadLinesFunc,
): ReplayInputResult {
  // 1. 라인 소스 결정
  let sourcePath: string
  let allLines: string[]

  if (Array.isArray(input)) {
    sourcePath = '<inline>'
    allLines = input
  } else {
    sourcePath = input
    if (!readLines) {
      throw new Error(
        `processReplayInput: 파일 경로 입력에는 readLines 함수가 필요합니다. path=${input}`,
      )
    }
    allLines = readLines(input)
  }

  // 2. 빈 라인 제거
  const rawLines = allLines.filter((line) => line.trim().length > 0)

  // 3. parseLine 호출 (byteOffset 누적)
  const parseResults: ParseLineResult[] = []
  const events: NormalizedEvent[] = []
  let byteOffset = 0
  let parseFailCount = 0

  for (const line of rawLines) {
    const result = parseLine(line, byteOffset, sourcePath)
    parseResults.push(result)

    if (result.parseOk) {
      events.push(result.event)
    } else {
      parseFailCount++
    }

    // 다음 라인의 byteOffset = 현재 라인 UTF-8 바이트 + 개행 1바이트
    byteOffset += Buffer.byteLength(line + '\n', 'utf8')
  }

  return {
    rawLines,
    parseResults,
    events,
    parseFailCount,
    sourcePath,
  }
}

// ============================================================
// § 파일 기반 이벤트 로더: loadReplayEvents (Sub-AC 3c-1)
// ============================================================

/**
 * loadReplayEvents 결과.
 * 파일에서 읽은 JSONL을 파싱한 결과 + 메타.
 */
export interface LoadReplayEventsResult {
  /** 파싱된 정규화 이벤트 배열 (parseOk=true만, 파싱 실패 제외) */
  events: NormalizedEvent[]
  /** 파싱 실패 수 */
  parseFailCount: number
  /** 전체 비어있지 않은 라인 수 */
  totalLines: number
  /** 소스 파일 경로 */
  filePath: string
}

/**
 * 저장된 JSONL 녹화 파일에서 이벤트 목록을 읽는다 (Sub-AC 3c-1).
 *
 * 동작:
 *   1. filePath의 JSONL 파일을 UTF-8로 읽는다.
 *   2. 개행 분리 → 빈 라인 필터링.
 *   3. processReplayInput에 위임해 parseLine + byteOffset 누적을 처리한다.
 *   4. 파싱 성공 이벤트 배열과 메타를 반환한다.
 *
 * 부수효과 격리 규칙:
 *   - 테스트는 os.tmpdir() 임시 경로 또는 tests/fixtures 픽스처 경로만 사용한다.
 *   - 실경로(~/.claude 등) 리터럴은 테스트에 등장하면 안 된다.
 *   - 파일 읽기는 Node.js 기본 fs(readFileSync) 사용 — 외부 의존성 추가 금지.
 *
 * SPEC §5(f): 파싱 실패 라인은 건너뛰고 전체 중단 금지.
 *
 * @param filePath  읽을 JSONL 파일의 절대경로 (테스트: tmpdir 또는 픽스처 경로)
 * @returns         LoadReplayEventsResult
 * @throws          파일을 읽을 수 없으면 에러를 던진다 (fs 에러 그대로 전파)
 */
export function loadReplayEvents(filePath: string): LoadReplayEventsResult {
  // 1. 파일 읽기 (fs.readFileSync — 외부 주입 없이 직접 사용)
  const raw = readFileSync(filePath, 'utf8')

  // 2. 개행 분리 (OS 무관: \r\n·\n 모두 처리)
  const allLines = raw.split(/\r?\n/)

  // 3. processReplayInput에 위임 (parseLine + byteOffset 누적)
  const result = processReplayInput(allLines, undefined)

  return {
    events: result.events,
    parseFailCount: result.parseFailCount,
    totalLines: result.rawLines.length,
    filePath,
  }
}

// ============================================================
// § Sub-AC 3c-3: hitsToTriples 적용 단계
// ============================================================

/**
 * applyHitsToTriples 결과.
 * DetectionHit[] → (hits, triples) 쌍을 담는다.
 */
export interface ApplyHitsToTriplesResult {
  /** 구조 게이트 통과 히트 배열 (triples와 동일 순서·길이) */
  hits: readonly DetectionHit[]
  /** 각 hit에 대한 ActionTriple 배열 (hits와 동일 인덱스 대응) */
  triples: readonly (readonly ActionTriple[])[]
  /** triples가 비어있어 제외된 hit 수 (excludeEmpty=true 시) */
  excludedEmptyCount: number
}

/**
 * 구조 신호 히트 목록에 hitsToTriples를 적용해 트리플 배열을 반환한다 (Sub-AC 3c-3).
 *
 * 동작:
 *   1. events 배열로 EventLookup(인메모리 UUID → StoredEvent 맵)을 구성한다.
 *   2. hitsToTriples(hits, lookup, excludeEmpty)를 호출해 각 hit에 대한
 *      ActionTriple 배열을 결정론적으로 생성한다.
 *   3. 결과 { hits, triples, excludedEmptyCount }를 반환한다.
 *
 * 결정론성 보장:
 *   - LLM 호출 0, 순수함수 hitsToTriples 위임.
 *   - 동일 (hits, events, excludeEmpty) 입력 → 동일 (hits, triples) 출력.
 *   - 불변성: 입력 배열 변경 금지, 새 객체 반환.
 *
 * runM3Pipeline 길이 계약:
 *   hits.length === triples.length 항상 유지
 *   (excludeEmpty=true 시 히트/트리플 양쪽 동시 제외, 길이 일치 보장).
 *
 * SPEC §5(f): live=replay 동일 파이프라인 경로 통과.
 *   hitsToTriples는 replay 경로와 live 경로가 동일 함수를 사용한다.
 *
 * ⚠️ 부수효과 없음: FS/API/DB 접근 없음.
 *    이벤트 배열 + DetectionHit 배열만 처리.
 *
 * @param hits          구조 게이트 통과 히트 배열 (runStructuralGateOverEvents 결과)
 * @param events        세션 이벤트 배열 (UUID → StoredEvent 조회 소스)
 * @param excludeEmpty  빈 triples hit를 결과에서 제외할지 여부 (기본 false)
 * @returns             ApplyHitsToTriplesResult
 */
export async function applyHitsToTriples(
  hits: readonly DetectionHit[],
  events: readonly StoredEvent[],
  excludeEmpty = false,
): Promise<ApplyHitsToTriplesResult> {
  // 1. EventLookup 구성 (UUID → StoredEvent 인메모리 맵)
  const lookup = makeEventLookupFromArray(events)

  // 2. hitsToTriples 호출 (결정론적, LLM 0)
  const inputHitsCount = hits.length
  const { hits: resultHits, triples: resultTriples } = await hitsToTriples(
    hits,
    lookup,
    excludeEmpty,
  )

  // 3. excludedEmptyCount 계산
  const excludedEmptyCount = excludeEmpty
    ? inputHitsCount - resultHits.length
    : 0

  return {
    hits: resultHits,
    triples: resultTriples,
    excludedEmptyCount,
  }
}

// ============================================================
// § Sub-AC 3c-4: runM3Pipeline 적용 단계
// ============================================================

/**
 * applyM3Pipeline 결과.
 * triples 배열에 runM3Pipeline(Mock embed/judge)을 적용한 결과를 담는다.
 */
export interface ApplyM3PipelineResult {
  /** 성공적으로 처리된 DetectionRecord 배열 */
  records: readonly DetectionRecord[]
  /** 처리된 hit 수 (hits.length 와 동일) */
  hitCount: number
  /** fail-closed로 건너뛴 hit 수 (API 실패 등) */
  skippedCount: number
}

/**
 * 트리플 배열에 runM3Pipeline(Mock embed/judge)을 적용해
 * DetectionRecord[] 를 반환하는 단계 (Sub-AC 3c-4).
 *
 * 동작:
 *   1. hits와 triples 배열을 받아 runM3Pipeline에 전달한다.
 *   2. runM3Pipeline은 embed → judge → DetectionRecord를 결정론적으로 반환한다.
 *      fail-closed: embed/judge API 실패 hit는 결과에서 제외 (미발화).
 *   3. 성공 records 배열 + 처리 통계를 반환한다.
 *
 * SPEC §5(f) / Sub-AC 3c-4 계약:
 *   - dispatcher.dispatch 호출 없음 — 평가는 메트릭 산출만.
 *   - MockEmbedClient / MockJudgeClient 를 opts에 주입해야 한다 (실 API 금지).
 *   - 동일 입력 → 동일 records 배열 (결정론 보장).
 *   - hits.length !== triples.length 이면 에러 throw (runM3Pipeline 길이 계약).
 *
 * ⚠️ 부수효과 없음: FS/API/DB 접근 없음.
 *    embed/judge 는 opts.embedClient / opts.judgeClient 통해서만 호출.
 *
 * @param hits     구조 게이트 통과 히트 배열 (applyHitsToTriples 결과)
 * @param triples  각 hit에 대한 ActionTriple 배열 (hits와 동일 인덱스 대응)
 * @param opts     M3PipelineOptions (embedClient, judgeClient, config)
 * @returns        ApplyM3PipelineResult
 */
export async function applyM3Pipeline(
  hits: readonly DetectionHit[],
  triples: readonly (readonly ActionTriple[])[],
  opts: M3PipelineOptions,
): Promise<ApplyM3PipelineResult> {
  const hitCount = hits.length

  // runM3Pipeline: fail-closed 원칙 — API 실패 hit는 결과에서 제외
  const records = await runM3Pipeline(hits, triples, opts)

  // skippedCount = 입력 hit 수 - 성공 record 수
  const skippedCount = hitCount - records.length

  return Object.freeze({
    records: Object.freeze(records),
    hitCount,
    skippedCount,
  })
}

// ============================================================
// § replaySession — 전체 파이프라인 재구동 (Sub-AC 3d)
// ============================================================

/**
 * dispatcher 인터페이스 (최소 필요 시그니처).
 * NotifyDispatcher의 dispatch 메서드와 호환.
 * 순환 import 방지를 위해 최소 인터페이스로 정의.
 */
export interface ReplayDispatcher {
  dispatch(record: DetectionRecord): Promise<unknown>
}

/**
 * replaySession 옵션.
 *
 * SPEC §5(f): recordIsReplay=true → is_replay=1, dispatcher 스킵.
 *             recordIsReplay=false(기본) → is_replay=0, dispatcher 정상 호출.
 */
export interface ReplaySessionOpts {
  /**
   * true이면 모든 DetectionRecord에 is_replay=1 설정, dispatcher 호출 금지.
   * false(기본값)이면 is_replay=0, dispatcher 정상 호출.
   * SPEC §5(f): 평가 모드(recordIsReplay=true)는 알림 발송 금지.
   */
  recordIsReplay?: boolean
  /**
   * 알림 디스패처 (선택).
   * recordIsReplay=false이고 dispatcher가 주입됐을 때만 호출.
   * recordIsReplay=true이면 주입돼도 호출 금지.
   */
  dispatcher?: ReplayDispatcher
  /** M3Pipeline 옵션 (embedClient, judgeClient, config) */
  pipelineOpts: M3PipelineOptions
}

/**
 * replaySession — 녹화 JSONL → 동일 파이프라인 재구동 (Sub-AC 3d).
 *
 * 흐름:
 *   1. processReplayInput(input) → NormalizedEvent[]
 *   2. runStructuralGateOverEvents(events) → DetectionHit[]
 *   3. applyHitsToTriples(hits, events) → { hits, triples }
 *   4. applyM3Pipeline(hits, triples, pipelineOpts) → DetectionRecord[]
 *   5. 각 record에 is_replay 플래그 부착 (recordIsReplay=true → 1, 아니면 0)
 *   6. recordIsReplay=false이고 dispatcher 주입 시 → 각 record dispatcher.dispatch 호출
 *      recordIsReplay=true이면 dispatcher 호출 금지 (평가 모드)
 *
 * 결정론 보장:
 *   - 동일 input + 동일 opts → 동일 ReplayDetectionRecord[]
 *   - 실 API 호출 0 (Mock embed/judge 주입 필수)
 *   - 실경로 접근 0 (input=string[] 사용 시)
 *
 * SPEC §5(f): live=replay 동일 정렬기 통과.
 *             dispatcher.dispatch 호출은 recordIsReplay=false 시에만.
 *
 * ⚠️ 부수효과 격리:
 *   - 테스트는 string[] input + Mock embed/judge + Mock dispatcher 사용.
 *   - 실 파일 경로·실 API·실 dispatcher 접근 금지.
 *
 * @param input   JSONL 라인 배열 또는 JSONL 파일 절대경로
 * @param opts    ReplaySessionOpts
 * @returns       ReplayDetectionRecord[] (is_replay 필드 포함)
 */
export async function replaySession(
  input: ReplayInput,
  opts: ReplaySessionOpts,
): Promise<ReplayDetectionRecord[]> {
  const { recordIsReplay = false, dispatcher, pipelineOpts } = opts

  // 1. 입력 처리 → NormalizedEvent[]
  const { events } = processReplayInput(input)

  // StoredEvent 호환 변환 (NormalizedEvent는 StoredEvent와 동일 구조)
  const storedEvents = events as unknown as StoredEvent[]

  // 2. 구조 게이트 → DetectionHit[]
  const hits = runStructuralGateOverEvents(storedEvents, pipelineOpts.config)

  // 3. hitsToTriples 적용
  const { hits: filteredHits, triples } = await applyHitsToTriples(
    hits,
    storedEvents,
    false, // excludeEmpty=false: 빈 트리플 hit도 포함 (fail-closed는 M3 담당)
  )

  // 4. M3Pipeline 적용 → DetectionRecord[]
  const { records } = await applyM3Pipeline(filteredHits, triples, pipelineOpts)

  // 5. is_replay 플래그 부착 + 6. dispatcher 호출 (조건부)
  const isReplayFlag: 0 | 1 = recordIsReplay ? 1 : 0

  const replayRecords: ReplayDetectionRecord[] = []

  for (const record of records) {
    const replayRecord: ReplayDetectionRecord = { ...record, is_replay: isReplayFlag }
    replayRecords.push(replayRecord)

    // recordIsReplay=false 이고 dispatcher 주입 시에만 호출
    // recordIsReplay=true(평가 모드)이면 dispatcher 호출 금지
    if (!recordIsReplay && dispatcher !== undefined) {
      await dispatcher.dispatch(record)
    }
  }

  return replayRecords
}
