# LoopBreaker

> 코딩 AI 에이전트(Claude Code)의 세션을 macOS 로컬에서 실시간 분석해, 규칙으로는 안 잡히는 **의미적 실패**(헛돌기·가짜 성공)를 탐지하고 근거와 함께 사람을 호출하는 **read-only 미들웨어**.

LoopBreaker는 Claude Code가 남기는 세션 JSONL 로그를 읽기만 합니다. 코드를 수정하거나 에이전트를 차단하지 않습니다. 대신 "지금 AI가 같은 실패를 반복하며 헛돌고 있다" 또는 "성공했다고 선언했지만 실제로는 검증을 우회했다"는 패턴을 포착해, **왜 그렇게 판단했는지 근거와 함께** 데스크톱 알림·웹훅·CLI로 알려줍니다.

---

## 무엇을 탐지하나

| 탐지 대상 | 설명 |
|---|---|
| **thrashing (헛돌기)** | 같은 파일을 반복 편집하거나 동일 에러를 계속 내며 진전 없이 맴도는 패턴 |
| **false_success (가짜 성공)** | 검증 없이 자기승인으로 "완료"를 선언하거나, 순환 참조로 성공을 위장하는 패턴 |

규칙 기반 단일 신호가 아니라 **2단계 탐지**를 씁니다:

1. **1차 — 구조 게이트 (저비용)**: 슬라이딩 윈도에서 반복 편집·동일 에러·자기승인 시간 간격 등 구조 신호로 후보를 추린다. API 호출 없음.
2. **2차 — 의미 판정 (게이트 통과분만)**: 임베딩 유사도(STAGE2) + LLM-as-judge로 "정말 헛도는지 / 정말 가짜 성공인지"를 의미 수준에서 판정한다. judge는 self-consistency·position-swap으로 편향을 완화한다.

비용이 드는 2차는 **1차 통과분에만** 돌려 API 비용을 최소화합니다.

---

## 아키텍처

```
[Claude Code] --append--> session-XXXX.jsonl
        │
        ▼ (1) chokidar 파일 변경 감지
[WatchSource] ──▶ [SessionRegistry] ──▶ [SessionPipeline] (세션당 1, 직렬 큐)
                                              │
   TailReader(증분 read) → parseLine → orderEvents → event-store(멱등 적재)
        → 구조 게이트 → [hits→triples bridge] → 의미 판정(임베딩) → LLM-judge
        → DetectionRecord(중간 산출 전부 보존)
        │
        ▼ (2) 임계·디바운스 판정
[VerdictRouter] ──▶ [NotifyDispatcher] ──▶ 데스크톱 / 웹훅 / CLI 알림
                                              (근거 evidence 동반)
```

- **데몬**(`loopbreakerd`)은 단일 Node 프로세스. launchd가 수명을 관리하고, lockfile로 단일 인스턴스를 보장합니다.
- **세션 격리**: 세션마다 독립 파이프라인(직렬 큐, concurrency=1)이라 한 세션의 장애가 데몬 전체나 다른 세션을 죽이지 않습니다.
- **at-least-once**: 크래시 후 재시작하면 `byteOffset`부터 재개하고, 멱등 업서트로 중복을 흡수합니다.
- **데이터는 로컬 SQLite**. 임베딩·judge만 외부 API(Voyage/OpenAI 임베딩, Anthropic judge). 운영 DB(`loopbreaker.db`)와 평가 DB(`loopbreaker-eval.db`)를 분리하고, 평가는 운영 DB를 read-only로만 참조합니다.

### 디렉터리 구조

```
src/
├── contracts.ts          단일 SSOT 타입/스키마 (전 영역 import)
├── ingest/               JSONL 파싱·정렬·증분 read·멱등 적재
├── detect/               구조 게이트 · 의미 판정 · LLM-judge · DetectionRecord
├── api/                  EmbedClient/JudgeClient 인터페이스 + Mock (실 SDK 격리)
├── notify/               VerdictRouter · NotifyDispatcher · 알림 sink 4종
├── storage/              StorageLayer (WAL·sqlite-vec·마이그레이션·단일 writer 큐)
├── config/               zod 설정 로드 + 중첩→평면 매핑 + 핫리로드
├── watch/                WatchSource 추상화 + ChokidarWatchSource 어댑터 + SessionRegistry
├── daemon/               메인루프(Daemon) · lockfile · graceful shutdown · 실행 엔트리
├── eval/                 평가 하니스 (metrics · calibrate · replay · report · 골드셋)
└── cli/                  loopbreaker CLI 디스패처
```

---

## 설치 & 빌드

요구사항: **Node.js 20+**, macOS.

### 에이전트용 설치

Claude Code 같은 AI 에이전트에게 아래 프롬프트를 그대로 주면 됩니다. 모든 설치 로직은
`scripts/install.sh`(멱등·재실행 안전)에 있으므로, 에이전트는 그 스크립트를 실행하기만 하면 됩니다.

> **LoopBreaker 설치 프롬프트 (에이전트에게 그대로 전달):**
>
> LoopBreaker repo를 찾아 `scripts/install.sh`를 실행해 설치해줘.
> 1. repo 위치는 `LOOPBREAKER_HOME` 환경변수를 먼저 보고, 없으면
>    `~/Desktop/Backup/loopbreaker`, `~/loopbreaker`, `~/Projects/loopbreaker` 순으로 찾아.
>    (`package.json`에 `"name": "loopbreaker"`가 있는 디렉터리가 repo 루트)
> 2. 못 찾으면 나에게 repo 경로를 물어봐. 찾으면 그 경로로:
>    `LOOPBREAKER_HOME=<repo> bash <repo>/scripts/install.sh` 실행.
>    (MCP만 원하면 `--no-launchd`, 빌드만 원하면 `--build-only` 플래그)
> 3. 설치 후 `node <repo>/dist/cli/index.js doctor`와 `claude mcp list | grep loopbreaker`로
>    확인하고 결과를 알려줘. (Node 20+ 필요, macOS)

`scripts/install.sh`가 하는 일: Node 20+ 점검 → `npm install` → 빌드 → launchd 데몬 자동
기동 등록(plist 경로 치환·`launchctl load`) → MCP 등록(`claude mcp add`). 전부 멱등.

> MCP 도구(`mcp__loopbreaker__*`)는 등록 후 **다음 세션부터** 노출됩니다(현재 세션엔 즉시 안 뜸).
> 노출 도구와 사용법은 아래 [에이전트 통합 (MCP)](#에이전트-통합-mcp) 참고.

### 자동 설치 (권장)

의존성 설치 → 빌드 → launchd 자동 기동 등록 → MCP 등록을 한 번에:

```bash
git clone <repo> && cd loopbreaker
scripts/install.sh              # 전체 (빌드 + launchd + MCP)
scripts/install.sh --no-launchd # 빌드 + MCP만 (자동 기동 안 함)
scripts/install.sh --build-only # 빌드만
```

멱등(재실행 안전)하며, plist 경로 치환·launchctl load·`claude mcp add`를 자동 처리합니다.

제거:

```bash
scripts/uninstall.sh              # launchd·MCP 해제 + ~/.loopbreaker 삭제
scripts/uninstall.sh --keep-state # config·DB 보존
```

repo 소스와 `~/.claude/projects/**` 세션 JSONL은 절대 건드리지 않습니다.

### 수동 빌드

```bash
npm install
npm run build      # dist/ 생성
npm test           # 4,700+ 테스트
```

---

## 사용법

### CLI

```bash
loopbreaker status            # 데몬 상태·세션 수·누적 탐지·최근 5건
loopbreaker status --json     # JSON 출력
loopbreaker doctor            # 설정·~/.claude·DB·API키 건강검진
loopbreaker start --foreground  # 데몬을 포그라운드로 직접 실행
loopbreaker version
loopbreaker help
```

빌드 전이라면 `node dist/cli/index.js <command>` 또는 `npm start`로 실행할 수 있습니다.

### 백그라운드 데몬 (launchd)

`scripts/install.sh`가 plist 경로 치환·등록·기동을 자동 처리합니다(위 자동 설치).
직접 제어가 필요하면:

```bash
launchctl list | grep com.loopbreaker.daemon                          # 상태
launchctl unload ~/Library/LaunchAgents/com.loopbreaker.daemon.plist  # 정지
launchctl load   ~/Library/LaunchAgents/com.loopbreaker.daemon.plist  # 재기동
tail -f ~/Library/Logs/loopbreakerd.log                               # 로그
```

> 수동 설치 시: plist의 `NODE_PATH` / `DAEMON_JS_PATH` / `LOG_DIR` 플레이스홀더를
> 실제 경로로 치환한 뒤 `~/Library/LaunchAgents/`에 복사해야 합니다 — `scripts/install.sh`가 이를 자동화합니다.

### 에이전트 통합 (MCP)

LoopBreaker는 **MCP 서버**로도 동작합니다. Claude Code 같은 AI 에이전트가 작업 중에
"내가 지금 같은 실패를 반복하며 헛돌고 있나?"를 **스스로** 물어볼 수 있습니다.
데몬(실시간 감시)과 달리, MCP는 에이전트가 필요할 때 직접 호출하는 자기점검 도구입니다.

**노출 도구 (모두 read-only, API 키 불필요):**

| 도구 | 하는 일 |
|---|---|
| `loopbreaker_self_check` | 세션 JSONL(경로 또는 세션 ID)을 분석해 지금 thrashing 중인지 판정 |
| `loopbreaker_status` | 데몬 상태·감시 세션 수·누적 탐지·최근 탐지 |
| `loopbreaker_recent_detections` | 최근 탐지 목록만 추려서 반환 |

**설치**는 위 [에이전트용 설치 (MCP 자가설치)](#에이전트용-설치-mcp-자가설치)를 참고하세요(자가설치 블록·사람용 등록).

**스크립트·CI용 (MCP 없이 CLI로):** 종료 코드로 분기할 수 있습니다 — `0`=정상, `2`=thrashing 발화, `1`=입력 오류.

```bash
node dist/cli/index.js self-check <세션ID|JSONL경로> --json
# {"thrashing":true,"severity":"critical","eventCount":11,"hitCount":6,
#  "verdict":"thrashing 감지: 6건 …","hits":[{"subtype":"file_edit_loop",…}]}
```

### 설정

`~/.loopbreaker/config.json` (없으면 zod 기본값 사용):

```jsonc
{
  "version": 1,
  "detector": {
    "WARNING": 10, "CRITICAL": 20,
    "fileEditWarn": 5, "fileEditCrit": 8,
    "simThresh": 0.90, "decideThresh": 0.7,
    "embedModelId": "voyage-3-lite",
    "judgeModelId": "claude-3-5-sonnet-20241022",
    "embedDim": 1024,
    "notifyChannels": ["desktop", "cli"]
  },
  "watch":  { "sessionGlob": "~/.claude/projects/**/*.jsonl" },
  "notify": { "desktop": true, "includeEvidence": true }
}
```

**핫리로드**: 임계값·디바운스·알림 채널·API 상한 등 **안전 필드**는 무중단 적용됩니다. DB 경로·임베딩 차원·모델 ID 등 **위험 필드**는 재기동을 요구하며 런타임 변경은 거부됩니다.

LLM judge 단계에 실제 API를 쓰려면 `ANTHROPIC_API_KEY` 환경변수를 설정하세요. 미설정 시 Mock으로 폴백합니다.

---

## 평가 하니스

탐지 품질을 정량 측정하는 도구가 `src/eval/`에 있습니다.

- **골드셋**: thrashing/false_success/none 라벨. 출처는 `live_jsonl`(실 세션 마이닝) / `synthetic`(합성) / `dohyun_adapted`(자기승인우회 사례).
- **메트릭**: 클래스별 precision/recall/F1 + macroF1 + Cohen's κ + balanced accuracy, 모든 지표에 **Wilson 95% 신뢰구간** 동반. thrashing은 IoU span 매칭(τ=0.5), false_success는 anchor±k(k=5) 매칭. 클래스당 양성이 15건 미만이면 F1/κ를 생략하고 정성 분석으로 폴백합니다.
- **캘리브레이션**: `CalibrationGrid`를 stratified k-fold로 탐색해 `objective = macroF1 − λ·FPR_none`을 최대화하는 임계값을 선택합니다. (기본값 `DEFAULT_DETECTOR_CONFIG`는 복사 후 오버라이드 — 원본 불변)
- **리플레이**: 녹화된 JSONL을 **동일 파이프라인**으로 재구동해 결정론적으로 재현합니다(라이브 데모의 백업). 평가 모드에서는 알림을 발송하지 않습니다.
- **리포트**: md/JSON 리포트를 생성하며, 아래 정직한 한계를 반드시 인용합니다.

실 세션 마이닝은 별도 수동 도구(`src/eval/cli/mine-real-sessions.ts`, MANUAL-ONLY)로 분리되어 있습니다 — 개인정보·실파일 접근이 자동 테스트에 새지 않도록 격리한 설계입니다.

---

## 정직한 한계

평가 결과를 해석할 때 반드시 함께 읽어야 할 한계입니다.

1. **참조 상한**: IBM 하이브리드 사이클 탐지(arXiv:2511.10650)의 F1=0.72는 우리의 목표가 아니라 참고점일 뿐입니다. 도메인·골드셋이 다르므로 초과를 주장하지 않습니다.
2. **골드셋 규모**: n=30~200, 단일 라벨러(본인). 검정력이 낮아 모든 지표에 Wilson 신뢰구간을 동반하며, support가 작은 클래스(특히 false_success)는 구간이 넓습니다.
3. **라벨 신뢰 상한**: intra-rater κ가 모델 성능의 천장입니다. 모델이 "사람만큼 일관적"일 수는 있어도 그 이상은 아닙니다.
4. **합성 분리**: 합성 양성으로 부풀린 수치를 주 지표로 쓰지 않습니다. 실데이터 기준이 결론, 실+합성은 부록입니다.
5. **캘리브레이션 과적합**: 임계값은 이 골드셋에 맞춰졌습니다. 새 프로젝트/스타일에서는 재캘리브가 필요하며, nested-CV 외부 폴드 수치만 일반화 추정으로 인용합니다.
6. **정량 목표 미설정**: "정밀도 X% 달성" 식 약속을 하지 않습니다. "이 방법으로 측정했고, 측정값은 이렇고, 이 한계 안에서 해석하라"가 정량 증거입니다.

추가로: at-least-once(exactly-once 아님), macOS fs 이벤트의 합침/누락 가능성(폴링 백업으로 복구하되 초 단위 지연), append-only JSONL 가정, 외부 API 비용·가용성 의존, 권한(풀 디스크 액세스·알림)은 사용자 수동 허용 필요 — 자세한 내용은 `docs/SPEC.md` §7을 참고하세요.

---

## 개발

- **단일 SSOT**: 모든 타입·스키마·표준화 결정은 `src/contracts.ts`. 다른 영역은 import만 하고 재정의하지 않습니다.
- **테스트 부수효과 0**: 모든 테스트는 Mock(WatchSource/Embed/Judge/NotifySink)·임시 경로·in-memory DB로 동작합니다. 실 네트워크·OS 알림·실 `~/.claude` 감시가 일어나지 않습니다. 외부 의존(`chokidar`/`node-notifier`/SDK)은 어댑터 안에만 격리됩니다.
- **마이그레이션**: append-only. 운영 DB v2, 평가 DB v2.

```bash
npm run typecheck   # tsc --noEmit
npm test            # 전체 테스트
npm run test:coverage
```

SPEC(`docs/SPEC.md`)이 단일 명세 출처입니다. 구현은 마일스톤 M0~M6으로 진행됐고, 각 마일스톤의 Seed는 `docs/seed-mN.yaml`에 있습니다.

---

## 상태

핵심 라이브러리(파싱·탐지·judge·알림·데몬·평가)와 CLI/데몬 실행 엔트리·launchd 정의까지 완성됐습니다. 다음 단계는 실 세션 골드셋 마이닝 → 라벨링 → 실측 리포트(위 정직한 한계 동반)입니다.
