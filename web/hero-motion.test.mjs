import test from 'node:test';
import assert from 'node:assert/strict';
import {mountHeroMotion,heroMotionSource} from './hero-motion.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function eventTarget(extra={}) {
  const events=new Map();
  return Object.assign({addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener(name,fn){events.get(name)?.delete(fn);},emit(name,value={}){for(const fn of events.get(name)||[])fn(value);},listenerCount(){return [...events.values()].reduce((n,s)=>n+s.size,0);}},extra);
}
function harness({reduce=false,saveData=false,hidden=false,fetcher,play,source='/assets/motion.mp4'}={}) {
  let observe,fetches=0,plays=0,pauses=0,disconnects=0;
  const classes=new Set(),videos=[];
  const button=eventTarget({hidden:false,dataset:{},attrs:{},setAttribute(k,v){this.attrs[k]=v;}});
  const container={classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},append(video){videos.push(video);},getBoundingClientRect:()=>({top:80,bottom:620})};
  const reduced=eventTarget({matches:reduce}),connection=eventTarget({saveData});
  const doc=eventTarget({hidden,createElement(){return eventTarget({setAttribute(){},removeAttribute(k){delete this[k];},play(){plays++;return play?.()??Promise.resolve();},pause(){pauses++;},load(){},remove(){this.removed=true;}});}});
  const win=eventTarget({innerHeight:700,location:{href:'https://optiframe.test/welcome.html'},matchMedia:()=>reduced});
  const cleanup=mountHeroMotion({container,button,doc,win,connection,fetcher:(...args)=>{fetches++;return fetcher?.(...args)??Promise.resolve({ok:true,json:async()=>({src:source})});},observe:callback=>{observe=callback;return {observe(){},disconnect(){disconnects++;}};}});
  return {button,classes,videos,reduced,connection,doc,win,cleanup,visible(value=true){observe([{isIntersecting:value}]);},get fetches(){return fetches;},get plays(){return plays;},get pauses(){return pauses;},get disconnects(){return disconnects;}};
}

test('hero loads once when visible and shows video only after playback starts',async()=>{
  let resolvePlay;const h=harness({play:()=>new Promise(resolve=>resolvePlay=resolve)});
  assert.equal(h.fetches,0);h.visible();await tick();assert.equal(h.fetches,1);
  assert.equal(h.classes.has('has-motion'),false);assert.equal(h.videos[0].preload,'metadata');
  assert.equal(h.videos[0].muted,true);assert.equal(h.videos[0].playsInline,true);assert.equal(h.videos[0].loop,true);
  resolvePlay();await tick();assert.equal(h.classes.has('has-motion'),true);assert.equal(h.button.attrs['aria-label'],'Pause animation');
  h.visible();await tick();assert.equal(h.fetches,1);assert.equal(h.plays,1);h.cleanup();
});
test('reduced motion, data saving and hidden pages never fetch decorative video',async()=>{
  for(const options of [{reduce:true},{saveData:true},{hidden:true}]){const h=harness(options);h.visible();await tick();assert.equal(h.fetches,0);assert.equal(h.videos.length,0);h.cleanup();}
});
test('offscreen and hidden page pause, return resumes without another fetch',async()=>{
  const h=harness();h.visible();await tick();h.visible(false);assert.ok(h.pauses>0);
  h.visible(true);await tick();assert.equal(h.plays,2);h.doc.hidden=true;h.doc.emit('visibilitychange');
  h.doc.hidden=false;h.doc.emit('visibilitychange');await tick();assert.equal(h.plays,3);assert.equal(h.fetches,1);h.cleanup();
});
test('explicit pause stays paused after visibility changes and resumes only by control',async()=>{
  const h=harness();h.visible();await tick();h.button.emit('click');assert.equal(h.button.attrs['aria-label'],'Play animation');
  h.visible(false);h.visible(true);await tick();assert.equal(h.plays,1);
  h.button.emit('click');await tick();assert.equal(h.plays,2);h.cleanup();
});
test('dynamic reduced motion restores poster and stops playback',async()=>{
  const h=harness();h.visible();await tick();h.reduced.matches=true;h.reduced.emit('change');
  assert.equal(h.classes.has('has-motion'),false);assert.equal(h.button.hidden,true);
  h.reduced.matches=false;h.reduced.emit('change');await tick();assert.equal(h.plays,2);h.cleanup();
});
test('autoplay rejection keeps poster and offers an explicit play retry',async()=>{
  let denied=true;const h=harness({play:()=>denied?Promise.reject(new Error('blocked')):Promise.resolve()});
  h.visible();await tick();assert.equal(h.classes.has('has-motion'),false);assert.equal(h.button.hidden,false);assert.equal(h.button.attrs['aria-label'],'Play animation');
  h.visible();await tick();assert.equal(h.plays,1);denied=false;h.button.emit('click');await tick();assert.equal(h.classes.has('has-motion'),true);h.cleanup();
});
test('missing configuration and failed asset keep the static poster silently',async()=>{
  const empty=harness({source:null});empty.visible();await tick();assert.equal(empty.videos.length,0);assert.equal(empty.button.hidden,true);empty.cleanup();
  const h=harness();h.visible();await tick();h.videos[0].emit('error');assert.equal(h.classes.has('has-motion'),false);assert.equal(h.button.hidden,true);assert.equal(h.videos[0].removed,true);h.visible();await tick();assert.equal(h.fetches,1);h.cleanup();
});
test('pending download is aborted when data-saving activates; stale response cannot create video',async()=>{
  let resolve,signal;const h=harness({fetcher:(_url,options)=>{signal=options.signal;return new Promise(r=>resolve=r);}});
  h.visible();h.connection.saveData=true;h.connection.emit('change');assert.equal(signal.aborted,true);
  resolve({ok:true,json:async()=>({src:'/assets/motion.mp4'})});await tick();assert.equal(h.videos.length,0);h.cleanup();
});
test('pagehide pauses and bfcache pageshow resumes; disposal removes lifecycle listeners',async()=>{
  const h=harness();h.visible();await tick();h.win.emit('pagehide');h.win.emit('pageshow');await tick();assert.equal(h.plays,2);
  h.cleanup();assert.equal(h.disconnects,1);assert.equal(h.doc.listenerCount(),0);assert.equal(h.win.listenerCount(),0);assert.equal(h.reduced.listenerCount(),0);assert.equal(h.connection.listenerCount(),0);assert.equal(h.button.hidden,true);
});
test('hero source rejects executable and external insecure URLs',()=>{
  const base='https://optiframe.test/welcome.html';
  for(const src of ['javascript:alert(1)','data:video/mp4;base64,x','http://untrusted.test/x.mp4',null])assert.equal(heroMotionSource(src,base),null);
  assert.equal(heroMotionSource('/assets/hero.mp4',base),'https://optiframe.test/assets/hero.mp4');
  assert.equal(heroMotionSource('https://cdn.example/hero.mp4',base),'https://cdn.example/hero.mp4');
});
