import type { StudentLessonMetadata } from './student-progress'

const STUDENT_LESSON_CATALOG_PATH = '/student/lesson-catalog.json'

export type StudentLessonCatalogErrorCode = 'network' | 'http' | 'json' | 'schema'

export class StudentLessonCatalogError extends Error {
  constructor(
    readonly code: StudentLessonCatalogErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'StudentLessonCatalogError'
  }
}

export function decodeStudentLessonCatalog(value: unknown): StudentLessonMetadata[] {
  if (!Array.isArray(value)) {
    throw new StudentLessonCatalogError('schema', 'Lesson catalog must be an array')
  }

  const lessonKeys = new Set<string>()
  return value.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 3) {
      throw new StudentLessonCatalogError('schema', `Lesson catalog entry ${index} is invalid`)
    }

    const [lessonKey, videoId, title] = entry
    if (typeof lessonKey !== 'string' || !lessonKey) {
      throw new StudentLessonCatalogError('schema', `Lesson catalog entry ${index} has no lessonKey`)
    }
    if (typeof videoId !== 'string' || !videoId) {
      throw new StudentLessonCatalogError('schema', `Lesson catalog entry ${index} has no videoId`)
    }
    if (typeof title !== 'string') {
      throw new StudentLessonCatalogError('schema', `Lesson catalog entry ${index} has no title`)
    }
    if (lessonKeys.has(lessonKey)) {
      throw new StudentLessonCatalogError('schema', `Duplicate lessonKey: ${lessonKey}`)
    }
    lessonKeys.add(lessonKey)
    return { lessonKey, videoId, title }
  })
}

type CatalogFetch = (input: string) => Promise<Response>

export async function fetchStudentLessonCatalog(
  fetcher: CatalogFetch = fetch,
): Promise<StudentLessonMetadata[]> {
  let response: Response
  try {
    response = await fetcher(STUDENT_LESSON_CATALOG_PATH)
  } catch (cause) {
    throw new StudentLessonCatalogError('network', 'Could not fetch lesson catalog', { cause })
  }

  if (!response.ok) {
    throw new StudentLessonCatalogError('http', `Lesson catalog request failed: ${response.status}`)
  }

  let value: unknown
  try {
    value = await response.json()
  } catch (cause) {
    throw new StudentLessonCatalogError('json', 'Lesson catalog is not valid JSON', { cause })
  }
  return decodeStudentLessonCatalog(value)
}
