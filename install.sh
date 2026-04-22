#!/usr/bin/env bash
# claude-master-toolkit: system installer (dev bootstrap)
# Installs ONLY the toolkit itself (deps, build, DB, ctk on PATH).
# Does NOT install the Claude integration layer — for that run:
#     ctk install claude
#
# - Checks Node.js 18+
# - Ensures pnpm is available (via corepack if needed)
# - Installs dependencies with pnpm (respects pnpm-lock.yaml)
# - Builds CLI + Server + Vite React SPA
# - Runs DB migrations
# - Exposes `ctk` globally via `pnpm link --global`

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MARKER_START="# >>> claude-master-toolkit >>>"
MARKER_END="# <<< claude-master-toolkit <<<"

say()  { printf '  %s\n' "$*"; }
head() { printf '\n== %s ==\n' "$*"; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

# --- Checks -----------------------------------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js is required (nodejs.org)"

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
[[ "$NODE_VERSION" -ge 18 ]] || die "Node.js 18+ required (you have v$NODE_VERSION)"

# pnpm: prefer system binary; otherwise bootstrap via corepack (ships with Node ≥16.10)
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    say "pnpm not found — enabling via corepack"
    corepack enable >/dev/null 2>&1 || die "corepack enable failed (try: sudo corepack enable)"
    corepack prepare pnpm@latest --activate >/dev/null 2>&1 || die "corepack prepare pnpm failed"
  else
    die "pnpm is required. Install with: npm i -g pnpm   (or enable corepack)"
  fi
fi
say "using $(pnpm --version | sed 's/^/pnpm /')"

head "1. Install dependencies (pnpm)"
cd "$REPO_DIR"
pnpm install --frozen-lockfile

head "2. Build CLI + Server + React SPA"
pnpm run build

head "3. Initialize database"
pnpm exec tsx src/shared/db/migrate.ts

head "4. Expose ctk on PATH"
chmod +x "$REPO_DIR/bin/ctk.js"

# Clean any prior package-manager global links so ours is the only `ctk`.
if command -v pnpm >/dev/null 2>&1; then
  (cd "$REPO_DIR" && pnpm unlink --global >/dev/null 2>&1) || true
fi
if command -v npm >/dev/null 2>&1; then
  npm unlink -g claude-master-toolkit >/dev/null 2>&1 || true
fi
# Legacy bashrc stanza from older installs.
if grep -q "$MARKER_START" "$HOME/.bashrc" 2>/dev/null; then
  sed -i "/$MARKER_START/,/$MARKER_END/d" "$HOME/.bashrc"
  say "removed legacy PATH stanza from ~/.bashrc"
fi

# Symlink into ~/.local/bin. It's part of the XDG user spec, already on PATH
# for systemd-based distros (Fedora, Ubuntu, Arch) via ~/.profile or
# /etc/profile.d. This is how rustup / deno / bun / pipx do it.
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"
ln -sf "$REPO_DIR/bin/ctk.js" "$LOCAL_BIN/ctk"
ln -sf "$REPO_DIR/bin/ctk-mcp.js" "$LOCAL_BIN/ctk-mcp"
say "linked $LOCAL_BIN/ctk → $REPO_DIR/bin/ctk.js"
say "linked $LOCAL_BIN/ctk-mcp → $REPO_DIR/bin/ctk-mcp.js"

# If ~/.local/bin isn't on PATH, add it to ~/.bashrc (and ~/.zshrc if present).
add_path_stanza() {
  local rc="$1"
  [[ -f "$rc" ]] || return 0
  grep -q "$MARKER_START" "$rc" && return 0
  {
    printf '\n%s\n' "$MARKER_START"
    printf 'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac\n'
    printf '%s\n' "$MARKER_END"
  } >> "$rc"
  say "added PATH stanza to $rc"
}
if ! echo ":$PATH:" | grep -q ":$LOCAL_BIN:"; then
  add_path_stanza "$HOME/.bashrc"
  add_path_stanza "$HOME/.zshrc"
  export PATH="$LOCAL_BIN:$PATH"
  say "⚠  new PATH not active in your current shell — run: source ~/.bashrc"
fi

head "✓ System installed"
cat <<EOF

claude-master-toolkit is built and ctk is on your PATH.

  Repo: $REPO_DIR

Next steps:
  1. Verify CLI:             ctk --help
  2. Install Claude stack:   ctk install claude
  3. Open dashboard:         ctk dashboard

To uninstall everything:
  $REPO_DIR/uninstall.sh

EOF
