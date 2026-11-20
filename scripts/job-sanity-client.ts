import { createClient } from '@sanity/client';
import { env } from '../src/lib/server/env';

// Standalone workers do not have Astro's virtual sanity:client module.
export const sanityClient = createClient({
  projectId: env('SANITY_PROJECT_ID', env('PUBLIC_SANITY_PROJECT_ID', 'fip0o8g2')),
  dataset: env('SANITY_DATASET', env('PUBLIC_SANITY_DATASET', 'production')),
  apiVersion: env('PUBLIC_SANITY_API_VERSION', '2026-11-05'),
  useCdn: true,
});
