import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VOSBrowserCompiler, BROWSER_DEMO_PROFILE } from '../browser/vos-compiler.js';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('../examples/VIR-browser.vos', import.meta.url), 'utf8');
const compiler = new VOSBrowserCompiler({ file: 'examples/VIR-browser.vos' });
const result = await compiler.compile(source, { file: 'examples/VIR-browser.vos', name: 'VIR-browser' });

assert.equal(result.success, true, result.diagnostics?.map(d => `${d.level}[${d.code}] ${d.message}`).join('\n'));
assert.equal(result.manifest.abi, 2);
assert.ok(result.manifest.apps.length >= 10, `expected >=10 apps, got ${result.manifest.apps.length}`);
assert.equal(new Set(result.manifest.apps.map(a => a.id)).size, result.manifest.apps.length, 'app ids must be unique');
assert.ok(result.manifest.apps.some(a => a.renderer === 'panel'), 'generic panel renderer app missing');
assert.ok(result.manifest.apps.some(a => a.id === 'app-lab'), 'AppLab manifest app missing');
assert.ok(result.artifacts['module.wasm']?.byteLength > 8, 'browser compiler module.wasm missing');
assert.ok(result.artifacts['VIR-browser.vxe']?.byteLength > 32, 'VXE artifact missing');

const coreBytes = await readFile(new URL('../browser/vos-compiler.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(coreBytes, {});
const ex = instance.exports;
assert.equal(ex.vos_app_abi_version(), 2);
assert.ok(ex.vos_max_apps() >= 4096);
assert.ok(ex.vos_core_version() >= 0x000400);
assert.equal(ex.vos_validate_app_flags(0x0f), 1);
assert.equal(ex.vos_validate_app_flags(0x10), 0);

console.log(`VOS ${BROWSER_DEMO_PROFILE.version} verification passed`);
console.log(`ABI=${result.manifest.abi} apps=${result.manifest.apps.length} wasm=${coreBytes.byteLength} bytes`);
