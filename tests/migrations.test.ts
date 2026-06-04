// tests/migrations.test.ts
// 마이그레이션 러너 단위 테스트.
// SPEC §3 DDL과 §5 마이그레이션 전략 검증.
// BLOCKER B1, C1, C3, C9 준수 검증.

import Database from 'better-sqlite3'
import { loadSqliteVec } from '../src/storage/vec-loader.js'
import {
  runMigrations,
  getSchemaVersion,
  ensureSchemaVersionTable,
  getAppliedMigrations,
  applyMigration,
  MIGRATIONS,
  type Migration,
} from '../src/storage/migrations.js'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

function makeVecDb(): Database.Database {
  const db = makeDb()
  loadSqliteVec(db)
  return db
}

describe('마이그레이션 러너 — 기본 동작', () => {
  test('schema_version 테이블이 없으면 버전 0을 반환한다', () => {
    const db = makeDb()
    expect(getSchemaVersion(db)).toBe(0)
    db.close()
  })

  test('운영 DB 마이그레이션 후 schema_version이 2가 된다 (M4 notifications 추가)', () => {
    const db = makeVecDb()
    runMigrations(db, 'op', '0.1.0', 1024)
    expect(getSchemaVersion(db)).toBe(2)
    db.close()
  })

  test('평가 DB 마이그레이션 후 schema_version이 1이 된다', () => {
    const db = makeDb()
    runMigrations(db, 'eval', '0.1.0', 1024)
    expect(getSchemaVersion(db)).toBe(1)
    db.close()
  })

  test('마이그레이션은 멱등하다 (두 번 실행해도 오류 없음)', () => {
    const db = makeVecDb()
    runMigrations(db, 'op', '0.1.0', 1024)
    expect(() => runMigrations(db, 'op', '0.1.0', 1024)).not.toThrow()
    expect(getSchemaVersion(db)).toBe(2)
    db.close()
  })

  test('평가 DB 마이그레이션도 멱등하다', () => {
    const db = makeDb()
    runMigrations(db, 'eval', '0.1.0', 1024)
    expect(() => runMigrations(db, 'eval', '0.1.0', 1024)).not.toThrow()
    expect(getSchemaVersion(db)).toBe(1)
    db.close()
  })
})

describe('마이그레이션 — 운영 DB 스키마 검증 (SPEC §3 DDL)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeVecDb()
    runMigrations(db, 'op', '0.1.0', 1024)
  })

  afterEach(() => {
    db.close()
  })

  test('events 테이블이 존재한다', () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='events'"
    ).get()
    expect(row).toBeTruthy()
  })

  test('events 테이블은 BLOCKER C5 컬럼명을 사용한다', () => {
    const cols = db.prepare("PRAGMA table_info(events)").all() as { name: string }[]
    const names = cols.map(c => c.name)
    // BLOCKER C5: contracts 컬럼명 사용
    expect(names).toContain('cwd')          // project_path 아님
    expect(names).toContain('agent_scope')  // is_subagent 아님
    expect(names).toContain('is_sidechain') // is_subagent 아님
    expect(names).toContain('kind')         // role/event_type 아님
    expect(names).toContain('tool')         // tool_name 아님
    expect(names).toContain('input_json')   // normalized_args_digest 아님
    expect(names).toContain('result_class') // result_digest 아님
    // 금지 컬럼
    expect(names).not.toContain('project_path')
    expect(names).not.toContain('is_subagent')
    expect(names).not.toContain('role')
    expect(names).not.toContain('event_type')
    expect(names).not.toContain('tool_name')
  })

  test('embeddings 테이블이 존재한다', () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='embeddings'"
    ).get()
    expect(row).toBeTruthy()
  })

  test('embeddings 테이블은 dim 컬럼을 가진다 (BLOCKER B1)', () => {
    const cols = db.prepare("PRAGMA table_info(embeddings)").all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toContain('dim')
    expect(names).toContain('cache_key')
    expect(names).toContain('embed_model_id')
  })

  test('vec_embeddings 가상 테이블이 존재한다 (BLOCKER B1: sqlite-vec)', () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_embeddings'"
    ).get()
    expect(row).toBeTruthy()
  })

  test('detections 테이블의 kind CHECK가 false_success를 허용한다 (BLOCKER C1)', () => {
    // detector_config 먼저 삽입
    db.prepare(`
      INSERT INTO detector_config (config_id, version_tag, is_active, config_json, created_at)
      VALUES ('cfg-1', 'v1', 1, '{}', ?)
    `).run(Date.now())

    // false_success 삽입 성공
    expect(() => {
      db.prepare(`
        INSERT INTO detections (
          detection_id, session_id, agent_scope, kind, subtype,
          confidence, signals_json, evidence_json, reason,
          gate_json, detector_config_id, created_at
        ) VALUES (?, 'sess-1', 'root', 'false_success', 'self_approval',
                  0.9, '{}', '[]', 'test', '{}', 'cfg-1', ?)
      `).run('det-1', Date.now())
    }).not.toThrow()
  })

  test('detections 테이블의 kind CHECK가 fake_success를 거부한다 (BLOCKER C1)', () => {
    // detector_config 먼저 삽입
    db.prepare(`
      INSERT OR IGNORE INTO detector_config (config_id, version_tag, config_json, created_at)
      VALUES ('cfg-2', 'v2', '{}', ?)
    `).run(Date.now())

    // fake_success는 CHECK 위반으로 실패해야 함
    expect(() => {
      db.prepare(`
        INSERT INTO detections (
          detection_id, session_id, agent_scope, kind, subtype,
          confidence, signals_json, evidence_json, reason,
          gate_json, detector_config_id, created_at
        ) VALUES (?, 'sess-2', 'root', 'fake_success', 'self_approval',
                  0.9, '{}', '[]', 'test', '{}', 'cfg-2', ?)
      `).run('det-2', Date.now())
    }).toThrow()
  })

  test('detector_config 테이블은 config_json 단일 컬럼을 사용한다 (BLOCKER C3)', () => {
    const cols = db.prepare("PRAGMA table_info(detector_config)").all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toContain('config_json')
    // BLOCKER C3: 개별 임계값 컬럼 없음 (평면 DetectorConfig는 config_json에 직렬화)
    expect(names).not.toContain('struct_warning_repeat')
    expect(names).not.toContain('cosine_warning')
  })

  test('watch_offsets 테이블이 존재한다', () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='watch_offsets'"
    ).get()
    expect(row).toBeTruthy()
  })

  test('watch_offsets 테이블은 inode/dev/byte_offset 컬럼을 가진다', () => {
    const cols = db.prepare("PRAGMA table_info(watch_offsets)").all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toContain('inode')
    expect(names).toContain('dev')
    expect(names).toContain('byte_offset')
    expect(names).toContain('partial_buffer')
    expect(names).toContain('rotation_seq')
    expect(names).toContain('status')
  })
})

describe('마이그레이션 — 평가 DB 스키마 검증', () => {
  let db: Database.Database

  beforeEach(() => {
    db = makeDb()
    runMigrations(db, 'eval', '0.1.0', 1024)
  })

  afterEach(() => {
    db.close()
  })

  test('gold_labels 테이블이 존재한다', () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='gold_labels'"
    ).get()
    expect(row).toBeTruthy()
  })

  test('gold_labels.source CHECK가 SPEC §1-1 C9 enum을 강제한다', () => {
    // live_jsonl 허용
    expect(() => {
      db.prepare(`
        INSERT INTO gold_labels (label_id, label_kind, anchor_uuid, session_id,
          expected_signal, source, labeler_id, labeled_at)
        VALUES ('gl-1', 'point', 'uuid-1', 'sess-1',
          'thrashing', 'live_jsonl', 'self', ?)
      `).run(Date.now())
    }).not.toThrow()

    // synthetic 허용
    expect(() => {
      db.prepare(`
        INSERT INTO gold_labels (label_id, label_kind, anchor_uuid, session_id,
          expected_signal, source, labeler_id, labeled_at)
        VALUES ('gl-2', 'point', 'uuid-2', 'sess-1',
          'false_success', 'synthetic', 'self', ?)
      `).run(Date.now())
    }).not.toThrow()

    // dohyun_adapted 허용
    expect(() => {
      db.prepare(`
        INSERT INTO gold_labels (label_id, label_kind, anchor_uuid, session_id,
          expected_signal, source, labeler_id, labeled_at)
        VALUES ('gl-3', 'point', 'uuid-3', 'sess-1',
          'none', 'dohyun_adapted', 'self', ?)
      `).run(Date.now())
    }).not.toThrow()

    // feedback/replay/manual 금지 (BLOCKER C9)
    expect(() => {
      db.prepare(`
        INSERT INTO gold_labels (label_id, label_kind, anchor_uuid, session_id,
          expected_signal, source, labeler_id, labeled_at)
        VALUES ('gl-4', 'point', 'uuid-4', 'sess-1',
          'thrashing', 'feedback', 'self', ?)
      `).run(Date.now())
    }).toThrow()
  })

  test('gold_labels.expected_signal CHECK가 false_success를 허용한다 (BLOCKER C1)', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO gold_labels (label_id, label_kind, anchor_uuid, session_id,
          expected_signal, source, labeler_id, labeled_at)
        VALUES ('gl-5', 'point', 'uuid-5', 'sess-1',
          'false_success', 'live_jsonl', 'self', ?)
      `).run(Date.now())
    }).not.toThrow()
  })

  test('mock_cache.kind CHECK가 embed|judge만 허용한다 (BLOCKER C9)', () => {
    // embed 허용
    expect(() => {
      db.prepare(`
        INSERT INTO mock_cache (cache_key, kind, model_id, response_json, created_at)
        VALUES ('key-1', 'embed', 'voyage-3-lite', '{}', ?)
      `).run(Date.now())
    }).not.toThrow()

    // judge 허용
    expect(() => {
      db.prepare(`
        INSERT INTO mock_cache (cache_key, kind, model_id, response_json, created_at)
        VALUES ('key-2', 'judge', 'claude-3-5-sonnet', '{}', ?)
      `).run(Date.now())
    }).not.toThrow()

    // embedding 금지 (BLOCKER C9)
    expect(() => {
      db.prepare(`
        INSERT INTO mock_cache (cache_key, kind, model_id, response_json, created_at)
        VALUES ('key-3', 'embedding', 'voyage-3-lite', '{}', ?)
      `).run(Date.now())
    }).toThrow()
  })

  test('eval_metrics 테이블이 존재한다', () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='eval_metrics'"
    ).get()
    expect(row).toBeTruthy()
  })

  test('평가 DB에는 watch_offsets와 vec_embeddings가 없다', () => {
    const watchRow = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='watch_offsets'"
    ).get()
    expect(watchRow).toBeFalsy()

    const vecRow = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_embeddings'"
    ).get()
    expect(vecRow).toBeFalsy()
  })
})

describe('마이그레이션 — DB 분리 (운영/평가, SPEC §3-1)', () => {
  test('운영/평가 DB는 각각 독립된 schema_version을 가진다', () => {
    const opDb = makeVecDb()
    const evalDb = makeDb()

    runMigrations(opDb, 'op', '0.1.0', 1024)
    runMigrations(evalDb, 'eval', '0.1.0', 1024)

    expect(getSchemaVersion(opDb)).toBe(2)
    expect(getSchemaVersion(evalDb)).toBe(1)

    opDb.close()
    evalDb.close()
  })

  test('운영 DB에는 gold_labels가 없다', () => {
    const db = makeVecDb()
    runMigrations(db, 'op', '0.1.0', 1024)
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='gold_labels'"
    ).get()
    expect(row).toBeFalsy()
    db.close()
  })

  test('평가 DB에는 events 테이블이 없다 (ATTACH로 참조)', () => {
    const db = makeDb()
    runMigrations(db, 'eval', '0.1.0', 1024)
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='events'"
    ).get()
    expect(row).toBeFalsy()
    db.close()
  })
})

describe('마이그레이션 — BLOCKER B1: embedDim이 DDL에서 사용된다', () => {
  test('embedDim=512로 마이그레이션 시 vec_embeddings가 생성된다', () => {
    const db = makeVecDb()
    // embedDim=512로 생성
    runMigrations(db, 'op', '0.1.0', 512)
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_embeddings'"
    ).get()
    expect(row).toBeTruthy()
    db.close()
  })

  test('embedDim=768로 마이그레이션 시 vec_embeddings가 생성된다', () => {
    const db = makeVecDb()
    runMigrations(db, 'op', '0.1.0', 768)
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_embeddings'"
    ).get()
    expect(row).toBeTruthy()
    db.close()
  })
})

describe('ensureSchemaVersionTable — Sub-AC 6.1 멱등성 단위 테스트', () => {
  test('schema_version 테이블이 없을 때 생성된다', () => {
    const db = makeDb()
    ensureSchemaVersionTable(db)
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).get()
    expect(row).toBeTruthy()
    db.close()
  })

  test('호출 전에는 schema_version 테이블이 없다', () => {
    const db = makeDb()
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    ).get()
    expect(row).toBeFalsy()
    db.close()
  })

  test('이미 존재하면 두 번 호출해도 에러 없이 통과한다 (멱등)', () => {
    const db = makeDb()
    ensureSchemaVersionTable(db)
    expect(() => ensureSchemaVersionTable(db)).not.toThrow()
    db.close()
  })

  test('세 번 연속 호출해도 에러 없이 통과한다 (멱등)', () => {
    const db = makeDb()
    ensureSchemaVersionTable(db)
    ensureSchemaVersionTable(db)
    expect(() => ensureSchemaVersionTable(db)).not.toThrow()
    db.close()
  })

  test('생성된 schema_version 테이블은 올바른 컬럼을 가진다', () => {
    const db = makeDb()
    ensureSchemaVersionTable(db)
    const cols = db.prepare("PRAGMA table_info(schema_version)").all() as { name: string }[]
    const names = cols.map(c => c.name)
    expect(names).toContain('id')
    expect(names).toContain('version')
    expect(names).toContain('applied_at')
    expect(names).toContain('app_version')
    expect(names).toContain('migrated_from')
    db.close()
  })

  test('schema_version 테이블에 id=1 레코드를 삽입할 수 있다', () => {
    const db = makeDb()
    ensureSchemaVersionTable(db)
    expect(() => {
      db.prepare(`
        INSERT INTO schema_version (id, version, applied_at, app_version)
        VALUES (1, 1, ?, '0.1.0')
      `).run(Date.now())
    }).not.toThrow()
    db.close()
  })

  test('schema_version 테이블은 id CHECK(id=1)를 강제한다', () => {
    const db = makeDb()
    ensureSchemaVersionTable(db)
    expect(() => {
      db.prepare(`
        INSERT INTO schema_version (id, version, applied_at, app_version)
        VALUES (2, 1, ?, '0.1.0')
      `).run(Date.now())
    }).toThrow()
    db.close()
  })

  test('ensureSchemaVersionTable 호출 후 getSchemaVersion은 0을 반환한다 (레코드 없음)', () => {
    const db = makeDb()
    ensureSchemaVersionTable(db)
    expect(getSchemaVersion(db)).toBe(0)
    db.close()
  })

  test('독립된 DB 연결에 각각 호출해도 상호 간섭 없이 동작한다', () => {
    const db1 = makeDb()
    const db2 = makeDb()
    ensureSchemaVersionTable(db1)
    ensureSchemaVersionTable(db2)
    expect(() => {
      ensureSchemaVersionTable(db1)
      ensureSchemaVersionTable(db2)
    }).not.toThrow()
    db1.close()
    db2.close()
  })
})

describe('마이그레이션 목록 구조', () => {
  test('MIGRATIONS 배열에 op 버전 1 마이그레이션이 있다', () => {
    const opV1 = MIGRATIONS.find(m => m.kind === 'op' && m.version === 1)
    expect(opV1).toBeTruthy()
  })

  test('MIGRATIONS 배열에 eval 버전 1 마이그레이션이 있다', () => {
    const evalV1 = MIGRATIONS.find(m => m.kind === 'eval' && m.version === 1)
    expect(evalV1).toBeTruthy()
  })

  test('MIGRATIONS는 버전 오름차순 정렬이 가능하다', () => {
    const opMigrations = MIGRATIONS.filter(m => m.kind === 'op').sort((a, b) => a.version - b.version)
    for (let i = 1; i < opMigrations.length; i++) {
      expect(opMigrations[i]!.version).toBeGreaterThan(opMigrations[i - 1]!.version)
    }
  })
})

// ---- Sub-AC 6.2: getAppliedMigrations 단위 테스트 ----

describe('getAppliedMigrations — Sub-AC 6.2', () => {
  test('schema_version 테이블이 없으면 빈 배열을 반환한다 (초기 상태)', () => {
    const db = makeDb()
    // schema_version 테이블 없는 순수 초기 상태
    expect(getAppliedMigrations(db)).toEqual([])
    db.close()
  })

  test('schema_version 테이블이 있으나 행이 없으면 빈 배열을 반환한다', () => {
    const db = makeDb()
    ensureSchemaVersionTable(db)
    // 테이블은 있지만 레코드 없음 (version 미적용)
    expect(getAppliedMigrations(db)).toEqual([])
    db.close()
  })

  test('운영 DB 마이그레이션 후 [1, 2]를 반환한다 (M4 notifications 추가)', () => {
    const db = makeVecDb()
    runMigrations(db, 'op', '0.1.0', 1024)
    expect(getAppliedMigrations(db)).toEqual([1, 2])
    db.close()
  })

  test('평가 DB 마이그레이션 후 [1]을 반환한다', () => {
    const db = makeDb()
    runMigrations(db, 'eval', '0.1.0', 1024)
    expect(getAppliedMigrations(db)).toEqual([1])
    db.close()
  })

  test('version=2가 기록된 경우 [1, 2]를 반환한다 (일부 적용 상태 시뮬레이션)', () => {
    const db = makeDb()
    ensureSchemaVersionTable(db)
    // version=2를 직접 삽입해 "버전 2까지 적용됨" 상태 시뮬레이션
    db.prepare(`
      INSERT INTO schema_version (id, version, applied_at, app_version)
      VALUES (1, 2, ?, '0.2.0')
    `).run(Date.now())
    expect(getAppliedMigrations(db)).toEqual([1, 2])
    db.close()
  })

  test('version=3이 기록된 경우 [1, 2, 3]을 반환한다', () => {
    const db = makeDb()
    ensureSchemaVersionTable(db)
    db.prepare(`
      INSERT INTO schema_version (id, version, applied_at, app_version)
      VALUES (1, 3, ?, '0.3.0')
    `).run(Date.now())
    expect(getAppliedMigrations(db)).toEqual([1, 2, 3])
    db.close()
  })

  test('반환 배열은 항상 오름차순이다', () => {
    const db = makeDb()
    ensureSchemaVersionTable(db)
    db.prepare(`
      INSERT INTO schema_version (id, version, applied_at, app_version)
      VALUES (1, 5, ?, '0.5.0')
    `).run(Date.now())
    const result = getAppliedMigrations(db)
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!).toBeGreaterThan(result[i - 1]!)
    }
    expect(result).toEqual([1, 2, 3, 4, 5])
    db.close()
  })

  test('두 번 호출해도 동일한 결과를 반환한다 (순수 조회)', () => {
    const db = makeVecDb()
    runMigrations(db, 'op', '0.1.0', 1024)
    const first = getAppliedMigrations(db)
    const second = getAppliedMigrations(db)
    expect(first).toEqual(second)
    db.close()
  })

  test('운영/평가 DB가 독립된 적용 목록을 가진다', () => {
    const opDb = makeVecDb()
    const evalDb = makeDb()
    runMigrations(opDb, 'op', '0.1.0', 1024)
    runMigrations(evalDb, 'eval', '0.1.0', 1024)
    expect(getAppliedMigrations(opDb)).toEqual([1, 2])
    expect(getAppliedMigrations(evalDb)).toEqual([1])
    opDb.close()
    evalDb.close()
  })

  test('마이그레이션 미적용 DB는 빈 배열, 적용 후 [1, 2]로 변경된다 (M4 notifications 추가)', () => {
    const db = makeVecDb()
    expect(getAppliedMigrations(db)).toEqual([])
    runMigrations(db, 'op', '0.1.0', 1024)
    expect(getAppliedMigrations(db)).toEqual([1, 2])
    db.close()
  })
})

// ---- Sub-AC 6.3.1: applyMigration 단위 테스트 ----

describe('applyMigration — Sub-AC 6.3.1', () => {
  test('트랜잭션 커밋 후 schema_version 행이 존재한다', () => {
    const db = makeVecDb()
    const opV1 = MIGRATIONS.find(m => m.kind === 'op' && m.version === 1)!
    applyMigration(db, opV1, '0.1.0', 1024, 0)

    const row = db.prepare(
      'SELECT id, version, app_version, migrated_from FROM schema_version WHERE id = 1'
    ).get() as { id: number; version: number; app_version: string; migrated_from: number } | undefined

    expect(row).toBeTruthy()
    expect(row!.id).toBe(1)
    expect(row!.version).toBe(1)
    db.close()
  })

  test('schema_version에 올바른 version이 기록된다', () => {
    const db = makeVecDb()
    const opV1 = MIGRATIONS.find(m => m.kind === 'op' && m.version === 1)!
    applyMigration(db, opV1, '0.1.0', 1024, 0)

    const row = db.prepare(
      'SELECT version FROM schema_version WHERE id = 1'
    ).get() as { version: number } | undefined

    expect(row?.version).toBe(opV1.version)
    db.close()
  })

  test('schema_version에 applied_at이 현재 시각(밀리초) 근방으로 기록된다', () => {
    const before = Date.now()
    const db = makeVecDb()
    const opV1 = MIGRATIONS.find(m => m.kind === 'op' && m.version === 1)!
    applyMigration(db, opV1, '0.1.0', 1024, 0)
    const after = Date.now()

    const row = db.prepare(
      'SELECT applied_at FROM schema_version WHERE id = 1'
    ).get() as { applied_at: number } | undefined

    expect(row?.applied_at).toBeGreaterThanOrEqual(before)
    expect(row?.applied_at).toBeLessThanOrEqual(after)
    db.close()
  })

  test('schema_version에 app_version이 기록된다', () => {
    const db = makeVecDb()
    const opV1 = MIGRATIONS.find(m => m.kind === 'op' && m.version === 1)!
    applyMigration(db, opV1, '1.2.3', 1024, 0)

    const row = db.prepare(
      'SELECT app_version FROM schema_version WHERE id = 1'
    ).get() as { app_version: string } | undefined

    expect(row?.app_version).toBe('1.2.3')
    db.close()
  })

  test('schema_version에 migrated_from이 기록된다', () => {
    const db = makeVecDb()
    const opV1 = MIGRATIONS.find(m => m.kind === 'op' && m.version === 1)!
    applyMigration(db, opV1, '0.1.0', 1024, 0)

    const row = db.prepare(
      'SELECT migrated_from FROM schema_version WHERE id = 1'
    ).get() as { migrated_from: number } | undefined

    expect(row?.migrated_from).toBe(0)
    db.close()
  })

  test('마이그레이션 SQL이 실제로 실행된다 (events 테이블 생성 확인)', () => {
    const db = makeVecDb()
    const opV1 = MIGRATIONS.find(m => m.kind === 'op' && m.version === 1)!
    applyMigration(db, opV1, '0.1.0', 1024, 0)

    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='events'"
    ).get()

    expect(row).toBeTruthy()
    db.close()
  })

  test('평가 DB 마이그레이션: schema_version 행이 커밋 후 존재한다', () => {
    const db = makeDb()
    const evalV1 = MIGRATIONS.find(m => m.kind === 'eval' && m.version === 1)!
    applyMigration(db, evalV1, '0.1.0', 1024, 0)

    const row = db.prepare(
      'SELECT version FROM schema_version WHERE id = 1'
    ).get() as { version: number } | undefined

    expect(row?.version).toBe(1)
    db.close()
  })

  test('실패하는 마이그레이션은 롤백되고 schema_version 행이 없다', () => {
    const db = makeDb()
    const badMigration: Migration = {
      version: 99,
      kind: 'op',
      up: (_db) => {
        throw new Error('intentional failure for rollback test')
      },
    }

    expect(() => applyMigration(db, badMigration, '0.1.0', 1024, 0)).toThrow(
      'intentional failure for rollback test',
    )

    // 롤백: schema_version 행 없어야 함
    const row = db.prepare(
      'SELECT id FROM schema_version WHERE id = 1'
    ).get()
    expect(row).toBeFalsy()
    db.close()
  })

  test('두 번 연속 applyMigration을 호출하면 schema_version이 마지막 값으로 갱신된다', () => {
    const db = makeVecDb()
    const opV1 = MIGRATIONS.find(m => m.kind === 'op' && m.version === 1)!

    // 같은 마이그레이션을 두 번 — UPSERT이므로 오류 없이 갱신돼야 함
    applyMigration(db, opV1, '0.1.0', 1024, 0)
    applyMigration(db, opV1, '0.2.0', 1024, 1)

    const row = db.prepare(
      'SELECT version, app_version FROM schema_version WHERE id = 1'
    ).get() as { version: number; app_version: string } | undefined

    expect(row?.version).toBe(1)
    expect(row?.app_version).toBe('0.2.0')
    db.close()
  })

  test('applyMigration 이후 getSchemaVersion이 해당 버전을 반환한다', () => {
    const db = makeVecDb()
    const opV1 = MIGRATIONS.find(m => m.kind === 'op' && m.version === 1)!
    applyMigration(db, opV1, '0.1.0', 1024, 0)

    expect(getSchemaVersion(db)).toBe(1)
    db.close()
  })
})
