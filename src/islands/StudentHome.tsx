import { useEffect, useRef, useState } from 'react'
import { observeStudentHome, type StudentHomeState } from '../lib/student-home-controller'
import type { StudentMyPathsCatalogEntry } from '../lib/student-my-paths'
import { supabase } from '../lib/supabase'
import StudentMyPaths from './StudentMyPaths'

type Props = { myPathsCatalog: readonly StudentMyPathsCatalogEntry[] }

export default function StudentHome({ myPathsCatalog }: Props) {
  const [state, setState] = useState<StudentHomeState>({ status: 'authenticating' })
  const controller = useRef<ReturnType<typeof observeStudentHome> | null>(null)
  useEffect(() => {
    const reader = observeStudentHome(myPathsCatalog, supabase().auth, (next) => {
      setState(next)
      if (next.status === 'signed-out') location.replace('/student/login/')
    })
    controller.current = reader
    return () => {
      controller.current = null
      reader.dispose()
    }
  }, [myPathsCatalog])
  return <StudentHomeView state={state} hasPublishedPaths={myPathsCatalog.length > 0}
    retryAuth={() => { void controller.current?.refresh() }}
    retryGeneral={() => { void controller.current?.retryGeneral() }}
    retryMyPaths={() => { void controller.current?.retryMyPaths() }}
    logout={() => { void controller.current?.signOut() }} />
}

export function StudentHomeView({ state, hasPublishedPaths, retryAuth, retryGeneral, retryMyPaths, logout }: {
  state: StudentHomeState
  hasPublishedPaths: boolean
  retryAuth: () => void
  retryGeneral: () => void
  retryMyPaths: () => void
  logout: () => void
}) {
  if (state.status === 'auth-error') return (
    <div className="card mt-8 p-5" role="alert">
      <p className="text-red-700 dark:text-red-300">تعذّر التحقق من حسابك. حاول مجددًا أو سجّل الدخول.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={retryAuth} className="inline-flex min-h-11 items-center rounded-xl border border-border-strong px-5">إعادة المحاولة</button>
        <a href="/student/login/" className="inline-flex min-h-11 items-center rounded-xl border border-border-strong px-5">تسجيل الدخول</a>
      </div>
    </div>
  )
  if (state.status === 'signed-out') return (
    <p className="mt-8 text-muted" role="status"><a href="/student/login/">تسجيل الدخول</a></p>
  )
  if (state.status !== 'ready') return <p className="mt-8 text-muted" role="status">جارٍ فتح حسابك…</p>

  const { account, general: areaState, signingOut: busy } = state
  const error = state.signOutError ? 'تعذّر تسجيل الخروج. حاول مجددًا.' : ''
  const studentProgress = areaState.status === 'loaded' ? areaState.studentProgress : null

  return (
    <div className="mt-8 space-y-6">
      <section className="card p-5 sm:p-6" aria-labelledby="student-account-heading">
        <h2 id="student-account-heading" className="text-sm font-normal text-muted">مسجل باسم</h2>
        <p className="mt-1 break-all font-medium" dir="ltr">{account.email}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="/student/profile/" className="inline-flex min-h-11 items-center rounded-xl bg-accent px-5 font-medium text-accent-fg">
            الملف الشخصي
          </a>
          <button
            type="button"
            disabled={busy}
            onClick={logout}
            className="inline-flex min-h-11 items-center rounded-xl border border-border-strong px-5 font-medium transition-colors hover:bg-surface-2 disabled:opacity-60"
          >
            {busy ? 'جارٍ الخروج…' : 'تسجيل الخروج'}
          </button>
        </div>
        {error && <p className="mt-4 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
      </section>

      {(areaState.status === 'progress-loading' || areaState.status === 'catalog-loading') && (
        <p className="card p-5 text-muted" role="status">
          {areaState.status === 'progress-loading' ? 'جارٍ تحميل تقدمك…' : 'جارٍ تجهيز دروسك…'}
        </p>
      )}

      {areaState.status === 'empty' && (
        <section className="card p-5 sm:p-6" aria-labelledby="student-empty-heading">
          <h2 id="student-empty-heading" className="text-lg font-semibold">لا يوجد تقدم محفوظ بعد</h2>
          <p className="mt-2 text-muted">سيظهر تقدم دروسك هنا بعد أن تبدأ التعلّم.</p>
        </section>
      )}

      {(areaState.status === 'progress-error' || areaState.status === 'catalog-error') && (
        <div className="card p-5" role="alert">
          <p className="text-red-700 dark:text-red-300">
            {areaState.status === 'progress-error'
              ? 'تعذّر تحميل تقدمك. حاول مجددًا.'
              : 'تعذّر تجهيز بيانات الدروس. حاول مجددًا.'}
          </p>
          <button
            type="button"
            onClick={retryGeneral}
            className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-border-strong px-5 font-medium transition-colors hover:bg-surface-2"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {studentProgress?.unknownRowCount ? (
        <p className="rounded-xl border border-border-strong p-4 text-sm text-muted" role="status">
          بعض سجلات التقدم مرتبطة بدروس لم تعد متاحة حاليًا.
        </p>
      ) : null}

      {studentProgress?.continueLesson && (
        <section aria-labelledby="continue-learning-heading">
          <h2 id="continue-learning-heading" className="text-xl font-semibold">تابع التعلّم</h2>
          <a
            href={studentProgress.continueLesson.href}
            className="card mt-3 block min-h-11 p-5 transition-colors hover:bg-surface-2"
          >
            <span className="block break-words font-medium">{studentProgress.continueLesson.title}</span>
            <span className="mt-2 block text-sm text-muted">
              {studentProgress.continueLesson.displayPercentage === null
                ? 'قيد التعلّم'
                : `قيد التعلّم · ${studentProgress.continueLesson.displayPercentage}%`}
            </span>
          </a>
        </section>
      )}

      {studentProgress && studentProgress.recentLessons.length > 0 && (
        <section aria-labelledby="recent-lessons-heading">
          <h2 id="recent-lessons-heading" className="text-xl font-semibold">الدروس الأخيرة</h2>
          <ul className="mt-3 space-y-3">
            {studentProgress.recentLessons.map((lesson) => (
              <li key={lesson.lessonKey}>
                <a href={lesson.href} className="card block min-h-11 p-4 transition-colors hover:bg-surface-2">
                  <span className="block break-words font-medium">{lesson.title}</span>
                  <span className="mt-1 block text-sm text-muted">
                    {lesson.completed
                      ? 'مكتمل'
                      : lesson.displayPercentage === null
                        ? 'قيد التعلّم'
                        : `قيد التعلّم · ${lesson.displayPercentage}%`}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <StudentMyPaths state={state.myPaths} hasPublishedPaths={hasPublishedPaths} retry={retryMyPaths} />
    </div>
  )
}
