import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

for(const [file,firstUI] of [['simple.js',"const $ = id => document.getElementById(id);"],['app.js',"const panels = [...document.querySelectorAll('.lens-panel')];"]]) {
  test(`${file} awaits approved access before touching camera or app UI`,async()=>{
    const source=readFileSync(new URL(`./${file}`,import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'');
    const at=source.indexOf(firstUI);assert.ok(at>=0);
    const entry=source.slice(0,at);
    let allow,calls=0,initialized=false;
    const approval=new Promise(resolve=>{allow=resolve;});
    const context=vm.createContext({requireAppAccess:()=>{calls++;return approval;},initialize:()=>{initialized=true;}});
    const pending=vm.runInContext(`(async()=>{${entry}\ninitialize();})()`,context);
    await Promise.resolve();assert.equal(calls,1);assert.equal(initialized,false);
    allow();await pending;assert.equal(initialized,true);
    initialized=false;context.requireAppAccess=async()=>{throw Error('Approval pending');};
    await assert.rejects(vm.runInContext(`(async()=>{${entry}\ninitialize();})()`,context),/Approval pending/);
    assert.equal(initialized,false);
  });
}
