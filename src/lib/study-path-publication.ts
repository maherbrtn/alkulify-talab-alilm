import { lessonRegistry } from './data'
import { isUuidV4 } from './lesson-registry'
import { publicStudyPathDefinitions } from './public-study-paths'
import { studyPathVersionDigest, validateStudyPathDefinition } from './study-paths'

export type StudyPathPublication = {
  readonly path_id: string
  readonly version: number
  readonly definition_digest: string
  readonly published_at: string
}

export type StudyPathPublicationRegistryRow = StudyPathPublication & {
  readonly retired_at: string | null
}

export type StudyPathPublicationIssue = {
  readonly code: 'duplicate' | 'missing' | 'unexpected' | 'digest_mismatch' | 'published_at_mismatch'
  readonly identity: string
}

const identity = (pathId: string, version: number): string => `${pathId}/${version}`
const DIGEST = /^[0-9a-f]{64}$/

function canonicalTimestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`)
  }
  return value
}

export async function createStudyPathPublicationManifest(
  values: readonly unknown[],
): Promise<readonly StudyPathPublication[]> {
  const identities = new Set<string>()
  const publications: StudyPathPublication[] = []

  for (const value of values) {
    const path = validateStudyPathDefinition(value, lessonRegistry)
    if (path.status !== 'published') {
      throw new Error(`only published study paths can enter the publication manifest: ${path.slug}`)
    }
    for (const version of path.versions) {
      const key = identity(path.pathId, version.version)
      if (identities.has(key)) throw new Error(`duplicate study path publication: ${key}`)
      identities.add(key)
      publications.push(
        Object.freeze({
          path_id: path.pathId,
          version: version.version,
          definition_digest: await studyPathVersionDigest(version),
          published_at: version.publishedAt!,
        }),
      )
    }
  }

  return Object.freeze(publications)
}

export function createPublicStudyPathPublicationManifest(): Promise<
  readonly StudyPathPublication[]
> {
  return createStudyPathPublicationManifest(publicStudyPathDefinitions)
}

function validateRegistryRow(row: StudyPathPublicationRegistryRow): void {
  if (!isUuidV4(row.path_id)) throw new Error('publication registry path_id is invalid')
  if (!Number.isInteger(row.version) || row.version < 1) {
    throw new Error('publication registry version is invalid')
  }
  if (!DIGEST.test(row.definition_digest)) {
    throw new Error('publication registry definition_digest is invalid')
  }
  const publishedAt = canonicalTimestamp(row.published_at, 'publication registry published_at')
  if (row.retired_at !== null) {
    const retiredAt = canonicalTimestamp(row.retired_at, 'publication registry retired_at')
    if (retiredAt < publishedAt) {
      throw new Error('publication registry retired_at must not precede published_at')
    }
  }
}

export function verifyStudyPathPublicationRegistry(
  expected: readonly StudyPathPublication[],
  actual: readonly StudyPathPublicationRegistryRow[],
): readonly StudyPathPublicationIssue[] {
  const issues: StudyPathPublicationIssue[] = []
  const expectedByIdentity = new Map<string, StudyPathPublication>()
  const actualByIdentity = new Map<string, StudyPathPublicationRegistryRow>()

  for (const publication of expected) {
    const key = identity(publication.path_id, publication.version)
    if (expectedByIdentity.has(key)) issues.push({ code: 'duplicate', identity: key })
    expectedByIdentity.set(key, publication)
  }
  for (const row of actual) {
    validateRegistryRow(row)
    const key = identity(row.path_id, row.version)
    if (actualByIdentity.has(key)) issues.push({ code: 'duplicate', identity: key })
    actualByIdentity.set(key, row)
  }

  for (const [key, publication] of expectedByIdentity) {
    const row = actualByIdentity.get(key)
    if (!row) {
      issues.push({ code: 'missing', identity: key })
      continue
    }
    if (row.definition_digest !== publication.definition_digest) {
      issues.push({ code: 'digest_mismatch', identity: key })
    }
    if (row.published_at !== publication.published_at) {
      issues.push({ code: 'published_at_mismatch', identity: key })
    }
  }
  for (const key of actualByIdentity.keys()) {
    if (!expectedByIdentity.has(key)) issues.push({ code: 'unexpected', identity: key })
  }

  return Object.freeze(issues.map((issue) => Object.freeze(issue)))
}

export function assertStudyPathPublicationRegistry(
  expected: readonly StudyPathPublication[],
  actual: readonly StudyPathPublicationRegistryRow[],
): void {
  const issues = verifyStudyPathPublicationRegistry(expected, actual)
  if (issues.length) {
    throw new Error(
      `study path publication registry mismatch: ${issues
        .map((issue) => `${issue.code}:${issue.identity}`)
        .join(', ')}`,
    )
  }
}
