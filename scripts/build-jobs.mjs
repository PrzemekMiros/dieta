import { build } from 'esbuild';
await build({
  entryPoints: ['scripts/worker.ts', 'scripts/reconcile.ts'],
  outdir: 'dist/jobs',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node24',
});
