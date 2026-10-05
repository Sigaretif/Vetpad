#!/usr/bin/env bash
# PostToolUse (Write|Edit): run the unit tests that depend on the edited file
# (context/foundation/test-plan.md, Quality Gates: "post-edit hook running related unit tests").
# Exit 2 + stderr is the only combination Claude sees.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
export NO_COLOR=1 FORCE_COLOR=0

FILE=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0

case "$FILE" in /*) ;; *) FILE="$PWD/$FILE" ;; esac
case "$FILE" in "$PWD"/*) ;; *) exit 0 ;; esac

# What a test under tests/ can import. `vitest related` exits 0 when no test depends on the file.
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.astro) ;;
  *) exit 0 ;;
esac
[ -f "$FILE" ] || exit 0

# Red-phase marker (see end-of-turn.sh): a failing test is meant to stay failing for now.
GIT_DIR=$(git rev-parse --absolute-git-dir 2>/dev/null)
[ -n "$GIT_DIR" ] && [ -f "$GIT_DIR/claude-hooks/red-phase" ] && exit 0

if ! OUTPUT=$(npx vitest related "$FILE" --run 2>&1); then
  {
    echo "Tests related to ${FILE#"$PWD"/} fail:"
    printf '%s\n' "$OUTPUT" | head -n 150
  } >&2
  exit 2
fi
exit 0
