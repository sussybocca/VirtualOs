# VIR — VOS Reference OS & Toolchain

VIR is the reference graphical operating system for **VOS**, a custom systems language and virtual-hardware toolchain built around the V74 architecture.

This repository is the minimal production source package: it contains the C++20 VOS compiler sources, the VIR example OS, the browser runtime/demo compiler, and one-step build scripts for Windows, Linux, and macOS. Generated compiler executables and generated OS builds are intentionally not committed.

> **License note:** this repository is **source-available**, not OSI-approved open source. You may download, inspect, privately modify, and compile the toolchain, and you may publish operating systems you build with it. You may **not** publicly redistribute the compiler/toolchain source or compiler binaries. See [LICENSE](LICENSE) for the complete terms. For production/commercial reliance, have the custom license reviewed by qualified legal counsel.

## What VIR demonstrates

The full `examples/VIR.vos` sample exercises the native VOS toolchain and virtual-hardware model, including:

- V74 CPU and VGPU2 hardware declarations
- strict VOS types, effects, ownership checks, and memory-map validation
- MMIO devices and interrupts
- guest-controlled framebuffer presentation and vsync
- graphics and text drawing
- keyboard and pointer input
- filesystem and terminal services
- compositor, desktop shell, windows, taskbar, and applications
- processes, tasks, channels, drivers, and state machines
- native-only VOS features such as Metal-level declarations, raw V74 assembly, and native targets where present

The browser example, `examples/VIR-browser.vos`, uses the Browser Demo capability profile. It keeps the same VOS syntax and runtime architecture while intentionally reserving the deepest native/compiler features for the full C++ toolchain.

## Repository layout

```text
.
├─ src/                 C++20 compiler implementation
├─ include/vos/         compiler headers
├─ examples/
│  ├─ VIR.vos           full native VIR reference OS
│  ├─ VIR-browser.vos   browser-demo VIR source
│  └─ VIR-boot.html     boot page copied into native builds
├─ runtime/browser/     runtime required by compiled browser OS builds
├─ browser/             browser demo compiler + UI
├─ build-windows.bat
├─ build-linux.sh
├─ build-macos.sh
├─ CMakeLists.txt
└─ LICENSE
```

## Requirements

The native compiler requires a C++20 compiler.

- **Windows:** w64devkit/MinGW-w64 `g++` or LLVM/Clang. The build script automatically checks `D:\C++\w64devkit\bin\g++.exe` first, then PATH.
- **Linux:** GCC/G++ or Clang with C++20 support.
- **macOS:** Apple Clang from Xcode Command Line Tools (`xcode-select --install`) or another C++20 compiler.

No Visual Studio installation is required.

## One-command native build

### Windows

Double-click `build-windows.bat`, or run:

```bat
build-windows.bat
```

The script builds:

```text
build\vosc.exe
build\vos.exe
build\vosbuild.exe
```

and then compiles VIR into:

```text
dist\VIR\
```

### Linux

```bash
chmod +x build-linux.sh
./build-linux.sh
```

### macOS

```bash
chmod +x build-macos.sh
./build-macos.sh
```

All three scripts perform the same logical pipeline:

```text
C++20 sources
    ↓
VOS compiler
    ↓
validate examples/VIR.vos
    ↓
optimized VIR build
    ↓
dist/VIR/
```

The native VIR build contains the generated VOS artifacts (`.vxe`, `.vimg`, `.vhw`, `.vlib`, `.vdbg`), JavaScript/WASM modules, manifest/symbol data, and the browser runtime files required to boot the built OS.

## Run the compiled VIR OS locally

After a successful native build:

### Windows

```bat
py -m http.server 8787 -d dist\VIR
```

### Linux / macOS

```bash
python3 -m http.server 8787 -d dist/VIR
```

Then open:

```text
http://localhost:8787/
```

Serving over HTTP is recommended instead of opening `index.html` through `file://`, because ES modules and WebAssembly are browser resources.

## Use the compiler directly

After building the toolchain:

```bash
./build/vos --version
./build/vos check examples/VIR.vos
./build/vos build examples/VIR.vos -o dist/VIR --opt 3
./build/vos emit-ir examples/VIR.vos
```

On Windows use `build\vos.exe` instead of `./build/vos`.

The compiler currently produces:

```text
manifest.json
module.js
module.wasm
module.v74.bin
symbols.json
library.json
*.vxe
*.vimg
*.vhw
*.vlib
*.vdbg
```

## VOS ABI 2 multi-application browser platform

VOS App ABI 2 upgrades the browser desktop from a fixed set of application names to manifest-driven applications. Add top-level `app Name { ... }` declarations and the compiler emits them into `manifest.json`; the runtime discovers and installs them automatically. `examples/VIR-multiapp.vos` demonstrates twelve independent apps, including a generic `panel` application that proves the shell no longer needs a hardcoded renderer for every app.

The ABI 2 browser runtime also includes a renderer registry, per-app capability grants, lifecycle/event messaging, per-app persistent storage, workspace snapshot/restore, notifications, clipboard services, a searchable command palette, maximize/restore window state, arbitrary app categories, runtime renderer plugins, live telemetry, import/export, autosave recovery, artifact downloads, and the rebuilt C++20 WebAssembly compiler core.

The root `index.html` and `browser/index.html` provide the immersive **VOS Forge** interface: source editor, compile/boot controls, live guest display, artifact inspector, app graph, diagnostics, runtime telemetry, fullscreen guest mode, drag/drop source loading, and recovery autosave.


## VOS 1.3 strict `.page` application language

VOS 1.3 keeps `.vos` for the operating system, hardware, services, processes, drivers, and app registration, but moves application UI/interaction code into a separate **PAGE ABI 1** language. Every strict app declares one or more `.page` files. A PAGE file is not normal VOS syntax: it has mandatory resource budgets, a capability allow-list, typed local state, declarative views, and bounded action/lifecycle bytecode.

```vos
app NotesStudio {
    id = "notes";
    renderer = "page";
    pages = "pages/notes.page,pages/notes-settings.page";
    entryPage = "pages/notes.page";
    pageStrict = true;
    capabilities = "ui.draw,ui.input,events.emit,storage.read,storage.write,notifications.post";
}
```

```text
@page 1.0;
app "notes";

page Home route "/" {
    budget {
        startup <= 120ms;
        render <= 12ms;
        event <= 24ms;
        action <= 40ms;
        total <= 2000ms;
        ops <= 12000;
        memory <= 4MiB;
    }
    permissions { ui.draw; ui.input; events.emit; }
    state { count: i32 = 0; }
    view {
        heading "Nebula Notes";
        metric "Interactions" bind count;
        button "Run bounded action" -> pulse;
    }
    action pulse timeout 20ms ops 64 { inc count 1; invalidate; }
    on mount timeout 30ms ops 64 { emit "page:mounted"; }
}
```

PAGE has hard host ceilings even if a source file asks for more: **16 ms render**, **100 ms action**, **50 ms event**, **500 ms startup**, **5 s cumulative execution**, **100,000 declared operations**, **32 MiB state memory**, and a **256 KiB PAGE source limit**. PAGE also limits handlers, view nodes, state slots, nesting depth, and compiled handler size. There is no arbitrary JavaScript, `eval`, or unbounded loop construct in PAGE. The compiler verifies operation permissions, state targets, UI permissions, and cross-file route uniqueness. The runtime checks handler wall time, operation counts, state size, cumulative execution, declared permissions, and parent-app capability grants; the first policy violation quarantines that PAGE instance.

`VOS.compileProject(...)` compiles a whole virtual project (multiple `.vos` modules plus many `.page` files), semantically checks every VOS module, merges their app declarations, verifies that every strict app has its referenced PAGE files, emits project/PAGE indexes and per-file PAGE artifacts, and boots the descriptors into the `VOSPageSandbox`. See `examples/page-project/` and `docs/PAGE-ABI1.md`. The Forge UI is now a multi-file project studio with a VOS/PAGE file tree, tabs, live PAGE policy inspection, autosave, import, create-VOS/create-PAGE, duplicate/delete controls, artifact access, and a larger immersive guest-machine display.

## GitHub ZIP sync + reproducible build

`.github/workflows/vos-sync-build.yml` can ingest an update ZIP from `incoming/`, extract/synchronize it, rebuild `browser/vos-compiler.wasm` from `browser/vos-compiler-core.cpp`, compile the native C++20 toolchain, test ABI 2 + PAGE ABI 1 behavior (including auxiliary `.vos` modules and strict PAGE rules), compile `examples/page-project/main.vos`, and upload fresh project/browser ZIPs as GitHub Actions artifacts. A manual run can optionally commit the synchronized source and generated WASM back to the branch.

Local verification is simply:

```bash
npm test
npm run build:wasm
npm run build:native
```

## Browser Demo (ABI 2 advanced profile)

The `browser/` directory is the zero-install VOS demo path. It uses the same language style and VOS runtime, but deliberately keeps some advanced features native-only.

Browser Demo includes major language/runtime features such as strict semantic checks, hardware declarations, memory maps, MMIO devices, interrupts, processes, drivers, tasks, channels, state machines, JS AOT output, WebAssembly output, VOS containers, graphics, input, filesystem, terminal, compositor, and desktop services.

Native-only features include the deepest Metal/toolchain operations such as custom ISA definitions, raw V74 assembly generation, unrestricted compile-time generation, native host targets, and full native link/debug optimization passes.

To publish the browser demo on GitHub Pages, publish the repository root and open:

```text
/browser/
```

For local testing you can serve the repository root with any static HTTP server, for example:

```bash
python3 -m http.server 8787
```

then open:

```text
http://localhost:8787/browser/
```

For maximum browser performance, especially `SharedArrayBuffer`/worker configurations, serve the project with cross-origin-isolation headers (`COOP: same-origin` and `COEP: require-corp`). The runtime falls back when those capabilities are unavailable.

## Publishing an OS you build

The project license is designed to allow this workflow:

```text
Download official VIR/VOS source
        ↓
Compile the toolchain privately
        ↓
Write or modify your own .vos OS
        ↓
Build the OS
        ↓
Publish the built OS
```

You may publish your built OS and its generated runtime artifacts. Do **not** republish the compiler source, compiler executables, or a repackaged VOS SDK/toolchain. Link users to the official repository if they need the compiler.

## Build output is intentionally ignored by Git

`.gitignore` excludes:

```text
build/
dist/
*.exe
*.o
*.obj
```

This keeps the official repository focused on canonical source while allowing every user to produce their own local compiler and VIR build.

## Project status

VOS and VIR are experimental systems-software projects. They are suitable for learning, prototyping, browser-based virtual hardware, and development of the VOS ecosystem; they should not be described as a replacement for hardware virtualization or a production host kernel without additional validation, security review, and platform-specific engineering.
