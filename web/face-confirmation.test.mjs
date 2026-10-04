import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedFaceValues, saveConfirmedFace, loadConfirmedFace} from './face-confirmation.js';
test('only reviewed values persist, with source and no face data', () => {
  let stored; const storage={setItem:(key,value)=>{stored=value;},getItem:()=>stored};
  const estimate={left:31.5,right:32.4,source:'browser-iris-estimate',landmarks:[1,2,3]};
  assert.equal(confirmedFaceValues(estimate),null);
  saveConfirmedFace(estimate,storage);
  assert.deepEqual(loadConfirmedFace(storage),{left:31.5,right:32.4,source:'browser-iris-estimate',confirmed:true});
  assert.equal(stored.includes('landmarks'),false);
});
test('malformed, unsupported and out of range estimates are rejected', () => {
  for(const change of [{left:NaN},{left:19},{right:41},{left:'31'},{source:'accurate'},{confirmed:false}])
    assert.equal(confirmedFaceValues({left:31,right:32,source:'browser-iris-estimate',confirmed:true,...change}),null);
  assert.equal(loadConfirmedFace({getItem:()=>'{broken'}),null);
  assert.throws(()=>saveConfirmedFace({left:10,right:32,source:'browser-iris-estimate'}, {setItem:()=>assert.fail()}));
});
