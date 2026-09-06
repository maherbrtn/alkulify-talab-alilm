import { useEffect, useRef, useState } from 'react'
import type { PublicStudyPath } from '../lib/public-study-paths'
import type { StudyPathDefinition } from '../lib/study-paths'
import {
  deriveStudentStudyPath,
  freshStudyPathEnrollmentEligibility,
  studyPathEnrollmentActions,
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
export type StudentStudyPathAction = 'enroll' | 'pause' | 'resume' | 'withdraw'

export type StudentStudyPathState = (
  | { status: 'authenticating' | 'loading' | 'signed-out' | 'empty' |
      'auth-error' | 'enrollment-error' | 'progress-error' | 'unavailable-version' | 'corrupt-enrollment' }
  | Loaded
) & {
  eligibility?: ReturnType<typeof freshStudyPathEnrollmentEligibility>
  actionBusy?: boolean
  confirmWithdraw?: boolean
  mutation?: { action: StudentStudyPathAction; status: 'pending' | 'reconciling' | 'error' }
}

type Auth = Pick<ReturnType<typeof supabase>['auth'], 'getSession' | 'getUser' | 'onAuthStateChange'>
type Cloud = Pick<typeof studentStudyPathCloud, 'readEnrollments' | 'readProgress'>
type Mutations = Pick<typeof studentStudyPathCloud, StudentStudyPathAction>
type Snapshot = {
  userId: string
  enrollment: StudyPathEnrollmentRow | null
  eligibility: ReturnType<typeof freshStudyPathEnrollmentEligibility>
}
type Operation = {
  action: StudentStudyPathAction
  userId: string
  enrollmentId: string | null
  version: number
  phase: 'preflight' | 'rpc' | 'reconcile'
}

/** One read generation spans auth, enrollment and progress; obsolete results never publish. */
export function observeStudentStudyPath(
  { path, metadata }: Props,
  auth: Auth,
  publish: (state: StudentStudyPathState) => void,
  cloud: Cloud = studentStudyPathCloud,
  mutations: Mutations = studentStudyPathCloud,
) {
  let generation = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let view: StudentStudyPathState = { status: 'authenticating' }
  let snapshot: Snapshot | null = null
  let verifiedOwner: string | null = null
  let confirmation: Snapshot | null = null
  let operation: Operation | null = null
  // This lock survives auth changes until the outstanding action settles.
  let actionBusy = false
  const emit = (next: StudentStudyPathState) => {
    if (disposed) return
    view = {
      ...next,
      actionBusy,
      confirmWithdraw: confirmation !== null,
      mutation: operation ? {
        action: operation.action,
        status: operation.phase !== 'reconcile' ? 'pending'
          : next.status === 'authenticating' || next.status === 'loading' ? 'reconciling' : 'error',
      } : undefined,
    }
    publish(view)
  }
  const available = (action: StudentStudyPathAction, value: Snapshot) =>
    action === 'enroll' ? value.eligibility.allowed
      : !!value.enrollment && studyPathEnrollmentActions(value.enrollment.state)[action]
  const reconcile = (rows: readonly StudyPathEnrollmentRow[], userId: string) => {
    if (!operation || operation.phase !== 'reconcile' || operation.userId !== userId) return
    const { action, enrollmentId, version } = operation
    const row = rows.find((item) => action === 'enroll'
      ? item.path_version === version : item.id === enrollmentId)
    const observed = row && (action === 'enroll' ? row.state === 'active' || row.state === 'paused'
      : row.state === (action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'withdrawn'))
    if (observed) operation = null
  }
  const refresh = async () => {
    if (disposed) return
    clearTimeout(timer)
    const request = ++generation
    snapshot = null
    confirmation = null
    const current = () => !disposed && request === generation
    const set = (state: StudentStudyPathState) => { if (current()) emit(state) }
    set({ status: 'authenticating' })
    let userId: string
    try {
      const { data, error } = await auth.getSession()
      if (!current()) return
      if (error) throw error
      if (!data.session) {
        verifiedOwner = null
        operation = null
        return set({ status: 'signed-out' })
      }
      const { data: verified, error: authError } = await auth.getUser()
      if (!current()) return
      if (authError || !verified.user || verified.user.id !== data.session.user.id)
        return set({ status: 'auth-error' })
      userId = verified.user.id
      if (operation && operation.userId !== userId) operation = null
      verifiedOwner = userId
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
    let eligibility: Snapshot['eligibility']
    try {
      eligibility = freshStudyPathEnrollmentEligibility(path, rows)
    } catch {
      return set({ status: 'unavailable-version' })
    }
    reconcile(rows, userId)
    if (!enrollment) {
      snapshot = { userId, enrollment, eligibility }
      return set({ status: 'empty', eligibility })
    }
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
      const study = deriveStudentStudyPath(path, enrollment, progress, metadata)
      snapshot = { userId, enrollment, eligibility }
      set({ status: 'loaded', enrollment, study })
    } catch {
      // Never turn an invalid/partial response into an empty progress snapshot.
      set({ status: 'progress-error' })
    }
  }

  const { data: listener } = auth.onAuthStateChange((event, session) => {
    if (disposed || event === 'INITIAL_SESSION') return
    ++generation
    clearTimeout(timer)
    snapshot = null
    confirmation = null
    // Event identity only invalidates intent; getUser still verifies every subsequent read.
    if (event === 'SIGNED_OUT' || session?.user.id !== operation?.userId) operation = null
    verifiedOwner = null
    emit({ status: event === 'SIGNED_OUT' ? 'signed-out' : 'authenticating' })
    // Leave the Supabase auth callback/lock before calling auth methods again.
    if (event !== 'SIGNED_OUT') timer = setTimeout(() => void refresh(), 0)
  })
  const run = async (action: StudentStudyPathAction, source: Snapshot) => {
    if (disposed || actionBusy || !available(action, source)) return
    const intent: Operation = {
      action, userId: source.userId, enrollmentId: source.enrollment?.id ?? null,
      version: action === 'enroll' ? path.currentVersion : source.enrollment!.path_version,
      phase: 'preflight',
    }
    actionBusy = true
    operation = intent
    confirmation = null
    emit(view)
    try {
      // Verify auth and reread before dispatch, including a new explicit attempt after an error.
      await refresh()
      const fresh: Snapshot | null = snapshot
      if (disposed || operation !== intent) return
      if (!fresh || fresh.userId !== intent.userId ||
          (fresh.enrollment?.id ?? null) !== intent.enrollmentId || !available(action, fresh)) {
        operation = null
        return
      }
      intent.phase = 'rpc'
      emit(view)
      try {
        if (action === 'enroll') await mutations.enroll(path.pathId, path.currentVersion)
        else await mutations[action](intent.enrollmentId!)
      } catch {
        // A rejected request can still have committed. Never replay it or trust its payload.
      }
      if (disposed) return
      if (operation === intent) intent.phase = 'reconcile'
      // A stale result cannot publish into another account. Same-owner refreshes still reconcile.
      if (operation === intent || verifiedOwner === intent.userId) await refresh()
    } finally {
      actionBusy = false
      emit(view) // Only the latest read's view; never an RPC row or the captured source snapshot.
    }
  }
  void refresh()
  return {
    refresh,
    async act(action: StudentStudyPathAction) {
      if (disposed || actionBusy || !snapshot || !available(action, snapshot)) return
      if (action === 'withdraw') {
        confirmation = snapshot
        emit(view)
        return
      }
      await run(action, snapshot)
    },
    async confirmWithdrawal() {
      const source = confirmation
      if (!source || source !== snapshot || actionBusy) return
      await run('withdraw', source)
    },
    cancelWithdrawal() {
      confirmation = null
      emit(view)
    },
    dispose() {
      disposed = true
      snapshot = null
      operation = null
      confirmation = null
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

function StudentStudyPathContent({ path, metadata, state, retry }: Props & {
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
        <p className="mt-2 text-muted">
          {state.eligibility?.allowed ? 'يمكنك التسجيل في الإصدار الحالي ومتابعة تقدمك في دروسه.'
            : state.eligibility?.reason === 'terminal-version'
              ? 'سبق إنهاء تسجيلك في الإصدار الحالي. لا يمكن التسجيل مجددًا في الإصدار نفسه.'
              : 'التسجيل الجديد غير متاح حاليًا. يمكنك تصفح المنهج والدروس من صفحة المسار العامة.'}
        </p>
        {state.eligibility?.allowed && <p className="mt-2 text-sm text-muted">الإصدار الحالي <span className="digits">{path.currentVersion}</span></p>}
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
      {study.continueLesson && !state.actionBusy && !state.confirmWithdraw && (
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

type ViewProps = Props & {
  state: StudentStudyPathState
  retry: () => void
  onAction?: (action: StudentStudyPathAction) => void
  onConfirmWithdrawal?: () => void
  onCancelWithdrawal?: () => void
}
const actionLabels: Record<StudentStudyPathAction, string> = {
  enroll: 'التسجيل في الإصدار الحالي', pause: 'إيقاف مؤقت', resume: 'استئناف المسار', withdraw: 'الانسحاب من المسار',
}

export function StudentStudyPathActions({ state, retry, onAction, onConfirmWithdrawal, onCancelWithdrawal }: Omit<ViewProps, keyof Props>) {
  const actions: StudentStudyPathAction[] = []
  if (state.status === 'empty' && state.eligibility?.allowed) actions.push('enroll')
  if (state.status === 'loaded') {
    const allowed = studyPathEnrollmentActions(state.enrollment.state)
    for (const action of ['pause', 'resume', 'withdraw'] as const)
      if (allowed[action]) actions.push(action)
  }
  if (!actions.length && !state.mutation) return null
  return (
    <section className="card mt-8 p-5 sm:p-6" aria-label="إدارة التسجيل">
      {state.confirmWithdraw ? (
        <div role="group" aria-labelledby="withdraw-confirm-heading">
          <h2 id="withdraw-confirm-heading" className="font-semibold">تأكيد الانسحاب من المسار</h2>
          <p className="mt-2 text-muted">سيبقى تقدم دروسك محفوظًا، لكن لن تتمكن من التسجيل مجددًا في الإصدار نفسه.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={button} onClick={onCancelWithdrawal} disabled={state.actionBusy}>إلغاء</button>
            <button type="button" className={`${button} text-red-700 dark:text-red-300`} onClick={onConfirmWithdrawal} disabled={state.actionBusy}>
              تأكيد الانسحاب
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              className={`${button} disabled:cursor-wait disabled:opacity-60`}
              disabled={state.actionBusy}
              onClick={() => onAction?.(action)}
            >
              {actionLabels[action]}
            </button>
          ))}
        </div>
      )}
      {state.actionBusy && !state.mutation && <p className="mt-3 text-sm text-muted" role="status">جارٍ إنهاء الطلب السابق…</p>}
      {state.mutation && (
        <div className="mt-3" role={state.mutation.status === 'error' ? 'alert' : 'status'}>
          {state.mutation.status === 'error' ? (
            <>
              <p className="text-red-700 dark:text-red-300">تعذّر تأكيد نتيجة «{actionLabels[state.mutation.action]}». حدّث بيانات التسجيل للتحقق قبل أي محاولة جديدة.</p>
              <button type="button" className={`${button} mt-3`} disabled={state.actionBusy} onClick={retry}>تحديث بيانات التسجيل</button>
            </>
          ) : (
            <p className="text-sm text-muted">
              {state.mutation.status === 'pending' ? `جارٍ تنفيذ «${actionLabels[state.mutation.action]}»…` : 'جارٍ التحقق من حالة التسجيل…'}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

export function StudentStudyPathView(props: ViewProps) {
  return <>
    <StudentStudyPathActions {...props} />
    <StudentStudyPathContent {...props} />
  </>
}

export default function StudentStudyPath(props: Props) {
  const [state, setState] = useState<StudentStudyPathState>({ status: 'authenticating' })
  const [attempt, setAttempt] = useState(0)
  const controller = useRef<ReturnType<typeof observeStudentStudyPath> | null>(null)
  useEffect(() => {
    let observer: ReturnType<typeof observeStudentStudyPath>
    try {
      observer = observeStudentStudyPath(props, supabase().auth, setState)
    } catch {
      setState({ status: 'auth-error' })
      return
    }
    controller.current = observer
    const refresh = () => { void observer.refresh() }
    window.addEventListener('pageshow', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      observer.dispose()
      controller.current = null
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [props.path, props.metadata, attempt])
  useEffect(() => {
    if (state.status === 'signed-out') location.replace('/student/login/')
  }, [state.status])
  return <StudentStudyPathView
    {...props}
    state={state}
    retry={() => {
      if (controller.current) void controller.current.refresh()
      else setAttempt((value) => value + 1)
    }}
    onAction={(action) => { void controller.current?.act(action) }}
    onConfirmWithdrawal={() => { void controller.current?.confirmWithdrawal() }}
    onCancelWithdrawal={() => controller.current?.cancelWithdrawal()}
  />
}
