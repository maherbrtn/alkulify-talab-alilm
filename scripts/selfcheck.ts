/** `pnpm check` — the smallest thing that fails if the text plumbing breaks. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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
  { ...studyPathFixtureDraft, status: 'published' },
  registry,
)
const studyPathVersion = studyPathFixture.versions[0]
const studyPathLessonKeys = studyPathVersion.modules.flatMap((module) =>
  module.lessons.map((lesson) => lesson.lessonKey),
)
const registeredLessonKeys = new Set(registry.lessons.map((lesson) => lesson.lesson_key))

assert.equal(studyPathFixtureDraft.status, 'draft')
assert.equal(studyPathVersion.modules.length, 2)
assert.equal(studyPathLessonKeys.length, 3)
assert.ok(studyPathLessonKeys.every((lessonKey) => registeredLessonKeys.has(lessonKey)))
assert.doesNotMatch(studyPathFixtureSource, /youtube|telegram|corpus|provider/i)
assert.ok(Object.isFrozen(studyPathFixture))
assert.ok(Object.isFrozen(studyPathVersion))
assert.ok(Object.isFrozen(studyPathVersion.modules))
assert.ok(Object.isFrozen(studyPathVersion.modules[0].lessons))
assert.doesNotThrow(() => validateStudyPathVersionLessonKeys(studyPathVersion, registry))

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
  /pathId must be a UUID v4/,
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
assert.equal(partialStudyPathProgress.completedLessons, 0)
assert.equal(partialStudyPathProgress.continueLesson?.lessonKey, studyPathLessonKeys[0])
assert.equal(partialStudyPathProgress.continueLesson?.progress, partialRow)
assert.equal(partialStudyPathProgress.continueLesson?.effectiveResumeSeconds, 42.5)

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

console.log('selfcheck ok')
