---
description: Install or repair the claude-hooks statusline in Claude Code
argument-hint: "[install|status|uninstall]"
---

# Statusline Setup

Manage the claude-hooks statusline — a rich 4-line HUD showing model, context usage, tokens, agent info, session, and worktree.

## Dispatch

| Arg | Action |
|-----|--------|
| *(none)* / `install` | Full install |
| `status` | Check current setup state |
| `uninstall` | Remove launcher and statusLine config |

## Install Steps

### Step 1: Locate the launcher template

The launcher script lives in the plugin at `scripts/statusline-launcher.sh`. Find it under `CLAUDE_PLUGIN_ROOT`:

```bash
echo "${CLAUDE_PLUGIN_ROOT}/scripts/statusline-launcher.sh"
```

### Step 2: Check current state

```bash
LAUNCHER="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/statusline/claude-hooks-statusline.sh"
if [ -f "$LAUNCHER" ]; then echo "LAUNCHER_EXISTS"; else echo "LAUNCHER_MISSING"; fi
```

Determine the target config dir:
```bash
echo "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
```

### Step 3: Install the launcher

If LAUNCHER_MISSING, copy the template and make it executable:

```bash
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
mkdir -p "$CONFIG_DIR/statusline"
cp "${CLAUDE_PLUGIN_ROOT}/scripts/statusline-launcher.sh" "$CONFIG_DIR/statusline/claude-hooks-statusline.sh"
chmod +x "$CONFIG_DIR/statusline/claude-hooks-statusline.sh"
```

### Step 4: Update settings.json

Read `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json`, then update/add the `statusLine` field:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/statusline/claude-hooks-statusline.sh"
  }
}
```

Use the Edit tool to add/update this field while preserving other settings.

### Step 5: Verify

Pipe a minimal JSON to the launcher to verify it renders:

```bash
echo '{"model":{"id":"claude-test"},"workspace":{"current_dir":"/tmp"},"context_window":{"used_percentage":50,"total_input_tokens":1000,"total_output_tokens":500},"session_id":"test"}' | bash "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/statusline/claude-hooks-statusline.sh" | head -1
```

Should print a colored statusline line starting with the model name.

### Step 6: Restart required

Tell the user: **statusline installed. Restart Claude Code for it to take effect.**

## Status Check

Check whether launcher exists and settings.json has statusLine configured:

```bash
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
LAUNCHER="$CONFIG_DIR/statusline/claude-hooks-statusline.sh"
echo "Launcher: $([ -f "$LAUNCHER" ] && echo 'EXISTS' || echo 'MISSING')"
node -e "const s=require('$CONFIG_DIR/settings.json'); console.log('statusLine:', s.statusLine ? 'CONFIGURED' : 'MISSING')" 2>/dev/null || echo "statusLine: CANNOT_READ"
```

## Uninstall

Remove the launcher and the statusLine config from settings.json:

```bash
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
rm -f "$CONFIG_DIR/statusline/claude-hooks-statusline.sh"
rmdir "$CONFIG_DIR/statusline" 2>/dev/null || true
```

Then use the Edit tool to remove the `statusLine` field from `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json`.
