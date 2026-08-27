import { supabase, type LessonProgressRow } from './supabase'

export type LessonProgress = {
  videoId: string
  positionSeconds: number
  durationSeconds: number
  completed: boolean
  updatedAt: string
}

/** Storage boundary: a later authenticated adapter may return promises. */
export type LessonProgressStore = {
  get(videoId: string): LessonProgress | null | Promise<LessonProgress | null>
  save(progress: LessonProgress): void | Promise<void>
}

export type CloudLessonProgress = {
  get(lessonKey: string): Promise<LessonProgress | null>
  merge(lessonKey: string, progress: LessonProgress): Promise<LessonProgress>
}

type LocalLessonProgressStore = LessonProgressStore & {
  remove(videoId: string, expectedUpdatedAt: string): void
}

const STORAGE_KEY = 'alkulify:student:lesson-progress:v1'

type StoredProgress = Record<string, LessonProgress>

const valid = (value: unknown, videoId: string): value is LessonProgress => {
  if (!value || typeof value !== 'object') return false
  const p = value as Partial<LessonProgress>
  return (
    p.videoId === videoId &&
    typeof p.positionSeconds === 'number' &&
    Number.isFinite(p.positionSeconds) &&
    p.positionSeconds >= 0 &&
    typeof p.durationSeconds === 'number' &&
    Number.isFinite(p.durationSeconds) &&
    p.durationSeconds >= 0 &&
    typeof p.completed === 'boolean' &&
    typeof p.updatedAt === 'string'
  )
}

const readAll = (): StoredProgress => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as StoredProgress)
      : {}
  } catch {
    return {}
  }
}

export const localLessonProgress: LocalLessonProgressStore = {
  get(videoId) {
    const progress = readAll()[videoId]
    return valid(progress, videoId) ? progress : null
  },

  save(progress) {
    if (!valid(progress, progress.videoId)) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [progress.videoId]: progress }))
    } catch {}
  },

  remove(videoId, expectedUpdatedAt) {
    try {
      const all = readAll()
      if (all[videoId]?.updatedAt !== expectedUpdatedAt) return
      delete all[videoId]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    } catch {}
  },
}

const fromCloud = (videoId: string, row: LessonProgressRow): LessonProgress => ({
  videoId,
  positionSeconds: row.position_seconds,
  durationSeconds: row.duration_seconds,
  completed: row.completed,
  updatedAt: row.client_updated_at,
})

const supabaseCloudProgress = (videoId: string): CloudLessonProgress => ({
  async get(lessonKey) {
    const { data, error } = await supabase()
      .from('lesson_progress')
      .select(
        'user_id, lesson_key, position_seconds, duration_seconds, completed, client_updated_at, created_at, updated_at',
      )
      .eq('lesson_key', lessonKey)
      .maybeSingle()
    if (error) throw error
    return data ? fromCloud(videoId, data) : null
  },

  async merge(lessonKey, progress) {
    const { data, error } = await supabase().rpc('merge_lesson_progress', {
      p_lesson_key: lessonKey,
      p_position_seconds: progress.positionSeconds,
      p_duration_seconds: progress.durationSeconds,
      p_completed: progress.completed,
      p_client_updated_at: progress.updatedAt,
    })
    if (error) throw error
    return fromCloud(progress.videoId, data)
  },
})

type SessionAwareOptions = {
  videoId: string
  lessonKey: string
  getUserId: () => Promise<string | null>
  cloud: CloudLessonProgress
  local?: LocalLessonProgressStore
}

/** Selects local or owner-scoped cloud persistence once per Player instance. */
export function createSessionAwareLessonProgress({
  videoId,
  lessonKey,
  getUserId,
  cloud,
  local = localLessonProgress,
}: SessionAwareOptions): LessonProgressStore {
  const userId = getUserId().catch(() => null)
  let writes = Promise.resolve()

  return {
    async get(requestedVideoId) {
      const localProgress = await local.get(requestedVideoId)
      if (!(await userId)) return localProgress

      if (localProgress) {
        try {
          const merged = await cloud.merge(lessonKey, localProgress)
          local.remove(videoId, localProgress.updatedAt)
          return { ...merged, videoId }
        } catch {
          return localProgress
        }
      }

      try {
        const progress = await cloud.get(lessonKey)
        return progress ? { ...progress, videoId } : null
      } catch {
        return null
      }
    },

    save(progress) {
      // The synchronous local shadow makes pagehide/offline saves durable. It is removed only
      // when this exact version has reached the monotonic server RPC.
      void local.save(progress)
      writes = writes.then(async () => {
        if (!(await userId)) return
        try {
          await cloud.merge(lessonKey, progress)
          local.remove(videoId, progress.updatedAt)
        } catch {}
      })
      return writes
    },
  }
}

export function lessonProgress(videoId: string, lessonKey: string): LessonProgressStore {
  return createSessionAwareLessonProgress({
    videoId,
    lessonKey,
    getUserId: async () => {
      try {
        const { data } = await supabase().auth.getSession()
        return data.session?.user.id ?? null
      } catch {
        return null
      }
    },
    cloud: supabaseCloudProgress(videoId),
  })
}
