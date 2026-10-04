import test from 'node:test';
import assert from 'node:assert/strict';
import {thicknessGeometry} from './thickness-measurements.js';
test('edge cross-section scales independently with measured thickness',()=>{
  assert.equal(thicknessGeometry('6').height/thicknessGeometry('1').height,6);
  assert.equal(thicknessGeometry('2.5').label,'2.5 mm');
  assert.equal(thicknessGeometry('1').height,12);
});
test('empty, invalid and out-of-range values never invent geometry',()=>{
  for(const value of ['', ' ', 'abc', '0', '6.1', Infinity])assert.equal(thicknessGeometry(value).valid,false);
});
