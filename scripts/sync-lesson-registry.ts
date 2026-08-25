/** Preserve project-owned lesson identities and assign one only to newly seen source records. */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import {
  validateLessonRegistry,
  type LessonRegistry,
  type LessonRegistryEntry,
} from '../src/lib/lesson-registry.ts'

const data = new URL('../data/', import.meta.url)
const videosPath = new URL('videos.json', data)
const registryPath = new URL('lesson-registry.json', data)
const temporaryPath = new URL('lesson-registry.json.tmp', data)

const videos: unknown = JSON.parse(await readFile(videosPath, 'utf8'))
if (!Array.isArray(videos)) throw new Error('data/videos.json must be an array')
const currentVideoIds = videos.map((video, index) => {
  if (!video || typeof video !== 'object' || Array.isArray(video)) {
    throw new Error(`video ${index} must be an object`)
  }
  const id = Reflect.get(video, 'id')
  if (typeof id !== 'string' || !id || id.trim() !== id) {
    throw new Error(`video ${index} has an invalid id`)
  }
  return id
})

const existingValue: unknown = existsSync(registryPath)
  ? JSON.parse(await readFile(registryPath, 'utf8'))
  : { version: 1, lessons: [] }
const existing = validateLessonRegistry(existingValue)
const bySource = new Map(existing.lessons.map((entry) => [entry.youtube_video_id, entry]))

let added = 0
for (const sourceId of currentVideoIds) {
  if (bySource.has(sourceId)) continue
  const entry: LessonRegistryEntry = { lesson_key: randomUUID(), youtube_video_id: sourceId }
  existing.lessons.push(entry)
  bySource.set(sourceId, entry)
  added++
}

const registry: LessonRegistry = {
  version: 1,
  lessons: existing.lessons.sort((a, b) =>
    a.youtube_video_id < b.youtube_video_id ? -1 : a.youtube_video_id > b.youtube_video_id ? 1 : 0,
  ),
}
validateLessonRegistry(registry, currentVideoIds)

await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`)
await rename(temporaryPath, registryPath)
console.log(`${registry.lessons.length} lesson identities (${added} added)`)
