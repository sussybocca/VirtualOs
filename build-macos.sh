#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "[VIR/VOS] macOS build"
if [[ -n "${CXX:-}" ]]; then
  CXX_BIN="$CXX"
elif command -v clang++ >/dev/null 2>&1; then
  CXX_BIN="$(command -v clang++)"
elif command -v g++ >/dev/null 2>&1; then
  CXX_BIN="$(command -v g++)"
else
  echo "[ERROR] No C++20 compiler found." >&2
  echo "Install Apple Command Line Tools with: xcode-select --install" >&2
  exit 1
fi

echo "[VIR/VOS] Compiler: $CXX_BIN"
mkdir -p build dist/VIR
"$CXX_BIN" -std=c++20 -O1 -DNDEBUG -Wall -Wextra -Iinclude \
  src/main.cpp src/lexer.cpp src/parser.cpp src/semantic.cpp src/ir.cpp src/backend.cpp src/container.cpp \
  -o build/vosc
cp build/vosc build/vos
cp build/vosc build/vosbuild
chmod +x build/vosc build/vos build/vosbuild

./build/vos check examples/VIR.vos
./build/vos build examples/VIR.vos -o dist/VIR --opt 3
cp runtime/browser/vos-runtime.js dist/VIR/vos-runtime.js
cp runtime/browser/cpu-worker.js dist/VIR/cpu-worker.js
cp examples/VIR-boot.html dist/VIR/index.html

echo
echo "[VIR/VOS] Build complete."
echo "[VIR/VOS] Toolchain: build/vos"
echo "[VIR/VOS] VIR OS:    dist/VIR/"
echo "[VIR/VOS] To run locally: python3 -m http.server 8787 -d dist/VIR"
