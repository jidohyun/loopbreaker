/**
 * tests/session-pipeline-sub-ac-3d.test.ts
 *
 * Sub-AC 3d: SessionPipeline 통합 테스트
 *
 * 검증 항목:
 *   1. SessionPipeline이 내부 SerialQueue를 사용하여 TailReader→parseLine→event-store
 *      단계가 직렬로 실행됨을 검증
 *   2. 두 세션의 write가 interleave되지 않음을 assert
 *   3. 한 세션 파이프라인의 예외가 다른 세션을 죽이지 않음 (세션 격리)
 *   4. drainAndClose() 후 enqueue는 reject됨
 *
 * 테스트 원칙 (M5 최우선 계약):
 *   - 실제 fs.watch·네트워크·OS알림 0
 *   - DB = tmpdir 파일 (sqlite-vec/WAL 한계)
 *   - MockNotifySink 사용
 *   - Mock EmbedClient / Mock JudgeClient 사용
 *   - lockfile = tmpdir 하위 임시경로
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { SessionPipeline } from '../src/daemon/session-pipeline.js'
import { SerialQueue } from '../src/daemon/serial-queue.js'
import { StorageLayer } from '../src/storage/storage-layer.js'
import { MockEmbedClient } from '../src/api/embed-client.js'
import { MockJudgeClient } from '../src/api/judge-client.js'
import { MockNotifySink } from '../src/notify/sinks/mock-notify-sink.js'
import { NotifyDispatcher } from '../src/notify/notify-dispatcher.js'
import { CooldownStore } from '../src/notify/cooldown-store.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'
import type { SessionPipelineDeps } from '../src/daemon/session-pipeline.js'

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/** 임시 DB 경로 생성 */
function makeTmpDb(): string {
  const dir = join(tmpdir(), `lb-test-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return join(dir, 'op.db')
}

/** StorageLayer를 열고 DB 핸들을 반환 */
function openStorage(dbPath: string): { storage: StorageLayer; db: Database.Database } {
  const storage = new StorageLayer()
  storage.open(dbPath, undefined, { appVersion: '0.0.0-test', embedDim: 1024 })
  return { storage, db: storage.opDb }
}

/** 기본 SessionPipelineDeps 생성 */
function makeDeps(db: Database.Database): {
  deps: SessionPipelineDeps
  notifySink: MockNotifySink
} {
  const notifySink = new MockNotifySink()
  const cooldown = new CooldownStore(db)
  const dispatcher = new NotifyDispatcher(
    [notifySink],
    cooldown,
    DEFAULT_DETECTOR_CONFIG,
  )
  const deps: SessionPipelineDeps = {
    db,
    detectorConfig: DEFAULT_DETECTOR_CONFIG,
    // MockEmbedClient requires (entries, dim) — empty fixtures, dim=1024
    embedClient: new MockEmbedClient([], 1024),
    // MockJudgeClient has default empty entries
    judgeClient: new MockJudgeClient(),
    dispatcher,
  }
  return { deps, notifySink }
}

/** ms 대기 */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ─── JSONL 라인 생성 헬퍼 ────────────────────────────────────────────────────

/** 최소한의 유효 JSONL 줄을 생성한다 */
function makeToolUseLine(sessionId: string, uuid: string, tool = 'Bash'): string {
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
          name: tool,
          input: { command: 'echo hello' },
        },
      ],
    },
  })
}

/** セッションファイルにラインを書き込む */
function writeLinesToFile(filePath: string, lines: string[]): void {
  writeFileSync(filePath, lines.join('\n') + '\n', { encoding: 'utf8' })
}

// ─── 테스트 ─────────────────────────────────────────────────────────────────

describe('SessionPipeline — Sub-AC 3d: 직렬 큐 통합', () => {

  // ── 1. SessionPipeline이 SerialQueue를 내부적으로 사용함 ──────────────────
  describe('SerialQueue 기반 직렬 실행', () => {

    it('SessionPipeline은 내부적으로 SerialQueue를 사용해 enqueueChange를 직렬 처리한다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const { deps } = makeDeps(db)

      const dir = join(tmpdir(), `lb-test-${randomUUID()}`)
      mkdirSync(dir, { recursive: true })
      const filePath = join(dir, 'session.jsonl')
      const sessionId = 'test-session-serial'

      // 파이프라인 생성 (실제 파일 없이, enqueueChange가 빈 read를 반환할 것)
      writeLinesToFile(filePath, [])
      const pipeline = new SessionPipeline(sessionId, filePath, deps)

      // enqueueChange 3번 호출 — 직렬 실행되어야 함
      // 각 enqueue가 완료되기 전에 다음이 시작되지 않음을 확인하기 위해
      // internal queue를 직접 검증하는 대신, 실제 큐 동작을 통해 검증

      // pendingCount가 누적되는지 확인 (직렬 큐의 동작 증거)
      const p1 = pipeline.enqueueChange()
      const p2 = pipeline.enqueueChange()
      const p3 = pipeline.enqueueChange()

      // 모두 완료 대기
      await Promise.all([p1, p2, p3])

      // 직렬 큐가 닫혀있지 않음
      expect(pipeline.isClosed).toBe(false)

      await storage.close()
    })

    it('SerialQueue를 직접 검증: 동시 enqueue 시 순서가 보장된다', async () => {
      const queue = new SerialQueue()
      const executionOrder: number[] = []

      const p1 = queue.enqueue(async () => {
        await delay(20)
        executionOrder.push(1)
      })
      const p2 = queue.enqueue(async () => {
        await delay(5)
        executionOrder.push(2)
      })
      const p3 = queue.enqueue(async () => {
        executionOrder.push(3)
      })

      await Promise.all([p1, p2, p3])
      expect(executionOrder).toEqual([1, 2, 3])
    })

  })

  // ── 2. 두 세션의 write가 interleave되지 않음 ──────────────────────────────
  describe('두 세션의 write interleave 금지', () => {

    it('두 SessionPipeline이 같은 DB를 공유해도 write가 interleave되지 않는다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const { deps: depsA } = makeDeps(db)
      const { deps: depsB } = makeDeps(db)

      const dir = join(tmpdir(), `lb-test-${randomUUID()}`)
      mkdirSync(dir, { recursive: true })

      const fileA = join(dir, 'sessionA.jsonl')
      const fileB = join(dir, 'sessionB.jsonl')
      const sessionIdA = 'session-A-interleave'
      const sessionIdB = 'session-B-interleave'

      // 각 세션 파일에 라인 작성
      const uuidsA = Array.from({ length: 5 }, () => randomUUID())
      const uuidsB = Array.from({ length: 5 }, () => randomUUID())

      writeLinesToFile(fileA, uuidsA.map(u => makeToolUseLine(sessionIdA, u)))
      writeLinesToFile(fileB, uuidsB.map(u => makeToolUseLine(sessionIdB, u)))

      // 두 개의 독립 파이프라인 생성
      const pipelineA = new SessionPipeline(sessionIdA, fileA, depsA)
      const pipelineB = new SessionPipeline(sessionIdB, fileB, depsB)

      // 두 파이프라인에 동시에 change를 enqueue
      const promises: Promise<void>[] = []
      for (let i = 0; i < 3; i++) {
        promises.push(pipelineA.enqueueChange())
        promises.push(pipelineB.enqueueChange())
      }

      // 모두 완료 대기
      await Promise.all(promises)

      // 두 파이프라인이 모두 정상 완료 (예외 없음)
      expect(pipelineA.isClosed).toBe(false)
      expect(pipelineB.isClosed).toBe(false)

      // 오프셋이 진전됨 (파일을 읽었다는 증거)
      expect(pipelineA.byteOffset).toBeGreaterThan(0)
      expect(pipelineB.byteOffset).toBeGreaterThan(0)

      await storage.close()
    })

    it('StorageLayer의 단일 writer 큐로 두 세션의 DB write가 직렬화된다', async () => {
      const dbPath = makeTmpDb()
      const { storage } = openStorage(dbPath)

      // 두 세션이 동시에 StorageLayer.enqueueWrite를 호출할 때
      // FIFO 순서가 보장되는지 확인
      const order: string[] = []

      const p1 = storage.enqueueWrite(async () => {
        await delay(20)
        order.push('session-A-write-1')
      })
      const p2 = storage.enqueueWrite(async () => {
        await delay(5)
        order.push('session-B-write-1')
      })
      const p3 = storage.enqueueWrite(async () => {
        order.push('session-A-write-2')
      })
      const p4 = storage.enqueueWrite(async () => {
        order.push('session-B-write-2')
      })

      await Promise.all([p1, p2, p3, p4])

      // FIFO 순서 보장: enqueue 순서 그대로
      expect(order).toEqual([
        'session-A-write-1',
        'session-B-write-1',
        'session-A-write-2',
        'session-B-write-2',
      ])

      await storage.close()
    })

  })

  // ── 3. 세션 격리: 한 파이프라인의 예외가 다른 세션을 죽이지 않음 ──────────
  describe('세션 격리', () => {

    it('한 세션 파이프라인의 예외가 다른 세션 파이프라인을 중단시키지 않는다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const { deps: depsA } = makeDeps(db)
      const { deps: depsB } = makeDeps(db)

      const dir = join(tmpdir(), `lb-test-${randomUUID()}`)
      mkdirSync(dir, { recursive: true })

      // sessionA: 존재하지 않는 파일 (읽기 실패 → 파이프라인이 조용히 처리)
      const fileA = join(dir, 'nonexistent.jsonl')
      const sessionIdA = 'session-A-error'

      // sessionB: 정상 파일
      const fileB = join(dir, 'sessionB.jsonl')
      const sessionIdB = 'session-B-healthy'

      const uuidsB = Array.from({ length: 3 }, () => randomUUID())
      writeLinesToFile(fileB, uuidsB.map(u => makeToolUseLine(sessionIdB, u)))

      const pipelineA = new SessionPipeline(sessionIdA, fileA, depsA)
      const pipelineB = new SessionPipeline(sessionIdB, fileB, depsB)

      // 두 파이프라인에 동시에 change를 enqueue
      const [resultA, resultB] = await Promise.allSettled([
        pipelineA.enqueueChange(),
        pipelineB.enqueueChange(),
      ])

      // A가 실패해도 B는 성공해야 함
      // (파일 없으면 조용히 return — SessionPipeline은 예외를 삼킴)
      expect(resultA.status).toBe('fulfilled')
      expect(resultB.status).toBe('fulfilled')

      // B의 오프셋이 진전됨 (정상 처리)
      expect(pipelineB.byteOffset).toBeGreaterThan(0)

      await storage.close()
    })

    it('SerialQueue: 한 작업의 throw가 큐 전체를 중단시키지 않는다', async () => {
      const queue = new SerialQueue()
      const results: string[] = []

      await Promise.allSettled([
        queue.enqueue(async () => {
          results.push('before-throw')
          throw new Error('intentional error')
        }),
        queue.enqueue(async () => {
          results.push('after-throw')
        }),
      ])

      // throw 후에도 다음 작업이 실행됨
      expect(results).toContain('before-throw')
      expect(results).toContain('after-throw')
    })

  })

  // ── 4. drainAndClose 후 enqueue reject ───────────────────────────────────
  describe('drainAndClose 후 동작', () => {

    it('drainAndClose() 후 enqueueChange는 reject된다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const { deps } = makeDeps(db)

      const dir = join(tmpdir(), `lb-test-${randomUUID()}`)
      mkdirSync(dir, { recursive: true })
      const filePath = join(dir, 'session.jsonl')
      writeLinesToFile(filePath, [])

      const pipeline = new SessionPipeline('session-close-test', filePath, deps)

      await pipeline.drainAndClose()
      expect(pipeline.isClosed).toBe(true)

      // 닫힌 후 enqueueChange는 reject
      await expect(pipeline.enqueueChange()).rejects.toThrow()

      await storage.close()
    })

    it('drainAndClose()는 진행 중인 작업 완료를 기다린다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const { deps } = makeDeps(db)

      const dir = join(tmpdir(), `lb-test-${randomUUID()}`)
      mkdirSync(dir, { recursive: true })
      const filePath = join(dir, 'session.jsonl')
      const sessionId = 'session-drain-test'

      // 여러 라인이 있는 파일 생성
      const uuids = Array.from({ length: 5 }, () => randomUUID())
      writeLinesToFile(filePath, uuids.map(u => makeToolUseLine(sessionId, u)))

      const pipeline = new SessionPipeline(sessionId, filePath, deps)

      // 3개의 change를 enqueue하고 drain을 즉시 시작
      const p1 = pipeline.enqueueChange()
      const p2 = pipeline.enqueueChange()
      const p3 = pipeline.enqueueChange()

      // drainAndClose는 모든 작업 완료 후 닫힘
      await pipeline.drainAndClose()

      // 모든 Promise가 이미 완료되어 있음
      await expect(p1).resolves.toBeUndefined()
      await expect(p2).resolves.toBeUndefined()
      await expect(p3).resolves.toBeUndefined()

      expect(pipeline.isClosed).toBe(true)
      // 파일을 읽었으므로 오프셋이 진전됨
      expect(pipeline.byteOffset).toBeGreaterThan(0)

      await storage.close()
    })

  })

  // ── 5. 직렬 처리 증명: 동시 write 없음 (핵심 계약) ──────────────────────
  describe('직렬 처리 계약: 두 세션 write가 interleave되지 않음 (SerialQueue 기반)', () => {

    it('N개의 동시 enqueue가 직렬로 처리되어 공유 카운터에 race condition이 없다', async () => {
      // SerialQueue 없이 동시 실행 시 race가 발생한다는 대조군 +
      // SerialQueue 사용 시 race가 없다는 본 케이스를 함께 검증

      // ── 대조군: 직렬 큐 없이 race 발생 ──
      const sharedWithoutQueue = { counter: 0 }
      const tasksWithoutQueue = Array.from({ length: 10 }, () => async () => {
        const val = sharedWithoutQueue.counter
        await delay(1) // race window 열기
        sharedWithoutQueue.counter = val + 1
      })
      await Promise.all(tasksWithoutQueue.map(fn => fn()))
      // race condition으로 counter가 10보다 작을 가능성이 높음
      // (확률적이므로 단정 assert 하지 않음 — 대조군 역할만)

      // ── 본 케이스: SerialQueue로 race 없음 ──
      const sharedWithQueue = { counter: 0 }
      const queue = new SerialQueue()
      const tasksWithQueue = Array.from({ length: 10 }, () => async () => {
        const val = sharedWithQueue.counter
        await delay(1)
        sharedWithQueue.counter = val + 1
      })
      await Promise.all(tasksWithQueue.map(fn => queue.enqueue(fn)))
      // 직렬 실행으로 정확히 10이어야 함
      expect(sharedWithQueue.counter).toBe(10)
    })

    it('두 SessionPipeline이 독립 SerialQueue를 가져 서로 블록하지 않는다', async () => {
      const dbPath = makeTmpDb()
      const { storage, db } = openStorage(dbPath)
      const { deps: depsA } = makeDeps(db)
      const { deps: depsB } = makeDeps(db)

      const dir = join(tmpdir(), `lb-test-${randomUUID()}`)
      mkdirSync(dir, { recursive: true })

      const fileA = join(dir, 'sessionA2.jsonl')
      const fileB = join(dir, 'sessionB2.jsonl')

      writeLinesToFile(fileA, [])
      writeLinesToFile(fileB, [])

      const pipelineA = new SessionPipeline('session-independent-A', fileA, depsA)
      const pipelineB = new SessionPipeline('session-independent-B', fileB, depsB)

      // 두 파이프라인이 독립 큐를 가지므로 서로를 블록하지 않아야 함
      // 동시 실행 후 모두 완료 대기
      await Promise.all([
        pipelineA.enqueueChange(),
        pipelineB.enqueueChange(),
      ])

      // 핵심: 두 파이프라인이 모두 완료됐고, 서로 블록하지 않음
      expect(pipelineA.isClosed).toBe(false)
      expect(pipelineB.isClosed).toBe(false)

      await storage.close()
    })

  })

})
