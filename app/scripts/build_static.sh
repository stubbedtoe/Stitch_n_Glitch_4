#!/usr/bin/env bash
# Assemble the servable M1 app into app/priv/static/ (app-serving contract,
# see e2e/CONTRACT.md): the compiled Gleam JavaScript module graph plus the
# static shell (index.html, manifest, service worker, icons).
#
# e2e/serve.sh runs `gleam build` and serves priv/static/ as-is, so re-run
# this script whenever Gleam sources change to keep the served copy current.
set -euo pipefail

cd "$(dirname "$0")/.."

gleam build

STATIC_DIR="priv/static"
mkdir -p "$STATIC_DIR"

# Compiled JavaScript module graph (gleam also copies the *_ffi.mjs files).
rsync -a --delete \
  --exclude="_gleam_artefacts" \
  --exclude="*.lock" \
  --exclude="*.cache" \
  --exclude="/sng/priv" \
  build/dev/javascript/ "$STATIC_DIR/"

# Static shell files.
rsync -a priv_static_src/ "$STATIC_DIR/"

echo "servable app written to $STATIC_DIR"
