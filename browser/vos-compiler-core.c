// VOS Browser Compiler Core 0.3
// Freestanding WebAssembly helpers used by vos-compiler.js.
// Intentionally small: browser parsing/emission stays inspectable JavaScript while
// hashing, integer folding, and alignment primitives run in WebAssembly.

typedef unsigned int u32;
typedef unsigned long long u64;

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
    u32 rem = value % alignment;
    return rem ? value + (alignment - rem) : value;
}

__attribute__((export_name("is_pow2")))
u32 is_pow2(u32 x) {
    return x && !(x & (x - 1u));
}

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
