import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipelineScrollPlan } from '../src/lib/pipeline.ts';

test('pipeline scroll gives every tall card room to read before the next handoff', () => {
  const plan = pipelineScrollPlan([900, 450, 1200], 600);
  assert.equal(plan.height, 600);
  assert.deepEqual(plan.reading, [300, 0, 600]);
  assert.deepEqual(plan.stops, [0, 930, 1560]);
  assert.equal(plan.duration, 2340);
  for (let i = 0; i < plan.stops.length - 1; i++) {
    assert.equal(
      plan.stops[i + 1] - plan.stops[i],
      plan.reading[i] + plan.hold + plan.travel,
    );
  }
  assert.equal(
    plan.duration - plan.stops.at(-1),
    plan.reading.at(-1) + plan.hold,
  );
  assert.deepEqual(pipelineScrollPlan([400, 500], 800).reading, [0, 0]);
  assert.equal(pipelineScrollPlan([400], 100).height, 200);
});
