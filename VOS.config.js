// VOS.config.js – Mini-Extension Configuration for VirtualOS
// Uses hybrid @JSON{}, @BINARY{}, and @JS{} syntax

@JSON{
{
  "name": "PowerUserExtension",
  "version": "1.0.0",
  "author": "VirtualOS User",
  "dimensions": [
    {
      "type": "2D",
      "customName": "DesktopCanvas"
    },
    {
      "type": "Mixel"
    },
    {
      "name": "BinaryWallpaper",
      "count": 2,
      "binaryData": "binary_0"
    }
  ],
  "frameElements": [
    {
      "name": "CustomPixel",
      "factory": "return class extends Pixel2D { constructor(c) { super(c); this.meta = 'custom'; } };"
    }
  ],
  "cpuExtensions": [
    {
      "opcode": 0xFE,
      "handler": "bus.writeByte(0xFF00, 0x42); regs[0] = (regs[0] || 0) + 1;"
    }
  ],
  "memoryMap": [
    {
      "address": 0x5000,
      "data": "SGVsbG8gV29ybGQh"
    }
  ],
  "ioDevices": [
    {
      "port": 0x10,
      "name": "DebugOutput",
      "handler": "if (isWrite) { console.log('IO Write Port 0x10:', value); } else { return 0xFF; }"
    }
  ]
}
}@

@BINARY{AQIDBAUG/////////////////////////////////////////////////w==}@

@JS{
// Post-processing: validate and extend config
if (config.dimensions) {
  config.dimensions.push({
    type: '2D',
    customName: 'JSGenerated_' + Date.now().toString(36)
  });
}

// Register additional frame elements dynamically
config.frameElements = config.frameElements || [];
config.frameElements.push({
  name: 'GlowPixel',
  factory: "return class extends Pixel2D { constructor(c) { super(c); this.glow = c * 2; } getValue() { return this.glow; } };"
});

// Set custom boot sector
config.bootSector = 0x2000;
}@
