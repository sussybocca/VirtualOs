/*
 * VOS Browser Compiler 0.3 — Browser Demo Profile
 * ------------------------------------------------
 * Same VOS source syntax, browser-oriented frontend/semantic checks/backend.
 * This edition intentionally exposes the Browser Demo capability profile (~70%).
 * Native-only/Metal features are rejected explicitly rather than simulated.
 */

const TE = new TextEncoder();
const TD = new TextDecoder();

export const BROWSER_DEMO_PROFILE = Object.freeze({
  name: 'VOS Browser Demo',
  version: '0.3.0',
  abi: 1,
  approximateFeatureCoverage: 70,
  enabled: Object.freeze([
    'safe/kernel domains', 'core scalar and parameterized types', 'unit literals',
    'strict narrowing checks', 'effects/contracts', 'hardware machine declarations',
    'memory maps', 'MMIO devices/registers', 'interrupts', 'processes', 'drivers',
    'tasks/channels', 'state machines', 'browser target metadata',
    'AOT JavaScript backend', 'pure i32/u32 WebAssembly backend',
    'VXE/VIMG/VHW/VLIB/VDBG containers', 'VOS browser runtime',
    'display/graphics/input/filesystem/terminal/compositor/desktop services'
  ]),
  nativeOnly: Object.freeze([
    '@domain metal', 'custom isa declarations', 'raw asm declarations',
    'native_windows/native host targets', 'unrestricted comptime metaprogramming',
    'unsafe(memory.raw) executable blocks', 'native V74 assembler emission',
    'native debug/package link optimization', 'host-native backends'
  ])
});

let corePromise = null;
async function loadCore(url = new URL('./vos-compiler.wasm', import.meta.url)) {
  if (!corePromise) corePromise = (async () => {
    try {
      if (typeof fetch === 'function') {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const bytes = await r.arrayBuffer();
        return (await WebAssembly.instantiate(bytes, {})).instance.exports;
      }
    } catch (e) {
      // Node/file fallback below.
      if (!(typeof process !== 'undefined' && process.versions?.node)) throw e;
    }
    if (typeof process !== 'undefined' && process.versions?.node) {
      const { readFile } = await import('node:fs/promises');
      const bytes = await readFile(url);
      return (await WebAssembly.instantiate(bytes, {})).instance.exports;
    }
    throw new Error('Unable to load VOS browser compiler core');
  })();
  return corePromise;
}

const ID = 'identifier', NUM = 'number', STR = 'string', CHR = 'character', SYM = 'symbol', END = 'end';
const OPS = ['--[','-->','::',':=','<-','->','=>','..','==','!=','<=','>=','<<','>>','&&','||','++','--','+=','-=','*=','/=','?.'];
const TOP = new Map([
  ['domain','domain'],['unit','unit'],['import','import'],['hardware','hardware'],['memoryspace','memoryspace'],
  ['device','device'],['shared','shared'],['interrupt','interrupt'],['proc','proc'],['pure','proc'],['driver','driver'],
  ['process','process'],['task','task'],['channel','channel'],['state','state'],['machine','machine'],['isa','isa'],
  ['target','target'],['comptime','comptime'],['asm','asm']
]);

function diagnostic(level, code, message, token = null, file = '<browser>') {
  return { level, code, message, file: token?.file || file, line: token?.line || 1, column: token?.column || 1 };
}
function isWord(t) { return t && (t.kind === ID || t.kind === NUM || t.kind === STR || t.kind === CHR); }
function tokenSource(ts) {
  let out = '';
  for (let i=0;i<ts.length;i++) {
    if (i && isWord(ts[i]) && isWord(ts[i-1])) out += ' ';
    out += ts[i].text;
  }
  return out;
}
function stripQuotes(s) { try { return JSON.parse(s); } catch { return s.slice(1,-1); } }

export class VOSBrowserLexer {
  constructor(file, source) { this.file=file; this.source=source; this.i=0; this.line=1; this.col=1; this.diagnostics=[]; }
  peek(n=0){ return this.source[this.i+n] ?? '\0'; }
  take(){ const c=this.peek(); if(c==='\0')return c; this.i++; if(c==='\n'){this.line++;this.col=1;} else this.col++; return c; }
  tok(kind,text,line,column){ return {kind,text,file:this.file,line,column}; }
  skip(){ for(;;){ while(/\s/.test(this.peek()) && this.peek()!=='\0')this.take(); if(this.peek()==='/'&&this.peek(1)==='/'){while(this.peek()!=='\n'&&this.peek()!=='\0')this.take();continue;} if(this.peek()==='/'&&this.peek(1)==='*'){const l=this.line,c=this.col;this.take();this.take();let ok=false;while(this.peek()!=='\0'){if(this.peek()==='*'&&this.peek(1)==='/'){this.take();this.take();ok=true;break;}this.take();}if(!ok)this.diagnostics.push(diagnostic('error','VOS-E0001','unterminated block comment',{file:this.file,line:l,column:c}));continue;}break;} }
  lex(){ const out=[]; while(this.peek()!=='\0'){this.skip(); if(this.peek()==='\0')break; const l=this.line,c=this.col,ch=this.peek(); if(/[A-Za-z_$]/.test(ch)){let s='';while(/[A-Za-z0-9_$]/.test(this.peek()))s+=this.take();out.push(this.tok(ID,s,l,c));continue;} if(/[0-9]/.test(ch)){let s='';if(ch==='0'&&/[xXbB]/.test(this.peek(1))){s+=this.take();s+=this.take();}while(/[A-Za-z0-9_.]/.test(this.peek()))s+=this.take();out.push(this.tok(NUM,s,l,c));continue;} if(ch==='"'||ch==="'"){const q=this.take(), kind=q==='"'?STR:CHR;let s=q,esc=false,ok=false;while(this.peek()!=='\0'){const x=this.take();s+=x;if(esc){esc=false;continue;}if(x==='\\'){esc=true;continue;}if(x===q){ok=true;break;}if(q==="'"&&x==='\n')break;}if(!ok)this.diagnostics.push(diagnostic('error','VOS-E0002','unterminated literal',{file:this.file,line:l,column:c}));out.push(this.tok(kind,s,l,c));continue;} let matched='';for(const op of OPS)if(this.source.startsWith(op,this.i)){matched=op;break;}if(matched){for(let k=0;k<matched.length;k++)this.take();out.push(this.tok(SYM,matched,l,c));}else out.push(this.tok(SYM,this.take(),l,c)); }
    out.push(this.tok(END,'',this.line,this.col)); return out;
  }
}

export class VOSBrowserParser {
  constructor(file,tokens){this.file=file;this.t=tokens;this.i=0;this.diagnostics=[];}
  peek(n=0){return this.t[this.i+n]??this.t[this.t.length-1];} end(){return this.peek().kind===END;} take(){return this.end()?this.peek():this.t[this.i++];} match(x){return this.peek().text===x;} consume(x){if(this.match(x)){this.i++;return true;}return false;}
  err(t,c,m){this.diagnostics.push(diagnostic('error',c,m,t,this.file));}
  balanced(open,close){const r=[];if(!this.consume(open)){this.err(this.peek(),'VOS-E0100',`expected '${open}'`);return r;}let d=1;while(!this.end()&&d){const x=this.take();if(x.text===open)d++;else if(x.text===close){if(--d===0)break;}if(d)r.push(x);}if(d)this.err(this.peek(),'VOS-E0101','unterminated block');return r;}
  inferName(kind,h){if(kind==='import')return tokenSource(h.filter(x=>x.text!=='import'));if(kind==='comptime')return 'comptime';if(kind==='shared'||kind==='channel'){for(let i=h.length-1;i>=0;i--)if(h[i].kind===ID&&!['shared','channel','atomic'].includes(h[i].text))return h[i].text;}const skip=new Set(['domain','unit','import','hardware','machine','memoryspace','device','shared','interrupt','proc','pure','driver','process','task','channel','state','isa','target','comptime','asm','const','atomic']);for(const x of h)if(x.kind===ID&&!skip.has(x.text))return x.text;return kind;}
  decl(){const first=this.take(),kind=TOP.get(first.text)||'unknown',d={kind,name:'',header:[first],body:[],span:first};if(first.text==='pure'&&this.match('proc'))d.header.push(this.take());let par=0,ang=0,br=0;while(!this.end()){
      if(kind==='interrupt'&&!par&&!ang&&!br&&this.match('preserves')){d.header.push(this.take());const ob=this.peek();const b=this.balanced('{','}');d.header.push({...ob,text:'{'},...b,{...ob,text:'}'});continue;}
      if((kind==='proc'||kind==='asm')&&!par&&!ang&&!br&&((kind==='proc'&&(this.match('effects')||this.match('contract')))||(kind==='asm'&&(this.match('preserves')||this.match('clobbers'))))){const label=this.take();d.body.push(label);const ob=this.peek();const b=this.balanced('{','}');d.body.push({...ob,text:'{'},...b,{...ob,text:'}'});continue;}
      if(this.match('{')&&!par&&!ang&&!br){const b=this.balanced('{','}');if(kind==='proc'||kind==='asm'){d.body.push({...first,kind:ID,text:'__impl__'},{...first,text:'{'},...b,{...first,text:'}'});}else d.body=b;break;}
      if(this.match(';')&&!par&&!ang&&!br){this.take();break;}const x=this.take();if(x.text==='(')par++;else if(x.text===')')par--;else if(x.text==='<')ang++;else if(x.text==='>')ang--;else if(x.text==='[')br++;else if(x.text===']')br--;d.header.push(x);
    }d.name=this.inferName(kind,d.header);return d;}
  parse(){const p={file:this.file,vosVersion:'',decls:[],diagnostics:[]};if(this.consume('@')){if(!this.consume('vos'))this.err(this.peek(),'VOS-E0102','expected @vos language header');if(this.peek().kind===NUM)p.vosVersion=this.take().text;else this.err(this.peek(),'VOS-E0103','expected VOS version');if(!this.consume(';'))this.err(this.peek(),'VOS-E0104',"expected ';' after @vos header");}else this.err(this.peek(),'VOS-E0105','source must begin with @vos <version>;');while(!this.end()){if(this.match('@')&&this.peek(1).text==='domain'){this.take();const at=this.take();this.t.splice(this.i,0,{...at,text:'domain'});}const kind=TOP.get(this.peek().text);if(!kind){this.err(this.peek(),'VOS-E0106',`unknown top-level declaration '${this.peek().text}'`);this.take();continue;}p.decls.push(this.decl());}p.diagnostics=this.diagnostics;return p;}
}

const UNITS = [['GiB',1073741824],['MiB',1048576],['KiB',1024],['GHz',1e9],['MHz',1e6],['kHz',1e3],['Hz',1],['ms',1e6],['us',1e3],['ns',1],['B',1],['s',1e9]];
function parseQuantityToken(t){if(!t||t.kind!==NUM)return {ok:false,value:0};let s=t.text.replaceAll('_','');const typed=s.match(/^(.*?)(?:[ui](?:1|2|4|8|16|24|32|48|64|74|96|128|256))$/);if(typed)s=typed[1];if(/^0x/i.test(s))return {ok:true,value:Number.parseInt(s,16)};if(/^0b/i.test(s))return {ok:true,value:Number.parseInt(s.slice(2),2)};for(const [u,m] of UNITS)if(s.endsWith(u)&&s.length>u.length){const v=Number(s.slice(0,-u.length));return {ok:Number.isFinite(v),value:Math.trunc(v*m)};}const v=Number(s);return {ok:Number.isFinite(v),value:Math.trunc(v)};}
function findBlock(ts,name){for(let i=0;i+1<ts.length;i++)if(ts[i].text===name&&ts[i+1].text==='{'){let d=1,r=[];for(let j=i+2;j<ts.length&&d;j++){if(ts[j].text==='{')d++;else if(ts[j].text==='}'){if(--d===0)break;}if(d)r.push(ts[j]);}return r;}return [];}
function implTokens(body){return findBlock(body,'__impl__').length?findBlock(body,'__impl__'):body;}
function extractUIntAfter(h,key,def=0){for(let i=0;i+1<h.length;i++)if(h[i].text===key){const q=parseQuantityToken(h[i+1]);if(q.ok)return q.value;}return def;}
function parseProps(ts){const p={};for(let i=0;i<ts.length;){if(ts[i].kind!==ID){i++;continue;}const key=ts[i++].text;if(i<ts.length&&ts[i].text==='=')i++;const s=i;let dep=0;while(i<ts.length){if(['<','(','['].includes(ts[i].text))dep++;if(['>',')',']'].includes(ts[i].text))dep--;if(dep===0&&ts[i].text===';')break;i++;}p[key]=tokenSource(ts.slice(s,i));if(i<ts.length&&ts[i].text===';')i++;}return p;}
function parseTypeBits(text){const m=String(text).match(/^[ui](\d+)$/);return m?Number(m[1]):0;}
function numericLiteralBits(t){if(!t||t.kind!==NUM)return 0;const m=t.text.match(/[ui](\d+)$/);return m?Number(m[1]):32;}

class SemanticModel {
  constructor(program){this.program=program;this.diagnostics=[...program.diagnostics];this.domain='safe';this.imports=new Set();this.hardware={components:[],regions:[],devices:[]};this.procs=[];this.metadata=[];this.name='BrowserMachine';this.architecture='V74';this.version='1.0';}
  diag(level,code,message,t){this.diagnostics.push(diagnostic(level,code,message,t,this.program.file));}
}

function featureGate(m){for(const d of m.program.decls){if(d.kind==='domain'&&d.name==='metal')m.diag('error','VOS-B7001','@domain metal is reserved for the full native VOS toolchain',d.span);if(d.kind==='isa')m.diag('error','VOS-B7002','custom ISA declarations are native-only in Browser Demo; use vos.exe for the full V74/ISA compiler',d.span);if(d.kind==='asm')m.diag('error','VOS-B7003','raw asm/V74 assembler declarations are native-only in Browser Demo',d.span);if(d.kind==='comptime')m.diag('error','VOS-B7004','unrestricted comptime blocks are native-only in Browser Demo',d.span);if(d.kind==='target'){const h=tokenSource(d.header);if(!h.includes('target(browser)'))m.diag('error','VOS-B7005','only target(browser) is available in Browser Demo; native targets require the C++ toolchain',d.span);}for(const t of d.body)if(t.text==='unsafe')m.diag('error','VOS-B7006','unsafe(memory.raw) execution is native-only in Browser Demo',t);}}

function analyze(program){const m=new SemanticModel(program);featureGate(m);for(const d of program.decls){m.metadata.push(d);if(d.kind==='domain'){if(!['safe','kernel','metal'].includes(d.name))m.diag('error','VOS-E1001','domain must be safe, kernel, or metal',d.span);else m.domain=d.name;continue;}if(d.kind==='import'){m.imports.add(d.name);continue;}if(d.kind==='unit'){const id=findBlock(d.body,'identity');const props=parseProps(id);if(props.name)m.version=props.version||m.version;continue;}if(d.kind==='hardware'){m.name=d.name;const t=d.body;for(let i=0;i<t.length;){if(['cpu','memory','gpu'].includes(t[i].text)&&t[i+1]?.kind===ID&&t[i+2]?.text==='{'){const kind=t[i].text,name=t[i+1].text;let dep=1,b=[],j=i+3;for(;j<t.length&&dep;j++){if(t[j].text==='{')dep++;else if(t[j].text==='}'){if(--dep===0)break;}if(dep)b.push(t[j]);}const properties=parseProps(b);m.hardware.components.push({kind,name,properties});if(kind==='cpu'&&properties.isa)m.architecture=properties.isa;i=j;continue;}if(t[i].text==='architecture'&&t[i+1])m.architecture=t[i+1].text;i++;}continue;}if(d.kind==='memoryspace'){const t=d.body;for(let i=0;i<t.length;){if(t[i].text!=='region'){i++;continue;}const r={name:t[i+1]?.text||'region',address:0,size:0,alignment:0,permissions:'',cache:'',mapping:'',span:t[i]};i+=2;if(t[i]?.text==='@'){const q=parseQuantityToken(t[++i]);if(q.ok)r.address=q.value;i++;}while(i<t.length&&t[i].text!==';'){const k=t[i++].text;if(k==='size'){const q=parseQuantityToken(t[i++]);if(q.ok)r.size=q.value;}else if(k==='alignment'){const q=parseQuantityToken(t[i++]);if(q.ok)r.alignment=q.value;}else if(k==='permissions'){let s='';while(i<t.length&&!['cache','alignment','mapping',';'].includes(t[i].text))s+=t[i++].text;r.permissions=s;}else if(k==='cache')r.cache=t[i++]?.text||'';else if(k==='mapping'){const s=i;while(i<t.length&&!['permissions','alignment','cache',';'].includes(t[i].text))i++;r.mapping=tokenSource(t.slice(s,i));}else i++;}if(t[i]?.text===';')i++;if(!r.size)m.diag('error','VOS-E2004',`region '${r.name}' has zero size`,r.span);m.hardware.regions.push(r);}continue;}if(d.kind==='device'){const dev={name:d.name,mmioBase:0,mmioSize:0,registers:[]};const t=d.body;for(let i=0;i<t.length;){if(t[i].text!=='mmio'){i++;continue;}i++;if(t[i]?.kind===ID)i++;if(t[i]?.text==='@'){const q=parseQuantityToken(t[++i]);if(q.ok)dev.mmioBase=q.value;i++;}if(t[i]?.text==='size'){const q=parseQuantityToken(t[++i]);if(q.ok)dev.mmioSize=q.value;i++;}if(t[i]?.text==='{'){let dep=1;i++;while(i<t.length&&dep){if(t[i].text==='register'){const r={name:t[++i]?.text||'REG',type:'u32',offset:0,access:'rw',reset:0,volatile:false};i++;if(t[i]?.text===':'){i++;const s=i;while(i<t.length&&!['@',';'].includes(t[i].text))i++;r.type=tokenSource(t.slice(s,i));}if(t[i]?.text==='@'){i++;if(t[i]?.text==='+')i++;const q=parseQuantityToken(t[i++]);if(q.ok)r.offset=q.value;}while(i<t.length&&t[i].text!==';'){if(t[i].text==='access')r.access=t[++i]?.text||'rw';else if(t[i].text==='reset'){const q=parseQuantityToken(t[++i]);if(q.ok)r.reset=q.value;}else if(t[i].text==='volatile')r.volatile=true;i++;}if(t[i]?.text===';')i++;dev.registers.push(r);continue;}if(t[i].text==='{')dep++;else if(t[i].text==='}')dep--;i++;}}}m.hardware.devices.push(dev);continue;}if(d.kind==='proc'){const p={name:d.name,pure:d.header[0]?.text==='pure',params:[],returnType:'void',effects:new Set(),body:d.body,span:d.span};let pi=d.header.findIndex(x=>x.text==='(');if(pi>=0){let i=pi+1;while(i<d.header.length&&d.header[i].text!==')'){if(d.header[i].kind!==ID){i++;continue;}const n=d.header[i++].text;if(d.header[i]?.text!==':'){m.diag('error','VOS-E3001',`parameter '${n}' missing type`,d.header[i-1]);break;}i++;const s=i;let a=0;while(i<d.header.length){if(d.header[i].text==='<')a++;else if(d.header[i].text==='>')a--;if(a===0&&(d.header[i].text===','||d.header[i].text===')'))break;i++;}p.params.push([n,tokenSource(d.header.slice(s,i))]);if(d.header[i]?.text===',')i++;}}
      const ar=d.header.findIndex(x=>x.text==='->');if(ar>=0)p.returnType=tokenSource(d.header.slice(ar+1));const eff=findBlock(d.body,'effects');let acc='';for(const x of eff){if(x.text===';'){if(acc)p.effects.add(acc);acc='';}else acc+=x.text;}checkProcSemantics(m,p);m.procs.push(p);continue;}}
  const rs=[...m.hardware.regions].sort((a,b)=>a.address-b.address);for(let i=1;i<rs.length;i++)if(rs[i].address<rs[i-1].address+rs[i-1].size)m.diag('error','VOS-E2200',`memory regions '${rs[i-1].name}' and '${rs[i].name}' overlap`,rs[i].span);for(const r of rs)if(r.alignment&&r.address%r.alignment)m.diag('error','VOS-E2201',`region '${r.name}' address violates alignment`,r.span);return m;}

function typeInfo(text=''){const s=String(text);const bits=parseTypeBits(s)||(Number((s.match(/(?:addr|ptr|reg|bits)<[^>]*?(\d+)/)||[])[1])||0);const am=s.match(/addr<\s*([A-Za-z_][A-Za-z0-9_]*)/);return {text:s,bits,addressSpace:am?.[1]||'',isAddress:s.startsWith('addr<'),isPointer:s.startsWith('ptr<')};}
function checkProcSemantics(m,p){const t=p.body,vars=new Map(p.params.map(([n,ty])=>[n,typeInfo(ty)])),moved=new Set();
  const checkAssign=(dst,rhs,where)=>{if(!dst||!rhs?.length)return;const explicit=rhs.some(x=>x.text==='truncate'||x.text==='checked_cast');let src={text:'',bits:0,addressSpace:'',isAddress:false,isPointer:false};if(rhs.length===1){if(rhs[0].kind===NUM)src={...src,bits:numericLiteralBits(rhs[0])};else if(rhs[0].kind===ID&&vars.has(rhs[0].text))src=vars.get(rhs[0].text);}if(!explicit&&dst.bits&&src.bits&&src.bits>dst.bits)m.diag('error','VOS-E3201',`implicit narrowing from ${src.bits} bits to ${dst.bits} bits is forbidden`,where);if(!explicit&&dst.isAddress&&src.isAddress&&dst.addressSpace&&src.addressSpace&&dst.addressSpace!==src.addressSpace)m.diag('error','VOS-E3202',`address-space conversion from ${src.addressSpace} to ${dst.addressSpace} requires explicit translation`,where);if(dst.isPointer&&rhs.length===1&&rhs[0].text==='null')m.diag('error','VOS-E3203','null pointers are forbidden in strict VOS',where);};
  for(let i=0;i<t.length;i++){
    if((t[i].text==='var'||t[i].text==='bind')&&t[i+1]?.kind===ID){const name=t[i+1].text;let j=i+2;if(t[j]?.text===':'){j++;const s=j;let a=0;while(j<t.length){if(t[j].text==='<')a++;else if(t[j].text==='>')a--;if(a===0&&[':=','=','<-',';'].includes(t[j].text))break;j++;}const ty=typeInfo(tokenSource(t.slice(s,j)));vars.set(name,ty);if([':=','=','<-'].includes(t[j]?.text)){let e=j+1,dep=0;while(e<t.length){if(t[e].text==='(')dep++;else if(t[e].text===')')dep--;if(dep===0&&t[e].text===';')break;e++;}checkAssign(ty,t.slice(j+1,e),t[i]);}}}
    if(t[i].text==='move'&&t[i+1]?.kind===ID){moved.add(t[i+1].text);continue;}
    if(t[i].kind===ID&&moved.has(t[i].text)){const isMoveUse=i>0&&t[i-1].text==='move';if(!isMoveUse)m.diag('error','VOS-E3301',`use of moved value '${t[i].text}'`,t[i]);}
    if(t[i].text==='<-'){let s=i;while(s>0&&![';','{','}'].includes(t[s-1].text))s--;let lhsDevice=false;for(let j=s;j<i;j++)if(t[j].text==='.')lhsDevice=true;const eff=lhsDevice?'mmio.write':'mmio.read';if(!p.effects.has(eff))m.diag('error',lhsDevice?'VOS-E3401':'VOS-E3404',`hardware transaction requires effect ${eff}`,t[i]);}
  }
  if(p.pure&&p.effects.size)m.diag('error','VOS-E3403','pure procedure cannot declare side effects',p.span);}

function numberToJS(s){let n=s.replaceAll('_','');for(const [u,m] of UNITS)if(n.endsWith(u)&&n.length>u.length){const base=Number(n.slice(0,-u.length));if(Number.isFinite(base))return String(Math.trunc(base*m));}const mt=n.match(/^(.*?)([ui](?:64|74|96|128|256))$/);if(mt)return `BigInt(${JSON.stringify(mt[1])})`;n=n.replace(/[ui](?:1|2|4|8|16|24|32|48)$/,'');return n;}
function expr(ts,a=0,b=ts.length){if(a+4<b&&['checked_cast','truncate','widen'].includes(ts[a].text)&&ts[a+1].text==='<'){let gt=a+2,d=1;for(;gt<b;gt++){if(ts[gt].text==='<')d++;else if(ts[gt].text==='>'&&--d===0)break;}if(gt+2<b&&ts[gt+1].text==='('&&ts[b-1].text===')'){const ty=tokenSource(ts.slice(a+2,gt)),bits=Number((ty.match(/\d+/)||['0'])[0]),sign=ty.startsWith('i'),inner=expr(ts,gt+2,b-1);if(ts[a].text==='widen')return inner;return `runtime.${ts[a].text==='checked_cast'?'checkedCast':'truncate'}(${inner},${bits},${sign})`;}}
  let o='';for(let i=a;i<b;i++){let x=ts[i].text;if(ts[i].kind===NUM)x=numberToJS(x);else if(x==='::')x='.';else if(x==='move'||x==='borrow_dma')continue;else if(['checked_cast','truncate','widen'].includes(x)&&ts[i+1]?.text==='<'){let d=0;i++;for(;i+1<b;i++){if(ts[i].text==='<')d++;else if(ts[i].text==='>'&&--d===0)break;}continue;}if(i>a&&isWord(ts[i])&&isWord(ts[i-1])&&!['move','borrow_dma'].includes(ts[i-1].text))o+=' ';o+=x;}return o;}
function bodyCode(body,proc,diags,{async=false}={}){const t=implTokens(body),contract=findBlock(body,'contract'),reqs=[],ens=[];for(let c=0;c<contract.length;){if(['requires','ensures'].includes(contract[c].text)){const isReq=contract[c].text==='requires';let e=c+1;while(e<contract.length&&contract[e].text!==';')e++;(isReq?reqs:ens).push(contract.slice(c+1,e));c=e+1;}else c++;}let o='',i=0,indent=1;const ind=()=> '  '.repeat(indent);const semi=s=>{let p=0,b=0,j=s;for(;j<t.length;j++){if(t[j].text==='(')p++;else if(t[j].text===')')p--;else if(t[j].text==='[')b++;else if(t[j].text===']')b--;if(!p&&!b&&t[j].text===';')break;}return j;};for(const rq of reqs)o+=`${ind()}runtime.require(${expr(rq)},${JSON.stringify(proc+': precondition failed')});\n`;
  while(i<t.length){if(['var','bind'].includes(t[i].text)){const cn=t[i].text==='bind',sp=t[i++];if(t[i]?.kind!==ID){diags.push(diagnostic('error','VOS-E5000','expected variable name',sp));break;}const name=t[i++].text;if(t[i]?.text===':'){i++;let a=0;while(i<t.length){if(t[i].text==='<')a++;else if(t[i].text==='>')a--;if(a===0&&[':=','=','<-',';'].includes(t[i].text))break;i++;}}const op=t[i]?.text;if([':=','=','<-'].includes(op))i++;const e=semi(i);o+=`${ind()}${cn?'const':'let'} ${name}${i<e?' = '+expr(t,i,e):''};\n`;i=e<t.length?e+1:e;continue;}if(t[i].text==='return'){const e=semi(i+1);o+=`${ind()}return${i+1<e?' '+expr(t,i+1,e):''};\n`;i=e<t.length?e+1:e;continue;}if(t[i].text==='loop'&&t[i+1]?.text==='{'){o+=`${ind()}for (;;) {\n`;indent++;i+=2;continue;}if(t[i].text==='when'&&t[i+1]?.kind===ID&&t[i+2]?.text==='<-'&&t[i+3]?.kind===ID&&t[i+4]?.text==='{'){o+=`${ind()}{\n`;indent++;o+=`${ind()}const ${t[i+3].text} = await ${t[i+1].text}.receive();\n`;i+=5;continue;}if(t[i].text==='if'){let s=i+1;while(s<t.length&&t[s].text!=='{')s++;if(s>=t.length){diags.push(diagnostic('error','VOS-E5001',`malformed if in ${proc}`,t[i]));break;}o+=`${ind()}if (${expr(t,i+1,s)}) {\n`;indent++;i=s+1;continue;}if(t[i].text==='}'){indent=Math.max(1,indent-1);o+=`${ind()}}\n`;i++;continue;}if(t[i].text==='require'){const e=semi(i+1);o+=`${ind()}runtime.require(${expr(t,i+1,e)},${JSON.stringify(proc+': contract requirement failed')});\n`;i=e<t.length?e+1:e;continue;}const e=semi(i);if(e===i){i++;continue;}if(i+3<e&&t[i].text==='cpu'&&t[i+1].text==='.'&&t[i+2].text==='wait_interrupt'){o+=`${ind()}await cpu.wait_interrupt();\n`;i=e<t.length?e+1:e;continue;}let arrow=i;while(arrow<e&&t[arrow].text!=='<-')arrow++;if(arrow===i+1&&t[i].kind===ID){let rhsDevice=false;for(let q=arrow+1;q<e;q++)if(t[q].text==='.')rhsDevice=true;if(!rhsDevice){o+=`${ind()}${t[i].text}.send(${expr(t,arrow+1,e)});\n`;i=e<t.length?e+1:e;continue;}}const x=t.slice(i,e).map(z=>({...z,text:z.text===':='||z.text==='<-'?'=':z.text}));o+=`${ind()}${expr(x)};\n`;i=e<t.length?e+1:e;}
  return o;}

function manifestFor(m,hash){return {name:m.name,version:m.version,architecture:m.architecture||'V74',domain:m.domain,sourceHash:hash,compiler:{name:BROWSER_DEMO_PROFILE.name,version:BROWSER_DEMO_PROFILE.version,profile:'browser-demo',featureCoverage:BROWSER_DEMO_PROFILE.approximateFeatureCoverage,nativeOnly:[...BROWSER_DEMO_PROFILE.nativeOnly]},hardware:{components:m.hardware.components,regions:m.hardware.regions.map(({span,...r})=>r),devices:m.hardware.devices},functions:m.procs.map(p=>({name:p.name,returnType:p.returnType,pure:p.pure,effects:[...p.effects]})),metadata:m.metadata.map(d=>({kind:d.kind,name:d.name,header:tokenSource(d.header),body:tokenSource(d.body)}))};}

function methodBlock(d,name){const t=d.body;for(let i=0;i<t.length;i++)if(t[i].text===name&&t[i+1]?.text==='('){let q=i+2,params=[];while(q<t.length&&t[q].text!==')'){if(t[q].kind===ID){params.push(t[q].text);while(q<t.length&&t[q].text!==','&&t[q].text!==')')q++;if(t[q]?.text===',')q++;}else q++;}if(name==='detach'&&!params.length)params=['device'];while(q<t.length&&t[q].text!=='{')q++;if(q>=t.length)return null;let dep=1,b=[];for(let z=q+1;z<t.length&&dep;z++){if(t[z].text==='{')dep++;else if(t[z].text==='}'){if(--dep===0)break;}if(dep)b.push(t[z]);}return {params,body:b};}return null;}
function processEntry(d){const t=d.body;for(let i=0;i<t.length;i++)if(t[i].text==='entry'&&t[i+1]?.kind===ID){const name=t[i+1].text;let q=i+2,params=[];if(t[q]?.text==='('){q++;while(q<t.length&&t[q].text!==')'){if(t[q].kind===ID){params.push(t[q].text);while(q<t.length&&t[q].text!==','&&t[q].text!==')')q++;if(t[q]?.text===',')q++;}else q++;}}while(q<t.length&&t[q].text!=='{')q++;if(q>=t.length)return null;let dep=1,b=[];for(let z=q+1;z<t.length&&dep;z++){if(t[z].text==='{')dep++;else if(t[z].text==='}'){if(--dep===0)break;}if(dep)b.push(t[z]);}return {name,params,body:b};}return null;}
function emitJS(m,manifest,diags){let o=`// Generated by VOS Browser Compiler ${BROWSER_DEMO_PROFILE.version}\nexport async function installVOSModule(runtime) {\n  const manifest = ${JSON.stringify(manifest)};\n  runtime.installManifest(manifest);\n  const memory=runtime.memoryAPI, scheduler=runtime.schedulerAPI, interrupts=runtime.interruptAPI, cpu=runtime.cpuAPI, drivers=runtime.driverAPI;\n  const graphics=runtime.module("graphics"), display=runtime.module("display"), input=runtime.module("input"), filesystem=runtime.module("filesystem"), terminal=runtime.module("terminal"), compositor=runtime.module("compositor"), desktop=runtime.module("desktop"), disk=runtime.module("disk"), network=runtime.module("network"), audio=runtime.module("audio");\n`;
  for(const d of m.hardware.devices)o+=`  const ${d.name} = runtime.device(${JSON.stringify(d.name)});\n`;
  for(const d of m.metadata)if(d.kind==='channel'){let cap=1024;const comma=d.header.findIndex(x=>x.text===',');if(comma>=0)cap=parseQuantityToken(d.header[comma+1]).value||1024;o+=`  const ${d.name} = runtime.channel(${JSON.stringify(d.name)},${cap});\n`;}
  for(const d of m.metadata)if(d.kind==='process'){const en=processEntry(d);if(en){o+=`  runtime.registerProcess(${JSON.stringify(d.name)}, async function(${en.params.join(',')}){\n${bodyCode([{kind:ID,text:'__impl__'},{kind:SYM,text:'{'},...en.body,{kind:SYM,text:'}'}],d.name+'::'+en.name,diags,{async:true})}  });\n`;}}
  for(const d of m.metadata)if(d.kind==='task'){o+=`  runtime.registerTask(${JSON.stringify(d.name)}, async function(){\n${bodyCode([{kind:ID,text:'__impl__'},{kind:SYM,text:'{'},...d.body,{kind:SYM,text:'}'}],d.name,diags,{async:true})}  });\n`;}
  for(const d of m.metadata)if(d.kind==='driver'){let target='';for(let i=0;i+2<d.header.length;i++)if(d.header[i].text==='device'&&d.header[i+1].text==='<'){target=d.header[i+2].text;break;}const methods=[];for(const n of ['attach','detach']){const mb=methodBlock(d,n);if(mb)methods.push(`${n}:async function(${mb.params.join(',')}){\n${bodyCode([{kind:ID,text:'__impl__'},{kind:SYM,text:'{'},...mb.body,{kind:SYM,text:'}'}],d.name+'::'+n,diags,{async:true})}  }`);}o+=`  runtime.registerDriver(${JSON.stringify(d.name)},${JSON.stringify(target)},{${methods.join(',')}});\n`;}
  for(const d of m.metadata)if(d.kind==='machine'){const t=d.body;let initial='';for(let i=0;i+1<t.length;i++)if(t[i].text==='state'&&t[i+1].kind===ID){initial=t[i+1].text;break;}o+='  { const __transitions=new Map();\n';for(let i=0;i+5<t.length;i++)if(t[i].kind===ID&&t[i+1].text==='--['){const from=t[i].text;let eve=i+2;while(eve<t.length&&t[eve].text!==']')eve++;if(t[eve+1]?.text!=='-->'||t[eve+2]?.kind!==ID)continue;const event=tokenSource(t.slice(i+2,eve)).replaceAll('::','.');const to=t[eve+2].text;let q=eve+3;while(q<t.length&&t[q].text!=='{')q++;let dep=1,b=[];for(let z=q+1;z<t.length&&dep;z++){if(t[z].text==='{')dep++;else if(t[z].text==='}'){if(--dep===0)break;}if(dep)b.push(t[z]);}o+=`    __transitions.set(${JSON.stringify(from+':'+event)},{to:${JSON.stringify(to)},action:async function(payload){\n${bodyCode([{kind:ID,text:'__impl__'},{kind:SYM,text:'{'},...b,{kind:SYM,text:'}'}],d.name+'::'+from,diags,{async:true})}    }});\n`;i=q;}o+=`    runtime.registerStateMachine(${JSON.stringify(d.name)},${JSON.stringify(initial)},__transitions); }\n`;}
  for(const p of m.procs){const async=p.body.some(x=>['wait_interrupt','when'].includes(x.text));o+=`  ${async?'async ':''}function ${p.name}(${p.params.map(x=>x[0]).join(',')}){\n${bodyCode(p.body,p.name,diags,{async})}  }\n`;}
  for(const p of m.procs)o+=`  runtime.registerProcedure(${JSON.stringify(p.name)},${p.name});\n`;
  for(const d of m.metadata)if(d.kind==='interrupt'){const v=extractUIntAfter(d.header,'vector',0);o+=`  runtime.registerInterrupt(${v},${JSON.stringify(d.name)}, async function(){\n${bodyCode([{kind:ID,text:'__impl__'},{kind:SYM,text:'{'},...d.body,{kind:SYM,text:'}'}],d.name,diags,{async:true})}  });\n`;}
  o+='  return manifest;\n}\n';return o;}

function uleb(v){const a=[];v>>>=0;do{let b=v&127;v>>>=7;if(v)b|=128;a.push(b);}while(v);return a;}
function sleb(v){const a=[];v|=0;let more=true;while(more){let b=v&127;v>>=7;const sign=b&64;more=!((v===0&&!sign)||(v===-1&&sign));if(more)b|=128;a.push(b);}return a;}
function wasmSection(id,payload){return [id,...uleb(payload.length),...payload];}
class WasmExpr {constructor(tokens,params){this.t=tokens;this.i=0;this.e=tokens.length;this.locals=new Map(params.map((p,i)=>[p[0],i]));this.ok=true;this.code=[];}prec(x){return {'|':1,'^':1,'&':2,'<<':3,'>>':3,'+':4,'-':4,'*':5,'/':5}[x]??-1;}primary(){if(this.i>=this.e){this.ok=false;return;}const x=this.t[this.i++];if(x.text==='('){this.expr(0);if(this.t[this.i++]?.text!==')')this.ok=false;return;}if(x.kind===NUM){let s=x.text.replaceAll('_','').replace(/[ui]\d+$/,'');const n=/^0x/i.test(s)?Number.parseInt(s,16):Number(s);if(!Number.isFinite(n)){this.ok=false;return;}this.code.push(0x41,...sleb(n|0));return;}if(this.locals.has(x.text)){this.code.push(0x20,...uleb(this.locals.get(x.text)));return;}this.ok=false;}expr(min){this.primary();while(this.i<this.e){const op=this.t[this.i].text,p=this.prec(op);if(p<min)break;this.i++;this.expr(p+1);const m={'+':0x6a,'-':0x6b,'*':0x6c,'/':0x6e,'&':0x71,'|':0x72,'^':0x73,'<<':0x74,'>>':0x76};if(!(op in m)){this.ok=false;return;}this.code.push(m[op]);}}}
function emitWasm(m){const fs=[];for(const p of m.procs){if(!p.pure||!['u32','i32'].includes(p.returnType)||p.params.some(x=>!['u32','i32'].includes(x[1])))continue;const b=implTokens(p.body);const r=b.findIndex(x=>x.text==='return');if(r<0)continue;let e=r+1;while(e<b.length&&b[e].text!==';')e++;const ep=new WasmExpr(b.slice(r+1,e),p.params);ep.expr(0);if(!ep.ok||ep.i!==ep.e)continue;ep.code.push(0x0b);fs.push({p,code:ep.code});}let out=[0,97,115,109,1,0,0,0];if(!fs.length)return new Uint8Array(out);let types=[...uleb(fs.length)];for(const f of fs)types.push(0x60,...uleb(f.p.params.length),...f.p.params.map(()=>0x7f),...uleb(1),0x7f);out.push(...wasmSection(1,types));let funcs=[...uleb(fs.length)];for(let i=0;i<fs.length;i++)funcs.push(...uleb(i));out.push(...wasmSection(3,funcs));let ex=[...uleb(fs.length)];for(let i=0;i<fs.length;i++){const n=TE.encode(fs[i].p.name);ex.push(...uleb(n.length),...n,0,...uleb(i));}out.push(...wasmSection(7,ex));let codes=[...uleb(fs.length)];for(const f of fs){const b=[0,...f.code];codes.push(...uleb(b.length),...b);}out.push(...wasmSection(10,codes));return new Uint8Array(out);}

function w16(a,v){a.push(v&255,(v>>>8)&255);}function w32(a,v){for(let i=0;i<4;i++)a.push((v>>>8*i)&255);}function w64(a,v){let n=BigInt(v);for(let i=0;i<8;i++){a.push(Number(n&255n));n>>=8n;}}
function container(magic,sections){const a=[...TE.encode(magic)];w16(a,1);w16(a,0);w32(a,sections.length);let off=12+sections.length*32;for(const s of sections){const n=new Uint8Array(16);n.set(TE.encode(s.name).slice(0,15));a.push(...n);w64(a,off);w64(a,s.data.length);off+=s.data.length;}for(const s of sections)a.push(...s.data);return new Uint8Array(a);}
function bytes(x){return typeof x==='string'?TE.encode(x):x instanceof Uint8Array?x:new Uint8Array(x);}

async function sourceHash(source,core){let h=0x811c9dc5>>>0;const b=TE.encode(source);for(const x of b)h=core?core.fnv1a_step(h,x)>>>0:Math.imul((h^x)>>>0,16777619)>>>0;let h2=core?core.mix32(h,b.length)>>>0:(h^b.length)>>>0;return h.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');}

export class VOSBrowserCompiler {
  constructor(options={}){this.options=options;this.profile=BROWSER_DEMO_PROFILE;}
  async compile(source, options={}){
    const file=options.file||'<browser>.vos', core=await loadCore(options.coreURL).catch(()=>null);const lx=new VOSBrowserLexer(file,source),tokens=lx.lex();const ps=new VOSBrowserParser(file,tokens),program=ps.parse();program.diagnostics.unshift(...lx.diagnostics);const sem=analyze(program);const hash=await sourceHash(source,core);const diagnostics=[...sem.diagnostics];const hasErrors=()=>diagnostics.some(d=>d.level==='error');if(hasErrors())return {success:false,diagnostics,profile:this.profile,program,semantic:sem};
    const manifest=manifestFor(sem,hash),manifestJson=JSON.stringify(manifest,null,2),moduleJS=emitJS(sem,manifest,diagnostics);if(hasErrors())return {success:false,diagnostics,profile:this.profile,program,semantic:sem};const wasm=emitWasm(sem);const debugJson=JSON.stringify({sourceHash:hash,compiler:'browser-demo',symbols:sem.procs.map(p=>({name:p.name,kind:'procedure'}))},null,2);const libraryJson=JSON.stringify({module:sem.name,abi:1,profile:'browser-demo',exports:sem.procs.map(p=>p.name)},null,2);const emptyV74=new Uint8Array();const vhw=container('VHW0',[{name:'manifest',data:bytes(manifestJson)}]);const vlib=container('VLIB',[{name:'exports',data:bytes(libraryJson)},{name:'wasm',data:wasm},{name:'asm.v74',data:emptyV74}]);const vdbg=container('VDBG',[{name:'symbols',data:bytes(debugJson)}]);const vimg=container('VIMG',[{name:'manifest',data:bytes(manifestJson)},{name:'module.js',data:bytes(moduleJS)},{name:'module.wasm',data:wasm},{name:'asm.v74',data:emptyV74}]);const vxe=container('VXE0',[{name:'manifest',data:bytes(manifestJson)},{name:'module.js',data:bytes(moduleJS)},{name:'module.wasm',data:wasm},{name:'asm.v74',data:emptyV74},{name:'debug',data:bytes(debugJson)}]);const stem=(options.name||sem.name||'browser-os').replace(/[^A-Za-z0-9_.-]/g,'_');return {success:true,diagnostics,profile:this.profile,manifest,manifestJson,moduleJS,wasm,v74:emptyV74,debugJson,libraryJson,artifacts:{'manifest.json':bytes(manifestJson),'module.js':bytes(moduleJS),'module.wasm':wasm,'module.v74.bin':emptyV74,'symbols.json':bytes(debugJson),'library.json':bytes(libraryJson),[`${stem}.vhw`]:vhw,[`${stem}.vimg`]:vimg,[`${stem}.vxe`]:vxe,[`${stem}.vlib`]:vlib,[`${stem}.vdbg`]:vdbg},program,semantic:sem};
  }
}

export async function compileVOS(source,options={}){return new VOSBrowserCompiler(options).compile(source,options);}

export async function moduleFromBuild(build){if(!build?.success)throw new Error('Cannot load failed VOS build');const url=URL.createObjectURL(new Blob([build.moduleJS],{type:'text/javascript'}));try{return await import(url);}finally{URL.revokeObjectURL(url);}}

export function downloadArtifact(build,name){const data=build?.artifacts?.[name];if(!data)throw new Error(`Unknown build artifact ${name}`);const blob=new Blob([data],{type:name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'application/octet-stream'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
