import { useEffect, useRef, useState } from 'react'
import type { PublicStudyPath } from '../lib/public-study-paths'
import type { StudyPathDefinition } from '../lib/study-paths'
import { studyPathEnrollmentActions, type StudyPathLessonDisplay } from '../lib/student-study-path'
import { supabase, type StudyPathEnrollmentRow } from '../lib/supabase'
import {
  observeStudentStudyPath, type StudentStudyPathAction, type StudentStudyPathState,
} from '../lib/student-study-path-controller'
export { observeStudentStudyPath } from '../lib/student-study-path-controller'
export type { StudentStudyPathAction, StudentStudyPathState } from '../lib/student-study-path-controller'

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

const stateLabels: Record<StudyPathEnrollmentRow['state'], string> = {
  active: 'نشط', paused: 'متوقف مؤقتًا', withdrawn: 'منسحب', superseded: 'تمت ترقيته',
}
const errors = {
  'invalid-selection': 'التسجيل المطلوب غير متاح لهذا الحساب في هذا المسار. اختر تسجيلًا من السجل أدناه.',
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
        {(enrollment.state === 'withdrawn' || enrollment.state === 'superseded') && (
          <div className="mt-4 text-sm text-muted" role="status">
            <p className="font-semibold">تسجيل تاريخي — للقراءة فقط</p>
            <p>يعرض تقدم دروسك الحالي بحسب منهج هذا الإصدار المثبت، وليس لقطة للتقدم وقت إنهاء التسجيل.</p>
          </div>
        )}
        {enrollment.state === 'paused' && <p className="mt-4 text-sm text-muted">تسجيلك متوقف مؤقتًا. يمكنك تصفح الدروس أدناه.</p>}
      </section>
      {study.continueLesson && !state.actionBusy && !state.confirmWithdraw && !state.confirmUpgrade && (
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
  onConfirmUpgrade?: () => void
  onCancelUpgrade?: () => void
  onSelectEnrollment?: (enrollmentId?: string) => void
}
const actionLabels: Record<StudentStudyPathAction, string> = {
  upgrade: 'ترقية التسجيل إلى الإصدار الحالي',
  enroll: 'التسجيل في الإصدار الحالي', pause: 'إيقاف مؤقت', resume: 'استئناف المسار', withdraw: 'الانسحاب من المسار',
}

export function StudentStudyPathActions({ state, retry, onAction, onConfirmWithdrawal, onCancelWithdrawal, onConfirmUpgrade, onCancelUpgrade }: Omit<ViewProps, keyof Props>) {
  const actions: StudentStudyPathAction[] = []
  if (state.status === 'empty' && state.eligibility?.allowed) actions.push('enroll')
  if (state.status === 'loaded') {
    const allowed = studyPathEnrollmentActions(state.enrollment.state)
    for (const action of ['pause', 'resume', 'withdraw'] as const)
      if (allowed[action]) actions.push(action)
    if (allowed.upgrade && state.upgradePreview) actions.push('upgrade')
  }
  if (!actions.length && !state.mutation) return null
  return (
    <section className="card mt-8 p-5 sm:p-6" aria-label="إدارة التسجيل">
      {state.confirmUpgrade && state.upgradePreview ? (
        <div role="group" aria-labelledby="upgrade-confirm-heading">
          <h2 id="upgrade-confirm-heading" className="font-semibold">تأكيد ترقية التسجيل</h2>
          <p className="mt-2 text-muted">من الإصدار <span className="digits">{state.upgradePreview.sourceVersion}</span> إلى الإصدار <span className="digits">{state.upgradePreview.targetVersion}</span>. الترقية للأمام فقط، وسيصبح تسجيل الإصدار السابق تاريخيًا للقراءة.</p>
          <ul className="mt-3 list-inside list-disc space-y-2 text-muted">
            <li>دروس مضافة: <span className="digits">{state.upgradePreview.addedLessonKeys.length}</span></li>
            <li>دروس لم تعد ضمن المنهج الجديد: <span className="digits">{state.upgradePreview.removedLessonKeys.length}</span></li>
            <li>دروس مشتركة بين الإصدارين: <span className="digits">{state.upgradePreview.sharedLessonKeys.length}</span></li>
            <li>{state.upgradePreview.structureOrOrderChanged ? 'تغيّرت بنية الوحدات أو محتوياتها أو ترتيبها أو ترتيب الدروس.' : 'لم تتغير بنية الوحدات أو ترتيب الدروس.'}</li>
          </ul>
          <p className="mt-3">تقدمك الحالي في الإصدار الهدف: <span className="digits">{state.upgradePreview.progress.completedLessons} / {state.upgradePreview.progress.totalLessons}</span> درس مكتمل (<span className="digits">{state.upgradePreview.progress.percentage}%</span>).</p>
          <p className="mt-2 text-muted">سيُعاد حساب التقدم بحسب المنهج الجديد. يُحتسب إكمال الدروس الموجود مسبقًا، ولن يُحذف تقدم أي درس خرج من المنهج.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={button} onClick={onCancelUpgrade} disabled={state.actionBusy}>إلغاء الترقية</button>
            <button type="button" className={button} onClick={onConfirmUpgrade} disabled={state.actionBusy}>تأكيد الترقية إلى الإصدار {state.upgradePreview.targetVersion}</button>
          </div>
        </div>
      ) : state.confirmWithdraw ? (
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
              {action === 'upgrade' ? 'معاينة الترقية إلى الإصدار الحالي' : actionLabels[action]}
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

function StudentStudyPathHistory({ state, onSelectEnrollment }: ViewProps) {
  if (!state.history) return null
  const { live, historical } = state.history
  if (!live && !historical.length && state.status !== 'invalid-selection') return null
  const rows = [...(live ? [live] : []), ...historical.slice().sort((a, b) => b.path_version - a.path_version)]
  return (
    <nav className="card mt-8 p-5 sm:p-6" dir="rtl" aria-labelledby="path-history-heading">
      <h2 id="path-history-heading" className="text-lg font-semibold">سجل تسجيلاتك في هذا المسار</h2>
      <button type="button" className={`${button} mt-3`} disabled={state.actionBusy}
        aria-current={!live && state.selectedEnrollmentId === undefined ? 'page' : undefined}
        onClick={() => onSelectEnrollment?.()}>
        {live ? 'عرض التسجيل الحالي' : 'عرض حالة التسجيل في الإصدار الحالي'}
      </button>
      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li key={row.id}>
            <button type="button" className={`${button} max-w-full py-2 text-start`} disabled={state.actionBusy}
              aria-current={(state.selectedEnrollmentId === row.id ||
                (state.selectedEnrollmentId === undefined && live?.id === row.id)) ? 'page' : undefined}
              onClick={() => onSelectEnrollment?.(row.id)}>
              <span>الإصدار <span className="digits">{row.path_version}</span> · {stateLabels[row.state]}
                {row !== live && ' · تاريخي للقراءة فقط'}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function StudentStudyPathView(props: ViewProps) {
  return <>
    <StudentStudyPathActions {...props} />
    <StudentStudyPathContent {...props} />
    <StudentStudyPathHistory {...props} />
  </>
}

export default function StudentStudyPath(props: Props) {
  const [state, setState] = useState<StudentStudyPathState>({ status: 'authenticating' })
  const [attempt, setAttempt] = useState(0)
  const controller = useRef<ReturnType<typeof observeStudentStudyPath> | null>(null)
  useEffect(() => {
    let observer: ReturnType<typeof observeStudentStudyPath>
    try {
      const selected = new URL(window.location.href).searchParams.getAll('enrollment')
      observer = observeStudentStudyPath(props, supabase().auth, setState, undefined, undefined, {
        // Duplicate or empty parameters are invalid intent, never a default selection.
        enrollmentId: selected.length === 0 ? undefined : selected.length === 1 ? selected[0] : '',
        onSelectionChange(enrollmentId) {
          const url = new URL(window.location.href)
          url.search = new URLSearchParams([...url.searchParams].filter(([key]) => key !== 'enrollment')).toString()
          if (enrollmentId !== undefined) url.searchParams.set('enrollment', enrollmentId)
          window.history.replaceState(window.history.state, '', url)
        },
      })
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
    onSelectEnrollment={(id) => { void controller.current?.selectEnrollment(id) }}
    onConfirmUpgrade={() => { void controller.current?.confirmUpgrade() }}
    onCancelUpgrade={() => controller.current?.cancelUpgrade()}
    onAction={(action) => { void controller.current?.act(action) }}
    onConfirmWithdrawal={() => { void controller.current?.confirmWithdrawal() }}
    onCancelWithdrawal={() => controller.current?.cancelWithdrawal()}
  />
}
