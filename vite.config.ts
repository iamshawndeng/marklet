import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';

const MANIFEST_PATH = new URL('./src/extension/manifest.json', import.meta.url);
const PKG_PATH = new URL('./package.json', import.meta.url);

/**
 * Emits src/extension/manifest.json into dist/, syncing `version` with package.json.
 */
function manifestPlugin(): Plugin {
  return {
    name: 'marklet:manifest',
    buildStart() {
      this.addWatchFile(MANIFEST_PATH.pathname);
    },
    generateBundle() {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
      const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
      manifest.version = pkg.version;
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: JSON.stringify(manifest, null, 2),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  return {
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'preact',
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
    },
    plugins: [manifestPlugin()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'chrome110',
      sourcemap: isDev ? 'inline' : false,
      minify: !isDev,
      // MV3 content scripts cannot be ES modules -> bundle as a single IIFE.
      lib: {
        entry: 'src/extension/content.ts',
        formats: ['iife'],
        name: 'MarkletContent',
        fileName: () => 'content.js',
      },
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
  };
});
