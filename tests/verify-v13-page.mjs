import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOS, compilePage, PAGE_LIMITS } from '../browser/vos.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../examples/page-project');
const files={};
async function walk(dir){for(const name of await readdir(dir)){const abs=path.join(dir,name),st=await stat(abs);if(st.isDirectory())await walk(abs);else if(/\.(vos|page)$/i.test(name))files[path.relative(root,abs).replaceAll('\\','/')]=await readFile(abs,'utf8');}}
await walk(root);

const build=await VOS.compileProject(files,{main:'main.vos',strictPages:true,name:'VIR-PAGE'});
assert.equal(build.success,true,build.diagnostics.map(d=>`${d.level}[${d.code}] ${d.file}: ${d.message}`).join('\n'));
assert.equal(build.manifest.abi,2);
assert.equal(build.manifest.pageABI,1);
assert.equal(build.manifest.apps.length,12);
assert.equal(build.manifest.pageFiles.length,13);
assert.ok(build.manifest.apps.every(a=>a.renderer==='page'&&a.pageStrict===true&&a.pages.length>=1));
assert.ok(build.artifacts['page-index.json']?.byteLength>100);
assert.ok(build.artifacts['pages/notes.page.json']?.byteLength>100);

const valid=compilePage(files['pages/app-lab.page'],{file:'pages/app-lab.page',appCapabilities:build.manifest.apps.find(a=>a.id==='app-lab').capabilities});
assert.equal(valid.success,true,valid.diagnostics.map(d=>d.message).join('\n'));
assert.ok(valid.pages[0].budget.renderMs<=PAGE_LIMITS.renderMs);

const tooSlow=files['pages/app-lab.page'].replace('render <= 12ms;','render <= 17ms;');
const rejected=compilePage(tooSlow,{file:'slow.page',appCapabilities:build.manifest.apps.find(a=>a.id==='app-lab').capabilities});
assert.equal(rejected.success,false);
assert.ok(rejected.diagnostics.some(d=>d.code==='PAGE-E0900'));

const missing={...files};delete missing['pages/app-lab.page'];
const missingBuild=await VOS.compileProject(missing,{main:'main.vos',strictPages:true});
assert.equal(missingBuild.success,false);
assert.ok(missingBuild.diagnostics.some(d=>d.code==='VOS-P1002'));


const missingPerm=files['pages/app-lab.page'].replace('permissions {\n        ui.draw;\n        ui.input;\n        events.emit;\n    }','permissions {\n        ui.draw;\n        ui.input;\n    }');
const denied=compilePage(missingPerm,{file:'missing-perm.page',appCapabilities:build.manifest.apps.find(a=>a.id==='app-lab').capabilities});
assert.equal(denied.success,false);
assert.ok(denied.diagnostics.some(d=>d.code==='PAGE-E0913'));

const auxVos=`@vos 1.0;
@domain safe;
app AuxModuleApp { id = "aux-module"; title = "Aux Module"; renderer = "page"; capabilities = "ui.draw,ui.input,events.emit"; pages = "pages/aux-module.page"; entryPage = "pages/aux-module.page"; pageStrict = true; }`;
const auxPage=`@page 1.0;
app "aux-module";
page Home route "/" { budget { startup <= 80ms; render <= 10ms; event <= 20ms; action <= 30ms; total <= 900ms; ops <= 2000; memory <= 1MiB; } permissions { ui.draw; ui.input; events.emit; } state { count: i32 = 0; } view { heading "Aux Module"; button "Pulse" -> pulse; } action pulse timeout 12ms ops 16 { inc count 1; emit "aux:pulse"; invalidate; } }`;
const extended={...files,'apps/aux-module.vos':auxVos,'pages/aux-module.page':auxPage};
const extendedBuild=await VOS.compileProject(extended,{main:'main.vos',strictPages:true,name:'VIR-PAGE-MULTI-VOS'});
assert.equal(extendedBuild.success,true,extendedBuild.diagnostics.map(d=>`${d.level}[${d.code}] ${d.file}: ${d.message}`).join('\n'));
assert.equal(extendedBuild.manifest.apps.length,13);
assert.equal(extendedBuild.manifest.pageFiles.length,14);
assert.equal(extendedBuild.manifest.project.vosFileCount,2);
assert.ok(extendedBuild.manifest.apps.some(a=>a.id==='aux-module'));

const duplicateRoutes={...files,'pages/notes-settings-copy.page':files['pages/notes-settings.page']};
const duplicateRouteBuild=await VOS.compileProject(duplicateRoutes,{main:'main.vos',strictPages:true});
assert.equal(duplicateRouteBuild.success,false);
assert.ok(duplicateRouteBuild.diagnostics.some(d=>d.code==='VOS-P1006'));

const runtime=VOS.create({shared:false,hotMemoryMB:16});
const mod=await build.loadModule();
await runtime.installGenerated(mod);
assert.equal(runtime.pages.stats().files,13);
assert.equal(runtime.desktop.apps.length,12);
assert.ok(runtime.desktop.renderers.has('page'));
const app=runtime.desktop.app('app-lab');
assert.equal(app.entryPage,'pages/app-lab.page');

console.log(`VOS PAGE ABI 1 verification passed: ${build.manifest.apps.length} apps / ${build.manifest.pageFiles.length} PAGE files; multi-VOS merge + strict policy tests passed`);
