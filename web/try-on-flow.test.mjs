import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {captureOutlines,visualFitPayload,nativeTryOnFile} from './visual-fit.js';
import {loadConfirmedFace,saveConfirmedFace} from './face-confirmation.js';
const source=readFileSync(new URL('./try-on.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const points=Array.from({length:24},(_,i)=>[50+22*Math.cos(i*Math.PI/12),35+18*Math.sin(i*Math.PI/12)]);
const captures=['left','right'].map(side=>({side,image:'data:image/jpeg;base64,fixture',width:100,height:70,markers:[[0,0],[100,0],[100,70],[0,70]],contour:points}));
function run(items){
 const saved=new Map(Object.entries(items)),els=new Map(),writes=[],requests=[];
 const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>{writes.push(key);saved.set(key,value)}};
 const el=id=>{if(!els.has(id))els.set(id,{hidden:true,dataset:{},textContent:'',setAttribute(){},addEventListener(){}});return els.get(id)};
 const context=vm.createContext({document:{getElementById:el,querySelectorAll:()=>[]},location:{hash:'#access=test-key'},sessionStorage:storage,loadConfirmedFace:()=>loadConfirmedFace(storage),saveConfirmedFace:value=>saveConfirmedFace(value,storage),captureOutlines,visualFitPayload,nativeTryOnFile,URLSearchParams,AbortController,setTimeout:()=>1,clearTimeout(){},window:{addEventListener(){}},fetch:(url,options)=>{requests.push({url,options});return new Promise(()=>{})}});
 vm.runInContext(source,context);return{els,writes,requests,context};
}
const confirmed=JSON.stringify({left:30.1,right:30.2,source:'browser-iris-estimate',confirmed:true});
test('confirmed estimates with visual outlines alone lead to scanning lenses, never fitting',()=>{
 const env=run({'optiframe-face-estimate':confirmed,'optiframe-visual-outlines':JSON.stringify([points,points])});
 assert.equal(env.els.get('continue-fitting').href,'/#access=test-key');assert.equal(env.els.get('continue-fitting').textContent,'Scan lenses');assert.equal(env.els.get('face-result').hidden,false);assert.deepEqual(env.writes,[]);
 const body=JSON.parse(env.requests.find(r=>r.url==='/api/frame-preview').options.body);assert.equal(body.settings.alignment_source,'illustrative');assert.notEqual(body.settings.left_pd,30.1);assert.notEqual(body.settings.right_pd,30.2);
});
test('actual capture pair exposes authenticated fitting link and leaves image bytes untouched',()=>{
 const env=run({'optiframe-face-estimate':confirmed,'optiframe-captures':JSON.stringify(captures)});
 assert.equal(env.els.get('continue-fitting').href,'/studio.html?v=39#access=test-key');assert.equal(env.els.get('continue-fitting').textContent,'Continue fitting');assert.deepEqual(env.writes,[]);
});
test('incomplete or image-free captures cannot expose Continue fitting',()=>{
 for(const invalid of [captures.slice(0,1),captures.map(item=>({...item,image:undefined})),captures.map(item=>({...item,width:0}))]){
  const env=run({'optiframe-face-estimate':confirmed,'optiframe-captures':JSON.stringify(invalid)});assert.equal(env.els.get('continue-fitting').textContent,'Scan lenses');
 }
});
