// src/config/config-manager.ts
// ConfigManager — 중첩 LoopBreakerConfig→평면 DetectorConfig 매핑 어댑터 + 핫리로드(SPEC §6.1).
//
// 역할:
//   1. loadConfig()로 초기 설정을 읽고 toDetectorConfig()로 평면화
//   2. onReload(callback) — 외부(데몬 메인루프)가 새 config를 주입하면
//      안전 필드만 무중단으로 getConfig() 반환값에 반영
//   3. 위험 필드(DB경로·sessionGlob·embedDim·embedModelId·judgeModelId) 변경 감지 시
//      변경 거부 + 경고 로그
//   4. 재검증 실패 시 이전 유효 설정 유지(데몬 안 죽임)
//
// 부수효과 없음(파일 감시는 이 클래스 바깥에서 담당).

import { type LoopBreakerConfig, loopBreakerConfigSchema } from './config-schema.js'
import { loadConfig, toDetectorConfig } from './config-loader.js'
import { type DetectorConfig } from '../contracts.js'

// ── 안전 필드 / 위험 필드 분류 (SPEC §6.1 + Seed constraints 정본) ─────────────

/**
 * 위험 필드 키 목록 (재기동 요구, 변경 거부).
 *   - DB 경로: StorageLayer 이미 열려있어 변경 불가
 *   - watch.sessionGlob: WatchSource 이미 시작됨
 *   - embedDim: sqlite-vec 테이블 DDL 확정
 *   - embedModelId / judgeModelId: 기존 캐시/벡터와 차원 불일치 위험
 */
const DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  'embedDim',
  'embedModelId',
  'judgeModelId',
])

/**
 * 위험 watch 필드 키 목록 (watch 섹션 내부).
 */
const DANGEROUS_WATCH_KEYS: ReadonlySet<string> = new Set(['sessionGlob'])

// ── 로거 인터페이스 ────────────────────────────────────────────────────────────

export interface ConfigManagerLogger {
  warn(msg: string, extra?: Record<string, unknown>): void
  info(msg: string, extra?: Record<string, unknown>): void
}

/** no-op 기본 로거 (테스트에서는 Mock으로 교체 가능) */
const noopLogger: ConfigManagerLogger = {
  warn: () => undefined,
  info: () => undefined,
}

// ── ConfigManager ──────────────────────────────────────────────────────────────

/**
 * onReload 콜백 타입.
 * 데몬 메인루프가 ConfigManager에 등록한 뒤, 핫리로드 발생 시 새 DetectorConfig를 받는다.
 */
export type OnReloadCallback = (next: DetectorConfig) => void

/**
 * ConfigManager 옵션.
 */
export interface ConfigManagerOptions {
  /** 설정 파일 경로 (기본: ~/.loopbreaker/config.json) */
  configPath?: string
  /** 구조화 로그 대상 */
  logger?: ConfigManagerLogger
}

/**
 * ConfigManager.
 *
 * 사용 예:
 * ```ts
 * const mgr = ConfigManager.create({ configPath: '/tmp/config.json' })
 * mgr.onReload((next) => applyHotReload(next, context))
 * // 파일 변경 감지 후:
 * const fresh = loadConfig(configPath)
 * mgr.reload(fresh)
 * ```
 */
export class ConfigManager {
  private _loopBreakerConfig: LoopBreakerConfig
  private _detectorConfig: DetectorConfig
  private readonly _logger: ConfigManagerLogger
  private readonly _reloadCallbacks: OnReloadCallback[] = []

  private constructor(
    loopBreakerConfig: LoopBreakerConfig,
    logger: ConfigManagerLogger,
  ) {
    this._loopBreakerConfig = loopBreakerConfig
    this._detectorConfig = toDetectorConfig(loopBreakerConfig)
    this._logger = logger
  }

  // ── 팩토리 ────────────────────────────────────────────────────────────────

  /**
   * 설정 파일에서 초기화한 ConfigManager를 생성한다.
   * 파일이 없으면 zod 기본값으로 구성.
   */
  static create(opts: ConfigManagerOptions = {}): ConfigManager {
    const logger = opts.logger ?? noopLogger
    const config = loadConfig(opts.configPath)
    return new ConfigManager(config, logger)
  }

  /**
   * 이미 로드된 LoopBreakerConfig로 초기화 (테스트용).
   */
  static fromConfig(
    config: LoopBreakerConfig,
    logger: ConfigManagerLogger = noopLogger,
  ): ConfigManager {
    return new ConfigManager(config, logger)
  }

  // ── 읽기 API ──────────────────────────────────────────────────────────────

  /** 현재 평면 DetectorConfig를 반환한다 (항상 안전 필드 기준 최신값). */
  getConfig(): DetectorConfig {
    return this._detectorConfig
  }

  /** 현재 중첩 LoopBreakerConfig를 반환한다 (원본 구조). */
  getLoopBreakerConfig(): LoopBreakerConfig {
    return this._loopBreakerConfig
  }

  // ── 핫리로드 API ──────────────────────────────────────────────────────────

  /**
   * 핫리로드 콜백 등록.
   * 안전 필드가 변경되어 적용될 때마다 새 DetectorConfig를 인자로 호출된다.
   */
  onReload(callback: OnReloadCallback): void {
    this._reloadCallbacks.push(callback)
  }

  /**
   * 외부(파일 감시 핸들러)가 새 LoopBreakerConfig를 주입할 때 호출한다.
   *
   * 처리 순서:
   *   1. zod 재검증 (실패 시 이전 설정 유지, 경고 로그)
   *   2. 위험 필드 변경 감지 → 변경 거부 + 경고 로그 (데몬 안 죽임)
   *   3. 안전 필드만 새 config에서 추출해 DetectorConfig 업데이트
   *   4. 등록된 onReload 콜백 전부 호출
   *
   * @param rawOrConfig raw unknown (파일 재파싱) 또는 검증된 LoopBreakerConfig
   * @returns true = 안전 필드 적용됨, false = 검증 실패 또는 변경 없음
   */
  reload(rawOrConfig: unknown): boolean {
    // ── 1. zod 재검증 ────────────────────────────────────────────────────────
    const parseResult = loopBreakerConfigSchema.safeParse(rawOrConfig)
    if (!parseResult.success) {
      const issues = parseResult.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ')
      this._logger.warn('config-manager: 핫리로드 검증 실패 — 이전 설정 유지', {
        issues,
      })
      return false
    }

    const next = parseResult.data

    // ── 2. 위험 필드 변경 감지 ───────────────────────────────────────────────
    const dangerChanges = this._detectDangerousChanges(next)
    if (dangerChanges.length > 0) {
      this._logger.warn(
        'config-manager: 위험 필드 변경 감지 — 데몬 재기동 필요, 변경 거부',
        { changedFields: dangerChanges },
      )
      // 위험 필드가 변경된 경우에도 안전 필드는 적용한다
      // (SPEC §6.1: 위험필드 변경은 거부하되, 안전 필드는 무중단 적용)
    }

    // ── 3. 안전 필드만 추출해 DetectorConfig 업데이트 ────────────────────────
    const newDetectorConfig = this._mergeSafeFields(
      this._loopBreakerConfig,
      next,
    )

    // Preserve dangerous fields in the stored LoopBreakerConfig regardless of
    // whether safe fields changed — dangerous field changes are always rejected.
    const safeLoopBreakerConfig: LoopBreakerConfig = dangerChanges.length > 0
      ? {
          ...next,
          detector: {
            ...next.detector,
            embedDim: this._loopBreakerConfig.detector.embedDim,
            embedModelId: this._loopBreakerConfig.detector.embedModelId,
            judgeModelId: this._loopBreakerConfig.detector.judgeModelId,
          },
          watch: {
            ...next.watch,
            sessionGlob: this._loopBreakerConfig.watch.sessionGlob,
          },
        }
      : next

    // Check if safe fields actually changed
    if (!this._hasChanged(this._detectorConfig, newDetectorConfig)) {
      this._loopBreakerConfig = safeLoopBreakerConfig
      return false
    }

    this._loopBreakerConfig = safeLoopBreakerConfig
    this._detectorConfig = newDetectorConfig

    this._logger.info('config-manager: 안전 필드 핫리로드 적용 완료', {
      dangerChanges,
    })

    // ── 4. onReload 콜백 호출 ────────────────────────────────────────────────
    for (const cb of this._reloadCallbacks) {
      try {
        cb(this._detectorConfig)
      } catch (err) {
        this._logger.warn('config-manager: onReload 콜백 예외 (무시)', {
          error: String(err),
        })
      }
    }

    return true
  }

  // ── 내부 헬퍼 ─────────────────────────────────────────────────────────────

  /**
   * 위험 필드가 변경됐는지 확인한다.
   * detector 섹션의 DANGEROUS_KEYS와 watch 섹션의 DANGEROUS_WATCH_KEYS를 검사.
   */
  private _detectDangerousChanges(next: LoopBreakerConfig): string[] {
    const changed: string[] = []

    // detector 위험 필드
    for (const key of DANGEROUS_KEYS) {
      const prev = (this._loopBreakerConfig.detector as Record<string, unknown>)[key]
      const nextVal = (next.detector as Record<string, unknown>)[key]
      if (prev !== nextVal) {
        changed.push(`detector.${key}`)
      }
    }

    // watch 위험 필드
    for (const key of DANGEROUS_WATCH_KEYS) {
      const prev = (this._loopBreakerConfig.watch as Record<string, unknown>)[key]
      const nextVal = (next.watch as Record<string, unknown>)[key]
      if (prev !== nextVal) {
        changed.push(`watch.${key}`)
      }
    }

    return changed
  }

  /**
   * 안전 필드만 next config에서 가져와 새 DetectorConfig를 생성한다.
   * 위험 필드는 이전 config(_loopBreakerConfig)의 값을 유지.
   *
   * 안전 필드 (SPEC 6.1 + Seed constraints):
   *   - 임계값: WARNING, CRITICAL, circuitBreaker, historySize, errLoopWarn, errLoopCrit, fileEditWarn, fileEditCrit
   *   - 의미 게이트: simThresh, decideThresh
   *   - 가짜성공 프로브: selfApprovalMs, selfApprovalCriticalMs
   *   - judge 설정: judgeSelfConsistencyN, judgePositionSwaps
   *   - 알림: notifyDebounceMs, notifyChannels, webhookUrl, lowConfidenceNotify
   *   - privacy, api 상한
   */
  private _mergeSafeFields(
    prev: LoopBreakerConfig,
    next: LoopBreakerConfig,
  ): DetectorConfig {
    // 위험 필드는 이전 값으로 고정한 '병합 detector' 생성
    const mergedDetector = {
      ...next.detector,
      // 위험 필드 고정 (이전 값 유지)
      embedDim: prev.detector.embedDim,
      embedModelId: prev.detector.embedModelId,
      judgeModelId: prev.detector.judgeModelId,
    }

    const mergedWatch = {
      ...next.watch,
      // 위험 watch 필드 고정
      sessionGlob: prev.watch.sessionGlob,
    }

    // 병합된 config를 toDetectorConfig에 전달
    const mergedConfig: LoopBreakerConfig = {
      ...next,
      detector: mergedDetector,
      watch: mergedWatch,
    }

    return toDetectorConfig(mergedConfig)
  }

  /**
   * 두 DetectorConfig가 안전 필드 기준으로 다른지 비교한다 (얕은 비교).
   */
  private _hasChanged(prev: DetectorConfig, next: DetectorConfig): boolean {
    const keys = Object.keys(next) as (keyof DetectorConfig)[]
    for (const key of keys) {
      const pv = prev[key]
      const nv = next[key]
      // 배열 비교 (notifyChannels)
      if (Array.isArray(pv) && Array.isArray(nv)) {
        if (pv.length !== nv.length) return true
        if (pv.some((v, i) => v !== nv[i])) return true
        continue
      }
      if (pv !== nv) return true
    }
    return false
  }
}
