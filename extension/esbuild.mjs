import * as esbuild from 'esbuild';
import fs from 'node:fs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  sourcemap: !production,
  minify: production,
  external: ['vscode'],
};

/** @type {esbuild.BuildOptions} */
const webviewConfig = {
  entryPoints: ['src/webview/index.tsx'],
  outfile: 'dist/webview.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: !production,
  minify: production,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
};

// Copy static assets to dist
function copyAssets() {
  fs.mkdirSync('dist', { recursive: true });
  fs.copyFileSync('src/webview/styles/markdown.css', 'dist/markdown.css');
}

async function main() {
  copyAssets();
  if (watch) {
    const [extCtx, webCtx] = await Promise.all([
      esbuild.context(extensionConfig),
      esbuild.context(webviewConfig),
    ]);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log('Build complete.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
