/**
 * api/api-clients.ts — ApiClients 팩토리
 *
 * config의 embedModelId/apiKey 유무로 EmbedClient/JudgeClient 구현을 선택한다.
 *   - API 키가 있고 Real 구현이 가능하면 Real 스텁 인스턴스 반환
 *   - API 키 없음 또는 명시적 Mock 모드이면 Mock 폴백
 *
 * M5 범위:
 *   - RealEmbedClient / AnthropicJudgeClient 는 NotImplementedError throw 스텁
 *   - 팩토리 조립과 DI 경로만 완성 (Real 구현 본체는 M6+ 담당)
 *   - 테스트는 항상 Mock을 DI로 주입 (네트워크·API 키 불필요)
 *
 * SPEC §3.1 제약:
 *   - console.log 금지 (주입된 logger/구조화 이벤트 사용)
 *   - 새 npm 의존성 추가 금지
 */

import { type EmbedClient, MockEmbedClient } from './embed-client.js'
import { type JudgeClient, MockJudgeClient } from './judge-client.js'
import { RealEmbedClient } from './real-embed-client.js'
import { AnthropicJudgeClient, NotImplementedError } from './anthropic-judge-client.js'

// re-export for test convenience
export { NotImplementedError }

// ── 로거 인터페이스 ────────────────────────────────────────────────────────────

export interface ApiClientsLogger {
  warn(msg: string, extra?: Record<string, unknown>): void
  info(msg: string, extra?: Record<string, unknown>): void
}

const noopLogger: ApiClientsLogger = {
  warn: () => undefined,
  info: () => undefined,
}

// ── ApiClients 결과 ────────────────────────────────────────────────────────────

/**
 * 팩토리가 반환하는 API 클라이언트 묶음.
 */
export interface ApiClients {
  readonly embedClient: EmbedClient
  readonly judgeClient: JudgeClient
  /** true = Real 스텁, false = Mock */
  readonly isReal: boolean
}

// ── 팩토리 옵션 ───────────────────────────────────────────────────────────────

/**
 * createApiClients 옵션.
 *
 * 일반 사용 (데몬 기동):
 *   createApiClients({ embedModelId: 'voyage-3-lite', judgeModelId: 'claude-3-5-sonnet-20241022', apiKey: process.env.ANTHROPIC_API_KEY })
 *
 * 테스트 사용:
 *   createApiClients({ mock: true }) 또는
 *   createApiClients({ embedClient: myMock, judgeClient: myMock })
 */
export interface ApiClientsOptions {
  /** 임베딩 모델 ID. Real 경로에 필요. */
  readonly embedModelId?: string
  /** judge 모델 ID. Real 경로에 필요. */
  readonly judgeModelId?: string
  /** API 키 (embed + judge 공용). Real 경로에 필요. */
  readonly apiKey?: string
  /** 명시적 Mock 모드 강제. true이면 API 키 유무와 무관하게 Mock 반환. */
  readonly mock?: boolean
  /** DI: 외부에서 직접 주입할 EmbedClient (테스트용). mock보다 우선. */
  readonly embedClient?: EmbedClient
  /** DI: 외부에서 직접 주입할 JudgeClient (테스트용). mock보다 우선. */
  readonly judgeClient?: JudgeClient
  /** 구조화 로그 대상 */
  readonly logger?: ApiClientsLogger
}

// ── 팩토리 함수 ───────────────────────────────────────────────────────────────

/**
 * config의 embedModelId / apiKey 유무로 EmbedClient / JudgeClient 구현을 선택한다.
 *
 * 선택 우선순위:
 *   1. opts.embedClient / opts.judgeClient 가 있으면 그것을 사용 (DI 최우선)
 *   2. opts.mock === true → MockEmbedClient(빈 픽스처) + MockJudgeClient(빈 맵)
 *   3. embedModelId와 apiKey 가 모두 있으면 Real 스텁 반환 (isReal=true)
 *   4. 그 외 → Mock 폴백 (isReal=false, 경고 로그)
 *
 * @returns ApiClients { embedClient, judgeClient, isReal }
 */
export function createApiClients(opts: ApiClientsOptions = {}): ApiClients {
  const logger = opts.logger ?? noopLogger

  // ── 1. DI 주입 우선 ─────────────────────────────────────────────────────────
  if (opts.embedClient !== undefined || opts.judgeClient !== undefined) {
    const embedClient = opts.embedClient ?? new MockEmbedClient([], 1024)
    const judgeClient = opts.judgeClient ?? new MockJudgeClient()
    logger.info('api-clients: DI 주입 클라이언트 사용', {
      embedClient: opts.embedClient !== undefined ? 'injected' : 'mock-fallback',
      judgeClient: opts.judgeClient !== undefined ? 'injected' : 'mock-fallback',
    })
    return { embedClient, judgeClient, isReal: false }
  }

  // ── 2. 명시적 Mock 모드 ─────────────────────────────────────────────────────
  if (opts.mock === true) {
    logger.info('api-clients: Mock 모드 강제 (opts.mock=true)')
    return {
      embedClient: new MockEmbedClient([], 1024),
      judgeClient: new MockJudgeClient(),
      isReal: false,
    }
  }

  // ── 3. Real 스텁 경로 (embedModelId + apiKey 모두 필요) ────────────────────
  const { embedModelId, judgeModelId, apiKey } = opts

  if (embedModelId && apiKey) {
    const resolvedJudgeModelId = judgeModelId ?? 'claude-3-5-sonnet-20241022'
    logger.info('api-clients: Real 스텁 클라이언트 사용', {
      embedModelId,
      judgeModelId: resolvedJudgeModelId,
    })
    return {
      embedClient: new RealEmbedClient(embedModelId, apiKey),
      judgeClient: new AnthropicJudgeClient(apiKey, resolvedJudgeModelId),
      isReal: true,
    }
  }

  // ── 4. Mock 폴백 (키 없음 또는 모델 ID 없음) ──────────────────────────────
  if (!apiKey) {
    logger.warn(
      'api-clients: API 키 없음 — Mock 클라이언트로 폴백. ' +
      '운영 시 ANTHROPIC_API_KEY 또는 VOYAGE_API_KEY 환경변수를 설정하세요.',
      { embedModelId, judgeModelId },
    )
  } else if (!embedModelId) {
    logger.warn('api-clients: embedModelId 없음 — Mock 클라이언트로 폴백.', {
      judgeModelId,
    })
  }

  return {
    embedClient: new MockEmbedClient([], 1024),
    judgeClient: new MockJudgeClient(),
    isReal: false,
  }
}
