import test from 'node:test';
import assert from 'node:assert/strict';
import {lensAdjustmentDiagram} from './lens-adjustment-controls.js';

const pair={left:[[-12,-8],[15,-6],[11,10]],right:[[-9,-7],[10,-8],[12,8]]};
test('adjustment diagram uses patient front view and actual PD/offset values at two SVG units per mm',()=>{
  const result=lensAdjustmentDiagram(pair,{leftPd:30,rightPd:34,leftOffset:2,rightOffset:-3});
  assert.equal(result.left.pupilX,220);assert.equal(result.right.pupilX,92);
  assert.deepEqual(result.left.points,[[244,68],[190,72],[198,104]]);
  assert.deepEqual(result.right.points,[[110,80],[72,78],[68,110]]);
});
test('diagram never substitutes default dimensions for missing patient measurements',()=>{
  for(const field of ['leftPd','rightPd','leftOffset','rightOffset']){
    const values={leftPd:30,rightPd:34,leftOffset:0,rightOffset:0,[field]:''};
    assert.equal(lensAdjustmentDiagram(pair,values),null);
  }
  assert.equal(lensAdjustmentDiagram(pair,{leftPd:10,rightPd:34,leftOffset:0,rightOffset:0}),null);
});
test('missing or invalid outlines cannot produce a correction preview',()=>{
  for(const broken of [null,{...pair,left:[]},{...pair,right:[[NaN,1],[2,3],[4,5]]}])
    assert.equal(lensAdjustmentDiagram(broken,{leftPd:30,rightPd:34,leftOffset:0,rightOffset:0}),null);
});
