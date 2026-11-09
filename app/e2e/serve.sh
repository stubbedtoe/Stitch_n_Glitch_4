#!/usr/bin/env bash
# Serve the built Stitch'n'Glitch app for the e2e contract suite.
#
# App-serving contract (see e2e/CONTRACT.md):
#   1. `gleam build` succeeds (domain core + shell slice).
#   2. The shell slice places the servable app (index.html, JS entry,
#      manifest, service worker, icons) in app/priv/static/.
#   3. That directory is served as a static site on the fixed port below.
set -euo pipefail

cd "$(dirname "$0")/.."

gleam build

if [ ! -d priv/static ]; then
  echo "e2e/serve.sh: app/priv/static/ does not exist." >&2
  echo "The shell slice must place the built, servable app there (see e2e/CONTRACT.md)." >&2
  exit 1
fi

exec python3 -m http.server 4719 --directory priv/static
