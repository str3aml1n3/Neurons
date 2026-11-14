// Headless checks for web/brain.js. Run with: node tests/brain.test.mjs
import assert from 'node:assert/strict';
import { Brain, PARAMS, keyOf } from '../web/brain.js';

// Deterministic random numbers (mulberry32) so runs are reproducible.
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);

function checkInvariants(brain) {
  brain.neurons.forEach((n) => {
    assert.ok(n.axons.length >= 1 && n.axons.length <= PARAMS.maxConnectors, 'neuron has 1-3 axons');
    assert.ok(n.dendrites.length >= 1 && n.dendrites.length <= PARAMS.maxConnectors, 'neuron has 1-3 dendrites');
  });
  const owners = new Map();
  brain.connectors.forEach((c) => {
    assert.ok(c.cells.length <= PARAMS.maxLength + 1, 'connector within max length');
    [c.owner.soma, ...c.cells].forEach((cell, i, all) => {
      if (i > 0) assert.equal(manhattan(all[i - 1], cell), 1, 'connectors move one whole cell at a time');
    });
    c.cells.forEach((cell) => {
      const content = brain.cells.get(keyOf(cell));
      assert.ok(content, 'every connector cell is occupied');
      const shared = content.kind === 'synapse' || content.kind === 'node';
      if (!shared) {
        assert.equal(content.connector, c, 'a cell holds one connector');
        assert.ok(!owners.has(keyOf(cell)), 'no two connectors share a plain cell');
      }
      owners.set(keyOf(cell), c);
    });
  });
  brain.synapses.forEach((s) => {
    assert.ok(!(s.from.kind === 'input' && s.to.kind === 'output'), 'digit never wires straight to output');
    assert.notEqual(s.from.kind, 'output', 'outputs only receive');
    assert.notEqual(s.to.kind, 'input', 'inputs only send');
    assert.equal(s.inhibitory, Boolean(s.from.inhibitory), 'a neuron is inhibitory for all its outputs (Dale)');
    if (s.inhibitory) {
      assert.equal(s.dendrite, null, 'inhibitory synapses target bodies, not dendrites');
      assert.equal(manhattan(s.cell, s.to.soma), 0, 'an inhibitory synapse sits on its target body');
    }
    brain.path(s).forEach((cell, i, all) => {
      if (i > 0) assert.equal(manhattan(all[i - 1], cell), 1, 'spike path is continuous');
    });
  });
}

const seeds = [1, 2, 3, 4, 5];
let lateCorrect = 0;
let lateTotal = 0;
seeds.forEach((seed) => {
  const brain = new Brain(seeded(seed));
  for (let tick = 1; tick <= 30000; tick += 1) {
    brain.step();
    if (tick % 1000 === 0) checkInvariants(brain);
  }
  assert.ok(brain.attempts > 300, `seed ${seed}: network keeps answering (${brain.attempts})`);
  const late = brain.history.slice(-300);
  lateCorrect += late.filter(Boolean).length;
  lateTotal += late.length;
});

const accuracy = lateCorrect / lateTotal;
assert.ok(accuracy > 0.53, `learns above chance (late accuracy ${accuracy.toFixed(2)})`);
console.log(`Brain checks passed: late accuracy ${(accuracy * 100).toFixed(0)}% over ${seeds.length} seeds (chance is 50%)`);
