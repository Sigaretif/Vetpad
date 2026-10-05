#!/usr/bin/env bash
# PostToolUse (Write|Edit): lint the one file the agent just edited.
# Exit 2 + stderr is the only combination Claude sees; exit 1 or stdout reaches nobody.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
export NO_COLOR=1 FORCE_COLOR=0

FILE=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0

# The payload path is absolute; tolerate a relative one, skip anything outside the project.
case "$FILE" in /*) ;; *) FILE="$PWD/$FILE" ;; esac
case "$FILE" in "$PWD"/*) ;; *) exit 0 ;; esac

# The extensions eslint.config.js covers (typescript-eslint, eslint-plugin-astro, scripts/**/*.mjs).
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.astro) ;;
  *) exit 0 ;;
esac
[ -f "$FILE" ] || exit 0

# No --fix: rewriting the file under the agent makes its next Edit fail with "file modified since read".
if ! OUTPUT=$(npx eslint --quiet "$FILE" 2>&1); then
  {
    echo "ESLint reported errors in ${FILE#"$PWD"/}:"
    printf '%s\n' "$OUTPUT" | head -n 80
  } >&2
  exit 2
fi
exit 0
