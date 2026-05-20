#!/usr/bin/env bash
# Claude Code SessionStart hook: 确保 claude-hooks 插件依赖就绪。
# 检查 Prisma client 是否已生成，没有则同步执行 install + generate + db push。
# 放在 SessionStart 而不是 Stop/PostToolUse，避免每次工具调用都检查。

set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
[ -z "$PLUGIN_ROOT" ] && exit 0

# ── 版本日志 ──────────────────────────────────────────────────────────────
VERSION=$(grep '"version"' "$PLUGIN_ROOT/plugin.json" 2>/dev/null | head -1 | sed 's/.*"version" *: *"\([^"]*\)".*/\1/')
echo "{\"systemMessage\":\"[claude-hooks] v${VERSION:-unknown} loaded\"}"

# ── 确保 .env 存在（Prisma 需要 DATABASE_URL） ────────────────────────────
ENV_FILE="$PLUGIN_ROOT/.env"
DB_DIR="$HOME/.claude/data"
mkdir -p "$DB_DIR" 2>/dev/null

if [ ! -f "$ENV_FILE" ] || ! grep -q "DATABASE_URL" "$ENV_FILE" 2>/dev/null; then
  echo "DATABASE_URL=file:$DB_DIR/token-stats.db" > "$ENV_FILE"
fi

# ── 检查 prisma client 是否已生成 ─────────────────────────────────────────
if [ -f "$PLUGIN_ROOT/node_modules/.prisma/client/index.js" ]; then
  exit 0
fi

# ── 需要初始化 —— 同步执行，确保 Stop hook 触发时 client 已就绪 ──────────
# 整体限制 30s 超时，避免阻塞启动
(
  cd "$PLUGIN_ROOT" || exit 0

  command -v bun >/dev/null 2>&1 || exit 0

  bun install --frozen-lockfile 2>/dev/null
  bunx prisma generate 2>/dev/null
  bunx prisma db push 2>/dev/null
)

exit 0
