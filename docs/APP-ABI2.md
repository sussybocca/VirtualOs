# VOS App ABI 2

VOS App ABI 2 removes the old requirement that the browser desktop know every application ahead of time.
Applications can now be declared in `.vos` source and are emitted into the build manifest.

## Declare an application

```vos
app MyStudio {
    id = "my-studio";
    title = "My Studio";
    renderer = "panel";
    icon = "LAB";
    category = "creative";
    description = "A custom VOS application.";
    content = "This content is rendered by the generic panel renderer.";
    width = 720;
    height = 460;
    singleton = true;
    desktop = true;
    capabilities = "filesystem.read,clipboard.read,notifications";
    shortcut = "F6";
    accent = 0x69D7FFFF;
}
```

The browser compiler and native C++20 compiler both emit the declaration into `manifest.json` under `apps`.
The browser desktop installs those app manifests automatically at boot.

## Built-in renderer types

The ABI 2 runtime ships with renderers for `welcome`, `terminal`, `files`, `system`, `settings`, `textfile`, `notes`, `dashboard`, `clock`, `network`, `browser`, `processes`, and the generic `panel` renderer.

`panel` is the compatibility escape hatch for entirely new application IDs: the desktop no longer needs a hardcoded branch for each app. Runtime code can also register a completely custom renderer with:

```js
runtime.desktop.registerRenderer('my-renderer', {
  render(ctx) {
    const { g, x, y, app } = ctx;
    g.text(x, y, app.title, app.accent, 3);
  }
});
```

Then a VOS app can use `renderer = "my-renderer"`. For VOS 1.3 strict apps, use `renderer = "page"` and reference one or more `.page` files; PAGE ABI 1 is documented in `PAGE-ABI1.md`.

## ABI 2 browser services

The advanced browser runtime includes:

1. Declarative multi-app manifests.
2. Dynamic renderer registration.
3. Per-app capability grants.
4. App lifecycle events.
5. Inter-app event bus.
6. Per-app persistent storage.
7. Notification center.
8. Clipboard service.
9. Workspace capture and restore.
10. Searchable command palette (`Ctrl+K`).
11. Maximize/restore window state.
12. Arbitrary app categories and shortcuts.
13. Generic custom-panel applications.
14. Runtime renderer plug-ins.
15. Live runtime/system telemetry.
16. Source import/export and drag/drop in VOS Forge.
17. Editor autosave/recovery.
18. Build artifact inspection/download.
19. C++20 WebAssembly compiler helper ABI.
20. Browser/native ABI parity tests.
21. Strict PAGE ABI 1 renderer and sandbox.
22. Multi-file `.vos` + `.page` project compilation.
23. Hard PAGE wall-time, operation, state-memory, and capability enforcement.

## C++20 WASM core

`browser/vos-compiler-core.cpp` is compiled into `browser/vos-compiler.wasm` with `tools/build-browser-wasm.sh`.
It exports ABI/version helpers, hashing, layout helpers, app flag validation, window-size packing, and manifest mixing primitives.

The GitHub Actions workflow rebuilds this file from source on every relevant project/ZIP update so the committed WASM never has to be a mystery binary.
