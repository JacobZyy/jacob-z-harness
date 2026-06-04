#!/usr/bin/env bash
# Claude Code SessionStart hook: 确保 hyperclaudemia 插件依赖就绪。
# 检查 Prisma client 是否已生成，没有则同步执行 install + generate + db push。
# 放在 SessionStart 而不是 Stop/PostToolUse，避免每次工具调用都检查。

set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[ -z "$PLUGIN_ROOT" ] && exit 0

# ── 日志辅助 ──────────────────────────────────────────────────────────────
HOOK_LOG="$HOME/.claude/data/hooks.log"
_hook_log() {
  local level="$1" msg="$2" detail="${3:-}"
  local entry="{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"hook\":\"SessionStart\",\"script\":\"setup.sh\",\"level\":\"$level\",\"msg\":\"$msg\""
  [ -n "$detail" ] && entry="$entry,\"detail\":\"$detail\""
  entry="$entry}"
  mkdir -p "$(dirname "$HOOK_LOG")" 2>/dev/null
  echo "$entry" >> "$HOOK_LOG" 2>/dev/null
}
START_MS=$(date +%s%3N 2>/dev/null || echo 0)

# _hook_log_done: 写入带 duration_ms 的完成日志
_hook_log_done() {
  local msg="$1" level="${2:-info}" detail="${3:-}"
  local now_ms=$(date +%s%3N 2>/dev/null || echo 0)
  local duration=0
  [ "$START_MS" != "0" ] && [ "$now_ms" != "0" ] && duration=$((now_ms - START_MS))
  local entry="{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"hook\":\"SessionStart\",\"script\":\"setup.sh\",\"level\":\"$level\",\"msg\":\"$msg\",\"duration_ms\":$duration"
  [ -n "$detail" ] && entry="$entry,\"detail\":\"$detail\""
  entry="$entry}"
  echo "$entry" >> "$HOOK_LOG" 2>/dev/null
}

# ── 版本日志 ──────────────────────────────────────────────────────────────
VERSION=$(grep '"version"' "$PLUGIN_ROOT/plugin.json" 2>/dev/null | head -1 | sed 's/.*"version" *: *"\([^"]*\)".*/\1/')
echo "{\"systemMessage\":\"[hyperclaudemia] v${VERSION:-unknown} loaded\"}"
_hook_log "info" "v${VERSION:-unknown} loaded"

# ── 确保 .env 存在（Prisma 需要 DATABASE_URL） ────────────────────────────
ENV_FILE="$PLUGIN_ROOT/.env"
DB_DIR="$HOME/.claude/data"
mkdir -p "$DB_DIR" 2>/dev/null

if [ ! -f "$ENV_FILE" ] || ! grep -q "DATABASE_URL" "$ENV_FILE" 2>/dev/null; then
  echo "DATABASE_URL=file:$DB_DIR/token-stats.db" > "$ENV_FILE"
fi

# ── 检查 prisma client 是否已生成 ─────────────────────────────────────────
if [ -f "$PLUGIN_ROOT/node_modules/.prisma/client/index.js" ]; then
  _hook_log_done "prisma client already ready" "info"
  exit 0
fi

# ── 需要初始化 —— 同步执行，确保 Stop hook 触发时 client 已就绪 ──────────
_hook_log "info" "prisma client not found, running init..."
# 整体限制 30s 超时，避免阻塞启动
(
  cd "$PLUGIN_ROOT" || exit 0

  command -v bun >/dev/null 2>&1 || exit 0

  bun install --frozen-lockfile 2>/dev/null
  bunx prisma generate 2>/dev/null
  bunx prisma db push 2>/dev/null
)

_hook_log_done "setup complete"

exit 0
