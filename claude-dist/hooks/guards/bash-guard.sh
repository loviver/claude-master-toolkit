#!/usr/bin/env bash
# claude-master-toolkit: Bash PreToolUse guard
# Denies `git commit` invocations that embed AI attribution.
# CLAUDE.md rule: "Never add Co-Authored-By or AI attribution to commits."

set -euo pipefail

INPUT="$(cat)"
COMMAND="$(echo "$INPUT" | jq -r '.tool_input.command // ""')"

# Only inspect git-commit invocations. Detect both direct and piped forms.
if ! echo "$COMMAND" | grep -qE '(^|[[:space:]|;&(])git[[:space:]]+commit\b'; then
  exit 0
fi

# Patterns we block (case-insensitive). Aligned with CLAUDE.md rule.
BLOCKED_PATTERNS=(
  'Co-Authored-By'
  'Generated with \[Claude Code\]'
  '🤖 Generated'
  'noreply@anthropic\.com'
)

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qiE "$pattern"; then
    cat >&2 <<EOF
✗ Blocked: git commit contains AI attribution.

Matched pattern: /${pattern}/

CLAUDE.md rule: "Never add Co-Authored-By or AI attribution to commits."
Rewrite the commit message without that trailer and retry.
EOF
    exit 2
  fi
done

exit 0
