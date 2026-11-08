import { sanityClient } from 'sanity:client';
import { env } from './server/env';

export function getSanityClient(fresh = false) {
  const token = env('SANITY_READ_TOKEN') || undefined;

  return sanityClient.withConfig({
    useCdn: !fresh && !token,
    token,
    perspective: 'published',
  });
}
