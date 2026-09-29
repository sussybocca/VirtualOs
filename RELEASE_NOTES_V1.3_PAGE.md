# VOS 1.3 — Strict PAGE Studio

This release separates application feature/UI code from normal VOS source.

## Project model

- `.vos` remains the OS/system language and declares application registrations.
- `.page` is PAGE ABI 1: a separate strict application language.
- One app may own many `.page` files and routes.
- A project may contain multiple `.vos` modules. Forge parses and checks each module and merges their app declarations into one registry.

## PAGE enforcement

PAGE requires explicit budgets and permissions. Hard ceilings include 16 ms render, 100 ms action, 50 ms event, 500 ms startup, 5 s cumulative execution, 100000 declared operations, 32 MiB state, 256 KiB PAGE source, bounded handlers/state/view nodes/nesting, and bounded compiled handler bytecode.

PAGE ABI 1 contains no arbitrary JavaScript/eval/raw WASM/unbounded loop construct. Operations are checked against PAGE permissions and parent-app capabilities. Routes are checked across all PAGE files belonging to an app. A runtime PAGE instance is quarantined after its first execution/policy violation.

## Forge

The immersive Forge interface is a real multi-file studio with `.vos` and `.page` tree groups, tabs, autosave, drag/drop import, +VOS, +PAGE, duplicate/delete, policy inspection, diagnostics, compiled artifact access, app registry controls, and a live framebuffer guest OS beside the source workspace.

## CI

`.github/workflows/vos-sync-build.yml` can ingest `incoming/*.zip`, rebuild the C++20 WASM core, synchronize the runtime, run VOS/PAGE tests, compile the native C++20 compiler, verify the PAGE-aware app manifest, and publish source/browser release artifacts.
