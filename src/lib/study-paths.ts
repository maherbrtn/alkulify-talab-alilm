import { isUuidV4, type LessonRegistry } from './lesson-registry'
import { studentEffectiveResumeSeconds, type StudentProgressRow } from './student-progress'

export type StudyPathStatus = 'draft' | 'published' | 'retired'

export type StudyPath = {
  readonly pathId: string
  readonly slug: string
  readonly title: string
  readonly description: string
  readonly status: StudyPathStatus
  readonly currentVersion: number
  readonly presentation?: Readonly<Record<string, unknown>>
}

export type StudyPathLesson = {
  readonly lessonKey: string
  readonly position: number
}

export type StudyPathModule = {
  readonly moduleKey: string
  readonly title: string
  readonly objective: string
  readonly position: number
  readonly lessons: readonly StudyPathLesson[]
}

export type StudyPathVersion = {
  readonly pathId: string
  readonly version: number
  readonly publishedAt: string
  readonly modules: readonly StudyPathModule[]
}

export type StudyPathDefinition = StudyPath & {
  readonly versions: readonly StudyPathVersion[]
}

export type StudyPathLessonProgress = {
  readonly lessonKey: string
  readonly position: number
  readonly completed: boolean
  readonly progress: StudentProgressRow | null
  readonly effectiveResumeSeconds: number
}

export type StudyPathModuleProgress = {
  readonly moduleKey: string
  readonly position: number
  readonly completedLessons: number
  readonly totalLessons: number
  readonly percentage: number
  readonly completed: boolean
  readonly lessons: readonly StudyPathLessonProgress[]
}

export type StudyPathContinueLesson = {
  readonly lessonKey: string
  readonly moduleKey: string
  readonly modulePosition: number
  readonly lessonPosition: number
  readonly progress: StudentProgressRow | null
  readonly effectiveResumeSeconds: number
}

export type StudyPathProgress = {
  readonly completedLessons: number
  readonly totalLessons: number
  readonly percentage: number
  readonly completed: boolean
  readonly modules: readonly StudyPathModuleProgress[]
  readonly continueLesson: StudyPathContinueLesson | null
}

const STUDY_PATH_KEYS = [
  'pathId',
  'slug',
  'title',
  'description',
  'status',
  'currentVersion',
  'presentation',
  'versions',
] as const
const VERSION_KEYS = ['pathId', 'version', 'publishedAt', 'modules'] as const
const MODULE_KEYS = ['moduleKey', 'title', 'objective', 'position', 'lessons'] as const
const LESSON_KEYS = ['lessonKey', 'position'] as const
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key))
  if (extra) throw new Error(`${label} has an unexpected field: ${extra}`)
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new Error(`${label} must be a nonempty trimmed string`)
  }
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value as number
}

function uuid(value: unknown, label: string): string {
  if (!isUuidV4(value)) throw new Error(`${label} must be a UUID v4`)
  return value
}

function isoTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be an ISO timestamp`)
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`)
  }
  return value
}

function validateStudyPathLesson(
  value: unknown,
  expectedPosition: number,
  label: string,
): StudyPathLesson {
  if (!object(value)) throw new Error(`${label} must be an object`)
  assertExactKeys(value, LESSON_KEYS, label)
  const position = positiveInteger(value.position, `${label}.position`)
  if (position !== expectedPosition) {
    throw new Error(`${label}.position must be ${expectedPosition}`)
  }
  return Object.freeze({
    lessonKey: uuid(value.lessonKey, `${label}.lessonKey`),
    position,
  })
}

function validateStudyPathModule(
  value: unknown,
  expectedPosition: number,
  label: string,
): StudyPathModule {
  if (!object(value)) throw new Error(`${label} must be an object`)
  assertExactKeys(value, MODULE_KEYS, label)
  const position = positiveInteger(value.position, `${label}.position`)
  if (position !== expectedPosition) {
    throw new Error(`${label}.position must be ${expectedPosition}`)
  }
  if (!Array.isArray(value.lessons) || value.lessons.length === 0) {
    throw new Error(`${label} must contain at least one lesson`)
  }
  const lessons = Object.freeze(
    value.lessons.map((lesson, index) =>
      validateStudyPathLesson(lesson, index + 1, `${label}.lessons[${index}]`),
    ),
  )
  return Object.freeze({
    moduleKey: uuid(value.moduleKey, `${label}.moduleKey`),
    title: nonemptyString(value.title, `${label}.title`),
    objective: nonemptyString(value.objective, `${label}.objective`),
    position,
    lessons,
  })
}

export function validateStudyPathVersion(
  value: unknown,
  expectedPathId?: string,
): StudyPathVersion {
  if (!object(value)) throw new Error('study path version must be an object')
  assertExactKeys(value, VERSION_KEYS, 'study path version')
  const pathId = uuid(value.pathId, 'study path version.pathId')
  if (expectedPathId && pathId !== expectedPathId) {
    throw new Error('study path version.pathId must match the path')
  }
  if (!Array.isArray(value.modules) || value.modules.length === 0) {
    throw new Error('study path version must contain at least one module')
  }

  const moduleKeys = new Set<string>()
  const lessonKeys = new Set<string>()
  const modules = Object.freeze(
    value.modules.map((module, index) => {
      const validated = validateStudyPathModule(module, index + 1, `modules[${index}]`)
      if (moduleKeys.has(validated.moduleKey)) {
        throw new Error(`duplicate moduleKey in study path version: ${validated.moduleKey}`)
      }
      moduleKeys.add(validated.moduleKey)
      for (const lesson of validated.lessons) {
        if (lessonKeys.has(lesson.lessonKey)) {
          throw new Error(`duplicate lessonKey in study path version: ${lesson.lessonKey}`)
        }
        lessonKeys.add(lesson.lessonKey)
      }
      return validated
    }),
  )

  return Object.freeze({
    pathId,
    version: positiveInteger(value.version, 'study path version.version'),
    publishedAt: isoTimestamp(value.publishedAt, 'study path version.publishedAt'),
    modules,
  })
}

export function validateStudyPathVersionLessonKeys(
  version: StudyPathVersion,
  registry: LessonRegistry,
): void {
  const known = new Set(registry.lessons.map((lesson) => lesson.lesson_key))
  for (const module of version.modules) {
    for (const lesson of module.lessons) {
      if (!known.has(lesson.lessonKey)) {
        throw new Error(`unknown lessonKey in study path version: ${lesson.lessonKey}`)
      }
    }
  }
}

export function validateStudyPathDefinition(
  value: unknown,
  registry?: LessonRegistry,
): StudyPathDefinition {
  if (!object(value)) throw new Error('study path definition must be an object')
  assertExactKeys(value, STUDY_PATH_KEYS, 'study path definition')
  const pathId = uuid(value.pathId, 'study path definition.pathId')
  const status = value.status
  if (status !== 'draft' && status !== 'published' && status !== 'retired') {
    throw new Error('study path definition.status is invalid')
  }
  if (!Array.isArray(value.versions) || value.versions.length === 0) {
    throw new Error('study path definition must contain at least one version')
  }
  const versionNumbers = new Set<number>()
  const versions = Object.freeze(
    value.versions.map((version) => {
      const validated = validateStudyPathVersion(version, pathId)
      if (versionNumbers.has(validated.version)) {
        throw new Error(`duplicate study path version: ${validated.version}`)
      }
      versionNumbers.add(validated.version)
      return validated
    }),
  )
  const currentVersion = positiveInteger(value.currentVersion, 'study path definition.currentVersion')
  if (!versionNumbers.has(currentVersion)) {
    throw new Error('study path definition.currentVersion must identify an included version')
  }
  if (!registry && status !== 'draft') {
    throw new Error('published and retired study paths require lesson registry validation')
  }
  if (registry) {
    for (const version of versions) validateStudyPathVersionLessonKeys(version, registry)
  }
  if (value.presentation !== undefined && !object(value.presentation)) {
    throw new Error('study path definition.presentation must be an object')
  }

  return Object.freeze({
    pathId,
    slug: (() => {
      const slug = nonemptyString(value.slug, 'study path definition.slug')
      if (!SLUG.test(slug)) throw new Error('study path definition.slug is invalid')
      return slug
    })(),
    title: nonemptyString(value.title, 'study path definition.title'),
    description: nonemptyString(value.description, 'study path definition.description'),
    status,
    currentVersion,
    ...(value.presentation === undefined
      ? {}
      : { presentation: Object.freeze({ ...value.presentation }) }),
    versions,
  })
}

/** Fixed tuple positions make the curriculum contract explicit and independent of object key order. */
export function canonicalStudyPathVersion(value: unknown): string {
  const version = validateStudyPathVersion(value)
  return JSON.stringify([
    'study-path-curriculum-v1',
    version.pathId,
    version.version,
    version.modules.map((module) => [
      module.moduleKey,
      module.title,
      module.objective,
      module.position,
      module.lessons.map((lesson) => [lesson.lessonKey, lesson.position]),
    ]),
  ])
}

export async function studyPathVersionDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalStudyPathVersion(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const percentage = (completed: number, total: number): number =>
  Math.floor((completed / total) * 100)

export function deriveStudyPathProgress(
  value: unknown,
  progressRows: readonly StudentProgressRow[],
): StudyPathProgress {
  const version = validateStudyPathVersion(value)
  const progressByLessonKey = new Map<string, StudentProgressRow>()
  for (const row of progressRows) {
    if (progressByLessonKey.has(row.lesson_key)) {
      throw new Error(`duplicate lesson progress row: ${row.lesson_key}`)
    }
    progressByLessonKey.set(row.lesson_key, row)
  }

  let completedLessons = 0
  let continueLesson: StudyPathContinueLesson | null = null
  const modules = Object.freeze(
    version.modules.map((module): StudyPathModuleProgress => {
      let completedInModule = 0
      const lessons = Object.freeze(
        module.lessons.map((lesson): StudyPathLessonProgress => {
          const progress = progressByLessonKey.get(lesson.lessonKey) ?? null
          const completed = progress?.completed === true
          const effectiveResumeSeconds = progress ? studentEffectiveResumeSeconds(progress) : 0
          if (completed) {
            completedInModule++
            completedLessons++
          } else if (!continueLesson) {
            continueLesson = Object.freeze({
              lessonKey: lesson.lessonKey,
              moduleKey: module.moduleKey,
              modulePosition: module.position,
              lessonPosition: lesson.position,
              progress,
              effectiveResumeSeconds,
            })
          }
          return Object.freeze({
            lessonKey: lesson.lessonKey,
            position: lesson.position,
            completed,
            progress,
            effectiveResumeSeconds,
          })
        }),
      )
      return Object.freeze({
        moduleKey: module.moduleKey,
        position: module.position,
        completedLessons: completedInModule,
        totalLessons: lessons.length,
        percentage: percentage(completedInModule, lessons.length),
        completed: completedInModule === lessons.length,
        lessons,
      })
    }),
  )
  const totalLessons = modules.reduce((total, module) => total + module.totalLessons, 0)

  return Object.freeze({
    completedLessons,
    totalLessons,
    percentage: percentage(completedLessons, totalLessons),
    completed: completedLessons === totalLessons,
    modules,
    continueLesson,
  })
}
