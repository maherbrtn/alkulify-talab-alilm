export type StudentProgressRow = {
  lesson_key: string
  position_seconds: number
  duration_seconds: number
  completed: boolean
  client_updated_at: string
}

export type StudentLessonMetadata = {
  lessonKey: string
  videoId: string
  title: string
}

export type StudentLessonViewModel = {
  lessonKey: string
  videoId: string
  title: string
  completed: boolean
  positionSeconds: number
  durationSeconds: number
  displayPercentage: number | null
  effectiveResumeSeconds: number
  href: string
  clientUpdatedAt: string
}

export type StudentProgressViewModel = {
  knownLessons: StudentLessonViewModel[]
  continueLesson: StudentLessonViewModel | null
  recentLessons: StudentLessonViewModel[]
  unknownRowCount: number
}

const RECENT_LESSON_LIMIT = 8

const finiteNonnegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(value, 0) : 0

export function studentDisplayPercentage(row: StudentProgressRow): number | null {
  if (!(row.duration_seconds > 0) || !Number.isFinite(row.duration_seconds)) return null
  if (row.completed) return 100

  const position = finiteNonnegative(row.position_seconds)
  return Math.round(Math.min((position / row.duration_seconds) * 100, 100))
}

export function studentEffectiveResumeSeconds(row: StudentProgressRow): number {
  const position = finiteNonnegative(row.position_seconds)
  if (!(row.duration_seconds > 0) || !Number.isFinite(row.duration_seconds)) return position
  return Math.min(position, row.duration_seconds)
}

export function studentLessonHref(
  videoId: string,
  completed: boolean,
  effectiveResumeSeconds: number,
): string {
  const lessonHref = `/v/${videoId}/`
  const resumeSeconds = finiteNonnegative(effectiveResumeSeconds)
  if (completed || resumeSeconds <= 0) return lessonHref
  return `${lessonHref}?t=${Math.floor(resumeSeconds)}`
}

export function toStudentLessonViewModel(
  row: StudentProgressRow,
  metadata: StudentLessonMetadata,
): StudentLessonViewModel {
  const effectiveResumeSeconds = studentEffectiveResumeSeconds(row)
  return {
    lessonKey: row.lesson_key,
    videoId: metadata.videoId,
    title: metadata.title,
    completed: row.completed,
    positionSeconds: row.position_seconds,
    durationSeconds: row.duration_seconds,
    displayPercentage: studentDisplayPercentage(row),
    effectiveResumeSeconds,
    href: studentLessonHref(metadata.videoId, row.completed, effectiveResumeSeconds),
    clientUpdatedAt: row.client_updated_at,
  }
}

export function deriveStudentProgress(
  progressRows: readonly StudentProgressRow[],
  lessonMetadata: readonly StudentLessonMetadata[],
): StudentProgressViewModel {
  const metadataByLessonKey = new Map(lessonMetadata.map((lesson) => [lesson.lessonKey, lesson]))
  const knownLessons: StudentLessonViewModel[] = []
  let unknownRowCount = 0

  for (const row of progressRows) {
    const metadata = metadataByLessonKey.get(row.lesson_key)
    if (!metadata) {
      unknownRowCount++
      continue
    }
    knownLessons.push(toStudentLessonViewModel(row, metadata))
  }

  return {
    knownLessons,
    continueLesson: knownLessons.find((lesson) => !lesson.completed) ?? null,
    recentLessons: knownLessons.slice(0, RECENT_LESSON_LIMIT),
    unknownRowCount,
  }
}
