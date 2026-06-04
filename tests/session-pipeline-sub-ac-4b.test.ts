/**
 * tests/session-pipeline-sub-ac-4b.test.ts
 *
 * Sub-AC 4b: SessionPipeline 생성자 또는 팩토리가 주입된 embedClient·judgeClient를
 * 내부 필드로 저장하고, pipeline 실행 시 해당 Mock 인스턴스의 메서드가
 * 실제로 호출되는지 검증하는 단위 테스트.
 *
 * 검증 항목:
 *   1. SessionPipeline._deps.embedClient / .judgeClient가 주입된 인스턴스와 동일한 참조
 *   2. pipeline 실행 시 embedClient.embed()가 실제로 호출됨 (spy call-count assert)
 *   3. pipeline 실행 시 judgeClient.judge()가 실제로 호출됨 (spy call-count assert)
 *   4. jest.spyOn으로 call-count를 추적하는 표준적 spy 패턴 검증
 *   5. 이벤트 없음/임계값 미달 시 embed/judge 미호출
 *
 * 테스트 원칙 (M5 최우선 계약):
 *   - 실제 fs.watch·네트워크·OS알림 0
 *   - DB = tmpdir 파일 (sqlite-vec/WAL 한계)
 *   - MockNotifySink 사용
 *   - SpyEmbedClient / SpyJudgeClient (인터페이스 구현, 네트워크 없음)
 *   - lockfile = 불필요 (파이프라인 단위 테스트)
 *
 * 게이트 통과 전략:
 *   Bash 같은 커맨드를 11번 반복 → argKey 동일 → repeatN=11 >= WARNING(10) → 게이트 발화
 *   → hits → bridge → runM3Pipeline(spyEmbed, spyJudge) → embed/judge 호출됨
 */

import { describe, expect, it, jest } from '@jest/globals'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { SessionPipeline } from '../src/daemon/session-pipeline.js'
import { StorageLayer } from '../src/storage/storage-layer.js'
import { MockNotifySink } from '../src/notify/sinks/mock-notify-sink.js'
import { NotifyDispatcher } from '../src/notify/notify-dispatcher.js'
import { CooldownStore } from '../src/notify/cooldown-store.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'
import type { EmbedClient } from '../src/api/embed-client.js'
import type { JudgeClient, JudgeRequest } from '../src/api/judge-client.js'
import type { JudgeVerdict } from '../src/contracts.js'
import type { SessionPipelineDeps } from '../src/daemon/session-pipeline.js'

// ─── 테스트 전용 Spy 클라이언트 ─────────────────────────────────────────────

/**
 * 호출 횟수를 추적하는 Spy EmbedClient.
 * embed() 호출 시 EmbedClientError를 throw → runM3Pipeline fail-closed 경로.
 * 파이프라인 자체는 죽지 않음 (SPEC §4d).
 */
class SpyEmbedClient implements EmbedClient {
  #callCount = 0
  #callArgs: string[][] = []

  get embedCallCount(): number { return this.#callCount }
  get callArgs(): readonly string[][] { return this.#callArgs }

  async embed(texts: string[]): Promise<number[][]> {
    this.#callCount++
    this.#callArgs.push([...texts])
    // fail-closed: throw → runM3Pipeline이 해당 hit를 skip (파이프라인 안 죽음)
    const { EmbedClientError } = await import('../src/api/embed-client.js')
    throw new EmbedClientError(
      `SpyEmbedClient: 의도적 실패 (call #${this.#callCount})`,
    )
  }
}

/**
 * 높은 코사인 유사도를 반환하는 Spy EmbedClient.
 * 균일 벡터 반환 → 코사인 유사도 = 1.0 → simThresh(0.90) 통과 → judge 단계 도달.
 */
class SpyEmbedClientHighSim implements EmbedClient {
  readonly #dim: number
  #callCount = 0

  constructor(dim: number) { this.#dim = dim }
  get embedCallCount(): number { return this.#callCount }

  async embed(texts: string[]): Promise<number[][]> {
    this.#callCount++
    const val = 1 / Math.sqrt(this.#dim)
    return texts.map(() => Array<number>(this.#dim).fill(val))
  }
}

/**
 * 호출 횟수를 추적하는 Spy JudgeClient.
 * judge() 호출 시 kind='none' verdict 반환 (알림 미발화).
 */
class SpyJudgeClient implements JudgeClient {
  #callCount = 0
  #callRequests: JudgeRequest[] = []

  get judgeCallCount(): number { return this.#callCount }
  get callRequests(): readonly JudgeRequest[] { return this.#callRequests }

  async judge(req: JudgeRequest): Promise<JudgeVerdict> {
    this.#callCount++
    this.#callRequests.push(req)
    return { kind: 'none', subtype: 'spy', confidence: 0.1, reason: 'spy-none', rawSamples: ['spy-none'] }
  }
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function makeTmpDb(): string {
  const dir = join(tmpdir(), `lb-4b-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return join(dir, 'op.db')
}

function openStorage(dbPath: string): { storage: StorageLayer; db: Database.Database } {
  const storage = new StorageLayer()
  storage.open(dbPath, undefined, { appVersion: '0.0.0-test', embedDim: 1024 })
  return { storage, db: storage.opDb }
}

function makeDeps(
  db: Database.Database,
  opts: { embedClient?: EmbedClient; judgeClient?: JudgeClient } = {},
): { deps: SessionPipelineDeps; notifySink: MockNotifySink } {
  const notifySink = new MockNotifySink()
  const cooldown = new CooldownStore(db)
  const dispatcher = new NotifyDispatcher([notifySink], cooldown, DEFAULT_DETECTOR_CONFIG)
  const deps: SessionPipelineDeps = {
    db,
    detectorConfig: DEFAULT_DETECTOR_CONFIG,
    embedClient: opts.embedClient ?? new SpyEmbedClient(),
    judgeClient: opts.judgeClient ?? new SpyJudgeClient(),
    dispatcher,
  }
  return { deps, notifySink }
}

function makeTmpSession(label: string): { filePath: string; sessionId: string } {
  const dir = join(tmpdir(), `lb-4b-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return { filePath: join(dir, `${label}.jsonl`), sessionId: `session-4b-${label}` }
}

/**
 * JSONL assistant/tool_use 라인 생성.
 * command를 동일하게 유지하면 argKey가 같아져 구조 게이트가 발화한다.
 */
function makeToolUseLine(
  sessionId: string,
  uuid: string,
  command = 'echo hello',
): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    parentUuid: null,
    sessionId,
    cwd: '/tmp/test',
    isSidechain: false,
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: `toolu_${uuid.slice(0, 8)}`,
          name: 'Bash',
          input: { command },
        },
      ],
    },
  })
}

/**
 * N개의 동일 커맨드 Bash tool_use 라인을 만든다.
 * repeatN = N → WARNING(10) 이상이면 구조 게이트 발화.
 */
function makeRepeatBashLines(sessionId: string, n: number, command = 'echo hello'): string[] {
  return Array.from({ length: n }, () => makeToolUseLine(sessionId, randomUUID(), command))
}

function writeLines(filePath: string, lines: string[]): void {
  writeFileSync(filePath, lines.join('\n') + '\n', { encoding: 'utf8' })
}

// ─── Sub-AC 4b 테스트 ────────────────────────────────────────────────────────

describe('SessionPipeline — Sub-AC 4b: embedClient·judgeClient DI 저장 및 호출 검증', () => {

  // ── 1. 생성자가 주입된 클라이언트를 내부 _deps에 동일 참조로 저장한다 ────────
  describe('1. DI 저장: 주입된 인스턴스 참조 동일성', () => {

    it('주입된 embedClient가 내부 _deps에 동일 참조로 저장된다', () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const spyEmbed = new SpyEmbedClient()
      const { deps } = makeDeps(db, { embedClient: spyEmbed })
      const { filePath, sessionId } = makeTmpSession('di-embed')
      writeLines(filePath, [])

      const pipeline = new SessionPipeline(sessionId, filePath, deps)

      // _deps는 private이므로 타입 단언으로 접근 (테스트 전용)
      const internalDeps = (pipeline as unknown as { _deps: SessionPipelineDeps })._deps
      expect(internalDeps.embedClient).toBe(spyEmbed)

      void storage.close()
    })

    it('주입된 judgeClient가 내부 _deps에 동일 참조로 저장된다', () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const spyJudge = new SpyJudgeClient()
      const { deps } = makeDeps(db, { judgeClient: spyJudge })
      const { filePath, sessionId } = makeTmpSession('di-judge')
      writeLines(filePath, [])

      const pipeline = new SessionPipeline(sessionId, filePath, deps)

      const internalDeps = (pipeline as unknown as { _deps: SessionPipelineDeps })._deps
      expect(internalDeps.judgeClient).toBe(spyJudge)

      void storage.close()
    })

    it('두 파이프라인에 다른 인스턴스를 주입하면 각각 독립된 참조가 저장된다', () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const embedA = new SpyEmbedClient()
      const embedB = new SpyEmbedClient()
      const judgeA = new SpyJudgeClient()
      const judgeB = new SpyJudgeClient()
      const { deps: depsA } = makeDeps(db, { embedClient: embedA, judgeClient: judgeA })
      const { deps: depsB } = makeDeps(db, { embedClient: embedB, judgeClient: judgeB })

      const { filePath: fileA, sessionId: sidA } = makeTmpSession('di-A')
      const { filePath: fileB, sessionId: sidB } = makeTmpSession('di-B')
      writeLines(fileA, [])
      writeLines(fileB, [])

      const pipelineA = new SessionPipeline(sidA, fileA, depsA)
      const pipelineB = new SessionPipeline(sidB, fileB, depsB)

      const depA = (pipelineA as unknown as { _deps: SessionPipelineDeps })._deps
      const depB = (pipelineB as unknown as { _deps: SessionPipelineDeps })._deps

      // 각 파이프라인이 자신에게 주입된 인스턴스를 저장함
      expect(depA.embedClient).toBe(embedA)
      expect(depB.embedClient).toBe(embedB)
      expect(depA.embedClient).not.toBe(embedB)
      expect(depA.judgeClient).toBe(judgeA)
      expect(depB.judgeClient).toBe(judgeB)
      expect(depA.judgeClient).not.toBe(judgeB)

      void storage.close()
    })

  })

  // ── 2. Spy call-count: embedClient.embed()가 실제로 호출된다 ────────────────
  describe('2. Spy call-count: embedClient.embed() 호출 검증', () => {

    it('구조 게이트 통과(동일 Bash 11회)시 embedClient.embed()가 1회 이상 호출된다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const spyEmbed = new SpyEmbedClient()
      const { deps } = makeDeps(db, { embedClient: spyEmbed })
      const { filePath, sessionId } = makeTmpSession('spy-embed-fired')

      // 동일 커맨드 11번 반복 → argKey 동일 → repeatN=11 >= WARNING(10) → 게이트 발화
      writeLines(filePath, makeRepeatBashLines(sessionId, 11))
      const pipeline = new SessionPipeline(sessionId, filePath, deps)

      await pipeline.enqueueChange()

      // embed가 실제로 호출됨
      expect(spyEmbed.embedCallCount).toBeGreaterThanOrEqual(1)

      await storage.close()
    }, 15_000)

    it('빈 파일이면 embedClient.embed()는 호출되지 않는다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const spyEmbed = new SpyEmbedClient()
      const { deps } = makeDeps(db, { embedClient: spyEmbed })
      const { filePath, sessionId } = makeTmpSession('spy-embed-empty')

      writeLines(filePath, [])
      const pipeline = new SessionPipeline(sessionId, filePath, deps)
      await pipeline.enqueueChange()

      expect(spyEmbed.embedCallCount).toBe(0)

      await storage.close()
    })

    it('임계값 미달(5회)이면 embedClient.embed()는 호출되지 않는다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const spyEmbed = new SpyEmbedClient()
      const { deps } = makeDeps(db, { embedClient: spyEmbed })
      const { filePath, sessionId } = makeTmpSession('spy-embed-below')

      // 5회 — WARNING(10) 미달
      writeLines(filePath, makeRepeatBashLines(sessionId, 5))
      const pipeline = new SessionPipeline(sessionId, filePath, deps)
      await pipeline.enqueueChange()

      expect(spyEmbed.embedCallCount).toBe(0)

      await storage.close()
    })

    it('embed 호출 시 string[] 인자가 전달된다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const spyEmbed = new SpyEmbedClient()
      const { deps } = makeDeps(db, { embedClient: spyEmbed })
      const { filePath, sessionId } = makeTmpSession('spy-embed-args')

      writeLines(filePath, makeRepeatBashLines(sessionId, 11))
      const pipeline = new SessionPipeline(sessionId, filePath, deps)
      await pipeline.enqueueChange()

      // embed가 호출됐으면 string[] 인자를 받았어야 함
      expect(spyEmbed.embedCallCount).toBeGreaterThanOrEqual(1)
      const firstArgs = spyEmbed.callArgs[0]
      expect(firstArgs).toBeDefined()
      expect(Array.isArray(firstArgs)).toBe(true)
      for (const arg of firstArgs!) {
        expect(typeof arg).toBe('string')
      }

      await storage.close()
    }, 15_000)

  })

  // ── 3. Spy call-count: judgeClient.judge()가 실제로 호출된다 ────────────────
  describe('3. Spy call-count: judgeClient.judge() 호출 검증', () => {

    it('embed 성공 + 고유사도 시 judgeClient.judge()가 1회 이상 호출된다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      // embed는 고유사도 반환(simThresh=0.90 통과) → judge 단계 도달
      const highSimEmbed = new SpyEmbedClientHighSim(1024)
      const spyJudge = new SpyJudgeClient()
      const { deps } = makeDeps(db, { embedClient: highSimEmbed, judgeClient: spyJudge })
      const { filePath, sessionId } = makeTmpSession('spy-judge-fired')

      writeLines(filePath, makeRepeatBashLines(sessionId, 11))
      const pipeline = new SessionPipeline(sessionId, filePath, deps)
      await pipeline.enqueueChange()

      // judge가 실제로 호출됨
      expect(spyJudge.judgeCallCount).toBeGreaterThanOrEqual(1)

      await storage.close()
    }, 15_000)

    it('빈 파일이면 judgeClient.judge()는 호출되지 않는다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const spyJudge = new SpyJudgeClient()
      const { deps } = makeDeps(db, { judgeClient: spyJudge })
      const { filePath, sessionId } = makeTmpSession('spy-judge-empty')

      writeLines(filePath, [])
      const pipeline = new SessionPipeline(sessionId, filePath, deps)
      await pipeline.enqueueChange()

      expect(spyJudge.judgeCallCount).toBe(0)

      await storage.close()
    })

    it('judge 호출 인자가 유효한 JudgeRequest 형태이다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const highSimEmbed = new SpyEmbedClientHighSim(1024)
      const spyJudge = new SpyJudgeClient()
      const { deps } = makeDeps(db, { embedClient: highSimEmbed, judgeClient: spyJudge })
      const { filePath, sessionId } = makeTmpSession('spy-judge-req')

      writeLines(filePath, makeRepeatBashLines(sessionId, 11))
      const pipeline = new SessionPipeline(sessionId, filePath, deps)
      await pipeline.enqueueChange()

      expect(spyJudge.judgeCallCount).toBeGreaterThanOrEqual(1)
      const req = spyJudge.callRequests[0]!
      expect(typeof req.kind).toBe('string')
      expect(['thrashing', 'false_success']).toContain(req.kind)
      expect(typeof req.modelId).toBe('string')
      expect(typeof req.cacheableBlock).toBe('string')
      expect(typeof req.volatileBlock).toBe('string')

      await storage.close()
    }, 15_000)

  })

  // ── 4. jest.spyOn call-count assert ──────────────────────────────────────
  describe('4. jest.spyOn: 표준 spy 패턴으로 호출 추적', () => {

    it('jest.spyOn으로 SpyEmbedClient.embed 호출을 추적한다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const mockEmbed = new SpyEmbedClient()
      const spyFn = jest.spyOn(mockEmbed, 'embed')
      const { deps } = makeDeps(db, { embedClient: mockEmbed })
      const { filePath, sessionId } = makeTmpSession('jest-spy-embed')

      writeLines(filePath, makeRepeatBashLines(sessionId, 11))
      const pipeline = new SessionPipeline(sessionId, filePath, deps)
      await pipeline.enqueueChange()

      // jest.spyOn이 호출을 감지함
      expect(spyFn).toHaveBeenCalled()
      expect(spyFn.mock.calls.length).toBeGreaterThanOrEqual(1)

      // 첫 번째 호출 인자가 string[]임을 확인
      const firstCallArgs = spyFn.mock.calls[0]
      expect(firstCallArgs).toBeDefined()
      expect(Array.isArray(firstCallArgs![0])).toBe(true)

      spyFn.mockRestore()
      await storage.close()
    }, 15_000)

    it('jest.spyOn으로 SpyJudgeClient.judge 호출을 추적한다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const mockEmbed = new SpyEmbedClientHighSim(1024)
      const mockJudge = new SpyJudgeClient()
      const judgeSpy = jest.spyOn(mockJudge, 'judge')
      const { deps } = makeDeps(db, { embedClient: mockEmbed, judgeClient: mockJudge })
      const { filePath, sessionId } = makeTmpSession('jest-spy-judge')

      writeLines(filePath, makeRepeatBashLines(sessionId, 11))
      const pipeline = new SessionPipeline(sessionId, filePath, deps)
      await pipeline.enqueueChange()

      // jest.spyOn이 judge 호출을 감지함
      expect(judgeSpy).toHaveBeenCalled()
      expect(judgeSpy.mock.calls.length).toBeGreaterThanOrEqual(1)

      // 호출 인자 구조 검증
      const req = judgeSpy.mock.calls[0]![0]
      expect(typeof req.kind).toBe('string')
      expect(['thrashing', 'false_success']).toContain(req.kind)
      expect(typeof req.modelId).toBe('string')

      judgeSpy.mockRestore()
      await storage.close()
    }, 15_000)

    it('인스턴스 A(11회)와 인스턴스 B(5회)의 spy는 독립적으로 호출 수를 집계한다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)

      const embedA = new SpyEmbedClient()
      const embedB = new SpyEmbedClient()
      const spyA = jest.spyOn(embedA, 'embed')
      const spyB = jest.spyOn(embedB, 'embed')

      const { deps: depsA } = makeDeps(db, { embedClient: embedA })
      const { deps: depsB } = makeDeps(db, { embedClient: embedB })

      const { filePath: fileA, sessionId: sidA } = makeTmpSession('spy-indep-A')
      const { filePath: fileB, sessionId: sidB } = makeTmpSession('spy-indep-B')

      // A: 11회 (게이트 통과 → embed 호출됨)
      writeLines(fileA, makeRepeatBashLines(sidA, 11))
      // B: 5회 (게이트 미통과 → embed 미호출)
      writeLines(fileB, makeRepeatBashLines(sidB, 5))

      const pipelineA = new SessionPipeline(sidA, fileA, depsA)
      const pipelineB = new SessionPipeline(sidB, fileB, depsB)

      await Promise.all([pipelineA.enqueueChange(), pipelineB.enqueueChange()])

      // A: embed 호출됨
      expect(spyA).toHaveBeenCalled()
      expect(spyA.mock.calls.length).toBeGreaterThanOrEqual(1)

      // B: embed 미호출 (게이트 미통과)
      expect(spyB).not.toHaveBeenCalled()
      expect(spyB.mock.calls.length).toBe(0)

      spyA.mockRestore()
      spyB.mockRestore()
      await storage.close()
    }, 15_000)

  })

})
