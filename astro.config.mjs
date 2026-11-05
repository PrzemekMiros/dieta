import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import node from '@astrojs/node';
import netlify from '@astrojs/netlify';

export default defineConfig({
  output: 'server',
  adapter: process.env.NETLIFY ? netlify() : node({ mode: 'standalone' }),
  site: process.env.SITE_URL || 'http://localhost:4321',
  server: { host: '0.0.0.0', port: 4321 },
  vite: {
    plugins: [tailwindcss()],
    server: { strictPort: true },
  },
});
