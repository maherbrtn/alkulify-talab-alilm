/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_MEILI_HOST: string
  readonly PUBLIC_MEILI_SEARCH_KEY: string
  readonly PUBLIC_POSTHOG_KEY?: string
  readonly PUBLIC_SUPABASE_URL: string
  readonly PUBLIC_SUPABASE_PUBLISHABLE_KEY: string
}
interface ImportMeta {
  readonly env?: ImportMetaEnv
}
