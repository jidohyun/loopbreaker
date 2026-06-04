/**
 * tests/daemon-end-to-end.test.ts
 *
 * M5 데몬 통합 end-to-end 테스트 (SPEC §3.3 메인루프).
 *
 * Daemon.start() → MockWatchSource.triggerAppear/triggerChange →
 * SessionPipeline(gate→bridge→runM3Pipeline→dispatch) → MockNotifySink →
 * Daemon.stop()(graceful drain) 전체 라이프사이클을 검증한다.
 *
 * 부수효과 0 (M5 최우선 계약):
 *   - 파일감시: MockWatchSource (chokidar 미사용, 수동 트리거)
 *   - API: 인라인 Mock Embed/Judge (네트워크·API키 0)
 *   - 알림: MockNotifySink (실제 OS 데스크톱 알림 0)
 *   - lock: os.tmpdir() 하위 임시경로 (실제 ~/.loopbreaker/daemon.lock 미사용)
 *   - DB: os.tmpdir() 하위 임시 파일 (실제 ops.db 미사용)
 */

import { afterEach, describe, expect, test } from '@jest/globals'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Daemon, type DaemonOptions } from '../src/daemon/daemon.js'
import { MockWatchSource } from '../src/watch/mock-watch-source.js'
import { MockNotifySink } from '../src/notify/sinks/mock-notify-sink.js'
import { ConfigManager } from '../src/config/config-manager.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'
import { acquireLock, releaseLock } from '../src/daemon/lockfile.js'
import type { ApiClients } from '../src/api/api-clients.js'
import type { EmbedClient } from '../src/api/embed-client.js'
import type { JudgeClient, JudgeRequest } from '../src/api/judge-client.js'
import type { JudgeVerdict } from '../src/contracts.js'
import type { LoopBreakerConfig } from '../src/config/config-schema.js'

// ── 임시경로 관리 ─────────────────────────────────────────────────────────────

const _tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lb-m5-daemon-'))
  _tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (_tmpDirs.length > 0) {
    const dir = _tmpDirs.pop()
    if (dir !== undefined) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // 정리 실패는 테스트 결과에 영향 없음
      }
    }
  }
})

// ── 인라인 Mock API 클라이언트 ────────────────────────────────────────────────

/**
 * 어떤 텍스트가 와도 동일 벡터를 반환하는 인라인 MockEmbedClient.
 * 동일 벡터 → cosine=1.0 → simThresh 통과 → judge 호출.
 * (정식 MockEmbedClient는 미등록 텍스트에 throw하므로 SessionPipeline 내부
 *  embed 텍스트 생성 규칙에 결합되지 않도록 인라인 Mock을 사용한다.)
 */
function makeUniformEmbedClient(dim = DEFAULT_DETECTOR_CONFIG.embedDim): EmbedClient {
  const vec = Array.from({ length: dim }, (_, i) => (i === 0 ? 1 : 0))
  return {
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(() => [...vec])
    },
  }
}

/** 고정 JudgeVerdict를 항상 반환하는 인라인 MockJudgeClient. */
function makeFixedJudgeClient(verdict: JudgeVerdict): JudgeClient {
  return {
    async judge(_req: JudgeRequest): Promise<JudgeVerdict> {
      return { ...verdict, rawSamples: [...verdict.rawSamples] }
    },
  }
}

const THRASHING_VERDICT: JudgeVerdict = {
  kind: 'thrashing',
  subtype: 'file_edit_loop',
  confidence: 0.92, // >= decideThresh(0.7) → 발화
  reason: '동일 파일 반복 편집 루프 감지 (테스트 픽스처).',
  rawSamples: [],
}

const NONE_VERDICT: JudgeVerdict = {
  kind: 'none',
  subtype: 'inconclusive',
  confidence: 0.1,
  reason: '탐지 신호 없음 (테스트 픽스처).',
  rawSamples: [],
}

function makeApiClients(judgeVerdict: JudgeVerdict): ApiClients {
  return {
    embedClient: makeUniformEmbedClient(),
    judgeClient: makeFixedJudgeClient(judgeVerdict),
    isReal: false,
  }
}

// ── 테스트 config ─────────────────────────────────────────────────────────────

/**
 * 발화하기 쉬운 테스트 config: 임계값을 기본값보다 낮춰 적은 라인으로 게이트 통과.
 * notifyChannels는 ['cli']로 (실제 데스크톱 알림 회피, sink는 DI Mock).
 */
function makeTestConfig(): LoopBreakerConfig {
  const c = DEFAULT_DETECTOR_CONFIG
  return {
    version: 1,
    detector: {
      WARNING: c.WARNING,
      CRITICAL: c.CRITICAL,
      circuitBreaker: c.circuitBreaker,
      historySize: c.historySize,
      errLoopWarn: c.errLoopWarn,
      errLoopCrit: c.errLoopCrit,
      fileEditWarn: 3, // 기본 5 → 3으로 낮춰 적은 라인으로 발화
      fileEditCrit: 4,
      simThresh: c.simThresh,
      decideThresh: c.decideThresh,
      selfApprovalMs: c.selfApprovalMs,
      selfApprovalCriticalMs: c.selfApprovalCriticalMs,
      judgeSelfConsistencyN: c.judgeSelfConsistencyN,
      judgePositionSwaps: c.judgePositionSwaps,
      embedModelId: c.embedModelId,
      judgeModelId: c.judgeModelId,
      embedDim: c.embedDim,
      notifyDebounceMs: c.notifyDebounceMs,
      notifyChannels: ['cli'],
      webhookUrl: undefined,
      lowConfidenceNotify: c.lowConfidenceNotify,
    },
    privacy: {
      redactFilePaths: true,
      sendCodeToApi: 'none',
      maxSnippetChars: 2000,
      embedReasoning: false,
    },
    api: {
      maxConcurrentApiCalls: 4,
      apiMaxRetries: 3,
      dailyCostCapUsd: 5,
      maxJudgeCallsPerSession: 50,
    },
    watch: {
      sessionGlob: '~/.claude/projects/**/*.jsonl',
      pollSafetyIntervalMs: 3000,
      usePollingFallback: 'auto',
      orphanTimeoutMs: 5000,
    },
    webhook: { url: null, minSeverity: 'high' },
    notify: { desktop: true, includeEvidence: true, notifyDebounceMs: 60000 },
  }
}

// ── thrashing 유발 JSONL 라인 ─────────────────────────────────────────────────

let _seq = 0

/** 동일 파일을 반복 편집하는 tool_use(Edit) 라인 (file_edit_loop 유발). */
function editLine(sessionId: string, targetFile: string, oldS: string, newS: string): string {
  _seq += 1
  return JSON.stringify({
    type: 'assistant',
    uuid: `evt-${_seq}`,
    parentUuid: null,
    sessionId,
    cwd: '/proj',
    timestamp: new Date(1_700_000_000_000 + _seq * 1000).toISOString(),
    isSidechain: false,
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: `tu-${_seq}`,
          name: 'Edit',
          input: { file_path: targetFile, old_string: oldS, new_string: newS },
        },
      ],
    },
  })
}

function writeThrashingFile(filePath: string, sessionId: string, n: number): void {
  const lines: string[] = []
  for (let i = 0; i < n; i += 1) {
    lines.push(editLine(sessionId, '/proj/a.ts', `v${i}`, `v${i + 1}`))
  }
  writeFileSync(filePath, lines.join('\n') + '\n')
}

// ── 데몬 빌더 ─────────────────────────────────────────────────────────────────

interface Harness {
  daemon: Daemon
  watch: MockWatchSource
  sink: MockNotifySink
  sessionFile: string
  sessionId: string
}

function buildHarness(judgeVerdict: JudgeVerdict): Harness {
  const dir = makeTmpDir()
  const opDbPath = join(dir, 'ops.db')
  const lockPath = join(dir, 'daemon.lock')
  const sessionId = 'sess-e2e-1'
  const sessionFile = join(dir, 'session.jsonl')

  const watch = new MockWatchSource()
  const sink = new MockNotifySink()

  const opts: DaemonOptions = {
    paths: { opDbPath, lockPath },
    configManager: ConfigManager.fromConfig(makeTestConfig()),
    watchSource: watch,
    sinks: [sink],
    apiClients: makeApiClients(judgeVerdict),
  }

  return { daemon: new Daemon(opts), watch, sink, sessionFile, sessionId }
}

/** SessionPipeline 직렬 큐가 drain되도록 enqueue를 다시 await한다. */
async function drainSession(daemon: Daemon, sessionId: string): Promise<void> {
  const pipeline = daemon.registry?.pipeline(sessionId)
  if (pipeline !== undefined && !pipeline.isClosed) {
    await pipeline.enqueueChange()
  }
}

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('M5 Daemon end-to-end (SPEC §3.3)', () => {
  test('thrashing 세션 → MockNotifySink에 알림 1건 (gate→bridge→m3→dispatch)', async () => {
    const h = buildHarness(THRASHING_VERDICT)
    writeThrashingFile(h.sessionFile, h.sessionId, 5)

    await h.daemon.start()
    expect(h.daemon.isRunning).toBe(true)

    // 세션 등장 + 변경 트리거 (MockWatchSource — 실제 fs.watch 0)
    h.watch.triggerAppear(h.sessionId, h.sessionFile)
    h.watch.triggerChange(h.sessionId, h.sessionFile)

    // 직렬 큐 drain 대기
    await drainSession(h.daemon, h.sessionId)

    // 알림 1건 발화 (고신뢰 thrashing)
    expect(h.sink.count).toBe(1)
    expect(h.sink.last?.payload.kind).toBe('thrashing')
    expect(h.sink.last?.result.success).toBe(true)

    const errors = await h.daemon.stop()
    expect(errors).toEqual([])
    expect(h.daemon.isRunning).toBe(false)
  })

  test("kind='none' verdict → 미발송", async () => {
    const h = buildHarness(NONE_VERDICT)
    writeThrashingFile(h.sessionFile, h.sessionId, 5)

    await h.daemon.start()
    h.watch.triggerAppear(h.sessionId, h.sessionFile)
    h.watch.triggerChange(h.sessionId, h.sessionFile)
    await drainSession(h.daemon, h.sessionId)

    expect(h.sink.count).toBe(0)

    await h.daemon.stop()
  })

  test('동일 세션 재변경 → 디바운스로 2번째 미발송 (총 1건)', async () => {
    const h = buildHarness(THRASHING_VERDICT)
    writeThrashingFile(h.sessionFile, h.sessionId, 5)

    await h.daemon.start()
    h.watch.triggerAppear(h.sessionId, h.sessionFile)
    h.watch.triggerChange(h.sessionId, h.sessionFile)
    await drainSession(h.daemon, h.sessionId)
    expect(h.sink.count).toBe(1)

    // 같은 세션 추가 라인 → 재변경 (notifyDebounceMs=60000 윈도 내 → 억제)
    writeThrashingFile(h.sessionFile, h.sessionId, 3)
    h.watch.triggerChange(h.sessionId, h.sessionFile)
    await drainSession(h.daemon, h.sessionId)

    expect(h.sink.count).toBe(1) // 디바운스로 2번째 미발송

    await h.daemon.stop()
  })

  test('세션 제거 → 파이프라인 drainAndClose 후 맵에서 제거', async () => {
    const h = buildHarness(THRASHING_VERDICT)
    writeThrashingFile(h.sessionFile, h.sessionId, 5)

    await h.daemon.start()
    h.watch.triggerAppear(h.sessionId, h.sessionFile)
    expect(h.daemon.registry?.pipeline(h.sessionId)).toBeDefined()

    h.watch.triggerRemove(h.sessionId, h.sessionFile)
    // remove 콜백은 floating promise → 잠시 대기 위해 빈 마이크로태스크 flush
    await Promise.resolve()
    await new Promise((r) => setImmediate(r))

    expect(h.daemon.registry?.pipeline(h.sessionId)).toBeUndefined()

    await h.daemon.stop()
  })

  test('단일 인스턴스 보증: lock 점유 중이면 두 번째 데몬 start 거부', async () => {
    const h = buildHarness(THRASHING_VERDICT)
    await h.daemon.start()

    // 같은 lockPath를 점유한 두 번째 데몬은 start 시 throw
    const dir2 = h.sessionFile.replace(/\/session\.jsonl$/, '')
    const lockPath = join(dir2, 'daemon.lock')
    const handle = (() => {
      try {
        return acquireLock(lockPath)
      } catch {
        return null
      }
    })()
    // 이미 데몬이 점유 중이므로 외부 acquireLock도 거부돼야 한다
    expect(handle).toBeNull()

    await h.daemon.stop()

    // 데몬 종료 후에는 lock 해제 → 재획득 가능
    const reacquired = acquireLock(lockPath)
    expect(reacquired.lockPath).toBe(lockPath)
    releaseLock(reacquired)
  })

  test('stop()은 멱등 — 미기동/중복 호출에 안전', async () => {
    const h = buildHarness(THRASHING_VERDICT)
    // 미기동 상태 stop → 빈 배열
    expect(await h.daemon.stop()).toEqual([])

    await h.daemon.start()
    expect(await h.daemon.stop()).toEqual([])
    // 중복 stop → 빈 배열
    expect(await h.daemon.stop()).toEqual([])
  })
})
