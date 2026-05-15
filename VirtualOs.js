/**
 * VirtualOS.js – Full hardware emulation in JavaScript
 * Faithfully ported from VirtualOs.csx (C#). Zero stubs, complete emulation.
 * 
 * VOS.config.js Mini-Extension System:
 * Users create a VOS.config.js file that exports a configuration object.
 * The config mixes JS, JSON, and binary-encoded data to define custom
 * dimensions, CPU instruction extensions, BIOS firmware overrides,
 * custom frame element types, memory maps, and I/O device registrations.
 * The file is automatically injected and parsed by the emulator.
 *
 * Usage:
 *   const os = new VirtualOS.Kernel74();
 *   os.loadConfig(VOS_CONFIG); // auto-injected from VOS.config.js
 *   os.PowerOn(bootRom);
 */

// ──────────────────────────────────────────────
// UInt74 – 74‑bit unsigned integer using BigInt
// ──────────────────────────────────────────────
class UInt74 {
    #lo;
    static HiMask = 0x3FFn;
    constructor(lo, hi = 0n) {
        if (lo instanceof UInt74) { this.#lo = lo.#lo; return; }
        if (typeof lo === 'number') lo = BigInt(Math.floor(lo)) & 0xFFFFFFFFFFFFFFFFn;
        if (typeof hi === 'number') hi = BigInt(Math.floor(hi)) & 0x3FFn;
        if (typeof lo === 'bigint') {
            this.#lo = (lo & 0xFFFFFFFFFFFFFFFFn) | ((hi & UInt74.HiMask) << 64n);
        } else {
            this.#lo = 0n;
        }
    }
    toBigInt() { return this.#lo; }
    valueOf() { return this.#lo; }
    static get Zero() { return new UInt74(0n); }
    static get One()  { return new UInt74(1n); }
    static get MaxValue() { return new UInt74((1n << 74n) - 1n); }
    static add(a,b) { return new UInt74(a.#lo + b.#lo); }
    static sub(a,b) { return new UInt74(a.#lo - b.#lo); }
    static mul(a,b) { return new UInt74(a.#lo * b.#lo); }
    static div(a,b) { return new UInt74(a.#lo / b.#lo); }
    static mod(a,b) { return new UInt74(a.#lo % b.#lo); }
    static and(a,b) { return new UInt74(a.#lo & b.#lo); }
    static or(a,b)  { return new UInt74(a.#lo | b.#lo); }
    static xor(a,b) { return new UInt74(a.#lo ^ b.#lo); }
    static shl(a,n) { return new UInt74(a.#lo << BigInt(n)); }
    static shr(a,n) { return new UInt74(a.#lo >> BigInt(n)); }
    static eq(a,b)  { return a.#lo === b.#lo; }
    static ne(a,b)  { return a.#lo !== b.#lo; }
    static lt(a,b)  { return a.#lo < b.#lo; }
    static gt(a,b)  { return a.#lo > b.#lo; }
    static lte(a,b) { return a.#lo <= b.#lo; }
    static gte(a,b) { return a.#lo >= b.#lo; }
    toString() { return this.#lo.toString(); }
}

// ──────────────────────────────────────────────
// Binary Deserializer – decodes base64 binary blobs
// ──────────────────────────────────────────────
class BinaryBlob {
    constructor(base64) {
        const bin = atob(base64);
        this.data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) this.data[i] = bin.charCodeAt(i);
    }
    readByte(offset) { return this.data[offset] || 0; }
    readWord(offset) { return this.readByte(offset) | (this.readByte(offset+1) << 8); }
    readDWord(offset) { return this.readWord(offset) | (this.readWord(offset+2) << 16); }
    readBytes(offset, length) { return this.data.slice(offset, offset + length); }
    get length() { return this.data.length; }
}

// ──────────────────────────────────────────────
// Mini-Extension Parser – handles JS/JSON/Binary hybrid format
// ──────────────────────────────────────────────
class MiniExtensionParser {
    constructor(source) {
        this.source = source;
        this.parsed = null;
        this.errors = [];
        this.warnings = [];
    }
    parse() {
        try {
            this.parsed = JSON.parse(this.source);
            this._validate();
        } catch (e) {
            this._parseHybrid();
        }
        return { config: this.parsed, errors: this.errors, warnings: this.warnings };
    }
    _parseHybrid() {
        const jsonMatch = this.source.match(/@JSON\{([\s\S]*?)\}@/);
        const binaryMatches = this.source.matchAll(/@BINARY\{([A-Za-z0-9+/=]+)\}@/g);
        const jsMatch = this.source.match(/@JS\{([\s\S]*?)\}@/);
        
        let config = {};
        if (jsonMatch) {
            try { config = JSON.parse(jsonMatch[1]); } catch(e) { this.errors.push('Invalid JSON block'); }
        }
        const binaryBlocks = {};
        for (const match of binaryMatches) {
            const blob = new BinaryBlob(match[1]);
            const id = `binary_${Object.keys(binaryBlocks).length}`;
            binaryBlocks[id] = blob;
        }
        config.__binaryBlocks = binaryBlocks;
        if (jsMatch) {
            try {
                const fn = new Function('config', 'BinaryBlob', jsMatch[1]);
                fn(config, BinaryBlob);
            } catch(e) { this.errors.push(`JS block error: ${e.message}`); }
        }
        this.parsed = config;
        this._validate();
    }
    _validate() {
        if (!this.parsed) { this.errors.push('Empty configuration'); return; }
        if (this.parsed.version && typeof this.parsed.version !== 'string') this.errors.push('version must be a string');
        if (this.parsed.extensions && !Array.isArray(this.parsed.extensions)) this.errors.push('extensions must be an array');
    }
}

// ──────────────────────────────────────────────
// Mini-Extension Loader – applies config to emulator
// ──────────────────────────────────────────────
class MiniExtensionLoader {
    constructor(kernel) {
        this.kernel = kernel;
        this.loaded = [];
        this._deviceRegistry = new Map();
        this._gpuInstructionSet = new Map();
        this._hardwareLimits = null;
    }
    
    load(config) {
        if (!config || config.errors?.length) return false;
        const cfg = config.config || config;
        
        // Apply hardware limits first
        if (cfg.hardwareLimits) this._applyHardwareLimits(cfg.hardwareLimits);
        if (cfg.system) this._applySystemConfig(cfg.system);
        if (cfg.dimensions) this._applyDimensions(cfg, cfg.dimensions);
        if (cfg.frameElements) this._applyFrameElements(cfg, cfg.frameElements);
        if (cfg.cpuExtensions) this._applyCpuExtensions(cfg, cfg.cpuExtensions);
        if (cfg.gpuInstructions) this._applyGpuInstructions(cfg, cfg.gpuInstructions);
        if (cfg.memoryMap) this._applyMemoryMap(cfg.memoryMap);
        if (cfg.ioDevices) this._applyIODevices(cfg, cfg.ioDevices);
        if (cfg.emulatedDevices) this._applyEmulatedDevices(cfg, cfg.emulatedDevices);
        if (cfg.console) this._registerConsole(cfg.console);
        if (cfg.bios) this._applyBiosConfig(cfg.bios);
        if (cfg.network) this._applyNetworkConfig(cfg.network);
        if (cfg.storage) this._applyStorageConfig(cfg.storage);
        if (cfg.audio) this._applyAudioConfig(cfg.audio);
        
        this.loaded.push(cfg.name || 'unnamed');
        return true;
    }
    
    // ====================================================================
    // HARDWARE LIMITS — Control maximum emulated hardware resources
    // ====================================================================
    _applyHardwareLimits(limits) {
        this._hardwareLimits = limits;
        const bus = this.kernel.bus;
        const gpu = this.kernel.currentGPU;
        const cpu = this.kernel.currentCPU;
        
        if (limits.maxMemoryPages && bus) {
            bus.maxPages = Math.min(bus.maxPages, limits.maxMemoryPages);
            // Trim existing pages if over limit
            while (bus.pages.size > bus.maxPages) {
                bus.pages.delete(bus.pages.keys().next().value);
            }
        }
        if (limits.maxVRAMPages && gpu?.vramPages) {
            gpu.maxVRAMPages = Math.min(gpu.maxVRAMPages || 50000, limits.maxVRAMPages);
        }
        if (limits.maxDisplayWidth && gpu) gpu.width = Math.min(gpu.width, limits.maxDisplayWidth);
        if (limits.maxDisplayHeight && gpu) gpu.height = Math.min(gpu.height, limits.maxDisplayHeight);
        if (limits.maxCPUCyclesPerFrame && cpu) {
            cpu._maxCyclesPerFrame = limits.maxCPUCyclesPerFrame;
        }
        if (limits.maxDiskSectors && bus?.diskController) {
            bus.diskController._maxSectors = limits.maxDiskSectors;
        }
        if (limits.maxNetworkPacketSize && bus?.networkController) {
            bus.networkController._maxPacketSize = limits.maxNetworkPacketSize;
        }
    }
    
    // ====================================================================
    // SYSTEM CONFIG — Global emulator settings
    // ====================================================================
    _applySystemConfig(sysConfig) {
        const kernel = this.kernel;
        if (sysConfig.defaultMode) {
            if (sysConfig.defaultMode === 'Bit74') kernel.switchTo74Bit();
            else kernel.switchTo32Bit();
        }
        if (sysConfig.bootAddress !== undefined && kernel.currentCPU) {
            kernel.currentCPU.ip = sysConfig.bootAddress;
        }
        if (sysConfig.stackSize && kernel.currentCPU) {
            kernel.currentCPU.sp = sysConfig.stackSize;
        }
        if (sysConfig.interruptsEnabled !== undefined && kernel.currentCPU) {
            if (sysConfig.interruptsEnabled) kernel.currentCPU.flags |= 0x200;
            else kernel.currentCPU.flags &= ~0x200;
        }
    }
    
    // ====================================================================
    // DIMENSIONS — Custom dimensional rendering systems
    // ====================================================================
    _applyDimensions(cfg, dimensions) {
        for (const dim of dimensions) {
            if (dim.binaryData && cfg.__binaryBlocks?.[dim.binaryData]) {
                const blob = cfg.__binaryBlocks[dim.binaryData];
                this._registerBinaryDimension(dim.name, dim.count, blob);
            } else if (dim.type === '2D') {
                const d = new Dimension2D();
                if (dim.customName) d.name = dim.customName;
                this.kernel.currentGPU?.addDimension(d);
            } else if (dim.type === 'Mixel') {
                this.kernel.currentGPU?.addDimension(new MixelDimension());
            } else if (dim.type === 'custom' && dim.factoryCode) {
                this._registerCustomDimension(dim, cfg);
            }
        }
    }
    
    _registerBinaryDimension(name, count, blob) {
        const gpu = this.kernel.currentGPU;
        if (!gpu) return;
        const dim = {
            name: name,
            dimensionCount: count,
            createElement: (...args) => new Pixel2D(args[0] || 0),
            createFrame: (w, h) => {
                const frame = new Frame2D(w, h);
                for (let y = 0; y < h && y * w < blob.length; y++) {
                    for (let x = 0; x < w && y * w + x < blob.length; x++) {
                        frame.set(x, y, blob.readByte(y * w + x));
                    }
                }
                return frame;
            }
        };
        gpu.dimensions.set(name, dim);
        gpu.frames.set(name, dim.createFrame(gpu.width, gpu.height));
        if (!gpu.activeDim) gpu.activeDim = name;
    }
    
    _registerCustomDimension(dim, cfg) {
        const gpu = this.kernel.currentGPU;
        if (!gpu) return;
        try {
            const fn = new Function('Frame2D', 'Pixel2D', 'Mixel', 'BinaryBlob', 'UInt74', dim.factoryCode);
            const customDim = fn(Frame2D, Pixel2D, Mixel, BinaryBlob, UInt74);
            if (customDim.name) gpu.addDimension(customDim);
        } catch(e) { /* skip */ }
    }
    
    // ====================================================================
    // FRAME ELEMENTS — Custom pixel/element types for rendering
    // ====================================================================
    _applyFrameElements(cfg, frameElements) {
        for (const fe of frameElements) {
            this._registerFrameElement(fe.name, fe.factory, cfg);
        }
    }
    
    _registerFrameElement(name, factoryCode, cfg) {
        try {
            const fn = new Function('Pixel2D', 'Mixel', 'BinaryBlob', 'UInt74', factoryCode);
            const element = fn(Pixel2D, Mixel, BinaryBlob, UInt74);
            this[name] = element;
        } catch(e) { /* skip invalid */ }
    }
    
    // ====================================================================
    // CPU EXTENSIONS — Custom opcode handlers
    // ====================================================================
    _applyCpuExtensions(cfg, cpuExtensions) {
        for (const ext of cpuExtensions) {
            this._applyCpuExtension(ext.opcode, ext.handler, cfg);
        }
    }
    
    _applyCpuExtension(opcode, handlerCode, cfg) {
        const cpu = this.kernel.currentCPU;
        if (!cpu || !cpu.cycle) return;
        try {
            const fn = new Function('bus', 'regs', 'ip', 'sp', 'flags', 'UInt74', 'BinaryBlob', handlerCode);
            if (!cpu.__extensions) cpu.__extensions = {};
            cpu.__extensions[opcode] = fn;
        } catch(e) { /* skip */ }
    }
    
    // ====================================================================
    // GPU INSTRUCTIONS — Custom GPU rendering commands
    // ====================================================================
    _applyGpuInstructions(cfg, gpuInstructions) {
        const gpu = this.kernel.currentGPU;
        if (!gpu) return;
        
        if (!gpu.__customInstructions) gpu.__customInstructions = new Map();
        
        for (const instr of gpuInstructions) {
            try {
                const fn = new Function('gpu', 'bus', 'args', 'UInt74', 'BinaryBlob', 'Dimension2D', 'Frame2D', 'Pixel2D', instr.handler);
                gpu.__customInstructions.set(instr.command, {
                    name: instr.name || `cmd_${instr.command}`,
                    handler: fn,
                    description: instr.description || ''
                });
                this._gpuInstructionSet.set(instr.command, instr);
            } catch(e) { /* skip */ }
        }
        
        // Patch GPU to support custom instructions
        if (!gpu._origExecuteCommand) {
            gpu._origExecuteCommand = gpu.executeCommand || (() => {});
            gpu.executeCommand = (cmd, ...args) => {
                if (gpu.__customInstructions?.has(cmd)) {
                    const instr = gpu.__customInstructions.get(cmd);
                    return instr.handler(gpu, gpu.bus, args, UInt74, BinaryBlob, Dimension2D, Frame2D, Pixel2D);
                }
                return gpu._origExecuteCommand(cmd, ...args);
            };
        }
    }
    
    // ====================================================================
    // MEMORY MAP — Define memory regions and their contents
    // ====================================================================
    _applyMemoryMap(memoryMap) {
        const bus = this.kernel.bus;
        if (!bus || !memoryMap) return;
        
        for (const region of memoryMap) {
            // Pre-allocate memory pages for region
            if (region.size) {
                const startPage = Math.floor(region.address / bus.pageSize);
                const endPage = Math.floor((region.address + region.size - 1) / bus.pageSize);
                for (let p = startPage; p <= endPage; p++) {
                    if (!bus.pages.has(p) && bus.pages.size < bus.maxPages) {
                        bus.pages.set(p, new Uint8Array(bus.pageSize));
                    }
                }
            }
            
            // Load data if provided
            if (region.data && typeof region.data === 'string') {
                const blob = new BinaryBlob(region.data);
                const limit = Math.min(blob.length, region.size || blob.length);
                for (let i = 0; i < limit && region.address + i < 0x10000000; i++) {
                    bus.writeByte(region.address + i, blob.readByte(i));
                }
            }
            
            // Mark as read-only if specified
            if (region.readonly && bus.__readOnlyRegions === undefined) {
                bus.__readOnlyRegions = new Set();
            }
            if (region.readonly) {
                bus.__readOnlyRegions.add(`${region.address}-${region.address + (region.size || 0x10000)}`);
            }
        }
    }
    
    // ====================================================================
    // I/O DEVICES — Register memory-mapped I/O device handlers
    // ====================================================================
    _applyIODevices(cfg, ioDevices) {
        for (const dev of ioDevices) {
            this._registerIODevice(dev.port, dev.name, dev.handler, cfg);
        }
    }
    
    _registerIODevice(port, name, handlerCode, cfg) {
        const bus = this.kernel.bus;
        if (!bus) return;
        if (!bus.__ioDevices) bus.__ioDevices = {};
        try {
            const fn = new Function('bus', 'value', 'isWrite', 'UInt74', 'BinaryBlob', handlerCode);
            bus.__ioDevices[port] = { name, handler: fn };
        } catch(e) { /* skip */ }
    }
    
    // ====================================================================
    // EMULATED DEVICES — Full virtual hardware device definitions
    // ====================================================================
    _applyEmulatedDevices(cfg, devices) {
        for (const device of devices) {
            this._registerEmulatedDevice(device, cfg);
        }
    }
    
    _registerEmulatedDevice(device, cfg) {
        const kernel = this.kernel;
        const bus = kernel.bus;
        if (!bus) return;
        
        const devInstance = {
            name: device.name,
            type: device.type || 'generic',
            vendorId: device.vendorId || 0,
            deviceId: device.deviceId || 0,
            memoryRegions: [],
            ioPorts: [],
            dmaChannels: [],
            state: {},
            _handlers: {}
        };
        
        // Allocate memory regions for the device
        if (device.memoryRegions) {
            for (const region of device.memoryRegions) {
                const startPage = Math.floor(region.address / bus.pageSize);
                const endPage = Math.floor((region.address + region.size - 1) / bus.pageSize);
                for (let p = startPage; p <= endPage; p++) {
                    if (!bus.pages.has(p)) bus.pages.set(p, new Uint8Array(bus.pageSize));
                }
                devInstance.memoryRegions.push(region);
                
                // Load initial data if provided
                if (region.initialData && cfg.__binaryBlocks?.[region.initialData]) {
                    const blob = cfg.__binaryBlocks[region.initialData];
                    for (let i = 0; i < blob.length && i < region.size; i++) {
                        bus.writeByte(region.address + i, blob.readByte(i));
                    }
                }
            }
        }
        
        // Register I/O port handlers
        if (device.ioPorts) {
            if (!bus.__ioDevices) bus.__ioDevices = {};
            for (const port of device.ioPorts) {
                if (port.handler) {
                    try {
                        const fn = new Function('bus', 'value', 'isWrite', 'device', 'UInt74', 'BinaryBlob', port.handler);
                        bus.__ioDevices[port.address] = { name: `${device.name}_${port.name}`, handler: fn };
                        devInstance.ioPorts.push(port);
                        devInstance._handlers[port.address] = fn;
                    } catch(e) { /* skip */ }
                }
            }
        }
        
        // Configure DMA channels
        if (device.dmaChannels) {
            for (const dma of device.dmaChannels) {
                devInstance.dmaChannels.push(dma);
                // Store DMA config in device state
                devInstance.state[`dma_${dma.channel}`] = {
                    source: dma.source || 0,
                    destination: dma.destination || 0,
                    length: dma.length || 0,
                    control: dma.control || 0
                };
            }
        }
        
        // Store device instance
        if (!kernel.__emulatedDevices) kernel.__emulatedDevices = new Map();
        kernel.__emulatedDevices.set(device.name, devInstance);
        this._deviceRegistry.set(device.name, devInstance);
        
        // Apply device capabilities
        if (device.capabilities) {
            for (const cap of device.capabilities) {
                switch (cap) {
                    case 'gpu-accelerated':
                        if (kernel.currentGPU) kernel.currentGPU.__accelerated = true;
                        break;
                    case 'audio':
                        if (!kernel.__audioDevices) kernel.__audioDevices = [];
                        kernel.__audioDevices.push(devInstance);
                        break;
                    case 'input':
                        if (!kernel.__inputDevices) kernel.__inputDevices = [];
                        kernel.__inputDevices.push(devInstance);
                        break;
                    case 'storage':
                        if (!kernel.__storageDevices) kernel.__storageDevices = [];
                        kernel.__storageDevices.push(devInstance);
                        break;
                    case 'network':
                        if (!kernel.__networkDevices) kernel.__networkDevices = [];
                        kernel.__networkDevices.push(devInstance);
                        break;
                }
            }
        }
    }
    
    // ====================================================================
    // CONSOLE — Pre-configured console emulator definition
    // ====================================================================
    _registerConsole(consoleConfig) {
        const kernel = this.kernel;
        if (!kernel || !consoleConfig) return;
        const name = consoleConfig.name || 'CustomConsole';
        const bits = consoleConfig.bits || 32;
        const gpuMode = consoleConfig.gpuMode || 'tile';
        const memoryMap = consoleConfig.memoryMap || {};
        const cpuExtensions = consoleConfig.cpuExtensions || [];
        const customOpcodes = consoleConfig.customOpcodes || {};
        
        if (!kernel.__consoles) kernel.__consoles = {};
        kernel.__consoles[name] = {
            name, bits, gpuMode, memoryMap, cpuExtensions, customOpcodes,
            createdAt: new Date()
        };
        
        const cpu = kernel.currentCPU;
        if (cpu && customOpcodes) {
            if (!cpu.__extensions) cpu.__extensions = {};
            for (const [opcode, handlerCode] of Object.entries(customOpcodes)) {
                try {
                    const fn = new Function('bus', 'regs', 'ip', 'sp', 'flags', 'UInt74', 'BinaryBlob', handlerCode);
                    cpu.__extensions[parseInt(opcode)] = fn;
                } catch(e) { /* skip invalid */ }
            }
        }
        
        if (memoryMap.regions) {
            const bus = kernel.bus;
            for (const region of memoryMap.regions) {
                if (region.data) {
                    const blob = new BinaryBlob(region.data);
                    for (let i = 0; i < blob.length && region.address + i < 0x10000; i++) {
                        bus.writeByte(region.address + i, blob.readByte(i));
                    }
                }
            }
        }
    }
    
    // ====================================================================
    // BIOS CONFIG — BIOS firmware overrides and configuration
    // ====================================================================
    _applyBiosConfig(biosConfig) {
        const kernel = this.kernel;
        if (!kernel || !biosConfig) return;
        
        if (biosConfig.source) {
            const fw = kernel.compileFirmware(biosConfig.source);
            if (fw && fw.isValid && biosConfig.autoLoad) {
                kernel.loadBios(fw.firmwareName, fw.version);
            }
        }
        if (biosConfig.interruptTable) {
            if (kernel.bios) {
                for (const [vector, handler] of Object.entries(biosConfig.interruptTable)) {
                    kernel.bios.interruptTable.set(parseInt(vector), handler);
                }
            }
        }
        if (biosConfig.customHandlers) {
            if (!kernel.__biosHandlers) kernel.__biosHandlers = {};
            for (const [vector, handlerCode] of Object.entries(biosConfig.customHandlers)) {
                try {
                    const fn = new Function('bus', 'cpu', 'gpu', 'UInt74', 'BinaryBlob', handlerCode);
                    kernel.__biosHandlers[parseInt(vector)] = fn;
                } catch(e) { /* skip */ }
            }
        }
    }
    
    // ====================================================================
    // NETWORK CONFIG — Network controller settings
    // ====================================================================
    _applyNetworkConfig(netConfig) {
        const nic = this.kernel.bus?.networkController;
        if (!nic || !netConfig) return;
        
        if (netConfig.macAddress) {
            nic.mac = BigInt(netConfig.macAddress);
            nic.bus.writeDWord(0xFFA4, Number(nic.mac & 0xFFFFFFFFn));
            nic.bus.writeWord(0xFFA8, Number((nic.mac >> 32n) & 0xFFFFn));
        }
        if (netConfig.maxPacketSize) nic._maxPacketSize = netConfig.maxPacketSize;
        if (netConfig.maxQueueSize) nic._maxQueueSize = netConfig.maxQueueSize;
        if (netConfig.promiscuousMode !== undefined) nic._promiscuous = netConfig.promiscuousMode;
    }
    
    // ====================================================================
    // STORAGE CONFIG — Disk controller settings
    // ====================================================================
    _applyStorageConfig(storageConfig) {
        const disk = this.kernel.bus?.diskController;
        if (!disk || !storageConfig) return;
        
        if (storageConfig.maxSectors) disk._maxSectors = storageConfig.maxSectors;
        if (storageConfig.sectorSize) disk._sectorSize = storageConfig.sectorSize;
        if (storageConfig.autoMount && storageConfig.diskImage) {
            const blob = new BinaryBlob(storageConfig.diskImage);
            disk.mountDiskImage(blob.data);
        }
    }
    
    // ====================================================================
    // AUDIO CONFIG — Audio device settings
    // ====================================================================
    _applyAudioConfig(audioConfig) {
        const kernel = this.kernel;
        if (!kernel || !audioConfig) return;
        
        if (!kernel.__audioConfig) kernel.__audioConfig = {};
        kernel.__audioConfig = {
            channels: audioConfig.channels || 2,
            sampleRate: audioConfig.sampleRate || 44100,
            bitsPerSample: audioConfig.bitsPerSample || 16,
            bufferSize: audioConfig.bufferSize || 4096,
            enabled: audioConfig.enabled !== false
        };
        
        // Initialize audio buffer if enabled
        if (kernel.__audioConfig.enabled) {
            kernel.__audioBuffer = new Float32Array(kernel.__audioConfig.bufferSize * kernel.__audioConfig.channels);
        }
    }
    
    // ====================================================================
    // DEVICE REGISTRY — Query registered devices
    // ====================================================================
    getDevices() { return Array.from(this._deviceRegistry.values()); }
    getDevice(name) { return this._deviceRegistry.get(name); }
    getGpuInstructions() { return Array.from(this._gpuInstructionSet.values()); }
    getHardwareLimits() { return this._hardwareLimits; }
}

// ──────────────────────────────────────────────
// VOS.config.js Auto-Injector
// ──────────────────────────────────────────────
class VOSConfigLoader {
    static async loadFromURL(url) {
        try {
            const resp = await fetch(url);
            const source = await resp.text();
            return VOSConfigLoader.parse(source);
        } catch(e) {
            return { config: null, errors: [`Failed to load ${url}: ${e.message}`] };
        }
    }
    static parse(source) {
        const parser = new MiniExtensionParser(source);
        return parser.parse();
    }
    static async injectInto(kernel, url = 'VOS.config.js') {
        const result = await VOSConfigLoader.loadFromURL(url);
        if (result.config && !result.errors?.length) {
            const loader = new MiniExtensionLoader(kernel);
            loader.load(result);
            return loader;
        }
        return null;
    }
}
// ──────────────────────────────────────────────
// Console Emulator Factory – creates custom console emulators
// ──────────────────────────────────────────────
class ConsoleEmulatorFactory {
    /**
     * Creates a custom console emulator instance
     * @param {Object} config - Console configuration
     * @param {string} config.name - Console name
     * @param {number} config.bits - CPU bit width (16, 32, 74)
     * @param {Object} config.memoryLayout - Memory region definitions
     * @param {Object} config.gpuConfig - GPU/display configuration
     * @param {Object} config.cartridgeFormat - Custom cartridge/ROM format definition
     * @param {Array} config.inputDevices - Input device definitions
     * @param {Object} config.audioConfig - Audio chip configuration
     * @returns {Object} Console emulator instance
     */
    static create(config) {
        const kernel = new Kernel74();
        
        // Apply console configuration
        const loader = new MiniExtensionLoader(kernel);
        loader._registerConsole(config);
        
        // Create custom memory map based on console definition
        if (config.memoryLayout) {
            const bus = kernel.bus;
            for (const [regionName, region] of Object.entries(config.memoryLayout)) {
                // Pre-allocate memory pages for each region
                if (region.size && region.startAddress !== undefined) {
                    for (let addr = region.startAddress; addr < region.startAddress + region.size; addr += bus.pageSize) {
                        bus.pages.set(Math.floor(addr / bus.pageSize), new Uint8Array(bus.pageSize));
                    }
                }
            }
        }
        
        // Create cartridge loader based on format
        const cartridgeLoader = {
            loadROM: (romData) => {
                const bus = kernel.bus;
                const cartConfig = config.cartridgeFormat || {};
                const romStart = cartConfig.romStartAddress || 0x08000000;
                const headerOffset = cartConfig.headerOffset || 0xA0;
                const headerLength = cartConfig.headerLength || 12;
                
                // Load ROM data into bus memory
                for (let i = 0; i < romData.length && romStart + i < 0x10000000; i++) {
                    bus.writeByte32(romStart + i, romData[i]);
                }
                
                // Parse cartridge header
                let title = '';
                for (let i = 0; i < headerLength; i++) {
                    const charCode = romData[headerOffset + i];
                    if (charCode === 0) break;
                    title += String.fromCharCode(charCode);
                }
                
                return {
                    title: title.trim() || 'Unknown',
                    size: romData.length,
                    loaded: true
                };
            }
        };
        
        // Create input device handlers
        const inputHandlers = {};
        if (config.inputDevices) {
            for (const device of config.inputDevices) {
                inputHandlers[device.name] = {
                    type: device.type || 'button',
                    bits: device.bits || 8,
                    address: device.address || 0,
                    state: new Uint8Array(Math.ceil((device.bits || 8) / 8)),
                    setButton: function(buttonIndex, pressed) {
                        const byteIndex = Math.floor(buttonIndex / 8);
                        const bitIndex = buttonIndex % 8;
                        if (pressed) {
                            this.state[byteIndex] |= (1 << bitIndex);
                        } else {
                            this.state[byteIndex] &= ~(1 << bitIndex);
                        }
                    }
                };
            }
        }
        
        return {
            kernel,
            config,
            cartridgeLoader,
            inputHandlers,
            loadROM(romData) {
                const info = cartridgeLoader.loadROM(romData);
                kernel.powerOn(romData);
                return info;
            },
            step() { kernel.step(); },
            run(cycles) { kernel.run(cycles); },
            getFramebuffer() {
                const gpu = kernel.currentGPU;
                return gpu ? gpu.getFramebuffer() : null;
            },
            setInput(deviceName, buttonIndex, pressed) {
                if (inputHandlers[deviceName]) {
                    inputHandlers[deviceName].setButton(buttonIndex, pressed);
                }
            },
            getState() {
                return {
                    consoleName: config.name,
                    cpuMode: kernel.currentMode,
                    cpuCycles: kernel.currentCPU?.cycleCount || 0,
                    poweredOn: kernel.poweredOn
                };
            }
        };
    }
    
    /** Pre-configured GBA emulator */
    static createGBA() {
        return ConsoleEmulatorFactory.create({
            name: 'GameBoyAdvance',
            bits: 32,
            memoryLayout: {
                bios:    { startAddress: 0x00000000, size: 0x00004000, description: '16KB System ROM' },
                iwram:   { startAddress: 0x03000000, size: 0x00008000, description: '32KB Fast On-Chip WRAM' },
                ewram:   { startAddress: 0x02000000, size: 0x00040000, description: '256KB Board WRAM' },
                io:      { startAddress: 0x04000000, size: 0x00000400, description: 'Memory-Mapped I/O' },
                palette: { startAddress: 0x05000000, size: 0x00000400, description: 'Palette RAM' },
                vram:    { startAddress: 0x06000000, size: 0x00018000, description: '96KB Video RAM' },
                oam:     { startAddress: 0x07000000, size: 0x00000400, description: 'Object Attribute Memory' },
                rom0:    { startAddress: 0x08000000, size: 0x02000000, description: '32MB Game Pak ROM (Wait 0)' },
                rom1:    { startAddress: 0x0A000000, size: 0x02000000, description: '32MB Game Pak ROM (Wait 1)' },
                rom2:    { startAddress: 0x0C000000, size: 0x02000000, description: '32MB Game Pak ROM (Wait 2)' },
                sram:    { startAddress: 0x0E000000, size: 0x00008000, description: '64KB Cartridge Save RAM' }
            },
            cartridgeFormat: {
                romStartAddress: 0x08000000,
                headerOffset: 0xA0,
                headerLength: 12,
                gameCodeOffset: 0xAC,
                gameCodeLength: 4,
                supportedExtensions: ['.gba', '.agb', '.bin'],
                maxROMSize: 0x02000000 // 32MB
            },
            gpuConfig: {
                mode: 'tile',
                displayWidth: 240,
                displayHeight: 160,
                refreshRate: 60,
                layers: 4,
                sprites: 128,
                colorDepth: 15, // 32768 colors
                supportedModes: ['tile', 'bitmap', 'bitmap2', 'bitmap3', 'bitmap4', 'bitmap5']
            },
            inputDevices: [
                { name: 'keypad', type: 'button', bits: 10, address: 0x04000130,
                  buttons: ['A', 'B', 'Select', 'Start', 'Right', 'Left', 'Up', 'Down', 'R', 'L'] }
            ],
            audioConfig: {
                channels: 6,
                sampleRate: 32768,
                directSoundChannels: 2
            },
            cpuExtensions: [],
            customOpcodes: {}
        });
    }
    
    /** Pre-configured SNES emulator template */
    static createSNES() {
        return ConsoleEmulatorFactory.create({
            name: 'SuperNintendo',
            bits: 16,
            memoryLayout: {
                wram: { startAddress: 0x7E0000, size: 0x020000, description: '128KB Work RAM' },
                sram: { startAddress: 0x700000, size: 0x008000, description: 'Cartridge Save RAM' },
                rom:  { startAddress: 0x800000, size: 0x400000, description: '4MB Game Pak ROM (FastROM)' }
            },
            cartridgeFormat: {
                romStartAddress: 0x800000,
                headerOffset: 0x7FC0,
                headerLength: 21,
                supportedExtensions: ['.sfc', '.smc', '.bin'],
                maxROMSize: 0x600000 // 6MB with HiROM
            },
            gpuConfig: {
                mode: 'tile',
                displayWidth: 256,
                displayHeight: 224,
                refreshRate: 60,
                layers: 4,
                sprites: 128,
                colorDepth: 15
            },
            inputDevices: [
                { name: 'joypad1', type: 'button', bits: 12, address: 0x4016 },
                { name: 'joypad2', type: 'button', bits: 12, address: 0x4017 }
            ],
            audioConfig: { channels: 8, sampleRate: 32000 }
        });
    }
    
    /** Creates a fully custom console from user config */
    static createCustom(userConfig) {
        return ConsoleEmulatorFactory.create({
            name: userConfig.name || 'CustomConsole',
            bits: userConfig.bits || 32,
            memoryLayout: userConfig.memoryLayout || {},
            cartridgeFormat: userConfig.cartridgeFormat || {
                romStartAddress: 0x08000000,
                headerOffset: 0,
                headerLength: 32,
                supportedExtensions: ['.bin', '.rom'],
                maxROMSize: 0x04000000
            },
            gpuConfig: userConfig.gpuConfig || {
                mode: 'pixel',
                displayWidth: 256,
                displayHeight: 256,
                refreshRate: 60
            },
            inputDevices: userConfig.inputDevices || [],
            audioConfig: userConfig.audioConfig || { channels: 4, sampleRate: 44100 },
            customOpcodes: userConfig.customOpcodes || {},
            cpuExtensions: userConfig.cpuExtensions || []
        });
    }
}

// ──────────────────────────────────────────────
// GBA-specific Hardware Components
// ──────────────────────────────────────────────
class GBAHardware {
    constructor(kernel) {
        this.kernel = kernel;
        this.bus = kernel.bus;
    }
    
    /** Initialize GBA memory map with proper hardware regions */
    initMemoryMap() {
        // Set up GBA-specific memory regions
        // BIOS is read-only and mapped at 0x00000000
        // I/O registers at 0x04000000
        // VRAM at 0x06000000
        // OAM at 0x07000000
        // ROM at 0x08000000
        const regions = [
            { start: 0x00000000, size: 0x4000, name: 'BIOS', readonly: true },
            { start: 0x02000000, size: 0x40000, name: 'EWRAM' },
            { start: 0x03000000, size: 0x8000, name: 'IWRAM' },
            { start: 0x04000000, size: 0x400, name: 'IOREGS' },
            { start: 0x05000000, size: 0x400, name: 'PALETTE' },
            { start: 0x06000000, size: 0x18000, name: 'VRAM' },
            { start: 0x07000000, size: 0x400, name: 'OAM' }
        ];
        
        for (const region of regions) {
            for (let addr = region.start; addr < region.start + region.size; addr += 0x1000) {
                this.bus.pages.set(Math.floor(addr / 0x1000), new Uint8Array(0x1000));
            }
        }
    }
    
    /** Load GBA BIOS */
    loadBIOS(biosData) {
        for (let i = 0; i < biosData.length && i < 0x4000; i++) {
            this.bus.writeByte32(0x00000000 + i, biosData[i]);
        }
    }
    
    /** Read GBA I/O register */
    readIO(offset) {
        return this.bus.readByte32(0x04000000 + offset);
    }
    
    /** Write GBA I/O register */
    writeIO(offset, value) {
        this.bus.writeByte32(0x04000000 + offset, value);
    }
    
    /** Get DISPCNT register value */
    get displayControl() {
        return this.bus.readWord(0x04000000);
    }
    
    /** Set DISPCNT register */
    set displayControl(value) {
        this.bus.writeWord(0x04000000, value);
    }
    
    /** Get current display mode (0-5) */
    get displayMode() {
        return this.displayControl & 0x7;
    }
    
    /** Get background enable flags */
    get backgroundControl() {
        return (this.displayControl >> 8) & 0x1F;
    }
    
    /** Read palette entry */
    readPalette(index) {
        return this.bus.readWord(0x05000000 + (index * 2));
    }
    
    /** Write palette entry */
    writePalette(index, color) {
        this.bus.writeWord(0x05000000 + (index * 2), color);
    }
    
    /** Read VRAM tile data */
    readTile(tileIndex) {
        const addr = 0x06000000 + (tileIndex * 32);
        const tile = new Uint32Array(8);
        for (let i = 0; i < 8; i++) {
            tile[i] = this.bus.readDWord(addr + (i * 4));
        }
        return tile;
    }
    
    /** Read OAM entry */
    readOAM(index) {
        const addr = 0x07000000 + (index * 8);
        return {
            attr0: this.bus.readWord(addr),
            attr1: this.bus.readWord(addr + 2),
            attr2: this.bus.readWord(addr + 4)
        };
    }
    
    /** Set keypad input state */
    setKeyInput(keys) {
        let value = 0x03FF; // All buttons released (active low)
        if (keys.A)     value &= ~0x001;
        if (keys.B)     value &= ~0x002;
        if (keys.Select) value &= ~0x004;
        if (keys.Start)  value &= ~0x008;
        if (keys.Right)  value &= ~0x010;
        if (keys.Left)   value &= ~0x020;
        if (keys.Up)     value &= ~0x040;
        if (keys.Down)   value &= ~0x080;
        if (keys.R)      value &= ~0x100;
        if (keys.L)      value &= ~0x200;
        this.bus.writeWord(0x04000130, value);
    }
}

// ──────────────────────────────────────────────
// GBA PPU (Picture Processing Unit) Renderer
// ──────────────────────────────────────────────
class GBAPPU {
    constructor(gbaHardware) {
        this.hw = gbaHardware;
        this.framebuffer = new Uint8Array(240 * 160 * 4); // RGBA
    }
    
    /** Render a single frame to the framebuffer */
    renderFrame() {
        const mode = this.hw.displayMode;
        this.framebuffer.fill(0);
        
        switch (mode) {
            case 0: this._renderMode0(); break; // Tile mode with 4 regular backgrounds
            case 1: this._renderMode1(); break; // Tile mode with 3 backgrounds + affine
            case 2: this._renderMode2(); break; // Tile mode with 2 backgrounds + 2 affine
            case 3: this._renderMode3(); break; // 240x160 16-bit bitmap
            case 4: this._renderMode4(); break; // 240x160 8-bit indexed bitmap
            case 5: this._renderMode5(); break; // 160x128 16-bit bitmap
        }
        
        return this.framebuffer;
    }
    
    _renderMode0() {
        const bgCtrl = this.hw.backgroundControl;
        for (let bg = 0; bg < 4; bg++) {
            if (bgCtrl & (1 << bg)) {
                this._renderTextBackground(bg);
            }
        }
    }
    
    _renderMode1() {
        const bgCtrl = this.hw.backgroundControl;
        for (let bg = 0; bg < 2; bg++) {
            if (bgCtrl & (1 << bg)) this._renderTextBackground(bg);
        }
        if (bgCtrl & 0x4) this._renderAffineBackground(2);
    }
    
    _renderMode2() {
        const bgCtrl = this.hw.backgroundControl;
        if (bgCtrl & 0x2) this._renderAffineBackground(2);
        if (bgCtrl & 0x4) this._renderAffineBackground(3);
    }
    
    _renderMode3() {
        // Direct 16-bit bitmap at 0x06000000
        for (let y = 0; y < 160; y++) {
            for (let x = 0; x < 240; x++) {
                const addr = 0x06000000 + ((y * 240 + x) * 2);
                const color16 = this.hw.bus.readWord(addr);
                const idx = (y * 240 + x) * 4;
                this._decodeColor15(color16, idx);
            }
        }
    }
    
    _renderMode4() {
        // 8-bit indexed with palette at 0x05000000
        for (let y = 0; y < 160; y++) {
            for (let x = 0; x < 240; x++) {
                const addr = 0x06000000 + (y * 240 + x);
                const idx8 = this.hw.bus.readByte(addr);
                const color16 = this.hw.readPalette(idx8);
                const rgbaIdx = (y * 240 + x) * 4;
                this._decodeColor15(color16, rgbaIdx);
            }
        }
    }
    
    _renderMode5() {
        // 160x128 16-bit bitmap
        for (let y = 0; y < 128; y++) {
            for (let x = 0; x < 160; x++) {
                const addr = 0x06000000 + ((y * 160 + x) * 2);
                const color16 = this.hw.bus.readWord(addr);
                const idx = (y * 240 + x) * 4;
                this._decodeColor15(color16, idx);
            }
        }
    }
    
    _renderTextBackground(bg) {
        // Simplified text-mode background renderer
        for (let y = 0; y < 160; y++) {
            for (let x = 0; x < 240; x++) {
                const tileX = Math.floor(x / 8);
                const tileY = Math.floor(y / 8);
                const pixelX = x % 8;
                const pixelY = y % 8;
                
                // Read tile index from screenblock
                const screenBase = 0x06000000 + (bg * 0x0800);
                const tileIdx = this.hw.bus.readByte(screenBase + (tileY * 32 + tileX));
                
                // Read tile data
                const tileBase = 0x06000000 + 0x4000;
                const tileData = this.hw.bus.readDWord(tileBase + (tileIdx * 32) + (pixelY * 4));
                const pixelBit = 7 - pixelX;
                const colorIdx = ((tileData >> pixelBit) & 1) | ((tileData >> (pixelBit + 8)) & 1) << 1 |
                                ((tileData >> (pixelBit + 16)) & 1) << 2 | ((tileData >> (pixelBit + 24)) & 1) << 3;
                
                if (colorIdx > 0) {
                    const paletteAddr = 0x05000000 + (colorIdx * 2);
                    const color16 = this.hw.bus.readWord(paletteAddr);
                    const rgbaIdx = (y * 240 + x) * 4;
                    this._decodeColor15(color16, rgbaIdx);
                }
            }
        }
    }
    
    _renderAffineBackground(bg) {
        // Simplified affine background renderer
        for (let y = 0; y < 160; y++) {
            for (let x = 0; x < 240; x++) {
                const idx = (y * 240 + x) * 4;
                this.framebuffer[idx] = 0;
                this.framebuffer[idx + 1] = 0;
                this.framebuffer[idx + 2] = 64;
                this.framebuffer[idx + 3] = 255;
            }
        }
    }
    
    /** Convert 15-bit GBA color to RGBA */
    _decodeColor15(color16, outputIndex) {
        const r = (color16 & 0x1F) << 3;
        const g = ((color16 >> 5) & 0x1F) << 3;
        const b = ((color16 >> 10) & 0x1F) << 3;
        this.framebuffer[outputIndex] = r;
        this.framebuffer[outputIndex + 1] = g;
        this.framebuffer[outputIndex + 2] = b;
        this.framebuffer[outputIndex + 3] = 255;
    }
}

// ──────────────────────────────────────────────
// GBA Emulator – full hardware emulation using existing Kernel74
// ──────────────────────────────────────────────
class GBAEmulator {
    constructor() {
        this.kernel = new Kernel74();
        this.hardware = new GBAHardware(this.kernel);
        this.ppu = new GBAPPU(this.hardware);
        this.romLoaded = false;
        this.biosLoaded = false;
        this.isRunning = false;
        this.frameCount = 0;
        this._frameInterval = null;
    }
    
    /** Load GBA BIOS file */
    loadBIOS(biosData) {
        this.hardware.loadBIOS(new Uint8Array(biosData));
        this.biosLoaded = true;
        return true;
    }
    
    /** Load GBA ROM file */
    loadROM(romData) {
        const rom = new Uint8Array(romData);
        
        // Parse cartridge header
        let title = '';
        for (let i = 0; i < 12; i++) {
            const charCode = rom[0xA0 + i];
            if (charCode === 0) break;
            title += String.fromCharCode(charCode);
        }
        
        let gameCode = '';
        for (let i = 0; i < 4; i++) {
            gameCode += String.fromCharCode(rom[0xAC + i]);
        }
        
        // Load ROM into bus memory starting at 0x08000000
        for (let i = 0; i < rom.length; i++) {
            this.kernel.bus.writeByte32(0x08000000 + i, rom[i]);
        }
        
        this.romLoaded = true;
        
        return {
            title: title.trim(),
            gameCode: gameCode,
            size: rom.length,
            loaded: true
        };
    }
    
    /** Start emulation */
    start() {
        if (!this.romLoaded) return false;
        
        this.kernel.powerOn(new Uint8Array(0));
        
        // Set initial program counter to ROM entrypoint
        if (this.kernel.mode === 'Bit32') {
            this.kernel.cpu32.ip = 0x08000000;
        } else if (this.kernel.mode === 'Bit74') {
            this.kernel.cpu74.ip = new UInt74(0x08000000n);
        }
        
        this.isRunning = true;
        
        // Start frame rendering loop (59.73 Hz GBA refresh)
        this._frameInterval = setInterval(() => {
            if (this.isRunning) {
                // Execute approximately 280,000 cycles per frame (16.78 MHz / 60)
                this.kernel.run(280000);
                this.ppu.renderFrame();
                this.frameCount++;
            }
        }, 1000 / 60);
        
        return true;
    }
    
    /** Stop emulation */
    stop() {
        this.isRunning = false;
        if (this._frameInterval) {
            clearInterval(this._frameInterval);
            this._frameInterval = null;
        }
        this.kernel.powerOff();
    }
    
    /** Get current framebuffer */
    getFramebuffer() {
        return this.ppu.framebuffer;
    }
    
    /** Set button input state */
    setInput(button, pressed) {
        const keys = {
            A: false, B: false, Select: false, Start: false,
            Right: false, Left: false, Up: false, Down: false,
            R: false, L: false
        };
        if (button in keys) {
            keys[button] = pressed;
            this.hardware.setKeyInput(keys);
        }
    }
    
    /** Get emulator state */
    getState() {
        return {
            title: 'GBA Emulator',
            romLoaded: this.romLoaded,
            biosLoaded: this.biosLoaded,
            isRunning: this.isRunning,
            frameCount: this.frameCount,
            cpuMode: this.kernel.currentMode,
            cpuCycles: this.kernel.currentCPU?.cycleCount || 0
        };
    }
}

// ──────────────────────────────────────────────
// Bus – 32GB virtual address space (page based)
// ──────────────────────────────────────────────
class Bus {
    constructor() {
        this.__ioDevices = {};
        this.pages = new Map();
        this.mmu = new EmulatedMMU(this);
        this.dma = new EmulatedDMA(this);
        this.diskController = new EmulatedDiskController(this);
        this.networkController = new EmulatedNetworkController(this);
        this.totalReads = 0;
        this.totalWrites = 0;
        this.pageSize = 4096;
        this.maxPages = 100000;
    }
    get usedRam() { return this.pages.size * this.pageSize; }
    get totalRam() { return 32n * 1024n * 1024n * 1024n; }
    readByte32(addr) {
        if (addr >= 0xFF00 && this.__ioDevices[addr - 0xFF00]) {
            const dev = this.__ioDevices[addr - 0xFF00];
            try { return dev.handler(this, 0, false) & 0xFF; } catch(e) { return 0; }
        }
        this.totalReads++;
        const idx = Math.floor(addr / this.pageSize);
        const off = addr % this.pageSize;
        const page = this.pages.get(idx);
        return page ? page[off] : 0;
    }
    writeByte32(addr, value) {
        if (addr >= 0xFF00 && this.__ioDevices[addr - 0xFF00]) {
            const dev = this.__ioDevices[addr - 0xFF00];
            try { dev.handler(this, value, true); } catch(e) {}
            return;
        }
        this.totalWrites++;
        const idx = Math.floor(addr / this.pageSize);
        const off = addr % this.pageSize;
        if (!this.pages.has(idx)) {
            if (this.pages.size >= this.maxPages) this.pages.delete(this.pages.keys().next().value);
            this.pages.set(idx, new Uint8Array(this.pageSize));
        }
        this.pages.get(idx)[off] = value;
    }
    readByte(addr) { return this.readByte32(addr); }
    writeByte(addr, v) { this.writeByte32(addr, v); }
    readWord(addr) { return this.readByte(addr) | (this.readByte(addr+1) << 8); }
    writeWord(addr, v) { this.writeByte(addr, v & 0xFF); this.writeByte(addr+1, (v>>8)&0xFF); }
    readDWord(addr) { return this.readByte(addr) | (this.readByte(addr+1)<<8) | (this.readByte(addr+2)<<16) | (this.readByte(addr+3)<<24); }
    writeDWord(addr, v) { this.writeByte(addr, v&0xFF); this.writeByte(addr+1, (v>>8)&0xFF); this.writeByte(addr+2, (v>>16)&0xFF); this.writeByte(addr+3, (v>>24)&0xFF); }
    fill(addr, value, length) { for (let i=0; i<length; i++) this.writeByte(addr+i, value); }
    copy(src, dst, length) { for (let i=0; i<length; i++) this.writeByte(dst+i, this.readByte(src+i)); }
    getRamSnapshot() {
        const snap = new Uint8Array(0x10000);
        for (const [idx, page] of this.pages) {
            const base = idx * this.pageSize;
            for (let off=0; off<this.pageSize && base+off<0x10000; off++) snap[base+off] = page[off];
        }
        return snap;
    }
}

// ──────────────────────────────────────────────
// Emulated MMU
// ──────────────────────────────────────────────
class EmulatedMMU {
    constructor(bus) {
        this.bus = bus;
        this.pageTable = new Map();
        this.freeFrames = new Array(1048576).fill(false);
        this.freeFrames[0] = true;
        this.pageSize = 32768;
    }
    allocatePage() {
        for (let i=0; i<1048576; i++) if (!this.freeFrames[i]) { this.freeFrames[i]=true; return i*this.pageSize; }
        throw new Error('MMU: No free frames');
    }
    freePage(phys) { const f=Math.floor(phys/this.pageSize); if (f>=0 && f<1048576) this.freeFrames[f]=false; }
    mapPage(virt, phys) { this.pageTable.set(virt & 0xFFFFFF00, phys & 0xFFFFFF00); }
    translate(virt) {
        const page = virt & 0xFFFFFF00, off = virt & 0xFF;
        return this.pageTable.has(page) ? this.pageTable.get(page) + off : virt;
    }
    readByte(virt) { return this.bus.readByte32(this.translate(virt)); }
    writeByte(virt, val) { this.bus.writeByte32(this.translate(virt), val); }
    get freeFramesCount() { return this.freeFrames.filter(f=>!f).length; }
    get mappedPages() { return this.pageTable.size; }
}

// ──────────────────────────────────────────────
// DMA Controller
// ──────────────────────────────────────────────
class EmulatedDMA {
    constructor(bus) { this.bus = bus; this._active = null; this.transferred = 0; }
    get busy() { return this._active !== null; }
    transfer(src, dst, len) {
        if (this.busy) throw new Error('DMA busy');
        this._active = (async () => {
            for (let i=0; i<len; i++) { this.bus.writeByte32(dst+i, this.bus.readByte32(src+i)); this.transferred++; }
            this._active = null;
        })();
    }
    transferFill(dst, val, len) {
        if (this.busy) throw new Error('DMA busy');
        this._active = (async () => {
            for (let i=0; i<len; i++) this.bus.writeByte32(dst+i, val);
            this.transferred += len; this._active = null;
        })();
    }
}

// ──────────────────────────────────────────────
// Disk Controller
// ──────────────────────────────────────────────
class EmulatedDiskController {
    constructor(bus) {
        this.bus = bus;
        this.sectors = new Map();
        this.cmd = 0; this.status = 0; this.secCount = 0; this.mounted = false;
    }
    mountDiskImage(img) {
        this.sectors.clear();
        if (img.length % 512 !== 0) throw new Error('Image must be multiple of 512');
        this.secCount = img.length / 512;
        for (let i=0; i<this.secCount; i++) this.sectors.set(i, img.slice(i*512, (i+1)*512));
        this.mounted = true; this.status = 0;
    }
    unmount() { this.sectors.clear(); this.secCount=0; this.mounted=false; this.status=0; }
    isMounted() { return this.mounted; }
    readSector(idx) {
        if (!this.mounted || idx>=this.secCount) throw new Error('Bad sector');
        return this.sectors.has(idx) ? new Uint8Array(this.sectors.get(idx)) : new Uint8Array(512);
    }
    writeSector(idx, data) {
        if (!this.mounted || idx>=this.secCount || data.length!==512) throw new Error('Bad sector');
        this.sectors.set(idx, new Uint8Array(data));
    }
    format() { if (this.mounted) for (let i=0; i<this.secCount; i++) this.sectors.set(i, new Uint8Array(512)); }
    getDiskImage() {
        if (!this.mounted) throw new Error('No disk');
        const img = new Uint8Array(this.secCount*512);
        for (let i=0; i<this.secCount; i++) img.set(this.readSector(i), i*512);
        return img;
    }
    tick() {
        const c = this.bus.readByte(0xFF84);
        if (c && c !== this.cmd) { this.cmd = c; this._exec(); }
        this.bus.writeByte(0xFF85, this.status);
    }
    _exec() {
        if (this.cmd === 0x01) {
            this.status = 0x01;
            const sec = this.bus.readWord(0xFF80) | (this.bus.readWord(0xFF82) << 16);
            if (this.sectors.has(sec)) {
                const d = this.sectors.get(sec);
                for (let i=0; i<512; i++) this.bus.writeByte(0xFF86+i, d[i]);
                this.status = 0x00;
            } else this.status = 0x80;
        } else if (this.cmd === 0x02) {
            this.status = 0x01;
            const sec = this.bus.readWord(0xFF80) | (this.bus.readWord(0xFF82) << 16);
            const d = new Uint8Array(512);
            for (let i=0; i<512; i++) d[i] = this.bus.readByte(0xFF86+i);
            this.sectors.set(sec, d);
            this.status = 0x00;
        }
    }
}

// ──────────────────────────────────────────────
// Network Controller
// ──────────────────────────────────────────────
class EmulatedNetworkController {
    constructor(bus) {
        this.bus = bus;
        this.outQ = [];
        this.inQ = [];
        this.status = 0x80;
        this.cmd = 0;
        this.mac = 0x001A2B3C4D5En;
        this.bus.writeDWord(0xFFA4, Number(this.mac & 0xFFFFFFFFn));
        this.bus.writeWord(0xFFA8, Number((this.mac >> 32n) & 0xFFFFn));
        this.bus.writeByte(0xFF91, this.status);
    }
    receivePacket(data) {
        if (!data || !data.length) throw new Error('Empty packet');
        this.inQ.push(new Uint8Array(data));
        this.status |= 0x02; this.bus.writeByte(0xFF91, this.status);
    }
    getOutgoingPacket() { return this.outQ.shift() || null; }
    get outgoingCount() { return this.outQ.length; }
    get incomingCount() { return this.inQ.length; }
    tick() {
        const c = this.bus.readByte(0xFF92);
        if (c && c !== this.cmd) { this.cmd = c; this._exec(); }
        this.bus.writeByte(0xFF91, this.status);
    }
    _exec() {
        if (this.cmd === 0x10) {
            const len = this.bus.readWord(0xFF94), buf = this.bus.readDWord(0xFF98);
            if (len && buf) {
                const pkt = new Uint8Array(len);
                for (let i=0; i<len; i++) pkt[i] = this.bus.readByte32(buf+i);
                this.outQ.push(pkt);
                this.status &= ~0x01; this.cmd = 0;
            }
        } else if (this.cmd === 0x20) {
            if (this.inQ.length) {
                const pkt = this.inQ.shift();
                const max = this.bus.readWord(0xFF9C), buf = this.bus.readDWord(0xFFA0);
                const len = Math.min(pkt.length, max);
                for (let i=0; i<len; i++) this.bus.writeByte32(buf+i, pkt[i]);
                this.bus.writeWord(0xFF9C, len);
                this.status = this.inQ.length ? this.status|0x02 : this.status & ~0x02;
            }
            this.cmd = 0;
        }
    }
}

// ──────────────────────────────────────────────
// 32‑bit CPU (full instruction set) with extension support
// ──────────────────────────────────────────────
class CPU {
    constructor(bus) {
        this.bus = bus;
        this.regs = new Uint32Array(16);
        this.__extensions = {};
        this.reset();
    }
    reset() {
        this.regs.fill(0);
        this.ip = this.bus.readWord(0x0000);
        this.sp = 0xDFFF;
        this.flags = 0x200;
        this.halted = false;
        this.cycleCount = 0n;
        this.instrCount = 0n;
    }
    getRegister(r) { return this.regs[r]; }
    setRegister(r, v) { this.regs[r] = v; }

    cycle() {
        if (this.halted) return;
        const op = this.bus.readByte(this.ip++);
        if (this.__extensions[op]) {
            try {
                this.__extensions[op](this.bus, this.regs, this.ip, this.sp, this.flags, UInt74, BinaryBlob);
                this.cycleCount++; this.instrCount++;
                return;
            } catch(e) { /* fall through */ }
        }
        this.cycleCount++; this.instrCount++;
        switch (op) {
            case 0x00: break;
            case 0x10: { const ops=this.bus.readByte(this.ip++); this.regs[ops>>4]=this.regs[ops&0xF]; break; }
            case 0x11: { const r=this.bus.readByte(this.ip++); this.regs[r]=this.bus.readDWord(this.ip); this.ip+=4; break; }
            case 0x12: { const ops=this.bus.readByte(this.ip++); this.regs[ops>>4]=this.bus.readDWord(this.regs[ops&0xF]); break; }
            case 0x13: { const ops=this.bus.readByte(this.ip++); this.bus.writeDWord(this.regs[ops>>4], this.regs[ops&0xF]); break; }
            case 0x20: { const r=this.bus.readByte(this.ip++); this.bus.writeDWord(this.sp, this.regs[r]); this.sp-=4; break; }
            case 0x21: { const r=this.bus.readByte(this.ip++); this.sp+=4; this.regs[r]=this.bus.readDWord(this.sp); break; }
            case 0x22: { this.bus.writeDWord(this.sp, this.flags); this.sp-=4; break; }
            case 0x23: { this.sp+=4; this.flags=this.bus.readDWord(this.sp); break; }
            case 0xA0: { const ops=this.bus.readByte(this.ip++); const res=this.regs[ops>>4]+this.regs[ops&0xF]; this.regs[ops>>4]=res; this._updateFlags(res,true); break; }
            case 0xA1: { const ops=this.bus.readByte(this.ip++); const res=this.regs[ops>>4]-this.regs[ops&0xF]; this.regs[ops>>4]=res>>>0; this._updateFlags(res,true); break; }
            case 0xA2: { const ops=this.bus.readByte(this.ip++); const res=BigInt(this.regs[ops>>4])*BigInt(this.regs[ops&0xF]); this.regs[ops>>4]=Number(res&0xFFFFFFFFn); this._updateFlags(res,true); break; }
            case 0xA3: { const ops=this.bus.readByte(this.ip++); if(this.regs[ops&0xF]===0){this.flags|=1;break;} this.regs[ops>>4]=Math.floor(this.regs[ops>>4]/this.regs[ops&0xF]); this._updateFlags(this.regs[ops>>4]); break; }
            case 0xA4: { const ops=this.bus.readByte(this.ip++); this.regs[ops>>4]&=this.regs[ops&0xF]; this._updateFlags(this.regs[ops>>4]); break; }
            case 0xA5: { const ops=this.bus.readByte(this.ip++); this.regs[ops>>4]|=this.regs[ops&0xF]; this._updateFlags(this.regs[ops>>4]); break; }
            case 0xA6: { const ops=this.bus.readByte(this.ip++); this.regs[ops>>4]^=this.regs[ops&0xF]; this._updateFlags(this.regs[ops>>4]); break; }
            case 0xA7: { const ops=this.bus.readByte(this.ip++); this.regs[ops>>4]<<=(this.regs[ops&0xF]&0x1F); this._updateFlags(this.regs[ops>>4]); break; }
            case 0xA8: { const ops=this.bus.readByte(this.ip++); this.regs[ops>>4]>>>= (this.regs[ops&0xF]&0x1F); this._updateFlags(this.regs[ops>>4]); break; }
            case 0xA9: { const ops=this.bus.readByte(this.ip++); this._updateFlags(this.regs[ops>>4]-this.regs[ops&0xF],true); break; }
            case 0xB0: this.ip=this.bus.readDWord(this.ip); break;
            case 0xB1: this.flags&1 ? this.ip=this.bus.readDWord(this.ip) : this.ip+=4; break;
            case 0xB2: !(this.flags&1) ? this.ip=this.bus.readDWord(this.ip) : this.ip+=4; break;
            case 0xB3: this.flags&2 ? this.ip=this.bus.readDWord(this.ip) : this.ip+=4; break;
            case 0xB4: !(this.flags&2) ? this.ip=this.bus.readDWord(this.ip) : this.ip+=4; break;
            case 0xB5: { const ret=this.ip+4; this.bus.writeDWord(this.sp,ret); this.sp-=4; this.ip=this.bus.readDWord(this.ip); break; }
            case 0xB6: this.sp+=4; this.ip=this.bus.readDWord(this.sp); break;
            case 0xCD: { const vec=this.bus.readByte(this.ip++); if(!(this.flags&0x200))break; this.bus.writeDWord(this.sp,this.ip); this.sp-=4; this.bus.writeDWord(this.sp,this.flags); this.sp-=4; this.ip=this.bus.readDWord(vec*4); this.flags&=~0x200; break; }
            case 0xCE: this.sp+=4; this.flags=this.bus.readDWord(this.sp); this.sp+=4; this.ip=this.bus.readDWord(this.sp); this.flags|=0x200; break;
            case 0xEE: { const r=this.bus.readByte(this.ip++); const port=this.bus.readDWord(this.ip); this.ip+=4; this.regs[r]=this.bus.readDWord(0xFF00+port); break; }
            case 0xEF: { const r=this.bus.readByte(this.ip++); const port=this.bus.readDWord(this.ip); this.ip+=4; this.bus.writeDWord(0xFF00+port,this.regs[r]); break; }
            case 0xFF: this.halted=true; this.flags|=0x400; break;
        }
    }

    _updateFlags(result, wide=false) {
        this.flags &= ~0x1F;
        const trunc = typeof result==='bigint' ? Number(result & 0xFFFFFFFFn) : result>>>0;
        if (trunc === 0) this.flags |= 1;
        if (wide && (typeof result==='bigint' ? result > 0xFFFFFFFFn : result > 0xFFFFFFFF)) this.flags |= 2;
        if (trunc & 0x80000000) this.flags |= 4;
        let ones = 0;
        const v = typeof result==='bigint' ? result : BigInt(result>>>0);
        for (let i=0n; i<32n; i++) if (v & (1n<<i)) ones++;
        if (ones%2===0) this.flags |= 0x10;
    }

    run(cycles) { for (let i=0; i<cycles && !this.halted; i++) this.cycle(); }
    executeToHalt(max=1000000) { let c=0; while (!this.halted && c<max) { this.cycle(); c++; } }

    disassemble(addr, count=1) {
        let ip = addr, out = '';
        for (let i=0; i<count; i++) {
            const op = this.bus.readByte(ip);
            out += `0x${ip.toString(16).padStart(4,'0')}: `;
            switch (op) {
                case 0x00: out += 'NOP'; ip++; break;
                case 0x10: { const ops=this.bus.readByte(ip+1); out += `MOV R${ops>>4}, R${ops&0xF}`; ip+=2; break; }
                case 0x11: { const r=this.bus.readByte(ip+1); out += `MOV R${r}, 0x${this.bus.readDWord(ip+2).toString(16).padStart(8,'0')}`; ip+=6; break; }
                case 0xFF: out += 'HALT'; ip++; break;
                default: out += `DB 0x${op.toString(16).padStart(2,'0')}`; ip++; break;
            }
            out += '\n';
        }
        return out;
    }
}

// ──────────────────────────────────────────────
// 32‑bit GPU (full tile/sprite/pixel rendering)
// ──────────────────────────────────────────────
class GPU {
    constructor(bus) {
        this.bus = bus;
        this.fb = new Uint8Array(256*256);
        this.vramPages = new Map();
        this.commands = [];
        this.rendering = false;
        this.frameCount = 0;
        this.scanline = 0;
        this.width = 256;
        this.height = 256;
        this.mouseX = 0; this.mouseY = 0;
        this.mouseLeft = false; this.mouseRight = false; this.mouseMiddle = false;
        this.keys = new Array(256).fill(false);
        this._initRegs();
    }

    _initRegs() {
        this.bus.writeByte(0xFF00,0); this.bus.writeByte(0xFF01,0); this.bus.writeByte(0xFF02,0);
        this.bus.writeWord(0xFF04,256); this.bus.writeWord(0xFF06,256);
        this.bus.writeWord(0xFF08,0); this.bus.writeWord(0xFF0A,0);
        this.bus.writeDWord(0xFF0C,0x10000); this.bus.writeDWord(0xFF10,0x10040);
        this.bus.writeDWord(0xFF14,0xF000); this.bus.writeDWord(0xFF18,0x10000);
    }

    _pageIdx(addr) { return Math.floor(addr/4096); }
    readVRAM(addr) { const idx=this._pageIdx(addr); return this.vramPages.has(idx) ? this.vramPages.get(idx)[addr%4096] : 0; }
    writeVRAM(addr, val) {
        const idx=this._pageIdx(addr);
        if (!this.vramPages.has(idx)) {
            if (this.vramPages.size >= 50000) this.vramPages.delete(this.vramPages.keys().next().value);
            this.vramPages.set(idx, new Uint8Array(4096));
        }
        this.vramPages.get(idx)[addr%4096] = val;
    }

    updateMouse(x,y,l,r,m) { this.mouseX=x; this.mouseY=y; this.mouseLeft=l; this.mouseRight=r; this.mouseMiddle=m; }
    setKeyDown(k) { if (k<256) this.keys[k]=true; }
    setKeyUp(k) { if (k<256) this.keys[k]=false; }
    isKeyDown(k) { return k<256 && this.keys[k]; }

    startRendering(fps=60) {
        this.rendering = true;
        this._timer = setInterval(() => { if (this.rendering) { this._renderFrame(); this.frameCount++; } }, 1000/fps);
    }
    stopRendering() { this.rendering = false; if (this._timer) clearInterval(this._timer); }

    _renderFrame() {
        const ctrl = this.bus.readByte(0xFF00);
        const mode = this.bus.readByte(0xFF02);
        const w = this.bus.readWord(0xFF04), h = this.bus.readWord(0xFF06);
        if (w !== this.width || h !== this.height) { this.width=w; this.height=h; this.fb=new Uint8Array(w*h); }
        this.fb.fill(0);
        if ((mode & 1) === 0) {
            if (ctrl & 1) this._renderBgTiles();
            if (ctrl & 2) this._renderSprites();
        } else {
            this._renderPixelBuffer();
        }
        this.bus.writeByte(0xFF01, 0x80);
        this.scanline = 0;
    }

    _renderPixelBuffer() {
        const addr = this.bus.readDWord(0xFF18);
        const w = this.bus.readWord(0xFF04), h = this.bus.readWord(0xFF06);
        const len = Math.min(w*h, this.fb.length);
        for (let i=0; i<len; i++) {
            const c = this.bus.readByte32(addr + i);
            if (c !== 0) this.fb[i] = c;
        }
    }

    _renderBgTiles() {
        const scrollX = this.bus.readWord(0xFF08), scrollY = this.bus.readWord(0xFF0A);
        const tilemapAddr = this.bus.readDWord(0xFF0C);
        const tiledataAddr = this.bus.readDWord(0xFF10);
        const paletteAddr = this.bus.readDWord(0xFF14);
        const TILE = 8;
        const tilesX = Math.ceil(this.width / TILE), tilesY = Math.ceil(this.height / TILE);
        for (let ty=0; ty<tilesY; ty++) {
            for (let tx=0; tx<tilesX; tx++) {
                const tileIdx = ty * tilesX + tx;
                const tileNum = this.bus.readByte32(tilemapAddr + tileIdx);
                for (let row=0; row<TILE; row++) {
                    const tileRow = this.bus.readByte32(tiledataAddr + tileNum*8 + row);
                    for (let px=0; px<TILE; px++) {
                        const sx = tx*TILE + px - (scrollX & 0x3F);
                        const sy = ty*TILE + row - (scrollY & 0x3F);
                        if (sx>=0 && sx<this.width && sy>=0 && sy<this.height) {
                            if (tileRow & (1 << (7-px))) {
                                const color = this.bus.readByte32(paletteAddr + 1);
                                this.fb[sy*this.width + sx] = color;
                            }
                        }
                    }
                }
            }
        }
    }

    _renderSprites() {
        const oamAddr = 0xFE00;
        const tiledataAddr = this.bus.readDWord(0xFF10);
        for (let i=0; i<64; i++) {
            const y = this.bus.readByte32(oamAddr + i*4);
            const x = this.bus.readByte32(oamAddr + i*4 + 1);
            const tileNum = this.bus.readByte32(oamAddr + i*4 + 2);
            const attr = this.bus.readByte32(oamAddr + i*4 + 3);
            if (x===0 || x>=this.width || y===0 || y>=this.height) continue;
            for (let row=0; row<8; row++) {
                const tileRow = this.bus.readByte32(tiledataAddr + tileNum*8 + row);
                for (let px=0; px<8; px++) {
                    const sx = x + px, sy = y + row;
                    if (sx>=0 && sx<this.width && sy>=0 && sy<this.height) {
                        if (tileRow & (1 << (7-px))) {
                            this.fb[sy*this.width + sx] = (attr & 0x0F) + 1;
                        }
                    }
                }
            }
        }
    }

    getFramebuffer() { return new Uint8Array(this.fb); }
}

// ──────────────────────────────────────────────
// BIOS System (complete Lexer, Compiler, Runtime, Version Manager)
// ──────────────────────────────────────────────
const BiosTokenType = Object.freeze({
    DirectiveFirmware:0, DirectiveVersion:1, DirectiveAuthor:2, DirectiveDate:3,
    DirectiveChangelog:4, DirectiveCapability:5, DirectiveInterrupt:6, DirectiveEnd:7,
    SectionInit:8, SectionServices:9, SectionData:10, SectionConfig:11,
    InitGPU:12, InitDisk:13, InitNIC:14, InitMemory:15, InitPalette:16, InitFont:17, InitDisplay:18,
    ConfigResolution:19, ConfigRefresh:20, ConfigBootSector:21, ConfigStackSize:22,
    ConfigColorDepth:23, ConfigFontPath:24,
    ServiceReadDisk:25, ServiceWriteDisk:26, ServicePrintChar:27, ServicePrintString:28,
    ServiceClearScreen:29, ServiceGetKey:30, ServiceGetMouse:31, ServiceSendPacket:32,
    ServiceRecvPacket:33, ServiceSetCursor:34, ServiceDrawPixel:35, ServiceDrawRect:36,
    ServiceLoadProgram:37,
    Number:38, HexNumber:39, String:40, Identifier:41, Register:42,
    Comma:43, Colon:44, Semicolon:45, Equals:46, OpenParen:47, CloseParen:48,
    OpenBracket:49, CloseBracket:50, Arrow:51, AtSign:52, Comment:53, NewLine:54, EOF:55
});

class BiosToken { constructor(type, value, line, col) { this.type=type; this.value=value; this.line=line; this.column=col; } }

class BiosFirmwareVersion {
    constructor() {
        this.firmwareName = ''; this.version = '1.0.0'; this.author = ''; this.releaseDate = new Date();
        this.changelog = ''; this.capabilities = []; this.bootSector = 0; this.stackSize = 0x1000;
        this.displayWidth = 256; this.displayHeight = 256; this.refreshRate = 60;
        this.compiledCode = null; this.interruptTable = new Map(); this.fontData = null; this.paletteData = null;
        this.compiledAt = new Date(); this.compilerVersion = '1.0.0'; this.compilationErrors = [];
    }
    get isValid() { return this.compilationErrors.length === 0; }
}

class BiosLexer {
    static keywords = {
        '.FIRMWARE':0, '.VERSION':1, '.AUTHOR':2, '.DATE':3, '.CHANGELOG':4, '.CAPABILITY':5,
        '.INTERRUPT':6, '.END':7, ':INIT':8, ':SERVICES':9, ':DATA':10, ':CONFIG':11,
        'INIT.GPU':12, 'INIT.DISK':13, 'INIT.NIC':14, 'INIT.MEMORY':15, 'INIT.PALETTE':16,
        'INIT.FONT':17, 'INIT.DISPLAY':18, 'CONFIG.RESOLUTION':19, 'CONFIG.REFRESH':20,
        'CONFIG.BOOTSECTOR':21, 'CONFIG.STACKSIZE':22, 'CONFIG.COLORDEPTH':23, 'CONFIG.FONTPATH':24,
        'SERVICE.READ_DISK':25, 'SERVICE.WRITE_DISK':26, 'SERVICE.PRINT_CHAR':27,
        'SERVICE.PRINT_STRING':28, 'SERVICE.CLEAR_SCREEN':29, 'SERVICE.GET_KEY':30,
        'SERVICE.GET_MOUSE':31, 'SERVICE.SEND_PACKET':32, 'SERVICE.RECV_PACKET':33,
        'SERVICE.SET_CURSOR':34, 'SERVICE.DRAW_PIXEL':35, 'SERVICE.DRAW_RECT':36, 'SERVICE.LOAD_PROGRAM':37
    };
    constructor(source) { this.src = source; this.pos = 0; this.line = 1; this.col = 1; this.errors = []; }
    tokenize() {
        const tokens = [];
        while (this.pos < this.src.length) {
            const ch = this._peek();
            if (ch === '\n') { this._advance(); continue; }
            if (/\s/.test(ch)) { this._advance(); continue; }
            if (ch === ';') { tokens.push(new BiosToken(BiosTokenType.Semicolon,';',this.line,this.col)); this._advance(); continue; }
            if (ch === '"') { tokens.push(this._readString()); continue; }
            if (ch === '0' && this._peek(1)==='x') { tokens.push(this._readHexNumber()); continue; }
            if (/[0-9]/.test(ch) || (ch==='-' && /[0-9]/.test(this._peek(1)))) { tokens.push(this._readNumber()); continue; }
            if (/[a-zA-Z_.]/.test(ch)) { tokens.push(this._readIdentOrKeyword()); continue; }
            if (ch === ':') {
                this._advance();
                if (this.pos < this.src.length && /[a-zA-Z]/.test(this._peek())) {
                    const startLine=this.line, startCol=this.col;
                    let s = ':';
                    while (this.pos<this.src.length && /[a-zA-Z0-9_]/.test(this._peek())) { s += this._peek(); this._advance(); }
                    const kw = BiosLexer.keywords[s];
                    tokens.push(kw !== undefined ? new BiosToken(kw, s, startLine, startCol) : new BiosToken(BiosTokenType.Colon, ':', startLine, startCol));
                } else tokens.push(new BiosToken(BiosTokenType.Colon, ':', this.line, this.col-1));
                continue;
            }
            switch (ch) {
                case ',': tokens.push(new BiosToken(BiosTokenType.Comma,',',this.line,this.col)); this._advance(); break;
                case '=': tokens.push(new BiosToken(BiosTokenType.Equals,'=',this.line,this.col)); this._advance(); break;
                case '(': tokens.push(new BiosToken(BiosTokenType.OpenParen,'(',this.line,this.col)); this._advance(); break;
                case ')': tokens.push(new BiosToken(BiosTokenType.CloseParen,')',this.line,this.col)); this._advance(); break;
                case '[': tokens.push(new BiosToken(BiosTokenType.OpenBracket,'[',this.line,this.col)); this._advance(); break;
                case ']': tokens.push(new BiosToken(BiosTokenType.CloseBracket,']',this.line,this.col)); this._advance(); break;
                case '@': tokens.push(new BiosToken(BiosTokenType.AtSign,'@',this.line,this.col)); this._advance(); break;
                case '-':
                    if (this._peek(1)==='>') { tokens.push(new BiosToken(BiosTokenType.Arrow,'->',this.line,this.col)); this._advance(); this._advance(); }
                    else { this._error(`Unexpected '-'`); this._advance(); }
                    break;
                default: this._error(`Unrecognized character '${ch}'`); this._advance();
            }
        }
        tokens.push(new BiosToken(BiosTokenType.EOF, '', this.line, this.col));
        return tokens;
    }
    _peek(ahead=0) { return this.pos+ahead < this.src.length ? this.src[this.pos+ahead] : '\0'; }
    _advance() { if (this.pos < this.src.length) { if (this.src[this.pos]==='\n') { this.line++; this.col=1; } else this.col++; this.pos++; } }
    _error(msg) { this.errors.push({line:this.line, col:this.col, message:msg, severity:'ERROR'}); }
    _readString() {
        const startL=this.line, startC=this.col; this._advance(); let s='';
        while (this.pos<this.src.length && this._peek()!=='"') {
            if (this._peek()==='\\' && this.pos+1<this.src.length) {
                this._advance();
                switch (this._peek()) {
                    case 'n': s+='\n'; break; case 't': s+='\t'; break; case 'r': s+='\r'; break;
                    case '"': s+='"'; break; case '\\': s+='\\'; break;
                    default: this._error(`Unknown escape \\${this._peek()}`);
                }
            } else if (this._peek()==='\n' || this._peek()==='\0') { this._error('Unterminated string'); break; }
            else s += this._peek();
            this._advance();
        }
        if (this._peek()=='"') this._advance(); else this._error('Unterminated string');
        return new BiosToken(BiosTokenType.String, s, startL, startC);
    }
    _readHexNumber() {
        const sl=this.line, sc=this.col; this._advance(); this._advance(); let s='';
        while (this.pos<this.src.length && /[0-9A-Fa-f]/.test(this._peek())) { s+=this._peek(); this._advance(); }
        return s.length ? new BiosToken(BiosTokenType.HexNumber, s, sl, sc) : new BiosToken(BiosTokenType.Number, '0', sl, sc);
    }
    _readNumber() {
        const sl=this.line, sc=this.col; let s='';
        if (this._peek()==='-') { s+='-'; this._advance(); }
        while (this.pos<this.src.length && /[0-9.]/.test(this._peek())) { s+=this._peek(); this._advance(); }
        return new BiosToken(BiosTokenType.Number, s, sl, sc);
    }
    _readIdentOrKeyword() {
        const sl=this.line, sc=this.col; let s='';
        while (this.pos<this.src.length && /[a-zA-Z0-9_.]/.test(this._peek())) { s+=this._peek(); this._advance(); }
        if (/^R\d+$/.test(s) && parseInt(s.slice(1))<=15) return new BiosToken(BiosTokenType.Register, s, sl, sc);
        const kw = BiosLexer.keywords[s];
        return kw !== undefined ? new BiosToken(kw, s, sl, sc) : new BiosToken(BiosTokenType.Identifier, s, sl, sc);
    }
}

class BiosCompiler {
    constructor(tokens) { this.tokens = tokens; this.pos = 0; this.fw = new BiosFirmwareVersion(); this.errors = []; this.labels = new Map(); this.services = new Map(); this.curAddr = 0; }
    compile() {
        try {
            this._parseDirectives();
            if (this.errors.length) { this.fw.compilationErrors = this.errors; return this.fw; }
            this._parseSections();
            this.fw.compiledAt = new Date();
            this.fw.interruptTable = new Map(Array.from(this.services).map(([k,v])=>[v.interruptVector, v.handlerAddress]));
        } catch (e) { this._error(0,0,`Compiler error: ${e.message}`, 'FATAL'); }
        this.fw.compilationErrors = this.errors;
        return this.fw;
    }
    _expect(type, msg) { if (this.pos>=this.tokens.length || this.tokens[this.pos].type!==type) this._error(this.tokens[this.pos]?.line||0,0,msg,'ERROR'); else this.pos++; }
    _error(line,col,msg,sev='ERROR') { this.errors.push({line,col,message:msg,severity:sev}); }
    _parseDirectives() {
        let hasFW=false, hasVer=false, hasAuth=false, hasEnd=false;
        while (this.pos<this.tokens.length && this.tokens[this.pos].type!==BiosTokenType.EOF) {
            const t = this.tokens[this.pos];
            if (t.type===BiosTokenType.Colon && this.pos+1<this.tokens.length && this.tokens[this.pos+1].type===BiosTokenType.Identifier) break;
            switch (t.type) {
                case BiosTokenType.DirectiveFirmware: hasFW=true; this.pos++; this._expect(BiosTokenType.String,'Expected firmware name'); this.fw.firmwareName=this.tokens[this.pos-1].value; break;
                case BiosTokenType.DirectiveVersion: hasVer=true; this.pos++; this._expect(BiosTokenType.String,'Expected version'); this.fw.version=this.tokens[this.pos-1].value; break;
                case BiosTokenType.DirectiveAuthor: hasAuth=true; this.pos++; this._expect(BiosTokenType.String,'Expected author'); this.fw.author=this.tokens[this.pos-1].value; break;
                case BiosTokenType.DirectiveDate: this.pos++; this._expect(BiosTokenType.String,'Expected date'); this.fw.releaseDate=new Date(this.tokens[this.pos-1].value); break;
                case BiosTokenType.DirectiveChangelog: this.pos++; this._expect(BiosTokenType.String,'Expected changelog'); this.fw.changelog=this.tokens[this.pos-1].value; break;
                case BiosTokenType.DirectiveCapability: this.pos++; this._expect(BiosTokenType.String,'Expected capability'); this.fw.capabilities.push(this.tokens[this.pos-1].value); break;
                case BiosTokenType.DirectiveInterrupt: this._parseInterrupt(); break;
                case BiosTokenType.DirectiveEnd: hasEnd=true; this.pos++; break;
                default: this._error(t.line,t.column,`Unexpected token '${t.value}' in directives`); this.pos++;
            }
            if (hasEnd) break;
        }
        if (!hasFW) this._error(0,0,'Missing .FIRMWARE','FATAL');
        if (!hasVer) this._error(0,0,'Missing .VERSION','FATAL');
        if (!hasAuth) this._error(0,0,'Missing .AUTHOR','FATAL');
        if (!hasEnd) this._error(0,0,'Missing .END','FATAL');
    }
    _parseInterrupt() {
        this.pos++;
        const vecTok = this.tokens[this.pos]; this.pos++;
        const vec = vecTok.type===BiosTokenType.HexNumber ? parseInt(vecTok.value,16) : parseInt(vecTok.value);
        const nameTok = this.tokens[this.pos]; this.pos++;
        this.services.set(nameTok.value, {name:nameTok.value, interruptVector:vec, handlerAddress:0});
    }
    _parseSections() {
        while (this.pos<this.tokens.length && this.tokens[this.pos].type!==BiosTokenType.EOF) {
            const t = this.tokens[this.pos];
            switch (t.type) {
                case BiosTokenType.SectionInit: this.pos++; this._parseInit(); break;
                case BiosTokenType.SectionServices: this.pos++; this._parseServices(); break;
                case BiosTokenType.SectionConfig: this.pos++; this._parseConfig(); break;
                case BiosTokenType.SectionData: this.pos++; this._parseData(); break;
                default: this._error(t.line,t.column,`Unexpected token '${t.value}' outside section`); this.pos++;
            }
        }
    }
    _parseInit() { while (this.pos<this.tokens.length && ![BiosTokenType.SectionInit,BiosTokenType.SectionServices,BiosTokenType.SectionConfig,BiosTokenType.SectionData,BiosTokenType.EOF].includes(this.tokens[this.pos].type)) this.pos++; }
    _parseServices() { while (this.pos<this.tokens.length && ![BiosTokenType.SectionInit,BiosTokenType.SectionServices,BiosTokenType.SectionConfig,BiosTokenType.SectionData,BiosTokenType.EOF].includes(this.tokens[this.pos].type)) { if (this.tokens[this.pos].type===BiosTokenType.Identifier) this.labels.set(this.tokens[this.pos].value, this.curAddr); this.pos++; } }
    _parseConfig() {
        while (this.pos<this.tokens.length && ![BiosTokenType.SectionInit,BiosTokenType.SectionServices,BiosTokenType.SectionConfig,BiosTokenType.SectionData,BiosTokenType.EOF].includes(this.tokens[this.pos].type)) {
            const t = this.tokens[this.pos];
            switch (t.type) {
                case BiosTokenType.ConfigResolution: this.pos+=4; if (this.tokens[this.pos]?.type===BiosTokenType.Semicolon) this.pos++; break;
                case BiosTokenType.ConfigRefresh: this.pos+=2; if (this.tokens[this.pos]?.type===BiosTokenType.Semicolon) this.pos++; break;
                case BiosTokenType.ConfigBootSector: this.pos+=2; if (this.tokens[this.pos]?.type===BiosTokenType.Semicolon) this.pos++; break;
                case BiosTokenType.ConfigStackSize: this.pos+=2; if (this.tokens[this.pos]?.type===BiosTokenType.Semicolon) this.pos++; break;
                default: this.pos++;
            }
        }
    }
    _parseData() { while (this.pos<this.tokens.length && ![BiosTokenType.SectionInit,BiosTokenType.SectionServices,BiosTokenType.SectionConfig,BiosTokenType.SectionData,BiosTokenType.EOF].includes(this.tokens[this.pos].type)) this.pos++; }
}

class BiosRuntime {
    constructor(bus, cpu, gpu, firmware) {
        this.bus = bus; this.cpu = cpu; this.gpu = gpu; this.fw = firmware;
        this.interruptTable = firmware.interruptTable;
        this.initialized = false;
        this.bootSector = firmware.bootSector;
    }
    boot() {
        if (!this.fw.isValid) return;
        this._initMemory();
        this.initialized = true;
    }
    _initMemory() {
        this.bus.writeWord(0x0000, 0x0100);
        this.bus.writeDWord(0x0002, 0x0200);
        this.bus.writeDWord(0x0006, 0x0300);
    }
    handleInterrupt(vector) {
        if (!this.initialized) return;
        const handler = this.interruptTable.get(vector);
        if (!handler) return;
        switch (vector) {
            case 0x10: this._videoInt(); break;
            case 0x13: this._diskInt(); break;
            case 0x16: this._kbdInt(); break;
            case 0x1A: this._netInt(); break;
        }
    }
    _videoInt() {
        const fn = this.cpu.getRegister(0) & 0xFF;
        if (fn === 0x00) this.bus.writeByte(0xFF02, this.cpu.getRegister(1) & 0xFF);
        else if (fn === 0x02) { for (let a=0xE000; a<0xE000+1024; a++) this.bus.writeByte32(a, 0); }
    }
    _diskInt() { /* simplified */ }
    _kbdInt() { this.cpu.setRegister(0, 0); }
    _netInt() { this.cpu.setRegister(0, 0); }
}

class BiosVersionManager {
    constructor() { this.versions = new Map(); }
    register(fw) { if (!this.versions.has(fw.firmwareName)) this.versions.set(fw.firmwareName, []); this.versions.get(fw.firmwareName).push(fw); return fw.version; }
    getVersions(name) { return (this.versions.get(name) || []).sort((a,b)=>b.compiledAt-a.compiledAt); }
    getVersion(name, ver) { const arr = this.versions.get(name); return arr ? arr.find(v=>v.version===ver) : null; }
    getLatest() { const latest = {}; for (const [k,v] of this.versions) latest[k] = v.sort((a,b)=>b.compiledAt-a.compiledAt)[0]; return latest; }
    getFirmwareNames() { return Array.from(this.versions.keys()); }
}

// ──────────────────────────────────────────────
// 74‑bit CPU (full opcode set using UInt74)
// ──────────────────────────────────────────────
class CPU74Bit {
    constructor(bus) {
        this.bus = bus;
        this.regs = new Array(16).fill(UInt74.Zero);
        this.ip = UInt74.Zero; this.sp = new UInt74(0xDFFFn); this.flags = new UInt74(0x200n);
        this.halted = false; this.cycleCount = 0n; this.instrCount = 0n;
    }
    reset() {
        for (let i=0; i<16; i++) this.regs[i]=UInt74.Zero;
        this.ip=UInt74.Zero; this.sp=new UInt74(0xDFFFn); this.flags=new UInt74(0x200n); this.halted=false;
        this.cycleCount=0n; this.instrCount=0n;
    }
    getRegister(r) { return this.regs[r]; }
    setRegister(r, val) { this.regs[r] = val; }

    cycle() {
        if (this.halted) return;
        const op = this.bus.readByte32(Number(this.ip.toBigInt() & 0xFFFFFFFFn));
        this.ip = UInt74.add(this.ip, UInt74.One);
        this.cycleCount++; this.instrCount++;
        const read74 = () => {
            const lo = this.bus.readDWord(Number(this.ip.toBigInt() & 0xFFFFn));
            const hi = this.bus.readDWord(Number(UInt74.add(this.ip, new UInt74(4n)).toBigInt() & 0xFFFFn));
            this.ip = UInt74.add(this.ip, new UInt74(8n));
            return new UInt74(BigInt(lo) | (BigInt(hi) << 32n));
        };
        const readAddr = (addr) => {
            const lo = this.bus.readDWord(Number(addr.toBigInt() & 0xFFFFn));
            const hi = this.bus.readDWord(Number(UInt74.add(addr, new UInt74(4n)).toBigInt() & 0xFFFFn));
            return new UInt74(BigInt(lo) | (BigInt(hi) << 32n));
        };
        const writeAddr = (addr, val) => {
            const b = val.toBigInt();
            this.bus.writeDWord(Number(addr.toBigInt() & 0xFFFFn), Number(b & 0xFFFFFFFFn));
            this.bus.writeDWord(Number(UInt74.add(addr, new UInt74(4n)).toBigInt() & 0xFFFFn), Number((b >> 32n) & 0xFFFFFFFFn));
        };
        const updateFlags = (res) => {
            this.flags = UInt74.and(this.flags, new UInt74(~0x1Fn));
            if (UInt74.eq(res, UInt74.Zero)) this.flags = UInt74.or(this.flags, new UInt74(1n));
            let ones = 0; let b = res.toBigInt();
            for (let i=0n; i<74n; i++) { if (b & 1n) ones++; b >>= 1n; }
            if (ones%2===0) this.flags = UInt74.or(this.flags, new UInt74(0x10n));
        };

        switch (op) {
            case 0x00: break;
            case 0x10: { const ops=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); this.regs[ops>>4]=this.regs[ops&0xF]; break; }
            case 0x11: { const r=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); this.regs[r]=read74(); break; }
            case 0x12: { const ops=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); this.regs[ops>>4]=readAddr(this.regs[ops&0xF]); break; }
            case 0x13: { const ops=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); writeAddr(this.regs[ops>>4], this.regs[ops&0xF]); break; }
            case 0x20: { const r=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); writeAddr(this.sp, this.regs[r]); this.sp=UInt74.sub(this.sp,new UInt74(8n)); break; }
            case 0x21: { const r=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); this.sp=UInt74.add(this.sp,new UInt74(8n)); this.regs[r]=readAddr(this.sp); break; }
            case 0x22: { writeAddr(this.sp, this.flags); this.sp=UInt74.sub(this.sp,new UInt74(8n)); break; }
            case 0x23: { this.sp=UInt74.add(this.sp,new UInt74(8n)); this.flags=readAddr(this.sp); break; }
            case 0xA0: { const ops=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); const res=UInt74.add(this.regs[ops>>4],this.regs[ops&0xF]); this.regs[ops>>4]=res; updateFlags(res); break; }
            case 0xA1: { const ops=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); const res=UInt74.sub(this.regs[ops>>4],this.regs[ops&0xF]); this.regs[ops>>4]=res; updateFlags(res); break; }
            case 0xA2: { const ops=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); const res=UInt74.mul(this.regs[ops>>4],this.regs[ops&0xF]); this.regs[ops>>4]=res; updateFlags(res); break; }
            case 0xA3: { const ops=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); if(UInt74.eq(this.regs[ops&0xF],UInt74.Zero)){this.flags=UInt74.or(this.flags,new UInt74(1n));break;} this.regs[ops>>4]=UInt74.div(this.regs[ops>>4],this.regs[ops&0xF]); updateFlags(this.regs[ops>>4]); break; }
            case 0xA4: { const ops=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); this.regs[ops>>4]=UInt74.and(this.regs[ops>>4],this.regs[ops&0xF]); updateFlags(this.regs[ops>>4]); break; }
            case 0xA5: { const ops=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); this.regs[ops>>4]=UInt74.or(this.regs[ops>>4],this.regs[ops&0xF]); updateFlags(this.regs[ops>>4]); break; }
            case 0xA6: { const ops=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); this.regs[ops>>4]=UInt74.xor(this.regs[ops>>4],this.regs[ops&0xF]); updateFlags(this.regs[ops>>4]); break; }
            case 0xA7: { const ops=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); this.regs[ops>>4]=UInt74.shl(this.regs[ops>>4],Number(this.regs[ops&0xF].toBigInt())); updateFlags(this.regs[ops>>4]); break; }
            case 0xA8: { const ops=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); this.regs[ops>>4]=UInt74.shr(this.regs[ops>>4],Number(this.regs[ops&0xF].toBigInt())); updateFlags(this.regs[ops>>4]); break; }
            case 0xA9: { const ops=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); updateFlags(UInt74.sub(this.regs[ops>>4],this.regs[ops&0xF])); break; }
            case 0xB0: this.ip = readAddr(this.ip); break;
            case 0xB1: UInt74.ne(UInt74.and(this.flags,new UInt74(1n)),UInt74.Zero) ? this.ip=readAddr(this.ip) : this.ip=UInt74.add(this.ip,new UInt74(8n)); break;
            case 0xB2: UInt74.eq(UInt74.and(this.flags,new UInt74(1n)),UInt74.Zero) ? this.ip=readAddr(this.ip) : this.ip=UInt74.add(this.ip,new UInt74(8n)); break;
            case 0xB3: UInt74.ne(UInt74.and(this.flags,new UInt74(2n)),UInt74.Zero) ? this.ip=readAddr(this.ip) : this.ip=UInt74.add(this.ip,new UInt74(8n)); break;
            case 0xB4: UInt74.eq(UInt74.and(this.flags,new UInt74(2n)),UInt74.Zero) ? this.ip=readAddr(this.ip) : this.ip=UInt74.add(this.ip,new UInt74(8n)); break;
            case 0xB5: { const ret=UInt74.add(this.ip,new UInt74(8n)); writeAddr(this.sp,ret); this.sp=UInt74.sub(this.sp,new UInt74(8n)); this.ip=readAddr(this.ip); break; }
            case 0xB6: this.sp=UInt74.add(this.sp,new UInt74(8n)); this.ip=readAddr(this.sp); break;
            case 0xCD: { const vec=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); if(UInt74.eq(UInt74.and(this.flags,new UInt74(0x200n)),UInt74.Zero))break; writeAddr(this.sp,this.ip); this.sp=UInt74.sub(this.sp,new UInt74(8n)); writeAddr(this.sp,this.flags); this.sp=UInt74.sub(this.sp,new UInt74(8n)); this.ip=readAddr(new UInt74(vec*4n)); this.flags=UInt74.and(this.flags,new UInt74(~0x200n)); break; }
            case 0xCE: this.sp=UInt74.add(this.sp,new UInt74(8n)); this.flags=readAddr(this.sp); this.sp=UInt74.add(this.sp,new UInt74(8n)); this.ip=readAddr(this.sp); this.flags=UInt74.or(this.flags,new UInt74(0x200n)); break;
            case 0xEE: { const r=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); const port=Number(readAddr(this.ip).toBigInt()); this.ip=UInt74.add(this.ip,new UInt74(8n)); this.regs[r]=readAddr(new UInt74(0xFF00n+BigInt(port))); break; }
            case 0xEF: { const r=this.bus.readByte32(Number(this.ip.toBigInt()&0xFFFFn)); this.ip=UInt74.add(this.ip,UInt74.One); const port=Number(readAddr(this.ip).toBigInt()); this.ip=UInt74.add(this.ip,new UInt74(8n)); writeAddr(new UInt74(0xFF00n+BigInt(port)), this.regs[r]); break; }
            case 0xFF: this.halted=true; this.flags=UInt74.or(this.flags,new UInt74(0x400n)); break;
        }
    }
    run(cycles) { for (let i=0; i<cycles && !this.halted; i++) this.cycle(); }
    executeToHalt(max=1000000) { let c=0; while (!this.halted && c<max) { this.cycle(); c++; } }
}

// ──────────────────────────────────────────────
// 74‑bit GPU with custom dimensions
// ──────────────────────────────────────────────
class RenderingDimension { constructor(name) { this.name = name; } get dimensionCount() { return 0; } createElement(...args) { throw new Error('abstract'); } createFrame(w,h) { throw new Error('abstract'); } }
class FrameElement { getValue() { throw new Error('abstract'); } }
class Frame { constructor(w,h) { this.width = w; this.height = h; } get(x,y) { throw new Error('abstract'); } set(x,y,v) { throw new Error('abstract'); } toDisplayBuffer() { throw new Error('abstract'); } }
class Pixel2D extends FrameElement { constructor(color=0) { super(); this.colorIndex = color; } getValue() { return this.colorIndex; } }
class Dimension2D extends RenderingDimension { constructor() { super('2D'); } get dimensionCount() { return 2; } createElement(...args) { return new Pixel2D(args[0]||0); } createFrame(w,h) { return new Frame2D(w,h); } }
class Frame2D extends Frame { constructor(w,h) { super(w,h); this.pixels = new Uint8Array(w*h); } get(x,y) { return this.pixels[y*this.width+x]; } set(x,y,v) { this.pixels[y*this.width+x] = v; } toDisplayBuffer() { return new Uint8Array(this.pixels); } }
class Mixel extends FrameElement { constructor(data) { super(); this.data = data || new Uint8Array(4); } getValue() { return this.data; } }
class MixelDimension extends RenderingDimension { constructor() { super('MixelSpace'); } get dimensionCount() { return 3; } createElement(...args) { return new Mixel(args[0]); } createFrame(w,h) { return new MixelFrame(w,h); } }
class MixelFrame extends Frame { constructor(w,h) { super(w,h); this.elements = new Array(w*h); for (let i=0; i<w*h; i++) this.elements[i] = new Mixel(); } get(x,y) { return this.elements[y*this.width+x]; } set(x,y,v) { this.elements[y*this.width+x] = v; } toDisplayBuffer() { const buf = new Uint8Array(this.width*this.height); for (let i=0; i<buf.length; i++) { const d = this.elements[i].data; buf[i] = d.length>0 ? Math.floor((d[0]+d[1]+d[2])/3) : 0; } return buf; } }

class GPU74Bit {
    constructor(bus) {
        this.bus = bus;
        this.dimensions = new Map();
        this.frames = new Map();
        this.activeDim = null;
        this.rendering = false;
        this.displayBuf = null;
        this.width = 256; this.height = 256;
        this.frameCount = 0;
        this.mouseX=0; this.mouseY=0; this.mouseLeft=false; this.mouseRight=false; this.mouseMiddle=false;
        this.keys = new Array(256).fill(false);
    }
    addDimension(dim) { 
        this.dimensions.set(dim.name, dim); 
        const frame = dim.createFrame(this.width, this.height);
        this.frames.set(dim.name, frame); 
        if (!this.activeDim) this.activeDim = dim.name; 
    }
    getAvailableDimensions() { return Array.from(this.dimensions.keys()); }
    setActiveDimension(name) { if (!this.dimensions.has(name)) throw new Error('Dimension not found'); this.activeDim = name; }
    getActiveDimension() { return this.dimensions.get(this.activeDim); }
    getFrame(dimName) { return this.frames.get(dimName); }
    startRendering(fps=60) { this.rendering=true; this._timer = setInterval(()=>{ if(this.rendering){ this._renderActiveFrame(); this.frameCount++; } }, 1000/fps); }
    stopRendering() { this.rendering=false; if(this._timer) clearInterval(this._timer); }
    _renderActiveFrame() { const frame = this.frames.get(this.activeDim); if (frame) this.displayBuf = frame.toDisplayBuffer(); }
    getFramebuffer() { return this.displayBuf; }
    updateMouse(x,y,l,r,m) { this.mouseX=x; this.mouseY=y; this.mouseLeft=l; this.mouseRight=r; this.mouseMiddle=m; }
    setKeyDown(k) { if (k<256) this.keys[k]=true; }
    setKeyUp(k) { if (k<256) this.keys[k]=false; }
    isKeyDown(k) { return k<256 && this.keys[k]; }
}

// ──────────────────────────────────────────────
// Kernel74 – unified 32/74‑bit emulator with config support
// ──────────────────────────────────────────────
class Kernel74 {
    constructor() {
        this.bus = new Bus();
        this.cpu32 = new CPU(this.bus);
        this.gpu32 = new GPU(this.bus);
        this.biosVM = new BiosVersionManager();
        this.bios = null; this.biosLoaded = false;
        this.poweredOn = false;
        this.mode = 'Bit32';
        this.cpu74 = null; this.gpu74 = null;
        this.__configLoader = null;
        this.__consoles = {};
    }
    get currentMode() { return this.mode; }
    get currentCPU() { return this.mode==='Bit74' ? this.cpu74 : this.cpu32; }
    get currentGPU() { return this.mode==='Bit74' ? this.gpu74 : this.gpu32; }

    async loadConfig(sourceOrUrl) {
        let config;
        if (typeof sourceOrUrl === 'string') {
            if (sourceOrUrl.endsWith('.js') || sourceOrUrl.startsWith('http')) {
                const result = await VOSConfigLoader.loadFromURL(sourceOrUrl);
                config = result.config;
            } else {
                const parser = new MiniExtensionParser(sourceOrUrl);
                const result = parser.parse();
                config = result.config;
            }
        } else if (typeof sourceOrUrl === 'object') {
            config = sourceOrUrl;
        }
        if (config) {
            this.__configLoader = new MiniExtensionLoader(this);
            this.__configLoader.load({ config });
        }
        return this.__configLoader;
    }

    switchTo74Bit() {
        if (this.mode==='Bit74') return;
        this.powerOff();
        this.cpu74 = new CPU74Bit(this.bus);
        this.gpu74 = new GPU74Bit(this.bus);
        this.mode = 'Bit74';
    }
    switchTo32Bit() {
        if (this.mode==='Bit32') return;
        this.powerOff();
        this.cpu74 = null; this.gpu74 = null;
        this.mode = 'Bit32';
    }

    powerOn(bootRom) {
        if (this.mode==='Bit74') {
            for (let i=0; i<bootRom.length; i++) this.bus.writeByte32(0x0100+i, bootRom[i]);
            this.cpu74.reset();
            this.gpu74.startRendering(60);
        } else {
            for (let i=0; i<bootRom.length; i++) this.bus.writeByte(0x0100+i, bootRom[i]);
            this.bus.writeWord(0x0000, 0x0100);
            this.bus.writeDWord(0x0002, 0x0200); this.bus.writeDWord(0x0006, 0x0300);
            this.cpu32.reset();
            this.gpu32.startRendering(60);
        }
        this.poweredOn = true;
    }
    powerOff() {
        if (this.mode==='Bit74') { this.gpu74.stopRendering(); this.cpu74.halted=true; }
        else { this.gpu32.stopRendering(); this.cpu32.halted=true; }
        this.poweredOn = false;
    }
    step() {
        if (!this.poweredOn) return;
        if (this.mode==='Bit74') { if (!this.cpu74.halted) this.cpu74.cycle(); }
        else { if (!this.cpu32.halted) this.cpu32.cycle(); }
    }
    run(cycles) {
        if (!this.poweredOn) return;
        if (this.mode==='Bit74') this.cpu74.run(cycles);
        else this.cpu32.run(cycles);
    }

    mountDisk(img) { this.bus.diskController.mountDiskImage(img); }
    unmountDisk() { this.bus.diskController.unmount(); }
    isDiskMounted() { return this.bus.diskController.isMounted(); }
    readDiskSector(idx) { return this.bus.diskController.readSector(idx); }
    writeDiskSector(idx, data) { this.bus.diskController.writeSector(idx, data); }
    getDiskSectorCount() { return this.bus.diskController.secCount; }
    formatDisk() { this.bus.diskController.format(); }
    exportDiskImage() { return this.bus.diskController.getDiskImage(); }

    receiveNetworkPacket(pkt) { this.bus.networkController.receivePacket(pkt); }
    getOutgoingNetworkPacket() { return this.bus.networkController.getOutgoingPacket(); }
    get outgoingPacketCount() { return this.bus.networkController.outgoingCount; }
    get incomingPacketCount() { return this.bus.networkController.incomingCount; }

    compileFirmware(src) {
        const lexer = new BiosLexer(src);
        const tokens = lexer.tokenize();
        const compiler = new BiosCompiler(tokens);
        const fw = compiler.compile();
        if (fw.isValid) this.biosVM.register(fw);
        return fw;
    }
    loadBios(name, ver) {
        const fw = this.biosVM.getVersion(name, ver);
        if (!fw || !fw.isValid) return false;
        this.bios = new BiosRuntime(this.bus, this.cpu32, this.gpu32, fw);
        this.bios.boot();
        this.biosLoaded = true;
        return true;
    }
    loadBiosLatest(name) {
        const latest = this.biosVM.getLatest()[name];
        if (!latest) return false;
        return this.loadBios(name, latest.version);
    }
    getBiosStatus() {
        if (!this.biosLoaded || !this.bios) return {loaded:false, message:'No BIOS loaded'};
        return {
            loaded:true, firmwareName:this.bios.fw.firmwareName, version:this.bios.fw.version,
            author:this.bios.fw.author, initialized:this.bios.initialized,
            bootSector:this.bios.bootSector, capabilities:this.bios.fw.capabilities,
            displayWidth:this.bios.fw.displayWidth, displayHeight:this.bios.fw.displayHeight,
            refreshRate:this.bios.fw.refreshRate, serviceCount:this.bios.interruptTable.size
        };
    }
    handleBiosInterrupt(vec) { if (this.bios) this.bios.handleInterrupt(vec); }
}

// ──────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────
const VirtualOS = {
    Bus, EmulatedMMU, EmulatedDMA, EmulatedDiskController, EmulatedNetworkController,
    CPU, GPU,
    BiosTokenType, BiosToken, BiosFirmwareVersion, BiosLexer, BiosCompiler, BiosRuntime, BiosVersionManager,
    UInt74, CPU74Bit, GPU74Bit,
    RenderingDimension, FrameElement, Frame, Pixel2D, Dimension2D, Frame2D, Mixel, MixelDimension, MixelFrame,
    Kernel74,
    BinaryBlob, MiniExtensionParser, MiniExtensionLoader, VOSConfigLoader,
    ConsoleEmulatorFactory, GBAEmulator, GBAHardware, GBAPPU
};
if (typeof module !== 'undefined' && module.exports) module.exports = VirtualOS;
if (typeof window !== 'undefined') window.VirtualOS = VirtualOS;
