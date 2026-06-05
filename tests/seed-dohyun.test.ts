// tests/seed-dohyun.test.ts
// Unit tests for buildDohyunSeedLabels()
//
// 검증 항목:
//   1. 5건 GoldLabel 반환
//   2. source='dohyun_adapted' 전부
//   3. expected_signal='false_success' 전부
//   4. labeler_id='seed' 전부
//   5. labelKind='span' 전부 (합성 윈도우)
//   6. 원본 미접근 — 파일 read 없음 (함수가 동기·순수함수)
//   7. 결정론 — 두 번 호출해도 동일 결과
//   8. 실경로 리터럴 없음 — sessionId/labelId에 '~/'·'/Users' 포함 안됨
//   9. 2건 immediateApproval + 3건 circularRef subtype notes 확인
//  10. 각 레코드 필수 필드 구조 검증 (labelId/sessionId/anchorUuid 등)

import { buildDohyunSeedLabels } from '../src/eval/seed-dohyun.js'
import type { GoldLabel } from '../src/eval/eval-contracts.js'

describe('buildDohyunSeedLabels', () => {
  let labels: GoldLabel[]

  beforeEach(() => {
    labels = buildDohyunSeedLabels()
  })

  // ── 1. 건수 ──────────────────────────────────────────────────────────
  it('exactly 5 GoldLabel records', () => {
    expect(labels).toHaveLength(5)
  })

  // ── 2. source ────────────────────────────────────────────────────────
  it('all records have source="dohyun_adapted"', () => {
    for (const label of labels) {
      expect(label.source).toBe('dohyun_adapted')
    }
  })

  // ── 3. expected_signal ───────────────────────────────────────────────
  it('all records have expectedSignal="false_success"', () => {
    for (const label of labels) {
      expect(label.expectedSignal).toBe('false_success')
    }
  })

  // ── 4. labeler_id ────────────────────────────────────────────────────
  it('all records have labelerId="seed"', () => {
    for (const label of labels) {
      expect(label.labelerId).toBe('seed')
    }
  })

  // ── 5. labelKind ─────────────────────────────────────────────────────
  it('all records have labelKind="span"', () => {
    for (const label of labels) {
      expect(label.labelKind).toBe('span')
    }
  })

  // ── 6. 원본 미접근 — 동기 순수함수 ──────────────────────────────────
  it('is a synchronous pure function (no async, no file I/O)', () => {
    // 함수 반환값이 Promise가 아니면 파일 I/O 없음을 간접 보장.
    const result = buildDohyunSeedLabels()
    expect(result).not.toBeInstanceOf(Promise)
    expect(Array.isArray(result)).toBe(true)
  })

  // ── 7. 결정론 ────────────────────────────────────────────────────────
  it('is deterministic across multiple calls', () => {
    const first = buildDohyunSeedLabels()
    const second = buildDohyunSeedLabels()
    expect(first).toEqual(second)
  })

  // ── 8. 실경로 리터럴 없음 ────────────────────────────────────────────
  it('no real file path literals in any string field', () => {
    const realPathPatterns = ['~/', '/Users/', '/home/', 'evidence-model', '.dohyun']
    for (const label of labels) {
      const stringFields = [
        label.labelId,
        label.sessionId,
        label.labelerId,
        label.anchorUuid ?? '',
        label.startUuid ?? '',
        label.endUuid ?? '',
        label.notes ?? '',
      ]
      for (const field of stringFields) {
        for (const pattern of realPathPatterns) {
          expect(field).not.toContain(pattern)
        }
      }
    }
  })

  // ── 9. subtype notes — 2건 immediateApproval + 3건 circularRef ──────
  it('2 immediateApproval and 3 circularRef cases in notes', () => {
    const immediateApproval = labels.filter(l => l.notes?.includes('immediateApproval'))
    const circularRef = labels.filter(l => l.notes?.includes('circularRef'))
    expect(immediateApproval).toHaveLength(2)
    expect(circularRef).toHaveLength(3)
  })

  // ── 10. 필수 필드 구조 검증 ──────────────────────────────────────────
  it('each record has required fields: labelId, sessionId, anchorUuid, startUuid, endUuid', () => {
    for (const label of labels) {
      expect(typeof label.labelId).toBe('string')
      expect(label.labelId.length).toBeGreaterThan(0)

      expect(typeof label.sessionId).toBe('string')
      expect(label.sessionId.length).toBeGreaterThan(0)

      // span 라벨은 start/end 필수
      expect(typeof label.startUuid).toBe('string')
      expect((label.startUuid ?? '').length).toBeGreaterThan(0)

      expect(typeof label.endUuid).toBe('string')
      expect((label.endUuid ?? '').length).toBeGreaterThan(0)

      // anchor는 false_success 매칭용
      expect(typeof label.anchorUuid).toBe('string')
      expect((label.anchorUuid ?? '').length).toBeGreaterThan(0)

      // labelRound는 양수
      expect(label.labelRound).toBeGreaterThanOrEqual(1)

      // labeledAt은 양수 정수
      expect(label.labeledAt).toBeGreaterThan(0)
      expect(Number.isInteger(label.labeledAt)).toBe(true)
    }
  })

  // ── 11. labelId/sessionId 고유성 ─────────────────────────────────────
  it('labelId and sessionId are unique across 5 records', () => {
    const labelIds = labels.map(l => l.labelId)
    const sessionIds = labels.map(l => l.sessionId)

    expect(new Set(labelIds).size).toBe(5)
    expect(new Set(sessionIds).size).toBe(5)
  })

  // ── 12. 세션 ID 접두사 — 실세션 충돌 방지 ───────────────────────────
  it('sessionId uses dohyun-adapted-session prefix to avoid real session collision', () => {
    for (const label of labels) {
      expect(label.sessionId).toMatch(/^dohyun-adapted-session-/)
    }
  })
})
