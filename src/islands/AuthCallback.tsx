import { useEffect, useState } from 'react'
import { signupDisplayName, supabase } from '../lib/supabase'

type State = 'working' | 'expired' | 'error'

export default function AuthCallback() {
  const [state, setState] = useState<State>('working')

  useEffect(() => {
    let active = true

    const finish = async () => {
      const client = supabase()
      const { data: existing } = await client.auth.getSession()
      if (existing.session) {
        location.replace('/student/')
        return
      }

      const url = new URL(location.href)
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
      const errorCode = url.searchParams.get('error_code') ?? hash.get('error_code')
      if (errorCode === 'otp_expired') {
        if (active) setState('expired')
        return
      }

      const code = url.searchParams.get('code')
      if (!code || url.searchParams.has('error')) throw new Error('missing authentication code')

      const { data, error } = await client.auth.exchangeCodeForSession(code)
      if (error || !data.user) throw error ?? new Error('missing authenticated user')

      const displayName = signupDisplayName(data.user.user_metadata.display_name)
      if (displayName) {
        const { error: profileError } = await client
          .from('profiles')
          .update({ display_name: displayName, updated_at: new Date().toISOString() })
          .eq('id', data.user.id)
        if (profileError) throw profileError
      }

      // Fixed same-origin destination: callback query parameters never control navigation.
      location.replace('/student/')
    }

    finish().catch(() => {
      if (active) setState('error')
    })
    return () => {
      active = false
    }
  }, [])

  if (state === 'expired') {
    return (
      <div className="card mt-8 p-5 sm:p-6" role="status">
        <h2 className="font-semibold">قد يكون رابط التأكيد منتهيًا أو مستخدمًا</h2>
        <p className="mt-2 text-muted">
          قد يكون حسابك قد تأكد بالفعل. جرّب تسجيل الدخول ببريدك الإلكتروني وكلمة المرور.
        </p>
        <a href="/student/login/" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-accent px-5 font-medium text-accent-fg">
          الانتقال إلى تسجيل الدخول
        </a>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="card mt-8 p-5 sm:p-6" role="alert">
        <h2 className="font-semibold">تعذّر تأكيد الحساب</h2>
        <p className="mt-2 text-muted">قد يكون الرابط منتهيًا أو سبق استخدامه. اطلب رابطًا جديدًا أو سجل الدخول.</p>
        <a href="/student/login/" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-accent px-5 font-medium text-accent-fg">
          العودة إلى تسجيل الدخول
        </a>
      </div>
    )
  }

  return <p className="mt-8 text-muted" role="status">جارٍ تأكيد حسابك…</p>
}
