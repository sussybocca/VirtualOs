#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CXX="${CXX_WASM:-clang++}"
OUT="$ROOT/browser/vos-compiler.wasm"
"$CXX" --target=wasm32 -std=c++20 -O3 -nostdlib -fno-exceptions -fno-rtti \
  -Wl,--no-entry -Wl,--strip-all \
  "$ROOT/browser/vos-compiler-core.cpp" -o "$OUT"
printf 'Built %s (%s bytes)\n' "$OUT" "$(wc -c < "$OUT")"
