import { useEffect, useState } from 'react'
import type { PublicStudyPath } from '../lib/public-study-paths'
import type { StudyPathDefinition } from '../lib/study-paths'
import {
  deriveStudentStudyPath,
  resolveStudentStudyPathVersions,
  selectStudyPathEnrollment,
  type StudyPathLessonDisplay,
} from '../lib/student-study-path'
import { studentStudyPathCloud } from '../lib/student-study-path-cloud'
import { supabase, type StudyPathEnrollmentRow } from '../lib/supabase'

type Props = {
  path: StudyPathDefinition
  metadata: readonly StudyPathLessonDisplay[]
}

/** Build boundary: retain every published version, but send only canonical/display fields. */
export function studentStudyPathPageProps(source: PublicStudyPath): Props {
  if (source.status !== 'published') throw new Error('private study path must be published')
  const path: StudyPathDefinition = {
    pathId: source.pathId, slug: source.slug, title: source.title,
    description: source.description, status: source.status, currentVersion: source.currentVersion,
    versions: source.versions.map((version) => ({
      pathId: version.pathId, version: version.version, publishedAt: version.publishedAt,
      modules: version.modules.map((module) => ({
        moduleKey: module.moduleKey, title: module.title, objective: module.objective,
        position: module.position,
        lessons: module.lessons.map(({ lessonKey, position }) => ({ lessonKey, position })),
      })),
    })),
  }
  const metadata = new Map<string, StudyPathLessonDisplay>()
  for (const version of source.versions)
    for (const module of version.modules)
      for (const { lessonKey, title, href } of module.lessons)
        metadata.set(lessonKey, { lessonKey, title, href })
  return { path, metadata: [...metadata.values()] }
}

type Loaded = {
  status: 'loaded'
  enrollment: StudyPathEnrollmentRow
  study: ReturnType<typeof deriveStudentStudyPath>
}
export type StudentStudyPathState =
  | { status: 'authenticating' | 'loading' | 'signed-out' | 'empty' |
      'auth-error' | 'enrollment-error' | 'progress-error' | 'unavailable-version' | 'corrupt-enrollment' }
  | Loaded

type Auth = Pick<ReturnType<typeof supabase>['auth'], 'getSession' | 'getUser' | 'onAuthStateChange'>
type Cloud = Pick<typeof studentStudyPathCloud, 'readEnrollments' | 'readProgress'>

/** One read generation spans auth, enrollment and progress; obsolete results never publish. */
export function observeStudentStudyPath(
  { path, metadata }: Props,
  auth: Auth,
  publish: (state: StudentStudyPathState) => void,
  cloud: Cloud = studentStudyPathCloud,
) {
  let generation = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = async () => {
    if (disposed) return
    clearTimeout(timer)
    const request = ++generation
    const current = () => !disposed && request === generation
    const set = (state: StudentStudyPathState) => { if (current()) publish(state) }
    set({ status: 'authenticating' })
    let userId: string
    try {
      const { data, error } = await auth.getSession()
      if (!current()) return
      if (error) throw error
      if (!data.session) return set({ status: 'signed-out' })
      const { data: verified, error: authError } = await auth.getUser()
      if (!current()) return
      if (authError || !verified.user || verified.user.id !== data.session.user.id)
        return set({ status: 'auth-error' })
      userId = verified.user.id
    } catch {
      return set({ status: 'auth-error' })
    }
    set({ status: 'loading' })
    let rows: StudyPathEnrollmentRow[]
    try {
      rows = await cloud.readEnrollments(path.pathId)
    } catch {
      return set({ status: 'enrollment-error' })
    }
    if (!current()) return
    let enrollment: StudyPathEnrollmentRow | null
    try {
      if (rows.some((row) => row.user_id !== userId || row.path_id !== path.pathId))
        throw new Error('unexpected enrollment owner or path')
      enrollment = selectStudyPathEnrollment(rows, path.pathId)
    } catch {
      return set({ status: 'corrupt-enrollment' })
    }
    if (!enrollment) return set({ status: 'empty' })
    let keys: string[]
    try {
      const { pinned } = resolveStudentStudyPathVersions(path, enrollment)
      keys = pinned!.modules.flatMap((module) => module.lessons.map((lesson) => lesson.lessonKey))
    } catch {
      return set({ status: 'unavailable-version' })
    }
    let progress: Awaited<ReturnType<Cloud['readProgress']>>
    try {
      progress = await cloud.readProgress(keys)
    } catch {
      return set({ status: 'progress-error' })
    }
    if (!current()) return
    try {
      set({ status: 'loaded', enrollment, study: deriveStudentStudyPath(path, enrollment, progress, metadata) })
    } catch {
      // Never turn an invalid/partial response into an empty progress snapshot.
      set({ status: 'progress-error' })
    }
  }

  const { data: listener } = auth.onAuthStateChange((event) => {
    if (disposed || event === 'INITIAL_SESSION') return
    ++generation
    clearTimeout(timer)
    publish({ status: event === 'SIGNED_OUT' ? 'signed-out' : 'authenticating' })
    // Leave the Supabase auth callback/lock before calling auth methods again.
    if (event !== 'SIGNED_OUT') timer = setTimeout(() => void refresh(), 0)
  })
  void refresh()
  return {
    refresh,
    dispose() {
      disposed = true
      ++generation
      clearTimeout(timer)
      listener.subscription.unsubscribe()
    },
  }
}

const stateLabels: Record<StudyPathEnrollmentRow['state'], string> = {
  active: 'نشط', paused: 'متوقف مؤقتًا', withdrawn: 'منسحب', superseded: 'تمت ترقيته',
}
const errors = {
  'auth-error': 'تعذّر التحقق من حسابك. أعد المحاولة أو انتقل إلى تسجيل الدخول.',
  'enrollment-error': 'تعذّر تحميل تسجيلك في المسار. حاول مجددًا.',
  'progress-error': 'تعذّر تحميل تقدمك كاملًا. حاول مجددًا.',
  'unavailable-version': 'الإصدار المثبت لتسجيلك غير متاح حاليًا. لا يمكن عرض تقدمك حتى يتاح هذا الإصدار.',
  'corrupt-enrollment': 'بيانات التسجيل غير متسقة. تعذّر تحديد تسجيل واحد لهذا المسار.',
}
const button = 'inline-flex min-h-11 items-center rounded-xl border border-border-strong px-5 font-medium transition-colors hover:bg-surface-2'

export function StudentStudyPathView({ path, metadata, state, retry }: Props & {
  state: StudentStudyPathState
  retry: () => void
}) {
  if (state.status === 'authenticating' || state.status === 'loading')
    return (
      <p className="card mt-8 p-5 text-muted" role="status">
        {state.status === 'authenticating' ? 'جارٍ التحقق من حسابك…' : 'جارٍ تحميل مسارك وتقدمك…'}
      </p>
    )
  if (state.status === 'signed-out')
    return (
      <div className="card mt-8 p-5">
        <p role="status">سجّل الدخول لعرض مسارك الدراسي.</p>
        <a className={`${button} mt-4`} href="/student/login/">تسجيل الدخول</a>
      </div>
    )
  if (state.status === 'empty')
    return (
      <section className="card mt-8 p-5 sm:p-6">
        <h2 className="text-lg font-semibold">لا يوجد تسجيل نشط أو متوقف مؤقتًا في هذا المسار</h2>
        <p className="mt-2 text-muted">يمكنك تصفح المنهج والدروس من صفحة المسار العامة.</p>
        <a className={`${button} mt-4`} href={`/study-paths/${path.slug}/`}>تصفح المسار</a>
      </section>
    )
  if (state.status !== 'loaded')
    return (
      <div className="card mt-8 p-5" role="alert">
        <p className="text-red-700 dark:text-red-300">{errors[state.status]}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className={button} onClick={retry}>إعادة المحاولة</button>
          {state.status === 'auth-error' && <a className={button} href="/student/login/">تسجيل الدخول</a>}
        </div>
      </div>
    )

  const { enrollment, study } = state
  const display = new Map(metadata.map((lesson) => [lesson.lessonKey, lesson]))
  return (
    <div className="mt-8 space-y-6" dir="rtl">
      <section className="card p-5 sm:p-6" aria-labelledby="path-progress-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="path-progress-heading" className="text-lg font-semibold">تقدمك في المسار</h2>
          <span className="rounded-full bg-surface-2 px-3 py-1 text-sm">{stateLabels[enrollment.state]}</span>
        </div>
        <p className="mt-2 text-sm text-muted">الإصدار المثبت <span className="digits">{study.version.version}</span></p>
        <p className="mt-5 text-3xl font-semibold digits">{study.progress.percentage}%</p>
        <p className="mt-2 text-muted"><span className="digits">{study.progress.completedLessons}</span> من <span className="digits">{study.progress.totalLessons}</span> درس مكتمل</p>
        <progress className="mt-4 h-3 w-full accent-accent" value={study.progress.completedLessons} max={study.progress.totalLessons} aria-label="نسبة إكمال دروس المسار" />
        {study.completed && <p className="mt-4 text-accent">أكملت جميع دروس هذا الإصدار.</p>}
        {enrollment.state === 'paused' && <p className="mt-4 text-sm text-muted">تسجيلك متوقف مؤقتًا. يمكنك تصفح الدروس أدناه.</p>}
      </section>
      {study.continueLesson && (
        <section aria-labelledby="path-continue-heading">
          <h2 id="path-continue-heading" className="text-xl font-semibold">تابع المسار</h2>
          <a
            href={study.continueLesson.href}
            className="card mt-3 block min-h-11 p-5 transition-colors hover:bg-surface-2"
          >
            <span className="block break-words font-medium">{study.continueLesson.title}</span>
            <span className="mt-2 block text-sm text-muted">الدرس التالي غير المكتمل بحسب ترتيب المنهج</span>
          </a>
        </section>
      )}
      <ol className="space-y-6">
        {study.progress.modules.map((module, index) => {
          const definition = study.version.modules[index]
          return (
            <li key={module.moduleKey} className="card p-5 sm:p-6">
              <section aria-labelledby={`module-${module.moduleKey}`}>
                <p className="text-xs font-medium text-accent">
                  الوحدة <span className="digits">{module.position}</span>
                </p>
                <h2 id={`module-${module.moduleKey}`} className="mt-1 text-xl font-semibold leading-relaxed">
                  {definition.title}
                </h2>
                <p className="mt-2 leading-loose text-muted">{definition.objective}</p>
                <p className="mt-2 text-sm text-muted">
                  <span className="digits">{module.completedLessons} / {module.totalLessons}</span> مكتمل
                </p>
                <ol className="mt-5 space-y-2">
                  {module.lessons.map((lesson) => {
                    const item = display.get(lesson.lessonKey)
                    return (
                      <li key={lesson.lessonKey} className="rounded-xl border border-border">
                        {item ? (
                          <a
                            href={item.href}
                            className="flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-surface-2"
                          >
                            <span className="digits text-sm text-muted">{lesson.position}</span>
                            <span className="min-w-0 flex-1 break-words font-medium leading-relaxed">{item.title}</span>
                            <span className="shrink-0 text-sm text-muted">{lesson.completed ? 'مكتمل' : 'غير مكتمل'}</span>
                          </a>
                        ) : (
                          <p className="p-4 text-muted">بيانات الدرس غير متاحة · {lesson.completed ? 'مكتمل' : 'غير مكتمل'}</p>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </section>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export default function StudentStudyPath(props: Props) {
  const [state, setState] = useState<StudentStudyPathState>({ status: 'authenticating' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let observer: ReturnType<typeof observeStudentStudyPath>
    try {
      observer = observeStudentStudyPath(props, supabase().auth, setState)
    } catch {
      setState({ status: 'auth-error' })
      return
    }
    const refresh = () => { void observer.refresh() }
    window.addEventListener('pageshow', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      observer.dispose()
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [props.path, props.metadata, attempt])
  useEffect(() => {
    if (state.status === 'signed-out') location.replace('/student/login/')
  }, [state.status])
  return <StudentStudyPathView {...props} state={state} retry={() => setAttempt((value) => value + 1)} />
}
