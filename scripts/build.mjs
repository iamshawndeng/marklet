#!/usr/bin/env node
/**
 * Multi-target MV3 extension builder using Vite's JS API:
 *   1. content.js     -> single self-contained IIFE (for chrome.scripting.executeScript & ?harness)
 *   2. background.js  -> ES module service worker
 *   3. popup.html     -> extension action popup (+ popup.js)
 *   4. manifest.json  -> synced with package.json version
 *   5. icons/*.png    -> copied into dist/icons/
 */
import { build } from 'vite';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DIST = join(ROOT, 'dist');
const isDev = process.argv.includes('--dev');
const mode = isDev ? 'development' : 'production';

const shared = {
  configFile: false,
  root: ROOT,
  mode,
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
  },
  logLevel: 'warn',
};

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// 1. Content script (IIFE)
await build({
  ...shared,
  build: {
    outDir: DIST,
    emptyOutDir: false,
    target: 'chrome114',
    sourcemap: isDev ? 'inline' : false,
    minify: !isDev,
    lib: {
      entry: join(ROOT, 'src/extension/content.ts'),
      formats: ['iife'],
      name: 'MarkletContent',
      fileName: () => 'content.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

// 2. Background service worker (ES module)
await build({
  ...shared,
  build: {
    outDir: DIST,
    emptyOutDir: false,
    target: 'chrome114',
    sourcemap: isDev ? 'inline' : false,
    minify: !isDev,
    lib: {
      entry: join(ROOT, 'src/extension/background.ts'),
      formats: ['es'],
      fileName: () => 'background.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

// 3. Action popup (popup.html + popup.js)
await build({
  ...shared,
  root: join(ROOT, 'src/extension'),
  base: './',
  build: {
    outDir: DIST,
    emptyOutDir: false,
    target: 'chrome114',
    sourcemap: isDev ? 'inline' : false,
    minify: !isDev,
    rollupOptions: {
      input: join(ROOT, 'src/extension/popup.html'),
      output: {
        entryFileNames: 'popup.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});

// 4. Emit manifest.json synced with package.json version
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'src/extension/manifest.json'), 'utf-8'));
manifest.version = pkg.version;
writeFileSync(join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// 5. Copy icons
const iconsSrc = join(ROOT, 'src/extension/icons');
const iconsDst = join(DIST, 'icons');
mkdirSync(iconsDst, { recursive: true });
for (const file of readdirSync(iconsSrc)) {
  if (file.endsWith('.png')) copyFileSync(join(iconsSrc, file), join(iconsDst, file));
}

console.log(`✔ Built MV3 extension (${mode}) -> dist/ [content.js, background.js, popup.html, popup.js, manifest.json, icons/]`);
