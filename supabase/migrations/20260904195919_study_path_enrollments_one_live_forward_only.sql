-- Slice 4.1: one committed live version per owner/path; forward-only upgrade.
-- No history repair. Keep the original Slice 4 migration immutable.

-- Runner owns the transaction, including migration-history bookkeeping.
-- Hold until runner commit: no writer may race the audits or replacement rules.
lock table public.study_path_enrollments in access exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.study_path_enrollments
    where state in ('active', 'paused')
    group by user_id, path_id
    having count(*) > 1
  ) then
    raise exception 'Slice 4.1 precondition failed: multiple live enrollments for an owner/path; review history before retrying'
      using errcode = '23514';
  end if;

  -- A historical target need not still be active. Its identity/version must
  -- remain valid even after it pauses, withdraws, or is itself superseded.
  if exists (
    select 1
    from public.study_path_enrollments as source
    left join public.study_path_enrollments as target
      on target.id = source.superseded_by_enrollment_id
    where source.superseded_by_enrollment_id is not null
      and (
        target.id is null
        or target.user_id <> source.user_id
        or target.path_id <> source.path_id
        or target.path_version <= source.path_version
      )
  ) then
    raise exception 'Slice 4.1 precondition failed: invalid owner/path or non-forward supersession link; review history before retrying'
      using errcode = '23514';
  end if;
end;
$$;

-- Native B-tree UUID equality needs no extension. This constraint creates its
-- own partial index; exact-version UNIQUE remains immediate for ON CONFLICT.
alter table public.study_path_enrollments
  add constraint study_path_enrollments_one_live_per_path
  exclude using btree (user_id with =, path_id with =)
  where (state in ('active', 'paused'))
  deferrable initially deferred;

comment on constraint study_path_enrollments_one_live_per_path
  on public.study_path_enrollments is
  'At most one committed active/paused enrollment per user/path; deferred for atomic target-first upgrade. Different paths remain independent.';

create or replace function public.study_path_enrollments_enforce_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_establish_supersession boolean;
begin
  if tg_op = 'INSERT' then
    v_establish_supersession := new.state = 'superseded';
  else
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

    v_establish_supersession := old.state in ('active', 'paused')
      and new.state = 'superseded';
  end if;

  if v_establish_supersession then
    perform 1
    from public.study_path_enrollments as target
    where target.id = new.superseded_by_enrollment_id
      and target.id <> new.id
      and target.user_id = new.user_id
      and target.path_id = new.path_id
      and target.path_version > new.path_version
      and target.state = 'active'
    for share;

    if not found then
      raise exception 'supersession target must be an active enrollment for the same owner and path at a greater version'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- Same name preserves ordering after the existing set_updated_at UPDATE
-- trigger. INSERT branches before any OLD access; historical links are not
-- revalidated merely because their target later changes lifecycle state.
drop trigger study_path_enrollments_validate_lifecycle on public.study_path_enrollments;
create trigger study_path_enrollments_validate_lifecycle
before insert or update on public.study_path_enrollments
for each row execute function public.study_path_enrollments_enforce_lifecycle();

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

  -- Exact-version active/paused returns above stay idempotent. History in
  -- other terminal versions does not prohibit a fresh eligible enrollment.
  perform 1
  from public.study_path_enrollments as enrollments
  where enrollments.user_id = v_user_id
    and enrollments.path_id = p_path_id
    and enrollments.path_version <> p_path_version
    and enrollments.state in ('active', 'paused');

  if found then
    raise exception 'another live version of this study path exists; use explicit upgrade'
      using errcode = '22023';
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

  -- This also guards the successful repeat return below.
  if p_target_path_version <= v_source.path_version then
    raise exception 'upgrade target must be a greater path version' using errcode = '22023';
  end if;

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

-- Trigger function is not an API; replaced RPCs retain authenticated-only execution.
revoke all on function public.study_path_enrollments_enforce_lifecycle() from public;
revoke all on function public.study_path_enrollments_enforce_lifecycle() from anon;
revoke all on function public.study_path_enrollments_enforce_lifecycle() from authenticated;
revoke all on function public.study_path_enrollments_enforce_lifecycle() from service_role;

revoke all on function public.enroll_study_path(uuid, integer) from public;
revoke all on function public.enroll_study_path(uuid, integer) from anon;
revoke all on function public.enroll_study_path(uuid, integer) from authenticated;
revoke all on function public.enroll_study_path(uuid, integer) from service_role;
grant execute on function public.enroll_study_path(uuid, integer) to authenticated;

revoke all on function public.upgrade_study_path_enrollment(uuid, integer) from public;
revoke all on function public.upgrade_study_path_enrollment(uuid, integer) from anon;
revoke all on function public.upgrade_study_path_enrollment(uuid, integer) from authenticated;
revoke all on function public.upgrade_study_path_enrollment(uuid, integer) from service_role;
grant execute on function public.upgrade_study_path_enrollment(uuid, integer) to authenticated;
