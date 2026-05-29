// src/config/config-schema.ts
// DetectorConfig + 전체 LoopBreaker 설정의 zod 스키마.
// BLOCKER C3: DetectorConfig는 평면 구조.
// BLOCKER B2: embedModelId는 Voyage/OpenAI, judgeModelId는 Anthropic.

import { z } from 'zod'
import { DEFAULT_DETECTOR_CONFIG } from '../contracts.js'

// ---- DetectorConfig zod 스키마 (평면 구조, BLOCKER C3) ----
export const detectorConfigSchema = z.object({
  WARNING: z.number().int().positive().default(DEFAULT_DETECTOR_CONFIG.WARNING),
  CRITICAL: z.number().int().positive().default(DEFAULT_DETECTOR_CONFIG.CRITICAL),
  circuitBreaker: z.number().int().positive().default(DEFAULT_DETECTOR_CONFIG.circuitBreaker),
  historySize: z.number().int().positive().default(DEFAULT_DETECTOR_CONFIG.historySize),
  errLoopWarn: z.number().int().positive().default(DEFAULT_DETECTOR_CONFIG.errLoopWarn),
  errLoopCrit: z.number().int().positive().default(DEFAULT_DETECTOR_CONFIG.errLoopCrit),
  fileEditWarn: z.number().int().positive().default(DEFAULT_DETECTOR_CONFIG.fileEditWarn),
  fileEditCrit: z.number().int().positive().default(DEFAULT_DETECTOR_CONFIG.fileEditCrit),
  simThresh: z.number().min(0).max(1).default(DEFAULT_DETECTOR_CONFIG.simThresh),
  decideThresh: z.number().min(0).max(1).default(DEFAULT_DETECTOR_CONFIG.decideThresh),
  selfApprovalMs: z.number().int().positive().default(DEFAULT_DETECTOR_CONFIG.selfApprovalMs),
  selfApprovalCriticalMs: z.number().int().positive().default(DEFAULT_DETECTOR_CONFIG.selfApprovalCriticalMs),
  judgeSelfConsistencyN: z.number().int().min(1).default(DEFAULT_DETECTOR_CONFIG.judgeSelfConsistencyN),
  judgePositionSwaps: z.number().int().min(0).default(DEFAULT_DETECTOR_CONFIG.judgePositionSwaps),
  // BLOCKER B2: Voyage/OpenAI 모델 ID
  embedModelId: z.string().min(1).default(DEFAULT_DETECTOR_CONFIG.embedModelId),
  // BLOCKER B2: Anthropic 모델 ID
  judgeModelId: z.string().min(1).default(DEFAULT_DETECTOR_CONFIG.judgeModelId),
  // BLOCKER B1: embedDim은 DDL 생성 시 사용
  embedDim: z.number().int().positive().default(DEFAULT_DETECTOR_CONFIG.embedDim),
})

// ---- Privacy 설정 ----
export const privacyConfigSchema = z.object({
  redactFilePaths: z.boolean().default(true),
  sendCodeToApi: z.enum(['none', 'snippets', 'full']).default('snippets'),
  maxSnippetChars: z.number().int().positive().default(2000),
  embedReasoning: z.boolean().default(false),
})

// ---- API 설정 ----
export const apiConfigSchema = z.object({
  maxConcurrentApiCalls: z.number().int().positive().default(4),
  apiMaxRetries: z.number().int().min(0).default(3),
  dailyCostCapUsd: z.number().positive().default(5.0),
  maxJudgeCallsPerSession: z.number().int().positive().default(50),
})

// ---- Watch 설정 ----
export const watchConfigSchema = z.object({
  sessionGlob: z.string().min(1).default('~/.claude/projects/**/*.jsonl'),
  pollSafetyIntervalMs: z.number().int().positive().default(3000),
  usePollingFallback: z.enum(['auto', 'always', 'never']).default('auto'),
  orphanTimeoutMs: z.number().int().positive().default(5000),
})

// ---- Webhook 설정 ----
export const webhookConfigSchema = z.object({
  url: z.string().url().nullable().default(null),
  minSeverity: z.enum(['low', 'medium', 'high']).default('high'),
})

// ---- Notify 설정 ----
export const notifyConfigSchema = z.object({
  desktop: z.boolean().default(true),
  includeEvidence: z.boolean().default(true),
  notifyDebounceMs: z.number().int().positive().default(60000),
})

// ---- 전체 config.json 스키마 ----
export const loopBreakerConfigSchema = z.object({
  version: z.literal(1),
  detector: detectorConfigSchema,
  privacy: privacyConfigSchema,
  api: apiConfigSchema,
  watch: watchConfigSchema,
  webhook: webhookConfigSchema,
  notify: notifyConfigSchema,
})

export type DetectorConfigInput = z.input<typeof detectorConfigSchema>
export type DetectorConfigParsed = z.output<typeof detectorConfigSchema>
export type LoopBreakerConfig = z.output<typeof loopBreakerConfigSchema>
export type PrivacyConfig = z.output<typeof privacyConfigSchema>
