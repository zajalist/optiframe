import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewScheduler} from './preview-scheduler.js';
function fixture() {
  let key = 'fit-a', valid = true, calls = 0, task, cancelled = new Set(), id = 0;
  const gate = createPreviewScheduler({snapshot:()=>{if(!valid) throw Error('Missing fitting');return key;},
    render:()=>{calls++;},setTimer:fn=>{task={id:++id,fn};return id;},clearTimer:n=>cancelled.add(n)});
  return {gate,set key(v){key=v;},set valid(v){valid=v;},get calls(){return calls;},
    get task(){return task;},run(){if(task&&!cancelled.has(task.id))task.fn();}};
}
test('valid fitting edits coalesce into one current preview',()=>{
  const f=fixture();f.gate.schedule();const old=f.task;f.key='fit-b';f.gate.schedule();
  old.fn();assert.equal(f.calls,0);f.run();assert.equal(f.calls,1);
});
test('missing measurements and changed snapshots never render',()=>{
  const f=fixture();f.valid=false;f.gate.schedule();assert.equal(f.task,undefined);
  f.valid=true;f.gate.schedule();f.key='changed without event';f.run();assert.equal(f.calls,0);
});
test('invalidating or manually building cancels delayed auto preview',()=>{
  const f=fixture();f.gate.schedule();const old=f.task;f.gate.cancel();old.fn();assert.equal(f.calls,0);
  f.gate.schedule();f.valid=false;f.run();assert.equal(f.calls,0);
});
test('a preview becoming hidden before the debounce fires does not render',()=>{
  let visible=true,calls=0,task;
  const gate=createPreviewScheduler({snapshot:()=> 'valid-fit',shouldRender:()=>visible,
    render:()=>{calls++;},setTimer:fn=>{task=fn;return 1;},clearTimer:()=>{}});
  gate.schedule();visible=false;task();assert.equal(calls,0);
  visible=true;gate.schedule();task();assert.equal(calls,1);
});
