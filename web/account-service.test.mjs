import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountService,validateApplication,validateConfig} from './account-service.js';

const configuration={supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'sb_publishable_example_public_key_123',googleEnabled:true};
const application={platform:'both',role:'tester',note:'Test lenses',consent:true};
function fixture({user=null, signupSession=true, signupError=null}={}) {
  let row=null, stored=new Map(), calls=[], fetchCount=0;
  const auth={
    getUser:async()=>({data:{user}}),
    getSession:async()=>({data:{session:user?{access_token:'test-token'}:null}}),
    signUp:async value=>{calls.push(['signup',value]);if(signupSession&&!signupError) user={id:'user-a',email:value.email};return {data:{session:signupSession?{}:null},error:signupError};},
    signInWithPassword:async value=>{calls.push(['login',value]);user={id:'user-a',email:value.email};return {error:null};},
    signInWithOAuth:async value=>{calls.push(['oauth',value]);return {};},
    signOut:async()=>{user=null;return {};},
    resetPasswordForEmail:async(...args)=>{calls.push(['reset',...args]);return {};},
    updateUser:async value=>{calls.push(['update-user',value]);return {};},
  };
  const api={auth,async rpc(name,args){calls.push(['rpc',name,args]);return {data:{status:'pending',isAdmin:false}};},from(table){assert.equal(table,'waitlist_applications');let action='read',value,filter;
    const query={select(){return query;},eq(column,id){filter=[column,id];return query;},insert(input){action='insert';value=input;return query;},update(input){action='update';value=input;return query;},async maybeSingle(){calls.push(['read',filter]);return {data:row};},async single(){calls.push([action,value,filter]);row={...value,status:'pending',consented_at:'2026-10-03',created_at:'2026-10-03',updated_at:'2026-10-03'};return {data:row};}};return query;}};
  const service=createAccountService({fetcher:async()=>{fetchCount++;return {ok:true,json:async()=>configuration};},importSdk:async()=>({createClient:(url,key,options)=>{calls.push(['client',url,key,options]);return api;}}),location:{origin:'https://optiframe.example',href:'https://optiframe.example/account.html',search:''},storage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)}});
  return {service,calls,stored,auth,get fetchCount(){return fetchCount;}};
}

test('rejects secret keys, malformed configuration and unsafe origins',()=>{
  assert.equal(validateConfig(configuration).googleEnabled,true);
  for(const value of [{...configuration,supabasePublishableKey:'sb_secret_this_must_never_be_public'},{...configuration,supabaseUrl:'http://example.com'},{...configuration,supabaseUrl:'https://user:pass@example.com'},{...configuration,supabaseUrl:'https://example.com/?x=y'}]) assert.throws(()=>validateConfig(value));
  const jwt=role=>'eyJ.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
  assert.throws(()=>validateConfig({...configuration,supabasePublishableKey:jwt('service_role')}));
  assert.ok(validateConfig({...configuration,supabasePublishableKey:jwt('anon')}));
});
test('only allowlisted application fields cross the API boundary',()=>{
  assert.deepEqual(validateApplication({...application,status:'approved',user_id:'victim',consented_at:'forged'}),application);
  for(const value of [{...application,consent:'true'},{...application,platform:'all'},{...application,role:'admin'},{...application,note:'x'.repeat(501)}]) assert.throws(()=>validateApplication(value));
});
test('anonymous state does not read the database or write an application',async()=>{
  const f=fixture();assert.equal((await f.service.loadAccount()).user,null);
  await assert.rejects(f.service.saveApplication(application),/Sign in/);
  assert.equal(f.calls.some(c=>c[0]==='read'),false);assert.equal(f.fetchCount,1);
});
test('confirmed signup inserts only application columns and reports the stored row',async()=>{
  const f=fixture();const result=await f.service.signUp({email:'a@example.com',password:'long-password',application});
  assert.equal(result.user.id,'user-a');assert.equal(result.application.status,'pending');
  assert.deepEqual(f.calls.find(c=>c[0]==='insert')[1],application);
  const options=f.calls.find(c=>c[0]==='client')[3];assert.equal(options.auth.flowType,'pkce');
});
test('confirmation-required signup saves no application until authenticated',async()=>{
  const f=fixture({signupSession:false});const result=await f.service.signUp({email:'a@example.com',password:'long-password',application});
  assert.deepEqual(result,{user:null,application:null,needsEmailConfirmation:true});
  assert.equal(f.calls.some(c=>c[0]==='insert'),false);
  assert.equal([...f.stored.values()].join('').includes('long-password'),false);
  const signed=await f.service.signIn({email:'a@example.com',password:'long-password'});
  assert.equal(signed.application.platform,'both');assert.equal(f.stored.size,0);
});
test('updates filter by the authenticated owner and retain administrative status control',async()=>{
  const f=fixture({user:{id:'user-a',email:'a@example.com'}});
  await f.service.saveApplication(application);await f.service.saveApplication({...application,platform:'iphone',status:'approved'});
  const update=f.calls.find(c=>c[0]==='update');assert.deepEqual(update[2],['user_id','user-a']);assert.equal('status' in update[1],false);
});
test('OAuth uses fixed same-origin account callback and retains only validated application',async()=>{
  const f=fixture();await f.service.signInWithGoogle({...application,password:'secret'});
  assert.deepEqual(f.calls.find(c=>c[0]==='oauth')[1],{provider:'google',options:{redirectTo:'https://optiframe.example/account.html'}});
  assert.equal([...f.stored.values()].join('').includes('secret'),false);
});
test('managed reset uses recovery callback and password update requires authenticated user',async()=>{
  const f=fixture();await f.service.requestPasswordReset('a@example.com');
  assert.equal(f.calls.find(c=>c[0]==='reset')[2].redirectTo,'https://optiframe.example/account.html?recovery=1');
  await assert.rejects(f.service.updatePassword('a-new-password'),/valid password reset/);
  await f.service.signIn({email:'a@example.com',password:'long-password'});
  assert.deepEqual(await f.service.updatePassword('a-new-password'),{updated:true});
  assert.deepEqual(await f.service.signOut(),{user:null,application:null});
});
test('auth failure text never repeats provider credential details',async()=>{
  const f=fixture({signupError:{message:'a@example.com already exists'}});
  await assert.rejects(f.service.signUp({email:'a@example.com',password:'long-password'}),error=>!error.message.includes('a@example.com') && !error.message.includes('exists'));
});
