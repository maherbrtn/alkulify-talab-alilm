export type LessonRegistryEntry = {
  lesson_key: string
  youtube_video_id: string
  [field: string]: unknown
}

export type LessonRegistry = {
  version: 1
  lessons: LessonRegistryEntry[]
}

// PostgreSQL renders UUIDs in lowercase. Requiring that same spelling keeps
// identity comparisons and future definition digests byte-for-byte stable.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const isUuidV4 = (value: unknown): value is string =>
  typeof value === 'string' && UUID_V4.test(value)

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export function validateLessonRegistry(
  value: unknown,
  currentVideoIds: readonly string[] = [],
): LessonRegistry {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.lessons)) {
    throw new Error('lesson registry must have version 1 and a lessons array')
  }

  const lessonKeys = new Set<string>()
  const sourceIds = new Set<string>()
  const lessons = value.lessons.map((entry, index): LessonRegistryEntry => {
    if (!object(entry)) throw new Error(`lesson registry entry ${index} must be an object`)

    const lessonKey = entry.lesson_key
    const sourceId = entry.youtube_video_id
    if (!isUuidV4(lessonKey)) {
      throw new Error(`lesson registry entry ${index} has an invalid lesson_key`)
    }
    if (typeof sourceId !== 'string' || !sourceId || sourceId.trim() !== sourceId) {
      throw new Error(`lesson registry entry ${index} has an invalid youtube_video_id`)
    }
    if (lessonKeys.has(lessonKey)) throw new Error(`duplicate lesson_key: ${lessonKey}`)
    if (sourceIds.has(sourceId)) throw new Error(`duplicate youtube_video_id: ${sourceId}`)
    lessonKeys.add(lessonKey)
    sourceIds.add(sourceId)
    return entry as LessonRegistryEntry
  })

  const current = new Set<string>()
  for (const videoId of currentVideoIds) {
    if (typeof videoId !== 'string' || !videoId || videoId.trim() !== videoId) {
      throw new Error('current videos contain an invalid id')
    }
    if (current.has(videoId)) throw new Error(`duplicate current video id: ${videoId}`)
    current.add(videoId)
    if (!sourceIds.has(videoId)) throw new Error(`missing lesson registry mapping: ${videoId}`)
  }

  return { version: 1, lessons }
}

export function lessonKeysByVideoId(registry: LessonRegistry): ReadonlyMap<string, string> {
  return new Map(registry.lessons.map((entry) => [entry.youtube_video_id, entry.lesson_key]))
}
