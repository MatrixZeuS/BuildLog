// Builds BuildLog for Vercel using the Build Output API (https://vercel.com/docs/build-output-api).
//
//   .vercel/output/static/              <- the Vite frontend (dist/)
//   .vercel/output/functions/api.func/  <- the Express API, bundled into one file
//   .vercel/output/config.json          <- routing: /api/* -> function, everything else -> SPA
//
// Run after `vite build` (see the "build:vercel" script in package.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel', 'output');
const distDir = path.join(root, 'dist');
const funcDir = path.join(out, 'functions', 'api.func');

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('dist/index.html not found. Run `vite build` first.');
  process.exit(1);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) fs.writeFileSync(to, fs.readFileSync(from));
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(funcDir, { recursive: true });

// 1. Static frontend
copyDir(distDir, path.join(out, 'static'));

// 2. API function: bundle every dependency so nothing is loaded from node_modules at runtime.
await build({
  entryPoints: [path.join(root, 'deploy', 'vercel', 'function.ts')],
  outfile: path.join(funcDir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
  banner: {
    js: [
      "import { createRequire as __blCr } from 'node:module';",
      "import { fileURLToPath as __blFu } from 'node:url';",
      "import { dirname as __blDn } from 'node:path';",
      'globalThis.require ??= __blCr(import.meta.url);',
      'globalThis.__filename ??= __blFu(import.meta.url);',
      'globalThis.__dirname ??= __blDn(globalThis.__filename);',
    ].join(' '),
  },
});

fs.writeFileSync(path.join(funcDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
fs.writeFileSync(
  path.join(funcDir, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      // Keep the raw request stream intact for webhook signature checks.
      shouldAddHelpers: false,
      maxDuration: 30,
    },
    null,
    2
  )
);

// 3. Routing
fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api/?$', dest: '/api' },
        { src: '^/api/(.*)$', dest: '/api?__bl_path=$1' },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2
  )
);

const size = (fs.statSync(path.join(funcDir, 'index.mjs')).size / 1024 / 1024).toFixed(1);
console.log(`Vercel build output ready: .vercel/output (API function ${size} MB)`);
