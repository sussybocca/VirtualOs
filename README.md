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

## Browser Demo (~70% profile)

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
