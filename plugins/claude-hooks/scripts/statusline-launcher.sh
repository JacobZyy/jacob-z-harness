#!/bin/bash
# Launcher for claude-hooks statusline
# Auto-discovers the latest installed version from plugin cache.
# Pattern inspired by oh-my-claudecode's hud-wrapper approach.
set -e

CACHE_BASE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/cache/jacob-skills-collection/claude-hooks"
WORKSPACE_PATH="/Users/jacobzha/Documents/workspace/jacob-open-source/jacob-skills-collection/plugins/claude-hooks/scripts/statusline.sh"

# 1. Try plugin cache — find latest semver
if [ -d "$CACHE_BASE" ]; then
  LATEST=$(ls -1 "$CACHE_BASE" 2>/dev/null | sort -V | tail -1)
  if [ -n "$LATEST" ]; then
    SCRIPT="$CACHE_BASE/$LATEST/scripts/statusline.sh"
    if [ -f "$SCRIPT" ]; then
      exec bash "$SCRIPT"
    fi
  fi
fi

# 2. Fallback: workspace path (local dev)
if [ -f "$WORKSPACE_PATH" ]; then
  exec bash "$WORKSPACE_PATH"
fi

echo "[claude-hooks] statusline not found"
