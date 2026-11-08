import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import node from '@astrojs/node';
import netlify from '@astrojs/netlify';
import sanity from '@sanity/astro';
import { loadEnv } from 'vite';

const runtimeEnv = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '');
const sanityProjectId = runtimeEnv.PUBLIC_SANITY_PROJECT_ID || 'fip0o8g2';
const sanityDataset = runtimeEnv.PUBLIC_SANITY_DATASET || 'production';

export default defineConfig({
  output: 'server',
  adapter: process.env.NETLIFY ? netlify() : node({ mode: 'standalone' }),
  site: process.env.SITE_URL || 'http://localhost:4321',
  integrations: [
    sanity({
      projectId: sanityProjectId,
      dataset: sanityDataset,
      apiVersion: runtimeEnv.PUBLIC_SANITY_API_VERSION || '2026-11-05',
      useCdn: true,
    }),
  ],
  image: {
    remotePatterns: [{ protocol: 'https', hostname: 'cdn.sanity.io' }],
  },
  server: { host: '0.0.0.0', port: 4321 },
  vite: {
    plugins: [tailwindcss()],
    server: { strictPort: true },
  },
});
