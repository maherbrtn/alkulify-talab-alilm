import {
  deriveStudyPathProgress,
  validateStudyPathVersion,
  type StudyPathContinueLesson,
  type StudyPathDefinition,
  type StudyPathVersion,
} from './study-paths'
import type { StudentProgressRow } from './student-progress'
import type { StudyPathEnrollmentRow, StudyPathEnrollmentState } from './supabase'

export type StudyPathLessonDisplay = {
  readonly lessonKey: string
  readonly title: string
  /** Resolved same-origin route, kept outside canonical curriculum. */
  readonly href: string
}

export function studyPathEnrollmentActions(state: StudyPathEnrollmentState) {
  return {
    pause: state === 'active',
    resume: state === 'paused',
    withdraw: state === 'active' || state === 'paused',
    upgrade: state === 'active' || state === 'paused',
  }
}

/** Input must be an owner-visible read. Never choose arbitrarily from corrupt live state. */
export function partitionStudyPathEnrollments(
  rows: readonly StudyPathEnrollmentRow[],
  pathId: string,
) {
  const matching = rows.filter((row) => row.path_id === pathId)
  if (new Set(matching.map((row) => row.user_id)).size > 1)
    throw new Error('mixed enrollment owners')
  if (new Set(matching.map((row) => row.id)).size !== matching.length ||
      new Set(matching.map((row) => row.path_version)).size !== matching.length)
    throw new Error('duplicate path enrollment')
  const live = matching.filter((row) => row.state === 'active' || row.state === 'paused')
  if (live.length > 1) throw new Error('multiple live enrollments for one path')
  return {
    live: live[0] ?? null,
    historical: matching.filter((row) => row.state === 'withdrawn' || row.state === 'superseded'),
  }
}

/** An explicit ID never falls back to the live enrollment or another path. */
export function selectStudyPathEnrollment(
  rows: readonly StudyPathEnrollmentRow[],
  pathId: string,
  enrollmentId?: string,
): StudyPathEnrollmentRow | null {
  const { live, historical } = partitionStudyPathEnrollments(rows, pathId)
  if (enrollmentId === undefined) return live
  return [live, ...historical].find((row) => row?.id === enrollmentId) ?? null
}

function versionAt(path: StudyPathDefinition, number: number): StudyPathVersion {
  const matches = path.versions.filter((version) => version.version === number)
  if (matches.length !== 1) throw new Error('study path version unavailable')
  const version = validateStudyPathVersion(matches[0], path.pathId)
  if (version.publishedAt === null) throw new Error('study path version is unpublished')
  return version
}

export function resolveStudentStudyPathVersions(
  path: StudyPathDefinition,
  enrollment?: StudyPathEnrollmentRow | null,
) {
  if (enrollment && enrollment.path_id !== path.pathId)
    throw new Error('enrollment belongs to another path')
  const current = versionAt(path, path.currentVersion)
  const pinned = enrollment ? versionAt(path, enrollment.path_version) : null
  return { current, pinned, newer: pinned && current.version > pinned.version ? current : null }
}

export type StudyPathEligibility =
  | { allowed: true }
  | { allowed: false; reason: 'not-published' | 'live-exists' | 'terminal-version' |
      'source-not-live' | 'not-forward' | 'not-current' }

/** A candidate only: registry availability/retirement is authoritative at RPC time. */
export function freshStudyPathEnrollmentEligibility(
  path: StudyPathDefinition,
  rows: readonly StudyPathEnrollmentRow[],
): StudyPathEligibility {
  if (path.status !== 'published') return { allowed: false, reason: 'not-published' }
  resolveStudentStudyPathVersions(path)
  const { live, historical } = partitionStudyPathEnrollments(rows, path.pathId)
  if (live) return { allowed: false, reason: 'live-exists' }
  if (historical.some((row) => row.path_version === path.currentVersion))
    return { allowed: false, reason: 'terminal-version' }
  return { allowed: true }
}

/** Slice 5 offers the current published version only; never implies a mutation succeeded. */
export function studyPathUpgradeEligibility(
  path: StudyPathDefinition,
  rows: readonly StudyPathEnrollmentRow[],
  sourceId: string,
  targetVersion: number = path.currentVersion,
): StudyPathEligibility {
  if (path.status !== 'published') return { allowed: false, reason: 'not-published' }
  const { live, historical } = partitionStudyPathEnrollments(rows, path.pathId)
  if (!live || live.id !== sourceId) return { allowed: false, reason: 'source-not-live' }
  resolveStudentStudyPathVersions(path, live)
  if (targetVersion <= live.path_version) return { allowed: false, reason: 'not-forward' }
  if (targetVersion !== path.currentVersion) return { allowed: false, reason: 'not-current' }
  if (historical.some((row) => row.path_version === targetVersion))
    return { allowed: false, reason: 'terminal-version' }
  return { allowed: true }
}

export function studyPathUpgradePreview(sourceValue: StudyPathVersion, targetValue: StudyPathVersion) {
  const source = validateStudyPathVersion(sourceValue)
  const target = validateStudyPathVersion(targetValue, source.pathId)
  if (source.publishedAt === null || target.publishedAt === null)
    throw new Error('upgrade requires published versions')
  if (target.version <= source.version) throw new Error('upgrade must be forward')
  const keys = (version: StudyPathVersion) =>
    version.modules.flatMap((module) => module.lessons.map((lesson) => lesson.lessonKey))
  const sourceKeys = new Set(keys(source))
  const targetKeys = new Set(keys(target))
  return {
    sourceVersion: source.version,
    targetVersion: target.version,
    addedLessonKeys: [...targetKeys].filter((key) => !sourceKeys.has(key)),
    removedLessonKeys: [...sourceKeys].filter((key) => !targetKeys.has(key)),
    sharedLessonKeys: [...targetKeys].filter((key) => sourceKeys.has(key)),
    // Validated modules have canonical field order. Includes membership, module
    // identity/title/objective and order; excludes version/publication metadata.
    structureOrOrderChanged: JSON.stringify(source.modules) !== JSON.stringify(target.modules),
  }
}

export function studyPathContinueLink(
  lesson: StudyPathContinueLesson | null,
  metadata: readonly StudyPathLessonDisplay[],
): StudyPathLessonDisplay | null {
  if (!lesson) return null
  const matches = metadata.filter((item) => item.lessonKey === lesson.lessonKey)
  if (matches.length !== 1) throw new Error('continue lesson metadata unavailable')
  const display = matches[0]
  // Routes are build-resolved base paths, never external URLs or query-supplied redirects.
  if (!/^\/(?!\/)[^?#\\\s]+\/$/.test(display.href))
    throw new Error('invalid resolved lesson route')
  const seconds = Number.isFinite(lesson.effectiveResumeSeconds) &&
    lesson.effectiveResumeSeconds > 0
    ? Math.floor(lesson.effectiveResumeSeconds)
    : null
  return {
    ...display,
    href: seconds !== null ? `${display.href}?t=${seconds}` : display.href,
  }
}

export function deriveStudentStudyPath(
  path: StudyPathDefinition,
  enrollment: StudyPathEnrollmentRow,
  progressRows: readonly StudentProgressRow[],
  metadata: readonly StudyPathLessonDisplay[],
) {
  const { pinned } = resolveStudentStudyPathVersions(path, enrollment)
  const progress = deriveStudyPathProgress(pinned!, progressRows)
  return {
    version: pinned!,
    progress,
    completed: progress.completed,
    // Paused/history retain derived progress but offer no lifecycle Continue action.
    continueLesson: enrollment.state === 'active'
      ? studyPathContinueLink(progress.continueLesson, metadata) : null,
  }
}
