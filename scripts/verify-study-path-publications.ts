/** Deployment/admin check: compare the hosted registry with canonical Git definitions. */
import { createClient } from '@supabase/supabase-js'
import {
  assertStudyPathPublicationRegistry,
  createPublicStudyPathPublicationManifest,
  type StudyPathPublicationRegistryRow,
} from '../src/lib/study-path-publication.ts'

const url = process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceRoleKey) {
  throw new Error(
    'SUPABASE_URL (or PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required',
  )
}

const client = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data, error } = await client
  .from('study_path_versions')
  .select('path_id,version,definition_digest,published_at,retired_at')
  .order('path_id', { ascending: true })
  .order('version', { ascending: true })

if (error) throw error
if (!Array.isArray(data)) throw new Error('study path publication registry returned no rows array')

const manifest = await createPublicStudyPathPublicationManifest()
assertStudyPathPublicationRegistry(manifest, data as StudyPathPublicationRegistryRow[])
console.log(`study path publication registry verified (${manifest.length} versions)`)
