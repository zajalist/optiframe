import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {captureOutlines,visualFitPayload,nativeTryOnFile} from './visual-fit.js';
import {loadConfirmedFace,saveConfirmedFace} from './face-confirmation.js';
const source=readFileSync(new URL('./try-on.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const points=Array.from({length:24},(_,i)=>[50+22*Math.cos(i*Math.PI/12),35+18*Math.sin(i*Math.PI/12)]);
const captures=['left','right'].map(side=>({side,image:'data:image/jpeg;base64,fixture',width:100,height:70,markers:[[0,0],[100,0],[100,70],[0,70]],contour:points}));
function run(items,search=''){
 const saved=new Map(Object.entries(items)),els=new Map(),writes=[],requests=[];
 const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>{writes.push(key);saved.set(key,value)}};
 const el=id=>{if(!els.has(id))els.set(id,{hidden:true,dataset:{},textContent:'',setAttribute(){},addEventListener(){}});return els.get(id)};
 const context=vm.createContext({document:{getElementById:el,querySelectorAll:()=>[]},location:{hash:'#access=test-key',search},sessionStorage:storage,loadConfirmedFace:()=>loadConfirmedFace(storage),saveConfirmedFace:value=>saveConfirmedFace(value,storage),captureOutlines,visualFitPayload,nativeTryOnFile,URLSearchParams,AbortController,setTimeout:()=>1,clearTimeout(){},window:{addEventListener(){}},fetch:(url,options)=>{requests.push({url,options,authenticated:false});return new Promise(()=>{})},apiFetch:(url,options)=>{requests.push({url,options,authenticated:true});return new Promise(()=>{})}});
 vm.runInContext(source,context);return{els,writes,requests,context};
}
const confirmed=JSON.stringify({left:30.1,right:30.2,source:'browser-iris-estimate',confirmed:true});
test('confirmed estimates with visual outlines alone lead to scanning lenses, never fitting',()=>{
 const env=run({'optiframe-face-estimate':confirmed,'optiframe-visual-outlines':JSON.stringify([points,points])});
 assert.equal(env.els.get('continue-fitting').href,'/index.html#access=test-key');assert.equal(env.els.get('continue-fitting').textContent,'Scan lenses');assert.equal(env.els.get('face-result').hidden,false);assert.deepEqual(env.writes,[]);
 const body=JSON.parse(env.requests.find(r=>r.url==='/api/frame-preview').options.body);assert.equal(body.settings.alignment_source,'illustrative');assert.notEqual(body.settings.left_pd,30.1);assert.notEqual(body.settings.right_pd,30.2);
});
test('actual capture pair exposes authenticated fitting link and leaves image bytes untouched',()=>{
 const env=run({'optiframe-face-estimate':confirmed,'optiframe-captures':JSON.stringify(captures)});
 assert.equal(env.els.get('continue-fitting').href,'/studio.html?v=43#access=test-key');assert.equal(env.els.get('continue-fitting').textContent,'Continue fitting');assert.deepEqual(env.writes,[]);
});
test('incomplete or image-free captures cannot expose Continue fitting',()=>{
 for(const invalid of [captures.slice(0,1),captures.map(item=>({...item,image:undefined})),captures.map(item=>({...item,width:0}))]){
  const env=run({'optiframe-face-estimate':confirmed,'optiframe-captures':JSON.stringify(invalid)});assert.equal(env.els.get('continue-fitting').textContent,'Scan lenses');
 }
});

test('landing demo entry uses only the public selected assembly even with private captures stored',()=>{
 const env=run({'optiframe-captures':JSON.stringify(captures),'optiframe-visual-outlines':JSON.stringify([points,points])},'?demo=1&style=bold');
 assert.equal(env.requests.length,1);assert.equal(env.requests[0].url,'/assets/demo-bold.json?v=43');
 assert.equal(env.requests[0].options.headers,undefined);assert.equal(env.requests[0].options.body,undefined);
 assert.equal(env.requests[0].authenticated,false);
 assert.equal(env.els.get('source').textContent,'Sample frames · Visual preview');assert.deepEqual(env.writes,[]);
});

test('custom outlines use the authenticated API wrapper rather than public fetch',()=>{
 const env=run({'optiframe-visual-outlines':JSON.stringify([points,points])});
 assert.equal(env.requests[0].url,'/api/frame-preview');assert.equal(env.requests[0].authenticated,true);
 assert.equal(env.requests[0].options.headers['X-OptiFrame-Key'],undefined);
});
test('first-time visitors and unavailable custom captures have a public demo without account or generation',()=>{
 const env=run({});assert.equal(env.requests[0].url,'/assets/demo-classic.json?v=43');
 assert.equal(env.requests.some(request=>request.url.startsWith('/api/')),false);
});
test('saved catalog style is reused and arbitrary style query values cannot select asset paths',()=>{
 assert.equal(run({'optiframe-frame-style':'brow'}).requests[0].url,'/assets/demo-brow.json?v=43');
 assert.equal(run({},'?demo=1&style=../../private').requests[0].url,'/assets/demo-classic.json?v=43');
});
