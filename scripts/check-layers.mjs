#!/usr/bin/env node
/**
 * Architecture guard for the three-layer layout:
 *
 *   src/core/       pure front-end engine. MUST NOT touch chrome.* / browser.* APIs,
 *                   and may only import *types* from src/adapters/types.ts.
 *   src/adapters/   pluggable implementations. MUST NOT touch chrome.* or import src/extension.
 *   src/extension/  browser shell. Free to use anything.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC_EXT = /\.(ts|tsx|js|jsx|mjs)$/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : SRC_EXT.test(name) ? [p] : [];
  });
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const errors = [];
const extensionApi = /\b(chrome|browser)\s*\.\s*[a-zA-Z]/;
const importRe = /(import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g;

for (const layer of ['core', 'adapters']) {
  for (const file of walk(join(ROOT, 'src', layer))) {
    const rel = relative(ROOT, file);
    const code = stripComments(readFileSync(file, 'utf-8'));

    code.split('\n').forEach((line, i) => {
      if (extensionApi.test(line)) errors.push(`${rel}:${i + 1}  uses browser extension API -> ${line.trim()}`);
    });

    for (const m of code.matchAll(importRe)) {
      const spec = m[3];
      const isTypeOnly = Boolean(m[2]);
      if (spec.includes('/extension')) errors.push(`${rel}  imports from extension layer: '${spec}'`);
      if (layer === 'core' && spec.includes('/adapters')) {
        const okTarget = /\/adapters\/types(\.ts)?$/.test(spec);
        if (!okTarget || !isTypeOnly) {
          errors.push(`${rel}  core may only \`import type\` from adapters/types: '${spec}'`);
        }
      }
    }
  }
}

if (errors.length) {
  console.error('\n✖ Layer check failed:\n  ' + errors.join('\n  ') + '\n');
  process.exit(1);
}
console.log('✔ Layer check passed (core/adapters are free of chrome.* and respect boundaries)');
