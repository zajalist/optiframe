begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
('018cf601-0000-4000-8000-000000000001','zejbadr@gmail.com',null,'{}'),
('018cf601-0000-4000-8000-000000000002','applicant@example.invalid',now(),'{"email":"zejbadr@gmail.com","isAdmin":true}');
set local role authenticated;
select set_config('request.jwt.claim.sub','018cf601-0000-4000-8000-000000000001',true);
do $$ begin
 if public.get_my_access()->>'status'<>'pending' or (public.get_my_access()->>'isAdmin')::boolean then raise exception 'Unverified owner gained access'; end if;
end $$;
select set_config('request.jwt.claim.sub','018cf601-0000-4000-8000-000000000002',true);
insert into public.waitlist_applications(platform,role,note,consent) values('both','tester','Application test',true);
do $$ begin
 if public.get_my_access()->>'status'<>'pending' or (public.get_my_access()->>'isAdmin')::boolean then raise exception 'Metadata granted access'; end if;
 begin
  perform public.admin_set_access('018cf601-0000-4000-8000-000000000002','approved');
  raise exception 'Applicant self-approved';
 exception when insufficient_privilege then null; end;
 begin
  update public.app_access set status='approved';
  raise exception 'Client changed access table';
 exception when insufficient_privilege then null; end;
 begin
  perform * from public.application_email_outbox;
  raise exception 'Client read private outbox';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update auth.users set email_confirmed_at=now() where id='018cf601-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','018cf601-0000-4000-8000-000000000001',true);
do $$ begin
 if public.get_my_access()->>'status'<>'approved' or not (public.get_my_access()->>'isAdmin')::boolean then raise exception 'Verified owner was not approved'; end if;
 if (select count(*) from public.admin_list_applications())<>1 then raise exception 'Admin review failed'; end if;
 perform public.admin_set_access('018cf601-0000-4000-8000-000000000002','approved');
end $$;
select set_config('request.jwt.claim.sub','018cf601-0000-4000-8000-000000000002',true);
do $$ begin
 if public.get_my_access()->>'status'<>'approved' then raise exception 'Approval did not take effect'; end if;
 if (select status from public.waitlist_applications)<>'approved' then raise exception 'Application state differs from access'; end if;
end $$;
update public.waitlist_applications set note='Updated preferences';
set local role service_role;
do $$ declare first_claim public.application_email_outbox; changed boolean; begin
 if (select count(*) from public.application_email_outbox)<>1 then raise exception 'Application did not enqueue exactly once'; end if;
 select * into first_claim from public.claim_application_emails('018cf601-0000-4000-8000-000000000002',1);
 if first_claim.payload->>'email'<>'applicant@example.invalid' then raise exception 'Outbox trusted forged metadata'; end if;
 if (select count(*) from public.claim_application_emails(null,5))<>0 then raise exception 'Active lease claimed twice'; end if;
 changed := public.finish_application_email(first_claim.id,gen_random_uuid(),'wrong-lease',null);
 if changed then raise exception 'Wrong lease finished an event'; end if;
 changed := public.finish_application_email(first_claim.id,first_claim.lease_token,'provider-test-id',null);
 if not changed then raise exception 'Valid delivery failed to complete'; end if;
 if (select count(*) from public.claim_application_emails(null,5))<>0 then raise exception 'Delivered event resent'; end if;
end $$;
-- Simulate a transient failure and expiry using trusted service-only maintenance.
update public.application_email_outbox set state='pending',sent_at=null,provider_id=null,next_attempt_at=now(),first_attempt_at=now();
do $$ declare retry public.application_email_outbox; begin
 select * into retry from public.claim_application_emails(null,1);
 if retry.id is null then raise exception 'Retry was not claimable'; end if;
 perform public.finish_application_email(retry.id,retry.lease_token,null,'Provider HTTP 503');
 if (select state from public.application_email_outbox)<>'pending' then raise exception 'Transient failure was not queued'; end if;
 if (select next_attempt_at from public.application_email_outbox)<=now() then raise exception 'Retry did not back off'; end if;
end $$;
update public.application_email_outbox set first_attempt_at=now()-interval '24 hours',next_attempt_at=now();
do $$ begin
 if (select count(*) from public.claim_application_emails(null,1))<>0 then raise exception 'Expired idempotency window resent'; end if;
 if (select state from public.application_email_outbox)<>'review' then raise exception 'Expired delivery was not visible for review'; end if;
end $$;
reset role;
update auth.users set email='former-owner@example.invalid' where id='018cf601-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','018cf601-0000-4000-8000-000000000001',true);
do $$ begin
 if public.get_my_access()->>'status'<>'pending' or (public.get_my_access()->>'isAdmin')::boolean then raise exception 'Former owner retained automatic access'; end if;
end $$;
set local role anon;
do $$ begin
 begin
  perform public.get_my_access();
  raise exception 'Anonymous access RPC allowed';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
