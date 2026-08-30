import { useEffect, useRef, useState } from 'react'
import { fetchStudentLessonCatalog } from '../lib/student-lesson-catalog'
import {
  deriveStudentProgress,
  type StudentProgressRow,
  type StudentProgressViewModel,
} from '../lib/student-progress'
import { readStudentProgress } from '../lib/student-progress-cloud'
import { supabase } from '../lib/supabase'

type Account = { id: string; email: string }

type StudentAreaState =
  | { status: 'authenticating' }
  | { status: 'progress-loading' }
  | { status: 'empty' }
  | { status: 'progress-error' }
  | { status: 'catalog-loading' }
  | { status: 'catalog-error' }
  | { status: 'loaded'; studentProgress: StudentProgressViewModel }

export default function StudentHome() {
  const [account, setAccount] = useState<Account | null>(null)
  const [areaState, setAreaState] = useState<StudentAreaState>({ status: 'authenticating' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const loadRequest = useRef(0)

  const loadStudentArea = async () => {
    const request = ++loadRequest.current
    setAreaState({ status: 'progress-loading' })

    let rows: StudentProgressRow[]
    try {
      rows = await readStudentProgress()
    } catch {
      if (request === loadRequest.current) setAreaState({ status: 'progress-error' })
      return
    }
    if (request !== loadRequest.current) return
    if (rows.length === 0) {
      setAreaState({ status: 'empty' })
      return
    }

    setAreaState({ status: 'catalog-loading' })
    try {
      const metadata = await fetchStudentLessonCatalog()
      if (request !== loadRequest.current) return
      setAreaState({
        status: 'loaded',
        studentProgress: deriveStudentProgress(rows, metadata),
      })
    } catch {
      if (request === loadRequest.current) setAreaState({ status: 'catalog-error' })
    }
  }

  useEffect(() => {
    let active = true
    const client = supabase()

    client.auth.getSession().then(async ({ data }) => {
      if (!active) return
      if (!data.session) return location.replace('/student/login/')
      const { data: verified, error: authError } = await client.auth.getUser()
      if (!active) return
      if (authError || !verified.user) {
        await client.auth.signOut({ scope: 'local' })
        location.replace('/student/login/')
        return
      }
      setAccount({ id: verified.user.id, email: verified.user.email ?? '' })
      await loadStudentArea()
    })

    const { data: listener } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        loadRequest.current++
        location.replace('/student/login/')
      }
    })
    return () => {
      active = false
      loadRequest.current++
      listener.subscription.unsubscribe()
    }
  }, [])

  const logout = async () => {
    setBusy(true)
    const { error: authError } = await supabase().auth.signOut()
    if (authError) {
      setError('تعذّر تسجيل الخروج. حاول مجددًا.')
      setBusy(false)
    } else {
      location.replace('/student/login/')
    }
  }

  if (error && !account)
    return <p className="card mt-8 p-5 text-red-700 dark:text-red-300" role="alert">{error}</p>
  if (!account) return <p className="mt-8 text-muted" role="status">جارٍ فتح حسابك…</p>

  const retry = () => void loadStudentArea()
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
            onClick={retry}
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
    </div>
  )
}
