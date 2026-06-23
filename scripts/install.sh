#!/usr/bin/env bash
# scripts/install.sh — LoopBreaker 설치 자동화 (멱등).
#
# 단계: Node 점검 → 의존성 설치 → 빌드 → (선택)launchd 데몬 등록 → (선택)MCP 등록.
# 재실행 안전: 이미 된 단계는 건너뛰거나 갱신한다.
#
# 사용법:
#   scripts/install.sh                 # 전체 설치 (빌드 + launchd + MCP)
#   scripts/install.sh --no-launchd    # launchd(자동 기동) 건너뛰기
#   scripts/install.sh --no-mcp        # MCP 등록 건너뛰기
#   scripts/install.sh --build-only    # 빌드까지만 (launchd·MCP 안 함)
#
# 환경변수: LOOPBREAKER_HOME(repo 루트), LB_LOG_DIR(launchd 로그 위치)

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

DO_LAUNCHD=1
DO_MCP=1
for arg in "$@"; do
  case "$arg" in
    --no-launchd) DO_LAUNCHD=0 ;;
    --no-mcp)     DO_MCP=0 ;;
    --build-only) DO_LAUNCHD=0; DO_MCP=0 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) lb_warn "알 수 없는 옵션 무시: $arg" ;;
  esac
done

printf '\033[1mLoopBreaker 설치\033[0m  (LOOPBREAKER_HOME=%s)\n' "$LOOPBREAKER_HOME"

# ── 1. Node 점검 ─────────────────────────────────────────────────────────────
lb_step "1. 환경 점검"
lb_check_node

# ── 2. 의존성 설치 ───────────────────────────────────────────────────────────
lb_step "2. 의존성 설치"
if [ -d "$LOOPBREAKER_HOME/node_modules" ] && [ "$LOOPBREAKER_HOME/package-lock.json" -ot "$LOOPBREAKER_HOME/node_modules" ]; then
  lb_ok "node_modules 최신 — npm install 건너뜀"
else
  lb_info "npm install (better-sqlite3·sqlite-vec 네이티브 빌드 포함)…"
  ( cd "$LOOPBREAKER_HOME" && npm install --no-fund --no-audit )
  lb_ok "의존성 설치 완료"
fi

# ── 3. 빌드 ──────────────────────────────────────────────────────────────────
lb_step "3. 빌드 (tsc → dist/)"
( cd "$LOOPBREAKER_HOME" && npm run build )
[ -f "$LB_CLI_JS" ] || { lb_err "빌드 실패: $LB_CLI_JS 없음"; exit 1; }
[ -f "$LB_DAEMON_JS" ] || { lb_err "빌드 실패: $LB_DAEMON_JS 없음"; exit 1; }
lb_ok "빌드 완료 (cli·daemon·mcp)"

# ── 4. launchd 데몬 등록 (자동 기동) ─────────────────────────────────────────
if [ "$DO_LAUNCHD" -eq 1 ]; then
  lb_step "4. launchd 데몬 등록 (로그인 시 자동 기동)"
  if ! lb_has_launchctl; then
    lb_warn "launchctl 없음(macOS 아님?) — launchd 단계 건너뜀. 수동: node $LB_DAEMON_JS"
  else
    local_node="$(command -v node)"
    mkdir -p "$LB_LOG_DIR"
    # plist 플레이스홀더 치환 → LaunchAgents에 설치
    mkdir -p "$HOME/Library/LaunchAgents"
    sed -e "s#NODE_PATH#${local_node}#" \
        -e "s#DAEMON_JS_PATH#${LB_DAEMON_JS}#" \
        -e "s#LOG_DIR#${LB_LOG_DIR}#g" \
        "$LB_PLIST_SRC" > "$LB_PLIST_DST"
    lb_ok "plist 설치: $LB_PLIST_DST"
    # 멱등 load: 이미 로드돼 있으면 먼저 내린다.
    launchctl unload "$LB_PLIST_DST" 2>/dev/null || true
    if launchctl load "$LB_PLIST_DST" 2>/dev/null; then
      lb_ok "데몬 기동됨 (RunAtLoad). 로그: $LB_LOG_DIR/loopbreakerd.log"
    else
      lb_warn "launchctl load 실패 — 수동 확인 필요: launchctl load $LB_PLIST_DST"
    fi
  fi
else
  lb_step "4. launchd 데몬 등록 — 건너뜀(--no-launchd)"
fi

# ── 5. MCP 등록 (에이전트 자기점검 도구) ─────────────────────────────────────
if [ "$DO_MCP" -eq 1 ]; then
  lb_step "5. MCP 서버 등록 (에이전트 자기점검)"
  if ! lb_has_claude; then
    lb_warn "claude CLI 없음 — MCP 등록 건너뜀. 나중에: claude mcp add $LB_MCP_NAME -- node $LB_MCP_JS"
  else
    # 멱등: 이미 등록돼 있으면 제거 후 재등록(경로 갱신 보장)
    if claude mcp list 2>/dev/null | grep -q "^$LB_MCP_NAME:"; then
      claude mcp remove "$LB_MCP_NAME" >/dev/null 2>&1 || true
      lb_info "기존 등록 제거(경로 갱신)"
    fi
    if claude mcp add "$LB_MCP_NAME" -- node "$LB_MCP_JS" >/dev/null 2>&1; then
      lb_ok "MCP 등록: $LB_MCP_NAME → node $LB_MCP_JS"
    else
      lb_warn "MCP 등록 실패 — 수동: claude mcp add $LB_MCP_NAME -- node $LB_MCP_JS"
    fi
  fi
else
  lb_step "5. MCP 서버 등록 — 건너뜀(--no-mcp)"
fi

# ── 완료 ─────────────────────────────────────────────────────────────────────
lb_step "설치 완료"
lb_info "건강검진:  node $LB_CLI_JS doctor"
lb_info "상태:      node $LB_CLI_JS status"
lb_info "자기점검:  node $LB_CLI_JS self-check <세션ID|JSONL경로>"
[ "$DO_LAUNCHD" -eq 1 ] && lb_info "데몬 정지:  launchctl unload $LB_PLIST_DST"
lb_ok "LoopBreaker 사용 준비 완료"
