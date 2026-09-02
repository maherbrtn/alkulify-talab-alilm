-- Minimal publication registry for immutable Study Path curriculum versions.
-- Git remains canonical; this table stores identity, digest, and lifecycle only.
create table public.study_path_versions (
  path_id uuid not null,
  version integer not null,
  definition_digest text not null,
  published_at timestamptz not null,
  retired_at timestamptz,
  constraint study_path_versions_pkey primary key (path_id, version),
  constraint study_path_versions_version_positive check (version > 0),
  constraint study_path_versions_digest_sha256 check (
    definition_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint study_path_versions_published_at_finite check (
    published_at <> 'infinity'::timestamptz
    and published_at <> '-infinity'::timestamptz
  ),
  constraint study_path_versions_retirement_valid check (
    retired_at is null
    or (
      retired_at <> 'infinity'::timestamptz
      and retired_at <> '-infinity'::timestamptz
      and retired_at >= published_at
    )
  )
);

comment on table public.study_path_versions is
  'Minimal publication identity/digest registry; canonical curriculum remains in Git.';

alter table public.study_path_versions enable row level security;

revoke all on table public.study_path_versions from public;
revoke all on table public.study_path_versions from anon;
revoke all on table public.study_path_versions from authenticated;
revoke all on table public.study_path_versions from service_role;
grant select on table public.study_path_versions to service_role;

-- Published identity, digest, and publication time are immutable. Retirement is
-- a one-way lifecycle transition and never rewrites or removes the version.
create or replace function public.study_path_versions_enforce_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.path_id is distinct from old.path_id
    or new.version is distinct from old.version
    or new.definition_digest is distinct from old.definition_digest
    or new.published_at is distinct from old.published_at then
    raise exception 'published study path identity and digest are immutable'
      using errcode = '22023';
  end if;

  if old.retired_at is not null
    and new.retired_at is distinct from old.retired_at then
    raise exception 'study path retirement is immutable'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger study_path_versions_enforce_immutability
before update on public.study_path_versions
for each row execute function public.study_path_versions_enforce_immutability();

create or replace function public.study_path_versions_reject_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'published study path versions must be retired, not deleted'
    using errcode = '22023';
end;
$$;

create trigger study_path_versions_reject_delete
before delete on public.study_path_versions
for each row execute function public.study_path_versions_reject_delete();

revoke all on function public.study_path_versions_enforce_immutability() from public;
revoke all on function public.study_path_versions_enforce_immutability() from anon;
revoke all on function public.study_path_versions_enforce_immutability() from authenticated;
revoke all on function public.study_path_versions_enforce_immutability() from service_role;
revoke all on function public.study_path_versions_reject_delete() from public;
revoke all on function public.study_path_versions_reject_delete() from anon;
revoke all on function public.study_path_versions_reject_delete() from authenticated;
revoke all on function public.study_path_versions_reject_delete() from service_role;
