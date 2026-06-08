#!/usr/bin/env node
// src/eval/cli/mine-real-sessions.ts
//
// ⚠️ MANUAL-ONLY: NOT a test target. ralph는 이 파일을 테스트하지 않는다. CI 실행 금지.
//
// 실 ~/.claude JSONL 세션을 마이닝해 CandidateSignal을 추출하고
// 라벨링 입력 JSON으로 stdout에 출력한다.
//
// 부수효과 격리(M6 최우선 계약):
//   - 마이닝 대상 경로는 반드시 인자(argv[2]) 또는 환경변수(LOOPBREAKER_CLAUDE_DIR)로
//     주입한다. 소스에 실경로 리터럴(~/.claude 등)을 하드코딩하지 않는다.
//   - judge/API 호출 없음 — mineCandidates는 구조 게이트 신호만 사용.
//   - import 시 부수효과 0 (isMain 가드로 직접 실행 시에만 동작).
//
// 사용:
//   node dist/eval/cli/mine-real-sessions.js /absolute/path/to/claude/projects > candidates.json
//   LOOPBREAKER_CLAUDE_DIR=/abs/path node dist/eval/cli/mine-real-sessions.js > candidates.json

import { readdirSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { DEFAULT_DETECTOR_CONFIG, type DetectorConfig } from '../../contracts.js'
import { loadReplayEvents } from '../replay-session.js'
import { mineCandidates } from '../mine-candidates.js'
import type { CandidateSignal } from '../eval-contracts.js'
import type { StoredEvent } from '../../ingest/event-store.js'

/** 마이닝 옵션 */
export interface MineRealOpts {
  /** 마이닝 대상 디렉터리 (절대경로). argv[2] 또는 env LOOPBREAKER_CLAUDE_DIR */
  claudeDir: string
  /** 탐지기 설정 (기본 DEFAULT_DETECTOR_CONFIG) */
  config?: DetectorConfig
  /** 마이닝 시각 (epoch ms, 기본 Date.now) */
  minedAt?: number
}

/**
 * argv/env에서 마이닝 대상 절대경로를 해소한다.
 * 실경로 리터럴 하드코딩 금지 — 외부 주입만.
 *
 * @throws 경로 미지정 또는 상대경로일 때
 */
export function resolveClaudeDir(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): string {
  const fromArg = argv[2]
  const fromEnv = env['LOOPBREAKER_CLAUDE_DIR']
  const dir = fromArg ?? fromEnv
  if (dir === undefined || dir.length === 0) {
    throw new Error(
      'mine-real-sessions: claudeDir 미지정. argv[2] 또는 LOOPBREAKER_CLAUDE_DIR 필요.',
    )
  }
  if (!isAbsolute(dir)) {
    throw new Error(`mine-real-sessions: 절대경로 필요. got=${dir}`)
  }
  return dir
}

/**
 * 주어진 디렉터리의 .jsonl 세션들을 마이닝해 CandidateSignal[]를 반환한다.
 * 디렉터리 내 모든 *.jsonl을 순회하며 mineCandidates를 적용한다.
 *
 * 순수 함수 — 경로는 인자로만 받아 임시 픽스처 디렉터리로도 호출 가능.
 */
export function mineRealSessions(opts: MineRealOpts): CandidateSignal[] {
  const config = opts.config ?? DEFAULT_DETECTOR_CONFIG
  const minedAt = opts.minedAt ?? Date.now()
  // ~/.claude/projects는 프로젝트별 하위 디렉터리 구조이므로 재귀 순회한다.
  const entries = readdirSync(opts.claudeDir, { recursive: true, withFileTypes: true })
  const all: CandidateSignal[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    // recursive 모드의 Dirent.parentPath(또는 path)로 전체 경로 구성.
    const parent = (entry as { parentPath?: string; path?: string }).parentPath
      ?? (entry as { path?: string }).path
      ?? opts.claudeDir
    const fullPath = join(parent, entry.name)
    const { events } = loadReplayEvents(fullPath)
    // sessionId 도출: events에서 비어있지 않은 첫 값 우선, 없으면 파일명(.jsonl 제거).
    // Claude Code는 <sessionId>.jsonl 명명을 쓰므로 파일명이 안정적 폴백.
    const fromEvent = events.find((e) => e.sessionId !== undefined && e.sessionId !== '')?.sessionId
    const sessionId = fromEvent ?? entry.name.replace(/\.jsonl$/, '')
    // StoredEvent는 NormalizedEvent를 extends — replay-session.ts와 동일 캐스팅 패턴.
    const candidates = mineCandidates(
      events as unknown as readonly StoredEvent[],
      sessionId,
      config,
      minedAt,
    )
    all.push(...candidates)
  }
  return all
}

/** import 시 실행 금지 가드 — 직접 실행(node ...)일 때만 main 동작 */
function isMain(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  return import.meta.url === `file://${entry}`
}

if (isMain()) {
  const claudeDir = resolveClaudeDir(process.argv, process.env)
  const candidates = mineRealSessions({ claudeDir })
  process.stdout.write(JSON.stringify(candidates, null, 2) + '\n')
}
