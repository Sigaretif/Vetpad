#!/usr/bin/env bash
# Stop: sweep everything this turn changed before the agent finishes — lint of the changed
# files, the whole unit suite, the whole-project typecheck. One retry, then the agent may stop.
# Exit 2 + stderr keeps the agent working; exit 1 or stdout reaches nobody.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
export NO_COLOR=1 FORCE_COLOR=0

INPUT=$(cat)

# Already sent back once by this hook: let it finish. CI catches what is left.
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$ACTIVE" = "true" ] && exit 0

. "$(dirname "$0")/lib/tree-state.sh" || exit 0
STATE_DIR=$(hooks_state_dir)

# Files this turn changed, judged against the snapshot turn-start.sh took when the prompt came
# in. This is also the net for files rewritten through a shell command, which never reach the
# per-edit hooks. Without a usable snapshot (hook registered mid-session, base commit gone),
# fall back to every uncommitted change.
CHANGED=""
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null | tr -cd 'A-Za-z0-9_-')
SNAP="$STATE_DIR/turn-$SID"
if [ -n "$SID" ] && [ -n "$STATE_DIR" ] && [ -f "$SNAP" ] \
  && BASE=$(head -n 1 "$SNAP") && NOW=$(tree_state "$BASE"); then
  CHANGED=$({ tail -n +2 "$SNAP"; printf '%s\n' "$NOW"; } | sed '/^$/d' | sort | uniq -u | cut -f2- | sort -u)
else
  CHANGED=$({ git -c core.quotePath=false diff --name-only HEAD; git -c core.quotePath=false ls-files -o --exclude-standard; } 2>/dev/null | sort -u)
fi
[ -n "$CHANGED" ] || exit 0

# Red phase of test-first work: the user creates this marker while a failing test is meant to
# stay failing, so the hook does not send the agent off to make it pass. Lint and typecheck
# still run. Only the user sets or removes it.
RED_PHASE=0
[ -n "$STATE_DIR" ] && [ -f "$STATE_DIR/red-phase" ] && RED_PHASE=1

# RELEVANT: anything the tests or the typecheck can see (deleted files included — an import
# of one breaks the typecheck). LINT: the subset eslint.config.js covers that still exists.
# .claude/ and context/ are not app code; a turn that touched only those runs nothing.
RELEVANT=0
LINT=()
while IFS= read -r f; do
  case "$f" in .claude/*|context/*) continue ;; esac
  case "$f" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.astro)
      RELEVANT=1
      [ -f "$f" ] && LINT+=("$f")
      ;;
    *.json|*.jsonc) RELEVANT=1 ;;
  esac
done <<EOF
$CHANGED
EOF
[ "$RELEVANT" = 1 ] || exit 0

REPORT=""
# `astro check` colours its diagnostics whatever NO_COLOR says; strip the escapes, a model reads this.
ESC=$(printf '\033')
add() { REPORT="$REPORT
$1
$(printf '%s\n' "$2" | sed "s/${ESC}\[[0-9;]*[A-Za-z]//g" | head -n 150)
"; }

if [ "${#LINT[@]}" -gt 0 ]; then
  OUT=$(npx eslint --quiet "${LINT[@]}" 2>&1) || add "ESLint errors in changed files:" "$OUT"
fi

# The whole suite takes about five seconds, so it runs whole: that also catches a red test
# in a module this turn only imported.
if [ "$RED_PHASE" = 0 ]; then
  OUT=$(npx vitest run 2>&1) || add "Unit tests fail (npm test):" "$OUT"
fi

# `astro check` regenerates .astro/ first, and a sync under a running `astro dev` can leave
# every React island unhydrated. A live dev server keeps the types fresh itself, so skip the
# sync then; without one, sync — .astro/ is git-ignored and may be missing or stale.
SYNC=()
DEV_PID=$(jq -r '.pid // empty' .astro/dev.json 2>/dev/null)
case "$DEV_PID" in
  ''|*[!0-9]*) ;;
  # The pid has to be an astro process: a stale lock file can name a pid the system reused.
  *) [ -f .astro/types.d.ts ] && ps -p "$DEV_PID" -o args= 2>/dev/null | grep -q astro && SYNC=(--noSync) ;;
esac
OUT=$(npx astro check "${SYNC[@]}" 2>&1) || add "Typecheck fails (npx astro check):" "$OUT"

# A warning for the user, not the agent, so a forgotten marker does not switch tests off for good.
if [ "$RED_PHASE" = 1 ]; then
  jq -cn --arg m "Red-phase marker is on: hooks skip unit tests. Remove it after the red phase: rm $STATE_DIR/red-phase" '{systemMessage: $m}'
fi

if [ -n "$REPORT" ]; then
  echo "Fix these before you finish:$REPORT" >&2
  exit 2
fi
exit 0
