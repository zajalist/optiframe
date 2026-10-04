import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiFetch} from './api-fetch.js';
const location={href:'https://optiframe.zajalist.com/index.html',origin:'https://optiframe.zajalist.com',hash:''};
test('approved browser token travels only to same-site API',async()=>{
  let sent;
  const fetch=createApiFetch({location,token:async()=>'test-jwt',fetcher:async(url,options)=>{sent={url,...options};return {ok:true};}});
  const controller=new AbortController();
  await fetch('/api/segment',{method:'POST',body:'photo',signal:controller.signal,headers:{'Accept':'application/json'}});
  assert.equal(sent.headers.get('Authorization'),'Bearer test-jwt');assert.equal(sent.headers.get('Accept'),'application/json');assert.equal(sent.body,'photo');assert.equal(sent.signal,controller.signal);
  await assert.rejects(fetch('https://other.example/api/segment'),/stay on this site/);
  await assert.rejects(fetch('/assets/file'),/stay on this site/);
});
test('missing session fails before uploading any image',async()=>{
  const fetch=createApiFetch({location,token:async()=>null,fetcher:()=>assert.fail('Must not upload')});
  await assert.rejects(fetch('/api/segment'),/approved account/);
});
test('existing private test key bypasses public login but never crosses origins',async()=>{
  let headers;
  const fetch=createApiFetch({location:{...location,hash:'#access=test-only-key'},token:()=>assert.fail('No auth lookup for private key'),fetcher:async(_,options)=>{headers=options.headers;}});
  await fetch('/api/frame');assert.equal(headers.get('X-OptiFrame-Key'),'test-only-key');assert.equal(headers.get('Authorization'),null);
  await assert.rejects(fetch('https://untrusted.example/api/frame'));
});
