begin;

create table public.app_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  source text not null default 'application' check (source in ('application','owner','admin')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.app_access enable row level security;
alter table public.app_access force row level security;
revoke all on public.app_access from public,anon,authenticated;
grant select on public.app_access to authenticated;
grant all on public.app_access to service_role;
create policy access_read_self on public.app_access for select to authenticated
using ((select auth.uid()) = user_id);

create function public.is_verified_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users where id=auth.uid()
    and email_confirmed_at is not null and lower(btrim(email))='zejbadr@gmail.com');
$$;
revoke all on function public.is_verified_owner() from public,anon,authenticated;

create function public.sync_account_access() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner_verified boolean;
begin
  owner_verified := new.email_confirmed_at is not null and lower(btrim(new.email))='zejbadr@gmail.com';
  insert into public.app_access(user_id,status,source)
  values(new.id,case when owner_verified then 'approved' else 'pending' end,
    case when owner_verified then 'owner' else 'application' end)
  on conflict(user_id) do update set
    status=case when owner_verified then 'approved' when app_access.source='owner' then 'pending' else app_access.status end,
    source=case when owner_verified then 'owner' when app_access.source='owner' then 'application' else app_access.source end,
    updated_at=now();
  return new;
end;
$$;
revoke all on function public.sync_account_access() from public,anon,authenticated;
create trigger optiframe_account_access after insert or update of email,email_confirmed_at on auth.users
for each row execute function public.sync_account_access();
insert into public.app_access(user_id,status,source)
select id,case when email_confirmed_at is not null and lower(btrim(email))='zejbadr@gmail.com' then 'approved' else 'pending' end,
case when email_confirmed_at is not null and lower(btrim(email))='zejbadr@gmail.com' then 'owner' else 'application' end
from auth.users;

create function public.get_my_access() returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('status',coalesce((select status from public.app_access where user_id=auth.uid()),'pending'),
   'isAdmin',public.is_verified_owner());
$$;
revoke all on function public.get_my_access() from public,anon;
grant execute on function public.get_my_access() to authenticated;

alter table public.waitlist_applications drop constraint waitlist_applications_status_check;
alter table public.waitlist_applications alter column status set default 'pending';
update public.waitlist_applications w set status=a.status from public.app_access a where a.user_id=w.user_id;
alter table public.waitlist_applications add constraint waitlist_applications_status_check check(status in ('pending','approved','rejected'));
revoke delete on public.waitlist_applications from authenticated;
drop policy applications_withdraw_self on public.waitlist_applications;
drop policy applications_create_self on public.waitlist_applications;
create policy applications_create_self on public.waitlist_applications for insert to authenticated
with check ((select auth.uid())=user_id and consent=true);

create table public.application_email_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  payload jsonb not null,
  state text not null default 'pending' check(state in ('pending','sending','sent','review')),
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  provider_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.application_email_outbox enable row level security;
alter table public.application_email_outbox force row level security;
revoke all on public.application_email_outbox from public,anon,authenticated;
grant all on public.application_email_outbox to service_role;
create index application_outbox_pending on public.application_email_outbox(next_attempt_at) where state in ('pending','sending');

create function public.prepare_application() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from auth.users where id=new.user_id and email_confirmed_at is not null and email is not null) then
    raise exception 'Confirm your email before applying' using errcode='42501';
  end if;
  new.status := coalesce((select status from public.app_access where user_id=new.user_id),'pending');
  return new;
end;
$$;
create function public.enqueue_application_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.application_email_outbox(user_id,payload)
  select new.user_id,jsonb_build_object('email',u.email,'platform',new.platform,'role',new.role,'note',new.note,
    'submittedAt',new.created_at,'status',new.status)
  from auth.users u where u.id=new.user_id
  on conflict(user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.prepare_application(),public.enqueue_application_email() from public,anon,authenticated;
create trigger prepare_application before insert on public.waitlist_applications for each row execute function public.prepare_application();
create trigger queue_application_email after insert on public.waitlist_applications for each row execute function public.enqueue_application_email();
-- Existing applications are also notified once after enabling this feature.
insert into public.application_email_outbox(user_id,payload)
select w.user_id,jsonb_build_object('email',u.email,'platform',w.platform,'role',w.role,'note',w.note,'submittedAt',w.created_at,'status',w.status)
from public.waitlist_applications w join auth.users u on u.id=w.user_id
where u.email_confirmed_at is not null on conflict(user_id) do nothing;

create function public.admin_list_applications(p_limit integer default 50,p_offset integer default 0)
returns table(user_id uuid,email text,platform text,role text,note text,status text,created_at timestamptz,consented_at timestamptz,notification_state text,notification_attempts integer,notification_error text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_verified_owner() then raise exception 'Administrator access required' using errcode='42501'; end if;
  return query select w.user_id,u.email::text,w.platform,w.role,w.note,a.status,w.created_at,w.consented_at,o.state,o.attempts,o.last_error
    from public.waitlist_applications w join auth.users u on u.id=w.user_id join public.app_access a on a.user_id=w.user_id
    left join public.application_email_outbox o on o.user_id=w.user_id
    order by w.created_at desc,w.user_id limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
end;
$$;
create function public.admin_set_access(p_user_id uuid,p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_verified_owner() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_status not in ('pending','approved','rejected') then raise exception 'Invalid access status' using errcode='22023'; end if;
  if exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null and lower(btrim(email))='zejbadr@gmail.com') then
    raise exception 'Owner access is managed automatically' using errcode='22023';
  end if;
  update public.app_access set status=p_status,source='admin',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where user_id=p_user_id;
  if not found then raise exception 'Account not found' using errcode='22023'; end if;
  update public.waitlist_applications set status=p_status where user_id=p_user_id;
  return jsonb_build_object('userId',p_user_id,'status',p_status);
end;
$$;
revoke all on function public.admin_list_applications(integer,integer),public.admin_set_access(uuid,text) from public,anon;
grant execute on function public.admin_list_applications(integer,integer),public.admin_set_access(uuid,text) to authenticated;

-- Service-only leased claims allow cron and immediate submission nudges to race safely.
create function public.claim_application_emails(p_user_id uuid default null,p_limit integer default 5)
returns setof public.application_email_outbox language plpgsql security definer set search_path = '' as $$
begin
  update public.application_email_outbox set state='review',last_error='Delivery requires review after retry window'
    where state in ('pending','sending') and (first_attempt_at < now()-interval '23 hours' or attempts>=8)
      and (lease_until is null or lease_until < now());
  return query with candidates as (
    select id from public.application_email_outbox where (p_user_id is null or user_id=p_user_id)
      and next_attempt_at<=now() and (state='pending' or (state='sending' and lease_until<now()))
      order by created_at for update skip locked limit least(greatest(p_limit,1),5)
  ) update public.application_email_outbox o set state='sending',attempts=o.attempts+1,
    first_attempt_at=coalesce(o.first_attempt_at,now()),lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
    from candidates c where o.id=c.id returning o.*;
end;
$$;
create function public.finish_application_email(p_id uuid,p_lease_token uuid,p_provider_id text default null,p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.application_email_outbox set state=case when p_provider_id is not null then 'sent' else 'pending' end,
    sent_at=case when p_provider_id is not null then now() else null end,provider_id=p_provider_id,
    last_error=left(p_error,120),lease_until=null,lease_token=null,
    next_attempt_at=now()+make_interval(secs=>least(3600,60*(2^least(attempts,6))::integer))
    where id=p_id and lease_token=p_lease_token and state='sending';
  return found;
end;
$$;
revoke all on function public.claim_application_emails(uuid,integer),public.finish_application_email(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_application_emails(uuid,integer),public.finish_application_email(uuid,uuid,text,text) to service_role;

commit;
