# 인공지능 프로젝트 개발일지 (KPT 회고) — LoopBreaker

> 차수별 정리. 1차=사전조사·기획·SPEC·M0 / 2차=M1~M2 / 3차=M3~M5 / 4차=M6·제품포장·골드셋·발표
> 이름: 지도현 · 학번: 3413 · 프로젝트: LoopBreaker

---

# 📘 1차 — 사전조사 · 기획 · 개발명세(SPEC) · 골격(M0)

## 1. 기본 정보
- **프로젝트 제목:** LoopBreaker — 코딩 AI 에이전트의 실시간 실패 탐지·사람 호출 미들웨어
- **학번:** 3413
- **이름:** 지도현
- **제출 회차:** 1차

## 2. 개발 진행 내용
- **수행한 작업:** 주제 발굴·확정, 1차 사전조사 기획서 작성(8개 항목), 2차 개발명세서(SPEC) 작성·통합검증, 프로젝트 골격(M0) 구현.
- **구현한 기능:** `contracts.ts`(단일 SSOT 타입/스키마), SQLite 마이그레이션 러너(op/eval DB 분리, WAL), 프로젝트 디렉터리 골격.
- **조사 및 학습내용:** 실제 사고 사례(Replit 운영DB 삭제 1,200명 영향, Amazon Kiro 13시간 장애), 본인 dohyun 하니스의 자기승인 우회 5건 실측, METR(작업 길이 7개월마다 2배)·Gartner(2026 신규 앱 40% 에이전트 탑재) 시장 근거.
- **사용한 기술:** TypeScript/Node 20, better-sqlite3, sqlite-vec, zod, ouroboros(ralph 자율코딩).

## 3. 프로젝트 진행 현황
- **현재 진행단계:** 기획·명세 완료, 구현 착수(M0 골격).
- **완료된 작업:** 기획서, SPEC(5영역 + contracts SSOT + §1-1 정합화 패치노트 7 BLOCKER), M0 골격(175 테스트 통과, 커밋 1bdc974).
- **진행 중 작업:** M1(파서·저장) 준비.

## 4. KPT 회고
**Keep (잘된 점)**
- 문제 정의를 가설이 아니라 **내 실제 세션 로그 실측**(자기승인 우회 5건)으로 잡아 설득력을 확보.
- SPEC을 단일 SSOT(contracts.ts) 중심으로 설계해 이후 13개 영역 간 타입 충돌을 사전 차단.

**Problem (어려웠던 점)**
- 영역별로 따로 설계한 SPEC 본문이 합의된 contracts와 어긋남(enum 철자 3가지, 타입 재정의, DDL 컬럼 불일치).

**Try (개선 시도 / 다음 계획)**
- 적대적 검증으로 7개 BLOCKER를 잡아 §1-1 "정합화 패치 노트"에 정본 규칙으로 못 박음. 이후 구현은 본문이 아니라 이 규칙을 따르도록 통일.

## 5. 다음 개발 계획
- **다음 목표:** M1 — JSONL 파서·정렬·증분 read·멱등 적재.
- **구현 예정 기능:** normalize/classifyResult, orderEvents(고아 버퍼), TailReader(byteOffset), event-store 멱등 업서트.
- **추가 조사 기술:** chokidar 파일 감시, Claude Code 세션 JSONL 스키마.

## 6. 느낀 점
"무엇을·왜"를 충분히 못 박지 않으면 코드가 흔들린다는 걸 SPEC 단계에서 체감했다. 특히 단일 SSOT를 먼저 세우는 투자가 이후 모든 마일스톤의 회귀를 막는 토대가 됐다.

---

# 📗 2차 — 인제스트(M1) · 구조 게이트(M2)

## 1. 기본 정보
- **프로젝트 제목:** LoopBreaker · **학번:** 3413 · **이름:** 지도현 · **제출 회차:** 2차

## 2. 개발 진행 내용
- **수행한 작업:** ralph 자율코딩으로 M1(파서/저장)·M2(구조 게이트) 구현, 마일스톤 경계 정합화, 통합 글루·통합 테스트 보완.
- **구현한 기능:**
  - M1: 라인→NormalizedEvent 정규화, ts→parentUuid→byteOffset 정렬, 고아 버퍼, TailReader 증분 read, events 멱등 적재, 리플레이 라운드트립 무손실.
  - M2: ActionTriple 생성, 슬라이딩 윈도 반복/동일파일 편집 탐지(StructureGate), SessionState ring-buffer.
- **조사 및 학습내용:** thrashing의 구조 신호(반복 편집·동일 에러), 미세변형 반복 판정(Jaccard 유사도), at-least-once 복구(byteOffset 재개 + 멱등).
- **사용한 기술:** chokidar, SHA-256 해시, 슬라이딩 윈도 알고리즘.

## 3. 프로젝트 진행 현황
- **현재 진행단계:** 인제스트~구조 탐지(1차 게이트) 완료.
- **완료된 작업:** M1(473 테스트, 커밋 478d927), M2(1,268 테스트, 커밋 b04a745).
- **진행 중 작업:** M3(의미 판정·LLM-judge) 준비.

## 4. KPT 회고
**Keep**
- ralph가 산출물을 worktree에 남겨, job이 timeout으로 죽어도 검증→머지로 진행하는 패턴 확립.
- 모든 외부 의존을 인터페이스+Mock으로 추상화해 테스트 부수효과 0 유지.

**Problem**
- ralph가 마일스톤을 격리 구현해 **통합 글루(events→triple→gate)와 경계 정합(M1 출력↔M2 입력 형태)을 놓침.** 실제로 M1 파서는 kind=top-level type인데 M2는 kind==='tool_use'만 처리해 통합 시 전혀 발화 안 함. 또 ralph가 모순된 두 테스트를 작성(미세변형 반복=발화 vs delta 다르면=null).

**Try**
- detection-pipeline에 toGateEvent 어댑터(tool 있으면 kind 정규화)로 경계 해소. 모순 테스트는 SPEC §4 기준으로 화해(Jaccard 0.3 임계). **머지 후 반드시 end-to-end 통합 테스트로 경계 검증**을 루틴화.

## 5. 다음 개발 계획
- **다음 목표:** M3 — 의미 판정(임베딩) + LLM-as-judge + DetectionRecord 누적.
- **구현 예정 기능:** EmbedClient/JudgeClient 인터페이스+Mock, semantic-stage, judge(self-consistency·position-swap), 단조 누적 record.
- **추가 조사 기술:** 임베딩 코사인 유사도, LLM 편향 완화(arXiv:2406.07791).

## 6. 느낀 점
자율 코딩 에이전트(ralph)는 부품은 잘 만들지만 **부품 사이를 잇는 글루를 마지막에 놓친다.** 이 패턴을 일찍 파악해 "검증→통합 글루 보완"을 표준 절차로 만든 게 이후 마일스톤의 속도를 끌어올렸다.

---

# 📙 3차 — 의미 판정(M3) · 알림(M4) · 데몬 통합(M5)

## 1. 기본 정보
- **프로젝트 제목:** LoopBreaker · **학번:** 3413 · **이름:** 지도현 · **제출 회차:** 3차

## 2. 개발 진행 내용
- **수행한 작업:** M3~M5를 ralph 자율코딩 + 통합 글루 직접 보완으로 구현. AI 핵심(2단계 탐지)과 알림, 단일 데몬 메인루프 완성.
- **구현한 기능:**
  - M3: 임베딩 유사도(STAGE2) + LLM-judge(루브릭·CoT·self-consistency·position-swap) + DetectionRecord 단조 누적, fail-closed.
  - M4: VerdictRouter(임계+디바운스 순수함수), NotifyDispatcher(채널별 발송·실패 격리), CooldownStore(인메모리+SQLite), 알림 sink 4종(Mock/Desktop/Webhook/CLI), notifications 마이그레이션(op v2).
  - M5: lockfile 단일 인스턴스, StorageLayer(WAL+sqlite-vec+단일 writer 큐), WatchSource 추상화+ChokidarWatchSource 어댑터, SessionRegistry, SessionPipeline(세션당 직렬 큐), Daemon 메인루프, gracefulShutdown.
- **조사 및 학습내용:** LLM-as-judge 편향 방어, 2단계 비용 최소화(게이트 통과분만 judge), chokidar import 어댑터 격리, hits→triples bridge 설계.
- **사용한 기술:** node-notifier(어댑터 격리), prompt caching 전략, DI(의존성 주입) 패턴.

## 3. 프로젝트 진행 현황
- **현재 진행단계:** 탐지~알림~데몬(운영 경로) 완성.
- **완료된 작업:** M3(2,630 테스트, 커밋 13a503b), M4(3,483 테스트, 커밋 04262e8), M5(4,265 테스트, 커밋 5a7704a). tsc 0 에러, 회귀 0.
- **진행 중 작업:** M6(평가 하니스) 준비.

## 4. KPT 회고
**Keep**
- 모킹 원칙을 끝까지 고수: @anthropic-ai/sdk 미설치로 실 API를 **물리적으로 차단**, 테스트는 Mock·임시경로·in-memory만. 부수효과 0.
- 데몬을 전부 DI로 조립해 Mock/임시경로로 기동·정지 가능 → end-to-end 통합 테스트가 가능해짐.

**Problem**
- M5에서 ralph가 timeout으로 메인루프 조립부(daemon.ts start/stop, session-registry 콜백 배선)를 못 끝냄. ralph가 daemon.ts 대신 daemon-factory.ts(DI 보관만)를 만들어둠.

**Try**
- 부품 시그니처를 Explore 워크플로우로 수집→설계서→글루 직접 작성. DaemonFactory는 기존 테스트 보호 위해 안 건드리고 별도 Daemon 클래스 신설. config 스키마에 DB/lock 경로가 없어 DaemonPaths로 별도 주입.

## 5. 다음 개발 계획
- **다음 목표:** M6 — 평가·검증 하니스 + 골드셋.
- **구현 예정 기능:** metrics(혼동행렬·Wilson CI·κ·IoU 매칭), calibrate(격자 k-fold), replay(동일 파이프라인 재구동), report, 골드셋 구축.
- **추가 조사 기술:** Cohen's κ·Balanced Accuracy, 소표본 정성 폴백, op_main read-only ATTACH.

## 6. 느낀 점
탐지·알림·데몬까지 운영 경로가 한 줄로 이어지는 순간이 가장 보람 있었다. 특히 "비싼 API는 신호가 강할 때만 부른다"는 2단계 설계가 비용과 정확도의 균형점이라는 걸 구현하며 확신하게 됐다.

---

# 📕 4차 — 평가 하니스(M6) · 제품 포장 · 골드셋 마이닝 · 발표자료

## 1. 기본 정보
- **프로젝트 제목:** LoopBreaker — 코딩 AI 에이전트의 실시간 실패 탐지·사람 호출 미들웨어
- **학번:** 3413
- **이름:** 지도현
- **제출 회차:** 4차

## 2. 개발 진행 내용
- **수행한 작업:** M6 평가 하니스 구현, SPEC §6 제품 포장(CLI/데몬 엔트리/launchd), 실 세션 골드셋 마이닝, 발표자료(PPTX+발표자 스크립트) 제작.
- **구현한 기능:**
  - M6: eval-contracts(평가 타입), metrics(precision/recall/F1/macroF1/Cohen's κ/Balanced Accuracy + Wilson 95% CI, thrashing=IoU span 매칭 τ=0.5, false_success=anchor±5, computeMetrics), calibrate(CalibrationGrid stratified k-fold, objective=macroF1−λ·FPR_none, DEFAULT copy+override, 소표본 정성폴백), replay-session(녹화 JSONL→동일 파이프라인 재구동, dispatcher 스킵, is_replay), mine-candidates·seed-dohyun·gold-label-store·label-cli, eval v2 마이그레이션(op_main read-only ATTACH).
  - 제품 포장: `loopbreaker` CLI(start/stop/status/doctor/version/help), daemon-entry(프로덕션 부품 조립+--foreground), launchd plist, package.json bin.
  - 골드셋: 실 세션 1,845개 마이닝 → thrashing 후보 65건(고유 31) → 골드셋 72건(thrashing 31·none 36·false_success 5).
- **조사 및 학습내용:** 소표본 분류 평가 방법론(Wilson CI, κ 해석), better-sqlite3 ATTACH read-only 제약(file: URI 미지원 → OS 파일 권한 위임), 평가 부수효과 격리(실 마이닝 MANUAL-ONLY 분리).
- **사용한 기술:** Wilson score interval·Cohen's κ(직접 구현), stratified k-fold, python-pptx(발표자료), Notion(개발일지).

## 3. 프로젝트 진행 현황
- **현재 진행단계:** 🎉 **LoopBreaker 전체(M0~M6) 완성 + 제품 포장 + 발표자료까지 완료.**
- **완료된 작업:** M6(커밋 c7a0037), CLI/launchd(커밋 ee62cde), 한국어 README(6470d99), 골드셋 마이닝 도구 수정(c8211f9). **tsc 0 에러, 229 suites / 4,705 테스트 통과, 회귀 0.** 골드셋 72건 구축. 발표 PPTX 13장(발표자 스크립트 포함).
- **진행 중 작업:** 실측 리포트(replay→metrics→calibrate→report) 산출, 기획서 제출.

## 4. KPT 회고
**Keep (잘된 점 / 유지할 점)**
- **정직성을 끝까지 유지:** "정밀도 X% 달성" 같은 정량 목표를 약속하지 않고, 모든 지표에 Wilson 95% 신뢰구간을 달았다. 소표본(false_success 5<15)은 F1/κ를 생략하고 정성 폴백. 합성 데이터는 부록, 실데이터가 결론.
- **부수효과 격리 일관성:** 평가도 Mock·임시경로·합성 픽스처만으로 테스트하고, 실 세션 마이닝(개인정보)은 MANUAL-ONLY CLI로 분리.
- **통합 테스트의 가치 입증:** end-to-end 테스트가 ralph가 못 잡은 실버그(op_main read-only가 eval 본체 쓰기까지 막음)를 잡아냄.

**Problem (문제점 / 어려웠던 점)**
- M6에서도 ralph가 timeout으로 조립부(calibrate/report/CLI/통합테스트)를 못 끝냄.
- **op_main read-only ATTACH 실버그:** ralph의 `query_only=ON` pragma가 connection 단위라 eval 본체(gold_labels) 쓰기까지 막았다. better-sqlite3는 file: URI ATTACH를 지원하지 않아 schema 단위 read-only가 막혀 있었다.
- 마이닝 도구가 `~/.claude/projects` 하위 디렉터리 구조를 재귀 순회하지 못하고, sessionId가 빈 문자열로 떨어지는 버그.

**Try (개선 시도 / 다음 계획)**
- op_main read-only를 **op DB 파일의 OS 권한(chmod 0o444)에 위임**하는 방식으로 해결(context7 문서 + 실측 검증). 9b/9c read-only 테스트를 chmod 방식으로 통일(eval 쓰기 허용 + op_main 쓰기 차단 둘 다 검증).
- 마이닝 도구를 `readdirSync(recursive:true)` + sessionId 파일명 폴백으로 수정.
- 빠진 조립부는 부품 시그니처 수집→설계서→직접 작성으로 보완(M5와 동일 절차).

## 5. 다음 개발 계획
- **다음 목표:** 골드셋 72건으로 실측 리포트 산출(replay→computeMetrics→calibrate→renderReportMd), SPEC §8 6대 한계 동반. 기획서 제출(nerhwida@naver.com).
- **구현 예정 기능 (M7+):** PreToolUse deny·Stop block 자동 차단("Detect first, Block later"), Windows/Linux 확장, 골드셋 다중 라벨러 확대(intra-rater κ 천장 상향).
- **추가 조사 기술:** nested cross-validation(캘리브레이션 과적합 방지), 실 Anthropic judge API record 모드.

## 6. 느낀 점
프로젝트의 마지막 회차에서 가장 크게 배운 건 **"만든 만큼 측정한다"**는 원칙이었다. 탐지 코드(5,073 LOC)만큼 평가 코드(3,703 LOC)를 크게 짰고, 정량 목표를 약속하는 대신 한계를 정직하게 드러내는 게 오히려 측정의 신뢰를 만든다는 걸 체감했다. 또 자율 코딩 에이전트(ralph)를 6개 마일스톤 내내 운용하며, "에이전트가 못 잡는 통합 글루와 실버그를 사람이 통합 테스트로 잡아낸다"는 협업 모델 — 이게 바로 내가 LoopBreaker로 만들려던 "AI를 곁에서 지켜보는 사람"의 역할 그 자체였다는 점이 가장 인상 깊었다.
