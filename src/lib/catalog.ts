import { getSanityClient } from './sanity';
import { isDemo } from './server/env';
import { demoProducts, demoPosts } from '../data/demo';
import { privacyPolicy } from '../data/privacy-policy';
import { termsOfService } from '../data/terms-of-service';
import type { Product, HomeContent, SiteSettings, Post, Block } from './types';
const projection = `_id,name,"slug":slug.current,sku,description,content,shortDescription,"image":images[0].asset->url + "?auto=format&w=900&fit=max", "images":images[].asset->url,price,compareAtPrice,productType,"category":category->name,featured,active,stock,weight,digitalAssetReference,taxRate,seoTitle,seoDescription,demo`;
export async function products(fresh = false): Promise<Product[]> {
  if (isDemo()) return demoProducts;
  return getSanityClient(fresh).fetch(
    `*[_type=="product" && active==true] | order(featured desc,name asc){${projection}}`,
  );
}
export async function product(slug: string) {
  return (await products()).find((p) => p.slug === slug);
}
export async function homepage(): Promise<HomeContent> {
  if (isDemo()) return {};
  return (
    (await getSanityClient().fetch(
      `*[_type=="homepage"][0]{...,"heroImage":heroImage.asset->url+"?auto=format&w=1200",sections[]{...,"image":image.asset->url+"?auto=format&w=1000"},featuredProducts[]->{${projection}}}`,
    )) || {}
  );
}
export async function settings(): Promise<SiteSettings> {
  if (isDemo()) return {};
  return (
    (await getSanityClient().fetch('*[_type=="siteSettings"][0]{...,"logo":logo.asset->url}')) || {}
  );
}
export async function posts(): Promise<Post[]> {
  if (isDemo()) return demoPosts;
  return getSanityClient().fetch(
    '*[_type=="blogPost" && publishedAt<=now()] | order(publishedAt desc){...,"slug":slug.current,"image":coverImage.asset->url+"?auto=format&w=1000","imageAlt":coalesce(coverImage.alt,title),"seoTitle":seo.title,"seoDescription":seo.description}',
  );
}
export async function contentPage(
  slug: string,
): Promise<{ title: string; content: Block[] } | null> {
  if (isDemo()) {
    if (slug === 'polityka-prywatnosci') return privacyPolicy;
    if (slug === 'regulamin') return termsOfService;
    return null;
  }
  const page = await getSanityClient().fetch<{ title: string; content: Block[] } | null>(
    '*[_type=="page" && slug.current==$slug][0]',
    { slug },
  );
  if (page) return page;
  if (slug === 'polityka-prywatnosci') return privacyPolicy;
  if (slug === 'regulamin') return termsOfService;
  return null;
}
