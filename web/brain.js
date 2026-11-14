// Voxel neuron simulation. No rendering code: app.js draws it, and
// tests/brain.test.mjs runs it headless in Node. docs/neurons.md describes the
// behavior in plain language; keep it in sync with this file.
//
// The cube is a SIZE³ grid of cells, and each cell holds at most one thing.
// Nodes grow connectors one whole cell at a time: dendrites carry signals in,
// axons carry them out. A synapse forms where a growing tip enters a cell held
// by the opposite kind of connector. Nodes are:
//   - neurons: random cells inside the cube, 1..3 dendrites and 1..3 axons
//   - inputs: the 7 digit segments on the front face, 1 axon each
//   - outputs: the strip cells on the back face, 1 dendrite each
// Input and output cells also accept connectors that reach them directly.

export const SIZE = 9;
export const DIGITS = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];

export const PARAMS = {
  neurons: 16,
  maxConnectors: 3, // each neuron gets 1..3 dendrites and 1..3 axons
  maxLength: 10, // longest (straightened) connector before it gives up
  maxSteps: 30, // tip steps without connecting before it gives up
  stuckLimit: 6, // blocked growth attempts before retracting
  partialRetract: 5, // cells pulled back after a synapse is pruned
  avoidTicks: 3000, // ticks a connector won't reconnect to a pruned partner
  localRadius: 4, // after a prune, regrowth aims within this many cells of the tip
  cluster: 0.5, // chance regrowth aims near the owner's best-supported synapse
  clusterRadius: 2,
  growEvery: 2, // ticks between growth steps
  drift: 0.6, // chance a growth step heads toward its goal
  initialWeight: 1,
  maxWeight: 2,
  minWeight: 0.05,
  pruneBelow: 0.3, // synapses weaker than this are removed and regrow
  threshold: 1, // starting firing threshold; adapts per neuron
  minThreshold: 0.5,
  maxThreshold: 2.5,
  thresholdRecovery: 0.004, // threshold drop per tick, so quiet neurons wake up
  thresholdBoost: 0.08, // threshold rise per firing, so busy neurons calm down
  trophicStart: 1, // support a new synapse starts with
  trophicDecay: 0.9995, // support kept per tick
  trophicShare: 1, // support a node shares among its responsible inputs per reward
  trophicMax: 3,
  trophicFloor: 0.1, // synapses with less support are pruned
  leak: 0.7, // potential kept per tick
  noise: 0.08, // random potential added per tick
  refractory: 4,
  coincidence: 2, // ticks an arrival counts toward a firing
  inputPeriod: 5, // ticks between spikes from a lit segment
  trialTicks: 60, // ticks before a trial times out with no answer
  window: 35, // trial tick at which the output strip's votes are compared
  reward: 0.2,
  punish: 0.2,
  pause: 12,
};

export function segmentAt(x, y) {
  if (y === 1 && x >= 2 && x <= 6) return 0;
  if (x === 7 && y >= 2 && y <= 3) return 1;
  if (x === 7 && y >= 5 && y <= 6) return 2;
  if (y === 7 && x >= 2 && x <= 6) return 3;
  if (x === 1 && y >= 5 && y <= 6) return 4;
  if (x === 1 && y >= 2 && y <= 3) return 5;
  if (y === 4 && x >= 2 && x <= 6) return 6;
  return null;
}

// Digit segment cells on the front face (z = 0).
export const SEGMENT_CELLS = [];
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const segment = segmentAt(x, y);
    if (segment !== null) SEGMENT_CELLS.push({ x, y, z: 0, segment });
  }
}

// Output strip on the back face. x < 4 means small, x > 4 means big, and the
// middle cell is neutral.
export const OUTPUT_CELLS = [];
for (let x = 0; x < SIZE; x += 1) {
  if (x !== 4) OUTPUT_CELLS.push({ x, y: 4, z: SIZE - 1, small: x < 4 });
}

const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const keyOf = ({ x, y, z }) => x + y * SIZE + z * SIZE * SIZE;
const inside = ({ x, y, z }) => x >= 0 && y >= 0 && z >= 0 && x < SIZE && y < SIZE && z < SIZE;
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);

export class Brain {
  constructor(random = Math.random, params = {}) {
    this.random = random;
    this.p = { ...PARAMS, ...params };
    this.tick = 0;
    this.cells = new Map(); // cell key -> { kind: 'node' | 'connector' | 'synapse', ... }
    this.nodes = [];
    this.neurons = [];
    this.inputs = [];
    this.outputs = [];
    this.synapses = [];
    this.spikes = [];
    this.dopamine = 0;
    this.rewards = 0;
    this.attempts = 0;
    this.history = []; // true/false per answered trial
    this.outputPulse = null;
    this.pause = 0;
    this.status = 'Growing connections';
    this.createIONodes();
    this.placeNeurons();
    this.digit = this.randInt(10);
    this.startTrial();
  }

  randInt(n) {
    return Math.floor(this.random() * n);
  }

  pick(items) {
    return items[this.randInt(items.length)];
  }

  addNode(fields) {
    const node = {
      id: this.nodes.length, potential: 0, refractory: 0, lastFired: -Infinity, threshold: this.p.threshold,
      axons: [], dendrites: [], cells: [fields.soma], ...fields,
    };
    node.cells.forEach((cell) => this.cells.set(keyOf(cell), { kind: 'node', node }));
    this.nodes.push(node);
    return node;
  }

  // Each segment is one input node covering its 2-3 cells; its axon sprouts
  // from a random one of them. Each output cell is its own output node.
  createIONodes() {
    for (let segment = 0; segment < 7; segment += 1) {
      const cells = SEGMENT_CELLS.filter((c) => c.segment === segment);
      const node = this.addNode({ kind: 'input', segment, cells, soma: this.pick(cells) });
      node.axons.push(this.newConnector(node, 'axon'));
      this.inputs.push(node);
    }
    OUTPUT_CELLS.forEach((cell) => {
      const node = this.addNode({ kind: 'output', soma: cell, x: cell.x, small: cell.small });
      node.dendrites.push(this.newConnector(node, 'dendrite'));
      this.outputs.push(node);
    });
  }

  placeNeurons() {
    for (let i = 0; i < this.p.neurons; i += 1) {
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const soma = { x: 1 + this.randInt(7), y: 1 + this.randInt(7), z: 1 + this.randInt(7) };
        const crowded = this.neurons.some((n) => Math.max(
          Math.abs(n.soma.x - soma.x), Math.abs(n.soma.y - soma.y), Math.abs(n.soma.z - soma.z),
        ) < 2);
        if (crowded || this.cells.has(keyOf(soma))) continue;
        const neuron = this.addNode({ kind: 'neuron', soma });
        this.neurons.push(neuron);
        break;
      }
    }
    // Connectors are created after placement so they can aim at other neurons.
    this.neurons.forEach((neuron) => {
      const count = () => 1 + this.randInt(this.p.maxConnectors);
      for (let a = count(); a > 0; a -= 1) neuron.axons.push(this.newConnector(neuron, 'axon'));
      for (let d = count(); d > 0; d -= 1) neuron.dendrites.push(this.newConnector(neuron, 'dendrite'));
    });
  }

  newConnector(owner, type) {
    const connector = {
      owner, type, cells: [], state: 'growing', synapse: null, stuck: 0, steps: 0, goal: null,
      retractLeft: 0, avoid: new Map(), // partner node -> tick until which it is avoided
    };
    this.aim(connector);
    return connector;
  }

  avoids(connector, node) {
    return (connector.avoid.get(node) ?? -1) > this.tick;
  }

  // First growth follows coarse "guidance cues": input axons and output
  // dendrites head for a random neuron, a neuron's axon for another neuron or
  // the output strip, and its dendrite for another neuron or the digit.
  // Regrowth after a prune is local instead (see localGoal).
  aim(connector, local = false) {
    connector.stuck = 0;
    connector.steps = 0;
    if (local) {
      connector.goal = this.localGoal(connector);
      return;
    }
    const others = this.neurons.filter((n) => n !== connector.owner && !this.avoids(connector, n));
    const towardNeuron = connector.owner.kind !== 'neuron' || (others.length && this.random() < 0.5);
    if (towardNeuron && others.length) connector.goal = this.pick(others).soma;
    else connector.goal = connector.type === 'axon' ? this.pick(OUTPUT_CELLS) : this.pick(SEGMENT_CELLS);
  }

  // A goal near the connector's tip or, with clustering, near the owner's
  // best-supported synapse, so new contacts form next to successful ones.
  localGoal(connector) {
    const owner = connector.owner;
    const best = this.synapses
      .filter((s) => (s.from === owner || s.to === owner) && s.trophic > 0.5)
      .sort((a, b) => b.trophic - a.trophic)[0];
    const clustered = best && this.random() < this.p.cluster;
    const center = clustered ? best.cell : this.tip(connector);
    const radius = clustered ? this.p.clusterRadius : this.p.localRadius;
    const near = (v) => Math.max(0, Math.min(SIZE - 1, v + this.randInt(2 * radius + 1) - radius));
    return { x: near(center.x), y: near(center.y), z: near(center.z) };
  }

  startRetract(connector, cells) {
    connector.state = 'retracting';
    connector.retractLeft = cells;
  }

  get connectors() {
    return this.nodes.flatMap((n) => [...n.axons, ...n.dendrites]);
  }

  tip(connector) {
    return connector.cells.at(-1) ?? connector.owner.soma;
  }

  // Only the tip explores, one whole cell per step. The rest of the
  // connector then follows the shortest free path from its body to the tip.
  grow(connector) {
    if (++connector.steps > this.p.maxSteps) {
      this.startRetract(connector, Infinity);
      return;
    }
    const tip = this.tip(connector);
    const moves = NEIGHBORS.map(([dx, dy, dz]) => ({ x: tip.x + dx, y: tip.y + dy, z: tip.z + dz }))
      .filter(inside);
    const closer = moves.filter((m) => manhattan(m, connector.goal) < manhattan(tip, connector.goal));
    const next = this.random() < this.p.drift && closer.length ? this.pick(closer) : this.pick(moves);
    const content = this.cells.get(keyOf(next));
    if (!content) {
      this.cells.set(keyOf(next), { kind: 'connector', connector });
      connector.cells.push(next);
      connector.stuck = 0;
      this.straighten(connector);
      if (connector.cells.length > this.p.maxLength) this.startRetract(connector, Infinity);
      return;
    }
    if (!this.tryConnect(connector, next, content) && ++connector.stuck > this.p.stuckLimit) {
      this.startRetract(connector, Infinity);
    }
  }

  // Re-route the connector along the shortest path of free (or its own) cells
  // from its body to its tip, freeing cells it no longer needs.
  straighten(connector) {
    const start = connector.owner.soma;
    const tip = this.tip(connector);
    if (connector.cells.length <= manhattan(start, tip)) return; // already as short as possible
    const tipKey = keyOf(tip);
    const parent = new Map([[keyOf(start), null]]);
    const queue = [start];
    for (let i = 0; i < queue.length; i += 1) {
      const cell = queue[i];
      if (keyOf(cell) === tipKey) {
        const route = [];
        for (let c = cell; parent.get(keyOf(c)) !== null; c = parent.get(keyOf(c))) route.push(c);
        route.reverse();
        if (route.length >= connector.cells.length) return;
        const keep = new Set(route.map(keyOf));
        connector.cells.forEach((c) => { if (!keep.has(keyOf(c))) this.cells.delete(keyOf(c)); });
        route.forEach((c) => this.cells.set(keyOf(c), { kind: 'connector', connector }));
        connector.cells = route;
        return;
      }
      NEIGHBORS.forEach(([dx, dy, dz]) => {
        const next = { x: cell.x + dx, y: cell.y + dy, z: cell.z + dz };
        const key = keyOf(next);
        if (!inside(next) || parent.has(key)) return;
        const content = this.cells.get(key);
        if (content && !(content.kind === 'connector' && content.connector === connector)) return;
        parent.set(key, cell);
        queue.push(next);
      });
    }
  }

  // Whether a signal may run from `from` to `to`. Inputs must not wire
  // straight to outputs, so every path passes through at least one neuron.
  canLink(from, to) {
    return from !== to && from.kind !== 'output' && to.kind !== 'input'
      && !(from.kind === 'input' && to.kind === 'output');
  }

  tryConnect(connector, cell, content) {
    const isAxon = connector.type === 'axon';
    // A tip reaching a digit or output cell directly.
    if (content.kind === 'node' && content.node.kind !== 'neuron') {
      const { node } = content;
      const from = isAxon ? connector.owner : node;
      const to = isAxon ? node : connector.owner;
      if (isAxon !== (node.kind === 'output') || !this.canLink(from, to)) return false;
      if (this.avoids(connector, node)) return false;
      connector.cells.push(cell);
      this.addSynapse({
        from, to, cell, axon: isAxon ? connector : null, dendrite: isAxon ? null : connector,
      });
      return true;
    }
    const other = content.connector;
    if (content.kind !== 'connector' || other.type === connector.type || other.state !== 'growing') return false;
    const axon = isAxon ? connector : other;
    const dendrite = isAxon ? other : connector;
    if (!this.canLink(axon.owner, dendrite.owner)) return false;
    if (this.avoids(axon, dendrite.owner) || this.avoids(dendrite, axon.owner)) return false;
    // Cut the other connector back to the shared cell; that cell becomes the synapse.
    const index = other.cells.findIndex((c) => keyOf(c) === keyOf(cell));
    other.cells.splice(index + 1).forEach((c) => this.cells.delete(keyOf(c)));
    connector.cells.push(cell);
    this.addSynapse({ from: axon.owner, to: dendrite.owner, axon, dendrite, cell });
    return true;
  }

  addSynapse(fields) {
    const synapse = {
      weight: this.p.initialWeight, trophic: this.p.trophicStart, delivered: false, lastArrival: -Infinity,
      ...fields,
    };
    [synapse.axon, synapse.dendrite].forEach((c) => {
      if (!c) return;
      c.state = 'connected';
      c.synapse = synapse;
    });
    if (synapse.axon && synapse.dendrite) this.cells.set(keyOf(synapse.cell), { kind: 'synapse', synapse });
    this.synapses.push(synapse);
  }

  removeSynapse(synapse) {
    this.synapses = this.synapses.filter((s) => s !== synapse);
    this.spikes = this.spikes.filter((s) => s.synapse !== synapse);
    if (synapse.axon && synapse.dendrite) {
      // The axon keeps the shared cell and the dendrite lets go of it.
      this.cells.set(keyOf(synapse.cell), { kind: 'connector', connector: synapse.axon });
      synapse.dendrite.cells.pop();
    }
    // Each side pulls back a few cells, remembers to avoid this partner for a
    // while, and regrows locally from where it stopped.
    [[synapse.axon, synapse.to], [synapse.dendrite, synapse.from]].forEach(([c, partner]) => {
      if (!c) return;
      c.synapse = null;
      c.avoid.set(partner, this.tick + this.p.avoidTicks);
      this.startRetract(c, this.p.partialRetract);
    });
  }

  // Pull back one cell. A full retraction (failed growth) restarts from the
  // body with a new guided goal; a partial one (after a prune) regrows locally.
  retract(connector) {
    const cell = connector.cells.pop();
    if (cell) {
      const content = this.cells.get(keyOf(cell));
      if (content?.kind === 'connector' && content.connector === connector) this.cells.delete(keyOf(cell));
    }
    connector.retractLeft -= 1;
    if (connector.cells.length === 0) {
      connector.state = 'growing';
      this.aim(connector);
    } else if (connector.retractLeft <= 0) {
      connector.state = 'growing';
      this.aim(connector, true);
    }
  }

  // Cells a spike crosses through this synapse, from source body to target body.
  path(synapse) {
    const out = synapse.axon ? [synapse.from.soma, ...synapse.axon.cells] : [synapse.cell];
    const back = synapse.dendrite ? synapse.dendrite.cells.slice(0, -1).reverse().concat([synapse.to.soma]) : [];
    return out.concat(back);
  }

  emit(synapse) {
    this.spikes.push({ synapse, path: this.path(synapse), index: 0 });
  }

  lit(segment) {
    return (DIGITS[this.digit] & (1 << segment)) !== 0;
  }

  startTrial() {
    this.trialTick = 0;
    this.votes = { small: 0, big: 0 };
    this.spikes = [];
    this.nodes.forEach((n) => { n.potential = 0; n.refractory = 0; n.contrib = new Set(); });
    this.synapses.forEach((s) => { s.delivered = false; });
  }

  step() {
    this.tick += 1;
    this.dopamine *= 0.9;
    if (this.outputPulse) {
      this.outputPulse.intensity *= 0.9;
      if (this.outputPulse.intensity < 0.05) this.outputPulse = null;
    }
    // Trophic support fades unless rewarded answers renew it.
    this.synapses.forEach((s) => { s.trophic *= this.p.trophicDecay; });
    if (this.tick % 50 === 0) {
      this.synapses.filter((s) => s.trophic < this.p.trophicFloor).forEach((s) => this.removeSynapse(s));
    }
    this.connectors.forEach((c) => {
      if (c.state === 'retracting') this.retract(c);
      else if (c.state === 'growing' && this.tick % this.p.growEvery === 0) this.grow(c);
    });

    if (this.pause > 0) {
      this.pause -= 1;
      if (this.pause === 0) this.startTrial();
      return;
    }

    this.trialTick += 1;
    if (this.trialTick % this.p.inputPeriod === 1) {
      this.inputs.forEach((input) => {
        if (!this.lit(input.segment)) return;
        input.lastFired = this.tick;
        this.synapses.forEach((s) => { if (s.from === input) this.emit(s); });
      });
    }
    this.neurons.forEach((n) => {
      n.potential = n.potential * this.p.leak + this.random() * this.p.noise;
      n.refractory -= 1;
      n.threshold = Math.max(this.p.minThreshold, n.threshold - this.p.thresholdRecovery);
    });
    this.moveSpikes();
    this.fireNeurons();
    this.decide();
  }

  moveSpikes() {
    this.spikes = this.spikes.filter((spike) => {
      spike.index += 1;
      if (spike.index < spike.path.length - 1) return true;
      const { synapse } = spike;
      if (synapse.to.kind === 'output') {
        this.votes[synapse.to.small ? 'small' : 'big'] += synapse.weight;
        synapse.delivered = true;
        synapse.to.lastFired = this.tick;
        this.outputPulse = { x: synapse.to.x, intensity: 1 };
      } else {
        synapse.to.potential += synapse.weight;
        synapse.lastArrival = this.tick;
      }
      return false;
    });
  }

  fireNeurons() {
    this.neurons.forEach((neuron) => {
      if (neuron.potential < neuron.threshold || neuron.refractory > 0) return;
      neuron.potential = 0;
      neuron.threshold = Math.min(this.p.maxThreshold, neuron.threshold + this.p.thresholdBoost);
      neuron.refractory = this.p.refractory;
      neuron.lastFired = this.tick;
      this.synapses.forEach((s) => {
        if (s.to === neuron && this.tick - s.lastArrival <= this.p.coincidence) neuron.contrib.add(s);
        if (s.from === neuron) this.emit(s);
      });
    });
  }

  decide() {
    const { small, big } = this.votes;
    if (this.trialTick >= this.p.window && small !== big) {
      this.learn(small > big ? 'small' : 'big');
      return;
    }
    if (this.trialTick >= this.p.trialTicks) {
      const wired = this.synapses.some((s) => s.to.kind === 'output');
      this.status = wired ? 'No answer - listening again' : 'Growing connections';
      this.pause = this.p.pause;
    }
  }

  // Synapses behind the answer: output synapses that voted for the chosen
  // side, plus every synapse that helped fire a neuron feeding them, traced
  // back to the digit.
  eligible(side) {
    const found = new Set();
    const visit = (s) => {
      if (found.has(s)) return;
      found.add(s);
      s.from.contrib?.forEach(visit);
    };
    this.synapses.filter((s) => s.delivered && s.to.small === (side === 'small')).forEach(visit);
    return found;
  }

  learn(side) {
    const correct = (side === 'small') === (this.digit < 5);
    this.answer = side;
    this.attempts += 1;
    this.history.push(correct);
    this.lastEligible = this.eligible(side);
    this.lastEligible.forEach((s) => {
      const change = correct ? this.p.reward : -this.p.punish;
      s.weight = Math.max(this.p.minWeight, Math.min(this.p.maxWeight, s.weight + change));
    });
    if (correct) {
      const inputsPerNode = new Map();
      this.lastEligible.forEach((s) => inputsPerNode.set(s.to, (inputsPerNode.get(s.to) ?? 0) + 1));
      this.lastEligible.forEach((s) => {
        s.trophic = Math.min(this.p.trophicMax, s.trophic + this.p.trophicShare / inputsPerNode.get(s.to));
      });
    }
    this.synapses.filter((s) => s.weight < this.p.pruneBelow).forEach((s) => this.removeSynapse(s));
    if (correct) {
      this.rewards += 1;
      this.dopamine = 1;
      this.status = 'Correct! Dopamine reward';
      const next = this.randInt(9);
      this.digit = next >= this.digit ? next + 1 : next;
    } else {
      this.status = 'Not yet - trying again';
    }
    this.spikes = [];
    this.pause = this.p.pause;
  }
}
