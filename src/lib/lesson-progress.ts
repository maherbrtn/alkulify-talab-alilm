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

export const localLessonProgress: LessonProgressStore = {
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
}
