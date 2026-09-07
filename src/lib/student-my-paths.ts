import { isUuidV4 } from './lesson-registry'
import { validateStudyPathVersion, type StudyPathDefinition, type StudyPathProgress } from './study-paths'
import {
  deriveStudentStudyPath, partitionStudyPathEnrollments, resolveStudentStudyPathVersions,
  type StudyPathLessonDisplay,
} from './student-study-path'
import type { StudentProgressRow } from './student-progress'
import type { StudyPathEnrollmentRow } from './supabase'

/** The build-validated shape returned by studentStudyPathPageProps; all versions retained.
 * Registry/route resolution belongs to that build boundary, never to an owner read.
 */
export type StudentMyPathsCatalogEntry = {
  readonly path: StudyPathDefinition
  readonly metadata: readonly StudyPathLessonDisplay[]
}

type EnrollmentInfo = {
  readonly pathId: string
  readonly enrollmentId: string
  readonly pinnedVersion: number
}
type PathInfo = { readonly slug: string; readonly title: string; readonly href: string }
type Availability =
  | ({ readonly availability: 'available' | 'unavailable-version' } & PathInfo)
  | { readonly availability: 'unavailable-path'; readonly slug: null; readonly title: null; readonly href: null }
type LiveInfo = EnrollmentInfo & Availability & { readonly state: 'active' | 'paused' }
export type StudentMyPathsHistory = EnrollmentInfo & Availability & {
  readonly state: 'withdrawn' | 'superseded'
  readonly readOnly: true
}
type LivePlan = {
  readonly info: LiveInfo
  readonly curriculum: (StudentMyPathsCatalogEntry & {
    readonly enrollment: StudyPathEnrollmentRow
  }) | null
}
export type StudentMyPathsPlan = {
  readonly live: readonly LivePlan[]
  readonly history: readonly StudentMyPathsHistory[]
  readonly corrupt: readonly { readonly pathId: string; readonly status: 'corrupt-enrollment' }[]
  readonly lessonKeys: readonly string[]
}
type CardProgress = Pick<StudyPathProgress,
  'completedLessons' | 'totalLessons' | 'percentage' | 'completed'>
export type StudentMyPathsCard = LiveInfo & (
  | { readonly status: 'ready'; readonly progress: CardProgress;
      readonly continueLesson: StudyPathLessonDisplay | null }
  | { readonly status: 'unavailable' | 'progress-error' | 'derivation-error';
      readonly progress: null; readonly continueLesson: null }
)

/** Only mark complete after the entire readProgress(plan.lessonKeys) succeeds.
 * A failed read has no rows to accidentally turn into apparent zero progress.
 */
export type StudentMyPathsProgressRead =
  | { readonly status: 'complete'; readonly rows: readonly StudentProgressRow[] }
  | { readonly status: 'error' }

function catalogById(entries: readonly StudentMyPathsCatalogEntry[]) {
  const paths = new Map<string, StudentMyPathsCatalogEntry>()
  const slugs = new Set<string>()
  for (const { path, metadata } of entries) {
    // Validate the navigation envelope independently of curriculum availability.
    if (!isUuidV4(path.pathId) || typeof path.slug !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path.slug) ||
        typeof path.title !== 'string' || !path.title.trim() || path.status !== 'published')
      throw new Error('invalid My Paths catalog identity')
    if (paths.has(path.pathId) || slugs.has(path.slug))
      throw new Error('ambiguous My Paths catalog identity')
    const versions = path.versions.map((version) => validateStudyPathVersion(version, path.pathId))
    if (new Set(versions.map((version) => version.version)).size !== versions.length)
      throw new Error('duplicate My Paths catalog version')
    if (versions.some((version) => version.publishedAt === null))
      throw new Error('unpublished My Paths catalog version')
    const snapshot = Object.freeze({ ...path, versions: Object.freeze(versions) })
    resolveStudentStudyPathVersions(snapshot)
    paths.set(path.pathId, {
      path: snapshot,
      metadata: Object.freeze(metadata.map((item) => Object.freeze({ ...item }))),
    })
    slugs.add(path.slug)
  }
  return paths
}

/** Pure planning after a COMPLETE owner enrollment read and verified authentication.
 * ownerId is only a defensive in-memory check, never a database filter/authority.
 * Foreign rows reject everything before any owner data can be returned.
 * Cards/groups sort by path ID; history sorts by descending version within a path.
 */
export function planStudentMyPaths(
  ownerId: string,
  rows: readonly StudyPathEnrollmentRow[],
  catalog: readonly StudentMyPathsCatalogEntry[],
): StudentMyPathsPlan {
  if (!isUuidV4(ownerId) || rows.some((row) => row.user_id !== ownerId))
    throw new Error('My Paths enrollment owner mismatch')
  const paths = catalogById(catalog)
  const groups = new Map<string, StudyPathEnrollmentRow[]>()
  const idCounts = new Map<string, number>()
  for (const row of rows) {
    if (!isUuidV4(row.path_id)) throw new Error('invalid My Paths enrollment path identity')
    const group = groups.get(row.path_id) ?? []
    group.push(Object.freeze({ ...row }))
    groups.set(row.path_id, group)
    idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1)
  }
  const live: LivePlan[] = []
  const history: StudentMyPathsHistory[] = []
  const corrupt: StudentMyPathsPlan['corrupt'][number][] = []
  const keys = new Set<string>()

  for (const pathId of [...groups.keys()].sort()) {
    const group = groups.get(pathId)!
    let partition: ReturnType<typeof partitionStudyPathEnrollments>
    try {
      if (group.some((row) => !isUuidV4(row.id) || idCounts.get(row.id) !== 1 ||
          !Number.isInteger(row.path_version) || row.path_version < 1 ||
          !['active', 'paused', 'withdrawn', 'superseded'].includes(row.state)))
        throw new Error('invalid My Paths enrollment identity')
      partition = partitionStudyPathEnrollments(group, pathId)
    } catch {
      corrupt.push({ pathId, status: 'corrupt-enrollment' })
      continue
    }
    const entry = paths.get(pathId)
    const describe = (row: StudyPathEnrollmentRow): EnrollmentInfo & Availability => {
      const info = { pathId, enrollmentId: row.id, pinnedVersion: row.path_version }
      if (!entry) return { ...info, availability: 'unavailable-path', slug: null, title: null, href: null }
      let availability: 'available' | 'unavailable-version' = 'available'
      try { resolveStudentStudyPathVersions(entry.path, row) }
      catch { availability = 'unavailable-version' }
      const base = `/student/study-paths/${entry.path.slug}/`
      return {
        ...info, availability, slug: entry.path.slug, title: entry.path.title,
        href: row.state === 'active' || row.state === 'paused'
          ? base : `${base}?enrollment=${row.id}`,
      }
    }
    if (partition.live) {
      const enrollment = partition.live
      const info: LiveInfo = { ...describe(enrollment), state: enrollment.state as 'active' | 'paused' }
      const curriculum = info.availability === 'available' && entry ? { ...entry, enrollment } : null
      if (curriculum) {
        const { pinned } = resolveStudentStudyPathVersions(curriculum.path, enrollment)
        for (const module of pinned!.modules)
          for (const lesson of module.lessons) keys.add(lesson.lessonKey)
      }
      live.push({ info, curriculum })
    }
    for (const enrollment of [...partition.historical].sort((a, b) => b.path_version - a.path_version))
      history.push({ ...describe(enrollment), state: enrollment.state as 'withdrawn' | 'superseded', readOnly: true })
  }
  return { live, history, corrupt, lessonKeys: [...keys].sort() }
}

/** One shared complete progress response feeds all live curricula independently.
 * History deliberately has neither progress nor Continue in this dashboard model.
 */
export function deriveStudentMyPaths(
  plan: StudentMyPathsPlan,
  read: StudentMyPathsProgressRead,
): { live: readonly StudentMyPathsCard[]; history: StudentMyPathsPlan['history']; corrupt: StudentMyPathsPlan['corrupt'] } {
  const live = plan.live.map(({ info, curriculum }): StudentMyPathsCard => {
    if (!curriculum)
      return { ...info, status: 'unavailable', progress: null, continueLesson: null }
    if (read.status !== 'complete')
      return { ...info, status: 'progress-error', progress: null, continueLesson: null }
    try {
      const study = deriveStudentStudyPath(curriculum.path, curriculum.enrollment, read.rows, curriculum.metadata)
      const { completedLessons, totalLessons, percentage, completed } = study.progress
      return { ...info, status: 'ready', progress: { completedLessons, totalLessons, percentage, completed },
        continueLesson: study.continueLesson }
    } catch {
      return { ...info, status: 'derivation-error', progress: null, continueLesson: null }
    }
  })
  return { live, history: plan.history, corrupt: plan.corrupt }
}
