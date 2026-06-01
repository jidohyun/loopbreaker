/**
 * src/detect/false-success-patterns.ts
 *
 * Sub-AC 5a: detect_false_success_patterns
 *
 * 두 가지 패턴 범주를 정규식/휴리스틱으로 탐지한다:
 *   1. 근거 없는 완료선언 (UNSUBSTANTIATED_COMPLETION)
 *      — 증거 없이 완료/성공을 선언하는 표현
 *      예: "완료했습니다", "성공적으로 처리됨", "작업이 완료되었습니다"
 *
 *   2. 자기검증 순환참조 (SELF_REFERENTIAL_VERIFICATION)
 *      — 자기 자신의 확인 결과를 근거로 정상/완료를 주장하는 표현
 *      예: "내가 확인한 결과 정상임", "제가 검토한 결과 문제없습니다"
 *
 * 외부 상태·네트워크 호출 없음. 순수 함수.
 */

// ── 패턴 정의 ─────────────────────────────────────────────────────────────────

/** 탐지된 패턴의 종류 식별자 */
export type FalseSuccessPatternKind =
  | 'UNSUBSTANTIATED_COMPLETION'
  | 'SELF_REFERENTIAL_VERIFICATION'

/** 단일 패턴 규칙 */
interface PatternRule {
  /** 패턴 고유 식별자 (반환값에 포함) */
  readonly kind: FalseSuccessPatternKind
  /** 설명 (디버깅/문서용) */
  readonly description: string
  /** 탐지 정규식 (case-insensitive, unicode, 전역 플래그 사용 금지) */
  readonly regex: RegExp
}

/**
 * 근거 없는 완료선언 패턴 목록.
 *
 * 대상:
 *   - 완료/종료/성공/처리됨/마쳤습니다 등의 완료 동사 + 증거 없음
 *   - 영어 혼용 패턴 (done, completed, successfully, finished 등)
 *   - 단정적 완료 부사 패턴 ("이미 완료", "모두 완료", "정상적으로 완료")
 */
const UNSUBSTANTIATED_COMPLETION_RULES: readonly PatternRule[] = [
  {
    kind: 'UNSUBSTANTIATED_COMPLETION',
    description: '완료했습니다 / 완료하였습니다 / 완료됩니다',
    regex: /완료\s*했\s*습니다|완료\s*하였\s*습니다|완료\s*됩니다/iu,
  },
  {
    kind: 'UNSUBSTANTIATED_COMPLETION',
    description: '완료되었습니다 / 완료됐습니다',
    regex: /완료\s*되었\s*습니다|완료\s*됐\s*습니다/iu,
  },
  {
    kind: 'UNSUBSTANTIATED_COMPLETION',
    description: '성공적으로 처리 / 성공적으로 완료',
    regex: /성공적\s*으로\s*(처리|완료|수행|작동|실행)/iu,
  },
  {
    kind: 'UNSUBSTANTIATED_COMPLETION',
    description: '작업이 완료 / 처리가 완료 / 수행이 완료',
    regex: /(작업|처리|수행|실행|설정|구현|수정|업데이트)\s*(이|가|은|는)?\s*완료/iu,
  },
  {
    kind: 'UNSUBSTANTIATED_COMPLETION',
    description: '정상적으로 완료 / 정상 완료',
    regex: /정상\s*(적\s*으로)?\s*완료/iu,
  },
  {
    kind: 'UNSUBSTANTIATED_COMPLETION',
    description: '모두 완료 / 이미 완료 / 전부 완료',
    regex: /(모두|이미|전부|다)\s*완료/iu,
  },
  {
    kind: 'UNSUBSTANTIATED_COMPLETION',
    description: '마쳤습니다 / 끝냈습니다 / 끝마쳤습니다',
    regex: /(마쳤|끝냈|끝마쳤)\s*습니다/iu,
  },
  {
    kind: 'UNSUBSTANTIATED_COMPLETION',
    description: 'successfully completed / done / finished (영어)',
    regex: /successfully\s+(completed|processed|executed|finished|done)/iu,
  },
  {
    kind: 'UNSUBSTANTIATED_COMPLETION',
    description: 'task completed / task done (영어)',
    regex: /task\s+(is\s+)?(completed|done|finished)/iu,
  },
  {
    kind: 'UNSUBSTANTIATED_COMPLETION',
    description: '수정이 완료 / 수정 완료되었',
    regex: /수정\s*(이|가)?\s*완료/iu,
  },
]

/**
 * 자기검증 순환참조 패턴 목록.
 *
 * 대상:
 *   - 1인칭 주어(내가/제가/저는/나는) + 확인/검토/검사 + 결과 정상/문제없음
 *   - 자기 자신의 출력을 자기가 검증하는 순환 구조
 *   - "확인했으니/검토했으니 문제없다" 류의 인과 단정
 */
const SELF_REFERENTIAL_VERIFICATION_RULES: readonly PatternRule[] = [
  {
    kind: 'SELF_REFERENTIAL_VERIFICATION',
    description: '내가/제가 확인한 결과 정상/문제없음',
    regex: /(내|제)\s*가\s*(확인|검토|검사|점검)\s*(한|해\s*본)?\s*결과\s*(정상|문제\s*없|이상\s*없)/iu,
  },
  {
    kind: 'SELF_REFERENTIAL_VERIFICATION',
    description: '저는/나는 확인한 결과 문제없습니다',
    regex: /(저\s*는|나\s*는)\s*(확인|검토|검사)\s*(한|해)?\s*결과\s*(정상|문제\s*없|이상\s*없)/iu,
  },
  {
    kind: 'SELF_REFERENTIAL_VERIFICATION',
    description: '확인한 결과 정상적으로 작동 / 정상 작동 확인',
    regex: /확인\s*(한|해\s*본)?\s*결과\s*정상\s*(적\s*으로)?\s*(작동|동작|실행|처리)/iu,
  },
  {
    kind: 'SELF_REFERENTIAL_VERIFICATION',
    description: '직접 확인했으니 / 검토했으니 문제없다',
    regex: /직접\s*(확인|검토|검사)\s*(했|하였)\s*(으니|으므로|했으니|했으므로)\s*(문제|이상)\s*없/iu,
  },
  {
    kind: 'SELF_REFERENTIAL_VERIFICATION',
    description: '검증 결과 이상 없음 / 검증했으며 문제없음 (자기 참조)',
    regex: /(검증|확인)\s*(결과|했으며|하였으며)\s*(이상|문제)\s*없/iu,
  },
  {
    kind: 'SELF_REFERENTIAL_VERIFICATION',
    description: '내가/제가 테스트한 결과 정상 / 통과',
    regex: /(내|제)\s*가\s*(테스트|실행|확인)\s*(한|해\s*본)\s*결과\s*(정상|통과|문제\s*없|이상\s*없)/iu,
  },
  {
    kind: 'SELF_REFERENTIAL_VERIFICATION',
    description: 'I verified / I confirmed and it works (영어 자기검증)',
    regex: /i\s+(verified|confirmed|checked)\s+(and\s+)?(it\s+)?(works|is\s+(fine|ok|correct|working|normal))/iu,
  },
  {
    kind: 'SELF_REFERENTIAL_VERIFICATION',
    description: 'as I confirmed / as I verified (영어 순환참조)',
    regex: /as\s+i\s+(confirmed|verified|checked|tested)/iu,
  },
]

// ── 전체 규칙 목록 (순서 보존) ─────────────────────────────────────────────────

const ALL_RULES: readonly PatternRule[] = [
  ...UNSUBSTANTIATED_COMPLETION_RULES,
  ...SELF_REFERENTIAL_VERIFICATION_RULES,
]

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 텍스트에서 가짜성공(false_success) 관련 패턴을 탐지한다.
 *
 * 두 가지 범주의 패턴을 정규식/휴리스틱으로 검사한다:
 *   - UNSUBSTANTIATED_COMPLETION: 근거 없는 완료선언
 *   - SELF_REFERENTIAL_VERIFICATION: 자기검증 순환참조
 *
 * 특성:
 *   - 순수 함수: 입력 text 외 외부 상태·네트워크 미사용.
 *   - 불변성: 입력 text를 변경하지 않는다.
 *   - 중복 제거: 같은 kind가 여러 규칙에 매칭되어도 결과 목록에 1회만 포함된다.
 *   - 순서 보장: UNSUBSTANTIATED_COMPLETION → SELF_REFERENTIAL_VERIFICATION 순서 유지.
 *   - 빈 문자열/공백 입력은 빈 배열 반환.
 *
 * @param text 검사할 텍스트 (NormalizedEvent.text, JudgeVerdict.reason 등)
 * @returns 매칭된 패턴 식별자 목록 (중복 없음, 선언 순서 유지)
 *
 * @example
 * detectFalseSuccessPatterns('작업이 완료되었습니다')
 * // => ['UNSUBSTANTIATED_COMPLETION']
 *
 * detectFalseSuccessPatterns('내가 확인한 결과 정상입니다')
 * // => ['SELF_REFERENTIAL_VERIFICATION']
 *
 * detectFalseSuccessPatterns('다음 단계를 진행합니다')
 * // => []
 */
export function detectFalseSuccessPatterns(text: string): FalseSuccessPatternKind[] {
  if (text.trim().length === 0) {
    return []
  }

  const matched = new Set<FalseSuccessPatternKind>()

  for (const rule of ALL_RULES) {
    if (rule.regex.test(text)) {
      matched.add(rule.kind)
    }
  }

  // 선언 순서 유지: UNSUBSTANTIATED_COMPLETION → SELF_REFERENTIAL_VERIFICATION
  const ordered: FalseSuccessPatternKind[] = []
  const kindOrder: FalseSuccessPatternKind[] = [
    'UNSUBSTANTIATED_COMPLETION',
    'SELF_REFERENTIAL_VERIFICATION',
  ]
  for (const kind of kindOrder) {
    if (matched.has(kind)) {
      ordered.push(kind)
    }
  }

  return ordered
}

/**
 * 텍스트가 가짜성공(false_success) 패턴을 포함하는지 여부를 반환한다.
 *
 * `detectFalseSuccessPatterns`의 boolean 래퍼.
 * 근거 없는 완료선언(UNSUBSTANTIATED_COMPLETION) 또는
 * 자기검증 순환참조(SELF_REFERENTIAL_VERIFICATION) 중 하나라도 탐지되면 true.
 *
 * 특성:
 *   - 순수 함수: 입력 text 외 외부 상태·네트워크 미사용.
 *   - 빈 문자열/공백 입력은 false 반환.
 *
 * @param text 검사할 텍스트
 * @returns 가짜성공 패턴 포함 시 true, 미포함 시 false
 *
 * @example
 * classifyFalseSuccess('작업이 완료되었습니다') // => true
 * classifyFalseSuccess('내가 확인한 결과 정상입니다') // => true
 * classifyFalseSuccess('다음 단계를 진행합니다') // => false
 */
export function classifyFalseSuccess(text: string): boolean {
  return detectFalseSuccessPatterns(text).length > 0
}

/**
 * Sub-AC 5b: 자기검증 순환참조 패턴(self-referential loop)을 탐지한다.
 *
 * 자기 자신의 확인/검증 결과를 근거로 정상/완료를 주장하는 순환 구조를 감지한다.
 * 예: '내가 확인했으니 맞다', '이전 응답 참조', '제가 검토한 결과 문제없습니다' 류.
 *
 * 탐지 패턴:
 *   1. 1인칭 자기검증 ("내가/제가 확인한 결과 정상")
 *   2. 이전 응답/출력 자기 참조 ("이전 응답에서 언급한", "앞서 확인한 바와 같이")
 *   3. 자기 생성물 근거 주장 ("제가 작성한 코드이므로", "내가 생성한 내용이니")
 *   4. 직접 확인 후 단정 ("직접 확인했으니 문제없다", "검토했으니 이상없음")
 *   5. 영어 자기검증 ("I verified and it works", "as I confirmed")
 *   6. 이전 응답 참조 영어 ("as I mentioned", "as I stated before")
 *
 * 특성:
 *   - 순수 함수: 입력 text 외 외부 상태·네트워크 미사용.
 *   - 불변성: 입력 text를 변경하지 않는다.
 *   - 빈 문자열/공백 입력은 false 반환.
 *
 * @param text 검사할 텍스트 (에이전트 응답 텍스트, JudgeVerdict.reason 등)
 * @returns 자기검증 순환참조 패턴 감지 시 true, 미감지 시 false
 *
 * @example
 * classifySelfReferentialLoop('내가 확인했으니 맞다')           // => true
 * classifySelfReferentialLoop('이전 응답을 참조하세요')          // => true
 * classifySelfReferentialLoop('CI 테스트가 모두 통과했습니다')   // => false
 */
export function classifySelfReferentialLoop(text: string): boolean {
  if (text.trim().length === 0) {
    return false
  }

  // SELF_REFERENTIAL_VERIFICATION_RULES를 재사용
  for (const rule of SELF_REFERENTIAL_VERIFICATION_RULES) {
    if (rule.regex.test(text)) {
      return true
    }
  }

  // 추가 순환참조 패턴: 이전 응답/출력 자기 참조
  const ADDITIONAL_LOOP_PATTERNS: readonly RegExp[] = [
    // 이전 응답/출력 참조 (한국어)
    /이전\s*(응답|답변|출력|메시지|내용)\s*(에서|을|를|에|참조|참고)/iu,
    // 앞서/방금 확인/언급한 바와 같이
    /(앞서|방금|이미)\s*(확인|언급|기술|작성)\s*(한|했던)?\s*(바|대로|바와\s*같이|것처럼)/iu,
    // 자기 생성물 근거 주장 (제가 작성한 / 내가 만든)
    /(제|내)\s*가\s*(작성|생성|구현|작업)\s*(한|했던)\s*(코드|내용|결과|것)\s*(이니|이므로|이라서|이기\s*때문에|여서)/iu,
    // 내가 만든 결과이니 / 제가 만든 것이므로
    /(제|내)\s*가\s*만든\s*(코드|내용|결과|것|출력)\s*(이니|이므로|이라서|이기\s*때문에|여서)/iu,
    // 이전 응답 참조 영어
    /as\s+i\s+(mentioned|stated|said|noted|wrote)\s*(before|earlier|previously|above)?/iu,
    // 내 이전 응답 참조 영어
    /(in\s+my\s+(previous|last|prior|earlier)\s+(response|answer|message|output))/iu,
    // 내가 확인/검증했으니 (인과 단정)
    /(내|제)\s*가\s*(확인|검토|검증|점검)\s*(했|하였)\s*(으니|으므로|니까|니|므로)/iu,
  ]

  for (const pattern of ADDITIONAL_LOOP_PATTERNS) {
    if (pattern.test(text)) {
      return true
    }
  }

  return false
}
