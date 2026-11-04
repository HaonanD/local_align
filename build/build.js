'use strict';

const fs = require('fs');
const path = require('path');

const dir = __dirname;
const template = fs.readFileSync(path.join(dir, 'app-template.html'), 'utf8');
const miniWasi = fs.readFileSync(path.join(dir, 'mini-wasi.js'), 'utf8');
const wasm = fs.readFileSync(path.join(dir, 'clustalo-strip.wasm'));
const wasmBase64 = wasm.toString('base64');

let html = template;
html = html.replace('/*__MINI_WASI__*/', () => miniWasi);
html = html.replace('__WASM_BASE64__', () => wasmBase64);

const output = path.join(dir, '..', 'local_align.html');
fs.writeFileSync(output, html);
console.log(`Wrote ${output} (${(html.length / 1024).toFixed(0)} KB)`);
