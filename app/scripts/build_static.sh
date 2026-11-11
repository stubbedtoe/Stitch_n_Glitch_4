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

# The F-009 chart renderer worker: a dedicated module worker referenced by
# src/sng/sng_chart_ffi.mjs via new URL, not a gleam FFI file, so the build
# does not copy it — place it next to the compiled sng modules.
cp src/sng/sng_chart_worker.mjs "$STATIC_DIR/sng/sng_chart_worker.mjs"

# Static shell files.
rsync -a priv_static_src/ "$STATIC_DIR/"

echo "servable app written to $STATIC_DIR"
