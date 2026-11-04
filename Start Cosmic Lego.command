#!/bin/bash
set -eo pipefail
cd "$(dirname "$0")"

atlas_ready() {
  local base="http://127.0.0.1:$1"
  curl -qfs --noproxy '*' --max-time 1 "$base/" | grep -F '<meta name="application-name" content="Cosmic Lego roadmap">' >/dev/null &&
    curl -qfs --noproxy '*' --max-time 1 "$base/atlas/roadmap.mjs" -o /dev/null
}

# Check the normal port, the preview port, and the last OS-assigned port.
ports=(4317 4330)
if [ -f .local/atlas-port ] && read -r saved < .local/atlas-port && [[ "$saved" =~ ^[1-9][0-9]{0,4}$ ]] && (( saved <= 65535 )); then
  ports+=("$saved")
fi
for port in "${ports[@]}"; do
  if atlas_ready "$port"; then
    echo "Opening the running Cosmic Lego atlas on port $port."
    exec open "http://127.0.0.1:$port/"
  fi
done

port=4317
if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then port=0; fi
echo 'Starting Cosmic Lego. Keep this terminal open; press Ctrl+C to stop.'
launch() {
  local conflict=0
  bash scripts/node.sh scripts/serve.mjs --resume --port "$1" 2>&1 |
    {
      while IFS= read -r line; do
        printf '%s\n' "$line"
        if [[ "$line" =~ ^Cosmic\ Lego:\ http://127[.]0[.]0[.]1:([0-9]+)/$ ]]; then
          local actual="${BASH_REMATCH[1]}"
          if atlas_ready "$actual"; then
            if mkdir -p .local; then printf '%s\n' "$actual" > .local/atlas-port; fi
            open "http://127.0.0.1:$actual/"
          else
            echo 'Atlas readiness check failed. Use the printed URL to retry.' >&2
          fi
        elif [[ "$line" == *'listen EADDRINUSE'* ]]; then
          conflict=1
        fi
      done
      if (( conflict )); then return 98; fi
    }
}
# A process can claim 4317 between the initial probe and the actual bind.
launch "$port" || {
  status=$?
  if [ "$status" != 98 ] || [ "$port" = 0 ]; then exit "$status"; fi
  if atlas_ready "$port"; then exec open "http://127.0.0.1:$port/"; fi
  launch 0
}
