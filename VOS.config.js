// VOS.config.js - Full system configuration
{
    "name": "Hyperion-X Config",
    "version": "1.0.0",

    // === HARDWARE LIMITS ===
    "hardwareLimits": {
        "maxMemoryPages": 50000,
        "maxVRAMPages": 10000,
        "maxDisplayWidth": 512,
        "maxDisplayHeight": 512,
        "maxCPUCyclesPerFrame": 500000,
        "maxDiskSectors": 2048,
        "maxNetworkPacketSize": 65536
    },

    // === SYSTEM CONFIG ===
    "system": {
        "defaultMode": "Bit32",
        "bootAddress": 0x08000000,
        "stackSize": 0xE000,
        "interruptsEnabled": true
    },

    // === GPU INSTRUCTIONS ===
    "gpuInstructions": [
        {
            "command": 0x80,
            "name": "GPU_FILL_RECT",
            "description": "Fill rectangle with color",
            "handler": "(gpu, bus, args, UInt74, BinaryBlob, Dimension2D, Frame2D, Pixel2D) => { const [x,y,w,h,color] = args; for(let dy=0; dy<h; dy++) for(let dx=0; dx<w; dx++) { const addr = 0x06000000 + ((y+dy)*gpu.width + (x+dx)); bus.writeByte32(addr, color); } }"
        },
        {
            "command": 0x81,
            "name": "GPU_DRAW_LINE",
            "description": "Draw line using Bresenham",
            "handler": "(gpu, bus, args) => { const [x0,y0,x1,y1,color] = args; let dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1,err=dx+dy; while(true){ bus.writeByte32(0x06000000+(y0*gpu.width+x0),color); if(x0===x1&&y0===y1)break; let e2=2*err; if(e2>=dy){err+=dy;x0+=sx;} if(e2<=dx){err+=dx;y0+=sy;} } }"
        },
        {
            "command": 0x82,
            "name": "GPU_BLIT",
            "description": "Blit framebuffer region",
            "handler": "(gpu, bus, args) => { const [srcX,srcY,dstX,dstY,w,h] = args; for(let y=0; y<h; y++) for(let x=0; x<w; x++) { const c = bus.readByte32(0x06000000+((srcY+y)*gpu.width+(srcX+x))); bus.writeByte32(0x06000000+((dstY+y)*gpu.width+(dstX+x)), c); } }"
        }
    ],

    // === EMULATED DEVICES ===
    "emulatedDevices": [
        {
            "name": "Hyperion-GPU",
            "type": "graphics",
            "vendorId": 0x4850,
            "deviceId": 0x0001,
            "capabilities": ["gpu-accelerated"],
            "memoryRegions": [
                { "address": 0x06000000, "size": 0x00040000, "name": "VRAM" },
                { "address": 0x05000000, "size": 0x00000400, "name": "Palette" }
            ],
            "ioPorts": [
                { "address": 0x00, "name": "GPU_CTRL", "handler": "(bus, value, isWrite) => { if(isWrite) bus.writeByte(0xFF00, value); return bus.readByte(0xFF00); }" },
                { "address": 0x01, "name": "GPU_STATUS", "handler": "(bus, value, isWrite) => { return isWrite ? (bus.writeByte(0xFF01, value), value) : bus.readByte(0xFF01); }" }
            ]
        },
        {
            "name": "Hyperion-Audio",
            "type": "audio",
            "vendorId": 0x4850,
            "deviceId": 0x0002,
            "capabilities": ["audio"],
            "ioPorts": [
                { "address": 0x10, "name": "AUDIO_CTRL", "handler": "(bus, value, isWrite, device) => { return 0; }" }
            ]
        },
        {
            "name": "Hyperion-Input",
            "type": "input",
            "vendorId": 0x4850,
            "deviceId": 0x0003,
            "capabilities": ["input"],
            "ioPorts": [
                { "address": 0x20, "name": "JOYPAD_STATE", "handler": "(bus, value, isWrite) => { return isWrite ? 0 : 0xFF; }" }
            ]
        }
    ],

    // === I/O DEVICES ===
    "ioDevices": [
        { "port": 0x30, "name": "RTC", "handler": "(bus, value, isWrite) => { return isWrite ? 0 : Math.floor(Date.now()/1000) & 0xFFFFFFFF; }" },
        { "port": 0x31, "name": "RNG", "handler": "(bus, value, isWrite) => { return isWrite ? 0 : Math.floor(Math.random()*0xFFFFFFFF); }" }
    ],

    // === AUDIO CONFIG ===
    "audio": {
        "channels": 2,
        "sampleRate": 44100,
        "bitsPerSample": 16,
        "bufferSize": 4096,
        "enabled": true
    },

    // === STORAGE CONFIG ===
    "storage": {
        "maxSectors": 4096,
        "sectorSize": 512
    },

    // === NETWORK CONFIG ===
    "network": {
        "macAddress": "0x001A2B3C4D5E",
        "maxPacketSize": 32768,
        "maxQueueSize": 256
    }
}
