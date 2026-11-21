import { build } from 'esbuild';
await build({
  entryPoints: ['scripts/worker.ts'],
  outdir: 'dist/jobs',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node24',
  alias: { 'sanity:client': './scripts/job-sanity-client.ts' },
});
