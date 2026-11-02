#!/bin/bash
set -e
cd "$(dirname "$0")"
echo 'Starting AstroCompose. Keep this terminal open; press Ctrl+C to stop.'
# The browser is opened shortly after the local process starts. No hosted service.
(sleep 2; open 'http://127.0.0.1:4317') &
exec bash scripts/node.sh scripts/serve.mjs --resume
