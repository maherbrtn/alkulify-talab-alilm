import type { StudyPathDefinition } from './study-paths'
import { deriveStudyPathProgress } from './study-paths'
import { isUuidV4 } from './lesson-registry'
import {
  deriveStudentStudyPath, freshStudyPathEnrollmentEligibility, studyPathEnrollmentActions,
  resolveStudentStudyPathVersions, selectStudyPathEnrollment, partitionStudyPathEnrollments,
  studyPathUpgradeEligibility, studyPathUpgradePreview, type StudyPathLessonDisplay,
} from './student-study-path'
import { studentStudyPathCloud } from './student-study-path-cloud'
import type { supabase, StudyPathEnrollmentRow } from './supabase'

type Props = { path: StudyPathDefinition; metadata: readonly StudyPathLessonDisplay[] }
type UpgradePreview = ReturnType<typeof studyPathUpgradePreview> & {
  progress: ReturnType<typeof deriveStudyPathProgress>
}
type Navigation = {
  enrollmentId?: string
  onSelectionChange?: (enrollmentId: string | undefined) => void
}

type Loaded = {
  status: 'loaded'
  enrollment: StudyPathEnrollmentRow
  study: ReturnType<typeof deriveStudentStudyPath>
}
export type StudentStudyPathAction = 'enroll' | 'pause' | 'resume' | 'withdraw' | 'upgrade'

export type StudentStudyPathState = (
  | { status: 'authenticating' | 'loading' | 'signed-out' | 'empty' |
      'auth-error' | 'enrollment-error' | 'progress-error' | 'unavailable-version' | 'corrupt-enrollment' | 'invalid-selection' }
  | Loaded
) & {
  eligibility?: ReturnType<typeof freshStudyPathEnrollmentEligibility>
  actionBusy?: boolean
  confirmWithdraw?: boolean
  confirmUpgrade?: boolean
  upgradePreview?: UpgradePreview
  history?: ReturnType<typeof partitionStudyPathEnrollments>
  selectedEnrollmentId?: string
  mutation?: { action: StudentStudyPathAction; status: 'pending' | 'reconciling' | 'error' }
}

type Auth = Pick<ReturnType<typeof supabase>['auth'], 'getSession' | 'getUser' | 'onAuthStateChange'>
type Cloud = Pick<typeof studentStudyPathCloud, 'readEnrollments' | 'readProgress'>
type Mutations = Pick<typeof studentStudyPathCloud, StudentStudyPathAction>
type Snapshot = {
  userId: string
  enrollment: StudyPathEnrollmentRow | null
  eligibility: ReturnType<typeof freshStudyPathEnrollmentEligibility>
  upgradePreview?: UpgradePreview
}
type Operation = {
  action: StudentStudyPathAction
  userId: string
  enrollmentId: string | null
  version: number
  sourceVersion: number | null
  phase: 'preflight' | 'rpc' | 'reconcile'
}

/** One read generation spans auth, enrollment and progress; obsolete results never publish. */
export function observeStudentStudyPath(
  { path, metadata }: Props,
  auth: Auth,
  publish: (state: StudentStudyPathState) => void,
  cloud: Cloud = studentStudyPathCloud,
  mutations: Mutations = studentStudyPathCloud,
  navigation: Navigation = {},
) {
  let generation = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let view: StudentStudyPathState = { status: 'authenticating' }
  let snapshot: Snapshot | null = null
  let verifiedOwner: string | null = null
  let confirmation: { action: 'withdraw' | 'upgrade'; source: Snapshot } | null = null
  let selection = navigation.enrollmentId
  let selectionOwner: string | null = null
  const clearSelection = () => {
    selection = undefined
    navigation.onSelectionChange?.(undefined)
  }
  let operation: Operation | null = null
  // This lock survives auth changes until the outstanding action settles.
  let actionBusy = false
  const emit = (next: StudentStudyPathState) => {
    if (disposed) return
    view = {
      ...next,
      actionBusy,
      confirmWithdraw: confirmation?.action === 'withdraw',
      confirmUpgrade: confirmation?.action === 'upgrade',
      mutation: operation ? {
        action: operation.action,
        status: operation.phase !== 'reconcile' ? 'pending'
          : next.status === 'authenticating' || next.status === 'loading' ? 'reconciling' : 'error',
      } : undefined,
    }
    publish(view)
  }
  const available = (action: StudentStudyPathAction, value: Snapshot) =>
    action === 'enroll' ? !value.enrollment && selection === undefined && value.eligibility.allowed
      : action === 'upgrade' ? !!value.upgradePreview
      : !!value.enrollment && studyPathEnrollmentActions(value.enrollment.state)[action]
  const reconcile = (rows: readonly StudyPathEnrollmentRow[], userId: string) => {
    if (!operation || operation.phase !== 'reconcile' || operation.userId !== userId) return
    const { action, enrollmentId, version, sourceVersion } = operation
    if (action === 'upgrade') {
      const { live } = partitionStudyPathEnrollments(rows, path.pathId)
      const source = rows.find((row) => row.id === enrollmentId)
      if (source?.state === 'superseded' && source.path_version === sourceVersion &&
          live?.path_version === version && source.superseded_by_enrollment_id === live.id) {
        operation = null
        clearSelection() // Normal owner/path selection chooses the authoritative target.
      }
      return
    }
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
        selectionOwner = null
        clearSelection()
        operation = null
        return set({ status: 'signed-out' })
      }
      const { data: verified, error: authError } = await auth.getUser()
      if (!current()) return
      if (authError || !verified.user || verified.user.id !== data.session.user.id)
        return set({ status: 'auth-error' })
      userId = verified.user.id
      if (selectionOwner !== null && selectionOwner !== userId) clearSelection()
      selectionOwner = userId
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
      partitionStudyPathEnrollments(rows, path.pathId)
      reconcile(rows, userId)
      enrollment = selectStudyPathEnrollment(rows, path.pathId, selection)
    } catch {
      return set({ status: 'corrupt-enrollment' })
    }
    const history = partitionStudyPathEnrollments(rows, path.pathId)
    const context = { history, selectedEnrollmentId: selection }
    const show = (state: StudentStudyPathState) => set({ ...state, ...context })
    if (selection !== undefined && (!isUuidV4(selection) || !enrollment))
      return show({ status: 'invalid-selection' })
    let eligibility: Snapshot['eligibility']
    try {
      eligibility = freshStudyPathEnrollmentEligibility(path, rows)
    } catch {
      return show({ status: 'unavailable-version' })
    }
    if (!enrollment) {
      snapshot = { userId, enrollment, eligibility }
      return show({ status: 'empty', eligibility })
    }
    let keys: string[]
    let versions: ReturnType<typeof resolveStudentStudyPathVersions>
    let canUpgrade: boolean
    try {
      versions = resolveStudentStudyPathVersions(path, enrollment)
      canUpgrade = studyPathUpgradeEligibility(path, rows, enrollment.id).allowed
      const definitions = canUpgrade ? [versions.pinned!, versions.current] : [versions.pinned!]
      keys = [...new Set(definitions.flatMap((version) =>
        version.modules.flatMap((module) => module.lessons.map((lesson) => lesson.lessonKey))))]
    } catch {
      return show({ status: 'unavailable-version' })
    }
    let progress: Awaited<ReturnType<Cloud['readProgress']>>
    try {
      progress = await cloud.readProgress(keys)
    } catch {
      return show({ status: 'progress-error' })
    }
    if (!current()) return
    try {
      const study = deriveStudentStudyPath(path, enrollment, progress, metadata)
      const upgradePreview = canUpgrade ? {
        ...studyPathUpgradePreview(versions.pinned!, versions.current),
        progress: deriveStudyPathProgress(versions.current, progress),
      } : undefined
      snapshot = { userId, enrollment, eligibility, upgradePreview }
      show({ status: 'loaded', enrollment, study, upgradePreview })
    } catch {
      // Never turn an invalid/partial response into an empty progress snapshot.
      show({ status: 'progress-error' })
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
    if (event === 'SIGNED_OUT' || (selectionOwner !== null && session?.user.id !== selectionOwner)) {
      clearSelection()
      selectionOwner = null
    }
    verifiedOwner = null
    emit({ status: event === 'SIGNED_OUT' ? 'signed-out' : 'authenticating' })
    // Leave the Supabase auth callback/lock before calling auth methods again.
    if (event !== 'SIGNED_OUT') timer = setTimeout(() => void refresh(), 0)
  })
  const run = async (action: StudentStudyPathAction, source: Snapshot) => {
    if (disposed || actionBusy || !available(action, source)) return
    const intent: Operation = {
      action, userId: source.userId, enrollmentId: source.enrollment?.id ?? null,
      version: action === 'enroll' || action === 'upgrade' ? path.currentVersion : source.enrollment!.path_version,
      sourceVersion: source.enrollment?.path_version ?? null,
      phase: 'preflight',
    }
    actionBusy = true
    confirmation = null
    emit(view)
    try {
      // A late commit may now be visible. Reconcile an uncertain prior intent before
      // replacing it, including when the user explicitly requests another action.
      if (operation?.phase === 'reconcile') {
        const unresolved = operation
        await refresh()
        if (disposed || operation !== unresolved) return
      }
      operation = intent
      emit(view)
      // Verify auth and reread before dispatch, including a new explicit attempt after an error.
      await refresh()
      const fresh: Snapshot | null = snapshot
      if (disposed || operation !== intent) return
      if (!fresh || fresh.userId !== intent.userId ||
          (fresh.enrollment?.id ?? null) !== intent.enrollmentId ||
          (fresh.enrollment?.path_version ?? null) !== intent.sourceVersion || !available(action, fresh)) {
        operation = null
        return
      }
      intent.phase = 'rpc'
      emit(view)
      try {
        if (action === 'enroll') await mutations.enroll(path.pathId, path.currentVersion)
        else if (action === 'upgrade') await mutations.upgrade(intent.enrollmentId!, intent.version)
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
      if (action === 'withdraw' || action === 'upgrade') {
        confirmation = { action, source: snapshot }
        emit(view)
        return
      }
      await run(action, snapshot)
    },
    async confirmWithdrawal() {
      const source = confirmation?.action === 'withdraw' ? confirmation.source : null
      if (!source || source !== snapshot || actionBusy) return
      await run('withdraw', source)
    },
    async confirmUpgrade() {
      const source = confirmation?.action === 'upgrade' ? confirmation.source : null
      if (!source || source !== snapshot || actionBusy) return
      await run('upgrade', source)
    },
    cancelUpgrade() {
      confirmation = null
      emit(view)
    },
    async selectEnrollment(enrollmentId?: string) {
      if (disposed || actionBusy) return
      selection = enrollmentId
      navigation.onSelectionChange?.(enrollmentId)
      await refresh()
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
