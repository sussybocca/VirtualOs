/* VOS Browser SDK 0.5 — VOS ABI 2 + PAGE ABI 1 */
import { VOSRuntime, bootVOS } from './vos-runtime.js';
import { VOSBrowserCompiler, BROWSER_DEMO_PROFILE, moduleFromBuild, downloadArtifact } from './vos-compiler.js';
import { VOSPageCompiler, compilePage, PAGE_LIMITS, PAGE_PERMISSIONS } from './vos-page.js';

export { VOSRuntime, bootVOS, VOSBrowserCompiler, BROWSER_DEMO_PROFILE, downloadArtifact, VOSPageCompiler, compilePage, PAGE_LIMITS, PAGE_PERMISSIONS };
const TE=new TextEncoder();

export class VOSBuild {
  constructor(raw){Object.assign(this,raw);}
  listArtifacts(){return Object.keys(this.artifacts||{});}
  bytes(name){const b=this.artifacts?.[name];if(!b)throw new Error(`artifact not found: ${name}`);return b;}
  download(name){downloadArtifact(this,name);}
  downloadAll(){for(const name of this.listArtifacts())this.download(name);}
  async loadModule(){return await moduleFromBuild(this);}
}

function normalizeProjectFiles(files){
  const out=new Map();
  if(files instanceof Map){for(const [name,content] of files)out.set(String(name),String(content));}
  else if(Array.isArray(files)){for(const f of files)out.set(String(f.name||f.path),String(f.content??f.source??''));}
  else if(files&&typeof files==='object'){for(const [name,content] of Object.entries(files))out.set(String(name),String(content));}
  else throw new TypeError('compileProject requires a Map, object, or [{name,content}]');
  return out;
}
function baseName(path){return String(path).replaceAll('\\','/').split('/').pop();}
function projectDiag(level,code,message,file='<project>'){return {level,code,message,file,line:1,column:1};}

export class VOS {
  static profile = BROWSER_DEMO_PROFILE;

  static async compile(source,options={}){
    const result=await new VOSBrowserCompiler(options).compile(source,options);
    return new VOSBuild(result);
  }

  static async compilePage(source,options={}){
    return compilePage(source,options);
  }

  static async compileProject(files,options={}){
    const project=normalizeProjectFiles(files), strict=options.strictPages!==false;
    const vosFiles=[...project.keys()].filter(x=>x.toLowerCase().endsWith('.vos')).sort();
    const main=options.main||vosFiles.find(x=>baseName(x).toLowerCase()==='main.vos')||vosFiles[0];
    if(!main||!project.has(main))return new VOSBuild({success:false,diagnostics:[projectDiag('error','VOS-P1000','project requires a .vos entry file')],artifacts:{},projectFiles:project});

    const base=await this.compile(project.get(main),{...options,file:main,name:options.name||baseName(main).replace(/\.vos$/i,'')});
    if(!base.success){base.projectFiles=project;return base;}
    const diagnostics=[...base.diagnostics],vosResults=[{file:main,build:base}],pageResults=[],pageFiles=[];

    // Every .vos file is parsed/semantically checked independently. App declarations
    // from auxiliary VOS modules are merged into the project manifest.
    for(const file of vosFiles){
      if(file===main)continue;
      const b=await this.compile(project.get(file),{...options,file,name:baseName(file).replace(/\.vos$/i,'')});
      vosResults.push({file,build:b});
      diagnostics.push(...(b.diagnostics||[]));
    }
    const mergedApps=[],appOwner=new Map();
    for(const {file,build} of vosResults){
      if(!build.success)continue;
      for(const raw of build.manifest?.apps||[]){
        const app={...raw,capabilities:[...(raw.capabilities||[])],pages:[...(raw.pages||[])]};
        if(appOwner.has(app.id)){diagnostics.push(projectDiag('error','VOS-P1010',`duplicate app id '${app.id}' in '${file}' and '${appOwner.get(app.id)}'`,file));continue;}
        appOwner.set(app.id,file);mergedApps.push(app);
      }
    }
    const apps=new Map(mergedApps.map(a=>[a.id,a]));

    for(const [name,source] of project){
      if(!name.toLowerCase().endsWith('.page'))continue;
      let r=new VOSPageCompiler().compile(source,{file:name});
      const app=apps.get(r.ast?.appId);
      if(app)r=new VOSPageCompiler().compile(source,{file:name,appCapabilities:app.capabilities||[]});
      else diagnostics.push(projectDiag('error','VOS-P1001',`.page file '${name}' targets unknown app '${r.ast?.appId||'?'}'`,name));
      diagnostics.push(...r.diagnostics);pageResults.push(r);
      if(r.success)pageFiles.push({file:name,appId:r.ast.appId,pages:r.pages,sourceBytes:r.sourceBytes});
    }

    // Route names are unique per app across the entire project, even when an app
    // spreads features across many .page files.
    const routeOwners=new Map();
    for(const pf of pageFiles)for(const page of pf.pages||[]){
      const key=`${pf.appId}\u0000${page.route}`;
      if(routeOwners.has(key))diagnostics.push(projectDiag('error','VOS-P1006',`duplicate route '${page.route}' for app '${pf.appId}' in '${pf.file}' and '${routeOwners.get(key)}'`,pf.file));
      else routeOwners.set(key,pf.file);
    }

    const pageNames=new Set(pageFiles.map(x=>x.file));
    const basenameIndex=new Map();
    for(const pf of pageFiles){const b=baseName(pf.file);if(!basenameIndex.has(b))basenameIndex.set(b,pf.file);else basenameIndex.set(b,null);}
    for(const app of mergedApps){
      const refs=(Array.isArray(app.pages)?app.pages:String(app.pages||app.file||'').split(',')).map(x=>String(x).trim()).filter(Boolean);
      const resolved=[];
      for(const ref of refs){
        const exact=pageNames.has(ref)?ref:basenameIndex.get(baseName(ref));
        if(!exact)diagnostics.push(projectDiag('error','VOS-P1002',`app '${app.id}' references missing or ambiguous PAGE file '${ref}'`,appOwner.get(app.id)||main));
        else if(!resolved.includes(exact))resolved.push(exact);
      }
      if(strict&&!resolved.length)diagnostics.push(projectDiag('error','VOS-P1003',`app '${app.id}' must declare at least one .page file`,appOwner.get(app.id)||main));
      if(resolved.length){
        app.pages=resolved;
        app.entryPage=(pageNames.has(app.entryPage)?app.entryPage:basenameIndex.get(baseName(app.entryPage)))||resolved[0];
        app.renderer='page';app.kind='page';app.pageStrict=true;
      }
      for(const f of resolved){const pf=pageFiles.find(x=>x.file===f);if(pf&&pf.appId!==app.id)diagnostics.push(projectDiag('error','VOS-P1004',`PAGE '${f}' belongs to '${pf.appId}', not '${app.id}'`,f));}
    }
    for(const pf of pageFiles)if(!mergedApps.some(a=>(a.pages||[]).includes(pf.file)))diagnostics.push(projectDiag('warning','VOS-P1005',`PAGE '${pf.file}' is compiled but not referenced by its app`,pf.file));

    const success=!diagnostics.some(d=>d.level==='error');
    const manifest={...base.manifest,apps:mergedApps,pageABI:1,pageFiles,vosModules:vosResults.map(({file,build})=>({file,success:!!build.success,name:build.manifest?.name||baseName(file),apps:build.manifest?.apps?.length||0})),project:{main,strictPages:strict,fileCount:project.size,vosFileCount:vosFiles.length,pageFileCount:pageFiles.length}};
    const manifestJson=JSON.stringify(manifest,null,2);
    const oldInline=JSON.stringify(base.manifest),newInline=JSON.stringify(manifest);
    const moduleJS=String(base.moduleJS||'').replace(`const manifest = ${oldInline};`,`const manifest = ${newInline};`);
    const artifacts={...base.artifacts,'manifest.json':TE.encode(manifestJson),'module.js':TE.encode(moduleJS),'page-index.json':TE.encode(JSON.stringify({pageABI:1,files:pageFiles},null,2)),'project-index.json':TE.encode(JSON.stringify({main,vosFiles,pageFiles:pageFiles.map(x=>x.file),apps:mergedApps.map(a=>a.id)},null,2))};
    for(const pf of pageFiles)artifacts[`pages/${baseName(pf.file)}.json`]=TE.encode(JSON.stringify(pf,null,2));
    return new VOSBuild({...base,success,diagnostics,manifest,manifestJson,moduleJS,artifacts,projectFiles:project,pageResults,vosResults,pageABI:1});
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
