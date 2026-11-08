export interface Product {
  _id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription: string;
  image: string;
  images?: string[];
  price: number;
  compareAtPrice?: number;
  productType: 'digital' | 'physical';
  category?: string;
  featured: boolean;
  active: boolean;
  stock: number;
  weight?: number;
  digitalAssetReference?: string;
  taxRate: number;
  seoTitle?: string;
  seoDescription?: string;
  demo?: boolean;
}
export interface Section {
  key: string;
  title?: string;
  subtitle?: string;
  body?: string;
  image?: string;
}
export interface HomeContent {
  heroTitle?: string;
  heroAccent?: string;
  heroDescription?: string;
  heroImage?: string;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  sections?: Section[];
  featuredProducts?: Product[];
  testimonials?: { quote: string; author: string }[];
}
export interface SiteSettings {
  email?: string;
  phone?: string;
  companyName?: string;
  address?: string;
  nip?: string;
  instagram?: string;
  facebook?: string;
  logo?: string;
  seoTitle?: string;
  seoDescription?: string;
  deliveryInfo?: string;
}
export interface Post {
  title: string;
  slug: string;
  excerpt: string;
  image?: string;
  imageAlt?: string;
  content: Block[];
  publishedAt: string;
  seoTitle?: string;
  seoDescription?: string;
}
export interface Block {
  _key: string;
  _type: string;
  style?: string;
  children?: { text: string }[];
}
export const money = (value: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value / 100);
