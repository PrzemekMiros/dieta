/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SANITY_PROJECT_ID?: string;
  readonly PUBLIC_SANITY_DATASET?: string;
  readonly PUBLIC_SANITY_API_VERSION?: string;
  readonly PUBLIC_GTM_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Navigator {
  readonly globalPrivacyControl?: boolean;
}

interface Window {
  readonly doNotTrack?: string;
  cookieconsentConfig?: {
    gtmId?: string;
    consentStorageMaxAgeDays?: number;
  };
  dataLayer: unknown[];
  gtag: (...args: unknown[]) => void;
}
