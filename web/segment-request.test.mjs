import test from 'node:test';
import assert from 'node:assert/strict';
import { requestLensSegmentation } from './segment-request.js';

test('captured still waits for the occupied GPU slot and returns the accepted outline', async () => {
  let calls = 0, notices = 0;
  const fetcher = async () => ++calls < 3
    ? { status: 503, ok: false, json: async () => ({ detail: 'Service busy. Retrying…' }) }
    : { status: 200, ok: true, json: async () => ({ contour: [[1, 2]], presence: { detected: true } }) };
  const result = await requestLensSegmentation(fetcher, new FormData(), {
    onBusy: () => notices++, pause: async () => {},
  });
  assert.equal(calls, 3);
  assert.equal(notices, 2);
  assert.equal(result.presence.detected, true);
});

test('captured still does not retry permanent or cancelled errors', async () => {
  let calls = 0;
  await assert.rejects(requestLensSegmentation(async () => {
    calls++;
    return { status: 422, ok: false, json: async () => ({ detail: 'Invalid lens box' }) };
  }, new FormData(), { pause: async () => {} }), /Invalid lens box/);
  assert.equal(calls, 1);
  await assert.rejects(requestLensSegmentation(async () => {
    calls++;
    return { status: 503, ok: false, json: async () => ({ detail: 'Service busy' }) };
  }, new FormData(), { isCurrent: () => false, pause: async () => {} }), /Capture cancelled/);
  assert.equal(calls, 1);
});
