-- Run as database owner after the migration, in a disposable/staging Supabase DB.
-- No pgTAP extension required. Any missing protection raises an exception.
begin;
insert into auth.users(id,email) values
('018cf600-0000-4000-8000-000000000001','rls-a@example.invalid'),
('018cf600-0000-4000-8000-000000000002','rls-b@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub','018cf600-0000-4000-8000-000000000001',true);
insert into public.waitlist_applications(platform,consent) values ('iphone',true);
insert into public.profiles(display_name) values ('RLS test A');
do $$ begin
  if (select count(*) from public.waitlist_applications) <> 1 then raise exception 'Owner cannot read own row'; end if;
  begin
    update public.waitlist_applications set status='approved';
    raise exception 'Client changed administrative status';
  exception when insufficient_privilege then null; end;
  begin
    update public.waitlist_applications set consented_at='2020-01-01';
    raise exception 'Client forged consent timestamp';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.waitlist_applications(user_id,platform,consent)
    values ('018cf600-0000-4000-8000-000000000002','android',true);
    raise exception 'Client supplied a foreign owner';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','018cf600-0000-4000-8000-000000000002',true);
do $$ declare changed integer; begin
  if (select count(*) from public.waitlist_applications) <> 0 then raise exception 'Cross-account data exposed'; end if;
  if (select count(*) from public.profiles) <> 0 then raise exception 'Cross-account profile exposed'; end if;
  update public.waitlist_applications set platform='both';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Cross-account row updated'; end if;
  begin
    insert into public.waitlist_applications(platform,consent) values ('android',false);
    raise exception 'Missing consent was accepted';
  exception when check_violation or insufficient_privilege then null; end;
  begin
    insert into public.waitlist_applications(platform,consent,status) values ('android',true,'approved');
    raise exception 'Client inserted approval';
  exception when insufficient_privilege then null; end;
end $$;
insert into public.waitlist_applications(platform,consent) values ('android',true);
update public.waitlist_applications set platform='both',note='Updated by owner';
do $$ begin
  if (select platform from public.waitlist_applications) <> 'both' then raise exception 'Owner update failed'; end if;
end $$;
set local role service_role;
update public.waitlist_applications set status='invited' where user_id='018cf600-0000-4000-8000-000000000002';
set local role authenticated;
update public.waitlist_applications set note='Preferences remain editable after invitation';
do $$ begin
  if (select status from public.waitlist_applications) <> 'invited' then raise exception 'Owner edit changed administrative status'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform * from public.waitlist_applications;
    raise exception 'Anonymous application read allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.profiles;
    raise exception 'Anonymous profile read allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
