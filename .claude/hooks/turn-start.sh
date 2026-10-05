#!/usr/bin/env bash
# UserPromptSubmit: remember the working tree as the turn starts, so end-of-turn.sh checks only
# what this turn changed — not every uncommitted change, and not on a turn that changed nothing.
# Stays silent and always exits 0: on this event stdout lands in the agent's context and exit 2
# blocks the prompt.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
. "$(dirname "$0")/lib/tree-state.sh" 2>/dev/null || exit 0

{
  SID=$(jq -r '.session_id // empty' | tr -cd 'A-Za-z0-9_-')
  DIR=$(hooks_state_dir)
  if [ -n "$SID" ] && [ -n "$DIR" ] && mkdir -p "$DIR"; then
    find "$DIR" -maxdepth 1 -name 'turn-*' -type f -mtime +7 -delete
    SNAP="$DIR/turn-$SID"
    # First line: the base every later comparison is made against, so a commit made during the
    # turn does not hide the files it committed.
    if BASE=$(git rev-parse --verify -q HEAD) && STATE=$(tree_state "$BASE"); then
      printf '%s\n%s\n' "$BASE" "$STATE" > "$SNAP.tmp" && mv "$SNAP.tmp" "$SNAP"
    else
      rm -f "$SNAP" "$SNAP.tmp"
    fi
  fi
} >/dev/null 2>&1
exit 0
