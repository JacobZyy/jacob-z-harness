#!/bin/bash
# Claude Code Status Line — powerline segments + Catppuccin Mocha palette
# Layout:
#   Line 1: model | folder | added-dirs        (powerline)
#   Line 2: agent | cwd full path              (powerline)
#   Line 3: session-id | session-name | wt     (powerline)
#   Line 4: context bar + tokens               (original style)
# Two blank lines between each data row for visual spacing.

input=$(cat)

# ── Catppuccin Mocha palette (official) ──
# https://catppuccin.com/palette/
ROSEWATER="245;224;220"   # #f5e0dc  ← 1. model
FLAMINGO="242;205;205"    # #f2cdcd  ← 2. folder
PINK="245;194;231"        # #f5c2e7  ← 3. dirs
MAUVE="203;166;247"       # #cba6f7
RED="243;139;168"         # #f38ba8  ← ctx ≥90%
MAROON="235;160;172"      # #eba0ac  ← 4. agent
PEACH="250;179;135"       # #fab387  ← 5. cwd
YELLOW="249;226;175"      # #f9e2af  ← ctx 70-89%
GREEN="166;227;161"       # #a6e3a1  ← ctx <70%
TEAL="148;226;213"        # #94e2d5  ← 6. session-id
SKY="137;220;235"         # #89dceb  ← 7. session-name
SAPPHIRE="116;199;236"    # #74c7ec  ← 8. worktree
# Neutral
TEXT="205;214;244"        # #cdd6f4
SUBTEXT0="166;173;200"    # #a6adc8
OVERLAY1="127;132;156"    # #7f849c
OVERLAY0="108;112;134"    # #6c7086
SURFACE0="49;50;68"       # #313244
CRUST="17;17;27"          # #11111b

# ── Powerline helpers ──
cap_left()  { printf "\033[38;2;%sm\033[0m" "$1"; }
cap_right() { printf "\033[38;2;%sm\033[0m" "$1"; }
arrow()     { printf "\033[48;2;%sm\033[38;2;%sm\033[0m" "$2" "$1"; }
seg()       { printf "\033[48;2;%sm\033[38;2;%sm %s \033[0m" "$1" "$2" "$3"; }
fg()        { printf "\033[38;2;%sm%s\033[0m" "$1" "$2"; }

# ── Folder icon substitution (Starship-inspired) ──
folder_icon() {
  case "$1" in
    Documents|documents) printf '󰈙 ' ;;
    Downloads|downloads) printf ' ' ;;
    Desktop|desktop)     printf ' ' ;;
    workspace)           printf ' ' ;;
    Developer|developer) printf '󰲋 ' ;;
    Pictures|pictures)   printf ' ' ;;
    Music|music)         printf '󰝚 ' ;;
    Movies|movies)       printf ' ' ;;
    *)                   return 1 ;;
  esac
}
fmt_folder() {
  local icon name=$1
  icon=$(folder_icon "$name")
  if [ $? -eq 0 ]; then
    printf '%s%s' "$icon" "$name"
  else
    printf '%s' "$name"
  fi
}

# ── Data extraction ──
model_id=$(echo "$input" | jq -r '.model.id // "unknown"')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // empty')
folder=$(basename "$cwd" 2>/dev/null || echo "?")
added_dirs=$(echo "$input" | jq -r '.workspace.added_dirs[]? // empty' 2>/dev/null | while read -r d; do basename "$d" 2>/dev/null; done | tr '\n' ' ' | sed 's/ $//')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
total_in=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
total_out=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
agent_name=$(echo "$input" | jq -r '.agent.name // empty')
agent_type=$(echo "$input" | jq -r '.agent.type // empty')
session_id=$(echo "$input" | jq -r '.session_id // empty')
session_name=$(echo "$input" | jq -r '.session_name // empty')
worktree_name=$(echo "$input" | jq -r '.worktree.name // empty')

format_tokens() {
  local t=$1
  if [ "$t" -ge 1000000 ]; then
    awk "BEGIN{printf \"%.1fM\", $t/1000000}"
  elif [ "$t" -ge 1000 ]; then
    awk "BEGIN{printf \"%.1fk\", $t/1000}"
  else
    echo "$t"
  fi
}
in_fmt=$(format_tokens "$total_in")
out_fmt=$(format_tokens "$total_out")

# ═══════════════════════════════════════════════════════════════════
# Line 1: model | folder | added-dirs
#   Palette: Rosewater → Flamingo → Pink
# ═══════════════════════════════════════════════════════════════════

folder_display=$(fmt_folder "$folder")

cap_left "$ROSEWATER"
seg "$ROSEWATER" "$CRUST" "$model_id"

if [ -n "$added_dirs" ]; then
  arrow "$ROSEWATER" "$FLAMINGO"
  seg "$FLAMINGO" "$CRUST" "$folder_display"
  arrow "$FLAMINGO" "$PINK"
  seg "$PINK" "$CRUST" "$added_dirs"
  cap_right "$PINK"
else
  arrow "$ROSEWATER" "$FLAMINGO"
  seg "$FLAMINGO" "$CRUST" "$folder_display"
  cap_right "$FLAMINGO"
fi
printf "\n\n\n"

# ═══════════════════════════════════════════════════════════════════
# Line 2: agent (conditional) | cwd full path
#   Palette: Maroon → Peach
# ═══════════════════════════════════════════════════════════════════

simplified_cwd=$(echo "$cwd" | sed "s|^$HOME|~|")

if [ -n "$agent_name" ]; then
  agent_label="$agent_name"
  [ -n "$agent_type" ] && agent_label="$agent_name ($agent_type)"

  cap_left "$MAROON"
  seg "$MAROON" "$CRUST" "$agent_label"
  arrow "$MAROON" "$PEACH"
  seg "$PEACH" "$CRUST" "$simplified_cwd"
  cap_right "$PEACH"
else
  cap_left "$PEACH"
  seg "$PEACH" "$CRUST" "$simplified_cwd"
  cap_right "$PEACH"
fi
printf "\n\n\n"

# ═══════════════════════════════════════════════════════════════════
# Line 3: session-id | session-name | worktree
#   Palette: Teal → Sky → Sapphire
# ═══════════════════════════════════════════════════════════════════

parts=""
last_bg=""

if [ -n "$session_id" ]; then
  cap_left "$TEAL"
  seg "$TEAL" "$CRUST" "$session_id"
  last_bg="$TEAL"
  parts=1
fi

if [ -n "$session_name" ]; then
  if [ -z "$parts" ]; then
    cap_left "$SKY"
    seg "$SKY" "$CRUST" "$session_name"
    last_bg="$SKY"
  else
    arrow "$last_bg" "$SKY"
    seg "$SKY" "$CRUST" "$session_name"
    last_bg="$SKY"
  fi
  parts=1
fi

if [ -n "$worktree_name" ]; then
  if [ -z "$parts" ]; then
    cap_left "$SAPPHIRE"
    seg "$SAPPHIRE" "$CRUST" "wt:$worktree_name"
    last_bg="$SAPPHIRE"
  else
    arrow "$last_bg" "$SAPPHIRE"
    seg "$SAPPHIRE" "$CRUST" "wt:$worktree_name"
    last_bg="$SAPPHIRE"
  fi
  parts=1
fi

if [ -n "$parts" ]; then
  cap_right "$last_bg"
fi
printf "\n\n\n"

# ═══════════════════════════════════════════════════════════════════
# Line 4: context bar + tokens (original style, no powerline)
#   [████░░░░] 42.3%  in 158k  out 23k
# ═══════════════════════════════════════════════════════════════════

if [ -n "$used_pct" ]; then
  pct_int=$(echo "$used_pct" | awk '{printf "%d", $1+0.5}')
  if [ "$pct_int" -ge 90 ]; then
    bar_color=$RED
  elif [ "$pct_int" -ge 70 ]; then
    bar_color=$YELLOW
  else
    bar_color=$GREEN
  fi

  bar_width=20
  filled=$(echo "$used_pct" | awk -v w="$bar_width" '{printf "%d", ($1/100)*w}')
  empty=$((bar_width - filled))
  bar=$(printf '%*s' "$filled" '' | tr ' ' '█')$(printf '%*s' "$empty" '' | tr ' ' '░')

  printf "%s" "$(fg "$bar_color" "[${bar}]")"
  printf " %s" "$(printf '%5.1f%%' "$used_pct")"
  printf "  %s %s  %s %s" "in" "$(fg "$TEAL" "$in_fmt")" "out" "$(fg "$SKY" "$out_fmt")"
else
  printf "%s" "$(fg "$OVERLAY0" "[no context]")"
fi
printf "\n"
