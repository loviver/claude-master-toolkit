#!/usr/bin/env bash
# claude-master-toolkit: opt-in TypeScript hook runtime.
# Sourced FIRST by every event hook (before stdin is read). With CTK_HOOKS=ts the
# calling script is replaced by `node dist/hook.js <event> --agent claude-code`.
# If the runtime is missing (not built) we fall through to the bash implementation.
# Override the runtime path with CTK_HOOK_BIN (test seam).

if [[ "${CTK_HOOKS:-}" == "ts" ]]; then
  _ctk_self="$(readlink -f "${BASH_SOURCE[1]}")"
  _ctk_bin="${CTK_HOOK_BIN:-$(dirname "$_ctk_self")/../../dist/hook.js}"
  if [[ -f "$_ctk_bin" ]] && command -v node >/dev/null 2>&1; then
    exec node "$_ctk_bin" "$(basename "$_ctk_self" .sh)" --agent claude-code
  fi
fi
