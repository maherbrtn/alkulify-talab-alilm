import type { StudentHomeMyPathsState } from '../lib/student-home-controller'

const button = 'inline-flex min-h-11 items-center rounded-xl border border-border-strong px-5 font-medium transition-colors hover:bg-surface-2'
const stateLabels = {
  active: 'نشط', paused: 'متوقف مؤقتًا', withdrawn: 'منسحب', superseded: 'تمت ترقيته',
}

/** Presentation only: identities, links, progress and Continue come from the read model. */
export default function StudentMyPaths({ state, hasPublishedPaths, retry }: {
  state: StudentHomeMyPathsState
  hasPublishedPaths: boolean
  retry: () => void
}) {
  const paths = 'paths' in state ? state.paths : null
  const empty = paths && !paths.live.length && !paths.history.length && !paths.corrupt.length
  return (
    <section dir="rtl" aria-labelledby="student-my-paths-heading" className="space-y-4">
      <h2 id="student-my-paths-heading" className="text-xl font-semibold">مساراتي</h2>
      {state.status === 'enrollment-loading' && (
        <p className="card p-5 text-muted" role="status">جارٍ تحميل تسجيلاتك في المسارات…</p>
      )}
      {state.status === 'enrollment-error' && (
        <div className="card p-5" role="alert">
          <p className="text-red-700 dark:text-red-300">تعذّر تحميل تسجيلاتك في المسارات. حاول مجددًا.</p>
          <button type="button" className={`${button} mt-4`} onClick={retry}>إعادة محاولة تحميل مساراتي</button>
        </div>
      )}
      {state.status === 'progress-loading' && (
        <p className="text-muted" role="status">جارٍ تحميل تقدم مساراتك…</p>
      )}
      {state.status === 'progress-error' && (
        <div className="card p-5" role="alert">
          <p className="text-red-700 dark:text-red-300">تعذّر عرض تقدم مساراتك كاملًا. تسجيلاتك ظاهرة أدناه.</p>
          <button type="button" className={`${button} mt-4`} onClick={retry}>إعادة محاولة تحميل تقدم المسارات</button>
        </div>
      )}
      {empty && (
        <div className="card p-5 sm:p-6">
          <p>{hasPublishedPaths ? 'لم تسجّل في أي مسار بعد.' : 'لا توجد مسارات منشورة بعد'}</p>
          <a href="/study-paths/" className={`${button} mt-4`}>تصفح المسارات</a>
        </div>
      )}
      {paths && paths.live.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {paths.live.map((card) => (
            <li key={card.pathId} className="card min-w-0 p-5 sm:p-6" aria-labelledby={`my-path-${card.pathId}`}>
              <h3 id={`my-path-${card.pathId}`} className="break-words text-lg font-semibold">
                {card.title ?? 'بيانات المسار غير متاحة حاليًا'}
              </h3>
              <p className="mt-2 text-sm text-muted">الإصدار المثبت <span className="digits">{card.pinnedVersion}</span> · {stateLabels[card.state]}</p>
              {card.progress ? (
                <>
                  <p className="mt-5 text-3xl font-semibold digits">{card.progress.percentage}%</p>
                  <p className="mt-2 text-muted"><span className="digits">{card.progress.completedLessons}</span> من <span className="digits">{card.progress.totalLessons}</span> درس مكتمل</p>
                  <progress className="mt-4 h-3 w-full accent-accent" value={card.progress.completedLessons}
                    max={card.progress.totalLessons} aria-label={`إكمال دروس ${card.title}`} />
                  {card.progress.completed && <p className="mt-3 text-accent">أكملت جميع دروس هذا الإصدار.</p>}
                </>
              ) : (
                <p className="mt-4 text-sm text-muted">
                  {card.availability === 'unavailable-path' ? 'تعذّر عرض المنهج ورابط المسار في الوقت الحالي.'
                    : card.availability === 'unavailable-version' ? 'الإصدار المثبت غير متاح حاليًا؛ لا يمكن عرض تقدمه.'
                    : state.status === 'progress-loading' ? 'جارٍ تحميل التقدم…' : 'التقدم غير متاح حاليًا.'}
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-3">
                {card.href && <a href={card.href} className={button}>فتح المسار</a>}
                {card.continueLesson && (
                  <a href={card.continueLesson.href} className={`${button} gap-2`}>
                    <span>تابع المسار:</span><span className="break-words">{card.continueLesson.title}</span>
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {paths && paths.corrupt.length > 0 && (
        <ul className="space-y-3">
          {paths.corrupt.map((group) => (
            <li key={group.pathId} className="card p-5" role="alert" id={`my-path-inconsistent-${group.pathId}`}>
              بيانات التسجيل غير متسقة لأحد مساراتك. تعذّر تحديد تسجيل صالح لعرضه.
            </li>
          ))}
        </ul>
      )}
      {paths && paths.history.length > 0 && (
        <details className="card p-5 sm:p-6">
          <summary className="min-h-11 cursor-pointer font-medium">سجل تسجيلاتي ({paths.history.length})</summary>
          <p className="mt-2 text-sm text-muted">سجل للقراءة فقط. تفاصيل التسجيل والتقدم متاحة في صفحة المسار.</p>
          {paths.live.length === 0 && <p className="mt-2 text-sm text-muted">لا توجد تسجيلات نشطة أو متوقفة مؤقتًا.</p>}
          <ul className="mt-4 space-y-4">
            {paths.history.map((entry) => (
              <li key={entry.enrollmentId}>
                <p className="break-words font-medium">{entry.title ?? 'بيانات المسار غير متاحة حاليًا'}</p>
                <p className="mt-1 text-sm text-muted">الإصدار المثبت <span className="digits">{entry.pinnedVersion}</span> · {stateLabels[entry.state]}</p>
                {entry.availability === 'unavailable-version' && <p className="mt-1 text-sm text-muted">تعريف هذا الإصدار غير متاح حاليًا.</p>}
                {entry.href && <a href={entry.href} className={`${button} mt-2`}>عرض التسجيل التاريخي</a>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
