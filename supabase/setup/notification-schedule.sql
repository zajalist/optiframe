-- Run once as project owner AFTER migrations and Vercel email configuration.
-- Enable Supabase Cron (pg_cron), pg_net, and Vault in the dashboard first.
-- In Vault, create name optiframe_notification_cron_secret with exactly the same
-- random secret as Vercel CRON_SECRET. Never paste that secret into this file.
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='optiframe_notification_cron_secret' and length(decrypted_secret)>=32) then
    raise exception 'Create the notification secret in Vault first (at least 32 characters)';
  end if;
end $$;

select cron.schedule('optiframe-application-email-retry','*/5 * * * *',$job$
  select net.http_post(
    url:='https://optiframe.zajalist.com/api/application-notifications',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(
      select decrypted_secret from vault.decrypted_secrets where name='optiframe_notification_cron_secret' limit 1
    )),
    body:='{}'::jsonb,
    timeout_milliseconds:=60000
  );
$job$);

-- cron.schedule updates a job with the same name; it does not create duplicates.
-- Inspect Supabase Cron job history and net._http_response for delivery problems.
-- A daily Vercel cron alone is NOT an adequate retry schedule for the 23h window.
