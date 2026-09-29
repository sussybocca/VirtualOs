// VOS Browser Compiler Core 0.4 (C++20 / WASM ABI 2)
// Freestanding helpers used by vos-compiler.js. This intentionally avoids a libc
// dependency so GitHub Actions can compile it with stock clang++ --target=wasm32.

using u32 = unsigned int;
using u64 = unsigned long long;

extern "C" {

__attribute__((export_name("vos_core_version")))
u32 vos_core_version() { return 0x000400u; }

__attribute__((export_name("vos_app_abi_version")))
u32 vos_app_abi_version() { return 2u; }

__attribute__((export_name("vos_max_apps")))
u32 vos_max_apps() { return 4096u; }

__attribute__((export_name("fnv1a_step")))
u32 fnv1a_step(u32 h, u32 byte) {
    h ^= (byte & 0xffu);
    return h * 16777619u;
}

__attribute__((export_name("mix32")))
u32 mix32(u32 a, u32 b) {
    u32 x = a ^ (b + 0x9e3779b9u + (a << 6) + (a >> 2));
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

__attribute__((export_name("align_up")))
u32 align_up(u32 value, u32 alignment) {
    if (!alignment) return value;
    const u32 rem = value % alignment;
    return rem ? value + (alignment - rem) : value;
}

__attribute__((export_name("is_pow2")))
u32 is_pow2(u32 x) { return x && !(x & (x - 1u)); }

// op: 0 add, 1 sub, 2 mul, 3 udiv, 4 and, 5 or, 6 xor, 7 shl, 8 shr.
__attribute__((export_name("fold_i32")))
u32 fold_i32(u32 op, u32 a, u32 b) {
    switch (op) {
        case 0: return a + b;
        case 1: return a - b;
        case 2: return a * b;
        case 3: return b ? a / b : 0u;
        case 4: return a & b;
        case 5: return a | b;
        case 6: return a ^ b;
        case 7: return a << (b & 31u);
        case 8: return a >> (b & 31u);
        default: return 0u;
    }
}

// Stable capability IDs used by the runtime permission layer.
__attribute__((export_name("vos_capability_hash")))
u32 vos_capability_hash(u32 seed, u32 byte) {
    return mix32(seed ? seed : 0x811c9dc5u, byte & 0xffu);
}

// Flags: bit0 singleton, bit1 desktop-visible, bit2 background, bit3 privileged.
__attribute__((export_name("vos_validate_app_flags")))
u32 vos_validate_app_flags(u32 flags) {
    constexpr u32 kKnown = 0x0fu;
    return (flags & ~kKnown) == 0u ? 1u : 0u;
}

// Packs a bounded width/height into one u32 for cheap layout validation.
__attribute__((export_name("vos_pack_window_size")))
u32 vos_pack_window_size(u32 width, u32 height) {
    if (width < 240u) width = 240u;
    if (width > 4095u) width = 4095u;
    if (height < 160u) height = 160u;
    if (height > 4095u) height = 4095u;
    return (width & 0xfffu) | ((height & 0xfffu) << 12);
}

// Deterministic placement helper. Returns x in low 16 bits, y in high 16 bits.
__attribute__((export_name("vos_layout_next")))
u32 vos_layout_next(u32 index, u32 viewport_width, u32 viewport_height) {
    const u32 usable_w = viewport_width > 760u ? viewport_width - 700u : 32u;
    const u32 usable_h = viewport_height > 520u ? viewport_height - 470u : 32u;
    const u32 x = 96u + ((index * 43u) % usable_w);
    const u32 y = 64u + ((index * 31u) % usable_h);
    return (x & 0xffffu) | ((y & 0xffffu) << 16);
}

// Manifest checksum primitive used by tests/tooling without requiring memory exports.
__attribute__((export_name("vos_manifest_mix")))
u32 vos_manifest_mix(u32 state, u32 field_hash) {
    return mix32(state ^ 0x564f5332u, field_hash);
}

} // extern "C"
