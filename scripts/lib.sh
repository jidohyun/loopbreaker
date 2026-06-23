#!/usr/bin/env bash
# scripts/lib.sh — install/uninstall 공통 헬퍼.
#
# source 전용 (직접 실행하지 않는다). install.sh / uninstall.sh가 불러 쓴다.

# ── 경로 해석 ────────────────────────────────────────────────────────────────
# LOOPBREAKER_HOME: repo 루트. 우선순위:
#   1. 환경변수 LOOPBREAKER_HOME (명시)
#   2. 이 스크립트(scripts/lib.sh)의 부모의 부모 = repo 루트 (자동)
# 스크립트는 항상 repo 안에 있으므로 (2)가 신뢰할 수 있는 기본값이다.
_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOOPBREAKER_HOME="${LOOPBREAKER_HOME:-$(cd "$_lib_dir/.." && pwd)}"
export LOOPBREAKER_HOME

# 운영 상태 디렉터리 (config·DB·lock). 데몬 기본값과 일치(~/.loopbreaker).
LB_STATE_DIR="${LB_STATE_DIR:-$HOME/.loopbreaker}"
# launchd plist 설치 위치
LB_PLIST_SRC="$LOOPBREAKER_HOME/launchd/com.loopbreaker.daemon.plist"
LB_PLIST_LABEL="com.loopbreaker.daemon"
LB_PLIST_DST="$HOME/Library/LaunchAgents/$LB_PLIST_LABEL.plist"
# 로그 디렉터리 (launchd는 부모 디렉터리를 안 만들어주므로 우리가 만든다)
LB_LOG_DIR="${LB_LOG_DIR:-$HOME/Library/Logs}"
# 빌드 산출물
LB_DAEMON_JS="$LOOPBREAKER_HOME/dist/daemon/daemon-entry.js"
LB_MCP_JS="$LOOPBREAKER_HOME/dist/mcp/server.js"
LB_CLI_JS="$LOOPBREAKER_HOME/dist/cli/index.js"
LB_MCP_NAME="loopbreaker"

# ── 출력 헬퍼 ────────────────────────────────────────────────────────────────
lb_info()  { printf '  \033[36m›\033[0m %s\n' "$*"; }
lb_ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
lb_warn()  { printf '  \033[33m⚠\033[0m %s\n' "$*"; }
lb_err()   { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; }
lb_step()  { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ── 사전 점검 ────────────────────────────────────────────────────────────────
# Node 20+ 검증 (engines: >=20; .node-version의 18은 무시).
lb_check_node() {
  if ! command -v node >/dev/null 2>&1; then
    lb_err "node를 찾을 수 없습니다. Node.js 20+ 설치 후 다시 실행하세요."
    return 1
  fi
  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$major" -lt 20 ]; then
    lb_err "Node $major 감지 — LoopBreaker는 Node 20+ 필요 (현재 nvm이 .node-version의 18을 골랐을 수 있음)."
    lb_err "Node 20+를 활성화 후 다시 실행하세요 (예: nvm use 20)."
    return 1
  fi
  lb_ok "node $(node -v) (>=20)"
  return 0
}

# claude CLI 존재 여부 (MCP 등록에 필요; 없으면 MCP 단계만 건너뜀)
lb_has_claude() { command -v claude >/dev/null 2>&1; }

# launchctl 존재 여부 (macOS)
lb_has_launchctl() { command -v launchctl >/dev/null 2>&1; }
