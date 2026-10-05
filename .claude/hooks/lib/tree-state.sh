# Sourced by turn-start.sh and end-of-turn.sh; not a hook on its own.

# Where the hooks keep per-session state: inside .git, so it is never tracked and needs no ignore rule.
hooks_state_dir() {
  local git_dir
  git_dir=$(git rev-parse --absolute-git-dir 2>/dev/null) || return 1
  printf '%s/claude-hooks\n' "$git_dir"
}

# Every path that differs from <base> in the working tree (tracked changes and untracked files),
# one "<blob hash>\t<path>" line each, "-" for a deleted file. Two snapshots taken against the same
# base differ exactly in the paths that changed between them.
tree_state() {
  local base=$1 diff untracked paths
  diff=$(git -c core.quotePath=false diff --name-only "$base" -- 2>/dev/null) || return 1
  untracked=$(git -c core.quotePath=false ls-files -o --exclude-standard 2>/dev/null) || return 1
  paths=$(printf '%s\n%s\n' "$diff" "$untracked" | sed '/^$/d' | sort -u)
  [ -n "$paths" ] || return 0
  local existing=() deleted=() f
  while IFS= read -r f; do
    if [ -f "$f" ]; then existing+=("$f"); else deleted+=("$f"); fi
  done <<EOF
$paths
EOF
  if [ "${#existing[@]}" -gt 0 ]; then
    paste <(printf '%s\n' "${existing[@]}" | git hash-object --stdin-paths) <(printf '%s\n' "${existing[@]}") || return 1
  fi
  for f in "${deleted[@]}"; do printf -- '-\t%s\n' "$f"; done
}
