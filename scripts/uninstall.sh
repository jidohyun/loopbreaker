#!/usr/bin/env bash
# scripts/uninstall.sh — LoopBreaker 제거.
#
# 제거 대상: launchd 등록·plist, MCP 등록, (선택)~/.loopbreaker 상태(config·DB).
# 절대 안 건드림: repo 소스, ~/.claude/projects 세션 JSONL(read-only 분석 대상).
#
# 사용법:
#   scripts/uninstall.sh                # launchd·MCP 해제 + ~/.loopbreaker 삭제
#   scripts/uninstall.sh --keep-state   # ~/.loopbreaker(config·DB) 보존
#   scripts/uninstall.sh --keep-logs    # launchd 로그 파일 보존
#
# set -uo (no -e): 중간 단계가 실패해도 끝까지 진행해 최대한 정리한다.

set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

KEEP_STATE=0
KEEP_LOGS=0
for arg in "$@"; do
  case "$arg" in
    --keep-state) KEEP_STATE=1 ;;
    --keep-logs)  KEEP_LOGS=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) lb_warn "알 수 없는 옵션 무시: $arg" ;;
  esac
done

printf '\033[1mLoopBreaker 제거\033[0m\n'

REMOVED=()
KEPT=()

# ── 1. launchd 데몬 정지·제거 ────────────────────────────────────────────────
lb_step "1. launchd 데몬"
if lb_has_launchctl && [ -f "$LB_PLIST_DST" ]; then
  launchctl unload "$LB_PLIST_DST" 2>/dev/null && lb_ok "데몬 정지(unload)" || lb_warn "unload 실패(이미 정지?)"
  rm -f "$LB_PLIST_DST" && { lb_ok "plist 제거"; REMOVED+=("$LB_PLIST_DST"); }
else
  lb_info "launchd plist 없음 — 건너뜀"
fi

# ── 2. launchd 로그 ──────────────────────────────────────────────────────────
lb_step "2. launchd 로그"
if [ "$KEEP_LOGS" -eq 0 ]; then
  rm -f "$LB_LOG_DIR/loopbreakerd.log" "$LB_LOG_DIR/loopbreakerd.err.log" 2>/dev/null \
    && { lb_ok "로그 제거"; REMOVED+=("$LB_LOG_DIR/loopbreakerd*.log"); }
else
  lb_info "로그 보존(--keep-logs): $LB_LOG_DIR/loopbreakerd*.log"
  KEPT+=("$LB_LOG_DIR/loopbreakerd*.log")
fi

# ── 3. MCP 등록 해제 ─────────────────────────────────────────────────────────
lb_step "3. MCP 등록"
if lb_has_claude && claude mcp list 2>/dev/null | grep -q "^$LB_MCP_NAME:"; then
  claude mcp remove "$LB_MCP_NAME" >/dev/null 2>&1 \
    && { lb_ok "MCP 등록 해제: $LB_MCP_NAME"; REMOVED+=("MCP:$LB_MCP_NAME"); } \
    || lb_warn "MCP 제거 실패 — 수동: claude mcp remove $LB_MCP_NAME"
else
  lb_info "MCP 미등록 또는 claude CLI 없음 — 건너뜀"
fi

# ── 4. 운영 상태(config·DB) ──────────────────────────────────────────────────
lb_step "4. 운영 상태 (~/.loopbreaker)"
if [ "$KEEP_STATE" -eq 0 ]; then
  if [ -d "$LB_STATE_DIR" ]; then
    rm -rf "$LB_STATE_DIR" && { lb_ok "상태 삭제: $LB_STATE_DIR (config·DB·lock)"; REMOVED+=("$LB_STATE_DIR"); }
  else
    lb_info "$LB_STATE_DIR 없음 — 건너뜀"
  fi
else
  lb_info "상태 보존(--keep-state): $LB_STATE_DIR"
  KEPT+=("$LB_STATE_DIR (config·DB)")
fi

# ── 보존 항목 명시 (안전: 절대 안 지우는 것) ─────────────────────────────────
lb_step "보존됨 (제거 안 함)"
lb_info "repo 소스:        $LOOPBREAKER_HOME"
lb_info "세션 JSONL:       ~/.claude/projects/** (분석 대상, read-only)"
for k in "${KEPT[@]:-}"; do [ -n "$k" ] && lb_info "$k"; done

# ── 요약 ─────────────────────────────────────────────────────────────────────
lb_step "제거 완료"
if [ "${#REMOVED[@]}" -eq 0 ]; then
  lb_info "제거된 항목 없음 (이미 깨끗함)"
else
  for r in "${REMOVED[@]}"; do lb_ok "제거: $r"; done
fi
lb_info "repo 자체를 지우려면: rm -rf \"$LOOPBREAKER_HOME\""
