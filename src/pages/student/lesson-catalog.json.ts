import type { APIRoute } from 'astro'
import { videos } from '../../lib/data'

export type LessonCatalogEntry = [lessonKey: string, videoId: string, title: string]

export const lessonCatalog: LessonCatalogEntry[] = videos.map((video) => [
  video.lessonKey,
  video.id,
  video.title,
])

export const GET: APIRoute = () =>
  new Response(JSON.stringify(lessonCatalog), {
    headers: { 'content-type': 'application/json' },
  })
