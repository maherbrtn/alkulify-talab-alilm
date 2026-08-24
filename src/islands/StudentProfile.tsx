import { useEffect, useState, type FormEvent } from 'react'
import { signupDisplayName, supabase, type Profile } from '../lib/supabase'

export default function StudentProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      const client = supabase()
      const { data: sessionData } = await client.auth.getSession()
      if (!sessionData.session) return location.replace('/student/login/')

      const { data: authData, error: authError } = await client.auth.getUser()
      if (authError || !authData.user) {
        await client.auth.signOut({ scope: 'local' })
        location.replace('/student/login/')
        return
      }

      let result = await client
        .from('profiles')
        .select('id, display_name, created_at, updated_at')
        .eq('id', authData.user.id)
        .maybeSingle()
      if (result.error) throw result.error

      // The database trigger normally creates this row. The insert is a safe repair for an
      // older account because its RLS policy still requires auth.uid() = id.
      if (!result.data) {
        const fallbackName = signupDisplayName(authData.user.user_metadata.display_name)
        result = await client
          .from('profiles')
          .insert({ id: authData.user.id, display_name: fallbackName })
          .select('id, display_name, created_at, updated_at')
          .single()
        if (result.error) throw result.error
      }

      if (!result.data) throw new Error('missing profile')
      if (!active) return
      setProfile(result.data)
      setName(result.data.display_name ?? '')
    }

    load()
      .catch(() => {
        if (active) setError('تعذّر تحميل الملف الشخصي. أعد المحاولة، وإن انتهت الجلسة فسجل الدخول مجددًا.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!profile) return
    const displayName = signupDisplayName(name)
    if (!displayName) return setError('اكتب اسمًا ظاهرًا صالحًا.')

    setBusy(true)
    setError('')
    setNotice('')
    const { data, error: updateError } = await supabase()
      .from('profiles')
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq('id', profile.id)
      .select('id, display_name, created_at, updated_at')
      .single()
    if (updateError) {
      setError('تعذّر حفظ الاسم. تحقق من الجلسة والاتصال ثم حاول مجددًا.')
    } else {
      setProfile(data)
      setName(data.display_name ?? '')
      setNotice('حُفظ الملف الشخصي.')
    }
    setBusy(false)
  }

  if (loading) return <p className="mt-8 text-muted" role="status">جارٍ تحميل ملفك…</p>
  if (!profile)
    return <p className="card mt-8 p-5 text-red-700 dark:text-red-300" role="alert">{error}</p>

  return (
    <form className="card mt-8 p-5 sm:p-6" onSubmit={save}>
      <label htmlFor="profile-name" className="block text-sm font-medium">الاسم الظاهر</label>
      <input
        id="profile-name"
        name="display_name"
        type="text"
        required
        maxLength={80}
        autoComplete="name"
        value={name}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
        className="mt-2 w-full rounded-xl border border-border-strong bg-surface px-4 py-3 text-base disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={busy}
        className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-accent px-5 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? 'جارٍ الحفظ…' : 'حفظ'}
      </button>
      <a href="/student/" className="me-4 inline-flex min-h-11 items-center text-accent underline underline-offset-4">العودة إلى الحساب</a>
      <div className="mt-4 min-h-6 text-sm" aria-live="polite">
        {error && <p className="text-red-700 dark:text-red-300">{error}</p>}
        {notice && <p className="text-accent">{notice}</p>}
      </div>
    </form>
  )
}
