-- Managed Supabase Auth owns credentials. No passwords or access tokens live here.
begin;

create table public.profiles (
  id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.waitlist_applications (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  platform text not null check (platform in ('iphone', 'android', 'both')),
  role text check (role in ('tester', 'provider', 'designer')),
  note text not null default '' check (char_length(note) <= 500),
  consent boolean not null check (consent = true),
  consented_at timestamptz not null default now(),
  status text not null default 'waitlisted' check (status in ('waitlisted', 'invited', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep server timestamps authoritative; changing preferences does not invent new consent.
create function public.account_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.account_updated_at() from public, anon, authenticated;
create trigger profiles_updated_at before update on public.profiles
for each row execute function public.account_updated_at();
create trigger waitlist_updated_at before update on public.waitlist_applications
for each row execute function public.account_updated_at();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.waitlist_applications enable row level security;
alter table public.waitlist_applications force row level security;

-- Row ownership alone cannot protect approval/status columns: use column grants too.
revoke all on public.profiles, public.waitlist_applications from public, anon, authenticated;
grant select on public.profiles, public.waitlist_applications to authenticated;
grant insert (display_name), update (display_name) on public.profiles to authenticated;
grant insert (platform, role, note, consent) on public.waitlist_applications to authenticated;
grant update (platform, role, note, consent) on public.waitlist_applications to authenticated;
grant delete on public.waitlist_applications to authenticated;
grant all on public.profiles, public.waitlist_applications to service_role;

create policy profiles_read_self on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy profiles_create_self on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);
create policy profiles_update_self on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy applications_read_self on public.waitlist_applications for select to authenticated
using ((select auth.uid()) = user_id);
create policy applications_create_self on public.waitlist_applications for insert to authenticated
with check ((select auth.uid()) = user_id and consent = true and status = 'waitlisted');
create policy applications_update_self on public.waitlist_applications for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and consent = true);
create policy applications_withdraw_self on public.waitlist_applications for delete to authenticated
using ((select auth.uid()) = user_id);

commit;
