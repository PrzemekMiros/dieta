import { createClient } from '@sanity/client';
import { env } from './server/env';
export function getSanityClient(fresh = false) {
  const projectId = env('SANITY_PROJECT_ID', env('PUBLIC_SANITY_PROJECT_ID'));
  if (!projectId) throw new Error('Uzupełnij SANITY_PROJECT_ID w .env.');
  return createClient({
    projectId,
    dataset: env('SANITY_DATASET', 'production'),
    apiVersion: '2026-11-05',
    useCdn: !fresh,
    token: env('SANITY_READ_TOKEN') || undefined,
    perspective: 'published',
  });
}
