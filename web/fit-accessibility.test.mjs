import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeMark,moveMark,numericError} from './fit-accessibility.js';

test('keyboard starting points remain provisional until explicit provider review',()=>{
  const panel={points:[[10,20],[110,20],[110,80],[10,80]],markReview:{}};
  assert.deepEqual(initializeMark(panel,'optical'),[60,50]);
  assert.equal(panel.illustrativeAlignment,'marking');
  assert.equal(panel.markReview.optical,false);
  assert.deepEqual(initializeMark(panel,'top'),[60,20]);
  assert.equal(panel.markReview.top,false);
});
test('keyboard initialization preserves existing captured marks and review',()=>{
  const panel={opticalCentre:[12,34],markReview:{optical:true},illustrativeAlignment:false};
  assert.deepEqual(initializeMark(panel,'optical'),[12,34]);
  assert.equal(panel.markReview.optical,true);
  assert.equal(panel.illustrativeAlignment,false);
});
test('numeric repair instructions cover blank, thickness bounds, offsets and printer minimum',()=>{
  const field={value:'',min:'1',max:'6',step:'0.1',validity:{}};
  assert.match(numericError(field),/Enter a measurement/);
  assert.match(numericError({...field,value:'7',validity:{rangeOverflow:true}}),/1 to 6 mm/);
  assert.match(numericError({...field,value:'-11',min:'-10',max:'10',validity:{rangeUnderflow:true}}),/-10 to 10 mm/);
  assert.match(numericError({...field,value:'99',min:'100',max:'',validity:{rangeUnderflow:true}}),/at least 100 mm/);
  assert.equal(numericError({...field,value:'2.5'}),'');
  assert.match(numericError({...field,value:'2.55',validity:{stepMismatch:true}}),/increments of 0.1 mm/);
});
test('fine and coarse movement target the current mark and stay inside the image',()=>{
  const panel={canvas:{width:100,height:80},opticalCentre:[50,40],topMark:[50,5]};
  assert.equal(moveMark(panel,'optical',-1,0),true);
  assert.deepEqual(panel.opticalCentre,[49,40]);
  moveMark(panel,'optical',0,1,5);
  assert.deepEqual(panel.opticalCentre,[49,45]);
  moveMark(panel,'top',0,-1,5);moveMark(panel,'top',0,-1,5);
  assert.deepEqual(panel.topMark,[50,0]);
  panel.topMark=[99,79];moveMark(panel,'top',1,1,5);
  assert.deepEqual(panel.topMark,[100,80]);
  assert.equal(moveMark({canvas:panel.canvas},'optical',1,0),false);
});
