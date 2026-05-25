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
ROSEWATER="245;224;220"   # #f5e0dc
FLAMINGO="242;205;205"    # #f2cdcd
PINK="245;194;231"        # #f5c2e7
MAUVE="203;166;247"       # #cba6f7
RED="243;139;168"         # #f38ba8
MAROON="235;160;172"      # #eba0ac
PEACH="250;179;135"       # #fab387
YELLOW="249;226;175"      # #f9e2af
GREEN="166;227;161"       # #a6e3a1
TEAL="148;226;213"        # #94e2d5
SKY="137;220;235"         # #89dceb
SAPPHIRE="116;199;236"    # #74c7ec
# Neutral
TEXT="205;214;244"        # #cdd6f4
SUBTEXT0="166;173;200"    # #a6adc8
OVERLAY1="127;132;156"    # #7f849c
OVERLAY0="108;112;134"    # #6c7086
SURFACE0="49;50;68"       # #313244
CRUST="17;17;27"          # #11111b

# ── Segment color assignment (warm/cool alternation for max contrast) ──
# Line 1: Mauve(purple) → Peach(orange) → Sky(light blue)
# Line 2: Rosewater(pink) → Teal(cyan)
# Line 3: Maroon(dusty red) → Sapphire(blue) → Flamingo(salmon)
L1_A=$MAUVE;     L1_B=$PEACH;     L1_C=$SKY
L2_A=$ROSEWATER; L2_B=$TEAL
L3_A=$MAROON;    L3_B=$SAPPHIRE;  L3_C=$FLAMINGO

# ── Powerline glyphs (UTF-8 byte escapes for portability) ──
LC=$'\xee\x82\xb6'    #  U+E0B6 left rounded cap
RC=$'\xee\x82\xb4'    #  U+E0B4 right rounded cap
AR=$'\xee\x82\xb0'    #  U+E0B0 left pointed arrow

# ── Powerline helpers ──
cap_left()  { printf "\033[38;2;%sm%s\033[0m" "$1" "$LC"; }
cap_right() { printf "\033[38;2;%sm%s\033[0m" "$1" "$RC"; }
arrow()     { printf "\033[48;2;%sm\033[38;2;%sm%s\033[0m" "$2" "$1" "$AR"; }
seg()       { printf "\033[48;2;%sm\033[38;2;%sm %s \033[0m" "$1" "$2" "$3"; }
fg()        { printf "\033[38;2;%sm%s\033[0m" "$1" "$2"; }

# ── Folder icon substitution (Nerd Fonts — Maple Mono SC NF) ──
folder_icon() {
  case "$1" in
    Documents|documents) printf '󰈙 ' ;;
    Downloads|downloads) printf ' ' ;;
    Desktop|desktop)     printf ' ' ;;
    workspace)           printf ' ' ;;
    Developer|developer) printf '󰲋 ' ;;
    Pictures|pictures)   printf ' ' ;;
    Music|music)         printf '󰝚 ' ;;
    Movies|movies)       printf ' ' ;;
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

# Apply icons to each directory name in a full path
iconify_path() {
  local p="$1"
  p="${p//Documents/󰈙}"
  p="${p//workspace/}"
  p="${p//Downloads/}"
  p="${p//Desktop/}"
  p="${p//Developer/󰲋}"
  p="${p//Pictures/}"
  p="${p//Music/󰝚}"
  p="${p//Movies/}"
  echo "$p"
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
#   Palette: Mauve(purple) → Peach(orange) → Sky(light blue)
# ═══════════════════════════════════════════════════════════════════

folder_display=$(fmt_folder "$folder")

cap_left "$L1_A"
seg "$L1_A" "$CRUST" "$model_id"

if [ -n "$added_dirs" ]; then
  arrow "$L1_A" "$L1_B"
  seg "$L1_B" "$CRUST" "$folder_display"
  arrow "$L1_B" "$L1_C"
  seg "$L1_C" "$CRUST" "$added_dirs"
  cap_right "$L1_C"
else
  arrow "$L1_A" "$L1_B"
  seg "$L1_B" "$CRUST" "$folder_display"
  cap_right "$L1_B"
fi
printf "\n\n\n"

# ═══════════════════════════════════════════════════════════════════
# Line 2: agent (conditional) | cwd full path
#   Palette: Rosewater(pink) → Teal(cyan)
# ═══════════════════════════════════════════════════════════════════

simplified_cwd=$(echo "$cwd" | sed "s|^$HOME|~|")
iconified_cwd=$(iconify_path "$simplified_cwd")

if [ -n "$agent_name" ]; then
  agent_label="$agent_name"
  [ -n "$agent_type" ] && agent_label="$agent_name ($agent_type)"

  cap_left "$L2_A"
  seg "$L2_A" "$CRUST" "$agent_label"
  arrow "$L2_A" "$L2_B"
  seg "$L2_B" "$CRUST" "$iconified_cwd"
  cap_right "$L2_B"
else
  cap_left "$L2_B"
  seg "$L2_B" "$CRUST" "$iconified_cwd"
  cap_right "$L2_B"
fi
printf "\n\n\n"

# ═══════════════════════════════════════════════════════════════════
# Line 3: session-id | session-name | worktree
#   Palette: Maroon(dusty red) → Sapphire(blue) → Flamingo(salmon)
# ═══════════════════════════════════════════════════════════════════

parts=""
last_bg=""

if [ -n "$session_id" ]; then
  cap_left "$L3_A"
  seg "$L3_A" "$CRUST" "$session_id"
  last_bg="$L3_A"
  parts=1
fi

if [ -n "$session_name" ]; then
  if [ -z "$parts" ]; then
    cap_left "$L3_B"
    seg "$L3_B" "$CRUST" "$session_name"
    last_bg="$L3_B"
  else
    arrow "$last_bg" "$L3_B"
    seg "$L3_B" "$CRUST" "$session_name"
    last_bg="$L3_B"
  fi
  parts=1
fi

if [ -n "$worktree_name" ]; then
  if [ -z "$parts" ]; then
    cap_left "$L3_C"
    seg "$L3_C" "$CRUST" "wt:$worktree_name"
    last_bg="$L3_C"
  else
    arrow "$last_bg" "$L3_C"
    seg "$L3_C" "$CRUST" "wt:$worktree_name"
    last_bg="$L3_C"
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
  printf "  %s %s  %s %s" "in" "$(fg "$MAUVE" "$in_fmt")" "out" "$(fg "$PEACH" "$out_fmt")"
else
  printf "%s" "$(fg "$OVERLAY0" "[no context]")"
fi
printf "\n"
