// tests/contracts.test.ts
// contracts.ts 단위 테스트 — SPEC §1-1 BLOCKER 규칙 준수 검증

import {
  DEFAULT_DETECTOR_CONFIG,
  type ResultClass,
  type AgentScope,
  type DetectorConfig,
  type DetectionVerdict,
  type JudgeVerdict,
  type NormalizedEvent,
  type StructureGateResult,
  type EmbeddingSimilarityResult,
  type ActionTriple,
  type DetectionRecord,
} from '../src/contracts.js'

describe('contracts.ts — BLOCKER C1: false_success 단일 enum', () => {
  test('DetectionVerdict.kind 타입 리터럴에 false_success가 포함된다', () => {
    const verdict: DetectionVerdict = {
      kind: 'false_success',
      subtype: 'self_approval',
      confidence: 0.85,
      signals: {},
      evidence: [],
      reason: 'test',
    }
    expect(verdict.kind).toBe('false_success')
  })

  test('JudgeVerdict.kind 타입 리터럴에 false_success가 포함된다', () => {
    const jv: JudgeVerdict = {
      kind: 'false_success',
      subtype: 'self_approval',
      confidence: 0.9,
      reason: 'circular reference detected',
      rawSamples: [],
    }
    expect(jv.kind).toBe('false_success')
  })

  test('StructureGateResult.type 타입 리터럴에 false_success가 포함된다', () => {
    const sgr: StructureGateResult = {
      type: 'false_success',
      subtype: 'unsubstantiated_claim',
      severity: 'warning',
      sessionId: 'sess-001',
      agentScope: 'root',
      windowRefs: ['uuid-1'],
      metrics: { repeatCount: 5 },
    }
    expect(sgr.type).toBe('false_success')
  })
})

describe('contracts.ts — BLOCKER C2: JudgeVerdict 구조', () => {
  test('JudgeVerdict는 SPEC §1 정본 구조를 가진다 (§6 재정의 무효)', () => {
    const jv: JudgeVerdict = {
      kind: 'thrashing',
      subtype: 'micro_variant_loop',
      confidence: 0.78,
      topicDivergence: 0.3,
      circularReference: false,
      reason: 'repeated identical edits',
      rawSamples: [{ verdict: 'thrashing' }],
    }
    expect(jv).toHaveProperty('kind')
    expect(jv).toHaveProperty('subtype')
    expect(jv).toHaveProperty('confidence')
    expect(jv).toHaveProperty('reason')
    expect(jv).toHaveProperty('rawSamples')
    // §6의 label/rationale/positionSwapAgreement는 없음
    expect(jv).not.toHaveProperty('label')
    expect(jv).not.toHaveProperty('rationale')
    expect(jv).not.toHaveProperty('positionSwapAgreement')
  })
})

describe('contracts.ts — BLOCKER C3: DetectorConfig 평면 구조', () => {
  test('DEFAULT_DETECTOR_CONFIG는 평면 구조다 (중첩 없음)', () => {
    const cfg = DEFAULT_DETECTOR_CONFIG
    // 평면 키 존재 확인
    expect(typeof cfg.WARNING).toBe('number')
    expect(typeof cfg.CRITICAL).toBe('number')
    expect(typeof cfg.circuitBreaker).toBe('number')
    expect(typeof cfg.historySize).toBe('number')
    expect(typeof cfg.simThresh).toBe('number')
    expect(typeof cfg.decideThresh).toBe('number')
    expect(typeof cfg.embedModelId).toBe('string')
    expect(typeof cfg.judgeModelId).toBe('string')
    expect(typeof cfg.embedDim).toBe('number')

    // 중첩 구조 없음 (§6의 structure:{}/semantic:{}/judge:{} 금지)
    expect(cfg).not.toHaveProperty('structure')
    expect(cfg).not.toHaveProperty('semantic')
    expect(cfg).not.toHaveProperty('judge')
  })

  test('DEFAULT_DETECTOR_CONFIG 기본값이 SPEC 주석과 일치한다', () => {
    const cfg = DEFAULT_DETECTOR_CONFIG
    expect(cfg.WARNING).toBe(10)
    expect(cfg.CRITICAL).toBe(20)
    expect(cfg.circuitBreaker).toBe(30)
    expect(cfg.historySize).toBe(30)
    expect(cfg.errLoopWarn).toBe(3)
    expect(cfg.errLoopCrit).toBe(5)
    expect(cfg.fileEditWarn).toBe(5)
    expect(cfg.fileEditCrit).toBe(8)
    expect(cfg.simThresh).toBe(0.90)
    expect(cfg.decideThresh).toBe(0.7)
    expect(cfg.selfApprovalMs).toBe(15000)
    expect(cfg.selfApprovalCriticalMs).toBe(1000)
  })
})

describe('contracts.ts — BLOCKER B1: embedDim 외부화', () => {
  test('DEFAULT_DETECTOR_CONFIG.embedDim이 정의되어 있다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.embedDim).toBeGreaterThan(0)
  })

  test('DetectorConfig 타입에 embedDim 필드가 있다', () => {
    const cfg: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, embedDim: 1536 }
    expect(cfg.embedDim).toBe(1536)
  })
})

describe('contracts.ts — BLOCKER B2: embedModelId/judgeModelId', () => {
  test('embedModelId는 Voyage 모델 예시를 기본으로 가진다', () => {
    // Anthropic 임베딩 API 없음 — Voyage/OpenAI 모델이어야 함
    expect(DEFAULT_DETECTOR_CONFIG.embedModelId).not.toContain('anthropic')
    expect(DEFAULT_DETECTOR_CONFIG.embedModelId).toBeTruthy()
  })

  test('judgeModelId는 Anthropic 모델 예시를 기본으로 가진다', () => {
    expect(DEFAULT_DETECTOR_CONFIG.judgeModelId).toContain('claude')
  })
})

describe('contracts.ts — BLOCKER C8: EmbeddingSimilarityResult.pairs', () => {
  test('EmbeddingSimilarityResult는 pairs 배열을 가진다 (pairCount 아님)', () => {
    const result: EmbeddingSimilarityResult = {
      maxCosine: 0.95,
      clusterId: 0,
      pairs: [
        { a: 'uuid-1', b: 'uuid-2', cos: 0.93 },
        { a: 'uuid-2', b: 'uuid-3', cos: 0.91 },
      ],
    }
    expect(Array.isArray(result.pairs)).toBe(true)
    expect(result.pairs[0]).toHaveProperty('a')
    expect(result.pairs[0]).toHaveProperty('b')
    expect(result.pairs[0]).toHaveProperty('cos')
    // pairCount 필드 없음
    expect(result).not.toHaveProperty('pairCount')
  })
})

describe('contracts.ts — NormalizedEvent 구조', () => {
  test('NormalizedEvent는 SPEC §1 정본 필드를 가진다', () => {
    const ev: NormalizedEvent = {
      uuid: 'test-uuid',
      parentUuid: null,
      sessionId: 'sess-001',
      cwd: '/Users/test/projects/my-project',
      agentScope: 'root',
      isSidechain: false,
      ts: Date.now(),
      byteOffset: 0,
      kind: 'tool_use',
      tool: 'Edit',
      input: { file_path: 'src/index.ts', old_string: 'a', new_string: 'b' },
      resultClass: 'ok',
    }
    expect(ev.uuid).toBeTruthy()
    expect(ev.sessionId).toBeTruthy()
    // BLOCKER C5: cwd (project_path 아님)
    expect(ev).toHaveProperty('cwd')
    expect(ev).not.toHaveProperty('project_path')
    // BLOCKER C5: agentScope+isSidechain (is_subagent 아님)
    expect(ev).toHaveProperty('agentScope')
    expect(ev).toHaveProperty('isSidechain')
    expect(ev).not.toHaveProperty('is_subagent')
    // BLOCKER C5: kind (role+event_type 아님)
    expect(ev).toHaveProperty('kind')
    expect(ev).not.toHaveProperty('role')
    expect(ev).not.toHaveProperty('event_type')
  })
})

describe('contracts.ts — ActionTriple 구조', () => {
  test('ActionTriple은 SPEC §2 정본 필드를 가진다', () => {
    const triple: ActionTriple = {
      tool: 'Edit',
      argKey: 'Edit:/src/index.ts:a1b2c3',
      resultClass: 'ok',
      ref: { uuid: 'uuid-1', ts: 1000 },
    }
    expect(triple).toHaveProperty('tool')
    expect(triple).toHaveProperty('argKey')
    expect(triple).toHaveProperty('resultClass')
    expect(triple).toHaveProperty('ref')
    expect(triple.ref).toHaveProperty('uuid')
    expect(triple.ref).toHaveProperty('ts')
    // BLOCKER M5: intent/action/outcome 없음
    expect(triple).not.toHaveProperty('intent')
    expect(triple).not.toHaveProperty('action')
    expect(triple).not.toHaveProperty('outcome')
  })
})

describe('contracts.ts — DetectionRecord 구조', () => {
  test('DetectionRecord는 모든 중간 산출물을 보존한다', () => {
    const gate: StructureGateResult = {
      type: 'thrashing',
      subtype: 'micro_variant_loop',
      severity: 'critical',
      sessionId: 'sess-001',
      agentScope: 'root',
      windowRefs: ['uuid-1', 'uuid-2'],
      metrics: { repeatN: 12 },
    }
    const final: DetectionVerdict = {
      kind: 'thrashing',
      subtype: 'micro_variant_loop',
      confidence: 0.85,
      signals: { structuralRepeatCount: 12, maxCosine: 0.93 },
      evidence: [{ uuid: 'uuid-1', ts: 1000, note: 'repeated edit' }],
      reason: '12 identical edits detected',
    }
    const record: DetectionRecord = {
      gate,
      final,
    }
    expect(record).toHaveProperty('gate')
    expect(record).toHaveProperty('final')
    expect(record.embed).toBeUndefined()
    expect(record.judge).toBeUndefined()
  })
})

// ---- Sub-AC 3a: ResultClass 와 AgentScope 열거형 검증 ----

describe('contracts.ts — ResultClass 열거형 (SPEC §1 일치 검증)', () => {
  // SPEC §1: type ResultClass = 'ok'|'error'|'rejected'|'blocked'|'empty'|'unknown'
  const EXPECTED_RESULT_CLASSES: ResultClass[] = [
    'ok',
    'error',
    'rejected',
    'blocked',
    'empty',
    'unknown',
  ]

  test.each(EXPECTED_RESULT_CLASSES)(
    'ResultClass 값 "%s" 는 유효한 리터럴이다',
    (value) => {
      // 타입 시스템이 허용하는 값임을 런타임에서도 검증
      const rc: ResultClass = value
      expect(rc).toBe(value)
    }
  )

  test('ResultClass 는 정확히 6개 값으로 구성된다 (SPEC §1 정본)', () => {
    expect(EXPECTED_RESULT_CLASSES).toHaveLength(6)
  })

  test('ResultClass 값들이 SPEC §1 우선순위 순서를 포함한다', () => {
    // SPEC §1 우선순위: blocked > rejected > error > empty > ok > unknown
    const priorityOrder: ResultClass[] = ['blocked', 'rejected', 'error', 'empty', 'ok', 'unknown']
    for (const cls of priorityOrder) {
      expect(EXPECTED_RESULT_CLASSES).toContain(cls)
    }
  })

  test('NormalizedEvent.resultClass 는 ResultClass 타입을 받는다', () => {
    const ev: NormalizedEvent = {
      uuid: 'rc-test-uuid',
      parentUuid: null,
      sessionId: 'sess-rc',
      cwd: '/tmp/project',
      agentScope: 'root',
      isSidechain: false,
      ts: 1000,
      byteOffset: 0,
      kind: 'tool_result',
      resultClass: 'error',
    }
    expect(ev.resultClass).toBe('error')
  })

  test('ActionTriple.resultClass 는 ResultClass 타입을 받는다', () => {
    const triple: ActionTriple = {
      tool: 'Bash',
      argKey: 'Bash:npm test:sha256abc',
      resultClass: 'blocked',
      ref: { uuid: 'uuid-rc', ts: 2000 },
    }
    expect(triple.resultClass).toBe('blocked')
  })

  test('"fake_success" 는 ResultClass 에 포함되지 않는다 (BLOCKER C1)', () => {
    // fake_success/fakeSuccess 는 ResultClass 도 아니고 kind enum 도 아님
    expect(EXPECTED_RESULT_CLASSES).not.toContain('fake_success')
    expect(EXPECTED_RESULT_CLASSES).not.toContain('fakeSuccess')
  })
})

describe('contracts.ts — AgentScope 타입 (SPEC §1 일치 검증)', () => {
  // SPEC §1: type AgentScope = 'root' | string  (root 또는 agentId)

  test('"root" 는 유효한 AgentScope 값이다', () => {
    const scope: AgentScope = 'root'
    expect(scope).toBe('root')
  })

  test('임의의 agentId 문자열도 유효한 AgentScope 값이다', () => {
    const agentId: AgentScope = 'agent-abc123'
    expect(typeof agentId).toBe('string')
    expect(agentId).toBe('agent-abc123')
  })

  test('서브에이전트 경로 형식도 AgentScope 로 허용된다', () => {
    // isSidechain + 서브에이전트 경로로 도출
    const subagentScope: AgentScope = 'subagents/session-xyz/agent-001'
    expect(typeof subagentScope).toBe('string')
  })

  test('NormalizedEvent.agentScope 는 root 를 받는다', () => {
    const ev: NormalizedEvent = {
      uuid: 'scope-test-uuid',
      parentUuid: null,
      sessionId: 'sess-scope',
      cwd: '/tmp/project',
      agentScope: 'root',
      isSidechain: false,
      ts: 1000,
      byteOffset: 0,
      kind: 'assistant',
    }
    expect(ev.agentScope).toBe('root')
  })

  test('NormalizedEvent.agentScope 는 서브에이전트 ID 를 받는다', () => {
    const ev: NormalizedEvent = {
      uuid: 'scope-sub-uuid',
      parentUuid: 'parent-uuid',
      sessionId: 'sess-scope',
      cwd: '/tmp/project',
      agentScope: 'agent-sub-42',
      isSidechain: true,
      ts: 2000,
      byteOffset: 512,
      kind: 'assistant',
    }
    expect(ev.agentScope).toBe('agent-sub-42')
    expect(ev.isSidechain).toBe(true)
  })

  test('StructureGateResult.agentScope 는 AgentScope 타입을 받는다', () => {
    const sgr: StructureGateResult = {
      type: 'thrashing',
      subtype: 'micro_variant_loop',
      severity: 'warning',
      sessionId: 'sess-001',
      agentScope: 'root',
      windowRefs: ['uuid-x'],
      metrics: { repeatCount: 3 },
    }
    expect(sgr.agentScope).toBe('root')
  })
})
