import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Profile = {
  id: string
  display_name: string | null
  created_at: string
  updated_at: string
}

export type LessonProgressRow = {
  user_id: string
  lesson_key: string
  position_seconds: number
  duration_seconds: number
  completed: boolean
  client_updated_at: string
  created_at: string
  updated_at: string
}

export type StudyPathEnrollmentState = 'active' | 'paused' | 'withdrawn' | 'superseded'

export type StudyPathEnrollmentRow = {
  id: string
  user_id: string
  path_id: string
  path_version: number
  state: StudyPathEnrollmentState
  enrolled_at: string
  updated_at: string
  paused_at: string | null
  withdrawn_at: string | null
  superseded_at: string | null
  superseded_by_enrollment_id: string | null
}

export type Database = {
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
      lesson_progress: {
        Row: LessonProgressRow
        Insert: {
          user_id: string
          lesson_key: string
          position_seconds: number
          duration_seconds: number
          completed?: boolean
          client_updated_at: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          lesson_key?: string
          position_seconds?: number
          duration_seconds?: number
          completed?: boolean
          client_updated_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      study_path_enrollments: {
        Row: StudyPathEnrollmentRow
        Insert: {
          id?: string
          user_id: string
          path_id: string
          path_version: number
          state?: StudyPathEnrollmentState
          enrolled_at?: string
          updated_at?: string
          paused_at?: string | null
          withdrawn_at?: string | null
          superseded_at?: string | null
          superseded_by_enrollment_id?: string | null
        }
        Update: Partial<StudyPathEnrollmentRow>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      merge_lesson_progress: {
        Args: {
          p_lesson_key: string
          p_position_seconds: number
          p_duration_seconds: number
          p_completed: boolean
          p_client_updated_at: string
        }
        Returns: LessonProgressRow
      }
      enroll_study_path: {
        Args: { p_path_id: string; p_path_version: number }
        Returns: StudyPathEnrollmentRow
      }
      pause_study_path_enrollment: {
        Args: { p_enrollment_id: string }
        Returns: StudyPathEnrollmentRow
      }
      resume_study_path_enrollment: {
        Args: { p_enrollment_id: string }
        Returns: StudyPathEnrollmentRow
      }
      withdraw_study_path_enrollment: {
        Args: { p_enrollment_id: string }
        Returns: StudyPathEnrollmentRow
      }
      upgrade_study_path_enrollment: {
        Args: { p_enrollment_id: string; p_target_path_version: number }
        Returns: StudyPathEnrollmentRow
      }
    }
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
