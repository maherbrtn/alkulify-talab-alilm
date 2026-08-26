-- Per-student lesson playback progress. Mutations are deliberately RPC-only so
-- clients cannot bypass the monotonic merge rules with direct table writes.
create table public.lesson_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_key uuid not null,
  position_seconds double precision not null,
  duration_seconds double precision not null,
  completed boolean not null default false,
  client_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lesson_progress_pkey primary key (user_id, lesson_key),
  constraint lesson_progress_position_range check (
    position_seconds >= 0 and position_seconds <= 31536000
  ),
  constraint lesson_progress_duration_range check (
    duration_seconds >= 0 and duration_seconds <= 31536000
  ),
  constraint lesson_progress_position_within_duration check (
    (duration_seconds = 0 and position_seconds = 0)
    or
    (duration_seconds > 0 and position_seconds <= duration_seconds)
  ),
  constraint lesson_progress_client_updated_at_finite check (
    client_updated_at <> 'infinity'::timestamptz
    and client_updated_at <> '-infinity'::timestamptz
  )
);

comment on column public.lesson_progress.completed is
  'Sticky client completion signal (including the client''s 90% rule); intentionally not derived from duration.';
comment on constraint lesson_progress_position_range on public.lesson_progress is
  'Rejects NaN, infinity, negative values, and playback positions over one year.';
comment on constraint lesson_progress_duration_range on public.lesson_progress is
  'Rejects NaN, infinity, negative values, and media durations over one year.';

alter table public.lesson_progress enable row level security;

revoke all on table public.lesson_progress from anon;
revoke all on table public.lesson_progress from public;
revoke all on table public.lesson_progress from authenticated;
grant select on table public.lesson_progress to authenticated;

drop policy if exists "lesson_progress_select_own" on public.lesson_progress;
create policy "lesson_progress_select_own"
on public.lesson_progress for select
to authenticated
using ((select auth.uid()) = user_id);

-- These policies are defense-in-depth for owner-scoped writes. Authenticated
-- clients have no INSERT or UPDATE table grant; all mutation goes through the RPC.
drop policy if exists "lesson_progress_insert_own" on public.lesson_progress;
create policy "lesson_progress_insert_own"
on public.lesson_progress for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "lesson_progress_update_own" on public.lesson_progress;
create policy "lesson_progress_update_own"
on public.lesson_progress for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.lesson_progress_reject_user_id_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'lesson_progress.user_id is immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists lesson_progress_reject_user_id_change on public.lesson_progress;
create trigger lesson_progress_reject_user_id_change
before update on public.lesson_progress
for each row execute function public.lesson_progress_reject_user_id_change();

-- Reuse the timestamp trigger established by the profiles migration. Neither
-- created_at nor updated_at is accepted by the only client mutation entrypoint.
drop trigger if exists lesson_progress_set_updated_at on public.lesson_progress;
create trigger lesson_progress_set_updated_at
before update on public.lesson_progress
for each row execute function public.set_updated_at();

create or replace function public.merge_lesson_progress(
  p_lesson_key uuid,
  p_position_seconds double precision,
  p_duration_seconds double precision,
  p_completed boolean,
  p_client_updated_at timestamptz
)
returns public.lesson_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.lesson_progress;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_lesson_key is null
    or p_position_seconds is null
    or p_duration_seconds is null
    or p_completed is null
    or p_client_updated_at is null then
    raise exception 'lesson progress arguments must not be null' using errcode = '22004';
  end if;

  if p_client_updated_at > now() + interval '10 minutes' then
    raise exception 'client_updated_at is implausibly far in the future' using errcode = '22007';
  end if;

  insert into public.lesson_progress (
    user_id,
    lesson_key,
    position_seconds,
    duration_seconds,
    completed,
    client_updated_at
  ) values (
    v_user_id,
    p_lesson_key,
    p_position_seconds,
    p_duration_seconds,
    p_completed,
    p_client_updated_at
  )
  on conflict (user_id, lesson_key) do update
  set
    position_seconds = greatest(
      public.lesson_progress.position_seconds,
      excluded.position_seconds
    ),
    duration_seconds = greatest(
      public.lesson_progress.duration_seconds,
      excluded.duration_seconds
    ),
    completed = public.lesson_progress.completed or excluded.completed,
    client_updated_at = greatest(
      public.lesson_progress.client_updated_at,
      excluded.client_updated_at
    )
  returning * into v_result;

  return v_result;
end;
$$;

-- SECURITY DEFINER is required because authenticated has SELECT-only table
-- access. The empty search_path, fully qualified objects, auth.uid()-derived
-- owner, fixed argument types, and constrained table keep that privilege narrow.
revoke all on function public.merge_lesson_progress(
  uuid, double precision, double precision, boolean, timestamptz
) from public;
revoke all on function public.merge_lesson_progress(
  uuid, double precision, double precision, boolean, timestamptz
) from anon;
grant execute on function public.merge_lesson_progress(
  uuid, double precision, double precision, boolean, timestamptz
) to authenticated;
