# VOS 1.3 / PAGE ABI 1 Upgrade

VOS 1.3 separates operating-system source from application-page source.

## Language split

- `.vos`: OS/kernel, virtual hardware, memory maps, services, drivers, processes, tasks, and app registration.
- `.page`: strict app UI/features/routes with mandatory resource budgets and capability rules.

Strict apps declare `renderer = "page"`, `pages = "..."`, `entryPage = "..."`, and `pageStrict = true`.

## PAGE hard ceilings

- render: 16 ms
- action: 100 ms
- event: 50 ms
- startup: 500 ms
- cumulative page execution: 5000 ms
- operation count: 100,000
- state memory: 32 MiB
- view nodes: 512
- state slots: 128
- view nesting: 12

PAGE source can request smaller budgets but cannot increase these host ceilings.

## Runtime enforcement

`VOSPageSandbox` interprets a bounded PAGE bytecode rather than executing arbitrary JavaScript. PAGE ABI 1 has no eval/raw JS/unbounded loop syntax. It validates action/event time and operation budgets, parent-app capability grants, state memory size, cumulative execution time, routes, state bindings, and action references.

## Forge 1.3

The browser editor is now a project studio instead of a single-file textarea. It includes a `.vos` / `.page` project tree, tabs, multi-file import, PAGE creation, autosave/recovery, live PAGE policy inspector, diagnostics, artifacts, app registry, and the immersive live guest framebuffer.

## C++20 / WASM

`browser/vos-compiler-core.cpp` is version 0.5 and exports both App ABI 2 and PAGE ABI 1 information plus PAGE hard-limit helpers. `tools/build-browser-wasm.sh` rebuilds `browser/vos-compiler.wasm`; GitHub Actions runs this from source and verifies it through `npm test`.

## Example

Open `examples/page-project/main.vos` and its `pages/` directory. The example contains 12 apps and 13 PAGE files, including a multi-page Notes app.
