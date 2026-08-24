import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Profile = {
  id: string
  display_name: string | null
  created_at: string
  updated_at: string
}

type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: {
          id: string
          display_name?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          display_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

let browserClient: SupabaseClient<Database> | undefined

/** Browser-only by design: the public archive stays static and has no server auth state. */
export function supabase(): SupabaseClient<Database> {
  if (typeof window === 'undefined') throw new Error('Supabase is only available in the browser')
  if (browserClient) return browserClient

  const url = import.meta.env.PUBLIC_SUPABASE_URL
  const publishableKey = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !publishableKey) throw new Error('Supabase public configuration is missing')

  browserClient = createClient<Database>(url, publishableKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
  return browserClient
}

export const authCallbackUrl = () => new URL('/student/auth/callback/', location.origin).href

export function signupDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name ? name.slice(0, 80) : null
}
