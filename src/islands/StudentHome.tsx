import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Account = { id: string; email: string }

export default function StudentHome() {
  const [account, setAccount] = useState<Account | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
    })

    const { data: listener } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') location.replace('/student/login/')
    })
    return () => {
      active = false
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

  return (
    <div className="card mt-8 p-5 sm:p-6">
      <p className="text-sm text-muted">مسجل باسم</p>
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
    </div>
  )
}
