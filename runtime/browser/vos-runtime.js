/* VOS Browser Hardware Runtime 2.0
 * High-throughput runtime for AOT VOS modules and raw V74 images.
 * No framework dependencies. ES2022 module.
 */
const KiB = 1024, MiB = 1024 * KiB, GiB = 1024 * MiB;
const u32 = x => Number(x) >>> 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class VOSMemory {
  constructor(logicalBytes = 4 * GiB, options = {}) {
    this.logicalBytes = Number(logicalBytes);
    this.segmentSize = options.segmentSize || MiB;
    this.hotBytes = Math.min(this.logicalBytes, (options.hotMemoryMB || 256) * MiB);
    const shared = options.shared !== false && typeof SharedArrayBuffer !== 'undefined';
    this.hotBuffer = shared ? new SharedArrayBuffer(this.hotBytes) : new ArrayBuffer(this.hotBytes);
    this.hot = new Uint8Array(this.hotBuffer);
    this.hotView = new DataView(this.hotBuffer);
    this.shared = shared;
    this.cold = new Map();
    this.reads = 0; this.writes = 0;
  }
  _check(addr, len = 1) { addr = Number(addr); if (!Number.isSafeInteger(addr) || addr < 0 || addr + len > this.logicalBytes) throw new RangeError(`VOS memory access out of range: ${addr}+${len}`); return addr; }
  _seg(addr, create) { const n = Math.floor(addr / this.segmentSize); let s = this.cold.get(n); if (!s && create) { s = new Uint8Array(this.segmentSize); this.cold.set(n, s); } return [s, addr - n * this.segmentSize]; }
  read8(addr) { addr=this._check(addr); this.reads++; if(addr<this.hotBytes)return this.hot[addr]; const [s,o]=this._seg(addr,false); return s?s[o]:0; }
  write8(addr,v) { addr=this._check(addr); this.writes++; if(addr<this.hotBytes){this.hot[addr]=v;return;} const[s,o]=this._seg(addr,true);s[o]=v; }
  read16(addr) { addr=this._check(addr,2);this.reads++;if(addr+2<=this.hotBytes)return this.hotView.getUint16(addr,true);return this.read8(addr)|(this.read8(addr+1)<<8); }
  write16(addr,v){addr=this._check(addr,2);this.writes++;if(addr+2<=this.hotBytes){this.hotView.setUint16(addr,v,true);return;}this.write8(addr,v);this.write8(addr+1,v>>8);}
  read32(addr){addr=this._check(addr,4);this.reads++;if(addr+4<=this.hotBytes)return this.hotView.getUint32(addr,true);return (this.read8(addr)|(this.read8(addr+1)<<8)|(this.read8(addr+2)<<16)|(this.read8(addr+3)<<24))>>>0;}
  write32(addr,v){addr=this._check(addr,4);this.writes++;v>>>=0;if(addr+4<=this.hotBytes){this.hotView.setUint32(addr,v,true);return;}for(let i=0;i<4;i++)this.write8(addr+i,v>>>(i*8));}
  read64(addr){const lo=BigInt(this.read32(addr)),hi=BigInt(this.read32(Number(addr)+4));return lo|(hi<<32n);}
  write64(addr,v){v=BigInt(v);this.write32(addr,Number(v&0xffffffffn));this.write32(Number(addr)+4,Number((v>>32n)&0xffffffffn));}
  read74(addr){return this.read64(addr)|(BigInt(this.read16(Number(addr)+8)&0x3ff)<<64n);}
  write74(addr,v){v=BigInt(v)&((1n<<74n)-1n);this.write64(addr,v);this.write16(Number(addr)+8,Number((v>>64n)&0x3ffn));}
  fill(addr,value,length){
    addr=this._check(addr,length); value&=255; let pos=0;
    while(pos<length){const a=addr+pos;if(a<this.hotBytes){const n=Math.min(length-pos,this.hotBytes-a);this.hot.fill(value,a,a+n);pos+=n;continue;}const [seg,off]=this._seg(a,true);const n=Math.min(length-pos,this.segmentSize-off);seg.fill(value,off,off+n);pos+=n;}this.writes+=length;
  }
  copy(src,dst,length){src=this._check(src,length);dst=this._check(dst,length);if(src+length<=this.hotBytes&&dst+length<=this.hotBytes){this.hot.copyWithin(dst,src,src+length);this.reads+=length;this.writes+=length;return;}const tmp=this.slice(src,length);this.write(dst,tmp);}
  slice(addr,length){
    addr=this._check(addr,length);const out=new Uint8Array(length);let pos=0;
    while(pos<length){const a=addr+pos;if(a<this.hotBytes){const n=Math.min(length-pos,this.hotBytes-a);out.set(this.hot.subarray(a,a+n),pos);pos+=n;continue;}const [seg,off]=this._seg(a,false);const n=Math.min(length-pos,this.segmentSize-off);if(seg)out.set(seg.subarray(off,off+n),pos);pos+=n;}this.reads+=length;return out;
  }
  write(addr,data){
    addr=this._check(addr,data.length);let pos=0;
    while(pos<data.length){const a=addr+pos;if(a<this.hotBytes){const n=Math.min(data.length-pos,this.hotBytes-a);this.hot.set(data.subarray(pos,pos+n),a);pos+=n;continue;}const [seg,off]=this._seg(a,true);const n=Math.min(data.length-pos,this.segmentSize-off);seg.set(data.subarray(pos,pos+n),off);pos+=n;}this.writes+=data.length;
  }
  stats(){return {logicalBytes:this.logicalBytes,hotBytes:this.hotBytes,coldSegments:this.cold.size,reads:this.reads,writes:this.writes,shared:this.shared};}
}

export class VOSMMU {
  constructor(memory, pageSize=4096){this.memory=memory;this.pageSize=pageSize;this.table=new Map();this.nextFrame=0;}
  map(virt,phys,size=this.pageSize,flags='rw-'){if(virt%this.pageSize||phys%this.pageSize||size%this.pageSize)throw new Error('unaligned MMU mapping');for(let o=0;o<size;o+=this.pageSize)this.table.set(Math.floor((virt+o)/this.pageSize),{phys:phys+o,flags});}
  unmap(virt,size=this.pageSize){for(let o=0;o<size;o+=this.pageSize)this.table.delete(Math.floor((virt+o)/this.pageSize));}
  translate(virt,write=false,execute=false){const page=Math.floor(virt/this.pageSize),off=virt%this.pageSize,m=this.table.get(page);if(!m)return virt;if(write&&!m.flags.includes('w'))throw new Error('MMU write protection fault');if(execute&&!m.flags.includes('x'))throw new Error('MMU execute protection fault');return m.phys+off;}
  read8(v){return this.memory.read8(this.translate(v));} write8(v,x){this.memory.write8(this.translate(v,true),x);}
  read32(v){return this.memory.read32(this.translate(v));} write32(v,x){this.memory.write32(this.translate(v,true),x);}
}

export class VOSDMA {
  constructor(memory){this.memory=memory;this.channels=Array.from({length:16},()=>({busy:false,bytes:0}));}
  async transfer(channel,src,dst,length){const c=this.channels[channel];if(!c)throw new Error('invalid DMA channel');if(c.busy)throw new Error('DMA channel busy');c.busy=true;try{const quantum=4*MiB;for(let o=0;o<length;o+=quantum){const n=Math.min(quantum,length-o);this.memory.write(dst+o,this.memory.slice(src+o,n));c.bytes+=n;if(length>quantum)await Promise.resolve();}}finally{c.busy=false;}}
  async fill(channel,dst,value,length){const c=this.channels[channel];if(!c||c.busy)throw new Error('DMA unavailable');c.busy=true;try{this.memory.fill(dst,value,length);c.bytes+=length;}finally{c.busy=false;}}
}

export class VOSInterruptController {
  constructor(){this.handlers=new Map();this.enabled=true;this.pending=[];this.delivered=0;}
  register(vector,name,handler){if(this.handlers.has(vector))throw new Error(`interrupt vector ${vector} already registered`);this.handlers.set(vector,{name,handler});}
  setEnabled(v){this.enabled=!!v;if(this.enabled)this.drain();}
  async raise(vector,payload){if(!this.enabled){this.pending.push([vector,payload]);return;}const h=this.handlers.get(vector);if(!h)throw new Error(`unhandled interrupt ${vector}`);this.delivered++;return await h.handler(payload);}
  async drain(){while(this.enabled&&this.pending.length){const[v,p]=this.pending.shift();await this.raise(v,p);}}
}

export class VOSDeviceBus {
  constructor(memory,interrupts){this.memory=memory;this.interrupts=interrupts;this.devices=new Map();this.hooks=new Map();this.defs=new Map();}
  _writeRaw(def,r,v){const addr=def.mmioBase+r.offset;if(r.type.includes('74'))this.memory.write74(addr,v);else if(r.type.includes('64'))this.memory.write64(addr,v);else if(r.type.includes('16'))this.memory.write16(addr,v);else if(r.type.includes('8'))this.memory.write8(addr,v);else this.memory.write32(addr,v);}
  _readRaw(def,r){const addr=def.mmioBase+r.offset;return r.type.includes('74')?this.memory.read74(addr):r.type.includes('64')?this.memory.read64(addr):r.type.includes('16')?this.memory.read16(addr):r.type.includes('8')?this.memory.read8(addr):this.memory.read32(addr);}
  install(def){const regs=new Map(def.registers.map(r=>[r.name,r]));const bus=this;this.defs.set(def.name,{def,regs});const proxy=new Proxy({__def:def},{get(target,p){if(p in target)return target[p];const r=regs.get(String(p));if(!r)return undefined;if(r.access==='wo')throw new Error(`${def.name}.${String(p)} is write-only`);const value=bus._readRaw(def,r);const h=bus.hooks.get(`${def.name}.${String(p)}`);return h?.read?h.read(value,r,proxy):value;},set(target,p,v){const r=regs.get(String(p));if(!r){target[p]=v;return true;}if(r.access==='ro')throw new Error(`${def.name}.${String(p)} is read-only`);bus._writeRaw(def,r,v);const h=bus.hooks.get(`${def.name}.${String(p)}`);if(h?.write)h.write(v,r,proxy);return true;}});for(const r of def.registers){if(r.reset!==undefined)this._writeRaw(def,r,r.reset);}this.devices.set(def.name,proxy);return proxy;}
  hook(device,register,handlers={}){this.hooks.set(`${device}.${register}`,handlers);return this;}
  poke(device,register,value){const x=this.defs.get(device);if(!x)throw new Error(`unknown device ${device}`);const r=x.regs.get(register);if(!r)throw new Error(`unknown register ${device}.${register}`);this._writeRaw(x.def,r,value);}
  peek(device,register){const x=this.defs.get(device);if(!x)throw new Error(`unknown device ${device}`);const r=x.regs.get(register);if(!r)throw new Error(`unknown register ${device}.${register}`);return this._readRaw(x.def,r);}
  get(name){const d=this.devices.get(name);if(!d)throw new Error(`unknown device ${name}`);return d;}
}

export class VOSDisk {
  constructor(sectors=131072){this.sectorSize=512;this.sectorCount=sectors;this.data=new Map();this.dirty=new Set();}
  readSector(n){if(n<0||n>=this.sectorCount)throw new RangeError('bad sector');const d=this.data.get(n);return d?d.slice():new Uint8Array(this.sectorSize);}
  writeSector(n,bytes){if(n<0||n>=this.sectorCount||bytes.length!==this.sectorSize)throw new RangeError('bad sector write');this.data.set(n,new Uint8Array(bytes));this.dirty.add(n);}
  mountImage(bytes){if(bytes.length%this.sectorSize)throw new Error('disk image must align to 512 bytes');this.sectorCount=bytes.length/this.sectorSize;this.data.clear();for(let i=0;i<this.sectorCount;i++){const s=bytes.subarray(i*512,(i+1)*512);if(s.some(v=>v!==0))this.data.set(i,s.slice());}}
  image(){const out=new Uint8Array(this.sectorCount*this.sectorSize);for(const[n,d]of this.data)out.set(d,n*512);return out;}
}

export class VOSNetwork {
  constructor(){this.socket=null;this.rx=[];this.tx=0;this.received=0;this.listeners=new Set();}
  connect(url,protocols){if(typeof WebSocket==='undefined')throw new Error('WebSocket is unavailable in this environment');this.socket=new WebSocket(url,protocols);this.socket.binaryType='arraybuffer';this.socket.onmessage=e=>{const b=new Uint8Array(e.data);this.rx.push(b);this.received+=b.length;for(const f of this.listeners)f(b);};return new Promise((res,rej)=>{this.socket.onopen=res;this.socket.onerror=rej;});}
  send(bytes){if(!this.socket||this.socket.readyState!==1)throw new Error('network socket is not connected');this.socket.send(bytes);this.tx+=bytes.byteLength;}
  receive(){return this.rx.shift()||null;}
  onPacket(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
}

export class VOSDisplay {
  constructor(runtime){this.runtime=runtime;this.canvas=null;this.ctx=null;this.width=0;this.height=0;this.frameAddr=0;this.frames=0;this.presentPending=false;this.lastPresent=0;this.vsync=true;}
  attach(canvas,width=1280,height=720,frameAddr=0x04000000){this.canvas=canvas;canvas.width=width;canvas.height=height;this.width=width;this.height=height;this.frameAddr=Number(frameAddr);this.ctx=canvas.getContext('2d',{alpha:false,desynchronized:true});if(!this.ctx)throw new Error('2D canvas unavailable');this.ctx.imageSmoothingEnabled=false;this.runtime.input?.attach(canvas);return this;}
  configure(width,height,frameAddr){if(width>0)this.width=Number(width);if(height>0)this.height=Number(height);if(frameAddr!==undefined)this.frameAddr=Number(frameAddr);if(this.canvas&&(this.canvas.width!==this.width||this.canvas.height!==this.height)){this.canvas.width=this.width;this.canvas.height=this.height;this.ctx=this.canvas.getContext('2d',{alpha:false,desynchronized:true});this.ctx.imageSmoothingEnabled=false;}}
  _presentNow(){if(!this.ctx||!this.runtime.memory)return;const bytes=this.runtime.memory.slice(this.frameAddr,this.width*this.height*4);const image=new ImageData(new Uint8ClampedArray(bytes.buffer,bytes.byteOffset,bytes.byteLength),this.width,this.height);this.ctx.putImageData(image,0,0);this.frames++;this.lastPresent=typeof performance!=='undefined'?performance.now():Date.now();this.presentPending=false;try{if(this.runtime.bus?.defs.has('SystemDisplay')){this.runtime.bus.poke('SystemDisplay','FRAME_COUNTER',this.frames>>>0);this.runtime.bus.poke('SystemDisplay','STATUS',1);}}catch{}}
  requestPresent(){if(!this.ctx)return;if(this.vsync&&typeof requestAnimationFrame==='function'){if(this.presentPending)return;this.presentPending=true;requestAnimationFrame(()=>this._presentNow());}else this._presentNow();}
  present(){this._presentNow();}
}


const VOS_GLYPHS = Object.freeze({
  ' ':['00000','00000','00000','00000','00000','00000','00000'],
  'A':['01110','10001','10001','11111','10001','10001','10001'],'B':['11110','10001','10001','11110','10001','10001','11110'],
  'C':['01111','10000','10000','10000','10000','10000','01111'],'D':['11110','10001','10001','10001','10001','10001','11110'],
  'E':['11111','10000','10000','11110','10000','10000','11111'],'F':['11111','10000','10000','11110','10000','10000','10000'],
  'G':['01111','10000','10000','10111','10001','10001','01111'],'H':['10001','10001','10001','11111','10001','10001','10001'],
  'I':['11111','00100','00100','00100','00100','00100','11111'],'J':['00111','00010','00010','00010','10010','10010','01100'],
  'K':['10001','10010','10100','11000','10100','10010','10001'],'L':['10000','10000','10000','10000','10000','10000','11111'],
  'M':['10001','11011','10101','10101','10001','10001','10001'],'N':['10001','11001','10101','10011','10001','10001','10001'],
  'O':['01110','10001','10001','10001','10001','10001','01110'],'P':['11110','10001','10001','11110','10000','10000','10000'],
  'Q':['01110','10001','10001','10001','10101','10010','01101'],'R':['11110','10001','10001','11110','10100','10010','10001'],
  'S':['01111','10000','10000','01110','00001','00001','11110'],'T':['11111','00100','00100','00100','00100','00100','00100'],
  'U':['10001','10001','10001','10001','10001','10001','01110'],'V':['10001','10001','10001','10001','10001','01010','00100'],
  'W':['10001','10001','10001','10101','10101','10101','01010'],'X':['10001','10001','01010','00100','01010','10001','10001'],
  'Y':['10001','10001','01010','00100','00100','00100','00100'],'Z':['11111','00001','00010','00100','01000','10000','11111'],
  '0':['01110','10001','10011','10101','11001','10001','01110'],'1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],'3':['11110','00001','00001','01110','00001','00001','11110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],'5':['11111','10000','10000','11110','00001','00001','11110'],
  '6':['01110','10000','10000','11110','10001','10001','01110'],'7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],'9':['01110','10001','10001','01111','00001','00001','01110'],
  '.':['00000','00000','00000','00000','00000','00110','00110'], ',':['00000','00000','00000','00000','00110','00100','01000'],
  ':':['00000','00110','00110','00000','00110','00110','00000'], ';':['00000','00110','00110','00000','00110','00100','01000'],
  '-':['00000','00000','00000','11111','00000','00000','00000'], '_':['00000','00000','00000','00000','00000','00000','11111'],
  '/':['00001','00010','00010','00100','01000','01000','10000'], '\\':['10000','01000','01000','00100','00010','00010','00001'],
  '>':['10000','01000','00100','00010','00100','01000','10000'], '<':['00001','00010','00100','01000','00100','00010','00001'],
  '[':['01110','01000','01000','01000','01000','01000','01110'], ']':['01110','00010','00010','00010','00010','00010','01110'],
  '(':['00010','00100','01000','01000','01000','00100','00010'], ')':['01000','00100','00010','00010','00010','00100','01000'],
  '+':['00000','00100','00100','11111','00100','00100','00000'], '=':['00000','11111','00000','11111','00000','00000','00000'],
  '!':['00100','00100','00100','00100','00100','00000','00100'], '?':['01110','10001','00001','00010','00100','00000','00100'],
  '#':['01010','11111','01010','01010','11111','01010','00000'], '%':['11001','11010','00100','01000','10110','00110','00000'],
  '@':['01110','10001','10111','10101','10111','10000','01111'], '*':['00000','10101','01110','11111','01110','10101','00000'],
  '|':['00100','00100','00100','00100','00100','00100','00100'], '"':['01010','01010','01010','00000','00000','00000','00000'],
  "'":['00100','00100','01000','00000','00000','00000','00000']
});

function vosPackColor(c){c=Number(c)>>>0;const r=(c>>>24)&255,g=(c>>>16)&255,b=(c>>>8)&255,a=c&255;return ((a<<24)|(b<<16)|(g<<8)|r)>>>0;}
function vosMixColor(a,b,t){a=Number(a)>>>0;b=Number(b)>>>0;const ch=(s,x)=>(x>>>s)&255;const m=(x,y)=>Math.max(0,Math.min(255,Math.round(x+(y-x)*t)));return ((m(ch(24,a),ch(24,b))<<24)|(m(ch(16,a),ch(16,b))<<16)|(m(ch(8,a),ch(8,b))<<8)|m(ch(0,a),ch(0,b)))>>>0;}

export class VOSGraphics {
  constructor(runtime){this.runtime=runtime;this.width=1280;this.height=720;this.frameAddr=0x20000000;this.bytes=new Uint8ClampedArray(this.width*this.height*4);this.pixels=new Uint32Array(this.bytes.buffer);this.drawCalls=0;this.commits=0;}
  configure(width,height,frameAddr=this.frameAddr){width=Number(width);height=Number(height);frameAddr=Number(frameAddr);if(width<=0||height<=0||width>8192||height>8192)throw new RangeError('invalid VOS graphics mode');this.width=width;this.height=height;this.frameAddr=frameAddr;if(this.bytes.length!==width*height*4){this.bytes=new Uint8ClampedArray(width*height*4);this.pixels=new Uint32Array(this.bytes.buffer);}this.runtime.display.configure(width,height,frameAddr);return true;}
  color(r,g,b,a=255){return (((r&255)<<24)|((g&255)<<16)|((b&255)<<8)|(a&255))>>>0;}
  clear(color){this.pixels.fill(vosPackColor(color));this.drawCalls++;}
  pixel(x,y,color){x=x|0;y=y|0;if(x<0||y<0||x>=this.width||y>=this.height)return;this.pixels[y*this.width+x]=vosPackColor(color);}
  fillRect(x,y,w,h,color){x=Math.floor(x);y=Math.floor(y);w=Math.floor(w);h=Math.floor(h);if(w<=0||h<=0)return;const x0=Math.max(0,x),y0=Math.max(0,y),x1=Math.min(this.width,x+w),y1=Math.min(this.height,y+h),p=vosPackColor(color);for(let yy=y0;yy<y1;yy++)this.pixels.fill(p,yy*this.width+x0,yy*this.width+x1);this.drawCalls++;}
  strokeRect(x,y,w,h,color,t=1){this.fillRect(x,y,w,t,color);this.fillRect(x,y+h-t,w,t,color);this.fillRect(x,y,t,h,color);this.fillRect(x+w-t,y,t,h,color);}
  gradientRect(x,y,w,h,c0,c1,vertical=true){x|=0;y|=0;w|=0;h|=0;const n=vertical?h:w;for(let i=0;i<n;i++){const c=vosMixColor(c0,c1,n<=1?0:i/(n-1));if(vertical)this.fillRect(x,y+i,w,1,c);else this.fillRect(x+i,y,1,h,c);}}
  line(x0,y0,x1,y1,color,t=1){x0|=0;y0|=0;x1|=0;y1|=0;let dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1,err=dx+dy;for(;;){this.fillRect(x0-Math.floor(t/2),y0-Math.floor(t/2),t,t,color);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx;}if(e2<=dx){err+=dx;y0+=sy;}}}
  circle(cx,cy,r,color,fill=true){cx|=0;cy|=0;r=Math.max(0,r|0);const p=vosPackColor(color);if(fill){for(let y=-r;y<=r;y++){const span=Math.floor(Math.sqrt(r*r-y*y));const yy=cy+y;if(yy<0||yy>=this.height)continue;const x0=Math.max(0,cx-span),x1=Math.min(this.width,cx+span+1);this.pixels.fill(p,yy*this.width+x0,yy*this.width+x1);}}else{let x=r,y=0,err=0;while(x>=y){for(const [px,py] of [[x,y],[y,x],[-y,x],[-x,y],[-x,-y],[-y,-x],[y,-x],[x,-y]])this.pixel(cx+px,cy+py,color);y++;if(err<=0)err+=2*y+1;if(err>0){x--;err-=2*x+1;}}}this.drawCalls++;}
  text(x,y,text,color=0xffffffff,scale=2,maxWidth=0){x|=0;y|=0;scale=Math.max(1,scale|0);let ox=x,cx=x,cy=y;for(const raw of String(text)){if(raw==='\n'){cx=ox;cy+=8*scale;continue;}if(maxWidth&&cx+6*scale>ox+maxWidth){cx=ox;cy+=8*scale;}const ch=raw.toUpperCase(),g=VOS_GLYPHS[ch]||VOS_GLYPHS['?'];for(let gy=0;gy<7;gy++)for(let gx=0;gx<5;gx++)if(g[gy][gx]==='1')this.fillRect(cx+gx*scale,cy+gy*scale,scale,scale,color);cx+=6*scale;}this.drawCalls++;return cx;}
  textWidth(text,scale=2){return String(text).length*6*Math.max(1,scale|0);}
  flush(){if(!this.runtime.memory)throw new Error('graphics runtime is not installed');this.runtime.memory.write(this.frameAddr,this.bytes);this.commits++;return this.bytes.length;}
  commit(){this.flush();try{const d=this.runtime.device('SystemDisplay');d.PRESENT=1;}catch{this.runtime.display.requestPresent();}return this.commits;}
}

export class VOSInput {
  constructor(runtime){this.runtime=runtime;this.canvas=null;this.x=0;this.y=0;this.buttons=0;this.keyCode=0;this.events=0;this.pointerListeners=new Set();this.keyListeners=new Set();this._bound=false;}
  _poke(){try{this.runtime.bus.poke('InputHub','POINTER_X',this.x>>>0);this.runtime.bus.poke('InputHub','POINTER_Y',this.y>>>0);this.runtime.bus.poke('InputHub','BUTTONS',this.buttons>>>0);this.runtime.bus.poke('InputHub','KEYCODE',this.keyCode>>>0);this.runtime.bus.poke('InputHub','EVENTS',this.events>>>0);if(this.runtime.interrupts.handlers.has(0x21))this.runtime.interrupts.raise(0x21,{x:this.x,y:this.y,buttons:this.buttons,keyCode:this.keyCode,event:this.events}).catch(()=>{});}catch{}}
  attach(canvas){if(this.canvas===canvas&&this._bound)return this;this.canvas=canvas;if(!canvas||typeof canvas.addEventListener!=='function')return this;canvas.tabIndex=canvas.tabIndex>=0?canvas.tabIndex:0;const pos=e=>{const r=canvas.getBoundingClientRect();this.x=Math.max(0,Math.min(canvas.width-1,Math.floor((e.clientX-r.left)*canvas.width/r.width)));this.y=Math.max(0,Math.min(canvas.height-1,Math.floor((e.clientY-r.top)*canvas.height/r.height)));};canvas.addEventListener('pointermove',e=>{pos(e);this.events++;this._poke();for(const f of this.pointerListeners)f({type:'move',x:this.x,y:this.y,buttons:this.buttons,original:e});});canvas.addEventListener('pointerdown',e=>{canvas.focus();pos(e);this.buttons|=1<<Math.min(7,e.button);this.events++;this._poke();for(const f of this.pointerListeners)f({type:'down',x:this.x,y:this.y,button:e.button,buttons:this.buttons,original:e});});canvas.addEventListener('pointerup',e=>{pos(e);this.buttons&=~(1<<Math.min(7,e.button));this.events++;this._poke();for(const f of this.pointerListeners)f({type:'up',x:this.x,y:this.y,button:e.button,buttons:this.buttons,original:e});});canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('keydown',e=>{this.keyCode=e.keyCode||e.which||0;this.events++;this._poke();for(const f of this.keyListeners)f({type:'down',key:e.key,code:e.code,keyCode:this.keyCode,ctrl:e.ctrlKey,alt:e.altKey,shift:e.shiftKey,meta:e.metaKey,original:e});if(['Backspace','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key))e.preventDefault();});canvas.addEventListener('keyup',e=>{this.keyCode=0;this.events++;this._poke();for(const f of this.keyListeners)f({type:'up',key:e.key,code:e.code,keyCode:0,original:e});});this._bound=true;return this;}
  onPointer(fn){this.pointerListeners.add(fn);return()=>this.pointerListeners.delete(fn);}
  onKey(fn){this.keyListeners.add(fn);return()=>this.keyListeners.delete(fn);}
}

export class VOSFileSystem {
  constructor(){this.nodes=new Map();this.mkdir('/');this.mkdir('/system');this.mkdir('/home');this.mkdir('/home/user');this.mkdir('/apps');}
  norm(path,cwd='/'){path=String(path||'.');if(!path.startsWith('/'))path=(cwd.endsWith('/')?cwd:cwd+'/')+path;const out=[];for(const p of path.split('/')){if(!p||p==='.')continue;if(p==='..')out.pop();else out.push(p);}return '/'+out.join('/');}
  parent(path){path=this.norm(path);if(path==='/')return '/';const i=path.lastIndexOf('/');return i<=0?'/':path.slice(0,i);}
  mkdir(path){path=this.norm(path);if(path==='/'){this.nodes.set('/',{type:'dir',created:Date.now()});return path;}const parts=path.split('/').filter(Boolean);let cur='';for(const part of parts){cur+='/'+part;if(!this.nodes.has(cur))this.nodes.set(cur,{type:'dir',created:Date.now()});else if(this.nodes.get(cur).type!=='dir')throw new Error(`${cur} is not a directory`);}return path;}
  writeText(path,text){path=this.norm(path);this.mkdir(this.parent(path));this.nodes.set(path,{type:'file',data:String(text),size:new TextEncoder().encode(String(text)).length,modified:Date.now()});return true;}
  readText(path){path=this.norm(path);const n=this.nodes.get(path);if(!n||n.type!=='file')throw new Error(`file not found: ${path}`);return n.data;}
  exists(path){return this.nodes.has(this.norm(path));}
  stat(path){path=this.norm(path);const n=this.nodes.get(path);if(!n)throw new Error(`not found: ${path}`);return {...n,path};}
  list(path='/'){path=this.norm(path);const n=this.nodes.get(path);if(!n||n.type!=='dir')throw new Error(`directory not found: ${path}`);const prefix=path==='/'?'/':path+'/';const out=[];for(const [p,v] of this.nodes){if(p===path||!p.startsWith(prefix))continue;const rest=p.slice(prefix.length);if(rest.includes('/'))continue;out.push({name:rest,path:p,type:v.type,size:v.size||0,modified:v.modified||v.created||0});}return out.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='dir'?-1:1);}
  seedVIR(){this.writeText('/system/version.txt','VIR VOS 1.0\nV74 kernel / VOS ABI 1\n');this.writeText('/system/hardware.txt','VIRMachine\nCPU: V74 BSP\nRAM: 4 GiB\nGPU: VGPU2 / 256 MiB VRAM\nDisplay: 1280x720 RGBA\n');this.writeText('/system/readme.txt','Welcome to VIR. This filesystem is backed by the VOS runtime and exposed to the guest desktop.');this.writeText('/home/user/hello.txt','Hello from the VIR VOS filesystem.\nOpen Terminal and type HELP.');this.writeText('/apps/catalog.txt','terminal\nfiles\nsystem-monitor\nsettings\nwelcome\n');return true;}
}

export class VOSTerminal {
  constructor(runtime,fs){this.runtime=runtime;this.fs=fs;this.cwd='/home/user';this.title='VIR Terminal';this.lines=['VIR TERMINAL 1.0','TYPE HELP FOR AVAILABLE COMMANDS',''];this.input='';this.maxLines=160;}
  configure(title,cwd='/home/user'){this.title=String(title);this.cwd=this.fs.norm(cwd);return true;}
  print(text=''){for(const line of String(text).split('\n'))this.lines.push(line);if(this.lines.length>this.maxLines)this.lines.splice(0,this.lines.length-this.maxLines);}
  prompt(){return `USER@VIR:${this.cwd}$ `;}
  execute(command){command=String(command).trim();this.print(this.prompt()+command);if(!command)return '';const [cmd,...args]=command.split(/\s+/),c=cmd.toLowerCase();try{let out='';if(c==='help')out='HELP  VER  UNAME  CLEAR  LS  CD  PWD  CAT  ECHO  MEM  PS  DEVICES  DATE  WHOAMI';else if(c==='ver'||c==='uname')out='VIR VOS 1.0 / V74 / ABI 1';else if(c==='clear'){this.lines=[];return '';}else if(c==='pwd')out=this.cwd;else if(c==='ls'){const path=args[0]?this.fs.norm(args[0],this.cwd):this.cwd;out=this.fs.list(path).map(x=>`${x.type==='dir'?'[DIR]':'     '} ${x.name}${x.type==='file'?`  ${x.size} B`:''}`).join('\n')||'(EMPTY)';}else if(c==='cd'){const p=this.fs.norm(args[0]||'/home/user',this.cwd);if(this.fs.stat(p).type!=='dir')throw new Error('not a directory');this.cwd=p;}else if(c==='cat')out=this.fs.readText(this.fs.norm(args[0]||'',this.cwd));else if(c==='echo')out=args.join(' ');else if(c==='mem'){const m=this.runtime.memory.stats();out=`LOGICAL ${Math.round(m.logicalBytes/MiB)} MIB  HOT ${Math.round(m.hotBytes/MiB)} MIB  COLD SEGMENTS ${m.coldSegments}\nREADS ${m.reads}  WRITES ${m.writes}`;}else if(c==='ps'){const q=this.runtime.scheduler.stats();out=`PROCESSES ${q.processes}  TASK DEFS ${q.taskDefinitions}  ACTIVE TASKS ${q.tasks}`;}else if(c==='devices')out=Array.from(this.runtime.bus.devices.keys()).join('\n');else if(c==='date')out=new Date().toString();else if(c==='whoami')out='user';else out=`COMMAND NOT FOUND: ${cmd}`;if(out)this.print(out);return out;}catch(e){this.print(`ERROR: ${e.message}`);return e.message;}}
  key(key){if(key==='Enter'){const c=this.input;this.input='';this.execute(c);return true;}if(key==='Backspace'){this.input=this.input.slice(0,-1);return true;}if(key==='ArrowUp')return true;if(key.length===1&&this.input.length<120){this.input+=key;return true;}return false;}
}

export class VOSCompositor {
  constructor(runtime){this.runtime=runtime;this.windows=[];this.nextId=1;this.drag=null;}
  create(title,kind,x,y,w,h){const win={id:this.nextId++,title:String(title),kind:String(kind),x:x|0,y:y|0,w:w|0,h:h|0,minimized:false};this.windows.push(win);return win.id;}
  get(id){return this.windows.find(w=>w.id===id);}
  focus(id){const i=this.windows.findIndex(w=>w.id===id);if(i<0)return null;const [w]=this.windows.splice(i,1);this.windows.push(w);return w;}
  close(id){const i=this.windows.findIndex(w=>w.id===id);if(i>=0)this.windows.splice(i,1);}
  active(){return this.windows[this.windows.length-1]||null;}
  hit(x,y){for(let i=this.windows.length-1;i>=0;i--){const w=this.windows[i];if(!w.minimized&&x>=w.x&&y>=w.y&&x<w.x+w.w&&y<w.y+w.h)return w;}return null;}
}

export class VOSDesktopShell {
  constructor(runtime){this.runtime=runtime;this.g=runtime.graphics;this.fs=runtime.filesystem;this.term=runtime.terminal;this.comp=runtime.compositor;this.input=runtime.input;this.apps=[];this.running=false;this.startOpen=false;this.invalid=false;this.brand='VIR';this.wallpaperA=0x071327ff;this.wallpaperB=0x173a5fff;this.path='/home/user';this.bootDelay=700;this._clockTimer=null;this._unsub=[];this._dragOffset=null;}
  setBrand(name){this.brand=String(name);return true;}
  setWallpaper(a,b){this.wallpaperA=Number(a)>>>0;this.wallpaperB=Number(b)>>>0;return true;}
  registerApp(id,title,kind,icon='APP'){this.apps.push({id:String(id),title:String(title),kind:String(kind),icon:String(icon)});return true;}
  _ensureApps(){if(this.apps.length)return;this.registerApp('welcome','Welcome','welcome','N');this.registerApp('terminal','Terminal','terminal','>_');this.registerApp('files','Files','files','[]');this.registerApp('system','System Monitor','system','CPU');this.registerApp('settings','Settings','settings','*');}
  launch(delay=700){this._ensureApps();this.bootDelay=Number(delay)||0;this._drawBoot();const begin=()=>this._beginDesktop();if(this.runtime.display.canvas&&typeof setTimeout==='function'&&this.bootDelay>0)setTimeout(begin,this.bootDelay);else begin();return true;}
  _drawBoot(){const g=this.g;g.gradientRect(0,0,g.width,g.height,0x030711ff,0x0b1c35ff,true);g.circle(g.width/2,g.height/2-70,58,0x69b7ffff,true);g.circle(g.width/2+21,g.height/2-83,49,0x071327ff,true);g.text(g.width/2-108,g.height/2+15,'VIR',0xeaf5ffff,5);g.text(g.width/2-120,g.height/2+66,'VOS KERNEL INITIALIZING',0x7fb7dfff,2);for(let i=0;i<10;i++)g.fillRect(g.width/2-120+i*24,g.height/2+100,16,5,i<7?0x69b7ffff:0x1b3652ff);g.commit();}
  _beginDesktop(){if(this.running)return;this.running=true;this._unsub.push(this.input.onPointer(e=>this._pointer(e)),this.input.onKey(e=>this._key(e)));this.openApp('welcome');if(this.runtime.display.canvas&&typeof setInterval==='function')this._clockTimer=setInterval(()=>this.invalidate(),1000);this.invalidate();}
  shutdown(){this.running=false;for(const u of this._unsub.splice(0))u();if(this._clockTimer)clearInterval(this._clockTimer);this._clockTimer=null;}
  openApp(id){const a=this.apps.find(x=>x.id===id)||this.apps.find(x=>x.kind===id);if(!a)return 0;const existing=this.comp.windows.find(w=>w.kind===a.kind);if(existing){this.comp.focus(existing.id);this.invalidate();return existing.id;}const n=this.comp.windows.length;const dims=a.kind==='terminal'?[650,400]:a.kind==='files'?[690,420]:a.kind==='welcome'?[570,350]:[600,390];const idw=this.comp.create(a.title,a.kind,150+n*32,90+n*26,dims[0],dims[1]);this.comp.focus(idw);this.startOpen=false;this.invalidate();return idw;}
  invalidate(){if(!this.running)return;if(this.invalid)return;this.invalid=true;const draw=()=>{this.invalid=false;this.render();};if(typeof requestAnimationFrame==='function'&&this.runtime.display.canvas)requestAnimationFrame(draw);else draw();}
  _pointer(e){if(!this.running)return;const x=e.x,y=e.y,g=this.g;if(e.type==='down'){
      if(y>=g.height-52&&x<108){this.startOpen=!this.startOpen;this.invalidate();return;}
      if(y>=g.height-52&&x>=122){const wi=Math.floor((x-122)/158);const visible=this.comp.windows.slice(-5);if(wi>=0&&wi<visible.length){this.comp.focus(visible[wi].id);this.startOpen=false;this.invalidate();return;}}
      if(this.startOpen){const mx=18,my=g.height-390,mw=330,mh=326;if(x>=mx&&x<mx+mw&&y>=my&&y<my+mh){const row=Math.floor((y-(my+72))/48);if(row>=0&&row<this.apps.length){this.openApp(this.apps[row].id);return;}}else this.startOpen=false;}
      for(let i=0;i<Math.min(5,this.apps.length);i++){const ix=28,iy=34+i*92;if(x>=ix&&x<110&&y>=iy&&y<iy+74){this.openApp(this.apps[i].id);return;}}
      const w=this.comp.hit(x,y);if(w){this.comp.focus(w.id);if(x>=w.x+w.w-42&&x<w.x+w.w-12&&y>=w.y+9&&y<w.y+31){this.comp.close(w.id);this.invalidate();return;}if(y<w.y+38){this._dragOffset={id:w.id,dx:x-w.x,dy:y-w.y};}else if(w.kind==='files')this._fileClick(w,x,y);else if(w.kind==='settings')this._settingsClick(w,x,y);this.invalidate();return;}
    }else if(e.type==='move'&&this._dragOffset&&(e.buttons&1)){const w=this.comp.get(this._dragOffset.id);if(w){w.x=Math.max(0,Math.min(g.width-w.w,x-this._dragOffset.dx));w.y=Math.max(0,Math.min(g.height-52-w.h,y-this._dragOffset.dy));this.invalidate();}}else if(e.type==='up')this._dragOffset=null;
  }
  _key(e){if(!this.running||e.type!=='down')return;if(e.key==='Escape'){this.startOpen=false;this.invalidate();return;}if(e.key==='F2'){this.openApp('terminal');return;}const a=this.comp.active();if(a?.kind==='terminal'&&this.term.key(e.key))this.invalidate();}
  _fileClick(w,x,y){const list=this.fs.list(this.path);const row=Math.floor((y-(w.y+82))/28);if(row<0||row>=list.length)return;const item=list[row];if(item.type==='dir')this.path=item.path;else{const title=item.name;const id=this.comp.create(title,'textfile',w.x+50,w.y+50,520,320);const nw=this.comp.get(id);nw.file=item.path;} }
  _settingsClick(w,x,y){if(y<w.y+245)return;this._altTheme=!this._altTheme;if(this._altTheme){this.wallpaperA=0x140b2fff;this.wallpaperB=0x4d1f59ff;}else{this.wallpaperA=0x071327ff;this.wallpaperB=0x173a5fff;}}
  _windowFrame(w){const g=this.g;g.fillRect(w.x+8,w.y+10,w.w,w.h,0x00000055);g.fillRect(w.x,w.y,w.w,w.h,0x101a2cff);g.strokeRect(w.x,w.y,w.w,w.h,0x355274ff,1);g.fillRect(w.x,w.y,w.w,38,0x172740ff);g.text(w.x+14,w.y+11,w.title,0xe6f2ffff,2,w.w-70);g.fillRect(w.x+w.w-42,w.y+8,30,23,0x7e3341ff);g.text(w.x+w.w-35,w.y+12,'X',0xffffffff,2);}
  _renderWindow(w){const g=this.g;this._windowFrame(w);const x=w.x+18,y=w.y+54,cw=w.w-36,ch=w.h-70;if(w.kind==='welcome'){g.text(x,y,'WELCOME TO VIR',0x7fd6ffff,3);g.text(x,y+46,'A VOS-NATIVE GRAPHICAL OPERATING SYSTEM',0xc8d8eaff,2,cw);g.text(x,y+92,'THIS DESKTOP IS DRAWN INTO THE GUEST FRAMEBUFFER.',0x91a9c3ff,2,cw);g.text(x,y+122,'MMIO PRESENT CONTROLS VSYNC OUTPUT TO THE BROWSER.',0x91a9c3ff,2,cw);g.text(x,y+168,'DESKTOP APPS',0xffffffff,2);g.text(x,y+198,'TERMINAL   FILES   SYSTEM MONITOR   SETTINGS',0x69b7ffff,2,cw);g.text(x,y+246,'TIP: PRESS F2 FOR TERMINAL',0xb3c8dcff,2);}else if(w.kind==='terminal'){g.fillRect(x-6,y-8,cw+12,ch+10,0x050a10ff);const all=[...this.term.lines, this.term.prompt()+this.term.input+'_'];const max=Math.max(1,Math.floor((ch-4)/18));let yy=y;for(const line of all.slice(-max)){g.text(x,yy,line,0x9ee8b6ff,2,cw);yy+=18;}}else if(w.kind==='files'){g.text(x,y,`FILES  ${this.path}`,0x7fd6ffff,2,cw);g.fillRect(x,y+26,cw,1,0x355274ff);const list=this.fs.list(this.path);let yy=y+38;for(const it of list.slice(0,11)){g.fillRect(x,yy-3,cw,24,0x132239ff);g.text(x+8,yy,(it.type==='dir'?'[DIR] ':'      ')+it.name,it.type==='dir'?0x7fd6ffff:0xd8e5f4ff,2,cw-110);if(it.type==='file')g.text(x+cw-92,yy,`${it.size} B`,0x7890aaff,2);yy+=28;}}else if(w.kind==='system'){const st=this.runtime.stats(),m=st.memory;g.text(x,y,'SYSTEM MONITOR',0x7fd6ffff,3);g.text(x,y+50,`V74 CPU BLOCKS     ${st.cpu.blocks}`,0xd8e5f4ff,2);g.text(x,y+78,`MEMORY READS       ${m.reads}`,0xd8e5f4ff,2);g.text(x,y+106,`MEMORY WRITES      ${m.writes}`,0xd8e5f4ff,2);g.text(x,y+134,`COLD SEGMENTS      ${m.coldSegments}`,0xd8e5f4ff,2);g.text(x,y+162,`FRAMES PRESENTED   ${this.runtime.display.frames}`,0xd8e5f4ff,2);g.text(x,y+190,`INTERRUPTS         ${st.interrupts.delivered}`,0xd8e5f4ff,2);g.text(x,y+218,`ACTIVE TASKS       ${st.scheduler.tasks}`,0xd8e5f4ff,2);g.text(x,y+264,'HARDWARE',0x7fd6ffff,2);g.text(x,y+290,Array.from(this.runtime.bus.devices.keys()).join('  '),0x91a9c3ff,2,cw);}else if(w.kind==='settings'){g.text(x,y,'DESKTOP SETTINGS',0x7fd6ffff,3);g.text(x,y+52,'DISPLAY  1280 X 720 RGBA',0xd8e5f4ff,2);g.text(x,y+82,'VSYNC    ENABLED',0xd8e5f4ff,2);g.text(x,y+112,'INPUT    POINTER + KEYBOARD MMIO',0xd8e5f4ff,2);g.text(x,y+142,'THEME    VIR DEEP SPACE',0xd8e5f4ff,2);g.text(x,y+204,'CLICK THIS AREA TO TOGGLE THE DESKTOP COLOR THEME.',0x91a9c3ff,2,cw);}else if(w.kind==='textfile'){let data='';try{data=this.fs.readText(w.file);}catch(e){data=e.message;}g.text(x,y,w.file||'FILE',0x7fd6ffff,2,cw);g.text(x,y+36,data,0xd8e5f4ff,2,cw);}}
  render(){if(!this.running)return;const g=this.g;g.gradientRect(0,0,g.width,g.height,this.wallpaperA,this.wallpaperB,true);g.circle(g.width-120,90,120,0x214c74ff,true);g.circle(g.width-84,68,102,this.wallpaperB,true);g.text(24,g.height-83,'VIR VOS',0x9fcbe8aa,2);for(let i=0;i<Math.min(5,this.apps.length);i++){const a=this.apps[i],x=30,y=36+i*92;g.fillRect(x,y,64,52,0x102744dd);g.strokeRect(x,y,64,52,0x4f769fff,1);g.text(x+10,y+17,a.icon,0x9fe3ffff,2,46);g.text(x,y+60,a.title,0xf0f7ffff,2,120);}for(const w of this.comp.windows)this._renderWindow(w);
    g.fillRect(0,g.height-52,g.width,52,0x08111eee);g.fillRect(12,g.height-42,96,32,this.startOpen?0x2d6592ff:0x163856ff);g.text(28,g.height-34,'VIR',0xeaf5ffff,2);let tx=122;for(const w of this.comp.windows.slice(-5)){g.fillRect(tx,g.height-42,150,32,w===this.comp.active()?0x254e70ff:0x11263cff);g.text(tx+10,g.height-33,w.title,0xdce9f7ff,2,130);tx+=158;}const tm=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});g.text(g.width-92,g.height-33,tm,0xdce9f7ff,2);
    if(this.startOpen){const mx=18,my=g.height-390,mw=330,mh=326;g.fillRect(mx,my,mw,mh,0x0c1727f5);g.strokeRect(mx,my,mw,mh,0x47739bff,1);g.text(mx+18,my+18,this.brand.toUpperCase(),0x9fe3ffff,3);g.text(mx+18,my+49,'APPLICATIONS',0x6e8da8ff,2);for(let i=0;i<this.apps.length;i++){const a=this.apps[i],yy=my+72+i*48;g.fillRect(mx+12,yy,mw-24,40,0x13263dff);g.text(mx+24,yy+12,a.title,0xeaf5ffff,2,mw-70);}}
    const px=this.input.x,py=this.input.y;g.line(px,py,px,py+16,0xffffffff,2);g.line(px,py,px+11,py+11,0xffffffff,2);g.line(px+1,py+12,px+5,py+10,0xffffffff,2);g.commit();}
}

export class VOSAudio {
  constructor(){this.context=null;this.node=null;this.ready=false;}
  async start(sampleRate=48000,channels=2){if(typeof AudioContext==='undefined'&&typeof webkitAudioContext==='undefined')throw new Error('Web Audio is unavailable');const C=globalThis.AudioContext||globalThis.webkitAudioContext;this.context=new C({sampleRate});const code=`class VOSP extends AudioWorkletProcessor{constructor(){super();this.q=[];this.pos=0;this.port.onmessage=e=>this.q.push(new Float32Array(e.data));}process(i,o){const out=o[0];for(let c=0;c<out.length;c++){let dst=out[c];for(let n=0;n<dst.length;n++){while(this.q.length&&this.pos>=this.q[0].length){this.q.shift();this.pos=0;}dst[n]=this.q.length?this.q[0][this.pos++]:0;}}return true;}}registerProcessor('vos-audio',VOSP);`;const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));try{await this.context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}this.node=new AudioWorkletNode(this.context,'vos-audio',{outputChannelCount:[channels]});this.node.connect(this.context.destination);this.ready=true;}
  push(samples){if(!this.ready)throw new Error('audio not started');const a=samples instanceof Float32Array?samples:new Float32Array(samples);this.node.port.postMessage(a.buffer,[a.buffer]);}
}


export class VOSChannel {
  constructor(name,capacity=1024){this.name=name;this.capacity=capacity;this.queue=[];this.waiters=[];this.sent=0;this.received=0;}
  send(value){if(this.waiters.length){this.received++;this.sent++;this.waiters.shift()(value);return true;}if(this.queue.length>=this.capacity)throw new Error(`channel ${this.name} is full`);this.queue.push(value);this.sent++;return true;}
  receive(){if(this.queue.length){this.received++;return Promise.resolve(this.queue.shift());}return new Promise(resolve=>this.waiters.push(resolve));}
  tryReceive(){if(!this.queue.length)return {ok:false,value:undefined};this.received++;return {ok:true,value:this.queue.shift()};}
  stats(){return {name:this.name,capacity:this.capacity,depth:this.queue.length,waiting:this.waiters.length,sent:this.sent,received:this.received};}
}

export class VOSScheduler {
  constructor(){this.processes=new Map();this.taskDefs=new Map();this.tasks=new Set();this.started=performance?.now?.()??Date.now();}
  registerProcess(name,entry){if(this.processes.has(name))throw new Error(`process ${name} already exists`);this.processes.set(name,{entry,runs:0,last:null});}
  registerTask(name,entry){if(this.taskDefs.has(name))throw new Error(`task ${name} already exists`);this.taskDefs.set(name,{entry,runs:0,last:null});}
  startTask(name,...args){const t=this.taskDefs.get(name);if(!t)throw new Error(`unknown task ${name}`);t.runs++;const p=Promise.resolve().then(()=>t.entry(...args));t.last=p;this.tasks.add(p);p.finally(()=>this.tasks.delete(p));return p;}
  async spawn(name,...args){const p=this.processes.get(name);if(!p)throw new Error(`unknown process ${name}`);p.runs++;const promise=Promise.resolve().then(()=>p.entry(...args));p.last=promise;this.tasks.add(promise);promise.finally(()=>this.tasks.delete(promise));return promise;}
  attach(promise){this.tasks.add(Promise.resolve(promise));}
  stats(){return {processes:this.processes.size,taskDefinitions:this.taskDefs.size,tasks:this.tasks.size,uptimeMs:(performance?.now?.()??Date.now())-this.started};}
}

// Raw V74 CPU uses a predecoded basic-block cache to avoid a switch/decode for each fetch.
export class V74CPU {
  constructor(memory){this.mem=memory;this.regs=new BigUint64Array(32);this.hi10=new Uint16Array(32);this.ip=0;this.sp=0x001ffff0;this.flags=0x200;this.halted=false;this.cycles=0;this.instructions=0;this.blocks=new Map();this.maxBlock=96;this.mask=(1n<<74n)-1n;}
  getReg(i){return BigInt(this.regs[i])|(BigInt(this.hi10[i]&0x3ff)<<64n);} setReg(i,v){v=BigInt(v)&this.mask;this.regs[i]=BigInt.asUintN(64,v);this.hi10[i]=Number((v>>64n)&0x3ffn);}
  _addr(v){const n=Number(BigInt(v));if(!Number.isSafeInteger(n))throw new RangeError('V74 address exceeds host safe integer range');return n;}
  _imm74(addr){return this.mem.read74(addr);} _write74(addr,v){this.mem.write74(this._addr(addr),v);} _read74(addr){return this.mem.read74(this._addr(addr));}
  _flags(v,carry=false){v=BigInt(v)&this.mask;this.flags&=~0x17;if(v===0n)this.flags|=1;if(carry)this.flags|=2;if(v&(1n<<73n))this.flags|=4;let x=v,p=0;while(x){p^=Number(x&1n);x>>=1n;}if(p===0)this.flags|=0x10;}
  invalidate(addr=0,len=Number.MAX_SAFE_INTEGER){if(len===Number.MAX_SAFE_INTEGER){this.blocks.clear();return;}for(const k of this.blocks.keys())if(k>=addr&&k<addr+len)this.blocks.delete(k);}
  decode(start){let ip=start,ops=[];const imm=()=>{const v=this.mem.read74(ip);ip+=10;return v;};for(let n=0;n<this.maxBlock;n++){const at=ip,op=this.mem.read8(ip++);if(op===0x00){ops.push([op,at]);continue;}if(op===0x10||op===0x12||op===0x13||(op>=0xA0&&op<=0xA9)){const rr=this.mem.read8(ip++);ops.push([op,at,rr>>4,rr&15]);continue;}if(op===0x11){const r=this.mem.read8(ip++),v=imm();ops.push([op,at,r,v]);continue;}if(op===0x20||op===0x21){const r=this.mem.read8(ip++);ops.push([op,at,r]);continue;}if(op===0x22||op===0x23||op===0xB6||op===0xCE||op===0xFF){ops.push([op,at]);if(op===0xB6||op===0xCE||op===0xFF)break;continue;}if(op>=0xB0&&op<=0xB5){const a=imm();ops.push([op,at,a]);break;}if(op===0xCD){const v=this.mem.read8(ip++);ops.push([op,at,v]);break;}if(op===0xEE||op===0xEF){const r=this.mem.read8(ip++),port=imm();ops.push([op,at,r,port]);continue;}ops.push([op,at]);break;}const b={start,end:ip,ops};this.blocks.set(start,b);return b;}
  run(budget=100000){let executed=0;while(!this.halted&&executed<budget){const b=this.blocks.get(this.ip)||this.decode(this.ip);let branched=false;for(const ins of b.ops){const op=ins[0];executed++;this.cycles++;this.instructions++;const a=ins[2],c=ins[3];
      if(op===0x00){}
      else if(op===0x10)this.setReg(a,this.getReg(c));
      else if(op===0x11)this.setReg(a,c);
      else if(op===0x12)this.setReg(a,this._read74(this.getReg(c)));
      else if(op===0x13)this._write74(this.getReg(a),this.getReg(c));
      else if(op===0x20){this._write74(this.sp,this.getReg(a));this.sp-=10;}
      else if(op===0x21){this.sp+=10;this.setReg(a,this._read74(this.sp));}
      else if(op===0x22){this._write74(this.sp,BigInt(this.flags));this.sp-=10;}
      else if(op===0x23){this.sp+=10;this.flags=Number(this._read74(this.sp)&0xffffffffn);}
      else if(op===0xA0){const x=this.getReg(a)+this.getReg(c);this.setReg(a,x);this._flags(x,x>this.mask);}
      else if(op===0xA1){const x=this.getReg(a)-this.getReg(c);this.setReg(a,x);this._flags(x,x<0n);}
      else if(op===0xA2){const x=this.getReg(a)*this.getReg(c);this.setReg(a,x);this._flags(x,x>this.mask);}
      else if(op===0xA3){const d=this.getReg(c);if(d===0n){this.flags|=1;}else{const x=this.getReg(a)/d;this.setReg(a,x);this._flags(x);}}
      else if(op===0xA4){const x=this.getReg(a)&this.getReg(c);this.setReg(a,x);this._flags(x);}
      else if(op===0xA5){const x=this.getReg(a)|this.getReg(c);this.setReg(a,x);this._flags(x);}
      else if(op===0xA6){const x=this.getReg(a)^this.getReg(c);this.setReg(a,x);this._flags(x);}
      else if(op===0xA7){const x=this.getReg(a)<<BigInt(Number(this.getReg(c)%74n));this.setReg(a,x);this._flags(x,x>this.mask);}
      else if(op===0xA8){const x=this.getReg(a)>>BigInt(Number(this.getReg(c)%74n));this.setReg(a,x);this._flags(x);}
      else if(op===0xA9)this._flags(this.getReg(a)-this.getReg(c),this.getReg(a)<this.getReg(c));
      else if(op===0xB0){this.ip=this._addr(ins[2]);branched=true;break;}
      else if(op===0xB1){if(this.flags&1){this.ip=this._addr(ins[2]);branched=true;break;}}
      else if(op===0xB2){if(!(this.flags&1)){this.ip=this._addr(ins[2]);branched=true;break;}}
      else if(op===0xB3){if(this.flags&2){this.ip=this._addr(ins[2]);branched=true;break;}}
      else if(op===0xB4){if(!(this.flags&2)){this.ip=this._addr(ins[2]);branched=true;break;}}
      else if(op===0xB5){this._write74(this.sp,BigInt(b.end));this.sp-=10;this.ip=this._addr(ins[2]);branched=true;break;}
      else if(op===0xB6){this.sp+=10;this.ip=this._addr(this._read74(this.sp));branched=true;break;}
      else if(op===0xCD){if(this.flags&0x200){this._write74(this.sp,BigInt(b.end));this.sp-=10;this._write74(this.sp,BigInt(this.flags));this.sp-=10;this.ip=this._addr(this._read74(ins[2]*10));this.flags&=~0x200;branched=true;break;}}
      else if(op===0xCE){this.sp+=10;this.flags=Number(this._read74(this.sp)&0xffffffffn);this.sp+=10;this.ip=this._addr(this._read74(this.sp));this.flags|=0x200;branched=true;break;}
      else if(op===0xEE)this.setReg(a,this._read74(0xFF00n+BigInt(c)));
      else if(op===0xEF)this._write74(0xFF00n+BigInt(c),this.getReg(a));
      else if(op===0xFF){this.halted=true;this.flags|=0x400;break;}
      else throw new Error(`V74 illegal opcode 0x${op.toString(16)} at 0x${ins[1].toString(16)}`);
      if(executed>=budget)break;
    }if(!branched&&!this.halted)this.ip=b.end;}return executed;}
  executeToHalt(max=10_000_000){let done=0;while(!this.halted&&done<max)done+=this.run(Math.min(250000,max-done));return done;}
}

export class VOSRuntime {
  constructor(options={}){this.options=options;this.manifest=null;this.memory=null;this.mmu=null;this.dma=null;this.interrupts=new VOSInterruptController();this.bus=null;this.disk=new VOSDisk(options.diskSectors||131072);this.network=new VOSNetwork();this.scheduler=new VOSScheduler();this.procedures=new Map();this.wasm=null;this.cpu=null;this.domain='safe';this.modules=new Map();this.channels=new Map();this.drivers=new Map();this.stateMachines=new Map();
    this.input=new VOSInput(this);this.display=new VOSDisplay(this);this.graphics=new VOSGraphics(this);this.filesystem=new VOSFileSystem();this.terminal=new VOSTerminal(this,this.filesystem);this.compositor=new VOSCompositor(this);this.desktop=new VOSDesktopShell(this);this.audio=new VOSAudio();
    this.modules.set('graphics',this.graphics);this.modules.set('display',this.display);this.modules.set('input',this.input);this.modules.set('filesystem',this.filesystem);this.modules.set('terminal',this.terminal);this.modules.set('compositor',this.compositor);this.modules.set('desktop',this.desktop);this.modules.set('disk',this.disk);this.modules.set('network',this.network);this.modules.set('audio',this.audio);
    this.cpuAPI={wait_interrupt:()=>new Promise(r=>setTimeout(r,0))};this.interruptAPI={disable:()=>this.interrupts.setEnabled(false),enable:()=>this.interrupts.setEnabled(true),install:()=>{}};this.memoryAPI={initialize:()=>true,map:(...a)=>this.mmu.map(...a),allocate:(n,align=4096)=>this.allocate(n,align)};this.schedulerAPI={initialize:()=>true,attach:x=>this.scheduler.attach(x),startTask:(n,...a)=>this.scheduler.startTask(n,...a),launchProcess:(n,...a)=>this.scheduler.spawn(n,...a)};this.driverAPI={attach:(n,d)=>this.attachDriver(n,d),detach:(n,d)=>this.detachDriver(n,d)};
  }
  installManifest(manifest){this.manifest=manifest;this.domain=manifest.domain||'safe';let logical=4*GiB;for(const c of manifest.hardware?.components||[])if(c.kind==='memory'&&c.properties.capacity)logical=this._quantity(c.properties.capacity)||logical;this.memory=new VOSMemory(logical,this.options);this.mmu=new VOSMMU(this.memory);this.dma=new VOSDMA(this.memory);this.bus=new VOSDeviceBus(this.memory,this.interrupts);for(const r of manifest.hardware?.regions||[]){if(r.address+r.size>this.memory.logicalBytes)throw new Error(`region ${r.name} exceeds RAM address space`);}for(const d of manifest.hardware?.devices||[])this.bus.install(d);this.cpu=new V74CPU(this.memory);this._bindPlatformDevices();return this;}
  _bindPlatformDevices(){
    if(this.bus?.devices.has('SystemDisplay')){const sync=()=>{const d=this.device('SystemDisplay');this.display.vsync=this.bus.defs.get('SystemDisplay')?.regs.has('VSYNC_MODE')?!!d.VSYNC_MODE:true;this.display.configure(Number(d.WIDTH||1280),Number(d.HEIGHT||720),Number(d.FRAME_ADDR||0x20000000n));};for(const r of ['WIDTH','HEIGHT','FRAME_ADDR','VSYNC_MODE'])if(this.bus.defs.get('SystemDisplay')?.regs.has(r))this.bus.hook('SystemDisplay',r,{write:sync});if(this.bus.defs.get('SystemDisplay')?.regs.has('PRESENT'))this.bus.hook('SystemDisplay','PRESENT',{write:v=>{if(Number(v)&1){sync();this.display.requestPresent();}}});sync();}
    if(this.bus?.devices.has('InputHub'))this.input._poke();
  }
  _quantity(x){const m=String(x).match(/^([0-9.]+)\s*(KiB|MiB|GiB|B)?$/);if(!m)return Number(x)||0;return Number(m[1])*({B:1,KiB,MiB,GiB}[m[2]||'B']);}
  registerProcedure(name,fn){if(this.procedures.has(name))throw new Error(`procedure ${name} already registered`);this.procedures.set(name,fn);}
  registerInterrupt(vector,name,fn){this.interrupts.register(vector,name,fn);}
  registerProcess(name,fn){this.scheduler.registerProcess(name,fn);}
  channel(name,capacity=1024){if(this.channels.has(name))return this.channels.get(name);const c=new VOSChannel(name,capacity);this.channels.set(name,c);return c;}
  registerTask(name,fn){this.scheduler.registerTask(name,fn);}
  registerDriver(name,target,methods){if(this.drivers.has(name))throw new Error(`driver ${name} already registered`);this.drivers.set(name,{name,target,methods,attached:new Set()});}
  async attachDriver(name,deviceName){const d=this.drivers.get(name);if(!d)throw new Error(`unknown driver ${name}`);const dev=this.device(deviceName||d.target);if(d.methods.attach)await d.methods.attach(dev);d.attached.add(deviceName||d.target);return dev;}
  async detachDriver(name,deviceName){const d=this.drivers.get(name);if(!d)throw new Error(`unknown driver ${name}`);const n=deviceName||d.target,dev=this.device(n);if(d.methods.detach)await d.methods.detach(dev);d.attached.delete(n);}
  registerStateMachine(name,initial,transitions){const sm={name,state:initial,transitions,async dispatch(event,payload){const key=`${this.state}:${event}`,t=this.transitions.get(key);if(!t)throw new Error(`no transition ${key}`);if(t.action)await t.action(payload);this.state=t.to;return this.state;}};this.stateMachines.set(name,sm);return sm;}
  stateMachine(name){const s=this.stateMachines.get(name);if(!s)throw new Error(`unknown state machine ${name}`);return s;}
  symbol(name){return Object.freeze({symbol:name,toString(){return name;}});}
  procedure(name){const p=this.procedures.get(name);if(!p)throw new Error(`unknown procedure ${name}`);return p;}
  async call(name,...args){return await this.procedure(name)(...args);}
  require(cond,msg='VOS contract failed'){if(!cond)throw new Error(msg);}
  checkedCast(value,bits,signed=false){if(!bits)return value;const big=typeof value==='bigint'?value:BigInt(value);const min=signed?-(1n<<BigInt(bits-1)):0n,max=signed?(1n<<BigInt(bits-1))-1n:(1n<<BigInt(bits))-1n;if(big<min||big>max)throw new RangeError(`VOS checked cast overflow for ${signed?'i':'u'}${bits}`);return bits>53?big:Number(big);}
  truncate(value,bits,signed=false){if(!bits)return value;const big=BigInt(value),n=BigInt(bits),mask=(1n<<n)-1n;let v=big&mask;if(signed&&(v&(1n<<(n-1n))))v-=1n<<n;return bits>53?v:Number(v);}
  device(name){return this.bus.get(name);}
  module(name){if(name==='cpu')return this.cpuAPI;if(name==='interrupts')return this.interruptAPI;if(name==='memory')return this.memoryAPI;if(name==='scheduler')return this.schedulerAPI;if(name==='drivers')return this.driverAPI;if(this.bus?.devices.has(name))return this.bus.get(name);if(!this.modules.has(name))throw new Error(`unknown runtime module ${name}`);return this.modules.get(name);}
  allocate(size,alignment=4096){this._heap=this._heap??0x01000000;this._heap=Math.ceil(this._heap/alignment)*alignment;const p=this._heap;this._heap+=size;if(this._heap>=this.memory.logicalBytes)throw new Error('out of VOS memory');return p;}
  async installGenerated(module){return await module.installVOSModule(this);}
  async installWasm(bytes){this.wasm=await WebAssembly.instantiate(bytes,{vos:{}});return this.wasm.instance.exports;}
  stats(){return {memory:this.memory?.stats(),scheduler:this.scheduler.stats(),channels:Array.from(this.channels.values(),c=>c.stats()),drivers:this.drivers.size,stateMachines:this.stateMachines.size,interrupts:{delivered:this.interrupts.delivered,pending:this.interrupts.pending.length},cpu:this.cpu?{cycles:this.cpu.cycles,blocks:this.cpu.blocks.size,halted:this.cpu.halted}:null};}
}

export async function bootVOS({module,runtime=new VOSRuntime(),wasmBytes=null,entry='kernel_main',args=[]}){await runtime.installGenerated(module);if(wasmBytes)await runtime.installWasm(wasmBytes);if(runtime.procedures.has(entry))await runtime.call(entry,...args);return runtime;}
