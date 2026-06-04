/**
 * daemon-factory-api-clients-sub-ac-4a.test.ts
 *
 * Sub-AC 4a: DaemonFactory가 외부에서 주입된 ApiClients(embedClient, judgeClient)를
 * 내부 생성 대신 그대로 사용하는지 참조 동일성(===)으로 검증한다.
 *
 * 부수효과 없음:
 *   - MockEmbedClient / MockJudgeClient 사용 (네트워크·API 키 불필요)
 *   - MockWatchSource 사용 (chokidar·실제 fs 감시 없음)
 *   - 임시경로 lockHandle (실제 ~/.loopbreaker 금지)
 *   - CloseableStorage stub (실제 DB 없음)
 */

import { DaemonFactory } from '../src/daemon/daemon-factory.js'
import { MockEmbedClient } from '../src/api/embed-client.js'
import { MockJudgeClient } from '../src/api/judge-client.js'
import { MockWatchSource } from '../src/watch/mock-watch-source.js'
import { ConfigManager } from '../src/config/config-manager.js'
import { DEFAULT_DETECTOR_CONFIG } from '../src/contracts.js'
import type { LockHandle } from '../src/daemon/lockfile.js'
import type { CloseableStorage } from '../src/daemon/shutdown.js'

// ─── 스텁 헬퍼 ───────────────────────────────────────────────────────────────

function makeLockHandle(): LockHandle {
  return { lockPath: '/tmp/test-daemon.lock', pid: process.pid }
}

function makeStorageStub(): CloseableStorage {
  return {
    close: async () => undefined,
  }
}

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('DaemonFactory — ApiClients DI 참조 동일성 (Sub-AC 4a)', () => {
  it('주입된 embedClient와 factory.apiClients.embedClient가 동일한 참조(===)이다', () => {
    const embedClient = new MockEmbedClient([], 1024)
    const judgeClient = new MockJudgeClient()

    const factory = DaemonFactory.create({
      detectorConfig: DEFAULT_DETECTOR_CONFIG,
      apiClients: { embedClient, judgeClient },
      watchSource: new MockWatchSource(),
      storage: makeStorageStub(),
      lockHandle: makeLockHandle(),
      configManager: ConfigManager.create(),
    })

    expect(factory.apiClients.embedClient).toBe(embedClient)
  })

  it('주입된 judgeClient와 factory.apiClients.judgeClient가 동일한 참조(===)이다', () => {
    const embedClient = new MockEmbedClient([], 1024)
    const judgeClient = new MockJudgeClient()

    const factory = DaemonFactory.create({
      detectorConfig: DEFAULT_DETECTOR_CONFIG,
      apiClients: { embedClient, judgeClient },
      watchSource: new MockWatchSource(),
      storage: makeStorageStub(),
      lockHandle: makeLockHandle(),
      configManager: ConfigManager.create(),
    })

    expect(factory.apiClients.judgeClient).toBe(judgeClient)
  })

  it('embedClient와 judgeClient를 모두 동시에 주입하면 둘 다 동일 참조이다', () => {
    const embedClient = new MockEmbedClient([], 1024)
    const judgeClient = new MockJudgeClient()

    const factory = DaemonFactory.create({
      detectorConfig: DEFAULT_DETECTOR_CONFIG,
      apiClients: { embedClient, judgeClient },
      watchSource: new MockWatchSource(),
      storage: makeStorageStub(),
      lockHandle: makeLockHandle(),
      configManager: ConfigManager.create(),
    })

    expect(factory.apiClients.embedClient).toBe(embedClient)
    expect(factory.apiClients.judgeClient).toBe(judgeClient)
  })

  it('서로 다른 두 MockEmbedClient 인스턴스는 === 비교에서 각각 구별된다', () => {
    const embedClientA = new MockEmbedClient([], 1024)
    const embedClientB = new MockEmbedClient([], 1024)
    const judgeClient = new MockJudgeClient()

    const factoryA = DaemonFactory.create({
      detectorConfig: DEFAULT_DETECTOR_CONFIG,
      apiClients: { embedClient: embedClientA, judgeClient },
      watchSource: new MockWatchSource(),
      storage: makeStorageStub(),
      lockHandle: makeLockHandle(),
      configManager: ConfigManager.create(),
    })

    const factoryB = DaemonFactory.create({
      detectorConfig: DEFAULT_DETECTOR_CONFIG,
      apiClients: { embedClient: embedClientB, judgeClient },
      watchSource: new MockWatchSource(),
      storage: makeStorageStub(),
      lockHandle: makeLockHandle(),
      configManager: ConfigManager.create(),
    })

    expect(factoryA.apiClients.embedClient).toBe(embedClientA)
    expect(factoryB.apiClients.embedClient).toBe(embedClientB)
    expect(factoryA.apiClients.embedClient).not.toBe(embedClientB)
    expect(factoryB.apiClients.embedClient).not.toBe(embedClientA)
  })

  it('서로 다른 두 MockJudgeClient 인스턴스는 === 비교에서 각각 구별된다', () => {
    const embedClient = new MockEmbedClient([], 1024)
    const judgeClientA = new MockJudgeClient()
    const judgeClientB = new MockJudgeClient()

    const factoryA = DaemonFactory.create({
      detectorConfig: DEFAULT_DETECTOR_CONFIG,
      apiClients: { embedClient, judgeClient: judgeClientA },
      watchSource: new MockWatchSource(),
      storage: makeStorageStub(),
      lockHandle: makeLockHandle(),
      configManager: ConfigManager.create(),
    })

    const factoryB = DaemonFactory.create({
      detectorConfig: DEFAULT_DETECTOR_CONFIG,
      apiClients: { embedClient, judgeClient: judgeClientB },
      watchSource: new MockWatchSource(),
      storage: makeStorageStub(),
      lockHandle: makeLockHandle(),
      configManager: ConfigManager.create(),
    })

    expect(factoryA.apiClients.judgeClient).toBe(judgeClientA)
    expect(factoryB.apiClients.judgeClient).toBe(judgeClientB)
    expect(factoryA.apiClients.judgeClient).not.toBe(judgeClientB)
    expect(factoryB.apiClients.judgeClient).not.toBe(judgeClientA)
  })

  it('factory.apiClients 객체 자체도 주입된 apiClients 번들과 동일 참조이다', () => {
    const embedClient = new MockEmbedClient([], 1024)
    const judgeClient = new MockJudgeClient()
    const apiClients = { embedClient, judgeClient }

    const factory = DaemonFactory.create({
      detectorConfig: DEFAULT_DETECTOR_CONFIG,
      apiClients,
      watchSource: new MockWatchSource(),
      storage: makeStorageStub(),
      lockHandle: makeLockHandle(),
      configManager: ConfigManager.create(),
    })

    // 번들 객체 자체도 동일 참조
    expect(factory.apiClients).toBe(apiClients)
  })
})
