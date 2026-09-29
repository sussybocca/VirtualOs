#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/runtime/browser"
cp "$ROOT/browser/vos-runtime.js" "$ROOT/runtime/browser/vos-runtime.js"
cp "$ROOT/browser/vos-page.js" "$ROOT/runtime/browser/vos-page.js"
cp "$ROOT/browser/cpu-worker.js" "$ROOT/runtime/browser/cpu-worker.js"
printf 'Synchronized browser runtime mirrors.\n'
