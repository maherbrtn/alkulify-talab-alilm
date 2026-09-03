-- Owner-scoped Study Path enrollment lifecycle. Curriculum and completion remain
-- canonical in Git and lesson_progress; this table only pins user enrollment to
-- one published path version and records its lifecycle.
create table public.study_path_enrollments (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path_id uuid not null,
  path_version integer not null,
  state text not null default 'active',
  enrolled_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  paused_at timestamptz,
  withdrawn_at timestamptz,
  superseded_at timestamptz,
  superseded_by_enrollment_id uuid,
  constraint study_path_enrollments_state_valid check (
    state in ('active', 'paused', 'withdrawn', 'superseded')
  ),
  constraint study_path_enrollments_path_version_fkey
    foreign key (path_id, path_version)
    references public.study_path_versions(path_id, version),
  constraint study_path_enrollments_user_path_version_key
    unique (user_id, path_id, path_version),
  constraint study_path_enrollments_superseded_by_fkey
    foreign key (superseded_by_enrollment_id)
    references public.study_path_enrollments(id),
  constraint study_path_enrollments_no_self_supersession check (
    superseded_by_enrollment_id is null or superseded_by_enrollment_id <> id
  ),
  constraint study_path_enrollments_enrolled_at_finite check (
    enrolled_at <> 'infinity'::timestamptz
    and enrolled_at <> '-infinity'::timestamptz
  ),
  constraint study_path_enrollments_updated_at_valid check (
    updated_at <> 'infinity'::timestamptz
    and updated_at <> '-infinity'::timestamptz
    and updated_at >= enrolled_at
  ),
  constraint study_path_enrollments_paused_at_valid check (
    paused_at is null
    or (
      paused_at <> 'infinity'::timestamptz
      and paused_at <> '-infinity'::timestamptz
      and paused_at >= enrolled_at
      and paused_at <= updated_at
    )
  ),
  constraint study_path_enrollments_withdrawn_at_valid check (
    withdrawn_at is null
    or (
      withdrawn_at <> 'infinity'::timestamptz
      and withdrawn_at <> '-infinity'::timestamptz
      and withdrawn_at >= enrolled_at
      and withdrawn_at <= updated_at
    )
  ),
  constraint study_path_enrollments_superseded_at_valid check (
    superseded_at is null
    or (
      superseded_at <> 'infinity'::timestamptz
      and superseded_at <> '-infinity'::timestamptz
      and superseded_at >= enrolled_at
      and superseded_at <= updated_at
    )
  ),
  constraint study_path_enrollments_lifecycle_consistent check (
    (state <> 'paused' or paused_at is not null)
    and (state = 'withdrawn') = (withdrawn_at is not null)
    and (
      (
        state = 'superseded'
        and superseded_at is not null
        and superseded_by_enrollment_id is not null
      )
      or (
        state <> 'superseded'
        and superseded_at is null
        and superseded_by_enrollment_id is null
      )
    )
  )
);

create index study_path_enrollments_path_version_idx
on public.study_path_enrollments(path_id, path_version);

create index study_path_enrollments_superseded_by_idx
on public.study_path_enrollments(superseded_by_enrollment_id)
where superseded_by_enrollment_id is not null;

comment on table public.study_path_enrollments is
  'Owner-scoped enrollment pinned to an immutable Study Path version; contains no progress state.';
comment on column public.study_path_enrollments.paused_at is
  'Most recent pause time; retained after resume as lifecycle history.';

alter table public.study_path_enrollments enable row level security;

revoke all on table public.study_path_enrollments from public;
revoke all on table public.study_path_enrollments from anon;
revoke all on table public.study_path_enrollments from authenticated;
revoke all on table public.study_path_enrollments from service_role;
grant select on table public.study_path_enrollments to authenticated;
grant select on table public.study_path_enrollments to service_role;

create policy "study_path_enrollments_select_own"
on public.study_path_enrollments for select
to authenticated
using ((select auth.uid()) = user_id);

-- Enrollment identity and pinned version never change. Only active/paused rows
-- may move, and withdrawn/superseded rows are terminal.
create or replace function public.study_path_enrollments_enforce_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.path_id is distinct from old.path_id
    or new.path_version is distinct from old.path_version
    or new.enrolled_at is distinct from old.enrolled_at then
    raise exception 'study path enrollment identity and pinned version are immutable'
      using errcode = '22023';
  end if;

  if new.updated_at < old.updated_at then
    raise exception 'study path enrollment updated_at cannot move backwards'
      using errcode = '22023';
  end if;

  if old.state in ('withdrawn', 'superseded') and new is distinct from old then
    raise exception 'withdrawn and superseded enrollments are terminal'
      using errcode = '22023';
  end if;

  if new.state is distinct from old.state and not (
    (old.state = 'active' and new.state in ('paused', 'withdrawn', 'superseded'))
    or (old.state = 'paused' and new.state in ('active', 'withdrawn', 'superseded'))
  ) then
    raise exception 'invalid study path enrollment transition'
      using errcode = '22023';
  end if;

  if new.paused_at is distinct from old.paused_at
    and not (old.state = 'active' and new.state = 'paused') then
    raise exception 'paused_at may change only when pausing an active enrollment'
      using errcode = '22023';
  end if;

  if new.withdrawn_at is distinct from old.withdrawn_at
    and not (old.state in ('active', 'paused') and new.state = 'withdrawn') then
    raise exception 'withdrawn_at may change only during withdrawal'
      using errcode = '22023';
  end if;

  if (
    new.superseded_at is distinct from old.superseded_at
    or new.superseded_by_enrollment_id is distinct from old.superseded_by_enrollment_id
  ) and not (old.state in ('active', 'paused') and new.state = 'superseded') then
    raise exception 'supersession fields may change only during upgrade'
      using errcode = '22023';
  end if;

  if old.state in ('active', 'paused') and new.state = 'superseded' then
    perform 1
    from public.study_path_enrollments as target
    where target.id = new.superseded_by_enrollment_id
      and target.user_id = new.user_id
      and target.path_id = new.path_id
      and target.path_version <> new.path_version
      and target.state = 'active';

    if not found then
      raise exception 'supersession target must be an active enrollment for the same owner and path'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- PostgreSQL runs same-kind triggers in name order. This validation trigger is
-- intentionally after study_path_enrollments_set_updated_at so terminal rows
-- reject transitions and material mutations, including updated_at changes.
create trigger study_path_enrollments_validate_lifecycle
before update on public.study_path_enrollments
for each row execute function public.study_path_enrollments_enforce_lifecycle();

create trigger study_path_enrollments_set_updated_at
before update on public.study_path_enrollments
for each row execute function public.set_updated_at();

create or replace function public.enroll_study_path(
  p_path_id uuid,
  p_path_version integer
)
returns public.study_path_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_retired_at timestamptz;
  v_result public.study_path_enrollments;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_path_id is null or p_path_version is null then
    raise exception 'path identity and version must not be null' using errcode = '22004';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_path_id::text, 0)
  );

  select enrollments.*
  into v_result
  from public.study_path_enrollments as enrollments
  where enrollments.user_id = v_user_id
    and enrollments.path_id = p_path_id
    and enrollments.path_version = p_path_version
  for update;

  if found then
    if v_result.state in ('withdrawn', 'superseded') then
      raise exception 'terminal enrollment cannot be reactivated' using errcode = '22023';
    end if;
    return v_result;
  end if;

  select versions.retired_at
  into v_retired_at
  from public.study_path_versions as versions
  where versions.path_id = p_path_id and versions.version = p_path_version
  for share;

  if not found or v_retired_at is not null then
    raise exception 'study path version is unavailable for enrollment' using errcode = '22023';
  end if;

  insert into public.study_path_enrollments (user_id, path_id, path_version)
  values (v_user_id, p_path_id, p_path_version)
  on conflict (user_id, path_id, path_version) do nothing;

  select enrollments.* into v_result
  from public.study_path_enrollments as enrollments
  where enrollments.user_id = v_user_id
    and enrollments.path_id = p_path_id
    and enrollments.path_version = p_path_version;

  return v_result;
end;
$$;

create or replace function public.pause_study_path_enrollment(
  p_enrollment_id uuid
)
returns public.study_path_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.study_path_enrollments;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_enrollment_id is null then
    raise exception 'enrollment identity must not be null' using errcode = '22004';
  end if;

  select enrollments.* into v_result
  from public.study_path_enrollments as enrollments
  where enrollments.id = p_enrollment_id and enrollments.user_id = v_user_id
  for update;

  if not found then
    raise exception 'study path enrollment is unavailable' using errcode = '22023';
  end if;
  if v_result.state <> 'active' then
    raise exception 'only an active enrollment can be paused' using errcode = '22023';
  end if;

  update public.study_path_enrollments
  set state = 'paused', paused_at = pg_catalog.now()
  where id = v_result.id
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.resume_study_path_enrollment(
  p_enrollment_id uuid
)
returns public.study_path_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.study_path_enrollments;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_enrollment_id is null then
    raise exception 'enrollment identity must not be null' using errcode = '22004';
  end if;

  select enrollments.* into v_result
  from public.study_path_enrollments as enrollments
  where enrollments.id = p_enrollment_id and enrollments.user_id = v_user_id
  for update;

  if not found then
    raise exception 'study path enrollment is unavailable' using errcode = '22023';
  end if;
  if v_result.state <> 'paused' then
    raise exception 'only a paused enrollment can be resumed' using errcode = '22023';
  end if;

  update public.study_path_enrollments
  set state = 'active'
  where id = v_result.id
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.withdraw_study_path_enrollment(
  p_enrollment_id uuid
)
returns public.study_path_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.study_path_enrollments;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_enrollment_id is null then
    raise exception 'enrollment identity must not be null' using errcode = '22004';
  end if;

  select enrollments.* into v_result
  from public.study_path_enrollments as enrollments
  where enrollments.id = p_enrollment_id and enrollments.user_id = v_user_id
  for update;

  if not found then
    raise exception 'study path enrollment is unavailable' using errcode = '22023';
  end if;
  if v_result.state not in ('active', 'paused') then
    raise exception 'only an active or paused enrollment can be withdrawn' using errcode = '22023';
  end if;

  update public.study_path_enrollments
  set state = 'withdrawn', withdrawn_at = pg_catalog.now()
  where id = v_result.id
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.upgrade_study_path_enrollment(
  p_enrollment_id uuid,
  p_target_path_version integer
)
returns public.study_path_enrollments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_path_id uuid;
  v_retired_at timestamptz;
  v_source public.study_path_enrollments;
  v_target public.study_path_enrollments;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_enrollment_id is null or p_target_path_version is null then
    raise exception 'enrollment identity and target version must not be null' using errcode = '22004';
  end if;

  select enrollments.path_id into v_path_id
  from public.study_path_enrollments as enrollments
  where enrollments.id = p_enrollment_id and enrollments.user_id = v_user_id;

  if not found then
    raise exception 'study path enrollment is unavailable' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_path_id::text, 0)
  );

  select enrollments.* into v_source
  from public.study_path_enrollments as enrollments
  where enrollments.id = p_enrollment_id and enrollments.user_id = v_user_id
  for update;

  if v_source.state = 'superseded' then
    select enrollments.* into v_target
    from public.study_path_enrollments as enrollments
    where enrollments.id = v_source.superseded_by_enrollment_id
      and enrollments.user_id = v_user_id
      and enrollments.path_id = v_source.path_id
      and enrollments.path_version = p_target_path_version
      and enrollments.state = 'active'
    for update;
    if found then
      return v_target;
    end if;
    raise exception 'superseded enrollment cannot be upgraded again' using errcode = '22023';
  end if;

  if v_source.state not in ('active', 'paused') then
    raise exception 'only an active or paused enrollment can be upgraded' using errcode = '22023';
  end if;
  if p_target_path_version = v_source.path_version then
    raise exception 'upgrade target must be a different path version' using errcode = '22023';
  end if;

  select versions.retired_at into v_retired_at
  from public.study_path_versions as versions
  where versions.path_id = v_source.path_id
    and versions.version = p_target_path_version
  for share;

  if not found or v_retired_at is not null then
    raise exception 'target study path version is unavailable for enrollment' using errcode = '22023';
  end if;

  insert into public.study_path_enrollments (user_id, path_id, path_version)
  values (v_user_id, v_source.path_id, p_target_path_version)
  on conflict (user_id, path_id, path_version) do nothing;

  select enrollments.* into v_target
  from public.study_path_enrollments as enrollments
  where enrollments.user_id = v_user_id
    and enrollments.path_id = v_source.path_id
    and enrollments.path_version = p_target_path_version
  for update;

  if v_target.state = 'paused' then
    update public.study_path_enrollments
    set state = 'active'
    where id = v_target.id
    returning * into v_target;
  elsif v_target.state <> 'active' then
    raise exception 'terminal target enrollment cannot be reused' using errcode = '22023';
  end if;

  update public.study_path_enrollments
  set
    state = 'superseded',
    superseded_at = pg_catalog.now(),
    superseded_by_enrollment_id = v_target.id
  where id = v_source.id;

  return v_target;
end;
$$;

-- Trigger functions are not APIs.
revoke all on function public.study_path_enrollments_enforce_lifecycle() from public;
revoke all on function public.study_path_enrollments_enforce_lifecycle() from anon;
revoke all on function public.study_path_enrollments_enforce_lifecycle() from authenticated;
revoke all on function public.study_path_enrollments_enforce_lifecycle() from service_role;

-- SECURITY DEFINER is limited to authenticated callers. Every RPC derives its
-- owner from auth.uid(), uses fully qualified objects, and returns only that row.
revoke all on function public.enroll_study_path(uuid, integer) from public;
revoke all on function public.enroll_study_path(uuid, integer) from anon;
revoke all on function public.enroll_study_path(uuid, integer) from authenticated;
revoke all on function public.enroll_study_path(uuid, integer) from service_role;
grant execute on function public.enroll_study_path(uuid, integer) to authenticated;

revoke all on function public.pause_study_path_enrollment(uuid) from public;
revoke all on function public.pause_study_path_enrollment(uuid) from anon;
revoke all on function public.pause_study_path_enrollment(uuid) from authenticated;
revoke all on function public.pause_study_path_enrollment(uuid) from service_role;
grant execute on function public.pause_study_path_enrollment(uuid) to authenticated;

revoke all on function public.resume_study_path_enrollment(uuid) from public;
revoke all on function public.resume_study_path_enrollment(uuid) from anon;
revoke all on function public.resume_study_path_enrollment(uuid) from authenticated;
revoke all on function public.resume_study_path_enrollment(uuid) from service_role;
grant execute on function public.resume_study_path_enrollment(uuid) to authenticated;

revoke all on function public.withdraw_study_path_enrollment(uuid) from public;
revoke all on function public.withdraw_study_path_enrollment(uuid) from anon;
revoke all on function public.withdraw_study_path_enrollment(uuid) from authenticated;
revoke all on function public.withdraw_study_path_enrollment(uuid) from service_role;
grant execute on function public.withdraw_study_path_enrollment(uuid) to authenticated;

revoke all on function public.upgrade_study_path_enrollment(uuid, integer) from public;
revoke all on function public.upgrade_study_path_enrollment(uuid, integer) from anon;
revoke all on function public.upgrade_study_path_enrollment(uuid, integer) from authenticated;
revoke all on function public.upgrade_study_path_enrollment(uuid, integer) from service_role;
grant execute on function public.upgrade_study_path_enrollment(uuid, integer) to authenticated;
