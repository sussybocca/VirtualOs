# VOS 1.2 / App ABI 2 upgrade

This package upgrades the browser VOS from fixed desktop app kinds to a manifest-driven application platform while preserving the existing VOS/VIR compiler architecture.

## Main changes

- C++20 native parser/IR understands top-level `app` declarations.
- Native manifests carry `abi: 2` and an `apps` graph.
- Browser compiler understands the same app declaration format.
- `browser/vos-compiler-core.cpp` is the reproducible C++20 source for `browser/vos-compiler.wasm`.
- Desktop apps are installed from the manifest instead of a fixed five-name list.
- Runtime renderer registry supports built-ins and custom renderer plugins.
- App capability grants control storage, clipboard, notifications, events, networking, filesystem, telemetry, and similar services.
- Per-app persistent storage and inter-app event messaging.
- App lifecycle hooks and runtime event stream.
- Workspace snapshot/restore.
- Notification center and clipboard service.
- Ctrl+K searchable command palette.
- Maximize/restore and richer window state.
- Arbitrary app categories and generic `panel` apps.
- Live runtime/app telemetry.
- Import/export `.vos`, autosave recovery, artifact downloads, drag/drop editing, and fullscreen guest mode.
- Immersive VOS Forge IDE/guest-view UI in both root `index.html` and `browser/index.html`.
- `examples/VIR-multiapp.vos` ships 12 applications as an ABI 2 example.
- GitHub Actions ZIP sync/build pipeline in `.github/workflows/vos-sync-build.yml`.

## ZIP update workflow

Place a new project archive under `incoming/*.zip` and push it. The workflow selects the newest ZIP, extracts it, detects an optional single top-level folder, synchronizes the files into the repository while protecting the workflow and Git metadata, rebuilds the WASM core, synchronizes runtime mirrors, runs browser tests, builds the native compiler, compiles the multi-app OS, uploads release ZIPs, and commits synchronized changes back to the branch.

You can also run the action manually and provide a repository-relative ZIP path. Manual runs expose a `commit_changes` option.

## Verified in this package

- Browser compiler: ABI 2
- Browser example: 12 apps
- WASM compiler core: C++20 build, 844 bytes in this environment
- Native compiler: VOS Compiler 0.4.0 / ABI 2
- Native multi-app compile: 12 apps, 7 procedures, 5 memory regions, 4 devices
