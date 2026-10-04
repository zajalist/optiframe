import test from 'node:test';
import assert from 'node:assert/strict';
import {createCameraTorch} from './camera-torch.js';

function camera(capability=true) {
  let enabled=false;
  const calls=[];
  return {calls,readyState:'live',getCapabilities:()=>({torch:capability}),
    getSettings:()=>({torch:enabled}),getConstraints:()=>({width:1280,advanced:[{focusMode:'continuous',torch:false}]}),
    async applyConstraints(value){calls.push(value);enabled=value.torch;}};
}
test('torch toggles on the existing track and preserves camera constraints',async()=>{
  const track=camera(),torch=createCameraTorch();torch.attach(track);
  assert.equal(await torch.set(true),true);
  assert.equal(torch.state.enabled,true);
  assert.equal(track.calls[0].width,1280);
  assert.equal(track.calls[0].advanced[0].focusMode,'continuous');
  assert.equal('torch' in track.calls[0].advanced[0],false);
  assert.equal(await torch.set(false),true);assert.equal(torch.state.enabled,false);
});
test('unsupported camera does not attempt constraints',async()=>{
  const track=camera(false),torch=createCameraTorch();torch.attach(track);
  assert.equal(await torch.set(true),false);assert.equal(track.calls.length,0);
});
test('constraint rejection and silently ignored changes are reported',async()=>{
  for(const apply of [async()=>{throw new Error('unsupported');},async()=>{}]) {
    const track=camera(),torch=createCameraTorch();track.applyConstraints=apply;torch.attach(track);
    assert.equal(await torch.set(true),false);assert.equal(torch.state.enabled,false);
    assert.match(torch.state.error,/unavailable/);assert.equal(torch.state.busy,false);
  }
});
test('detaching turns off the torch and a late enable cannot restore it',async()=>{
  const track=camera();let finish;
  const apply=track.applyConstraints.bind(track);
  track.applyConstraints=value=>value.torch ? new Promise(resolve=>{finish=()=>{apply(value);resolve();};}) : apply(value);
  const torch=createCameraTorch();torch.attach(track);const pending=torch.set(true);
  torch.attach(null);finish();await pending;
  assert.equal(track.getSettings().torch,false);assert.equal(torch.state.supported,false);
});
test('hung hardware releases busy state and late success is turned off',async()=>{
  const track=camera();let finish;
  const apply=track.applyConstraints.bind(track);
  track.applyConstraints=value=>value.torch ? new Promise(resolve=>{finish=()=>{apply(value);resolve();};}) : apply(value);
  const torch=createCameraTorch(()=>{},15);torch.attach(track);
  assert.equal(await torch.set(true),false);assert.equal(torch.state.busy,false);
  assert.equal(torch.state.supported,false);finish();await Promise.resolve();
  assert.equal(track.getSettings().torch,false);
});
