import { fetchStudentLessonCatalog } from './student-lesson-catalog'
import { deriveStudentProgress, type StudentProgressViewModel } from './student-progress'
import { readStudentProgress } from './student-progress-cloud'
import {
  planStudentMyPaths, deriveStudentMyPaths, type StudentMyPathsCatalogEntry,
} from './student-my-paths'
import { studentStudyPathCloud } from './student-study-path-cloud'
import type { supabase } from './supabase'

type Account = { id: string; email: string }
export type StudentHomeGeneralState =
  | { status: 'progress-loading' | 'catalog-loading' | 'progress-error' | 'catalog-error' | 'empty' }
  | { status: 'loaded'; studentProgress: StudentProgressViewModel }
export type StudentHomeMyPathsState =
  | { status: 'enrollment-loading' | 'enrollment-error' }
  | { status: 'progress-loading' | 'progress-error' | 'ready'; paths: ReturnType<typeof deriveStudentMyPaths> }
export type StudentHomeState =
  | { status: 'authenticating' | 'signed-out' | 'auth-error' }
  | {
    status: 'ready'
    account: Account
    general: StudentHomeGeneralState
    myPaths: StudentHomeMyPathsState
    signingOut: boolean
    signOutError: boolean
  }

type Auth = Pick<ReturnType<typeof supabase>['auth'],
  'getSession' | 'getUser' | 'onAuthStateChange' | 'signOut'>
type Reads = {
  readGeneralProgress: typeof readStudentProgress
  readGeneralCatalog: typeof fetchStudentLessonCatalog
} & Pick<typeof studentStudyPathCloud, 'readOwnerEnrollments' | 'readProgress'>
type PageEvents = {
  addEventListener(type: 'focus' | 'pageshow', listener: () => void): void
  removeEventListener(type: 'focus' | 'pageshow', listener: () => void): void
}
const defaultReads: Reads = {
  readGeneralProgress: readStudentProgress,
  readGeneralCatalog: fetchStudentLessonCatalog,
  readOwnerEnrollments: studentStudyPathCloud.readOwnerEnrollments,
  readProgress: studentStudyPathCloud.readProgress,
}

/** Auth generations invalidate both branches; branch generations isolate explicit retries.
 * No session/event identity authorizes reads before a matching getUser verification.
 */
export function observeStudentHome(
  catalog: readonly StudentMyPathsCatalogEntry[],
  auth: Auth,
  publish: (state: StudentHomeState) => void,
  reads: Reads = defaultReads,
  pageEvents: PageEvents | null = typeof window === 'undefined' ? null : window,
) {
  let generation = 0
  let generalGeneration = 0
  let pathsGeneration = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let verifiedOwner: string | null = null
  let view: StudentHomeState = { status: 'authenticating' }
  const emit = (state: StudentHomeState) => {
    if (disposed) return
    view = state
    publish(state)
  }
  const currentOwner = (request: number, owner: string) =>
    !disposed && request === generation && verifiedOwner === owner &&
    view.status === 'ready' && view.account.id === owner

  const loadGeneral = async (request: number, owner: string) => {
    const branch = ++generalGeneration
    const current = () => currentOwner(request, owner) && branch === generalGeneration
    const set = (general: StudentHomeGeneralState) => {
      if (current() && view.status === 'ready') emit({ ...view, general })
    }
    if (!current()) return
    set({ status: 'progress-loading' })
    let rows: Awaited<ReturnType<Reads['readGeneralProgress']>>
    try { rows = await reads.readGeneralProgress() }
    catch { return set({ status: 'progress-error' }) }
    if (!current()) return
    if (rows.length === 0) return set({ status: 'empty' })
    set({ status: 'catalog-loading' })
    try {
      const metadata = await reads.readGeneralCatalog()
      if (!current()) return
      set({ status: 'loaded', studentProgress: deriveStudentProgress(rows, metadata) })
    } catch { set({ status: 'catalog-error' }) }
  }

  const loadMyPaths = async (request: number, owner: string) => {
    const branch = ++pathsGeneration
    const current = () => currentOwner(request, owner) && branch === pathsGeneration
    const set = (myPaths: StudentHomeMyPathsState) => {
      if (current() && view.status === 'ready') emit({ ...view, myPaths })
    }
    if (!current()) return
    set({ status: 'enrollment-loading' })
    let plan: ReturnType<typeof planStudentMyPaths>
    try {
      // Always list the owner, even with no general progress or no public curriculum.
      const rows = await reads.readOwnerEnrollments()
      if (!current()) return
      plan = planStudentMyPaths(owner, rows, catalog)
    } catch { return set({ status: 'enrollment-error' }) }
    if (!plan.lessonKeys.length)
      return set({ status: 'ready', paths: deriveStudentMyPaths(plan, { status: 'complete', rows: [] }) })

    // The error sentinel carries presence without fabricating progress while loading.
    const presence = deriveStudentMyPaths(plan, { status: 'error' })
    set({ status: 'progress-loading', paths: presence })
    try {
      const rows = await reads.readProgress(plan.lessonKeys)
      if (!current()) return
      const paths = deriveStudentMyPaths(plan, { status: 'complete', rows })
      set({ status: paths.live.some((card) => card.status === 'derivation-error')
        ? 'progress-error' : 'ready', paths })
    } catch { set({ status: 'progress-error', paths: presence }) }
  }

  const refresh = async () => {
    if (disposed) return
    clearTimeout(timer)
    const request = ++generation
    const current = () => !disposed && request === generation
    // Auth state has no fields capable of retaining old account cards or links.
    emit({ status: 'authenticating' })
    let account: Account
    try {
      const { data, error } = await auth.getSession()
      if (!current()) return
      if (error) throw error
      if (!data.session) {
        verifiedOwner = null
        return emit({ status: 'signed-out' })
      }
      const { data: verified, error: authError } = await auth.getUser()
      if (!current()) return
      if (authError || !verified.user || verified.user.id !== data.session.user.id)
        throw new Error('account verification failed')
      account = { id: verified.user.id, email: verified.user.email ?? '' }
    } catch {
      if (current()) {
        verifiedOwner = null
        emit({ status: 'auth-error' })
      }
      return
    }
    verifiedOwner = account.id
    emit({ status: 'ready', account, signingOut: false, signOutError: false,
      general: { status: 'progress-loading' }, myPaths: { status: 'enrollment-loading' } })
    // Each branch publishes independently, including failures and empty results.
    await Promise.all([loadGeneral(request, account.id), loadMyPaths(request, account.id)])
  }

  const { data: listener } = auth.onAuthStateChange((event, session) => {
    if (disposed || event === 'INITIAL_SESSION') return
    // These events frequently repeat for an already verified account. They neither
    // grant authority to a new owner nor cancel that owner's outstanding reads.
    if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
        verifiedOwner !== null && session?.user.id === verifiedOwner) return
    ++generation
    clearTimeout(timer)
    verifiedOwner = null
    emit({ status: event === 'SIGNED_OUT' ? 'signed-out' : 'authenticating' })
    // Leave the Supabase auth callback/lock before starting another auth read.
    if (event !== 'SIGNED_OUT') timer = setTimeout(() => void refresh(), 0)
  })
  const refreshOnPage = () => { void refresh() }
  pageEvents?.addEventListener('focus', refreshOnPage)
  pageEvents?.addEventListener('pageshow', refreshOnPage)
  void refresh()

  return {
    refresh,
    async retryGeneral() {
      if (!disposed && view.status === 'ready' && verifiedOwner)
        await loadGeneral(generation, verifiedOwner)
    },
    async retryMyPaths() {
      if (!disposed && view.status === 'ready' && verifiedOwner)
        await loadMyPaths(generation, verifiedOwner)
    },
    async signOut() {
      if (disposed || view.status !== 'ready' || view.signingOut) return
      const request = generation
      const owner = view.account.id
      emit({ ...view, signingOut: true, signOutError: false })
      try {
        const { error } = await auth.signOut()
        if (!currentOwner(request, owner)) return
        if (error) throw error
        ++generation
        verifiedOwner = null
        emit({ status: 'signed-out' })
      } catch {
        if (currentOwner(request, owner) && view.status === 'ready')
          emit({ ...view, signingOut: false, signOutError: true })
      }
    },
    dispose() {
      disposed = true
      ++generation
      verifiedOwner = null
      view = { status: 'authenticating' }
      clearTimeout(timer)
      listener.subscription.unsubscribe()
      pageEvents?.removeEventListener('focus', refreshOnPage)
      pageEvents?.removeEventListener('pageshow', refreshOnPage)
    },
  }
}
