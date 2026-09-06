/** `pnpm check` — the smallest thing that fails if the text plumbing breaks. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { client, highlight, peek, rateLimited, search } from '../src/lib/meili.ts'
import { normalize } from '../src/lib/normalize.ts'
import { clean, mergeSegments } from '../src/lib/clean.ts'
import { chunk, decode, paragraphs, titleKey } from '../src/lib/html.ts'
import { markMatches } from '../src/lib/mark.ts'
import { timestamp, duration, arabicDate, lessons, hours, lists, articles, withDigits } from '../src/lib/format.ts'
import { breadcrumb, mailto, CONTACT_EMAIL, SITE, SITE_URL } from '../src/lib/seo.ts'
import { allArticles, contentDigest, playlists, playlistVideos, videos } from '../src/lib/data.ts'
import { validateLessonRegistry } from '../src/lib/lesson-registry.ts'
import {
  createSessionAwareLessonProgress,
  type LessonProgress,
} from '../src/lib/lesson-progress.ts'
import {
  deriveStudentProgress,
  studentDisplayPercentage,
  studentEffectiveResumeSeconds,
  studentLessonHref,
  type StudentLessonMetadata,
  type StudentProgressRow,
} from '../src/lib/student-progress.ts'
import {
  canonicalStudyPathVersion,
  deriveStudyPathProgress,
  studyPathVersionDigest,
  validateStudyPathDefinition,
  validateStudyPathVersionLessonKeys,
  type StudyPathVersion,
} from '../src/lib/study-paths.ts'
import {
  assertStudyPathPublicationRegistry,
  createPublicStudyPathPublicationManifest,
  createStudyPathPublicationManifest,
  verifyStudyPathPublicationRegistry,
  type StudyPathPublicationRegistryRow,
} from '../src/lib/study-path-publication.ts'
import {
  createPublicStudyPathCatalog,
  currentStudyPathHref,
  historicalStudyPathHref,
  publicStudyPathBySlug,
  publicStudyPathCurrentRouteEntries,
  publicStudyPathHistoricalRouteEntries,
  publicStudyPathVersion,
  publicStudyPaths,
} from '../src/lib/public-study-paths.ts'
import {
  decodeStudentLessonCatalog,
  fetchStudentLessonCatalog,
  StudentLessonCatalogError,
} from '../src/lib/student-lesson-catalog.ts'
import {
  GET as getLessonCatalog,
  lessonCatalog,
} from '../src/pages/student/lesson-catalog.json.ts'
import { all, update } from '../src/lib/store.ts'

// highlight: escapes everything except <mark>, so a hostile transcript cannot inject HTML
assert.equal(
  highlight('<img src=x onerror=alert(1)>', ''),
  '&lt;img src=x onerror=alert(1)&gt;',
)
// Meilisearch marks the split-off definite article on its own — drop it
assert.equal(highlight('<mark>ال</mark>كتاب', ''), 'الكتاب')
// adjacent marks (phrase match, word by word) merge into one continuous highlight
assert.equal(highlight('<mark>كفارة</mark> <mark>اليمين</mark>', ''), '<mark>كفارة اليمين</mark>')
// the article split off the *matched* word must stay inside the highlight
assert.equal(highlight('<mark>ال</mark><mark>صلاه</mark> نعم', ''), '<mark>الصلاه</mark> نعم')
// a merged mark must not swallow the article of the following word
assert.equal(highlight('<mark>كفاره</mark> <mark>ال</mark>ظهار', ''), '<mark>كفاره</mark> الظهار')
// two marked articles in a row must not leave one of them marked
assert.equal(highlight('<mark>ال</mark> <mark>ال</mark>ا ان', ''), 'ال الا ان')
assert.equal(highlight(undefined, 'نص عادي'), 'نص عادي')

// normalize: the folding Meilisearch does at query time, mirrored for client-side filters
assert.equal(normalize('الصَّلاة'), 'الصلاه')
assert.equal(normalize('إسلام'), normalize('اسلام'))
assert.equal(normalize('مصطفى'), 'مصطفي')

// clean: YouTube sound-event tags out, real text untouched
assert.equal(clean('قال [موسيقى] الشيخ'), 'قال الشيخ')
assert.equal(clean('[تصفيق]'), '')
assert.equal(clean('باب الطلاق'), 'باب الطلاق')
assert.equal(
  clean('بعظ الموظوع ايظا رافظي يظرب ظعيفا ظبط ظمن الظرورة وظع رظي رمظان قظية فظائل يظحك غظب الوعض ضاهر حظور فضيع'),
  'بعض الموضوع ايضا رافضي يضرب ضعيفا ضبط ضمن الضرورة وضع رضي رمضان قضية فضائل يضحك غضب الوعظ ظاهر حضور فظيع',
)
assert.equal(clean('بعظمة محظور فضيعة القرظي فظلت'), 'بعظمة محظور فضيعة القرظي فظلت')

// mergeSegments: short speech fragments join, but silence and a 20 s span remain boundaries.
assert.deepEqual(
  mergeSegments([
    { text: '1 2 3 4 5', start: 0, end: 3 },
    { text: '6 7 8 9 10 11 12 13 14 15', start: 3.5, end: 8 },
    { text: 'قصير', start: 8.5, end: 9 },
    { text: 'بعد صمت', start: 11.1, end: 12 },
    { text: 'بعيد', start: 12.5, end: 32 },
  ]),
  [
    { text: '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15', start: 0, end: 8 },
    { text: 'قصير', start: 8.5, end: 9 },
    { text: 'بعد صمت', start: 11.1, end: 12 },
    { text: 'بعيد', start: 12.5, end: 32 },
  ],
)

// html: Word-pasted article markup in, ~paragraph-sized chunks out
assert.deepEqual(paragraphs('<div>سطر أول</div><div>سطر ثانٍ</div>'), ['سطر أول سطر ثانٍ'])
assert.deepEqual(paragraphs('<!--[if gte mso 9]><xml>junk</xml><![endif]--><p>نص</p>'), ['نص'])
assert.equal(decode('&#1575;&amp;&nbsp;ب'), 'ا& ب')
// the Telegram body is full of these; undecoded they survive into the text as literal `&rlm;`
assert.equal(decode('&rlm;نص'), '\u200fنص')
// chunk: the same gluing, but over lines the caller already split (Telegram keeps its blanks)
assert.deepEqual(chunk(['سطر أول', 'سطر ثانٍ']), ['سطر أول سطر ثانٍ'])
// a line that is already long enough closes its chunk instead of swallowing the next one
const long = 'ك'.repeat(600)
assert.deepEqual(paragraphs(`<p>${long}</p><p>ذيل</p>`), [long, 'ذيل'])
// titleKey: the same post on wp and blogger, differing only in diacritics/punctuation
assert.equal(titleKey('الصَّلاة … '), titleKey('الصلاه'))
assert.notEqual(titleKey('تقويم المعاصرين ( الحلقة الثانية )'), titleKey('تقويم المعاصرين ( الحلقة الثانية عشر )'))

// Incremental builds must reuse identical JSON, but transcript corrections and list order
// both change rendered pages and therefore their cache keys.
const cached = { transcript: ['النص القديم'], videos: ['a', 'b'] }
assert.equal(contentDigest(cached), contentDigest({ ...cached }))
assert.notEqual(contentDigest(cached), contentDigest({ ...cached, transcript: ['النص المصحح'] }))
assert.notEqual(contentDigest(cached), contentDigest({ ...cached, videos: ['b', 'a'] }))

// format
assert.equal(timestamp(0), '00:00')
assert.equal(timestamp(3671), '1:01:11')
assert.equal(duration(3600), '1 س')
assert.equal(duration(90), '2 د')
assert.equal(arabicDate('2025-03-08'), '8 مارس 2025')
assert.equal(arabicDate(null), '')

// counted nouns: the form follows the last two digits, and the dual drops the numeral
assert.equal(lessons(1), '1 درس')
assert.equal(lessons(2), 'درسان')
assert.equal(lessons(3), '3 دروس')
assert.equal(lessons(10), '10 دروس')
assert.equal(lessons(11), '11 درسًا')
assert.equal(lessons(92), '92 درسًا')
assert.equal(lessons(100), '100 درس')
assert.equal(lessons(102), '102 درسان')
assert.equal(lessons(112), '112 درسًا')
assert.equal(hours(109), '109 ساعات')
assert.equal(lists(2), 'قائمتان')
assert.equal(withDigits('109 ساعات'), '<span class="digits">109</span> ساعات')
// four figures group, and the separator must stay inside the one digit run — a `\d+` regex
// splits `3,333` into two spans, which renders as `3,333` with the comma outside both
assert.equal(articles(3333), '3,333 مقالة')
assert.equal(lessons(1584), '1,584 درسًا')
assert.equal(withDigits(articles(3333)), '<span class="digits">3,333</span> مقالة')

// seo: breadcrumbs must be absolute, 1-indexed, and root-anchored — Google drops the
// whole BreadcrumbList otherwise, and relative `item` URLs are the usual way that breaks.
const crumbs = breadcrumb([['القوائم', '/p/'], ['قائمة', '/p/abc/']]).itemListElement
assert.equal(crumbs.length, 3)
assert.deepEqual(
  crumbs.map((c) => [c.position, c.item]),
  [
    [1, `${SITE_URL}/`],
    [2, `${SITE_URL}/p/`],
    [3, `${SITE_URL}/p/abc/`],
  ],
)
assert.ok(crumbs.every((c) => c.item.startsWith('https://')))

// markMatches: the in-video transcript filter. Same contract as meili's highlight, but it
// runs on raw transcript text in the browser, so escaping is the security boundary here.
assert.equal(markMatches('<img src=x onerror=alert(1)>', 'zzz'), '&lt;img src=x onerror=alert(1)&gt;')
assert.equal(markMatches('باب الصلاة', normalize('الصلاة')), 'باب <mark>الصلاة</mark>')
// a phrase spanning two words comes back as one continuous mark, not two
assert.equal(markMatches('كفارة اليمين واجبة', normalize('كفارة اليمين')), '<mark>كفارة اليمين</mark> واجبة')
// no match leaves the text alone (still escaped)
assert.equal(markMatches('باب الصلاة', normalize('الزكاة')), 'باب الصلاة')
// folding means the query matches undiacritised text and vice versa
assert.equal(markMatches('الصَّلاة نعم', normalize('الصلاه')), '<mark>الصَّلاة</mark> نعم')
// an empty query must return early: indexOf('') never reaches -1, so the match loop hangs
assert.equal(markMatches('باب الصلاة', ''), 'باب الصلاة')

// mailto: the contact form hands this straight to the mail client, so an unencoded `&`
// or `#` in the subject would truncate the message the user just typed.
const link = mailto('س & ج #1', 'سطر\nآخر')
assert.ok(link.startsWith(`mailto:${CONTACT_EMAIL}?subject=`))
const q = new URL(link).searchParams
assert.equal(q.get('subject'), `[${SITE}] س & ج #1`)
assert.equal(q.get('body'), 'سطر\nآخر')

// search cache: a tab switch, or a back button, re-asks a question already answered. It must
// come back from memory — the server embeds every query on one shared core — and the same
// filters in another order are the same question.
let calls = 0
const stub = { hits: [], totalHits: 1, page: 1, totalPages: 1, processingTimeMs: 0 }
client.multiSearch = (async () => {
  calls++
  return { results: [stub, stub] }
}) as unknown as typeof client.multiSearch
client.index = (() => ({ search: async () => stub })) as unknown as typeof client.index

await search('كفارة اليمين', { tab: 'v', playlists: ['b', 'a'] })
await search('كفارة اليمين', { tab: 'v', playlists: ['a', 'b'] })
assert.equal(calls, 1)
assert.ok(peek('كفارة اليمين', { tab: 'v', playlists: ['a', 'b'] }))
// a different tab, page or filter is a different answer, and must still go out
await search('كفارة اليمين', { tab: 'a', playlists: ['a', 'b'] })
await search('كفارة اليمين', { tab: 'v', playlists: [] })
assert.equal(calls, 3)
assert.equal(peek('كفارة اليمين', { tab: 'v', page: 2 }), undefined)

// The bfcache is not a guarantee: a back button that misses it lands on a fresh document with
// an empty Map and only sessionStorage to answer from. Plant an answer the way search() stores
// one — under a question the Map has never held — and peek must still find it.
const store = new Map<string, string>()
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})
await search('كفارة اليمين', { tab: 'v', page: 3 })
const [stored] = [...store.keys()]
assert.ok(stored, 'an answer must outlive the document that asked for it')
store.set(stored.replace('كفارة اليمين', 'سؤال آخر'), JSON.stringify({ ...stub, total: 42 }))
assert.equal(peek('سؤال آخر', { tab: 'v', page: 3 })?.total, 42)

// A refusal must not become three requests. Caddy answers 429 at 30 per 10 s per IP, and the
// fallbacks in `both` are there for a missing embedder, not for a closed door — `client.index`
// is still stubbed to succeed above, so a missing guard shows up here as a resolved search.
let refused = 0
client.multiSearch = (async () => {
  refused++
  throw Object.assign(new Error('too many requests'), { response: { status: 429 } })
}) as unknown as typeof client.multiSearch
await assert.rejects(search('سؤال لم يسبق أن سئل', { tab: 'v' }))
assert.equal(refused, 1)
assert.ok(!rateLimited(new Error('the box is simply down')))

// playlistVideos: /p/ and the lesson prev/next both walk this, and 9 of 43 playlists arrive
// from YouTube out of chronological order — an unsorted return reads as «الدرس التالي» going back.
for (const p of playlists) {
  const walked = playlistVideos(p)
  assert.equal(walked.length, p.videoIds.length, `${p.title} lost a lesson`)
  const dates = walked.map((v) => v.uploadDate ?? '')
  assert.ok(
    dates.every((d, i) => i === 0 || dates[i - 1] <= d),
    `${p.title} is not oldest-first`,
  )
}

// Project-owned lesson identity stays outside the generated video snapshot. Every current source
// record resolves exactly once, while malformed or ambiguous registry edits fail before a build.
const registryValue: unknown = JSON.parse(
  readFileSync(new URL('../data/lesson-registry.json', import.meta.url), 'utf8'),
)
const registry = validateLessonRegistry(registryValue, videos.map((video) => video.id))
assert.ok(registry.lessons.length >= videos.length)
assert.equal(new Set(videos.map((video) => video.lessonKey)).size, videos.length)
const sample = registry.lessons[0]
assert.throws(() =>
  validateLessonRegistry({
    version: 1,
    lessons: [sample, { ...sample, youtube_video_id: `${sample.youtube_video_id}-duplicate` }],
  }),
)
assert.throws(() =>
  validateLessonRegistry({
    version: 1,
    lessons: [sample, { ...sample, lesson_key: '00000000-0000-4000-8000-000000000000' }],
  }),
)
assert.throws(() => validateLessonRegistry({ version: 2, lessons: [] }))
assert.throws(() => validateLessonRegistry({ version: 1, lessons: [sample] }, ['missing-video']))
assert.doesNotThrow(() =>
  validateLessonRegistry({ version: 1, lessons: [sample] }, []),
)

const corpus = allArticles()
const books = corpus.filter(
  (a) => a.type === 'book' && a.download?.startsWith('https://drive.google.com/file/d/'),
)
assert.equal(books.length, 11)
assert.equal(new Set(books.map((book) => book.download)).size, books.length)

// Telegram articles: their photos live in public/, which nothing else in the build validates —
// a missed download or a renamed file is a 404 on a live page and silent everywhere else.
const pub = new URL('../public/', import.meta.url)
for (const a of corpus.filter((a) => a.source === 'telegram')) {
  assert.ok(a.title && a.paragraphs.length && a.date, `${a.id} came out of Telegram empty`)
  assert.ok(a.url.startsWith('https://t.me/'), `${a.id} has no source message`)
  for (const img of a.images ?? []) {
    assert.ok(
      existsSync(new URL(img.src.replace(/^\//, ''), pub)),
      `${a.id}: ${img.src} is not in public/`,
    )
    assert.ok(img.w > 0 && img.h > 0, `${a.id}: ${img.src} has no dimensions`)
  }
}

// store: one entry per page holds both the bookmark and the note, and an entry left with
// neither must disappear — otherwise unstarring a page nobody annotated litters /saved/.
const mem = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) },
})
const page = { title: 'درس', kind: 'v' as const }
update('/v/x/', page, { mark: true })
update('/v/x/', page, { note: 'ملاحظة' })
assert.equal(all()['/v/x/'].mark, true)
assert.equal(all()['/v/x/'].note, 'ملاحظة')
update('/v/x/', page, { mark: undefined })
assert.equal(all()['/v/x/'].note, 'ملاحظة') // the note alone keeps the entry alive
update('/v/x/', page, { note: undefined })
assert.deepEqual(all(), {}) // nothing left to remember
mem.set('kashaf:saved', '[1,2]') // a hand-mangled blob reads as empty, never as a crash
assert.deepEqual(all(), {})

// Lesson progress chooses local storage without auth, translates videoId -> lesson_key for cloud,
// and keeps the exact local version until the monotonic RPC confirms it. Fakes make the migration
// and write race deterministic without requiring a hosted Supabase project in the static check.
const progress = (videoId: string, position: number, updatedAt: string): LessonProgress => ({
  videoId,
  positionSeconds: position,
  durationSeconds: 100,
  completed: position >= 90,
  updatedAt,
})
const memoryProgress = () => {
  const values = new Map<string, LessonProgress>()
  return {
    values,
    store: {
      get: (videoId: string) => values.get(videoId) ?? null,
      save: (value: LessonProgress) => void values.set(value.videoId, value),
      remove: (videoId: string, expectedUpdatedAt: string) => {
        if (values.get(videoId)?.updatedAt === expectedUpdatedAt) values.delete(videoId)
      },
    },
  }
}

{
  const local = memoryProgress()
  let cloudCalls = 0
  const store = createSessionAwareLessonProgress({
    videoId: 'video-anon',
    lessonKey: '11111111-1111-4111-8111-111111111111',
    getUserId: async () => null,
    local: local.store,
    cloud: {
      get: async () => (++cloudCalls, null),
      merge: async (_key, value) => (++cloudCalls, value),
    },
  })
  await store.save(progress('video-anon', 20, '2026-08-27T00:00:00.000Z'))
  assert.equal((await store.get('video-anon'))?.positionSeconds, 20)
  assert.equal(cloudCalls, 0)
}

{
  const local = memoryProgress()
  const beforeSignIn = progress('video-auth', 35, '2026-08-27T00:01:00.000Z')
  local.values.set(beforeSignIn.videoId, beforeSignIn)
  const mergedKeys: string[] = []
  const readKeys: string[] = []
  const lessonKey = '22222222-2222-4222-8222-222222222222'
  const store = createSessionAwareLessonProgress({
    videoId: beforeSignIn.videoId,
    lessonKey,
    getUserId: async () => 'student-1',
    local: local.store,
    cloud: {
      get: async (key) => {
        readKeys.push(key)
        return progress('', 40, '2026-08-27T00:02:00.000Z')
      },
      merge: async (key, value) => {
        mergedKeys.push(key)
        return { ...value, positionSeconds: 40 }
      },
    },
  })
  assert.deepEqual(await store.get(beforeSignIn.videoId), {
    ...beforeSignIn,
    positionSeconds: 40,
  })
  assert.deepEqual(mergedKeys, [lessonKey])
  assert.equal(local.values.has(beforeSignIn.videoId), false)
  assert.equal((await store.get(beforeSignIn.videoId))?.videoId, beforeSignIn.videoId)
  assert.deepEqual(mergedKeys, [lessonKey]) // no second migration after confirmed removal
  assert.deepEqual(readKeys, [lessonKey])
}

{
  const local = memoryProgress()
  const offline = progress('video-offline', 50, '2026-08-27T00:03:00.000Z')
  local.values.set(offline.videoId, offline)
  const store = createSessionAwareLessonProgress({
    videoId: offline.videoId,
    lessonKey: '33333333-3333-4333-8333-333333333333',
    getUserId: async () => 'student-1',
    local: local.store,
    cloud: {
      get: async () => null,
      merge: async () => {
        throw new Error('offline')
      },
    },
  })
  assert.deepEqual(await store.get(offline.videoId), offline)
  assert.deepEqual(local.values.get(offline.videoId), offline)
}

{
  const local = memoryProgress()
  let releaseFirst!: () => void
  const firstCloudWrite = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  let calls = 0
  const store = createSessionAwareLessonProgress({
    videoId: 'video-race',
    lessonKey: '44444444-4444-4444-8444-444444444444',
    getUserId: async () => 'student-1',
    local: local.store,
    cloud: {
      get: async () => null,
      merge: async (_key, value) => {
        if (++calls === 1) await firstCloudWrite
        else throw new Error('second write offline')
        return value
      },
    },
  })
  const older = progress('video-race', 60, '2026-08-27T00:04:00.000Z')
  const newer = progress('video-race', 75, '2026-08-27T00:05:00.000Z')
  const first = store.save(older)
  const second = store.save(newer)
  assert.deepEqual(local.values.get('video-race'), newer)
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(local.values.get('video-race'), newer)
}

// Student Area Slice 1 is pure: rows arrive in descending activity order, metadata resolution
// preserves that order, and only known rows can become Continue or occupy the eight Recent slots.
const studentRow = (
  lessonKey: string,
  positionSeconds: number,
  durationSeconds: number,
  completed: boolean,
  order = 0,
): StudentProgressRow => ({
  lesson_key: lessonKey,
  position_seconds: positionSeconds,
  duration_seconds: durationSeconds,
  completed,
  client_updated_at: `2026-08-30T00:${String(order).padStart(2, '0')}:00.000Z`,
})
const studentMetadata = (lessonKey: string): StudentLessonMetadata => ({
  lessonKey,
  videoId: `video-${lessonKey}`,
  title: `Lesson ${lessonKey}`,
})

// Study Paths Slice 1 stays entirely static and pure. This intentionally small draft fixture is
// not a scholarly path: its three real registry keys exercise two modules, ordering, digesting,
// progress and Continue without allowing source-provider identifiers into the domain definition.
const studyPathFixtureUrl = new URL('../src/lib/fixtures/study-path-v1.json', import.meta.url)
const studyPathFixtureSource = readFileSync(studyPathFixtureUrl, 'utf8')
const studyPathFixtureValue: unknown = JSON.parse(studyPathFixtureSource)
const studyPathFixtureDraft = validateStudyPathDefinition(studyPathFixtureValue, registry)
const studyPathFixture = validateStudyPathDefinition(
  {
    ...studyPathFixtureDraft,
    status: 'published',
    versions: studyPathFixtureDraft.versions.map((version) => ({
      ...version,
      publishedAt: '2026-08-31T00:00:00.000Z',
    })),
  },
  registry,
)
const studyPathVersion = studyPathFixture.versions[0]
const studyPathLessonKeys = studyPathVersion.modules.flatMap((module) =>
  module.lessons.map((lesson) => lesson.lessonKey),
)
const registeredLessonKeys = new Set(registry.lessons.map((lesson) => lesson.lesson_key))

assert.equal(studyPathFixtureDraft.status, 'draft')
assert.equal(studyPathFixtureDraft.versions[0].publishedAt, null)
assert.throws(
  () => validateStudyPathDefinition({ ...studyPathFixture, status: 'draft' }, registry),
  /draft study path current version must not have publishedAt/,
)
for (const status of ['published', 'retired'] as const) {
  assert.throws(
    () =>
      validateStudyPathDefinition(
        {
          ...studyPathFixture,
          status,
          versions: [{ ...studyPathVersion, publishedAt: null }],
        },
        registry,
      ),
    new RegExp(`${status} study path versions require publishedAt`),
  )
}
const draftSecondVersion = { ...studyPathVersion, version: 2, publishedAt: null }
assert.throws(
  () =>
    validateStudyPathDefinition(
      {
        ...studyPathFixtureDraft,
        currentVersion: 2,
        versions: [{ ...studyPathVersion, publishedAt: null }, draftSecondVersion],
      },
      registry,
    ),
  /draft study path historical versions require publishedAt/,
)
assert.doesNotThrow(() =>
  validateStudyPathDefinition(
    {
      ...studyPathFixtureDraft,
      currentVersion: 2,
      versions: [studyPathVersion, draftSecondVersion],
    },
    registry,
  ),
)
assert.equal(studyPathVersion.modules.length, 2)
assert.equal(studyPathLessonKeys.length, 3)
assert.ok(studyPathLessonKeys.every((lessonKey) => registeredLessonKeys.has(lessonKey)))
assert.doesNotMatch(studyPathFixtureSource, /youtube|telegram|corpus|provider/i)
assert.ok(Object.isFrozen(studyPathFixture))
assert.ok(Object.isFrozen(studyPathVersion))
assert.ok(Object.isFrozen(studyPathVersion.modules))
assert.ok(Object.isFrozen(studyPathVersion.modules[0].lessons))
assert.doesNotThrow(() => validateStudyPathVersionLessonKeys(studyPathVersion, registry))

// Slice 2 publishes only reviewed definitions. The technical draft must fail closed instead of
// becoming a production-looking course, while a synthesized published definition exercises the
// build-time catalog and route resolvers without entering the real public catalog.
assert.equal(publicStudyPaths.length, 0)
assert.throws(
  () => createPublicStudyPathCatalog([studyPathFixtureDraft]),
  /only published study paths can enter the public catalog/,
)
assert.throws(
  () => createPublicStudyPathCatalog([{ ...studyPathFixture, status: 'retired' }]),
  /only published study paths can enter the public catalog/,
)
const historicalStudyPathVersion = {
  ...studyPathVersion,
  version: 2,
  publishedAt: '2026-09-01T00:00:00.000Z',
}
const publicStudyPathFixture = {
  ...studyPathFixture,
  currentVersion: 2,
  versions: [studyPathVersion, historicalStudyPathVersion],
}
const publicFixtureCatalog = createPublicStudyPathCatalog([publicStudyPathFixture])
const publicationManifest = await createStudyPathPublicationManifest([publicStudyPathFixture])
assert.deepEqual(await createPublicStudyPathPublicationManifest(), [])
assert.equal(publicationManifest.length, publicStudyPathFixture.versions.length)
assert.ok(publicationManifest.every((publication) => /^[0-9a-f]{64}$/.test(publication.definition_digest)))
assert.deepEqual(
  publicationManifest.map(({ path_id, version }) => ({ path_id, version })),
  publicStudyPathFixture.versions.map((version) => ({
    path_id: publicStudyPathFixture.pathId,
    version: version.version,
  })),
)
await assert.rejects(
  () => createStudyPathPublicationManifest([studyPathFixtureDraft]),
  /only published study paths can enter the publication manifest/,
)
await assert.rejects(
  () => createStudyPathPublicationManifest([publicStudyPathFixture, publicStudyPathFixture]),
  /duplicate study path publication/,
)
const registryRows: StudyPathPublicationRegistryRow[] = publicationManifest.map((publication) => ({
  ...publication,
  retired_at: null,
}))
assert.deepEqual(verifyStudyPathPublicationRegistry(publicationManifest, registryRows), [])
assert.doesNotThrow(() => assertStudyPathPublicationRegistry(publicationManifest, registryRows))
const retiredRegistryRows = registryRows.map((row, index) => ({
  ...row,
  retired_at: index === 0 ? '2026-09-02T00:00:00.000Z' : null,
}))
assert.deepEqual(verifyStudyPathPublicationRegistry(publicationManifest, retiredRegistryRows), [])
const digestMismatchRows = registryRows.map((row, index) => ({
  ...row,
  definition_digest: index === 0 ? '0'.repeat(64) : row.definition_digest,
}))
assert.deepEqual(
  verifyStudyPathPublicationRegistry(publicationManifest, digestMismatchRows).map(
    (issue) => issue.code,
  ),
  ['digest_mismatch'],
)
assert.throws(
  () => assertStudyPathPublicationRegistry(publicationManifest, digestMismatchRows),
  /digest_mismatch/,
)
assert.deepEqual(
  verifyStudyPathPublicationRegistry(publicationManifest, [registryRows[0], registryRows[0]]).map(
    (issue) => issue.code,
  ),
  ['duplicate', 'missing'],
)
assert.throws(
  () =>
    verifyStudyPathPublicationRegistry(publicationManifest, [
      { ...registryRows[0], retired_at: '2026-08-01T00:00:00.000Z' },
    ]),
  /retired_at must not precede published_at/,
)
const publicFixturePath = publicStudyPathBySlug(studyPathFixture.slug, publicFixtureCatalog)!
assert.equal(publicFixturePath.current.version, 2)
assert.equal(publicStudyPathVersion(studyPathFixture.slug, 1, publicFixtureCatalog)?.version, 1)
assert.equal(publicStudyPathVersion(studyPathFixture.slug, 99, publicFixtureCatalog), undefined)
assert.equal(currentStudyPathHref(studyPathFixture.slug), '/study-paths/study-path-v1-fixture/')
assert.equal(
  historicalStudyPathHref(studyPathFixture.slug, 1),
  '/study-paths/study-path-v1-fixture/versions/1/',
)
const currentRouteEntries = publicStudyPathCurrentRouteEntries(publicFixtureCatalog)
assert.equal(currentRouteEntries.length, 1)
assert.deepEqual(currentRouteEntries[0].params, { slug: studyPathFixture.slug })
assert.equal(currentRouteEntries[0].props.path.current.version, 2)
assert.equal(
  currentStudyPathHref(currentRouteEntries[0].params.slug),
  '/study-paths/study-path-v1-fixture/',
)
const historicalRouteEntries = publicStudyPathHistoricalRouteEntries(publicFixtureCatalog)
assert.equal(historicalRouteEntries.length, 1)
assert.deepEqual(historicalRouteEntries[0].params, {
  slug: studyPathFixture.slug,
  version: '1',
})
assert.equal(historicalRouteEntries[0].props.version.version, 1)
assert.equal(
  historicalStudyPathHref(
    historicalRouteEntries[0].params.slug,
    Number(historicalRouteEntries[0].params.version),
  ),
  '/study-paths/study-path-v1-fixture/versions/1/',
)
assert.equal(
  new Set(
    historicalRouteEntries.map(({ params }) => `${params.slug}/${params.version}`),
  ).size,
  historicalRouteEntries.length,
)
for (const version of publicFixturePath.versions) {
  for (const module of version.modules) {
    for (const lesson of module.lessons) {
      assert.match(lesson.href, /^\/v\/[A-Za-z0-9_-]+\/$/)
      assert.ok(lesson.title)
    }
  }
}
assert.throws(
  () => createPublicStudyPathCatalog([publicStudyPathFixture, publicStudyPathFixture]),
  /duplicate public study path slug/,
)
assert.throws(
  () => createPublicStudyPathCatalog([{ ...publicStudyPathFixture, slug: 'unsafe/slug' }]),
  /study path definition.slug is invalid/,
)
const publicStudyPathSource = readFileSync(
  new URL('../src/lib/public-study-paths.ts', import.meta.url),
  'utf8',
)
assert.doesNotMatch(publicStudyPathSource, /fixtures\/study-path-v1|supabase|auth|localStorage|fetch\s*\(/i)
for (const file of [
  '../src/pages/study-paths/index.astro',
  '../src/pages/study-paths/[slug].astro',
  '../src/pages/study-paths/[slug]/versions/[version].astro',
  '../src/components/StudyPathVersion.astro',
]) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  assert.doesNotMatch(source, /supabase|auth|getSession|getUser|\.from\s*\(|\.rpc\s*\(/i)
}

const definitionWithVersion = (version: unknown) => ({
  ...studyPathFixture,
  versions: [version],
})
const versionWithModules = (modules: readonly unknown[]) => ({
  ...studyPathVersion,
  modules,
})
const replaceStudyPathModule = (index: number, module: unknown): StudyPathVersion =>
  validateStudyPathDefinition(
    definitionWithVersion({
      ...studyPathVersion,
      modules: studyPathVersion.modules.map((current, at) => (at === index ? module : current)),
    }),
    registry,
  ).versions[0]

const firstStudyPathModule = studyPathVersion.modules[0]
const secondStudyPathModule = studyPathVersion.modules[1]
const firstStudyPathLesson = firstStudyPathModule.lessons[0]
const secondStudyPathLesson = firstStudyPathModule.lessons[1]

const { currentVersion: _currentVersion, ...studyPathWithoutCurrentVersion } = studyPathFixture
const invalidStudyPathDefinitions: { name: string; value: unknown; error: RegExp }[] = [
  {
    name: 'invalid status',
    value: { ...studyPathFixture, status: 'invalid' },
    error: /status is invalid/,
  },
  {
    name: 'zero version',
    value: definitionWithVersion({ ...studyPathVersion, version: 0 }),
    error: /version must be a positive integer/,
  },
  {
    name: 'non-integer version',
    value: definitionWithVersion({ ...studyPathVersion, version: 1.5 }),
    error: /version must be a positive integer/,
  },
  {
    name: 'duplicate versions',
    value: { ...studyPathFixture, versions: [studyPathVersion, studyPathVersion] },
    error: /duplicate study path version/,
  },
  {
    name: 'missing currentVersion',
    value: studyPathWithoutCurrentVersion,
    error: /currentVersion must be a positive integer/,
  },
  {
    name: 'mismatched version pathId',
    value: definitionWithVersion({
      ...studyPathVersion,
      pathId: '66666666-6666-4666-8666-666666666666',
    }),
    error: /pathId must match the path/,
  },
  {
    name: 'invalid slug',
    value: { ...studyPathFixture, slug: 'invalid_slug' },
    error: /slug is invalid/,
  },
  {
    name: 'invalid publishedAt',
    value: definitionWithVersion({ ...studyPathVersion, publishedAt: 'not-a-date' }),
    error: /publishedAt must be a canonical ISO timestamp/,
  },
  {
    name: 'noncanonical publishedAt',
    value: definitionWithVersion({ ...studyPathVersion, publishedAt: '2026-08-31T00:00:00Z' }),
    error: /publishedAt must be a canonical ISO timestamp/,
  },
  {
    name: 'unexpected definition field',
    value: { ...studyPathFixture, unexpected: true },
    error: /definition has an unexpected field: unexpected/,
  },
  {
    name: 'unexpected version field',
    value: definitionWithVersion({ ...studyPathVersion, unexpected: true }),
    error: /version has an unexpected field: unexpected/,
  },
  {
    name: 'unexpected module field',
    value: definitionWithVersion(
      versionWithModules([{ ...firstStudyPathModule, unexpected: true }, secondStudyPathModule]),
    ),
    error: /modules\[0\] has an unexpected field: unexpected/,
  },
]

for (const { name, value, error } of invalidStudyPathDefinitions) {
  assert.throws(() => validateStudyPathDefinition(value, registry), error, name)
}

// Identity, exact schema, uniqueness, nonempty curricula and contiguous 1-based positions.
assert.throws(
  () => validateStudyPathDefinition({ ...studyPathFixture, pathId: 'not-a-uuid' }, registry),
  /pathId must be a canonical lowercase UUID v4/,
)
assert.throws(
  () =>
    validateStudyPathDefinition(
      {
        ...studyPathFixture,
        pathId: 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF',
        versions: [
          {
            ...studyPathVersion,
            pathId: 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF',
          },
        ],
      },
      registry,
    ),
  /pathId must be a canonical lowercase UUID v4/,
)
assert.throws(
  () =>
    validateStudyPathDefinition(
      definitionWithVersion(
        versionWithModules([
          { ...firstStudyPathModule, moduleKey: 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF' },
          secondStudyPathModule,
        ]),
      ),
      registry,
    ),
  /moduleKey must be a canonical lowercase UUID v4/,
)
assert.throws(
  () =>
    validateLessonRegistry({
      version: 1,
      lessons: [{ ...sample, lesson_key: sample.lesson_key.toUpperCase() }],
    }),
  /invalid lesson_key/,
)
assert.throws(
  () =>
    validateStudyPathDefinition(
      definitionWithVersion(
        versionWithModules([
          firstStudyPathModule,
          { ...secondStudyPathModule, moduleKey: firstStudyPathModule.moduleKey },
        ]),
      ),
      registry,
    ),
  /duplicate moduleKey/,
)
assert.throws(
  () =>
    validateStudyPathDefinition(
      definitionWithVersion(
        versionWithModules([
          firstStudyPathModule,
          {
            ...secondStudyPathModule,
            lessons: [
              { ...secondStudyPathModule.lessons[0], lessonKey: firstStudyPathLesson.lessonKey },
            ],
          },
        ]),
      ),
      registry,
    ),
  /duplicate lessonKey/,
)
assert.throws(
  () =>
    validateStudyPathDefinition(
      definitionWithVersion(
        versionWithModules([
          firstStudyPathModule,
          { ...secondStudyPathModule, position: 3 },
        ]),
      ),
      registry,
    ),
  /modules\[1\]\.position must be 2/,
)
assert.throws(
  () =>
    validateStudyPathDefinition(
      definitionWithVersion(
        versionWithModules([
          {
            ...firstStudyPathModule,
            lessons: [firstStudyPathLesson, { ...secondStudyPathLesson, position: 3 }],
          },
          secondStudyPathModule,
        ]),
      ),
      registry,
    ),
  /lessons\[1\]\.position must be 2/,
)
assert.throws(
  () =>
    validateStudyPathDefinition(
      definitionWithVersion(
        versionWithModules([{ ...firstStudyPathModule, lessons: [] }, secondStudyPathModule]),
      ),
      registry,
    ),
  /must contain at least one lesson/,
)
assert.throws(
  () =>
    validateStudyPathDefinition(
      definitionWithVersion(versionWithModules([])),
      registry,
    ),
  /must contain at least one module/,
)
assert.throws(
  () => validateStudyPathDefinition(studyPathFixture),
  /require lesson registry validation/,
)
assert.throws(
  () =>
    validateStudyPathDefinition(
      definitionWithVersion(
        versionWithModules([
          {
            ...firstStudyPathModule,
            lessons: [
              {
                ...firstStudyPathLesson,
                lessonKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              },
              secondStudyPathLesson,
            ],
          },
          secondStudyPathModule,
        ]),
      ),
      registry,
    ),
  /unknown lessonKey/,
)
assert.throws(
  () =>
    validateStudyPathDefinition(
      definitionWithVersion(
        versionWithModules([
          {
            ...firstStudyPathModule,
            lessons: [{ ...firstStudyPathLesson, youtubeVideoId: 'forbidden' }, secondStudyPathLesson],
          },
          secondStudyPathModule,
        ]),
      ),
      registry,
    ),
  /unexpected field: youtubeVideoId/,
)

// The canonical form is a fixed tuple, and SHA-256 covers only path/version identity and the
// complete curriculum-significant module/lesson structure. Presentation metadata never enters it.
const canonicalStudyPath = canonicalStudyPathVersion(studyPathVersion)
const studyPathDigest = await studyPathVersionDigest(studyPathVersion)
assert.equal(canonicalStudyPath, canonicalStudyPathVersion(studyPathVersion))
assert.equal(studyPathDigest, await studyPathVersionDigest(studyPathVersion))
assert.match(studyPathDigest, /^[0-9a-f]{64}$/)
assert.ok(canonicalStudyPath.startsWith('["study-path-curriculum-v1"'))
assert.ok(!canonicalStudyPath.includes(studyPathFixture.title))
assert.ok(!canonicalStudyPath.includes(studyPathFixture.description))

const goldenCanonicalStudyPath =
  '["study-path-curriculum-v1","55555555-5555-4555-8555-555555555555",1,' +
  '[["11111111-1111-4111-8111-111111111111","الوحدة التجريبية الأولى",' +
  '"اختبار ترتيب درسين داخل وحدة واحدة.",1,[["f34d8d0d-188e-4d38-b67e-bb7e21bfdeae",1],' +
  '["80456b68-653a-44c4-9021-1aa56dfb515f",2]]],["22222222-2222-4222-8222-222222222222",' +
  '"الوحدة التجريبية الثانية","اختبار الانتقال إلى وحدة تالية.",2,' +
  '[["8a3b01cb-8b22-4c99-b24d-4769c71ec2b2",1]]]]]'
assert.equal(canonicalStudyPath, goldenCanonicalStudyPath)
assert.equal(studyPathDigest, '2638516b2d359c102057748c68ce5e2c9eec5ee881b8d4d9b2a0ed31b9c8cd05')

const keyReorderedStudyPathVersion = {
  modules: studyPathVersion.modules.map((module) => ({
    lessons: module.lessons.map((lesson) => ({
      position: lesson.position,
      lessonKey: lesson.lessonKey,
    })),
    position: module.position,
    objective: module.objective,
    title: module.title,
    moduleKey: module.moduleKey,
  })),
  publishedAt: studyPathVersion.publishedAt,
  version: studyPathVersion.version,
  pathId: studyPathVersion.pathId,
}
const differentlyFormattedStudyPathVersion: unknown = JSON.parse(
  JSON.stringify(studyPathVersion, null, 4),
)
for (const equivalentVersion of [keyReorderedStudyPathVersion, differentlyFormattedStudyPathVersion]) {
  assert.equal(canonicalStudyPathVersion(equivalentVersion), canonicalStudyPath)
  assert.equal(await studyPathVersionDigest(equivalentVersion), studyPathDigest)
}

const titledModuleVersion = replaceStudyPathModule(0, {
  ...firstStudyPathModule,
  title: `${firstStudyPathModule.title} — معدل`,
})
const objectiveModuleVersion = replaceStudyPathModule(0, {
  ...firstStudyPathModule,
  objective: `${firstStudyPathModule.objective} معدل`,
})
const reorderedModuleVersion = validateStudyPathDefinition(
  definitionWithVersion(
    versionWithModules([
      { ...secondStudyPathModule, position: 1 },
      { ...firstStudyPathModule, position: 2 },
    ]),
  ),
  registry,
).versions[0]
const changedMembershipVersion = replaceStudyPathModule(0, {
  ...firstStudyPathModule,
  lessons: [
    firstStudyPathLesson,
    { ...secondStudyPathLesson, lessonKey: registry.lessons[3].lesson_key },
  ],
})
const reorderedLessonVersion = replaceStudyPathModule(0, {
  ...firstStudyPathModule,
  lessons: [
    { ...secondStudyPathLesson, position: 1 },
    { ...firstStudyPathLesson, position: 2 },
  ],
})
const changedPathIdVersion = {
  ...studyPathVersion,
  pathId: '66666666-6666-4666-8666-666666666666',
}
const changedVersionNumber = { ...studyPathVersion, version: 2 }
const changedModuleKeyVersion = {
  ...studyPathVersion,
  modules: [
    { ...firstStudyPathModule, moduleKey: '33333333-3333-4333-8333-333333333333' },
    secondStudyPathModule,
  ],
}
for (const changedVersion of [
  titledModuleVersion,
  objectiveModuleVersion,
  reorderedModuleVersion,
  changedMembershipVersion,
  reorderedLessonVersion,
  changedPathIdVersion,
  changedVersionNumber,
  changedModuleKeyVersion,
]) {
  assert.notEqual(await studyPathVersionDigest(changedVersion), studyPathDigest)
}

const cyclicPresentation: Record<string, unknown> = {}
cyclicPresentation.self = cyclicPresentation
const invalidPresentationValues: readonly unknown[] = [
  undefined,
  () => undefined,
  1n,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  new Date('2026-08-31T00:00:00.000Z'),
  cyclicPresentation,
]
for (const invalid of invalidPresentationValues) {
  assert.throws(
    () =>
      validateStudyPathDefinition(
        { ...studyPathFixture, presentation: { invalid } },
        registry,
      ),
    /presentation must contain only JSON-safe values/,
  )
}

const presentationOnlyChange = validateStudyPathDefinition(
  {
    ...studyPathFixture,
    title: `${studyPathFixture.title} — عرض معدل`,
    description: `${studyPathFixture.description} عرض معدل.`,
    presentation: { fixture: true, accent: 'changed' },
  },
  registry,
)
assert.equal(
  await studyPathVersionDigest(presentationOnlyChange.versions[0]),
  studyPathDigest,
)

// Module/path completion and Continue derive only from sticky lesson_progress.completed. Missing
// rows are incomplete, duration never weights the result, and a row saved before enrollment counts
// because enrollment time is deliberately absent from this pure function's inputs.
const studyPathRow = (
  lessonKey: string,
  positionSeconds: number,
  durationSeconds: number,
  completed: boolean,
): StudentProgressRow =>
  studentRow(lessonKey, positionSeconds, durationSeconds, completed)

const zeroStudyPathProgress = deriveStudyPathProgress(studyPathVersion, [])
assert.equal(zeroStudyPathProgress.completedLessons, 0)
assert.equal(zeroStudyPathProgress.totalLessons, 3)
assert.equal(zeroStudyPathProgress.percentage, 0)
assert.equal(zeroStudyPathProgress.completed, false)
assert.equal(zeroStudyPathProgress.modules[0].completed, false)
assert.equal(zeroStudyPathProgress.continueLesson?.lessonKey, studyPathLessonKeys[0])
assert.equal(zeroStudyPathProgress.continueLesson?.progress, null)
assert.equal(zeroStudyPathProgress.continueLesson?.effectiveResumeSeconds, 0)

const partialRow = studyPathRow(studyPathLessonKeys[0], 42.5, 100, false)
const partialStudyPathProgress = deriveStudyPathProgress(studyPathVersion, [partialRow])
const partialProgressSnapshot = partialStudyPathProgress.modules[0].lessons[0].progress
assert.equal(partialStudyPathProgress.completedLessons, 0)
assert.equal(partialStudyPathProgress.continueLesson?.lessonKey, studyPathLessonKeys[0])
assert.notEqual(partialProgressSnapshot, partialRow)
assert.deepEqual(partialProgressSnapshot, partialRow)
assert.ok(Object.isFrozen(partialProgressSnapshot))
assert.equal(partialStudyPathProgress.continueLesson?.progress, partialProgressSnapshot)
assert.equal(partialStudyPathProgress.continueLesson?.effectiveResumeSeconds, 42.5)
partialRow.position_seconds = 84
assert.equal(partialProgressSnapshot?.position_seconds, 42.5)

const firstCompletedRow = studyPathRow(studyPathLessonKeys[0], 10, 10, true)
const oneCompletedStudyPathProgress = deriveStudyPathProgress(studyPathVersion, [firstCompletedRow])
assert.equal(oneCompletedStudyPathProgress.completedLessons, 1)
assert.equal(oneCompletedStudyPathProgress.percentage, 33)
assert.equal(Number.isInteger(oneCompletedStudyPathProgress.percentage), true)
assert.equal(oneCompletedStudyPathProgress.modules[0].percentage, 50)
assert.equal(oneCompletedStudyPathProgress.continueLesson?.lessonKey, studyPathLessonKeys[1])

const secondStudyPathDefinition = validateStudyPathDefinition(
  {
    ...studyPathFixture,
    pathId: '66666666-6666-4666-8666-666666666666',
    slug: 'shared-lesson-fixture',
    versions: [
      {
        ...studyPathVersion,
        pathId: '66666666-6666-4666-8666-666666666666',
        modules: [
          {
            ...firstStudyPathModule,
            moduleKey: '33333333-3333-4333-8333-333333333333',
            lessons: [firstStudyPathLesson],
          },
        ],
      },
    ],
  },
  registry,
)
const sharedLessonProgress = deriveStudyPathProgress(secondStudyPathDefinition.versions[0], [
  firstCompletedRow,
])
assert.equal(oneCompletedStudyPathProgress.completedLessons, 1)
assert.equal(sharedLessonProgress.completedLessons, 1)
assert.equal(sharedLessonProgress.percentage, 100)
assert.equal(sharedLessonProgress.completed, true)

const secondCompletedRow = studyPathRow(studyPathLessonKeys[1], 5_000, 10_000, true)
const firstModuleComplete = deriveStudyPathProgress(studyPathVersion, [
  firstCompletedRow,
  secondCompletedRow,
])
assert.equal(firstModuleComplete.completedLessons, 2)
assert.equal(firstModuleComplete.percentage, 66)
assert.equal(firstModuleComplete.modules[0].completed, true)
assert.equal(firstModuleComplete.modules[0].percentage, 100)
assert.equal(firstModuleComplete.modules[1].completed, false)
assert.equal(firstModuleComplete.continueLesson?.lessonKey, studyPathLessonKeys[2])

const preExistingCompletion = deriveStudyPathProgress(studyPathVersion, [
  studyPathRow(studyPathLessonKeys[2], 1, 1, true),
])
assert.equal(preExistingCompletion.completedLessons, 1)
assert.equal(preExistingCompletion.percentage, 33)
assert.equal(preExistingCompletion.continueLesson?.lessonKey, studyPathLessonKeys[0])

const completedStudyPathProgress = deriveStudyPathProgress(studyPathVersion, [
  firstCompletedRow,
  secondCompletedRow,
  studyPathRow(studyPathLessonKeys[2], 1, 1, true),
])
assert.equal(completedStudyPathProgress.completedLessons, 3)
assert.equal(completedStudyPathProgress.percentage, 100)
assert.equal(completedStudyPathProgress.completed, true)
assert.ok(completedStudyPathProgress.modules.every((module) => module.completed))
assert.equal(completedStudyPathProgress.continueLesson, null)
assert.throws(
  () => deriveStudyPathProgress(studyPathVersion, [firstCompletedRow, firstCompletedRow]),
  /duplicate lesson progress row/,
)

// Empty inputs and missing metadata produce explicit, benign empty states.
assert.deepEqual(deriveStudentProgress([], [studentMetadata('unused')]), {
  knownLessons: [],
  continueLesson: null,
  recentLessons: [],
  unknownRowCount: 0,
})
assert.deepEqual(
  deriveStudentProgress(
    [studentRow('unknown-1', 1, 10, false), studentRow('unknown-2', 2, 10, true)],
    [],
  ),
  {
    knownLessons: [],
    continueLesson: null,
    recentLessons: [],
    unknownRowCount: 2,
  },
)

// A short known list is neither padded nor reordered, and metadata is projected exactly.
{
  const metadata = [
    { lessonKey: 'short-1', videoId: 'exact-video-1', title: '  Exact title  ' },
    { lessonKey: 'short-2', videoId: 'exact-video-2', title: 'Second' },
    { lessonKey: 'short-3', videoId: 'exact-video-3', title: 'Third' },
  ]
  const result = deriveStudentProgress(
    [
      studentRow('short-1', 1, 10, false),
      studentRow('short-2', 2, 10, false),
      studentRow('short-3', 3, 10, false),
    ],
    metadata,
  )
  assert.equal(result.recentLessons.length, 3)
  assert.deepEqual(result.recentLessons.map((lesson) => lesson.lessonKey), [
    'short-1',
    'short-2',
    'short-3',
  ])
  assert.deepEqual(
    {
      lessonKey: result.knownLessons[0].lessonKey,
      videoId: result.knownLessons[0].videoId,
      title: result.knownLessons[0].title,
    },
    metadata[0],
  )
}

// 1. The newest known incomplete row becomes Continue.
{
  const result = deriveStudentProgress(
    [studentRow('newest', 12, 100, false), studentRow('older', 20, 100, false)],
    [studentMetadata('newest'), studentMetadata('older')],
  )
  assert.equal(result.continueLesson?.lessonKey, 'newest')
}

// 2–5, 16–18. Completed and unknown rows do not hide Continue or consume Recent slots;
// resolution preserves supplied order, reports unknowns, caps Recent, and leaves inputs untouched.
{
  const keys = ['done-1', 'done-2', 'done-3', 'done-4', 'done-5', 'continue', 'done-6', 'done-7', 'done-8', 'later']
  const rows: readonly StudentProgressRow[] = Object.freeze([
    Object.freeze(studentRow('done-1', 90, 100, true, 19)),
    Object.freeze(studentRow('stale-a', 1, 10, false, 18)),
    Object.freeze(studentRow('done-2', 90, 100, true, 17)),
    Object.freeze(studentRow('done-3', 90, 100, true, 16)),
    Object.freeze(studentRow('stale-b', 2, 10, false, 15)),
    Object.freeze(studentRow('done-4', 90, 100, true, 14)),
    Object.freeze(studentRow('done-5', 90, 100, true, 13)),
    Object.freeze(studentRow('continue', 45, 100, false, 12)),
    Object.freeze(studentRow('done-6', 90, 100, true, 11)),
    Object.freeze(studentRow('done-7', 90, 100, true, 10)),
    Object.freeze(studentRow('done-8', 90, 100, true, 9)),
    Object.freeze(studentRow('later', 5, 100, false, 8)),
  ])
  const metadata: readonly StudentLessonMetadata[] = Object.freeze(
    keys.map((key) => Object.freeze(studentMetadata(key))),
  )
  const rowsBefore = JSON.stringify(rows)
  const metadataBefore = JSON.stringify(metadata)

  const result = deriveStudentProgress(rows, metadata)

  assert.equal(result.continueLesson?.lessonKey, 'continue')
  assert.deepEqual(result.knownLessons.map((lesson) => lesson.lessonKey), keys)
  assert.deepEqual(result.recentLessons.map((lesson) => lesson.lessonKey), keys.slice(0, 8))
  assert.equal(result.recentLessons.length, 8)
  assert.equal(result.unknownRowCount, 2)
  assert.equal(JSON.stringify(rows), rowsBefore)
  assert.equal(JSON.stringify(metadata), metadataBefore)
}

// 6. A collection containing only completed known rows has no Continue lesson.
{
  const result = deriveStudentProgress(
    [studentRow('complete', 10, 100, true)],
    [studentMetadata('complete')],
  )
  assert.equal(result.continueLesson, null)
}

// 7–12. Display percentage and effective resume values follow the V1 defensive rules.
assert.equal(studentDisplayPercentage(studentRow('completed', 20, 100, true)), 100)
assert.equal(studentDisplayPercentage(studentRow('normal', 45, 90, false)), 50)
assert.equal(studentDisplayPercentage(studentRow('rounded', 1, 3, false)), 33)
assert.equal(studentDisplayPercentage(studentRow('over', 150, 100, false)), 100)
assert.equal(studentDisplayPercentage(studentRow('zero-duration', 10, 0, false)), null)
assert.equal(studentEffectiveResumeSeconds(studentRow('over', 150, 100, false)), 100)

// 13–15. Resume URLs floor positive positions, omit zero, and always restart completed Recent rows.
assert.equal(studentLessonHref('fractional', false, 42.9), '/v/fractional/?t=42')
assert.equal(studentLessonHref('zero', false, 0), '/v/zero/')
assert.equal(studentLessonHref('completed', true, 70), '/v/completed/')
assert.equal(studentLessonHref('x', false, Number.NaN), '/v/x/')
assert.equal(studentLessonHref('x', false, Infinity), '/v/x/')
assert.equal(studentLessonHref('x', false, -1), '/v/x/')

// Completed lessons restart through the real projection, while an exact-duration incomplete row
// remains incomplete and resumes at the duration boundary.
{
  const result = deriveStudentProgress(
    [studentRow('completed-derived', 70, 100, true)],
    [{ lessonKey: 'completed-derived', videoId: 'completed-video', title: 'Completed' }],
  )
  const recent = result.recentLessons[0]
  assert.equal(recent.completed, true)
  assert.equal(recent.href, '/v/completed-video/')
  assert.ok(!recent.href.includes('?t='))
}
{
  const result = deriveStudentProgress(
    [studentRow('exact-duration', 120, 120, false)],
    [{ lessonKey: 'exact-duration', videoId: 'exact-duration-video', title: 'Exact duration' }],
  )
  const lesson = result.knownLessons[0]
  assert.equal(lesson.completed, false)
  assert.equal(lesson.displayPercentage, 100)
  assert.equal(lesson.effectiveResumeSeconds, 120)
  assert.equal(lesson.href, '/v/exact-duration-video/?t=120')
}

// 19. An unexpected negative runtime position cannot create a negative resume URL.
{
  const row = studentRow('negative', -12.5, 100, false)
  const effective = studentEffectiveResumeSeconds(row)
  assert.equal(effective, 0)
  assert.equal(studentLessonHref('negative', false, effective), '/v/negative/')
}

// The Student Area cloud read stays a deliberately tiny RLS-bound query. Static assertions avoid
// a network call and a large fake for Supabase's fluent PostgREST types while pinning its contract.
const studentProgressCloudSource = readFileSync(
  new URL('../src/lib/student-progress-cloud.ts', import.meta.url),
  'utf8',
)
assert.match(studentProgressCloudSource, /\.from\('lesson_progress'\)/)
assert.match(
  studentProgressCloudSource,
  /'lesson_key,position_seconds,duration_seconds,completed,client_updated_at'/,
)
assert.match(studentProgressCloudSource, /\.select\(STUDENT_PROGRESS_COLUMNS\)/)
assert.match(
  studentProgressCloudSource,
  /\.order\('client_updated_at', \{ ascending: false \}\)/,
)
assert.match(studentProgressCloudSource, /if \(error\) throw error\s+return data/)
assert.doesNotMatch(studentProgressCloudSource, /\.limit\s*\(/)
assert.doesNotMatch(studentProgressCloudSource, /\.range\s*\(/)
assert.doesNotMatch(studentProgressCloudSource, /\.(?:eq|neq|in|is|filter|match)\s*\(/)
assert.doesNotMatch(studentProgressCloudSource, /\.(?:insert|update|upsert|delete|rpc)\s*\(/)
assert.doesNotMatch(
  studentProgressCloudSource,
  /user_id|service_role|SUPABASE_SERVICE_ROLE_KEY|localStorage|fetch\s*\(|\.auth\./,
)

// The public Student Area catalog is a build-time projection of every validated current lesson.
// Tuples keep the artifact compact while their three fixed positions remain explicit and testable.
const lessonCatalogRoute = new URL(
  '../src/pages/student/lesson-catalog.json.ts',
  import.meta.url,
)
assert.ok(existsSync(lessonCatalogRoute), 'student lesson catalog route is missing')
assert.equal(lessonCatalog.length, videos.length)
assert.equal(new Set(lessonCatalog.map(([lessonKey]) => lessonKey)).size, lessonCatalog.length)
for (const [index, entry] of lessonCatalog.entries()) {
  assert.equal(entry.length, 3)
  assert.ok(entry[0])
  assert.ok(entry[1])
  assert.equal(typeof entry[2], 'string')
  assert.deepEqual(entry, [videos[index].lessonKey, videos[index].id, videos[index].title])
}

const lessonCatalogResponse = await getLessonCatalog({} as never)
assert.ok(lessonCatalogResponse instanceof Response)
assert.equal(lessonCatalogResponse.headers.get('content-type'), 'application/json')
const parsedLessonCatalog: unknown = await lessonCatalogResponse.json()
assert.deepEqual(parsedLessonCatalog, lessonCatalog)
assert.equal((parsedLessonCatalog as unknown[]).length, videos.length)

const lessonCatalogSource = readFileSync(lessonCatalogRoute, 'utf8')
assert.match(lessonCatalogSource, /import \{ videos \} from '\.\.\/\.\.\/lib\/data'/)
assert.match(lessonCatalogSource, /videos\.map\(/)
assert.doesNotMatch(
  lessonCatalogSource,
  /duration|playlist|description|thumbnail|provenance|user|progress|supabase|auth|localStorage|fetch\s*\(/i,
)
assert.doesNotMatch(lessonCatalogSource, /prerender\s*=\s*false|node:|\.from\(|\.rpc\s*\(/)

// The browser decoder treats the compact public catalog as untrusted input: every tuple must be
// valid, identities stay exact and unique, and one malformed entry rejects the whole response.
{
  const input = Object.freeze([
    Object.freeze(['lesson-1', 'video-1', '  Exact title  ']),
    Object.freeze(['lesson-2', 'video-2', '']),
  ])
  const before = JSON.stringify(input)
  assert.deepEqual(decodeStudentLessonCatalog(input), [
    { lessonKey: 'lesson-1', videoId: 'video-1', title: '  Exact title  ' },
    { lessonKey: 'lesson-2', videoId: 'video-2', title: '' },
  ])
  assert.equal(JSON.stringify(input), before)
}
assert.deepEqual(decodeStudentLessonCatalog([]), [])

const schemaFailure = (value: unknown) =>
  assert.throws(
    () => decodeStudentLessonCatalog(value),
    (error) => error instanceof StudentLessonCatalogError && error.code === 'schema',
  )
schemaFailure({})
schemaFailure([{}])
schemaFailure([['lesson', 'video']])
schemaFailure([['lesson', 'video', 'title', 'extra']])
schemaFailure([['', 'video', 'title']])
schemaFailure([[1, 'video', 'title']])
schemaFailure([['lesson', '', 'title']])
schemaFailure([['lesson', 1, 'title']])
schemaFailure([['lesson', 'video', 1]])
schemaFailure([
  ['duplicate', 'video-1', 'First'],
  ['duplicate', 'video-2', 'Second'],
])
schemaFailure([
  ['valid', 'video', 'Valid'],
  ['invalid', 'video'],
])

// A tiny injected fetcher verifies the four load-failure classes without network access.
{
  let requestedPath = ''
  const rows = await fetchStudentLessonCatalog(async (path) => {
    requestedPath = path
    return new Response(JSON.stringify([['lesson', 'video', 'Title']]))
  })
  assert.equal(requestedPath, '/student/lesson-catalog.json')
  assert.deepEqual(rows, [{ lessonKey: 'lesson', videoId: 'video', title: 'Title' }])
}
assert.deepEqual(
  await fetchStudentLessonCatalog(async () => new Response(JSON.stringify([]))),
  [],
)
await assert.rejects(
  fetchStudentLessonCatalog(async () => {
    throw new Error('offline')
  }),
  (error) => error instanceof StudentLessonCatalogError && error.code === 'network',
)
await assert.rejects(
  fetchStudentLessonCatalog(async () => new Response('', { status: 503 })),
  (error) => error instanceof StudentLessonCatalogError && error.code === 'http',
)
await assert.rejects(
  fetchStudentLessonCatalog(async () => new Response('{', { status: 500 })),
  (error) => error instanceof StudentLessonCatalogError && error.code === 'http',
)
await assert.rejects(
  fetchStudentLessonCatalog(async () => new Response('{')),
  (error) => error instanceof StudentLessonCatalogError && error.code === 'json',
)
await assert.rejects(
  fetchStudentLessonCatalog(async () => new Response(JSON.stringify([['bad']]))),
  (error) => error instanceof StudentLessonCatalogError && error.code === 'schema',
)

const studentLessonCatalogSource = readFileSync(
  new URL('../src/lib/student-lesson-catalog.ts', import.meta.url),
  'utf8',
)
assert.match(studentLessonCatalogSource, /'\/student\/lesson-catalog\.json'/)
assert.doesNotMatch(
  studentLessonCatalogSource,
  /supabase|service_role|auth|session|localStorage|https?:\/\/|react|astro|player|node:|\.from\(|\.rpc\s*\(/i,
)

// StudentHome verifies the persisted account before entering one retryable data pipeline. The
// empty cloud result returns before the catalog boundary, and rendering consumes only derived
// view-model links rather than rebuilding progress or resume behavior in the island.
const studentHomeSource = readFileSync(
  new URL('../src/islands/StudentHome.tsx', import.meta.url),
  'utf8',
)
assert.match(studentHomeSource, /import \{ readStudentProgress \} from '\.\.\/lib\/student-progress-cloud'/)
assert.match(studentHomeSource, /import \{ fetchStudentLessonCatalog \} from '\.\.\/lib\/student-lesson-catalog'/)
assert.match(
  studentHomeSource,
  /import \{\s+deriveStudentProgress,\s+type StudentProgressRow,\s+type StudentProgressViewModel,\s+\} from '\.\.\/lib\/student-progress'/,
)
assert.match(
  studentHomeSource,
  /client\.auth\.getSession\(\)[\s\S]*client\.auth\.getUser\(\)[\s\S]*if \(authError \|\| !verified\.user\)[\s\S]*await loadStudentArea\(\)/,
)
assert.match(
  studentHomeSource,
  /if \(event === 'SIGNED_OUT'\) \{\s+loadRequest\.current\+\+\s+location\.replace\('\/student\/login\/'\)/,
)
assert.match(
  studentHomeSource,
  /rows = await readStudentProgress\(\)[\s\S]*if \(rows\.length === 0\) \{[\s\S]*setAreaState\(\{ status: 'empty' \}\)[\s\S]*return[\s\S]*\}[\s\S]*await fetchStudentLessonCatalog\(\)/,
)
assert.match(studentHomeSource, /studentProgress: deriveStudentProgress\(rows, metadata\)/)
assert.match(studentHomeSource, /href=\{studentProgress\.continueLesson\.href\}/)
assert.match(studentHomeSource, /href=\{lesson\.href\}/)
assert.doesNotMatch(studentHomeSource, /localStorage/)
assert.doesNotMatch(studentHomeSource, /\.from\s*\(/)
assert.doesNotMatch(studentHomeSource, /fetch\s*\(|['"]\/student\/lesson-catalog\.json/)
assert.doesNotMatch(studentHomeSource, /\?t=|['"]\/v\//)
assert.doesNotMatch(studentHomeSource, /playlists?|courses?|study paths?|totalProgress|overallProgress|مسار|دورة/i)
assert.match(studentHomeSource, /href="\/student\/profile\/"/)
assert.match(studentHomeSource, /\.auth\.signOut\(\)/)
assert.equal(
  studentHomeSource.match(/بعض سجلات التقدم مرتبطة بدروس لم تعد متاحة حاليًا\./g)?.length,
  1,
)

// Student account pages stay static shells. The migration mirrors the already-hosted table,
// and must never drift into a second competing profile model.
for (const route of [
  '../src/pages/student/login.astro',
  '../src/pages/student/auth/callback.astro',
  '../src/pages/student/index.astro',
  '../src/pages/student/profile.astro',
]) {
  assert.ok(existsSync(new URL(route, import.meta.url)), `${route} is missing`)
}
const profilesSql = readFileSync(
  new URL('../supabase/migrations/20260824000000_profiles.sql', import.meta.url),
  'utf8',
)
assert.match(profilesSql, /create table if not exists public\.profiles/)
assert.match(profilesSql, /alter table public\.profiles enable row level security/)
assert.match(profilesSql, /revoke all on table public\.profiles from public/)
assert.match(profilesSql, /function public\.set_updated_at\(\)/)
assert.match(profilesSql, /trigger profiles_set_updated_at/)
assert.match(profilesSql, /function public\.handle_new_user\(\)/)
assert.match(profilesSql, /trigger on_auth_user_created/)
assert.doesNotMatch(profilesSql, /student_profiles/)

// Lesson progress is cloud-owned by the authenticated student and mutation is RPC-only.
// Keep the checks deliberately structural: they catch permission or merge-invariant drift
// without requiring a local Supabase service during the static application selfcheck.
const lessonProgressSql = readFileSync(
  new URL('../supabase/migrations/20260826000000_lesson_progress.sql', import.meta.url),
  'utf8',
)
assert.match(lessonProgressSql, /create table public\.lesson_progress/)
assert.match(lessonProgressSql, /primary key \(user_id, lesson_key\)/)
assert.match(lessonProgressSql, /alter table public\.lesson_progress enable row level security/)
for (const policy of [
  'lesson_progress_select_own',
  'lesson_progress_insert_own',
  'lesson_progress_update_own',
]) {
  assert.match(lessonProgressSql, new RegExp(`create policy "${policy}"`))
}
assert.match(lessonProgressSql, /revoke all on table public\.lesson_progress from anon/)
assert.match(lessonProgressSql, /revoke all on table public\.lesson_progress from public/)
assert.match(lessonProgressSql, /revoke all on table public\.lesson_progress from authenticated/)
assert.match(lessonProgressSql, /grant select on table public\.lesson_progress to authenticated/)
assert.doesNotMatch(lessonProgressSql, /grant (?:insert|update|delete)[^;]*lesson_progress/i)
assert.doesNotMatch(lessonProgressSql, /create policy "[^"]*delete/i)
assert.match(lessonProgressSql, /trigger lesson_progress_set_updated_at/)
assert.match(lessonProgressSql, /execute function public\.set_updated_at\(\)/)
assert.match(lessonProgressSql, /function public\.merge_lesson_progress\(/)
assert.match(lessonProgressSql, /security definer\s+set search_path = ''/)
assert.match(lessonProgressSql, /v_user_id uuid := auth\.uid\(\)/)
assert.doesNotMatch(lessonProgressSql, /p_user_id/)
assert.match(lessonProgressSql, /on conflict \(user_id, lesson_key\) do update/)
assert.match(lessonProgressSql, /position_seconds = greatest\(/)
assert.match(lessonProgressSql, /duration_seconds = greatest\(/)
assert.match(lessonProgressSql, /completed = public\.lesson_progress\.completed or excluded\.completed/)
assert.match(lessonProgressSql, /client_updated_at = greatest\(/)
assert.match(
  lessonProgressSql,
  /if p_client_updated_at > now\(\) \+ interval '10 minutes' then/,
)
assert.match(lessonProgressSql, /trigger lesson_progress_reject_user_id_change/)
assert.match(lessonProgressSql, /revoke all on function public\.merge_lesson_progress\([\s\S]*from anon/)
assert.match(lessonProgressSql, /grant execute on function public\.merge_lesson_progress\([\s\S]*to authenticated/)

// Study Path publication is a migration-controlled identity/digest registry, not a curriculum
// copy or browser API. Static checks pin the minimal schema, write denial, and one-way lifecycle.
const studyPathVersionsSql = readFileSync(
  new URL('../supabase/migrations/20260902000000_study_path_versions.sql', import.meta.url),
  'utf8',
)
assert.match(studyPathVersionsSql, /create table public\.study_path_versions/)
for (const column of [
  'path_id uuid not null',
  'version integer not null',
  'definition_digest text not null',
  'published_at timestamptz not null',
  'retired_at timestamptz',
]) {
  assert.match(studyPathVersionsSql, new RegExp(column))
}
assert.match(studyPathVersionsSql, /primary key \(path_id, version\)/)
assert.match(studyPathVersionsSql, /check \(version > 0\)/)
assert.match(studyPathVersionsSql, /definition_digest ~ '\^\[0-9a-f\]\{64\}\$'/)
assert.match(studyPathVersionsSql, /retired_at >= published_at/)
assert.match(studyPathVersionsSql, /alter table public\.study_path_versions enable row level security/)
for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    studyPathVersionsSql,
    new RegExp(`revoke all on table public\\.study_path_versions from ${role}`),
  )
}
assert.match(studyPathVersionsSql, /revoke all on table public\.study_path_versions from service_role/)
assert.match(studyPathVersionsSql, /grant select on table public\.study_path_versions to service_role/)
assert.doesNotMatch(studyPathVersionsSql, /grant\s+(?:insert|update|delete|all)/i)
assert.doesNotMatch(studyPathVersionsSql, /create policy/i)
assert.doesNotMatch(
  studyPathVersionsSql,
  /modules?|lessons?|objectives?|titles?|descriptions?|slugs?|youtube|telegram|corpus|provider|jsonb?/i,
)
assert.match(studyPathVersionsSql, /function public\.study_path_versions_enforce_immutability\(\)/)
assert.match(studyPathVersionsSql, /security invoker\s+set search_path = ''/)
assert.match(studyPathVersionsSql, /new\.definition_digest is distinct from old\.definition_digest/)
assert.match(studyPathVersionsSql, /old\.retired_at is not null/)
assert.match(studyPathVersionsSql, /trigger study_path_versions_reject_delete/)
assert.doesNotMatch(studyPathVersionsSql, /study_path_enrollments/)

const studyPathPublicationVerificationSource = readFileSync(
  new URL('../scripts/verify-study-path-publications.ts', import.meta.url),
  'utf8',
)
assert.match(studyPathPublicationVerificationSource, /SUPABASE_SERVICE_ROLE_KEY/)
assert.match(
  studyPathPublicationVerificationSource,
  /\.from\('study_path_versions'\)[\s\S]*\.select\('path_id,version,definition_digest,published_at,retired_at'\)/,
)
assert.match(studyPathPublicationVerificationSource, /createPublicStudyPathPublicationManifest\(\)/)
assert.match(studyPathPublicationVerificationSource, /assertStudyPathPublicationRegistry\(manifest, data/)
assert.doesNotMatch(
  studyPathPublicationVerificationSource,
  /insert\s*\(|update\s*\(|upsert\s*\(|delete\s*\(|rpc\s*\(/i,
)

// Study Path enrollments pin an owner to one immutable published version. The
// table stores lifecycle only; writes are owner-derived RPCs and never duplicate
// lesson completion/progress state.
// Migration order matters: inspect replacement definitions, not just Slice 4.
const enrollmentMigrationDirectory = new URL('../supabase/migrations/', import.meta.url)
const enrollmentMigrationSources = readdirSync(enrollmentMigrationDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort()
  .map((name) => readFileSync(new URL(name, enrollmentMigrationDirectory), 'utf8'))

const studyPathEnrollmentsSql = readFileSync(
  new URL(
    '../supabase/migrations/20260903164705_study_path_enrollments.sql',
    import.meta.url,
  ),
  'utf8',
)
assert.match(studyPathEnrollmentsSql, /create table public\.study_path_enrollments/)
for (const column of [
  'id uuid primary key',
  'user_id uuid not null',
  'path_id uuid not null',
  'path_version integer not null',
  'state text not null',
  'enrolled_at timestamptz not null',
  'updated_at timestamptz not null',
  'paused_at timestamptz',
  'withdrawn_at timestamptz',
  'superseded_at timestamptz',
  'superseded_by_enrollment_id uuid',
]) {
  assert.match(studyPathEnrollmentsSql, new RegExp(column))
}
assert.match(
  studyPathEnrollmentsSql,
  /state in \('active', 'paused', 'withdrawn', 'superseded'\)/,
)
assert.match(
  studyPathEnrollmentsSql,
  /foreign key \(path_id, path_version\)[\s\S]*references public\.study_path_versions\(path_id, version\)/,
)
assert.match(
  studyPathEnrollmentsSql,
  /unique \(user_id, path_id, path_version\)/,
)
assert.match(
  studyPathEnrollmentsSql,
  /foreign key \(superseded_by_enrollment_id\)[\s\S]*references public\.study_path_enrollments\(id\)/,
)
assert.match(studyPathEnrollmentsSql, /study_path_enrollments_path_version_idx/)
assert.match(studyPathEnrollmentsSql, /study_path_enrollments_superseded_by_idx/)
assert.doesNotMatch(studyPathEnrollmentsSql, /create\s+unique\s+index[\s\S]*state\s*=\s*'active'/i)
assert.doesNotMatch(studyPathEnrollmentsSql, /unique\s*\([^)]*state/i)
assert.doesNotMatch(
  studyPathEnrollmentsSql,
  /^\s*(?:progress|progress_percentage|completed|current_lesson|provider_id|curriculum)\s+/im,
)
assert.doesNotMatch(studyPathEnrollmentsSql, /youtube|telegram|corpus|jsonb/i)
for (const timestamp of [
  'enrolled_at',
  'updated_at',
  'paused_at',
  'withdrawn_at',
  'superseded_at',
]) {
  assert.match(studyPathEnrollmentsSql, new RegExp(`${timestamp}[^;]*?_at_(?:finite|valid)`, 's'))
}
assert.match(studyPathEnrollmentsSql, /updated_at >= enrolled_at/)
assert.match(studyPathEnrollmentsSql, /state <> 'paused' or paused_at is not null/)
assert.match(studyPathEnrollmentsSql, /state = 'withdrawn'\) = \(withdrawn_at is not null/)
assert.match(studyPathEnrollmentsSql, /state = 'superseded'[\s\S]*superseded_at is not null/)
assert.match(
  studyPathEnrollmentsSql,
  /alter table public\.study_path_enrollments enable row level security/,
)
for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
  assert.match(
    studyPathEnrollmentsSql,
    new RegExp(`revoke all on table public\\.study_path_enrollments from ${role}`),
  )
}
assert.match(
  studyPathEnrollmentsSql,
  /grant select on table public\.study_path_enrollments to authenticated/,
)
assert.match(
  studyPathEnrollmentsSql,
  /grant select on table public\.study_path_enrollments to service_role/,
)
assert.doesNotMatch(
  studyPathEnrollmentsSql,
  /grant\s+(?:insert|update|delete|all)[^;]*study_path_enrollments/i,
)
assert.match(studyPathEnrollmentsSql, /create policy "study_path_enrollments_select_own"/)
assert.match(studyPathEnrollmentsSql, /using \(\(select auth\.uid\(\)\) = user_id\)/)
assert.doesNotMatch(studyPathEnrollmentsSql, /create policy "[^"]*(?:insert|update|delete)/i)
assert.match(studyPathEnrollmentsSql, /trigger study_path_enrollments_validate_lifecycle/)
assert.match(studyPathEnrollmentsSql, /trigger study_path_enrollments_set_updated_at/)
assert.doesNotMatch(studyPathEnrollmentsSql, /delete from public\.study_path_enrollments/i)
assert.match(studyPathEnrollmentsSql, /old\.state in \('withdrawn', 'superseded'\)/)
assert.match(studyPathEnrollmentsSql, /new\.path_version is distinct from old\.path_version/)
assert.match(studyPathEnrollmentsSql, /new\.updated_at < old\.updated_at/)
assert.match(
  studyPathEnrollmentsSql,
  /target\.user_id = new\.user_id[\s\S]*target\.path_id = new\.path_id[\s\S]*target\.path_version <> new\.path_version[\s\S]*target\.state = 'active'/,
)

const enrollmentRpcs = [
  {
    name: 'enroll_study_path',
    declaration: /\(\s*p_path_id uuid,\s*p_path_version integer\s*\)/,
    signature: 'uuid, integer',
  },
  {
    name: 'pause_study_path_enrollment',
    declaration: /\(\s*p_enrollment_id uuid\s*\)/,
    signature: 'uuid',
  },
  {
    name: 'resume_study_path_enrollment',
    declaration: /\(\s*p_enrollment_id uuid\s*\)/,
    signature: 'uuid',
  },
  {
    name: 'withdraw_study_path_enrollment',
    declaration: /\(\s*p_enrollment_id uuid\s*\)/,
    signature: 'uuid',
  },
  {
    name: 'upgrade_study_path_enrollment',
    declaration: /\(\s*p_enrollment_id uuid,\s*p_target_path_version integer\s*\)/,
    signature: 'uuid, integer',
  },
]

// Repository-convention lexer, not an arbitrary PostgreSQL parser: ASCII dollar
// tags and the existing SQL declaration conventions are supported.
// Comments become whitespace, quoted tokens remain
// opaque, and only unquoted semicolons separate top-level statements.
function sqlTokens(sql: string): { text: string; kind: 'code' | 'quoted' | 'body' }[] {
  const tokens: { text: string; kind: 'code' | 'quoted' | 'body' }[] = []
  let i = 0
  while (i < sql.length) {
    const start = i
    if (sql.startsWith('--', i)) {
      while (i < sql.length && sql[i] !== '\n') i++
      tokens.push({ text: sql.slice(start, i).replace(/[^\n]/g, ' '), kind: 'code' })
    } else if (sql.startsWith('/*', i)) {
      i += 2
      let depth = 1
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2 }
        else if (sql.startsWith('*/', i)) { depth--; i += 2 }
        else i++
      }
      assert.equal(depth, 0, 'Unterminated SQL block comment')
      tokens.push({ text: sql.slice(start, i).replace(/[^\n]/g, ' '), kind: 'code' })
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++]
      const escaped = quote === "'" && /(?:^|[^\w$])[eE]$/.test(sql.slice(0, start))
      let closed = false
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') { i += 2; continue }
        if (sql[i++] === quote) {
          if (sql[i] === quote) { i++; continue }
          closed = true
          break
        }
      }
      assert.ok(closed, 'Unterminated SQL quoted token')
      tokens.push({ text: sql.slice(start, i), kind: 'quoted' })
    } else {
      const delimiter = (i === 0 || !/[\w$]/.test(sql[i - 1]))
        ? sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0] : undefined
      if (delimiter) {
        const end = sql.indexOf(delimiter, i + delimiter.length)
        assert.ok(end >= 0, 'Unterminated SQL dollar quote')
        i = end + delimiter.length
        tokens.push({ text: sql.slice(start, i), kind: 'body' })
      } else {
        tokens.push({ text: sql[i++], kind: 'code' })
      }
    }
  }
  return tokens
}

function sqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  for (const token of sqlTokens(sql)) {
    current += token.text
    if (token.kind === 'code' && token.text === ';') {
      if (current.trim()) statements.push(current.trim())
      current = ''
    }
  }
  if (current.trim()) statements.push(current.trim())
  return statements
}

function executableSql(sql: string, unwrapBody = false): string {
  return sqlTokens(sql).map((token) => {
    if (unwrapBody && token.kind === 'body') {
      const delimiter = token.text.match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)![0]
      return executableSql(token.text.slice(delimiter.length, -delimiter.length))
    }
    return token.text
  }).join('')
}

function enrollmentRpcStatement(name: string, sources = enrollmentMigrationSources): string {
  const marker = new RegExp(`^create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`)
  const statement = sources.flatMap(sqlStatements).reverse().find((sql) => marker.test(sql))
  assert.ok(statement, `${name} executable definition is missing`)
  return statement
}

// Code view blanks ALL quoted data, preserving offsets/newlines. A separate
// value view encodes only exact contract constants as @value@ tokens; arbitrary
// literal contents can never supply SQL keywords or operators. Both views have
// identical offsets, so ordering checks can safely use positions from either.
function sqlViews(sql: string): { code: string; values: string } {
  const constants = new Set(["''", "':'", "'active'", "'paused'", "'withdrawn'", "'superseded'", "'INSERT'"])
  const tokens = sqlTokens(sql)
  const blank = (text: string) => text.replace(/[^\n]/g, ' ')
  return {
    code: tokens.map((token) => token.kind === 'code' ? token.text : blank(token.text)).join(''),
    values: tokens.map((token) => token.kind === 'code' ? token.text
      : token.kind === 'quoted' && constants.has(token.text)
        ? `@${token.text.slice(1, -1)}@` : blank(token.text)).join(''),
  }
}

function sqlProgram(statement: string): { header: string; code: string; values: string } {
  const tokens = sqlTokens(statement)
  const bodies = tokens.filter((token) => token.kind === 'body')
  assert.equal(bodies.length, 1, 'Expected one outer dollar-quoted program')
  const body = bodies[0].text
  const delimiter = body.match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)![0]
  const header = sqlViews(tokens.slice(0, tokens.indexOf(bodies[0])).map((token) => token.text).join('')).values
  assert.match(header, /(?:\bas|^do)\s*$/)
  // Only the outer quote is unwrapped. Nested dollar strings are data.
  return { header, ...sqlViews(body.slice(delimiter.length, -delimiter.length)) }
}

function validateEnrollmentAcl(sources: string[]): void {
  const signatures = new Map<string, boolean>(enrollmentRpcs.map(({ name, signature }) =>
    [`${name}(${signature.replace(/\s/g, '')})`, true] as const))
  signatures.set('study_path_enrollments_enforce_lifecycle()', false)
  const roles = ['public', 'anon', 'authenticated', 'service_role']
  const final = new Map<string, Map<string, boolean>>()
  for (const statement of sources.flatMap(sqlStatements)) {
    if (!/^(?:grant|revoke)\b/i.test(statement)) continue
    if (/\bon\s+table\b/i.test(statement)) continue
    // Deliberately narrow ACL grammar: fail closed on unsupported function ACLs.
    const match = statement.match(/^(grant|revoke)\s+(execute|all(?:\s+privileges)?)\s+on\s+function\s+public\.(\w+)\s*\(([^)]*)\)\s+(to|from)\s+([\w,\s]+);$/i)
    assert.ok(match, `Unsupported function ACL statement: ${statement}`)
    const [, action, , name, args, direction, recipients] = match
    assert.equal(direction.toLowerCase(), action.toLowerCase() === 'grant' ? 'to' : 'from')
    const signature = `${name.toLowerCase()}(${args.replace(/\s/g, '').toLowerCase()})`
    assert.ok(signatures.has(signature), `Unexpected function signature: ${signature}`)
    const state = final.get(signature) ?? new Map<string, boolean>()
    for (const role of recipients.toLowerCase().split(',').map((value) => value.trim())) {
      assert.ok(roles.includes(role), `Unexpected ACL role: ${role}`)
      state.set(role, action.toLowerCase() === 'grant')
    }
    final.set(signature, state)
  }
  for (const [signature, browserRpc] of signatures) {
    for (const role of roles) {
      assert.equal(final.get(signature)?.get(role), browserRpc && role === 'authenticated',
        `Final EXECUTE privilege: ${signature} / ${role}`)
    }
  }
}

for (const { name, declaration, signature } of enrollmentRpcs) {
  const escapedSignature = signature.replace(/[()]/g, '\\$&')
  assert.match(
    studyPathEnrollmentsSql,
    new RegExp(`revoke all on function public\\.${name}\\(${escapedSignature}\\) from public`),
  )
  assert.match(
    studyPathEnrollmentsSql,
    new RegExp(`revoke all on function public\\.${name}\\(${escapedSignature}\\) from anon`),
  )
  assert.match(
    studyPathEnrollmentsSql,
    new RegExp(`revoke all on function public\\.${name}\\(${escapedSignature}\\) from authenticated`),
  )
  assert.match(
    studyPathEnrollmentsSql,
    new RegExp(`revoke all on function public\\.${name}\\(${escapedSignature}\\) from service_role`),
  )
  assert.match(
    studyPathEnrollmentsSql,
    new RegExp(`grant execute on function public\\.${name}\\(${escapedSignature}\\) to authenticated`),
  )

  const program = sqlProgram(enrollmentRpcStatement(name))
  const definition = program.code
  assert.match(program.header, declaration)
  assert.match(program.header, /returns public\.study_path_enrollments/)
  assert.match(program.header, /language plpgsql\s+security definer\s+set search_path = @@/)
  assert.match(definition, /v_user_id uuid := auth\.uid\(\)/)
  assert.match(definition, /if v_user_id is null then/)
  assert.doesNotMatch(definition, /p_user_id/)
  assert.doesNotMatch(definition, /\bexecute\b|\bformat\s*\(/i)
  assert.doesNotMatch(definition, /\b(?:from|update|insert into)\s+study_path_/i)
}
assert.doesNotMatch(studyPathEnrollmentsSql, /p_user_id/)
assert.match(studyPathEnrollmentsSql, /pg_catalog\.pg_advisory_xact_lock/)
assert.match(studyPathEnrollmentsSql, /from public\.study_path_versions as versions[\s\S]*for share/)
assert.match(
  studyPathEnrollmentsSql,
  /on conflict \(user_id, path_id, path_version\) do nothing/,
)
assert.match(studyPathEnrollmentsSql, /versions\.retired_at/)
assert.match(studyPathEnrollmentsSql, /terminal enrollment cannot be reactivated/)
assert.match(studyPathEnrollmentsSql, /only an active enrollment can be paused/)
assert.match(studyPathEnrollmentsSql, /only a paused enrollment can be resumed/)
assert.match(
  studyPathEnrollmentsSql,
  /only an active or paused enrollment can be withdrawn/,
)
assert.match(studyPathEnrollmentsSql, /set state = 'active'/)
assert.match(
  studyPathEnrollmentsSql,
  /state = 'superseded',[\s\S]*superseded_by_enrollment_id = v_target\.id/,
)
assert.match(studyPathEnrollmentsSql, /superseded enrollment cannot be upgraded again/)
assert.match(
  sqlProgram(enrollmentRpcStatement('upgrade_study_path_enrollment')).values,
  /enrollments\.id = v_source\.superseded_by_enrollment_id[\s\S]*enrollments\.state = @active@\s+for update/,
)

// Slice 4.1 static contract. These checks do not replace PostgreSQL runtime,
// deferred-COMMIT, role, or two-session concurrency verification.
const liveEnrollmentMigrationName =
  '20260904195919_study_path_enrollments_one_live_forward_only.sql'
const liveEnrollmentSql = readFileSync(
  new URL(liveEnrollmentMigrationName, enrollmentMigrationDirectory),
  'utf8',
)
assert.equal(
  createHash('sha256').update(studyPathEnrollmentsSql).digest('hex'),
  '8fe2e8865dbf52bcdefb5e35567c0f6d5b1705b47dcce472a10fafc66114d7ab',
  'Applied Slice 4 migration must remain byte-for-byte unchanged',
)
function validateSlice41Migration(rawSql: string): void {
  // CLI 2.116.0 qX: optional BOM, exact first line, optional trailing CR.
  // This metadata is intentionally inspected BEFORE ordinary comment removal.
  const firstLine = rawSql.replace(/^\uFEFF/, '').split('\n', 1)[0].replace(/\r$/, '')
  assert.notEqual(firstLine, '-- pg-delta: transaction=false', 'Runner transaction mode must remain enabled')
  const statements = sqlStatements(rawSql)
  const liveEnrollmentSql = statements.map((statement) => sqlViews(statement).values).join('\n')
  for (const statement of statements) {
    assert.doesNotMatch(statement, /^(?:begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction)\b/i)
    assert.doesNotMatch(statement, /^(?:create\s+(?:unique\s+)?index|drop\s+index|reindex|vacuum|alter\s+system|cluster)\b/i)
  }
  const lock = statements.findIndex((sql) => /^lock table public\.study_path_enrollments in access exclusive mode;$/.test(sql))
  const auditPosition = statements.findIndex((sql) => /^do\s+\$/.test(sql))
  assert.ok(lock >= 0 && auditPosition > lock, 'Lock must precede both audits')
  assert.equal(statements.filter((sql) => /^do\s+\$/.test(sql)).length, 1)
  const audit = sqlProgram(statements[auditPosition]).values
  for (const [position, statement] of statements.entries()) {
    if (/^(?:alter table|create or replace function)\b/i.test(statement)) {
      assert.ok(position > auditPosition, 'Both audits must precede installation')
    }
  }
  assert.match(audit, /where state in \(@active@, @paused@\)\s+group by user_id, path_id\s+having count\(\*\) > 1/)
  assert.match(audit, /target\.user_id <> source\.user_id[\s\S]*target\.path_id <> source\.path_id[\s\S]*target\.path_version <= source\.path_version/)
  assert.match(audit, /left join public\.study_path_enrollments as target[\s\S]*target\.id is null/)
  assert.equal((audit.match(/raise exception/g) ?? []).length, 2)
  assert.doesNotMatch(audit, /target\.state|\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i)

  assert.match(
    liveEnrollmentSql,
    /alter table public\.study_path_enrollments\s+add constraint study_path_enrollments_one_live_per_path\s+exclude using btree \(user_id with =, path_id with =\)\s+where \(state in \(@active@, @paused@\)\)\s+deferrable initially deferred;/,
  )
  assert.equal((liveEnrollmentSql.match(/\badd constraint\b/g) ?? []).length, 1)
  assert.doesNotMatch(liveEnrollmentSql, /\bcreate\s+(?:unique\s+)?index\b|\bcreate\s+extension\b|btree_gist|generated\s+always|add\s+column/i)
  assert.doesNotMatch(liveEnrollmentSql, /unique\s*\(|exclude using \w+\s*\(\s*user_id with =\s*\)/i)
  assert.doesNotMatch(liveEnrollmentSql, /drop constraint|alter constraint|create policy|grant\s+(?:insert|update|delete|all)\b/i)
  assert.doesNotMatch(liveEnrollmentSql, /StudentHome|Player|lesson_progress|study-paths\/|Slice 5/i)
  assert.match(studyPathEnrollmentsSql, /constraint study_path_enrollments_user_path_version_key\s+unique \(user_id, path_id, path_version\),/)

  const enroll = sqlProgram(enrollmentRpcStatement('enroll_study_path', [rawSql]))
  const effectiveEnroll = enroll.values
  const upgrade = sqlProgram(enrollmentRpcStatement('upgrade_study_path_enrollment', [rawSql]))
  const effectiveUpgrade = upgrade.values
  const lifecycle = sqlProgram(enrollmentRpcStatement('study_path_enrollments_enforce_lifecycle', [rawSql]))
  const effectiveLifecycle = lifecycle.values
  for (const program of [enroll, upgrade]) {
    const definition = program.code
    assert.match(program.header, /language plpgsql\s+security definer\s+set search_path = @@/)
    assert.match(definition, /v_user_id uuid := auth\.uid\(\)/)
    assert.match(definition, /if v_user_id is null then/)
    assert.doesNotMatch(definition, /p_user_id/)
  }
  for (const { name, declaration } of enrollmentRpcs.filter(({ name }) =>
    name === 'enroll_study_path' || name === 'upgrade_study_path_enrollment')) {
    assert.match(sqlProgram(enrollmentRpcStatement(name, [rawSql])).header, declaration)
  }
  const exactReturn = effectiveEnroll.indexOf('return v_result;')
  const liveCheck = effectiveEnroll.indexOf('and enrollments.path_version <> p_path_version')
  const publicationCheck = effectiveEnroll.indexOf('select versions.retired_at')
  assert.ok(exactReturn > 0 && liveCheck > exactReturn && publicationCheck > liveCheck)
  assert.match(effectiveEnroll.slice(0, exactReturn), /enrollments\.path_version = p_path_version\s+for update;[\s\S]*if v_result\.state in \(@withdrawn@, @superseded@\) then[\s\S]*raise exception/)
  assert.match(effectiveEnroll, /perform 1\s+from public\.study_path_enrollments as enrollments\s+where enrollments\.user_id = v_user_id\s+and enrollments\.path_id = p_path_id\s+and enrollments\.path_version <> p_path_version\s+and enrollments\.state in \(@active@, @paused@\);\s+if found then\s+raise exception/)
  assert.doesNotMatch(enroll.code, /\bupdate\s+public\.|set state|resume_study_path_enrollment/)
  for (const [program, pathVariable] of [[enroll, 'p_path_id'], [upgrade, 'v_path_id']] as const) {
    const definition = program.code
    assert.ok(program.values.includes(`pg_catalog.hashtextextended(v_user_id::text || @:@ || ${pathVariable}::text, 0)`))
    assert.match(definition, /pg_catalog\.pg_advisory_xact_lock/)
    assert.match(definition, /from public\.study_path_versions as versions[\s\S]*for share;\s+if not found or v_retired_at is not null then/)
    assert.match(definition, /on conflict \(user_id, path_id, path_version\) do nothing;/)
    assert.equal((definition.match(/on conflict/g) ?? []).length, 1)
    assert.doesNotMatch(definition, /set constraints|on conflict on constraint/i)
  }
  const forwardGuard = upgrade.code.indexOf('if p_target_path_version <= v_source.path_version then')
  const repeatBranch = effectiveUpgrade.indexOf("if v_source.state = @superseded@ then")
  assert.ok(forwardGuard > 0 && forwardGuard < repeatBranch)
  assert.match(upgrade.code.slice(forwardGuard, repeatBranch), /raise exception\s+using errcode =\s*;/)
  assert.doesNotMatch(upgrade.code, /p_target_path_version = v_source\.path_version|public\.enroll_study_path\(/)
  assert.match(effectiveUpgrade, /if v_source\.state not in \(@active@, @paused@\) then/)
  assert.match(effectiveUpgrade, /enrollments\.id = v_source\.superseded_by_enrollment_id[\s\S]*enrollments\.user_id = v_user_id[\s\S]*enrollments\.path_id = v_source\.path_id[\s\S]*enrollments\.path_version = p_target_path_version[\s\S]*enrollments\.state = @active@\s+for update;\s+if found then\s+return v_target;/)
  const upgradeOrder = [
    'pg_catalog.pg_advisory_xact_lock(',
    'select enrollments.* into v_source',
    'if p_target_path_version <=',
    'select versions.retired_at',
    'insert into public.study_path_enrollments',
    "if v_target.state = @paused@ then",
    "set state = @active@",
    "state = @superseded@,",
    'superseded_by_enrollment_id = v_target.id',
  ].map((marker) => effectiveUpgrade.indexOf(marker))
  assert.ok(upgradeOrder.every((position, i) => position >= 0 && (i === 0 || position > upgradeOrder[i - 1])))
  assert.match(effectiveUpgrade, /elsif v_target\.state <> @active@ then\s+raise exception/)
  assert.match(liveEnrollmentSql, /create trigger study_path_enrollments_validate_lifecycle\s+before insert or update on public\.study_path_enrollments\s+for each row execute function public\.study_path_enrollments_enforce_lifecycle\(\)/)
  assert.doesNotMatch(liveEnrollmentSql, /drop trigger study_path_enrollments_set_updated_at/)
  assert.match(lifecycle.header, /security invoker\s+set search_path = @@/)
  const insertBranch = effectiveLifecycle.slice(effectiveLifecycle.indexOf("if tg_op = @INSERT@ then"), effectiveLifecycle.indexOf('\n  else'))
  assert.match(insertBranch, /v_establish_supersession := new\.state = @superseded@/)
  assert.doesNotMatch(insertBranch, /old\./)
  assert.doesNotMatch(lifecycle.code.slice(0, effectiveLifecycle.indexOf('\n  else')), /old\./)
  assert.match(effectiveLifecycle, /v_establish_supersession := old\.state in \(@active@, @paused@\)\s+and new\.state = @superseded@/)
  assert.match(effectiveLifecycle, /if v_establish_supersession then[\s\S]*target\.id = new\.superseded_by_enrollment_id[\s\S]*target\.id <> new\.id[\s\S]*target\.user_id = new\.user_id[\s\S]*target\.path_id = new\.path_id[\s\S]*target\.path_version > new\.path_version[\s\S]*target\.state = @active@/)
  assert.doesNotMatch(effectiveLifecycle, /target\.path_version <>/)
  // Preserve every original UPDATE guard and state constant; diagnostic
  // message contents are data, not part of the executable guard contract.
  const originalLifecycle = sqlViews(studyPathEnrollmentsSql.slice(
    studyPathEnrollmentsSql.indexOf('  if new.id is distinct'),
    studyPathEnrollmentsSql.indexOf("  if old.state in ('active', 'paused') and new.state = 'superseded' then"),
  )).values.trim().replace(/\s+/g, ' ')
  assert.ok(effectiveLifecycle.replace(/\s+/g, ' ').includes(originalLifecycle))
  for (const [name, signature] of [
    ['study_path_enrollments_enforce_lifecycle', ''],
    ['enroll_study_path', 'uuid, integer'],
    ['upgrade_study_path_enrollment', 'uuid, integer'],
  ]) {
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      assert.ok(statements.includes(`revoke all on function public.${name}(${signature}) from ${role};`))
    }
    if (signature) {
      assert.ok(statements.includes(`grant execute on function public.${name}(${signature}) to authenticated;`))
    }
  }
  validateEnrollmentAcl([studyPathEnrollmentsSql, rawSql])

  assert.match(effectiveLifecycle, /target\.state = @active@\s+for share;\s+if not found then\s+raise exception/)
}

validateSlice41Migration(liveEnrollmentSql)

// Mutations are strings only: no migration or repository files are rewritten.
const slice41Statements = sqlStatements(liveEnrollmentSql)
function commentOutSlice41Statement(pattern: RegExp): string {
  const matches = slice41Statements.filter((statement) => pattern.test(statement))
  assert.equal(matches.length, 1, `Mutation must select exactly one statement: ${pattern}`)
  return slice41Statements.map((statement) => statement === matches[0]
    ? `/* ${statement} */` : statement).join('\n')
}
function replaceSlice41Once(before: string, after: string): string {
  assert.equal(liveEnrollmentSql.split(before).length, 2, 'Mutation target must be unique')
  return liveEnrollmentSql.replace(before, after)
}
const slice41NegativeMutations: [string, string][] = [
  ['A: commented exclusion', commentOutSlice41Statement(/^alter table public\.study_path_enrollments\s+add constraint/)],
  ...['enroll_study_path', 'upgrade_study_path_enrollment', 'study_path_enrollments_enforce_lifecycle']
    .map((name): [string, string] => [
      `B/C/D: commented ${name}`,
      commentOutSlice41Statement(new RegExp(`^create or replace function public\\.${name}\\(`)),
    ]),
  ['E: commented ACLs', slice41Statements.map((statement) => /^(?:revoke|grant)\b/.test(statement)
    ? `/* ${statement} */` : statement).join('\n')],
  ['F: comment-only deferral', replaceSlice41Once('deferrable initially deferred;', '/* deferrable initially deferred */;')],
  ['G: comment-only forward guard', replaceSlice41Once(
    "if p_target_path_version <= v_source.path_version then\n    raise exception 'upgrade target must be a greater path version' using errcode = '22023';\n  end if;",
    "/* if p_target_path_version <= v_source.path_version then\n    raise exception 'upgrade target must be a greater path version' using errcode = '22023';\n  end if; */",
  )],
  ['H: comment-only lock', commentOutSlice41Statement(/^lock table /)],
]
for (const [name, sql] of slice41NegativeMutations) {
  assert.throws(() => validateSlice41Migration(sql), name)
}
// I: comments cannot create executable transaction boundaries or forbidden DDL.
validateSlice41Migration(`/* BEGIN; /* nested */ COMMIT; */\n-- ROLLBACK;\n${liveEnrollmentSql}\n/* VACUUM; CREATE INDEX CONCURRENTLY fake; */`)
for (const forbidden of [
  'BEGIN', 'START TRANSACTION', 'COMMIT', 'END', 'ROLLBACK',
  'CREATE INDEX CONCURRENTLY fake ON public.study_path_enrollments (id)',
  'DROP INDEX CONCURRENTLY fake', 'REINDEX INDEX CONCURRENTLY fake',
  'VACUUM', "ALTER SYSTEM SET work_mem = '4MB'", 'CLUSTER public.study_path_enrollments',
]) {
  assert.throws(() => validateSlice41Migration(`${forbidden};\n${liveEnrollmentSql}`), forbidden)
}
// Quoting must protect comment markers and semicolons, including nested comments,
// doubled quote escapes, E-string escapes, and arbitrary dollar tags.
const lexicalFixture = String.raw`select '-- /* ; it''s */', "a""--/*;", E'escaped\'--/*;'; /* outer /* nested */ end */
do $function$begin perform '--'; -- hidden
end$function$; do $tag$begin /* hidden */ end$tag$; do $$begin end$$;`
const lexicalStatements = sqlStatements(lexicalFixture)
assert.equal(lexicalStatements.length, 4)
assert.ok(lexicalStatements[0].includes("'-- /* ; it''s */'"))
assert.ok(lexicalStatements[0].includes('"a""--/*;"'))
assert.ok(lexicalStatements[0].includes(String.raw`E'escaped\'--/*;'`))
assert.doesNotMatch(executableSql(lexicalStatements[1], true), /hidden/)
assert.ok(executableSql(lexicalStatements[1], true).includes("'--'"))
assert.doesNotMatch(executableSql(lexicalStatements[2], true), /hidden/)
assert.match(executableSql('select 1/* nested /* x */ y */+2;'), /^select 1 +\+2;$/)
assert.throws(() => sqlStatements('/* unfinished'))
assert.throws(() => sqlStatements("select 'unfinished"))
assert.throws(() => sqlStatements('do $tag$unfinished'))

// Direct central-validator regressions: literal-only implementations must fail
// for their own missing executable logic, independent of the older mutations.
function quotedSqlData(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}
function mutateSlice41(pattern: RegExp, replacement: (matched: string) => string): string {
  const matches = [...liveEnrollmentSql.matchAll(new RegExp(pattern.source, 'g'))]
  assert.equal(matches.length, 1, `Expected one mutation target: ${pattern}`)
  const result = liveEnrollmentSql.replace(matches[0][0], replacement(matches[0][0]))
  assert.notEqual(result, liveEnrollmentSql, 'Mutation must change the input')
  return result
}
const forwardBlock = /if p_target_path_version <= v_source\.path_version then[\s\S]*?end if;/
const advisoryBlock = /perform pg_catalog\.pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\(v_user_id::text \|\| ':' \|\| p_path_id::text, 0\)\s*\);/
const registryShare = /where versions\.path_id = p_path_id and versions\.version = p_path_version\s+for share;/
const supersedeUpdate = /update public\.study_path_enrollments\s+set\s+state = 'superseded',[\s\S]*?where id = v_source\.id;/
const literalMutations: [string, string][] = [
  ['body A: guard in dollar literal', mutateSlice41(forwardBlock, (text) => `perform $review$${text}$review$;`)],
  ['body B: guard in single literal', mutateSlice41(forwardBlock, (text) => `perform ${quotedSqlData(text)};`)],
  ['body C: advisory call in literal', mutateSlice41(advisoryBlock, (text) => `perform ${quotedSqlData(text)};`)],
  ['body D: FOR SHARE in literal', mutateSlice41(registryShare, (text) => text.replace('for share;', `;\n  perform 'for share';`))],
  ['body D: FOR SHARE in comment', mutateSlice41(registryShare, (text) => text.replace('for share;', '/* for share */;'))],
  ['body E: supersession UPDATE in literal', mutateSlice41(supersedeUpdate, (text) => `perform $review$${text}$review$;`)],
]
for (const [name, sql] of literalMutations) {
  assert.throws(() => validateSlice41Migration(sql), name)
}
for (const text of [
  'SET CONSTRAINTS is not allowed', '--', '/* */', 'commit', 'begin',
  'grant execute on function public.enroll_study_path(uuid, integer) to anon;',
]) {
  const harmless = mutateSlice41(/if p_path_id is null/, () => `perform ${quotedSqlData(text)};\n  if p_path_id is null`)
  assert.doesNotThrow(() => validateSlice41Migration(harmless), `Harmless body data: ${text}`)
}
const errorText = mutateSlice41(/raise exception 'authentication required' using errcode = '42501';\n  end if;\n  if p_path_id/,
  (text) => text.replace("'authentication required'", "'SET CONSTRAINTS is not allowed'"))
assert.doesNotThrow(() => validateSlice41Migration(errorText), 'Harmless error message')

const enrollGrant = 'grant execute on function public.enroll_study_path(uuid, integer) to authenticated;'
const enrollRevoke = 'revoke execute on function public.enroll_study_path(uuid, integer) from authenticated;'
assert.equal(slice41Statements.filter((statement) => statement === enrollGrant).length, 1)
const grantFirstStatements = slice41Statements.filter((statement) => statement !== enrollGrant)
const firstEnrollRevoke = grantFirstStatements.findIndex((statement) => statement ===
  'revoke all on function public.enroll_study_path(uuid, integer) from public;')
assert.ok(firstEnrollRevoke >= 0)
grantFirstStatements.splice(firstEnrollRevoke, 0, enrollGrant)
const grantFirst = grantFirstStatements.join('\n')
assert.ok(grantFirst.indexOf(enrollGrant) < grantFirst.indexOf(
  'revoke all on function public.enroll_study_path(uuid, integer) from authenticated;'))
const aclMutations: [string, string][] = [
  ['ACL A: grant before revoke', grantFirst],
  ['ACL B: final authenticated revoke', `${liveEnrollmentSql}\n${enrollRevoke}`],
  ...['anon', 'service_role', 'PUBLIC'].map((role): [string, string] => [
    `ACL C/D/E: later ${role} grant`,
    `${liveEnrollmentSql}\ngrant execute on function public.enroll_study_path(uuid, integer) to ${role};`,
  ]),
  ['ACL F: lifecycle grant', `${liveEnrollmentSql}\ngrant execute on function public.study_path_enrollments_enforce_lifecycle() to authenticated;`],
  ['ACL G: comment-only correct block', slice41Statements.map((statement) => /^(?:grant|revoke)\b/.test(statement)
    ? `/* ${statement} */` : statement).join('\n')],
]
for (const [name, sql] of aclMutations) {
  assert.notEqual(sql, liveEnrollmentSql)
  assert.throws(() => validateSlice41Migration(sql), name)
}
for (const { name, signature } of enrollmentRpcs) {
  assert.throws(() => validateSlice41Migration(`${liveEnrollmentSql}\nrevoke execute on function public.${name}(${signature}) from authenticated;`),
    `Final authenticated revoke: ${name}`)
}
// Prove actual ordered evaluation: a later grant restores a previous revoke.
assert.doesNotThrow(() => validateSlice41Migration(`${liveEnrollmentSql}\n${enrollRevoke}\n${enrollGrant}`))
const fakeAcl = quotedSqlData(enrollGrant)
assert.doesNotThrow(() => validateSlice41Migration(`${liveEnrollmentSql}\nselect ${fakeAcl};`), 'ACL H: quoted text ignored')
assert.throws(() => validateSlice41Migration(`${liveEnrollmentSql}\n${enrollRevoke}\nselect ${fakeAcl};`),
  'ACL H: quoted grant cannot repair real revoke')
assert.throws(() => validateSlice41Migration(`${liveEnrollmentSql}\ngrant execute on all functions in schema public to anon;`),
  'Unsupported blanket function grant must fail closed')
assert.throws(() => validateSlice41Migration(liveEnrollmentSql.replace(enrollGrant,
  enrollGrant.replace('(uuid, integer)', '(uuid)'))), 'Wrong function signature')

for (const prefix of ['', '\uFEFF']) {
  for (const newline of ['\n', '\r\n']) {
    assert.throws(() => validateSlice41Migration(`${prefix}-- pg-delta: transaction=false${newline}${liveEnrollmentSql}`),
      'Active runner metadata must fail')
  }
}
assert.doesNotThrow(() => validateSlice41Migration(`${liveEnrollmentSql}\n-- pg-delta: transaction=false\n`),
  'Later ordinary comment is not active metadata')
assert.doesNotThrow(() => validateSlice41Migration(`-- Documentation mentions -- pg-delta: transaction=false\n${liveEnrollmentSql}`))
// Cheap formatting support without claiming arbitrary PostgreSQL syntax.
assert.doesNotThrow(() => validateSlice41Migration(liveEnrollmentSql.replace(
  'create or replace function public.enroll_study_path(',
  'create/* declaration comment */ or replace function public.enroll_study_path(')))
console.log('Slice 4.1: comment, body-literal, ordered ACL, metadata, and lexical regression checks passed')


const supabaseTypesSource = readFileSync(
  new URL('../src/lib/supabase.ts', import.meta.url),
  'utf8',
)
assert.match(
  supabaseTypesSource,
  /StudyPathEnrollmentState = 'active' \| 'paused' \| 'withdrawn' \| 'superseded'/,
)
assert.match(supabaseTypesSource, /study_path_enrollments: \{[\s\S]*Row: StudyPathEnrollmentRow/)
for (const rpc of [
  'enroll_study_path',
  'pause_study_path_enrollment',
  'resume_study_path_enrollment',
  'withdraw_study_path_enrollment',
  'upgrade_study_path_enrollment',
]) {
  assert.match(supabaseTypesSource, new RegExp(`${rpc}: \\{`))
}

// Slice 5A: pure owner/path boundaries and real client serialization over an in-memory transport.
const {
  partitionStudyPathEnrollments, selectStudyPathEnrollment, studyPathEnrollmentActions,
  resolveStudentStudyPathVersions, freshStudyPathEnrollmentEligibility,
  studyPathUpgradeEligibility, studyPathUpgradePreview, studyPathContinueLink,
  deriveStudentStudyPath,
} = await import('../src/lib/student-study-path.ts')
const { createStudentStudyPathCloud, StudentStudyPathCloudError } =
  await import('../src/lib/student-study-path-cloud.ts')
const { createClient: createStudyPathTestClient } = await import('@supabase/supabase-js')
type Enrollment5A = import('../src/lib/supabase.ts').StudyPathEnrollmentRow
type Database5A = import('../src/lib/supabase.ts').Database

// All curriculum is constructed here, with no production catalog or fixture mutation.
const uuid5A = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const pathId5A = uuid5A(1)
const lessonKeys5A = [uuid5A(10), uuid5A(11), uuid5A(12)]
const version5A = (number: number, keys: string[]): StudyPathVersion => ({
  pathId: pathId5A, version: number, publishedAt: '2026-09-01T00:00:00.000Z',
  modules: [{ moduleKey: uuid5A(2), title: 'Module', objective: 'Objective', position: 1,
    lessons: keys.map((lessonKey, index) => ({ lessonKey, position: index + 1 })) }],
})
const source5A = version5A(1, lessonKeys5A.slice(0, 2))
const target5A = version5A(2, lessonKeys5A.slice(1))
const path5A: import('../src/lib/study-paths.ts').StudyPathDefinition = {
  pathId: pathId5A, slug: 'test-only', title: 'Test', description: 'In-memory only',
  status: 'published', currentVersion: 2, versions: [source5A, target5A],
}
const enrollment5A = (overrides: Partial<Enrollment5A> = {}): Enrollment5A => ({
  id: uuid5A(3), user_id: uuid5A(4), path_id: pathId5A, path_version: 1, state: 'active',
  enrolled_at: '2026-09-02T00:00:00.000Z', updated_at: '2026-09-02T00:00:00.000Z',
  paused_at: null, withdrawn_at: null, superseded_at: null,
  superseded_by_enrollment_id: null, ...overrides,
})
const active5A = enrollment5A()
const otherPath5A = enrollment5A({ id: uuid5A(5), path_id: uuid5A(6) })
const history5A = enrollment5A({ id: uuid5A(7), path_version: 2, state: 'withdrawn' })
assert.equal(partitionStudyPathEnrollments([active5A, otherPath5A], pathId5A).live, active5A)
assert.equal(partitionStudyPathEnrollments([active5A, otherPath5A], otherPath5A.path_id).live, otherPath5A)
assert.deepEqual(partitionStudyPathEnrollments([history5A], pathId5A), { live: null, historical: [history5A] })
assert.equal(selectStudyPathEnrollment([active5A, history5A], pathId5A, history5A.id), history5A)
assert.equal(selectStudyPathEnrollment([active5A, otherPath5A], pathId5A, otherPath5A.id), null)
assert.equal(selectStudyPathEnrollment([active5A], pathId5A, uuid5A(999)), null)
assert.equal(selectStudyPathEnrollment([active5A], pathId5A), active5A)
assert.throws(() => partitionStudyPathEnrollments([active5A, enrollment5A({ id: uuid5A(8), path_version: 2, state: 'paused' })], pathId5A), /multiple live/)
assert.throws(() => partitionStudyPathEnrollments([active5A, active5A], pathId5A), /duplicate/)
assert.throws(() => partitionStudyPathEnrollments([active5A, enrollment5A({ user_id: uuid5A(88) })], pathId5A), /mixed/)
assert.deepEqual(studyPathEnrollmentActions('active'), { pause: true, resume: false, withdraw: true, upgrade: true })
assert.deepEqual(studyPathEnrollmentActions('paused'), { pause: false, resume: true, withdraw: true, upgrade: true })
for (const state of ['withdrawn', 'superseded'] as const)
  assert.deepEqual(studyPathEnrollmentActions(state), { pause: false, resume: false, withdraw: false, upgrade: false })
const versions5A = resolveStudentStudyPathVersions(path5A, active5A)
assert.equal(versions5A.pinned?.version, 1)
assert.equal(versions5A.current.version, 2)
assert.equal(versions5A.newer?.version, 2)
assert.throws(() => resolveStudentStudyPathVersions({ ...path5A, versions: [target5A] }, active5A), /unavailable/)
assert.throws(() => resolveStudentStudyPathVersions(path5A, otherPath5A), /another path/)
assert.deepEqual(freshStudyPathEnrollmentEligibility(path5A, [otherPath5A]), { allowed: true })
assert.deepEqual(freshStudyPathEnrollmentEligibility(path5A, [active5A]), { allowed: false, reason: 'live-exists' })
assert.deepEqual(freshStudyPathEnrollmentEligibility(path5A, [history5A]), { allowed: false, reason: 'terminal-version' })
assert.deepEqual(freshStudyPathEnrollmentEligibility(path5A, [enrollment5A({ state: 'withdrawn' })]), { allowed: true })
// No lifetime monotonicity: untouched current v1 remains eligible after withdrawal from v2.
assert.deepEqual(freshStudyPathEnrollmentEligibility({ ...path5A, currentVersion: 1 }, [history5A]), { allowed: true })
for (const status of ['draft', 'retired'] as const)
  assert.deepEqual(freshStudyPathEnrollmentEligibility({ ...path5A, status }, []), { allowed: false, reason: 'not-published' })
assert.deepEqual(studyPathUpgradeEligibility(path5A, [active5A], active5A.id), { allowed: true })
assert.deepEqual(studyPathUpgradeEligibility(path5A, [enrollment5A({ state: 'paused' })], active5A.id), { allowed: true })
for (const target of [0, 1])
  assert.deepEqual(studyPathUpgradeEligibility(path5A, [active5A], active5A.id, target), { allowed: false, reason: 'not-forward' })
assert.deepEqual(studyPathUpgradeEligibility(path5A, [active5A], active5A.id, 3), { allowed: false, reason: 'not-current' })
for (const state of ['withdrawn', 'superseded'] as const) {
  assert.deepEqual(studyPathUpgradeEligibility(path5A, [active5A, { ...history5A, state }], active5A.id), { allowed: false, reason: 'terminal-version' })
  assert.deepEqual(studyPathUpgradeEligibility(path5A, [enrollment5A({ state })], active5A.id), { allowed: false, reason: 'source-not-live' })
}
const canonicalBefore5A = JSON.stringify(path5A)
const preview5A = studyPathUpgradePreview(source5A, target5A)
assert.deepEqual(preview5A, {
  sourceVersion: 1, targetVersion: 2, addedLessonKeys: [lessonKeys5A[2]],
  removedLessonKeys: [lessonKeys5A[0]], sharedLessonKeys: [lessonKeys5A[1]], structureOrOrderChanged: true,
})
assert.equal(studyPathUpgradePreview(source5A, { ...source5A, version: 2 }).structureOrOrderChanged, false)
assert.equal(studyPathUpgradePreview(source5A, version5A(2, [...lessonKeys5A.slice(0, 2)].reverse())).structureOrOrderChanged, true)

assert.throws(() =>
  studyPathUpgradePreview(
    source5A,
    version5A(2, [lessonKeys5A[0], lessonKeys5A[0]]),
  ),
)

assert.equal(
  studyPathUpgradePreview(source5A, {
    ...source5A,
    version: 2,
    modules: source5A.modules.map((module) => ({
      ...module,
      moduleKey: uuid5A(222),
    })),
  }).structureOrOrderChanged,
  true,
)

assert.throws(() => studyPathUpgradePreview(target5A, source5A), /forward/)
const display5A = lessonKeys5A.map((lessonKey, i) => ({ lessonKey, title: `Lesson ${i}`, href: `/lessons/test-${i}/` }))
const progress5A = (lesson_key: string, completed = false, position_seconds = 0): StudentProgressRow => ({
  lesson_key, completed, position_seconds, duration_seconds: 100,
  client_updated_at: '2026-08-01T00:00:00.000Z', // Before enrollment.
})
assert.equal(deriveStudentStudyPath(path5A, active5A, [], display5A).progress.percentage, 0)
assert.equal(deriveStudentStudyPath(path5A, active5A, [], display5A).continueLesson?.lessonKey, lessonKeys5A[0])
const resumed5A = deriveStudentStudyPath(path5A, active5A, [
  { ...progress5A(lessonKeys5A[1], false, 60), client_updated_at: '2026-09-03T00:00:00.000Z' },
  progress5A(lessonKeys5A[0], false, 12.9),
], display5A)
assert.equal(resumed5A.continueLesson?.href, '/lessons/test-0/?t=12')
const previous5A = deriveStudentStudyPath(path5A, active5A, [progress5A(lessonKeys5A[0], true)], display5A)
assert.equal(previous5A.progress.percentage, 50)
assert.equal(previous5A.continueLesson?.lessonKey, lessonKeys5A[1])
const shared5A = [progress5A(lessonKeys5A[1], true)]
assert.equal(deriveStudentStudyPath(path5A, active5A, shared5A, display5A).progress.completedLessons, 1)
assert.equal(deriveStudentStudyPath(path5A, enrollment5A({ path_version: 2 }), shared5A, display5A).progress.completedLessons, 1)
const complete5A = deriveStudentStudyPath(path5A, active5A, lessonKeys5A.map((key) => progress5A(key, true)), display5A)
assert.equal(deriveStudentStudyPath(path5A, active5A, [progress5A(lessonKeys5A[0], false, 100)], display5A).progress.completedLessons, 0)
assert.equal(complete5A.completed, true)
assert.equal(complete5A.progress.percentage, 100)
assert.equal(complete5A.continueLesson, null)
assert.equal(active5A.state, 'active')
assert.equal(deriveStudentStudyPath(path5A, enrollment5A({ state: 'paused' }), [], display5A).continueLesson, null)
assert.equal(JSON.stringify(path5A), canonicalBefore5A)
assert.throws(() => deriveStudentStudyPath(path5A, active5A, [], []), /metadata unavailable/)
assert.throws(() => deriveStudentStudyPath(path5A, active5A, [], [...display5A, display5A[0]]), /metadata unavailable/)
const firstContinue5A = resumed5A.progress.continueLesson!
for (const seconds of [0, -1, NaN, Infinity])
  assert.equal(
    studyPathContinueLink(
      { ...firstContinue5A, effectiveResumeSeconds: seconds },
      display5A,
    )?.href,
    '/lessons/test-0/',
  )
assert.equal(
  studyPathContinueLink(
    { ...firstContinue5A, effectiveResumeSeconds: 0.9 },
    display5A,
  )?.href,
  '/lessons/test-0/?t=0',
)
assert.equal(
  studyPathContinueLink(
    { ...firstContinue5A, effectiveResumeSeconds: 1.9 },
    display5A,
  )?.href,
  '/lessons/test-0/?t=1',
)
assert.throws(() => studyPathContinueLink(firstContinue5A, [{ ...display5A[0], href: '//outside.invalid/' }]), /invalid resolved/)
assert.throws(() => deriveStudentStudyPath({ ...path5A, versions: [{ ...source5A,
  modules: source5A.modules.map((module) => ({ ...module, lessons: module.lessons.map((lesson) => ({ ...lesson, title: 'Decoration' })) })),
}, target5A] }, active5A, [], display5A), /unexpected field/)

// Real supabase-js request serialization, but no network/auth/hosted project.
const requests5A: { url: URL; method: string; body: unknown }[] = []
let failKey5A: string | undefined
let failRpc5A = false
let nullRpc5A = false
let networkRpc5A = false
let corruptProgress5A = false
let malformedProgressContainer5A: 'none' | 'first' | 'later' = 'none'
let malformedProgressRow5A = false
let malformedEnrollmentContainer5A = false
let malformedEnrollmentRow5A = false
let malformedRpcResult5A = false
const cloudKeys5A = Array.from({ length: 205 }, (_, index) => uuid5A(1000 + index))
const cloudRows5A = cloudKeys5A.filter((_, index) => index % 4 !== 0).map((key) => progress5A(key, true))
const targetEnrollment5A = enrollment5A({ id: uuid5A(20), path_version: 2 })
const testClient5A = createStudyPathTestClient<Database5A>('https://study-path-test.invalid', 'test-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    requests5A.push({ url, method, body })
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
      status, headers: { 'Content-Type': 'application/json' },
    })
    if (url.pathname.includes('/rpc/')) {
      if (networkRpc5A) throw new TypeError('network unavailable')
      if (malformedRpcResult5A) return reply({})
      if (nullRpc5A) return reply(null)
      if (failRpc5A) return reply({ code: '22023', message: 'private SQL detail', details: 'detail', hint: 'hint' }, 400)
      return reply(url.pathname.endsWith('/upgrade_study_path_enrollment') ? targetEnrollment5A : active5A)
    }
    const params = url.searchParams
    if (url.pathname.endsWith('/lesson_progress')) {
      const keys = params.get('lesson_key')!.slice(4, -1).split(',')
      const after = params.getAll('lesson_key')
        .find((value) => value.startsWith('gt.'))?.slice(3)

      if (malformedProgressContainer5A === 'first' && !after)
        return reply({})
      if (malformedProgressContainer5A === 'later' && after)
        return reply({})
      if (malformedProgressRow5A && !after)
        return reply([{
          lesson_key: keys[0],
          position_seconds: 1,
          duration_seconds: 100,
          client_updated_at: '2026-08-01T00:00:00.000Z',
        }])

      if (failKey5A && keys.includes(failKey5A))
        return reply({ code: 'XX000', message: 'batch failed' }, 500)
      if (corruptProgress5A) return reply([progress5A(uuid5A(9999))])

      return reply(cloudRows5A
        .filter((row) =>
          keys.includes(row.lesson_key) &&
          (!after || row.lesson_key > after))
        .slice(0, 7))
    }
    assert.ok(url.pathname.endsWith('/study_path_enrollments'))

    if (malformedEnrollmentContainer5A) return reply({})
    if (malformedEnrollmentRow5A) return reply([{
      ...active5A,
      state: 'invalid-state',
    }])

    const pathId = params.get('path_id')?.slice(3)
    const exact = params.get('id')?.startsWith('eq.') ? params.get('id')!.slice(3) : undefined
    const after = params.get('id')?.startsWith('gt.') ? params.get('id')!.slice(3) : undefined
    return reply([active5A, history5A, otherPath5A]
      .filter((row) => row.path_id === pathId && (!exact || row.id === exact) && (!after || row.id > after))
      .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 1))
  } },
})
const service5A = createStudentStudyPathCloud(() => testClient5A)
assert.deepEqual(await service5A.readProgress([]), [])
assert.equal(requests5A.length, 0)
assert.deepEqual(await service5A.readProgress([...cloudKeys5A, ...cloudKeys5A]), cloudRows5A)
assert.ok(requests5A.length > 3)
assert.equal(new Set(requests5A.map(({ url }) => url.searchParams.get('lesson_key'))).size, 3)
for (const { url, method } of requests5A) {
  assert.equal(method, 'GET')
  assert.ok(url.searchParams.get('lesson_key')!.slice(4, -1).split(',').length <= 100)
  assert.equal(url.searchParams.get('order'), 'lesson_key.asc')
}
failKey5A = cloudKeys5A[200]
await assert.rejects(service5A.readProgress(cloudKeys5A), (error: unknown) =>
  error instanceof StudentStudyPathCloudError && error.operation === 'read-progress')
failKey5A = undefined
corruptProgress5A = true
await assert.rejects(service5A.readProgress(cloudKeys5A), StudentStudyPathCloudError)
corruptProgress5A = false

malformedProgressContainer5A = 'first'
await assert.rejects(
  service5A.readProgress([cloudKeys5A[1]]),
  (error: unknown) =>
    error instanceof StudentStudyPathCloudError &&
    error.operation === 'read-progress' &&
    error.kind === 'response',
)
malformedProgressContainer5A = 'none'

malformedProgressContainer5A = 'later'
await assert.rejects(
  service5A.readProgress(cloudKeys5A.slice(0, 20)),
  (error: unknown) =>
    error instanceof StudentStudyPathCloudError &&
    error.operation === 'read-progress' &&
    error.kind === 'response',
)
malformedProgressContainer5A = 'none'

malformedProgressRow5A = true
await assert.rejects(
  service5A.readProgress([cloudKeys5A[1]]),
  (error: unknown) =>
    error instanceof StudentStudyPathCloudError &&
    error.operation === 'read-progress' &&
    error.kind === 'response',
)
malformedProgressRow5A = false

await assert.rejects(service5A.readProgress(['invalid']), StudentStudyPathCloudError)
assert.deepEqual(await service5A.readProgress([uuid5A(5000)]), [])
assert.deepEqual(await service5A.readEnrollments(pathId5A), [active5A, history5A])
assert.deepEqual(await service5A.readEnrollment(pathId5A, active5A.id), active5A)
assert.equal(await service5A.readEnrollment(pathId5A, otherPath5A.id), null)

malformedEnrollmentContainer5A = true
await assert.rejects(
  service5A.readEnrollments(pathId5A),
  (error: unknown) =>
    error instanceof StudentStudyPathCloudError &&
    error.kind === 'response',
)
malformedEnrollmentContainer5A = false

malformedEnrollmentRow5A = true
await assert.rejects(
  service5A.readEnrollment(pathId5A, active5A.id),
  (error: unknown) =>
    error instanceof StudentStudyPathCloudError &&
    error.kind === 'response',
)
malformedEnrollmentRow5A = false

requests5A.length = 0
assert.deepEqual(await service5A.enroll(pathId5A, 1), active5A)
await service5A.pause(active5A.id)
await service5A.resume(active5A.id)
await service5A.withdraw(active5A.id)
assert.deepEqual(await service5A.upgrade(active5A.id, 2), targetEnrollment5A)
assert.deepEqual(requests5A.map(({ url, body }) => [url.pathname.split('/').pop(), body]), [
  ['enroll_study_path', { p_path_id: pathId5A, p_path_version: 1 }],
  ['pause_study_path_enrollment', { p_enrollment_id: active5A.id }],
  ['resume_study_path_enrollment', { p_enrollment_id: active5A.id }],
  ['withdraw_study_path_enrollment', { p_enrollment_id: active5A.id }],
  ['upgrade_study_path_enrollment', { p_enrollment_id: active5A.id, p_target_path_version: 2 }],
])
assert.ok(requests5A.every(({ method }) => method === 'POST'))

malformedRpcResult5A = true
await assert.rejects(
  service5A.enroll(pathId5A, 1),
  (error: unknown) =>
    error instanceof StudentStudyPathCloudError &&
    error.kind === 'response' &&
    error.operation === 'enroll_study_path',
)
await assert.rejects(
  service5A.pause(active5A.id),
  (error: unknown) =>
    error instanceof StudentStudyPathCloudError &&
    error.kind === 'response' &&
    error.operation === 'pause_study_path_enrollment',
)
await assert.rejects(
  service5A.resume(active5A.id),
  (error: unknown) =>
    error instanceof StudentStudyPathCloudError &&
    error.kind === 'response' &&
    error.operation === 'resume_study_path_enrollment',
)
await assert.rejects(
  service5A.withdraw(active5A.id),
  (error: unknown) =>
    error instanceof StudentStudyPathCloudError &&
    error.kind === 'response' &&
    error.operation === 'withdraw_study_path_enrollment',
)
await assert.rejects(
  service5A.upgrade(active5A.id, 2),
  (error: unknown) =>
    error instanceof StudentStudyPathCloudError &&
    error.kind === 'response' &&
    error.operation === 'upgrade_study_path_enrollment',
)
malformedRpcResult5A = false

failRpc5A = true
const beforeFailure5A = requests5A.length
await assert.rejects(service5A.pause(active5A.id), (error: unknown) => {
  assert.ok(error instanceof StudentStudyPathCloudError)
  assert.equal(error.message, 'Study path pause_study_path_enrollment failed')
  assert.deepEqual(error.cause, { code: '22023', message: 'private SQL detail', details: 'detail', hint: 'hint' })
  return true
})
assert.equal(requests5A.length, beforeFailure5A + 1) // No blind mutation retries.
failRpc5A = false
nullRpc5A = true
await assert.rejects(service5A.resume(active5A.id), (error: unknown) =>
  error instanceof StudentStudyPathCloudError && error.kind === 'response')
nullRpc5A = false
networkRpc5A = true
const beforeNetworkFailure5A = requests5A.length
await assert.rejects(service5A.withdraw(active5A.id), StudentStudyPathCloudError)
assert.equal(requests5A.length, beforeNetworkFailure5A + 1)
const throwingService5A = createStudentStudyPathCloud(() => { throw new Error('configuration unavailable') })
await assert.rejects(throwingService5A.enroll(pathId5A, 1), StudentStudyPathCloudError)
for (const filename of ['student-study-path.ts', 'student-study-path-cloud.ts']) {
  const source = readFileSync(new URL(`../src/lib/${filename}`, import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/)
  assert.doesNotMatch(source, /localStorage|sessionStorage|merge_lesson_progress['"]\s*,|youtube|telegram|providerId|corpusId/i)
}
assert.deepEqual(publicStudyPaths, [])

// Slice 5B: private route props, read-only rendering and auth/read race boundaries.
const { observeStudentStudyPath, studentStudyPathPageProps, StudentStudyPathView } =
  await import('../src/islands/StudentStudyPath.tsx')
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
type State5B = import('../src/islands/StudentStudyPath.tsx').StudentStudyPathState
type Auth5B = Parameters<typeof observeStudentStudyPath>[1]
const page5B = studentStudyPathPageProps(publicFixturePath)
assert.deepEqual(page5B.path.versions.map((v) => v.version), publicFixturePath.versions.map((v) => v.version))
assert.deepEqual(validateStudyPathDefinition(page5B.path, (await import('../src/lib/data.ts')).lessonRegistry), page5B.path)
assert.ok(page5B.metadata.every((item) => Object.keys(item).sort().join(',') === 'href,lessonKey,title'))
assert.ok(page5B.metadata.every((item) => /^\/v\/[^/]+\/$/.test(item.href)))
assert.doesNotMatch(JSON.stringify(page5B.path), /youtube|telegram|corpus|provider|"href"/i)
assert.throws(() => studentStudyPathPageProps({ ...publicFixturePath, status: 'draft' }), /published/)
assert.throws(() => studentStudyPathPageProps({ ...publicFixturePath, status: 'retired' }), /published/)
const shell5B = readFileSync(new URL('../src/pages/student/study-paths/[slug].astro', import.meta.url), 'utf8')
assert.match(shell5B, /publicStudyPaths\.map/)
assert.match(shell5B, /studentStudyPathPageProps\(path\)/)
assert.match(shell5B, /noindex/)
assert.match(shell5B, /client:load/)
assert.doesNotMatch(shell5B, /supabase|process\.env|import\.meta\.env|prerender\s*=\s*false/)
const source5B = readFileSync(new URL('../src/islands/StudentStudyPath.tsx', import.meta.url), 'utf8')
for (const event of ['pageshow', 'focus']) {
  assert.ok(source5B.includes(`addEventListener('${event}', refresh)`))
  assert.ok(source5B.includes(`removeEventListener('${event}', refresh)`))
}
assert.doesNotMatch(source5B, /localStorage|sessionStorage|service_role|\.(from|rpc|insert|update|delete|upsert|upgrade)\s*\(/)

const props5B = { path: path5A, metadata: display5A }
let state5B: State5B = { status: 'authenticating' }
let sessionUser5B: string | null = active5A.user_id
let verifiedUser5B: string | null = active5A.user_id
let authFailure5B = false
let enrollFailure5B = false
let progressFailure5B = false
let enrollRows5B = [active5A]
let progressRows5B = [progress5A(lessonKeys5A[0], true)]
const calls5B: string[] = []
let event5B: (event: string) => void = () => {}
let unsubscribed5B = false
const auth5B = {
  getSession: async () => {
    calls5B.push('session')
    if (authFailure5B) throw new Error('offline')
    return { data: { session: sessionUser5B ? { user: { id: sessionUser5B } } : null }, error: null }
  },
  getUser: async () => {
    calls5B.push('user')
    return { data: { user: verifiedUser5B ? { id: verifiedUser5B } : null }, error: null }
  },
  onAuthStateChange: (callback: typeof event5B) => {
    event5B = callback
    return { data: { subscription: { unsubscribe: () => { unsubscribed5B = true } } } }
  },
} as unknown as Auth5B
let readEnrollment5B = async (_pathId: string): Promise<Enrollment5A[]> => enrollRows5B
let readProgress5B = async (_keys: readonly string[]): Promise<StudentProgressRow[]> => progressRows5B
const cloud5B = {
  readEnrollments: async (pathId: string) => {
    calls5B.push('enrollments')
    assert.equal(pathId, pathId5A)
    if (enrollFailure5B) throw new Error('read failed')
    return readEnrollment5B(pathId)
  },
  readProgress: async (keys: readonly string[]) => {
    calls5B.push('progress')
    assert.deepEqual(keys, lessonKeys5A.slice(0, 2)) // Pinned v1, never current v2.
    if (progressFailure5B) throw new Error('partial read failed')
    return readProgress5B(keys)
  },
}
let onLoaded5B: (() => void) | undefined
const observer5B = observeStudentStudyPath(props5B, auth5B, (state) => {
  state5B = state
  if (state.status === 'loaded') onLoaded5B?.()
}, cloud5B)
const loaded5B = () => {
  assert.equal(state5B.status, 'loaded')
  return state5B as Extract<State5B, { status: 'loaded' }>
}
await observer5B.refresh()
assert.equal(loaded5B().study.progress.percentage, 50)
assert.equal(loaded5B().study.version.version, 1)
assert.equal(loaded5B().study.continueLesson?.lessonKey, lessonKeys5A[1])
calls5B.length = 0
await observer5B.refresh()
assert.deepEqual(calls5B, ['session', 'user', 'enrollments', 'progress'])
for (const failure of ['session', 'user', 'owner-mismatch', 'enrollment', 'progress', 'multiple-live', 'other-path', 'other-owner', 'missing-version'] as const) {
  authFailure5B = failure === 'session'
  verifiedUser5B = failure === 'user' ? null : failure === 'owner-mismatch' ? uuid5A(99) : active5A.user_id
  enrollFailure5B = failure === 'enrollment'
  progressFailure5B = failure === 'progress'
  enrollRows5B = failure === 'multiple-live' ? [active5A, enrollment5A({ id: uuid5A(99), path_version: 2 })]
    : failure === 'other-path' ? [otherPath5A]
    : failure === 'other-owner' ? [enrollment5A({ user_id: uuid5A(99) })]
    : failure === 'missing-version' ? [enrollment5A({ path_version: 99 })] : [active5A]
  calls5B.length = 0
  await observer5B.refresh()
  assert.equal(state5B.status, ['session', 'user', 'owner-mismatch'].includes(failure) ? 'auth-error'
    : failure === 'enrollment' ? 'enrollment-error' : failure === 'progress' ? 'progress-error'
    : failure === 'missing-version' ? 'unavailable-version' : 'corrupt-enrollment')
  if (failure !== 'progress') assert.ok(!calls5B.includes('progress'))
}
authFailure5B = enrollFailure5B = progressFailure5B = false
verifiedUser5B = active5A.user_id
sessionUser5B = null
calls5B.length = 0
await observer5B.refresh()
assert.equal(state5B.status, 'signed-out')
assert.deepEqual(calls5B, ['session'])
sessionUser5B = active5A.user_id
for (const rows of [[], [history5A]]) {
  enrollRows5B = rows
  calls5B.length = 0
  await observer5B.refresh()
  assert.equal(state5B.status, 'empty')
  assert.ok(!calls5B.includes('progress'))
}
enrollRows5B = [enrollment5A({ state: 'paused' })]
await observer5B.refresh()
assert.equal(loaded5B().study.continueLesson, null)
assert.equal(loaded5B().study.progress.percentage, 50)
enrollRows5B = [active5A]
progressRows5B = []
await observer5B.refresh()
assert.equal(loaded5B().study.progress.percentage, 0)
progressRows5B = lessonKeys5A.slice(0, 2).map((key) => progress5A(key, true))
await observer5B.refresh()
assert.equal(loaded5B().study.progress.percentage, 100)
assert.equal(loaded5B().enrollment.state, 'active')
assert.equal(loaded5B().study.continueLesson, null)

const deferred5B = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
// Account changes/sign-out invalidate pending enrollment and progress reads immediately.
for (const stage of ['enrollment', 'progress'] as const) {
  const reached = deferred5B<void>()
  const pendingEnrollment = deferred5B<Enrollment5A[]>()
  const pendingProgress = deferred5B<StudentProgressRow[]>()
  readEnrollment5B = stage === 'enrollment' ? async () => { reached.resolve(); return pendingEnrollment.promise } : async () => enrollRows5B
  readProgress5B = async () => { reached.resolve(); return pendingProgress.promise }
  const oldRead = observer5B.refresh()
  await reached.promise
  event5B('SIGNED_OUT')
  assert.equal(state5B.status, 'signed-out')
  pendingEnrollment.resolve([active5A])
  pendingProgress.resolve(progressRows5B)
  await oldRead
  assert.equal(state5B.status, 'signed-out')
}
readEnrollment5B = async () => enrollRows5B
readProgress5B = async () => progressRows5B
sessionUser5B = verifiedUser5B = uuid5A(99)
enrollRows5B = [enrollment5A({ user_id: uuid5A(99) })]
const accountReload5B = deferred5B<void>()
onLoaded5B = accountReload5B.resolve
event5B('SIGNED_IN')
assert.equal(state5B.status, 'authenticating')
await accountReload5B.promise
onLoaded5B = undefined
assert.equal(loaded5B().enrollment.user_id, uuid5A(99))
progressRows5B = []
const refreshed5B = observer5B.refresh()
assert.equal(state5B.status, 'authenticating')
await refreshed5B
assert.equal(loaded5B().study.progress.percentage, 0)
// A newer successful refresh also wins over an older request that completes later.
const olderReached5B = deferred5B<void>()
const olderResult5B = deferred5B<StudentProgressRow[]>()
readProgress5B = async () => { olderReached5B.resolve(); return olderResult5B.promise }
const olderRead5B = observer5B.refresh()
await olderReached5B.promise
readProgress5B = async () => progressRows5B
await observer5B.refresh()
const newerState5B = state5B
olderResult5B.resolve([progress5A(lessonKeys5A[0], true)])
await olderRead5B
assert.equal(state5B, newerState5B)

const disposeReached5B = deferred5B<void>()
const disposeResult5B = deferred5B<StudentProgressRow[]>()
readProgress5B = async () => { disposeReached5B.resolve(); return disposeResult5B.promise }
const disposedRead5B = observer5B.refresh()
await disposeReached5B.promise
observer5B.dispose()
const disposedState5B = state5B
disposeResult5B.resolve(progressRows5B)
await disposedRead5B
assert.equal(state5B, disposedState5B)
assert.ok(unsubscribed5B)
const finalState5B = state5B
await observer5B.refresh()
assert.equal(state5B, finalState5B)

const render5B = (state: State5B) => renderToStaticMarkup(createElement(StudentStudyPathView, {
  ...props5B, state, retry: () => {},
}))
for (const status of ['authenticating', 'signed-out', 'empty', 'auth-error', 'enrollment-error', 'progress-error', 'unavailable-version', 'corrupt-enrollment'] as const) {
  assert.doesNotMatch(render5B({ status }), /<progress|0%|تابع المسار/)
}
for (const state of ['active', 'paused', 'withdrawn', 'superseded'] as const) {
  const enrollment = enrollment5A({ state })
  const study = deriveStudentStudyPath(path5A, enrollment, [progress5A(lessonKeys5A[0], true)], display5A)
  const html = render5B({ status: 'loaded', enrollment, study })
  assert.match(html, /50%/)
  assert.match(html, /dir="rtl"/)
  // The lesson list preserves curriculum order even when Continue duplicates a title above it.
  assert.ok(html.lastIndexOf('Lesson 0') < html.lastIndexOf('Lesson 1'))
  assert.match(html, /href="\/lessons\/test-0\/"/)
  assert.match(html, /غير مكتمل/)
  if (state === 'active') assert.match(html, /تابع المسار/)
  else assert.doesNotMatch(html, /تابع المسار/)
}

// Slice 5C: lifecycle dispatch, confirmation and authoritative reconciliation (no hosted I/O).
const { StudentStudyPathActions } = await import('../src/islands/StudentStudyPath.tsx')
type Action5C = import('../src/islands/StudentStudyPath.tsx').StudentStudyPathAction
const active5C = enrollment5A({ path_version: 2 })
function harness5C(initialRows: Enrollment5A[] = [active5C]) {
  let userId: string | null = active5C.user_id
  let state: State5B = { status: 'authenticating' }
  let onAuth: (event: string, session: { user: { id: string } } | null) => void = () => {}
  const h = {
    rows: structuredClone(initialRows),
    progress: [progress5A(lessonKeys5A[1], true)],
    calls: [] as { action: Action5C; args: (string | number)[] }[],
    events: [] as string[],
    states: [] as State5B[],
    beforeRead: async () => {},
    beforeProgress: async () => {},
    mutate: async (_action: Action5C, _args: (string | number)[]) => {},
    apply(action: Action5C, args: (string | number)[]) {
      if (action === 'enroll') {
        h.rows.push(enrollment5A({ id: uuid5A(120), user_id: userId!, path_version: Number(args[1]) }))
      } else {
        h.rows = h.rows.map((row) => row.id !== args[0] ? row : {
          ...row, state: action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'withdrawn',
        })
      }
    },
    state: () => state,
    authEvent(event: string, owner: string | null = userId) {
      userId = owner
      onAuth(event, userId ? { user: { id: userId } } : null)
    },
    setOwner(owner: string | null) { userId = owner },
  }
  h.mutate = async (action, args) => h.apply(action, args)
  const auth = {
    getSession: async () => {
      h.events.push('session')
      return { data: { session: userId ? { user: { id: userId } } : null }, error: null }
    },
    getUser: async () => {
      h.events.push('user')
      return { data: { user: userId ? { id: userId } : null }, error: null }
    },
    onAuthStateChange: (callback: typeof onAuth) => {
      onAuth = callback
      return { data: { subscription: { unsubscribe() {} } } }
    },
  } as unknown as Auth5B
  const cloud = {
    readEnrollments: async (pathId: string) => {
      h.events.push('enrollment-read')
      await h.beforeRead()
      return structuredClone(h.rows.filter((row) => row.path_id === pathId && row.user_id === userId))
    },
    readProgress: async (keys: readonly string[]) => {
      h.events.push('progress-read')
      await h.beforeProgress()
      return structuredClone(h.progress.filter((row) => keys.includes(row.lesson_key)))
    },
  }
  const dispatch = async (action: Action5C, ...args: (string | number)[]) => {
    h.events.push(`rpc:${action}`)
    h.calls.push({ action, args })
    await h.mutate(action, args)
    // Intentionally untrustworthy response: only the subsequent owner-visible read matters.
    return enrollment5A({ user_id: uuid5A(999), state: 'withdrawn', path_version: 99 })
  }
  const reader = observeStudentStudyPath(props5B, auth, (next) => {
    state = next
    h.states.push(next)
  }, cloud, {
    enroll: (id, version) => dispatch('enroll', id, version),
    pause: (id) => dispatch('pause', id),
    resume: (id) => dispatch('resume', id),
    withdraw: (id) => dispatch('withdraw', id),
  })
  return { reader, h }
}
const loaded5C = (h: ReturnType<typeof harness5C>['h']) => {
  const state = h.state()
  assert.equal(state.status, 'loaded')
  return state as Extract<State5B, { status: 'loaded' }>
}
const renderActions5C = (state: State5B) => renderToStaticMarkup(createElement(StudentStudyPathActions, {
  state, retry() {}, onAction() {}, onConfirmWithdrawal() {}, onCancelWithdrawal() {},
}))

// Only the built current version is offered. RPC success alone cannot manufacture a view.
{
  const { h, reader } = harness5C([])
  await reader.refresh()
  assert.equal(h.state().status, 'empty')
  assert.equal(h.state().eligibility?.allowed, true)
  assert.match(renderActions5C(h.state()), /التسجيل في الإصدار الحالي/)
  h.events.length = 0
  await reader.act('enroll')
  assert.deepEqual(h.calls, [{ action: 'enroll', args: [path5A.pathId, path5A.currentVersion] }])
  assert.deepEqual(h.events, ['session', 'user', 'enrollment-read', 'rpc:enroll', 'session', 'user', 'enrollment-read', 'progress-read'])
  assert.equal(loaded5C(h).enrollment.path_version, 2)
  assert.equal(loaded5C(h).enrollment.user_id, active5C.user_id)
  assert.equal(loaded5C(h).study.progress.percentage, 50)
  assert.equal(h.state().mutation, undefined)
  reader.dispose()
}
for (const state of ['active', 'paused', 'withdrawn', 'superseded'] as const) {
  const enrollment = { ...active5C, state }
  const html = renderActions5C({ status: 'loaded', enrollment,
    study: deriveStudentStudyPath(path5A, enrollment, [], display5A) })
  assert.equal(html.includes('إيقاف مؤقت'), state === 'active')
  assert.equal(html.includes('استئناف المسار'), state === 'paused')
  assert.equal(html.includes('الانسحاب من المسار'), state === 'active' || state === 'paused')
  const { h, reader } = harness5C([enrollment])
  await reader.refresh()
  if (state === 'active' || state === 'paused') {
    await reader.act(state === 'active' ? 'resume' : 'pause')
    assert.equal(h.calls.length, 0)
    await reader.act(state === 'active' ? 'pause' : 'resume')
    assert.equal(h.calls.length, 1)
    assert.equal(loaded5C(h).enrollment.state, state === 'active' ? 'paused' : 'active')
  } else {
    assert.equal(h.state().status, 'empty')
    assert.deepEqual(h.state().eligibility, { allowed: false, reason: 'terminal-version' })
    assert.doesNotMatch(renderActions5C(h.state()), /<button/)
    for (const action of ['enroll', 'pause', 'resume', 'withdraw'] as const) await reader.act(action)
    await reader.confirmWithdrawal()
    assert.equal(h.calls.length, 0)
  }
  reader.dispose()
}
// A terminal older version doesn't block fresh enrollment into an eligible current version.
{
  const { h, reader } = harness5C([enrollment5A({ state: 'withdrawn', path_version: 1 })])
  await reader.refresh()
  assert.equal(h.state().eligibility?.allowed, true)
  await reader.act('enroll')
  assert.equal(loaded5C(h).enrollment.path_version, 2)
  assert.equal(h.calls.length, 1)
  reader.dispose()
}
for (const state of ['active', 'paused'] as const) {
  const { h, reader } = harness5C([{ ...active5C, state }])
  await reader.refresh()
  const progressBefore = JSON.stringify(h.progress)
  await reader.confirmWithdrawal() // No invisible bypass of the confirmation gate.
  assert.equal(h.calls.length, 0)
  await reader.act('withdraw')
  assert.equal(h.calls.length, 0)
  assert.equal(h.state().confirmWithdraw, true)
  assert.match(renderActions5C(h.state()), /تأكيد الانسحاب/)
  reader.cancelWithdrawal()
  await reader.confirmWithdrawal()
  assert.equal(h.calls.length, 0)
  await reader.act('withdraw')
  await Promise.all([reader.confirmWithdrawal(), reader.confirmWithdrawal(), reader.act('pause')])
  assert.deepEqual(h.calls, [{ action: 'withdraw', args: [active5C.id] }])
  assert.equal(h.state().status, 'empty')
  assert.deepEqual(h.state().eligibility, { allowed: false, reason: 'terminal-version' })
  assert.equal(JSON.stringify(h.progress), progressBefore)
  assert.equal(h.rows[0].state, 'withdrawn')
  reader.dispose()
}
// Delay the post-RPC read: no assumed paused/empty/0% view may appear before it completes.
{
  const { h, reader } = harness5C()
  await reader.refresh()
  const reached = deferred5B<void>()
  const release = deferred5B<void>()
  h.beforeRead = async () => {
    if (h.calls.length) { reached.resolve(); await release.promise }
  }
  const action = reader.act('pause')
  assert.equal(h.state().actionBusy, true)
  await reached.promise
  assert.equal(h.state().status, 'loading')
  assert.equal(h.state().mutation?.status, 'reconciling')
  assert.doesNotMatch(render5B(h.state()), /<progress|0%/)
  await reader.act('withdraw')
  await reader.act('enroll')
  assert.equal(h.calls.length, 1)
  release.resolve()
  await action
  assert.equal(loaded5C(h).enrollment.state, 'paused')
  assert.equal(h.state().actionBusy, false)
  reader.dispose()
}
// Success with an unchanged read is also unconfirmed. A network failure may have committed.
for (const outcome of ['success-unchanged', 'error-unchanged', 'error-changed'] as const) {
  const { h, reader } = harness5C()
  await reader.refresh()
  h.mutate = async (action, args) => {
    if (outcome === 'error-changed') h.apply(action, args)
    if (outcome !== 'success-unchanged') throw new Error('response lost')
  }
  await reader.act('pause')
  assert.equal(h.calls.length, 1)
  assert.equal(loaded5C(h).enrollment.state, outcome === 'error-changed' ? 'paused' : 'active')
  assert.equal(h.state().mutation?.status, outcome === 'error-changed' ? undefined : 'error')
  assert.equal(loaded5C(h).study.progress.percentage, 50)
  await reader.refresh() // The error's retry handler only re-reads; never replays the RPC.
  assert.equal(h.calls.length, 1)
  assert.equal(h.state().mutation?.status, outcome === 'error-changed' ? undefined : 'error')
  reader.dispose()
}
for (const failure of ['enrollment', 'progress'] as const) {
  const { h, reader } = harness5C()
  await reader.refresh()
  const failAfterRpc = async () => { if (h.calls.length) throw new Error('read failed') }
  if (failure === 'enrollment') h.beforeRead = failAfterRpc
  else h.beforeProgress = failAfterRpc
  await reader.act('pause')
  assert.equal(h.state().status, failure === 'enrollment' ? 'enrollment-error' : 'progress-error')
  if (failure === 'enrollment') assert.equal(h.state().mutation?.status, 'error')
  assert.doesNotMatch(render5B(h.state()), /<progress|0%/)
  h.beforeRead = h.beforeProgress = async () => {}
  await reader.refresh()
  assert.equal(loaded5C(h).enrollment.state, 'paused')
  assert.equal(h.state().mutation, undefined)
  assert.equal(h.calls.length, 1)
  reader.dispose()
}
// The lock is acquired before any await, including the preflight read.
{
  const { h, reader } = harness5C()
  await reader.refresh()
  await Promise.all([reader.act('pause'), reader.act('pause'), reader.act('withdraw'), reader.act('resume')])
  assert.deepEqual(h.calls, [{ action: 'pause', args: [active5C.id] }])
  reader.dispose()
}
for (const interruption of ['signout', 'account-change', 'dispose', 'newer-refresh'] as const) {
  const { h, reader } = harness5C()
  await reader.refresh()
  const reached = deferred5B<void>()
  const release = deferred5B<void>()
  h.mutate = async () => { reached.resolve(); await release.promise }
  const action = reader.act('pause')
  await reached.promise
  const pendingButtons = renderActions5C(h.state()).match(/<button\b[^>]*>/g) ?? []
  assert.equal(pendingButtons.length, 2)
  assert.ok(pendingButtons.every((tag) => tag.includes('disabled=""')))
  if (interruption === 'signout') h.authEvent('SIGNED_OUT', null)
  if (interruption === 'account-change') {
    h.authEvent('SIGNED_IN', uuid5A(555))
    await reader.refresh()
    assert.equal(h.state().status, 'empty')
    await reader.act('enroll') // Old account's outstanding RPC still owns the lock.
    assert.equal(h.calls.length, 1)
  }
  if (interruption === 'dispose') reader.dispose()
  if (interruption === 'newer-refresh') {
    h.rows = [{ ...active5C, state: 'paused' }]
    await reader.refresh()
    assert.equal(loaded5C(h).enrollment.state, 'paused')
  }
  const publications = h.states.length
  release.resolve()
  await action
  if (interruption === 'signout') assert.equal(h.state().status, 'signed-out')
  if (interruption === 'account-change') {
    assert.equal(h.state().status, 'empty')
    assert.equal(h.state().mutation, undefined)
  }
  if (interruption === 'dispose') assert.equal(h.states.length, publications)
  if (interruption === 'newer-refresh') {
    assert.equal(loaded5C(h).enrollment.state, 'paused')
    assert.equal(h.state().mutation, undefined)
  }
  assert.equal(h.calls.length, 1)
  reader.dispose()
}
// Confirmation never carries over to a new read/account; preflight cannot retarget an intent.
for (const change of ['refresh-confirmation', 'silent-account-change', 'different-enrollment'] as const) {
  const { h, reader } = harness5C()
  await reader.refresh()
  if (change === 'refresh-confirmation') {
    await reader.act('withdraw')
    await reader.refresh()
    await reader.confirmWithdrawal()
  } else {
    if (change === 'silent-account-change') h.setOwner(uuid5A(555))
    else h.rows = [{ ...active5C, id: uuid5A(556) }]
    await reader.act('pause')
  }
  assert.equal(h.calls.length, 0)
  reader.dispose()
}
const entry5C = readFileSync(new URL('../src/components/StudyPathVersion.astro', import.meta.url), 'utf8')
assert.ok(entry5C.includes('href={`/student/study-paths/${path.slug}/`}'))
assert.match(entry5C, /التسجيل أو عرض مسارك/)
assert.doesNotMatch(entry5C, /supabase|student-study-path-cloud|client:load/)
// Same-account token refresh/focus sign-in must not discard an uncertain operation.
for (const event of ['TOKEN_REFRESHED', 'SIGNED_IN']) {
  const { h, reader } = harness5C()
  await reader.refresh()
  const reached = deferred5B<void>()
  const release = deferred5B<void>()
  h.mutate = async () => { reached.resolve(); await release.promise; throw new Error('response lost') }
  const action = reader.act('pause')
  await reached.promise
  h.authEvent(event)
  await reader.refresh()
  assert.equal(h.state().mutation?.status, 'pending')
  release.resolve()
  await action
  assert.equal(loaded5C(h).enrollment.state, 'active')
  assert.equal(h.state().mutation?.status, 'error')
  assert.equal(h.calls.length, 1)
  reader.dispose()
}
{
  const { h, reader } = harness5C()
  h.progress = lessonKeys5A.map((key) => progress5A(key, true))
  await reader.refresh()
  assert.equal(loaded5C(h).study.completed, true)
  assert.equal(loaded5C(h).enrollment.state, 'active')
  assert.equal(h.calls.length, 0)
  reader.dispose()
}
console.log('selfcheck ok')
