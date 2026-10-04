import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('./frame-catalog.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export function','function').replace('import.meta.url',JSON.stringify(new URL('./frame-catalog.js',import.meta.url).href));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(visualTryOn){
  function element(){return {children:[],dataset:{},attrs:{},handlers:{},style:{setProperty(){}},classList:{add(){}},setAttribute(k,v){this.attrs[k]=v;},append(...items){this.children.push(...items);},prepend(item){this.children.unshift(item);},cloneNode(){return element();},addEventListener(k,f){this.handlers[k]=f;}};}
  const body=element(),viewer=element(),status=element(),head=element();
  const pending=[],calls=[];let selected='classic',assembly=null,retention='screw',updates=0,disconnected=false;
  viewer.dataset.stale='true';
  const context=vm.createContext({URL,catalogConcepts:'data:image/webp;base64,fixture',document:{head,querySelector:()=>null,createElement:element,createElementNS:()=>element()},MutationObserver:class{observe(){}disconnect(){disconnected=true;}}});
  vm.runInContext(source,context);
  const cleanup=context.mountFrameCatalog({body,viewer,status,panels:[],getStyle:()=>selected,setStyle(value){selected=value;assembly=null;viewer.dataset.stale='true';},getRetention:()=>retention,setRetention(value){retention=value;assembly=null;viewer.dataset.stale='true';},getAssembly:()=>assembly,rebuild(){calls.push(selected+'/'+retention);return new Promise((resolve,reject)=>pending.push({resolve:()=>{assembly={style:selected,retentionStyle:retention};viewer.dataset.stale='false';resolve();},reject}));},onUpdate(){updates++;},leftPd:()=>32,rightPd:()=>32,visualTryOn});
  const choices=body.children.find(el=>el.className==='frame-catalog'),actions=body.children.find(el=>el.className==='catalog-actions');
  return {head,choices,actions,retention:actions.children[0],tryOn:actions.children[1],retry:actions.children[2],status,pending,calls,cleanup,get selected(){return selected;},get updates(){return updates;},get disconnected(){return disconnected;}};
}

test('catalog uses a single local stylesheet and shows three named styles with honest concept context',async()=>{
  const h=harness();assert.equal(h.head.children.length,1);assert.match(h.head.children[0].href,/frame-catalog\.css\?v=31$/);
  assert.deepEqual(h.choices.children.map(x=>x.dataset.style),['classic','bold','brow']);
  assert.equal(h.choices.attrs['aria-describedby'],'catalog-concepts-label');
  assert.equal(h.choices.attrs['aria-busy'],'true');
  assert.ok(h.choices.children.every(x=>x.disabled));assert.equal(h.tryOn.disabled,true);
  h.pending.shift().resolve();await tick();assert.equal(h.choices.attrs['aria-busy'],'false');
  assert.equal(h.choices.children[0].attrs['aria-pressed'],'true');assert.equal(h.tryOn.disabled,false);
});

test('style selection invalidates old preview and blocks overlapping rebuilds until the new assembly is ready',async()=>{
  const h=harness();h.pending.shift().resolve();await tick();
  const request=h.choices.children[1].handlers.click();
  assert.equal(h.selected,'bold');assert.equal(h.tryOn.disabled,true);
  assert.equal(h.choices.children[1].attrs['aria-pressed'],'true');
  await h.choices.children[2].handlers.click();assert.equal(h.selected,'bold');assert.deepEqual(h.calls,['classic/screw','bold/screw']);
  h.pending.shift().resolve();await request;assert.equal(h.tryOn.disabled,false);
  const brow=h.choices.children[2].handlers.click();h.pending.shift().resolve();await brow;
  assert.deepEqual(h.calls,['classic/screw','bold/screw','brow/screw']);assert.equal(h.choices.children[2].attrs['aria-pressed'],'true');
});

test('build failure exposes retry and keeps try-on disabled instead of displaying an old assembly',async()=>{
  const h=harness();h.pending.shift().reject(new Error('Frame unavailable'));await tick();
  assert.equal(h.status.textContent,'Frame unavailable');assert.equal(h.retry.hidden,false);assert.equal(h.tryOn.disabled,true);
  const retry=h.retry.handlers.click();h.pending.shift().resolve();await retry;
  assert.equal(h.retry.hidden,true);assert.equal(h.tryOn.disabled,false);
});

test('leaving catalog disconnects observer and ignores an unfinished build result',async()=>{
  const h=harness();h.cleanup();const before=h.updates;h.pending.shift().resolve();await tick();
  assert.equal(h.disconnected,true);assert.equal(h.updates,before);
});

test('invalid print measurements do not block independent visual try-on',async()=>{
  let opened=0;const h=harness(()=>opened++);
  h.pending.shift().reject(new Error('The outer rims overlap'));await tick();
  assert.equal(h.tryOn.disabled,false);assert.equal(h.tryOn.textContent,'Just try on');
  await h.tryOn.handlers.click();assert.equal(opened,1);
  assert.equal(h.status.textContent,'The outer rims overlap');
});
test('switching retention rebuilds the actual assembly and invalidates try-on until ready',async()=>{
 const h=harness();h.pending.shift().resolve();await tick();
 const pending=h.retention.children[1].handlers.click();assert.equal(h.tryOn.disabled,true);
 assert.equal(h.retention.children[1].attrs['aria-pressed'],'true');
 assert.deepEqual(h.calls,['classic/screw','classic/snap']);
 h.pending.shift().resolve();await pending;assert.equal(h.tryOn.disabled,false);
});
