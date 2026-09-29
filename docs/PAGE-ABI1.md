# VOS PAGE ABI 1

`.page` is the strict application language used by VOS 1.3 browser projects. It is intentionally separate from `.vos`.

## Responsibilities

- `.vos`: OS/kernel declarations, hardware, memory, devices, services, drivers, processes, app registration.
- `.page`: one app page/feature, route, local state, declarative UI, bounded actions, lifecycle handlers, permissions, and resource policy.

An application may own several PAGE files. `pages` lists them and `entryPage` selects the initial file. The project compiler rejects a strict app if a referenced PAGE file is missing or belongs to another app.

## Mandatory policy

Every page requires a `budget` block and `permissions` block. Host ceilings are: render 16 ms, action 100 ms, event 50 ms, startup 500 ms, total 5000 ms, 100000 declared operations, 32 MiB of state, 256 KiB source per `.page` file, 32 page declarations per file, 128 action/event handlers per page, 512 view nodes, 128 state slots, 12 levels of view nesting, and 4096 compiled operations per handler. Source budgets can be lower but cannot exceed these ceilings.

PAGE actions also declare their own `timeout` and `ops` values and must fit inside the page budget. The compiler verifies operation-to-permission requirements, state targets, interactive UI permissions, handler size, and route uniqueness across all PAGE files owned by the same app. The runtime checks time and operations while interpreting PAGE bytecode, checks state memory and cumulative execution, and quarantines the PAGE instance after the first policy violation.

## Safe language surface

PAGE supports typed state (`string`, `i32`, `u32`, `f64`, `bool`), declarative view nodes (`heading`, `text`, `badge`, `metric`, `button`, `divider`, `spacer`, `row`, `column`, `card`) and bounded operations (`set`, `inc`, `toggle`, `emit`, `notify`, `navigate`, `invalidate`, `storage.set`, `storage.get`).

There is no arbitrary JS, dynamic eval, raw WASM, raw memory, unrestricted loops, or arbitrary function call syntax inside PAGE ABI 1.

## Project build

Use `VOS.compileProject(files, { main: 'main.vos', strictPages: true })`. Every `.vos` file in the project is parsed and semantically checked; app declarations from auxiliary `.vos` modules are merged into one app registry. The generated project manifest contains `pageABI: 1`, `vosModules`, `pageFiles`, and each app's resolved PAGE list. Artifacts include `page-index.json` plus `pages/*.page.json`.

The C++20 `browser/vos-compiler-core.cpp` WASM core exports PAGE ABI/version and hard-limit helpers so CI can verify that host policy and JavaScript policy agree.
