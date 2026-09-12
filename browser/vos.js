/* VOS Browser SDK 0.3 — public browser API */
import { VOSRuntime, bootVOS } from './vos-runtime.js';
import { VOSBrowserCompiler, BROWSER_DEMO_PROFILE, moduleFromBuild, downloadArtifact } from './vos-compiler.js';

export { VOSRuntime, bootVOS, VOSBrowserCompiler, BROWSER_DEMO_PROFILE, downloadArtifact };

export class VOSBuild {
  constructor(raw){Object.assign(this,raw);}
  listArtifacts(){return Object.keys(this.artifacts||{});}
  bytes(name){const b=this.artifacts?.[name];if(!b)throw new Error(`artifact not found: ${name}`);return b;}
  download(name){downloadArtifact(this,name);}
  downloadAll(){for(const name of this.listArtifacts())this.download(name);}
  async loadModule(){return await moduleFromBuild(this);}
}

export class VOS {
  static profile = BROWSER_DEMO_PROFILE;

  static async compile(source,options={}){
    const result=await new VOSBrowserCompiler(options).compile(source,options);
    return new VOSBuild(result);
  }

  static create(options={}){
    const runtime=new VOSRuntime(options);
    if(options.canvas)runtime.display.attach(options.canvas);
    return runtime;
  }

  static async boot(build,{runtime=null,canvas=null,entry='kernel_main',args=[0],runtimeOptions={}}={}){
    if(!build?.success)throw new Error('VOS build contains compilation errors');
    runtime=runtime||this.create({...runtimeOptions,canvas});
    const module=await build.loadModule();
    await bootVOS({module,runtime,wasmBytes:build.wasm,entry,args});
    return runtime;
  }

  static async compileAndBoot(source,options={}){
    const build=await this.compile(source,options.compile||options);
    if(!build.success)return {build,runtime:null};
    const runtime=await this.boot(build,{runtime:options.runtime,canvas:options.canvas,entry:options.entry||'kernel_main',args:options.args||[0],runtimeOptions:options.runtimeOptions||{}});
    return {build,runtime};
  }
}

export default VOS;
