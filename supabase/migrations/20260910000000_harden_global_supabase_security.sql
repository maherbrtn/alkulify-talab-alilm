-- Migration: 20260910000000_harden_global_supabase_security.sql
-- Global Supabase security hardening:
-- 1. Revoke direct EXECUTE on public.handle_new_user() from PUBLIC, anon, authenticated, and service_role.
--    This does not alter or remove the existing auth.users trigger; handle_new_user() remains SECURITY DEFINER.
-- 2. Conditionally revoke EXECUTE on public.rls_auto_enable() if it exists on hosted.
--    If absent (e.g. clean local replay), the migration proceeds without error.
-- 3. Align public.profiles policies (select, insert, update) to the optimized (select auth.uid()) = id form
--    to prevent per-row re-evaluation and eliminate Supabase Advisor auth_rls_initplan warnings.

-- A. Revoke direct execute on public.handle_new_user()
revoke execute on function public.handle_new_user() from public, anon, authenticated, service_role;

-- B. Conditionally revoke execute on public.rls_auto_enable() if present
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn_signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', r.fn_signature);
  end loop;
end;
$$;

-- C. Align profiles RLS policies via ALTER POLICY to use optimized (select auth.uid()) = id
alter policy "profiles_select_own"
  on public.profiles
  using ((select auth.uid()) = id);

alter policy "profiles_insert_own"
  on public.profiles
  with check ((select auth.uid()) = id);

alter policy "profiles_update_own"
  on public.profiles
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
