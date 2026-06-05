/**
 * storage/storage-layer.ts — M5 StorageLayer
 *
 * SPEC §2 아키텍처: better-sqlite3 op/eval DB 핸들 관리.
 * SPEC §3.1: 단일 writer 직렬 큐로 세션 간 write 순서 보존.
 *
 * PRAGMA 설정 (SPEC §1-0 권고값):
 *   journal_mode = WAL
 *   synchronous  = NORMAL
 *   foreign_keys = ON
 *   busy_timeout = 5000  (5초)
 *   temp_store   = MEMORY
 */

import Database from 'better-sqlite3'
import { loadSqliteVec } from './vec-loader.js'
import { runMigrations } from './migrations.js'

/** StorageLayer.open() 옵션 */
export interface StorageLayerOptions {
  /** 임베딩 벡터 차원 (vec_embeddings DDL 생성용). 기본값 1024 */
  readonly embedDim?: number
  /** 앱 버전 문자열 (schema_version 기록용). 기본값 '0.0.0' */
  readonly appVersion?: string
  /** busy_timeout (ms). 기본값 5000 */
  readonly busyTimeout?: number
}

/** 직렬 큐 작업 단위 */
interface WriteTask {
  fn: () => Promise<void> | void
  resolve: () => void
  reject: (err: unknown) => void
}

/**
 * LoopBreaker 스토리지 레이어.
 *
 * - op DB: sqlite-vec 로드 → WAL+busy_timeout+pragma → op 마이그레이션
 * - eval DB: WAL+busy_timeout+pragma → eval 마이그레이션
 * - 단일 writer 직렬 큐: 세션 간 write 순서 보존
 * - close(): 큐 drain 후 DB 닫기
 */
export class StorageLayer {
  private _opDb: Database.Database | null = null
  private _evalDb: Database.Database | null = null

  /** close() 호출 후 true — 이후 enqueueWrite()는 즉시 reject */
  private _closed = false

  /** 직렬 writer 큐 */
  private _writeQueue: WriteTask[] = []
  private _writing = false

  // ----------------------------------------
  // Public accessors
  // ----------------------------------------

  /** op DB 핸들 (open() 후에만 유효) */
  get opDb(): Database.Database {
    if (!this._opDb) throw new Error('StorageLayer: op DB가 열려 있지 않습니다. open()을 먼저 호출하세요.')
    return this._opDb
  }

  /** eval DB 핸들 (open(_, evalPath) 후에만 유효) */
  get evalDb(): Database.Database {
    if (!this._evalDb) throw new Error('StorageLayer: eval DB가 열려 있지 않습니다. open()을 먼저 호출하세요.')
    return this._evalDb
  }

  /** eval DB가 열려 있는지 여부 */
  get hasEvalDb(): boolean {
    return this._evalDb !== null
  }

  // ----------------------------------------
  // open()
  // ----------------------------------------

  /**
   * StorageLayer를 초기화한다.
   *
   * @param opPath   op DB 파일 경로
   * @param evalPath eval DB 파일 경로 (생략 시 eval DB 미열기)
   * @param opts     옵션
   */
  open(
    opPath: string,
    evalPath?: string,
    opts: StorageLayerOptions = {},
  ): void {
    const embedDim = opts.embedDim ?? 1024
    const appVersion = opts.appVersion ?? '0.0.0'
    const busyTimeout = opts.busyTimeout ?? 5000

    // ---- op DB 열기 ----
    const opDb = new Database(opPath)
    this._applyPragmas(opDb, busyTimeout)
    loadSqliteVec(opDb)
    runMigrations(opDb, 'op', appVersion, embedDim)
    this._opDb = opDb

    // ---- eval DB 열기 (선택) ----
    if (evalPath !== undefined) {
      const evalDb = new Database(evalPath)
      this._applyPragmas(evalDb, busyTimeout)
      // M6: eval DB에도 sqlite-vec를 로드한다.
      // ATTACH된 op_main.vec_embeddings (vec0 가상 테이블)를 eval 연결에서
      // 조회하려면 vec0 모듈이 eval 연결에도 등록되어 있어야 한다.
      loadSqliteVec(evalDb)
      runMigrations(evalDb, 'eval', appVersion, embedDim)
      // M6: op DB를 op_main 스키마로 ATTACH (SPEC §6 평가 하니스가 op_main 참조).
      // up()은 (db, embedDim) 시그니처 고정이라 opPath를 받을 수 없으므로
      // ATTACH는 migration이 아닌 open()에서 처리한다.
      //
      // ⚠️ read-only 격리 전략(better-sqlite3 제약 + 사용자 결정):
      //   - better-sqlite3는 'file:...?mode=ro' URI ATTACH를 지원하지 않고(네이티브 URI off),
      //     connection 단위 pragma(query_only)는 eval DB 본체 쓰기까지 막으므로 둘 다 불가.
      //   - 따라서 op_main은 일반 ATTACH로 붙인다. SQLite는 op DB 파일이 OS read-only
      //     권한이면 op_main을 자동으로 SQLITE_READONLY로 처리한다(파일 권한 위임).
      //   - 평가 하니스는 op_main에 쓰지 않는다(읽기 전용 참조 규약). eval 본체
      //     (gold_labels/eval_metrics)에만 쓴다 → 이 연결은 query_only를 켜지 않는다.
      const escapedOpPath = opPath.replace(/'/g, "''")
      evalDb.exec(`ATTACH DATABASE '${escapedOpPath}' AS op_main`)
      this._evalDb = evalDb
    }
  }

  // ----------------------------------------
  // write queue
  // ----------------------------------------

  /**
   * 단일 writer 직렬 큐에 write 작업을 enqueue한다.
   * fn은 동기 함수 또는 async 함수 모두 지원한다.
   * 반환된 Promise는 작업이 완료될 때 resolve된다.
   *
   * FIFO 보장: 이전 작업의 Promise(async fn 포함)가 settle된 뒤에
   * 다음 작업이 시작된다.
   */
  enqueueWrite(fn: () => Promise<void> | void): Promise<void> {
    if (this._closed) {
      return Promise.reject(new Error('StorageLayer: close() 이후에는 write를 enqueue할 수 없습니다.'))
    }
    return this._enqueueWriteInternal(fn)
  }

  /** _closed 검사를 우회하는 내부 전용 enqueue (sentinel·drain 전용). */
  private _enqueueWriteInternal(fn: () => Promise<void> | void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._writeQueue.push({ fn, resolve, reject })
      this._drainQueue()
    })
  }

  /**
   * 큐를 순차 처리한다 (동시 실행 방지).
   * async fn의 Promise를 await하여 FIFO 순서를 보장한다.
   */
  private _drainQueue(): void {
    if (this._writing) return
    const task = this._writeQueue.shift()
    if (!task) return

    this._writing = true
    // async fn을 지원하기 위해 Promise.resolve()로 감싸 await
    Promise.resolve()
      .then(() => task.fn())
      .then(
        () => {
          task.resolve()
          this._writing = false
          // 다음 작업을 setImmediate로 예약 (스택 보호)
          if (this._writeQueue.length > 0) {
            setImmediate(() => this._drainQueue())
          }
        },
        (err: unknown) => {
          task.reject(err)
          this._writing = false
          if (this._writeQueue.length > 0) {
            setImmediate(() => this._drainQueue())
          }
        },
      )
  }

  /**
   * 큐에 남은 작업이 모두 완료될 때까지 기다린다.
   * close() 전에 호출해 at-least-once 보장.
   */
  async drainWriteQueue(): Promise<void> {
    if (this._writeQueue.length === 0 && !this._writing) return
    // 마지막 작업 완료를 기다리는 sentinel enqueue — _closed 검사 우회
    await this._enqueueWriteInternal(() => { /* sentinel */ })
  }

  // ----------------------------------------
  // close()
  // ----------------------------------------

  /**
   * 큐 drain 후 DB를 닫는다.
   * SPEC §3.3: gracefulShutdown drain 순서.
   */
  async close(): Promise<void> {
    this._closed = true
    await this.drainWriteQueue()

    if (this._opDb) {
      this._opDb.close()
      this._opDb = null
    }
    if (this._evalDb) {
      this._evalDb.close()
      this._evalDb = null
    }
  }

  // ----------------------------------------
  // PRAGMA 헬퍼
  // ----------------------------------------

  /**
   * SPEC §1-0 권고 PRAGMA 5종을 모든 연결에 적용한다.
   *
   * journal_mode = WAL
   * synchronous  = NORMAL
   * foreign_keys = ON
   * busy_timeout = <busyTimeout ms>
   * temp_store   = MEMORY
   */
  private _applyPragmas(db: Database.Database, busyTimeout: number): void {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    db.pragma(`busy_timeout = ${busyTimeout}`)
    db.pragma('temp_store = MEMORY')
  }
}
