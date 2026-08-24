import { useEffect, useState, type FormEvent } from 'react'
import { authCallbackUrl, signupDisplayName, supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup'

const field =
  'mt-2 w-full rounded-xl border border-border-strong bg-surface px-4 py-3 text-base placeholder:text-muted disabled:opacity-60'
const tab =
  'min-h-11 flex-1 rounded-lg px-3 font-medium transition-colors disabled:cursor-default'

function message(error: unknown): string {
  const text = error instanceof Error ? error.message.toLowerCase() : ''
  if (text.includes('invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
  if (text.includes('email not confirmed')) return 'أكّد بريدك الإلكتروني أولًا، ثم حاول تسجيل الدخول.'
  if (text.includes('password')) return 'تعذّر استخدام كلمة المرور. تأكد أنها تتكون من 8 أحرف على الأقل.'
  if (text.includes('rate') || text.includes('too many')) return 'محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.'
  return 'تعذّر إتمام الطلب الآن. تحقق من البيانات والاتصال ثم حاول مجددًا.'
}

export default function StudentAuth() {
  const [mode, setMode] = useState<Mode>('signin')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    supabase()
      .auth.getSession()
      .then(({ data }) => {
        if (active && data.session) location.replace('/student/')
      })
    return () => {
      active = false
    }
  }, [])

  const choose = (next: Mode) => {
    setMode(next)
    setNotice('')
    setError('')
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    setBusy(true)
    setNotice('')
    setError('')

    const form = new FormData(formElement)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    const displayName = signupDisplayName(form.get('display_name'))

    try {
      const client = supabase()
      if (mode === 'signin') {
        const { error: authError } = await client.auth.signInWithPassword({ email, password })
        if (authError) throw authError
        location.assign('/student/')
        return
      }

      if (!displayName) {
        setError('اكتب الاسم الذي تريد ظهوره في ملفك.')
        return
      }

      const { data, error: authError } = await client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: authCallbackUrl(),
          data: { display_name: displayName },
        },
      })
      if (authError) throw authError

      if (data.session && data.user) {
        const { error: profileError } = await client
          .from('profiles')
          .update({ display_name: displayName, updated_at: new Date().toISOString() })
          .eq('id', data.user.id)
        if (profileError) throw profileError
        location.assign('/student/')
        return
      }

      setNotice('أرسلنا رابط التأكيد إلى بريدك. افتحه لإكمال إنشاء الحساب.')
      formElement.reset()
    } catch (reason) {
      setError(message(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mt-8 p-5 sm:p-6">
      <div className="flex gap-2 rounded-xl bg-surface-2 p-1" aria-label="نوع الدخول">
        <button
          type="button"
          className={`${tab} ${mode === 'signin' ? 'bg-surface text-fg shadow-sm' : 'text-muted'}`}
          aria-pressed={mode === 'signin'}
          disabled={busy}
          onClick={() => choose('signin')}
        >
          تسجيل الدخول
        </button>
        <button
          type="button"
          className={`${tab} ${mode === 'signup' ? 'bg-surface text-fg shadow-sm' : 'text-muted'}`}
          aria-pressed={mode === 'signup'}
          disabled={busy}
          onClick={() => choose('signup')}
        >
          إنشاء حساب
        </button>
      </div>

      <form className="mt-6" onSubmit={submit}>
        {mode === 'signup' && (
          <>
            <label htmlFor="student-name" className="block text-sm font-medium">
              الاسم الظاهر
            </label>
            <input
              id="student-name"
              name="display_name"
              type="text"
              required
              maxLength={80}
              autoComplete="name"
              disabled={busy}
              className={field}
            />
          </>
        )}

        <label htmlFor="student-email" className={`${mode === 'signup' ? 'mt-5' : ''} block text-sm font-medium`}>
          البريد الإلكتروني
        </label>
        <input
          id="student-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          dir="ltr"
          disabled={busy}
          className={field}
        />

        <label htmlFor="student-password" className="mt-5 block text-sm font-medium">
          كلمة المرور
        </label>
        <input
          id="student-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          dir="ltr"
          disabled={busy}
          className={field}
        />
        <p className="mt-2 text-xs text-muted">ثمانية أحرف على الأقل.</p>

        <button
          type="submit"
          disabled={busy}
          className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-5 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? 'جارٍ الإرسال…' : mode === 'signup' ? 'أنشئ الحساب' : 'ادخل'}
        </button>

        <div className="mt-4 min-h-6 text-sm" aria-live="polite">
          {error && <p className="text-red-700 dark:text-red-300">{error}</p>}
          {notice && <p className="text-accent">{notice}</p>}
        </div>
      </form>
    </div>
  )
}
