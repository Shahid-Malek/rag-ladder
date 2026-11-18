import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levels } from '../src/data/levels.ts';
import { pillTravelDuration } from '../src/lib/controls.ts';

test('shared pill travel scales with distance, is symmetric and capped', () => {
  assert.equal(pillTravelDuration(0, 0), 380);
  assert.equal(pillTravelDuration(0, 6), 620);
  assert.equal(pillTravelDuration(6, 0), 620);
  assert.equal(pillTravelDuration(0, 20), 650);
});

test('all 17 stages carry bounded public technology descriptions without private configuration', () => {
  const stages = levels.flatMap((level) => level.stages);
  assert.equal(stages.length, 17);
  for (const stage of stages) {
    assert.ok(stage.tech.length >= 1 && stage.tech.length <= 4);
    for (const tech of stage.tech) {
      assert.ok(tech.name && tech.role);
      assert.ok(['library', 'service', 'custom code'].includes(tech.kind));
    }
    assert.doesNotMatch(
      JSON.stringify(stage),
      /https?:|api[_ -]?key|Bearer|\/v1\/|process\.env|Stage latency|Cost \/ query|temperature|top[_ -]?k/i,
    );
  }
  assert.ok(levels[2].stages[0].tech.some((tech) => tech.name === 'Docling'));
  assert.ok(levels[2].stages[2].tech.some((tech) => tech.name === 'Qdrant'));
});
