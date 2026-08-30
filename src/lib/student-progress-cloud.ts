import { supabase } from './supabase'
import type { StudentProgressRow } from './student-progress'

const STUDENT_PROGRESS_COLUMNS =
  'lesson_key,position_seconds,duration_seconds,completed,client_updated_at'

/**
 * Reads all owner-visible progress after the caller has verified the authenticated user.
 * An empty successful read returns `[]`; a query failure rejects with the Supabase error.
 */
export async function readStudentProgress(): Promise<StudentProgressRow[]> {
  const { data, error } = await supabase()
    .from('lesson_progress')
    .select(STUDENT_PROGRESS_COLUMNS)
    .order('client_updated_at', { ascending: false })

  if (error) throw error
  return data
}
