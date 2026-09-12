import { VOSMemory, V74CPU } from './vos-runtime.js';
let cpu=null, running=false;
self.onmessage = async e => {
  const m=e.data;
  if(m.type==='init'){
    const mem=Object.create(VOSMemory.prototype);
    mem.logicalBytes=m.logicalBytes; mem.segmentSize=1024*1024; mem.hotBytes=m.buffer.byteLength; mem.hotBuffer=m.buffer; mem.hot=new Uint8Array(m.buffer); mem.hotView=new DataView(m.buffer); mem.shared=true; mem.cold=new Map(); mem.reads=0; mem.writes=0;
    cpu=new V74CPU(mem); cpu.ip=m.ip||0; self.postMessage({type:'ready'});
  } else if(m.type==='run'&&cpu){running=true;const quantum=m.quantum||250000;while(running&&!cpu.halted){const n=cpu.run(quantum);self.postMessage({type:'progress',cycles:cpu.cycles,ip:cpu.ip,executed:n});await new Promise(r=>setTimeout(r,0));}self.postMessage({type:'stopped',cycles:cpu.cycles,halted:cpu.halted});
  } else if(m.type==='stop') running=false;
};
