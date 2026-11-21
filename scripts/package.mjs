#!/usr/bin/env node
/**
 * Package dist/ into a clean Chrome Web Store & Microsoft Edge Add-ons .zip archive.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DIST = join(ROOT, 'dist');
const RELEASE = join(ROOT, 'release');

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('✖ dist/manifest.json not found. Run `npm run build` first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const outName = `marklet-v${pkg.version}.zip`;
const outPath = join(RELEASE, outName);

mkdirSync(RELEASE, { recursive: true });
rmSync(outPath, { force: true });

execFileSync('zip', ['-r', '-q', outPath, '.', '-x', '*.DS_Store', '*.map'], {
  cwd: DIST,
  stdio: 'inherit',
});

const sizeKb = (statSync(outPath).size / 1024).toFixed(1);
console.log(`✔ Packaged store archive -> release/${outName} (${sizeKb} KB)`);
