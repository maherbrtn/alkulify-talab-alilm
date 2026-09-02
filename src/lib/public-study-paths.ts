import { lessonRegistry, videoByLessonKey, type Video } from './data'
import {
  validateStudyPathDefinition,
  type StudyPathDefinition,
  type StudyPathVersion,
} from './study-paths'

export type PublicStudyPathLesson = {
  readonly lessonKey: string
  readonly position: number
  readonly title: string
  readonly href: string
}

export type PublicStudyPathModule = Omit<StudyPathVersion['modules'][number], 'lessons'> & {
  readonly lessons: readonly PublicStudyPathLesson[]
}

export type PublicStudyPathVersion = Omit<StudyPathVersion, 'modules'> & {
  readonly modules: readonly PublicStudyPathModule[]
}

export type PublicStudyPath = Omit<StudyPathDefinition, 'versions'> & {
  readonly versions: readonly PublicStudyPathVersion[]
  readonly current: PublicStudyPathVersion
  readonly lessonCount: number
}

export type PublicStudyPathCurrentRouteEntry = {
  readonly params: { readonly slug: string }
  readonly props: { readonly path: PublicStudyPath }
}

export type PublicStudyPathHistoricalRouteEntry = {
  readonly params: { readonly slug: string; readonly version: string }
  readonly props: {
    readonly path: PublicStudyPath
    readonly version: PublicStudyPathVersion
  }
}

export const currentStudyPathHref = (slug: string): string => `/study-paths/${slug}/`

export const historicalStudyPathHref = (slug: string, version: number): string =>
  `/study-paths/${slug}/versions/${version}/`

function resolveVersion(
  version: StudyPathVersion,
  lessonsByKey: ReadonlyMap<string, Video>,
): PublicStudyPathVersion {
  return Object.freeze({
    ...version,
    modules: Object.freeze(
      version.modules.map((module) =>
        Object.freeze({
          ...module,
          lessons: Object.freeze(
            module.lessons.map((lesson) => {
              const video = lessonsByKey.get(lesson.lessonKey)
              if (!video) {
                throw new Error(`study path lesson has no public route: ${lesson.lessonKey}`)
              }
              return Object.freeze({
                ...lesson,
                title: video.title,
                href: `/v/${video.id}/`,
              })
            }),
          ),
        }),
      ),
    ),
  })
}

export function createPublicStudyPathCatalog(
  values: readonly unknown[],
  lessonsByKey: ReadonlyMap<string, Video> = videoByLessonKey,
): readonly PublicStudyPath[] {
  const slugs = new Set<string>()
  const routeKeys = new Set<string>()
  const paths = values.map((value): PublicStudyPath => {
    const path = validateStudyPathDefinition(value, lessonRegistry)
    if (path.status !== 'published') {
      throw new Error(`only published study paths can enter the public catalog: ${path.slug}`)
    }
    if (slugs.has(path.slug)) throw new Error(`duplicate public study path slug: ${path.slug}`)
    slugs.add(path.slug)

    const versions = Object.freeze(
      path.versions.map((version) => {
        const routeKey = `${path.slug}/${version.version}`
        if (routeKeys.has(routeKey)) throw new Error(`duplicate public study path route: ${routeKey}`)
        routeKeys.add(routeKey)
        return resolveVersion(version, lessonsByKey)
      }),
    )
    const current = versions.find((version) => version.version === path.currentVersion)
    if (!current) throw new Error(`current public study path version is missing: ${path.slug}`)

    return Object.freeze({
      ...path,
      versions,
      current,
      lessonCount: current.modules.reduce((total, module) => total + module.lessons.length, 0),
    })
  })
  return Object.freeze(paths)
}

// Add reviewed, scholarly definitions here only after they are genuinely publishable.
// The technical draft fixture deliberately never enters this public source list.
export const publicStudyPathDefinitions: readonly unknown[] = []

export const publicStudyPaths = createPublicStudyPathCatalog(publicStudyPathDefinitions)

export function publicStudyPathCurrentRouteEntries(
  paths: readonly PublicStudyPath[] = publicStudyPaths,
): readonly PublicStudyPathCurrentRouteEntry[] {
  return paths.map((path) => ({ params: { slug: path.slug }, props: { path } }))
}

export function publicStudyPathHistoricalRouteEntries(
  paths: readonly PublicStudyPath[] = publicStudyPaths,
): readonly PublicStudyPathHistoricalRouteEntry[] {
  return paths.flatMap((path) =>
    path.versions
      .filter((version) => version.version !== path.currentVersion)
      .map((version) => ({
        params: { slug: path.slug, version: String(version.version) },
        props: { path, version },
      })),
  )
}

export function publicStudyPathBySlug(
  slug: string,
  paths: readonly PublicStudyPath[] = publicStudyPaths,
): PublicStudyPath | undefined {
  return paths.find((path) => path.slug === slug)
}

export function publicStudyPathVersion(
  slug: string,
  version: number,
  paths: readonly PublicStudyPath[] = publicStudyPaths,
): PublicStudyPathVersion | undefined {
  return publicStudyPathBySlug(slug, paths)?.versions.find((item) => item.version === version)
}
