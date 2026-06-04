// ============ contracts.ts — 단일 SSOT 타입/스키마 ============
// 전 영역이 import하는 단일 타입/스키마.
// 정합화 패치 노트(SPEC §1-1) 7개 BLOCKER 규칙을 완전 반영.
//
// BLOCKER C1: enum은 'false_success' 단일 (fake_success/fakeSuccess 금지)
// BLOCKER C2: JudgeVerdict는 이 파일의 정의가 정본 (§6 재정의 금지)
// BLOCKER C3: DetectorConfig는 평면 구조 (중첩 금지)
// BLOCKER C5: contracts 컬럼명이 정본
// BLOCKER C8: EmbeddingSimilarityResult.pairs가 정본 (pairCount 아님)
// BLOCKER C9: §3 DDL이 정본, enum 통일 (source/kind 리터럴 고정)
// BLOCKER B1: sqlite-vec 차원은 DDL 매직넘버 금지, config.embedDim 사용
// BLOCKER B2: 임베딩 provider는 Voyage/OpenAI, judge만 Anthropic

// ---- 1. 파서 출력 (파서→탐지→평가 공통 입력) ----

/** 도구 실행 결과의 거친 등급 분류 */
export type ResultClass = 'ok' | 'error' | 'rejected' | 'blocked' | 'empty' | 'unknown'

/**
 * 에이전트 스코프: 'root' 또는 서브에이전트 agentId.
 * isSidechain + 서브에이전트 경로로 도출 (actor 식별 핵심).
 */
export type AgentScope = 'root' | string

/**
 * 정규화된 세션 이벤트.
 * 파서 영역이 생성하고, 탐지·평가 영역이 소비하는 단일 입력 타입.
 *
 * BLOCKER C5: 컬럼명은 contracts 정본 사용
 *   - cwd (project_path 아님)
 *   - agent_scope + is_sidechain (is_subagent 아님)
 *   - kind (role+event_type 아님)
 *   - tool (tool_name 아님)
 *   - input (normalized_args_digest 아님)
 *   - result_class (result_digest 아님)
 */
export interface NormalizedEvent {
  /** Claude Code 원본 uuid. 없으면 파서가 합성. */
  uuid: string
  /** 원본 parentUuid. 스레드 연결. 고아 허용. */
  parentUuid: string | null
  /** Claude Code sessionId */
  sessionId: string
  /** 프로젝트 경로 (cwd). ~/.claude/projects/<encoded> 디코딩 결과. */
  cwd: string
  /** 에이전트 스코프: 'root' 또는 서브에이전트 경로로 도출 */
  agentScope: AgentScope
  /** 사이드체인 여부 */
  isSidechain: boolean
  /** 이벤트 발생 시각 (epoch ms, UTC) */
  ts: number
  /**
   * 파일 내 바이트 오프셋 — 정렬 3차 키 (진실의 원천).
   * 주의: events 테이블에는 저장하지 않음 (watch_offsets가 담당).
   */
  byteOffset: number
  /** 이벤트 종류 */
  kind: 'user' | 'assistant' | 'system' | 'attachment' | 'tool_use' | 'tool_result' | 'other'
  /** 도구 이름 (tool_use 이벤트일 때) */
  tool?: string
  /** 도구 입력 (tool_use 이벤트일 때) */
  input?: unknown
  /** 도구 실행 결과 등급 (tool_result 이벤트일 때) */
  resultClass?: ResultClass
  /** 도구 사용 ID (tool_result가 연결된 tool_use UUID) */
  toolUseId?: string
  /** 완료선언/메시지 텍스트 */
  text?: string
  /** 추론 텍스트 (privacy.embedReasoning=false면 undefined) */
  reasoning?: string
  /** system 이벤트 서브타입 */
  systemSubtype?: string
  /** 중단된 메시지 ID */
  interruptedMessageId?: string
}

// 도출 함수 시그니처 (파서 영역이 구현, 테스트 가능):
//   normalize(raw: unknown): NormalizedEvent
//   classifyResult(userRec, toolUseResult, asstMeta): ResultClass
//     우선순위: blocked(hook deny) > rejected(perm 거부)
//              > error(is_error||toolUseResult.error||isApiErrorMessage)
//              > empty(빈 tool_result) > ok > unknown
//   orderEvents(raw: NormalizedEvent[]): NormalizedEvent[]
//     1차: ts, 2차: parentUuid 위상, 3차: byteOffset
//     고아(부모 미도착)는 최대 N개/T초 버퍼 후 flag 부착 flush.
//     live tail/replay 동일 코드 경로 통과.

// ---- 2. 탐지 중간/최종 산출물 (모든 레이어 보존 — ablation 측정용) ----

/**
 * 도구 실행 동작의 정규화된 3-tuple.
 * BLOCKER C5: ref 필드는 {uuid, ts} (intent/action/outcome 없음)
 */
export interface ActionTriple {
  /** 도구 이름 */
  tool: string
  /** 정규화된 인자 지문 (툴별 정규화 규칙 적용) */
  argKey: string
  /** 결과 등급 */
  resultClass: ResultClass
  /** 근거 추적용 참조 */
  ref: { uuid: string; ts: number }
}

/**
 * 구조 게이트 판정 결과.
 * BLOCKER C1: type 필드는 'false_success' 단일 (fake_success/fakeSuccess 금지)
 */
export interface StructureGateResult {
  /** 실패 종류. BLOCKER C1: 'false_success' 단일. */
  type: 'thrashing' | 'false_success'
  /** 세부 유형 (예: 'self_approval', 'unsubstantiated_claim') */
  subtype: string
  /** 심각도 */
  severity: 'warning' | 'critical'
  /** 세션 ID */
  sessionId: string
  /** 에이전트 스코프 */
  agentScope: AgentScope
  /** 해당 윈도의 이벤트 UUID 배열 */
  windowRefs: string[]
  /** 탐지에 사용된 지표들 */
  metrics: Record<string, number>
}

/**
 * 임베딩 유사도 판정 결과.
 * BLOCKER C8: pairs 배열이 정본 (pairCount 아님)
 */
export interface EmbeddingSimilarityResult {
  /** 윈도 내 최대 코사인 유사도 */
  maxCosine: number
  /** HDBSCAN 군집 ID (선택) */
  clusterId?: number
  /**
   * 유사도 쌍 목록.
   * BLOCKER C8: pairs:{a,b,cos}[] 가 정본 (pairCount 필드 금지)
   */
  pairs: { a: string; b: string; cos: number }[]
}

/**
 * LLM judge 판정 결과.
 * BLOCKER C2: 이 정의가 정본. §6의 재정의 무효.
 * (positionSwapAgreement/selfConsistencyVotes는 DetectionRecord 또는 JudgeMeta에)
 */
export interface JudgeVerdict {
  /**
   * 판정 종류.
   * BLOCKER C1: 'false_success' 단일 ('fakeSuccess' 금지)
   */
  kind: 'thrashing' | 'false_success' | 'none'
  /** 세부 유형 */
  subtype: string
  /** 신뢰도 (0~1) */
  confidence: number
  /** 주제 발산도 (선택) */
  topicDivergence?: number
  /** 순환참조 여부 (선택) */
  circularReference?: boolean
  /** 판정 이유 */
  reason: string
  /** self-consistency N개 응답 (편향완화 감사용) */
  rawSamples: unknown[]
}

/**
 * 다신호 탐지 신호 묶음.
 * 단일 시간 임계값 금지 — 다신호 조합으로만 판정.
 */
export interface DetectionSignals {
  /** 시간 근접성 (ms) */
  temporalProximityMs?: number
  /** 동일 작성자 컨텍스트 여부 */
  sameAuthorContext?: boolean
  /** 순환참조 여부 */
  circularReference?: boolean
  /** 주제 발산도 */
  topicDivergence?: number
  /** 구조적 반복 횟수 */
  structuralRepeatCount?: number
  /** 최대 코사인 유사도 */
  maxCosine?: number
}

/**
 * 탐지 최종 산출물.
 * BLOCKER C1: kind는 'false_success' 단일 ('fake_success'/'fakeSuccess' 금지)
 * = 탐지 영역의 Detection = 평가 영역의 DetectionVerdict (동일물)
 */
export interface DetectionVerdict {
  /**
   * 탐지 결과 종류.
   * BLOCKER C1: 'false_success' 단일 리터럴.
   */
  kind: 'thrashing' | 'false_success' | 'none'
  /** 세부 유형 */
  subtype: string
  /** 신뢰도 (0~1) */
  confidence: number
  /** 탐지에 사용된 신호들 */
  signals: DetectionSignals
  /** 근거 목록 (사람 호출용 evidence) */
  evidence: { uuid: string; ts: number; note: string }[]
  /** 판정 이유 */
  reason: string
}

/**
 * 탐지 파이프라인 중간/최종 산출물 전체 보존.
 * 평가 영역이 레이어별 채점에 사용.
 */
export interface DetectionRecord {
  /** 구조 게이트 결과 */
  gate: StructureGateResult
  /** 임베딩 유사도 결과 (의미 단계 미진행 시 undefined) */
  embed?: EmbeddingSimilarityResult
  /** judge 결과 (judge 단계 미진행 시 undefined) */
  judge?: JudgeVerdict
  /**
   * judge API 실패 시 true.
   * SPEC §4: judge 실패 후 재시도 소진 → judgeError:true, deferred:true 표시하고 미확정.
   */
  judgeError?: boolean
  /**
   * judge 판정 미확정(지연) 여부.
   * judgeError:true와 함께 설정된다.
   */
  deferred?: boolean
  /** 최종 판정 */
  final: DetectionVerdict
}

// 함수 시그니처 (탐지 영역이 구현):
//   buildTriple(ev: NormalizedEvent): ActionTriple
//   runStructuralGate(ev: NormalizedEvent, state: SessionState): StructureGateResult | null
//   runSemanticThrashing(ctx: SemanticContext): Promise<EmbeddingSimilarityResult>
//   runJudgeFalseSuccess(ctx: JudgeContext): Promise<JudgeVerdict>
//   synthesize(gate, embed?, judge?): DetectionVerdict

// ---- 3. 설정 (탐지 런타임 + 평가 캘리브레이션이 동일 파일 로드, 코드 상수 금지) ----

/**
 * 탐지기 설정 — 평면 구조 (BLOCKER C3: 중첩 구조 금지).
 * 모든 임계값은 여기에만 정의. 코드 상수 하드코딩 금지.
 *
 * 기본값 (SPEC §1 주석):
 *   WARNING=10, CRITICAL=20, circuitBreaker=30, historySize=30
 *   errLoopWarn=3, errLoopCrit=5, fileEditWarn=5, fileEditCrit=8
 *   simThresh=0.90, decideThresh=0.7
 *   selfApprovalMs=15000, selfApprovalCriticalMs=1000
 *   judgeSelfConsistencyN=1, judgePositionSwaps=0 (scope 축소 권고)
 *
 * BLOCKER B2: embedModelId는 Voyage/OpenAI 모델 ID.
 *             judgeModelId는 Anthropic 모델 ID.
 * BLOCKER B1: embedDim은 DDL 생성 시 사용. 매직넘버 하드코딩 금지.
 */
export interface DetectorConfig {
  // ---- 구조 게이트 임계값 ----
  /** 동일 argKey 반복 warning 임계 */
  WARNING: number
  /** 동일 argKey 반복 critical 임계 */
  CRITICAL: number
  /** 반복 상한 (circuit breaker) */
  circuitBreaker: number
  /** 슬라이딩 윈도 히스토리 크기 */
  historySize: number
  /** 동일 행동+에러 반복 warning 임계 */
  errLoopWarn: number
  /** 동일 행동+에러 반복 critical 임계 */
  errLoopCrit: number
  /** 동일 파일 편집 횟수 warning 임계 */
  fileEditWarn: number
  /** 동일 파일 편집 횟수 critical 임계 */
  fileEditCrit: number

  // ---- 의미 게이트 임계값 ----
  /** 코사인 유사도 임계 (의미 단계 통과 기준) */
  simThresh: number
  /** 최종 판정 신뢰도 임계 */
  decideThresh: number

  // ---- 가짜성공 프로브 임계값 ----
  /** 자기승인 감지 시간 임계 (ms) — warning */
  selfApprovalMs: number
  /** 자기승인 감지 시간 임계 (ms) — critical (Δt≈0) */
  selfApprovalCriticalMs: number

  // ---- judge 설정 ----
  /** self-consistency 표본 수 (기본 1 = 단일호출) */
  judgeSelfConsistencyN: number
  /** position swap 횟수 (기본 0 = swap 없음) */
  judgePositionSwaps: number

  // ---- 모델 설정 ----
  /**
   * 임베딩 모델 ID.
   * BLOCKER B2: Voyage 또는 OpenAI 모델 ID (Anthropic 금지).
   * 예: "voyage-3-lite", "text-embedding-3-small"
   */
  embedModelId: string
  /**
   * judge 모델 ID.
   * BLOCKER B2: Anthropic 모델 ID.
   * 예: "claude-3-5-sonnet-20241022"
   */
  judgeModelId: string
  /**
   * 임베딩 벡터 차원.
   * BLOCKER B1: DDL 생성 시 사용. 코드 상수 하드코딩 금지.
   */
  embedDim: number

  // ---- 알림 설정 (M4 신규 — BLOCKER C3: 평면 구조) ----
  /**
   * 디바운스 윈도우 (ms).
   * 동일 (sessionId, kind)에 대해 이 시간 내 재알림 억제.
   * 기본값: 60000 (1분)
   */
  notifyDebounceMs: number
  /**
   * 알림 채널 목록.
   * 기본값: ['desktop', 'cli']
   */
  notifyChannels: ('desktop' | 'webhook' | 'cli')[]
  /**
   * 웹훅 URL (webhook 채널 사용 시).
   * undefined이면 webhook 채널 비활성.
   */
  webhookUrl?: string
  /**
   * judgeError/deferred DetectionRecord에 대해 LOW_CONFIDENCE 알림 발송 여부.
   * 기본값: false (발송 안 함)
   */
  lowConfidenceNotify: boolean
}

/**
 * 캘리브레이션 격자 — DetectorConfig 평면 키의 candidate 배열.
 * BLOCKER C3: 중첩 구조 금지. 각 entry는 DetectorConfig의 부분 필드.
 */
export interface CalibrationGrid {
  candidates: Partial<DetectorConfig>[]
}

// ---- 4. SQLite 스키마 (WAL 모드. 운영=loopbreaker.db, 평가=loopbreaker-eval.db 분리) ----
// 완전한 DDL은 src/storage/migrations.ts 에 있음.
//
// 운영 DB 테이블:
//   events        — NormalizedEvent 영속화
//   embeddings    — sqlite-vec 메타 (cache_key PK = sha256(text)+':'+embedModelId)
//   vec_embeddings — sqlite-vec 가상 테이블 (float[embedDim], BLOCKER B1)
//   detections    — DetectionRecord 영속화
//   watch_offsets — 증분 파싱 바이트 오프셋 상태
//   detector_config — DetectorConfig 버전 스냅샷 (config_json 단일 컬럼, BLOCKER C3)
//   schema_version — 마이그레이션 버전 (단일행)
//
// 평가 DB 테이블:
//   gold_labels   — 골드셋 라벨 (span+point 겸용)
//   eval_metrics  — 평가 실행 결과
//   mock_cache    — 결정론 재현용 응답 모킹
//   schema_version — 마이그레이션 버전 (단일행, 운영과 독립)
//
// 캐시 키 규칙 (SPEC §1 표준 e):
//   cacheKey = sha256(canonicalPayload) + ':' + modelId
//   - 임베딩: payload = 정규화 텍스트, modelId = embedModelId
//   - judge:  payload = 정규화 프롬프트(JSON 키 정렬), modelId = judgeModelId
//
// mock_cache.kind: 'embed' | 'judge' (BLOCKER C9: 'embedding' 금지)
// gold_labels.source: 'live_jsonl' | 'synthetic' | 'dohyun_adapted' (BLOCKER C9)

// ---- 5. 평가/리플레이 ----
// ReplayEvent = NormalizedEvent (동일 정렬기 통과)
// GoldSampleEnvelope = { events: NormalizedEvent[], labels: GoldLabel[] }
//
// 매칭 규칙:
//   thrashing: 예측 윈도 vs gold span IoU >= 임계 → TP
//   false_success: anchor_uuid ±k 이벤트 매칭
// 클래스당 양성 <15건이면 F1/κ 대신 정성분석 폴백 (리포트에 명시)

// ---- 표준화 결정 요약 (SPEC §1 결정 a~g) ----
// (a) Detection 동의어 통일: 탐지의 Detection ≡ 평가의 DetectionVerdict (단일 이름)
// (b) StructuralCandidate ≡ StructureGateResult (단일 이름)
// (c) 모든 임계 → DetectorConfig 외부화, 코드 상수 금지, 평가가 같은 config 덮어씀
// (d) self_approval = 다신호(temporal+sameAuthorContext+circularReference+topicDivergence)
//     단일 시간 임계 신호 폐기
// (e) 캐시 키 = sha256(payload) + ':' + modelId (임베딩·judge 동일 규칙)
// (f) 정렬 = ts > parentUuid위상 > byteOffset, 고아 버퍼 후 flag flush, live=replay 동일 경로
// (g) DB = 운영/평가 분리, WAL, 평가는 운영 임베딩 캐시에 read-only ATTACH

// ---- 6. 알림 페이로드 (M4 신규 — §7-2 #7 정본) ----

import { z } from 'zod'

/**
 * 알림 심각도.
 * - 'critical'       : 고신뢰 thrashing/false_success
 * - 'warning'        : 중간 신뢰도
 * - 'low_confidence' : judgeError/deferred + lowConfidenceNotify=true 시
 * - 'meta'           : 비용상한 초과 등 시스템 이벤트
 */
export type NotificationSeverity = 'critical' | 'warning' | 'low_confidence' | 'meta'

/**
 * 알림 페이로드 — 사람 호출용 근거 동반.
 * §7-2 #7 정본. NotifyDispatcher가 NotifySink로 전달.
 */
export interface NotificationPayload {
  /** 세션 ID */
  sessionId: string
  /** 탐지 종류 (DetectionVerdict.kind 와 동일) */
  kind: 'thrashing' | 'false_success' | 'none' | 'meta'
  /** 세부 유형 */
  subtype: string
  /** 신뢰도 (0~1) */
  confidence: number
  /** 판정 이유 */
  reason: string
  /** 근거 목록 (사람 호출용 evidence) */
  evidence: { uuid: string; ts: number; note: string }[]
  /** 알림 발생 시각 (epoch ms, UTC) */
  ts: number
  /** 심각도 */
  severity: NotificationSeverity
  /** 디바운스/dedup 키 = sessionId + '\x1f' + kind */
  dedupeKey: string
}

/** zod 스키마 — NotificationPayload 검증 */
export const NotificationPayloadSchema = z.object({
  sessionId: z.string().min(1),
  kind: z.enum(['thrashing', 'false_success', 'none', 'meta']),
  subtype: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  evidence: z.array(
    z.object({
      uuid: z.string(),
      ts: z.number(),
      note: z.string(),
    })
  ),
  ts: z.number(),
  severity: z.enum(['critical', 'warning', 'low_confidence', 'meta']),
  dedupeKey: z.string().min(1),
})

// ---- 7. 알림 발송 채널 추상화 (M4 신규 — §2.1 (7), 테스트 부수효과 금지) ----

/**
 * 알림 발송 결과.
 * 각 채널 어댑터가 send() 후 반환.
 */
export interface NotifyResult {
  /** 발송 성공 여부 */
  success: boolean
  /** 발송된 채널 식별자 */
  channel: 'desktop' | 'webhook' | 'cli' | 'mock'
  /** 실패 시 오류 메시지 */
  error?: string
}

/**
 * 알림 채널 추상화 인터페이스.
 * 구현체:
 *   - DesktopNotifySink  : node-notifier (실제 OS 알림)
 *   - WebhookNotifySink  : HTTP POST
 *   - CliNotifySink      : CLI stderr/stdout 출력
 *   - MockNotifySink     : 테스트용 인메모리 수집 (부수효과 없음)
 *
 * 테스트는 반드시 MockNotifySink만 사용. 실제 OS 알림/네트워크 금지.
 */
export interface NotifySink {
  /**
   * 알림 페이로드를 발송한다.
   * 실패 시 throw 대신 NotifyResult{success:false, error:...}를 반환.
   * (NotifyDispatcher가 채널별 실패를 격리하기 위해 예외 대신 결과 반환 사용)
   */
  send(payload: NotificationPayload): Promise<NotifyResult>
}

// ---- DB 종류 구분 타입 ----
export type DbKind = 'op' | 'eval'

// ---- 기본 DetectorConfig 값 ----
/**
 * DetectorConfig 기본값.
 * SPEC §1 주석 기준. embedDim은 config.json에서 설정.
 * BLOCKER B2: embedModelId/judgeModelId는 예시값이며 실제는 config.json에서 지정.
 */
export const DEFAULT_DETECTOR_CONFIG: Readonly<DetectorConfig> = Object.freeze({
  WARNING: 10,
  CRITICAL: 20,
  circuitBreaker: 30,
  historySize: 30,
  errLoopWarn: 3,
  errLoopCrit: 5,
  fileEditWarn: 5,
  fileEditCrit: 8,
  simThresh: 0.90,
  decideThresh: 0.7,
  selfApprovalMs: 15000,
  selfApprovalCriticalMs: 1000,
  judgeSelfConsistencyN: 1,
  judgePositionSwaps: 0,
  // BLOCKER B2: Voyage/OpenAI 모델. 실제 값은 config.json에서 오버라이드.
  embedModelId: 'voyage-3-lite',
  judgeModelId: 'claude-3-5-sonnet-20241022',
  // BLOCKER B1: DDL 생성 시 이 값 사용. 매직넘버 코드 상수 금지.
  embedDim: 1024,
  // M4 알림 기본값
  notifyDebounceMs: 60000,
  // Object.freeze로 배열도 불변 동결 (런타임 보호). 타입 호환을 위해 cast.
  notifyChannels: Object.freeze(['desktop', 'cli']) as unknown as ('desktop' | 'webhook' | 'cli')[],
  webhookUrl: undefined,
  lowConfidenceNotify: false,
} satisfies DetectorConfig)
