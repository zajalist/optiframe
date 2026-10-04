import test from 'node:test';
import assert from 'node:assert/strict';
import { pupilGeometry } from './pupil-geometry.js';

test('frontal pupil markers preserve wearer sides and independent distances', () => {
  const left = pupilGeometry('34.5', 'left'), right = pupilGeometry('28', 'right');
  assert.equal(left.x, 229); assert.equal(right.x, 104);
  assert.equal(left.label, '34.5 mm'); assert.equal(right.label, '28 mm');
  assert.equal(pupilGeometry('35', 'left').x - left.x, 1);
});
test('empty and invalid fields never display invented measurements', () => {
  for (const value of ['', ' ', 'abc', '0', '19.9', '40.1', 'Infinity']) {
    const result = pupilGeometry(value, 'left');
    assert.equal(result.valid, false); assert.equal(result.label, '');
  }
  assert.equal(pupilGeometry('20', 'right').valid, true);
  assert.equal(pupilGeometry('40', 'left').valid, true);
});
