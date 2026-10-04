import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationHandler} from './application-notifications.mjs';
import {verifyApprovedBearer} from './_lib/supabase-access.mjs';

const token='x'.repeat(40);
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-key',SUPABASE_SERVICE_ROLE_KEY:'private-service-key',RESEND_API_KEY:'private-mail-key',RESEND_FROM:'OptiFrame <access@example.com>',CRON_SECRET:'private-cron-secret'};
const row={id:'event-1',lease_token:'lease-1',payload:{email:'applicant@example.com',platform:'both',role:'tester',note:'Lens work',submittedAt:'2026-10-03'}};
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}};}
function fetchFixture({status='pending',rows=[row],mailStatus=200}={}){
  const calls=[];
  const fetcher=async(url,options={})=>{
    calls.push([url,options]);
    const body=url.endsWith('/auth/v1/user')?{id:'user-a',email:'zejbadr@gmail.com',email_confirmed_at:'2026-10-03'}:
      url.endsWith('/get_my_access')?{status,isAdmin:false}:
      url.endsWith('/claim_application_emails')?rows:
      url.endsWith('/finish_application_email')?true:{id:'provider-id'};
    return {ok:!url.includes('api.resend') || mailStatus===200,status:url.includes('api.resend')?mailStatus:200,json:async()=>body};
  };
  return {fetcher,calls};
}
test('approved guard relies on verified server status, not owner-looking email',async()=>{
  const f=fetchFixture();await assert.rejects(verifyApprovedBearer({headers:{authorization:'Bearer '+token}},{env,fetcher:f.fetcher}),error=>error.status===403);
  const approved=fetchFixture({status:'approved'});assert.equal((await verifyApprovedBearer({headers:{authorization:'Bearer '+token}},{env,fetcher:approved.fetcher})).access.status,'approved');
  await assert.rejects(verifyApprovedBearer({headers:{}},{env,fetcher:f.fetcher}),error=>error.status===401);
});
test('unauthenticated worker calls and non-cron GET never claim outbox rows',async()=>{
  const f=fetchFixture(),handler=createNotificationHandler({env,fetcher:f.fetcher});
  for(const req of [{method:'POST',headers:{}},{method:'GET',headers:{authorization:'Bearer '+token}}]){const res=response();await handler(req,res);assert.equal(res.statusCode,401);}
  assert.equal(f.calls.length,0);
});
test('user nudge can send only its own authoritative outbox event to the fixed owner',async()=>{
  const f=fetchFixture(),res=response();
  await createNotificationHandler({env,fetcher:f.fetcher})({method:'POST',headers:{authorization:'Bearer '+token},body:{userId:'victim',to:'attacker@example.com'}},res);
  assert.equal(res.statusCode,200);assert.deepEqual(res.body,{sent:1,queued:0});
  const claim=f.calls.find(([url])=>url.endsWith('/claim_application_emails'));assert.deepEqual(JSON.parse(claim[1].body),{p_user_id:'user-a',p_limit:1});
  const mail=f.calls.find(([url])=>url==='https://api.resend.com/emails');assert.deepEqual(JSON.parse(mail[1].body).to,['zejbadr@gmail.com']);assert.equal(mail[1].headers['Idempotency-Key'],'optiframe-application/event-1');
  assert.equal(JSON.stringify(res.body).includes('private'),false);
});
test('cron claims a bounded batch; delivered events returned empty never resend',async()=>{
  const f=fetchFixture({rows:[]}),res=response();await createNotificationHandler({env,fetcher:f.fetcher})({method:'GET',headers:{authorization:'Bearer '+env.CRON_SECRET}},res);
  assert.deepEqual(JSON.parse(f.calls[0][1].body),{p_user_id:null,p_limit:3});assert.deepEqual(res.body,{sent:0,queued:0});assert.equal(f.calls.length,1);
});
test('provider failure returns event to durable retry queue without exposing provider response',async()=>{
  const f=fetchFixture({mailStatus:503}),res=response();await createNotificationHandler({env,fetcher:f.fetcher})({method:'POST',headers:{authorization:'Bearer '+token}},res);
  const finish=f.calls.find(([url])=>url.endsWith('/finish_application_email'));const value=JSON.parse(finish[1].body);
  assert.equal(value.p_provider_id,null);assert.equal(value.p_error,'Provider HTTP 503');assert.deepEqual(res.body,{sent:0,queued:1});
});
test('missing email credentials leaves queue unclaimed',async()=>{
  const f=fetchFixture(),res=response();await createNotificationHandler({env:{...env,RESEND_API_KEY:''},fetcher:f.fetcher})({method:'POST',headers:{authorization:'Bearer '+token}},res);
  assert.equal(res.statusCode,503);assert.equal(f.calls.some(([url])=>url.endsWith('/claim_application_emails')),false);
});
