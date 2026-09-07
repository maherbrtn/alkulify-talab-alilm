import type { SupabaseClient } from '@supabase/supabase-js'
import { isUuidV4 } from './lesson-registry'
import { supabase, type Database, type StudyPathEnrollmentRow } from './supabase'
import type { StudentProgressRow } from './student-progress'

const ENROLLMENT_COLUMNS =
  'id,user_id,path_id,path_version,state,enrolled_at,updated_at,paused_at,withdrawn_at,superseded_at,superseded_by_enrollment_id'
const PROGRESS_COLUMNS =
  'lesson_key,position_seconds,duration_seconds,completed,client_updated_at'
const BATCH_SIZE = 100
const PAGE_SIZE = 100

type Client = Pick<SupabaseClient<Database>, 'from' | 'rpc'>

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const stringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

const enrollmentState = (
  value: unknown,
): value is StudyPathEnrollmentRow['state'] =>
  value === 'active' ||
  value === 'paused' ||
  value === 'withdrawn' ||
  value === 'superseded'

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function isEnrollmentRow(value: unknown): value is StudyPathEnrollmentRow {
  if (!record(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.user_id === 'string' &&
    typeof value.path_id === 'string' &&
    Number.isInteger(value.path_version) &&
    (value.path_version as number) > 0 &&
    enrollmentState(value.state) &&
    typeof value.enrolled_at === 'string' &&
    typeof value.updated_at === 'string' &&
    stringOrNull(value.paused_at) &&
    stringOrNull(value.withdrawn_at) &&
    stringOrNull(value.superseded_at) &&
    stringOrNull(value.superseded_by_enrollment_id)
  )
}

function isProgressRow(value: unknown): value is StudentProgressRow {
  if (!record(value)) return false
  return (
    isUuidV4(value.lesson_key) &&
    finiteNumber(value.position_seconds) &&
    finiteNumber(value.duration_seconds) &&
    typeof value.completed === 'boolean' &&
    typeof value.client_updated_at === 'string'
  )
}

/** Stable service error; SQL/network details remain in cause for later classification. */
export class StudentStudyPathCloudError extends Error {
  constructor(readonly operation: string, readonly kind: 'request' | 'response', cause?: unknown) {
    super(`Study path ${operation} failed`, { cause })
    this.name = 'StudentStudyPathCloudError'
  }
}

function enrollmentRows(operation: string, value: unknown): StudyPathEnrollmentRow[] {
  if (!Array.isArray(value) || !value.every(isEnrollmentRow))
    throw new StudentStudyPathCloudError(operation, 'response')
  return value
}

function progressRows(operation: string, value: unknown): StudentProgressRow[] {
  if (!Array.isArray(value) || !value.every(isProgressRow))
    throw new StudentStudyPathCloudError(operation, 'response')
  return value
}

function enrollmentRow(operation: string, value: unknown): StudyPathEnrollmentRow {
  if (!isEnrollmentRow(value))
    throw new StudentStudyPathCloudError(operation, 'response')
  return value
}

/** Lazy client access keeps imports browser-safe and allows deterministic transport tests.
 * Callers verify auth first. RLS, not supplied identity, determines row ownership.
 * No retries: after an uncertain mutation, the UI must reread before acting again.
 */
export function createStudentStudyPathCloud(getClient: () => Client = supabase) {
  async function request<T>(operation: string, run: () => PromiseLike<{
    data: T | null; error: unknown
  }>): Promise<T> {
    try {
      const { data, error } = await run()
      if (error) throw new StudentStudyPathCloudError(operation, 'request', error)
      if (data === null) throw new StudentStudyPathCloudError(operation, 'response')
      return data
    } catch (cause) {
      if (cause instanceof StudentStudyPathCloudError) throw cause
      throw new StudentStudyPathCloudError(operation, 'request', cause)
    }
  }

  async function readEnrollments(pathId: string): Promise<StudyPathEnrollmentRow[]> {
    const rows: StudyPathEnrollmentRow[] = []
    let cursor: string | undefined

    for (;;) {
      const rawPage = await request('read-enrollments', () => {
        let query = getClient().from('study_path_enrollments').select(ENROLLMENT_COLUMNS)
          .eq('path_id', pathId).order('id', { ascending: true }).limit(PAGE_SIZE)
        if (cursor) query = query.gt('id', cursor)
        return query
      })

      const page = enrollmentRows('read-enrollments', rawPage)
      if (!page.length) return rows

      for (const row of page) {
        if (row.path_id !== pathId || (cursor !== undefined && row.id <= cursor))
          throw new StudentStudyPathCloudError('read-enrollments', 'response')
        rows.push(row)
        cursor = row.id
      }
    }
  }

  async function readEnrollment(
    pathId: string,
    enrollmentId: string,
  ): Promise<StudyPathEnrollmentRow | null> {
    const rawRows = await request('read-enrollment', () => getClient()
      .from('study_path_enrollments').select(ENROLLMENT_COLUMNS)
      .eq('path_id', pathId).eq('id', enrollmentId))

    const rows = enrollmentRows('read-enrollment', rawRows)

    // An empty array is a successful owner-invisible/missing read, not an error.
    if (
      rows.length > 1 ||
      rows.some((row) => row.path_id !== pathId || row.id !== enrollmentId)
    ) {
      throw new StudentStudyPathCloudError('read-enrollment', 'response')
    }

    return rows[0] ?? null
  }

  /** RLS supplies the owner. Exhaustion requires an empty page, even after a short page. */
  async function readOwnerEnrollments(): Promise<StudyPathEnrollmentRow[]> {
    const rows: StudyPathEnrollmentRow[] = []
    let cursor: string | undefined

    for (;;) {
      const rawPage = await request('read-owner-enrollments', () => {
        let query = getClient().from('study_path_enrollments').select(ENROLLMENT_COLUMNS)
          .order('id', { ascending: true }).limit(PAGE_SIZE)
        if (cursor) query = query.gt('id', cursor)
        return query
      })
      const page = enrollmentRows('read-owner-enrollments', rawPage)
      if (!page.length) return rows
      if (page.length > PAGE_SIZE)
        throw new StudentStudyPathCloudError('read-owner-enrollments', 'response')

      for (const row of page) {
        // Canonical IDs make lexical comparison agree with the database UUID order.
        // Strict advancement rejects duplicates both within and across pages.
        if (!isUuidV4(row.id) || (cursor !== undefined && row.id <= cursor))
          throw new StudentStudyPathCloudError('read-owner-enrollments', 'response')
        rows.push(row)
        cursor = row.id
      }
    }
  }

  async function readProgress(lessonKeys: readonly string[]): Promise<StudentProgressRow[]> {
    const keys = [...new Set(lessonKeys)].sort()

    if (keys.some((key) => !isUuidV4(key)))
      throw new StudentStudyPathCloudError('read-progress', 'response')

    const rows: StudentProgressRow[] = []

    for (let offset = 0; offset < keys.length; offset += BATCH_SIZE) {
      const batch = keys.slice(offset, offset + BATCH_SIZE)
      const allowed = new Set(batch)
      let cursor: string | undefined

      for (;;) {
        const rawPage = await request('read-progress', () => {
          let query = getClient().from('lesson_progress').select(PROGRESS_COLUMNS)
            .in('lesson_key', batch).order('lesson_key', { ascending: true }).limit(PAGE_SIZE)
          if (cursor) query = query.gt('lesson_key', cursor)
          return query
        })

        const page = progressRows('read-progress', rawPage)

        // A short page may be caused by a server-side cap.
        // Only a validated empty page exhausts the current batch.
        if (!page.length) break

        for (const row of page) {
          if (
            !allowed.has(row.lesson_key) ||
            (cursor !== undefined && row.lesson_key <= cursor)
          ) {
            throw new StudentStudyPathCloudError('read-progress', 'response')
          }

          rows.push(row)
          cursor = row.lesson_key
        }
      }
    }

    return rows
  }

  return {
    readEnrollments,
    readOwnerEnrollments,
    readEnrollment,
    readProgress,

    enroll: async (pathId: string, pathVersion: number) =>
      enrollmentRow(
        'enroll_study_path',
        await request('enroll_study_path', () =>
          getClient().rpc('enroll_study_path', {
            p_path_id: pathId,
            p_path_version: pathVersion,
          })),
      ),

    pause: async (enrollmentId: string) =>
      enrollmentRow(
        'pause_study_path_enrollment',
        await request('pause_study_path_enrollment', () =>
          getClient().rpc('pause_study_path_enrollment', {
            p_enrollment_id: enrollmentId,
          })),
      ),

    resume: async (enrollmentId: string) =>
      enrollmentRow(
        'resume_study_path_enrollment',
        await request('resume_study_path_enrollment', () =>
          getClient().rpc('resume_study_path_enrollment', {
            p_enrollment_id: enrollmentId,
          })),
      ),

    withdraw: async (enrollmentId: string) =>
      enrollmentRow(
        'withdraw_study_path_enrollment',
        await request('withdraw_study_path_enrollment', () =>
          getClient().rpc('withdraw_study_path_enrollment', {
            p_enrollment_id: enrollmentId,
          })),
      ),

    upgrade: async (enrollmentId: string, targetPathVersion: number) =>
      enrollmentRow(
        'upgrade_study_path_enrollment',
        await request('upgrade_study_path_enrollment', () =>
          getClient().rpc('upgrade_study_path_enrollment', {
            p_enrollment_id: enrollmentId,
            p_target_path_version: targetPathVersion,
          })),
      ),
  }
}

export const studentStudyPathCloud = createStudentStudyPathCloud()
