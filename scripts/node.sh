#!/bin/bash
set -e
if [ -n "${ASTROCOMPOSE_NODE:-}" ]; then
  exec "$ASTROCOMPOSE_NODE" "$@"
elif command -v node >/dev/null 2>&1; then
  exec node "$@"
elif [ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]; then
  exec "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" "$@"
else
  echo 'AstroCompose requires Node.js 20 or later. Install Node, then run this launcher again.' >&2
  exit 1
fi
