# VirtualOs / VOS 1.2 Advanced

This release upgrades the browser VOS from a fixed application demo into an ABI 2 multi-application environment while preserving the recovered C++20 compiler architecture (`lexer -> parser -> semantic model -> typed IR -> backends/containers`).

## Main changes

- Added top-level `app Name { ... }` syntax to the native and browser parsers.
- Added application manifests to native/browser `manifest.json` output.
- Added App ABI 2 metadata to compiler/runtime artifacts.
- Added a runtime app registry instead of fixed app-only branching.
- Added thirteen built-in renderers plus custom runtime renderer registration.
- Added permissions, events, app storage, notifications, clipboard, workspaces, shortcuts, command palette, and richer window state.
- Added a 12-app `VIR-multiapp.vos` / `VIR-browser.vos` reference OS.
- Rebuilt `browser/vos-compiler.wasm` from `browser/vos-compiler-core.cpp` as a reproducible C++20 WASM core.
- Replaced the old browser page and root page with the immersive VOS Forge workbench.
- Added drag/drop source loading, autosave/recovery, app graph inspection, runtime telemetry, fullscreen guest display, artifact downloads, and source export.
- Added GitHub Actions ZIP ingestion, C++/WASM rebuilds, native multi-app validation, browser ABI verification, release ZIP creation, and optional commit-back.

## Validation performed

- Native C++20 compiler builds successfully.
- `vos --version` reports VOS Compiler 0.4.0 / ABI 2.
- Native `VIR-multiapp.vos` check/build succeeds and emits 12 apps.
- Browser compiler test succeeds and emits 12 apps.
- C++20 WASM core reports App ABI 2 and max-app support of 4096.
- Browser runtime boot smoke test succeeds with 12 apps and 13 renderers.
- Workspace capture/restore and generic App Lab launch succeed.
- Root/browser workbench files and WASM/demo assets serve successfully over HTTP.
