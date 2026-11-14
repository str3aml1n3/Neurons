// Voxel neuron simulation. No rendering code: app.js draws it, and
// tests/brain.test.mjs runs it headless in Node. docs/neurons.md describes the
// behavior in plain language; keep it in sync with this file.
//
// The cube is a size³ grid of cells (9 by default), and each cell holds at
// most one thing.
// Nodes grow connectors one whole cell at a time: dendrites carry signals in,
// axons carry them out. A synapse forms where a growing tip enters a cell held
// by the opposite kind of connector. Nodes are:
//   - neurons: random cells inside the cube, 1..3 dendrites and 1..3 axons.
//     A quarter are inhibitory: their axons connect to other neurons' bodies
//     (or the output strip) and pull charge down instead of adding it.
//   - inputs: each digit segment on the front face has a lit channel and a
//     dark channel (like the eye's ON and OFF cells), 1 axon each. A lit
//     segment fires its lit channel; an unlit segment fires its dark channel.
//   - outputs: the strip cells on the back face, 1 dendrite each
// Input and output cells also accept connectors that reach them directly.

export const SIZE = 9; // default cube size; the app draws this size
export const DIGITS = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];

export const PARAMS = {
  neurons: 16,
  size: 9, // cube edge in cells; the digit and output strip stay 9 wide, centered
  maxAxons: 3, // each neuron gets 1..maxAxons axons
  maxDendrites: 3, // and 1..maxDendrites dendrites
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
  inhibitoryShare: 0.25, // share of neurons that are inhibitory
  inhibitionFloor: -0.2, // charge an inhibitory signal pulls toward
  inhibitionStrength: 0.5, // share of the way to the floor per unit weight
  shuntDecay: 0.6, // shunting kept per tick; excitation is scaled by (1 - shunt)
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
  // Experimental learning options (all off by default):
  scaling: 0, // synaptic scaling rate after an answer (0 = off, 1 = all the way to the budget)
  scalingTotal: 0, // input budget per neuron: 0 = keep the average input at initialWeight, > 0 = fixed total
  timingCredit: 0, // 0 = flat credit; else credit = timingCredit^(ticks between arrival and firing)
  retryWrong: true, // after a wrong answer, show the same digit again
  reward: 0.2,
  punish: 0.2,
  pause: 12,
};

// Front face (z = 0), 9 × 9 cells. Each segment has its own lit cells and its
// own dark cells: the lit cells form the digit around the outside, and each
// segment's dark cells form a parallel row just inside them. No cell is
// shared. Capitals are lit cells, lowercase dark cells:
//   y=0  . . A A A A A . .
//   y=1  . . a a a a a . .
//   y=2  F f . . . . . b B
//   y=3  F f . . . . . b B
//   y=4  . . G G G G G . .
//   y=5  E e g g g g g c C
//   y=6  E e . . . . . c C
//   y=7  . . d d d d d . .
//   y=8  . . D D D D D . .
// Segments are numbered a-g = 0-6, matching the bits in DIGITS.
const rect = (x0, x1, y0, y1) => {
  const cells = [];
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) cells.push({ x, y });
  return cells;
};
// The same layout for any face width w >= 7 (the dark rows of the middle and
// bottom bars collide below that). m is the middle row.
export function faceLayout(w) {
  const m = Math.floor((w - 1) / 2);
  const last = w - 1;
  return [
    { lit: rect(2, w - 3, 0, 0), dark: rect(2, w - 3, 1, 1) }, // a: top
    { lit: rect(last, last, 2, m - 1), dark: rect(last - 1, last - 1, 2, m - 1) }, // b: top right
    { lit: rect(last, last, m + 1, w - 3), dark: rect(last - 1, last - 1, m + 1, w - 3) }, // c: bottom right
    { lit: rect(2, w - 3, last, last), dark: rect(2, w - 3, last - 1, last - 1) }, // d: bottom
    { lit: rect(0, 0, m + 1, w - 3), dark: rect(1, 1, m + 1, w - 3) }, // e: bottom left
    { lit: rect(0, 0, 2, m - 1), dark: rect(1, 1, 2, m - 1) }, // f: top left
    { lit: rect(2, w - 3, m, m), dark: rect(2, w - 3, m + 1, m + 1) }, // g: middle
  ];
}

const layoutCells = (layout) => layout.flatMap(({ lit, dark }, segment) => [
  ...lit.map(({ x, y }) => ({ x, y, z: 0, segment, channel: 'lit' })),
  ...dark.map(({ x, y }) => ({ x, y, z: 0, segment, channel: 'dark' })),
]);

// Output strip across the middle row of the back face, w cells wide. The left
// half votes small and the right half big; on an odd width the middle cell is
// neutral (not part of the strip).
export function outputStrip(w) {
  const m = Math.floor((w - 1) / 2);
  const cells = [];
  for (let x = 0; x < w; x += 1) {
    if (w % 2 === 1 && x === m) continue;
    cells.push({ x, y: m, z: w - 1, small: x < w / 2 });
  }
  return cells;
}

export const SEGMENT_LAYOUT = faceLayout(SIZE);
export const SEGMENT_CELLS = layoutCells(SEGMENT_LAYOUT);
export const OUTPUT_CELLS = outputStrip(SIZE);

const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// Fixed strides, so keys work for any cube size up to 64.
export const keyOf = ({ x, y, z }) => x + y * 64 + z * 4096;
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);

export class Brain {
  constructor(random = Math.random, params = {}) {
    this.random = random;
    this.p = { ...PARAMS, ...params };
    this.size = this.p.size;
    // The digit and output strip fill the face up to 9 cells wide; on a bigger
    // cube they stay 9 wide, centered on the front and back faces.
    if (this.size < 7) throw new Error('The cube must be at least 7 cells wide to fit the digit.');
    const face = Math.min(this.size, 9);
    const offset = Math.floor((this.size - face) / 2);
    this.segmentCells = layoutCells(faceLayout(face)).map((c) => ({ ...c, x: c.x + offset, y: c.y + offset }));
    this.outputCells = outputStrip(face).map((c) => ({
      ...c, strip: c.x, x: c.x + offset, y: c.y + offset, z: this.size - 1,
    }));
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
    // What happened to synapses during the latest step, for display:
    // { type: 'strengthen' | 'weaken' | 'prune' | 'form', synapse, reason? }
    this.events = [];
    this.lastChanges = null; // counts from the latest answer
    this.createIONodes();
    this.placeNeurons();
    // Connector objects are fixed after construction (they retract and regrow
    // but are never replaced), so the list is built once.
    this.connectorList = this.nodes.flatMap((n) => [...n.axons, ...n.dendrites]);
    this.digit = this.randInt(10);
    this.startTrial();
  }

  inside({ x, y, z }) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.size && y < this.size && z < this.size;
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
      shunt: 0, inhibitory: false,
      axons: [], dendrites: [], cells: [fields.soma], ...fields,
    };
    node.cells.forEach((cell) => this.cells.set(keyOf(cell), { kind: 'node', node }));
    this.nodes.push(node);
    return node;
  }

  // Each segment has two input nodes, its lit and its dark channel, each
  // covering that channel's cells; its axon sprouts from a random one of them.
  // Each output cell is its own output node.
  createIONodes() {
    for (let segment = 0; segment < 7; segment += 1) {
      ['lit', 'dark'].forEach((channel) => {
        const cells = this.segmentCells.filter((c) => c.segment === segment && c.channel === channel);
        const node = this.addNode({ kind: 'input', segment, channel, cells, soma: this.pick(cells) });
        node.axons.push(this.newConnector(node, 'axon'));
        this.inputs.push(node);
      });
    }
    this.outputCells.forEach((cell) => {
      // x is the cell's position along the strip (0-8), whatever the cube size.
      const node = this.addNode({ kind: 'output', soma: cell, x: cell.strip, small: cell.small });
      node.dendrites.push(this.newConnector(node, 'dendrite'));
      this.outputs.push(node);
    });
  }

  placeNeurons() {
    for (let i = 0; i < this.p.neurons; i += 1) {
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const span = this.size - 2;
        const soma = { x: 1 + this.randInt(span), y: 1 + this.randInt(span), z: 1 + this.randInt(span) };
        const crowded = this.neurons.some((n) => Math.max(
          Math.abs(n.soma.x - soma.x), Math.abs(n.soma.y - soma.y), Math.abs(n.soma.z - soma.z),
        ) < 2);
        if (crowded || this.cells.has(keyOf(soma))) continue;
        // Placement is random, so making the first ones inhibitory is too.
        const inhibitory = i < Math.round(this.p.neurons * this.p.inhibitoryShare);
        const neuron = this.addNode({ kind: 'neuron', soma, inhibitory });
        this.neurons.push(neuron);
        break;
      }
    }
    // Connectors are created after placement so they can aim at other neurons.
    this.neurons.forEach((neuron) => {
      for (let a = 1 + this.randInt(this.p.maxAxons); a > 0; a -= 1) {
        neuron.axons.push(this.newConnector(neuron, 'axon'));
      }
      for (let d = 1 + this.randInt(this.p.maxDendrites); d > 0; d -= 1) {
        neuron.dendrites.push(this.newConnector(neuron, 'dendrite'));
      }
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
    // Inhibitory axons always head for another neuron's body.
    const inhibitoryAxon = connector.type === 'axon' && connector.owner.inhibitory;
    const towardNeuron = connector.owner.kind !== 'neuron' || inhibitoryAxon
      || (others.length && this.random() < 0.5);
    if (towardNeuron && others.length) connector.goal = this.pick(others).soma;
    else connector.goal = connector.type === 'axon' ? this.pick(this.outputCells) : this.pick(this.segmentCells);
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
    const near = (v) => Math.max(0, Math.min(this.size - 1, v + this.randInt(2 * radius + 1) - radius));
    return { x: near(center.x), y: near(center.y), z: near(center.z) };
  }

  startRetract(connector, cells) {
    connector.state = 'retracting';
    connector.retractLeft = cells;
  }

  get connectors() {
    return this.connectorList;
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
      .filter((cell) => this.inside(cell));
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
        if (!this.inside(next) || parent.has(key)) return;
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

  // An inhibitory axon connects only where its tip reaches another neuron's
  // body (or an output cell). A body can take several inhibitory synapses.
  tryInhibit(connector, cell, content) {
    if (content.kind !== 'node' || content.node.kind === 'input') return false;
    const { node } = content;
    if (!this.canLink(connector.owner, node) || this.avoids(connector, node)) return false;
    connector.cells.push(cell);
    this.addSynapse({ from: connector.owner, to: node, cell, axon: connector, dendrite: null, inhibitory: true });
    return true;
  }

  tryConnect(connector, cell, content) {
    const isAxon = connector.type === 'axon';
    if (isAxon && connector.owner.inhibitory) return this.tryInhibit(connector, cell, content);
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
    if (axon.owner.inhibitory) return false; // inhibitory axons target bodies, not dendrites
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
      inhibitory: false, active: false, ...fields,
    };
    [synapse.axon, synapse.dendrite].forEach((c) => {
      if (!c) return;
      c.state = 'connected';
      c.synapse = synapse;
    });
    if (synapse.axon && synapse.dendrite) this.cells.set(keyOf(synapse.cell), { kind: 'synapse', synapse });
    this.events.push({ type: 'form', synapse });
    // Connected connectors don't move until the synapse is removed, so the
    // route a spike takes is computed once.
    synapse.path = this.path(synapse);
    this.synapses.push(synapse);
  }

  // reason: 'weak' (weight ran out) or 'unsupported' (trophic support ran out)
  removeSynapse(synapse, reason) {
    this.events.push({ type: 'prune', synapse, reason });
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
    this.spikes.push({ synapse, path: synapse.path, index: 0 });
  }

  lit(segment) {
    return (DIGITS[this.digit] & (1 << segment)) !== 0;
  }

  // Whether an input channel fires for the current digit.
  active(input) {
    return this.lit(input.segment) === (input.channel === 'lit');
  }

  startTrial() {
    this.trialTick = 0;
    this.votes = { small: 0, big: 0 };
    this.spikes = [];
    this.nodes.forEach((n) => { n.potential = 0; n.refractory = 0; n.shunt = 0; n.contrib = new Set(); });
    this.synapses.forEach((s) => { s.delivered = false; s.active = false; s.credit = 0; });
  }

  step() {
    this.tick += 1;
    this.events = [];
    this.dopamine *= 0.9;
    if (this.outputPulse) {
      this.outputPulse.intensity *= 0.9;
      if (this.outputPulse.intensity < 0.05) this.outputPulse = null;
    }
    // Trophic support fades unless rewarded answers renew it.
    this.synapses.forEach((s) => { s.trophic *= this.p.trophicDecay; });
    if (this.tick % 50 === 0) {
      this.synapses.filter((s) => s.trophic < this.p.trophicFloor).forEach((s) => this.removeSynapse(s, 'unsupported'));
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
        if (!this.active(input)) return;
        input.lastFired = this.tick;
        this.synapses.forEach((s) => { if (s.from === input) this.emit(s); });
      });
    }
    this.neurons.forEach((n) => {
      n.potential = n.potential * this.p.leak + this.random() * this.p.noise;
      n.shunt *= this.p.shuntDecay;
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
      if (synapse.inhibitory) {
        this.inhibit(synapse);
      } else if (synapse.to.kind === 'output') {
        this.votes[synapse.to.small ? 'small' : 'big'] += synapse.weight;
        synapse.delivered = true;
        synapse.credit = 1;
        synapse.to.lastFired = this.tick;
        this.outputPulse = { x: synapse.to.x, intensity: 1 };
      } else {
        // Recent inhibition shunts excitation: part of it leaks away.
        synapse.to.potential += synapse.weight * (1 - synapse.to.shunt);
        synapse.lastArrival = this.tick;
      }
      return false;
    });
  }

  // Like real (chloride) inhibition: charge is pulled toward a floor just
  // below rest, harder the more charged the neuron is, and incoming
  // excitation is shunted for a few ticks. On the output strip, inhibition
  // takes votes away from that side.
  inhibit(synapse) {
    synapse.active = true;
    const target = synapse.to;
    if (target.kind === 'output') {
      const side = target.small ? 'small' : 'big';
      this.votes[side] = Math.max(0, this.votes[side] - synapse.weight);
      return;
    }
    const pull = Math.min(1, synapse.weight * this.p.inhibitionStrength);
    target.potential -= pull * (target.potential - this.p.inhibitionFloor);
    target.shunt = Math.min(1, target.shunt + pull);
  }

  fireNeurons() {
    this.neurons.forEach((neuron) => {
      if (neuron.potential < neuron.threshold || neuron.refractory > 0) return;
      neuron.potential = 0;
      neuron.threshold = Math.min(this.p.maxThreshold, neuron.threshold + this.p.thresholdBoost);
      neuron.refractory = this.p.refractory;
      neuron.lastFired = this.tick;
      this.synapses.forEach((s) => {
        if (s.to === neuron && !s.inhibitory && this.tick - s.lastArrival <= this.p.coincidence) {
          neuron.contrib.add(s);
          const late = this.tick - s.lastArrival; // 0 = arrived in the firing tick
          s.credit = Math.max(s.credit ?? 0, this.p.timingCredit ? this.p.timingCredit ** late : 1);
        }
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

  // The given synapses plus every synapse that helped fire the neurons
  // sending them, traced back to the digit.
  chain(start) {
    const found = new Set();
    const visit = (s) => {
      if (found.has(s)) return;
      found.add(s);
      s.from.contrib?.forEach(visit);
    };
    start.forEach(visit);
    return found;
  }

  // Synapses behind the answer: excitatory output synapses that voted for the
  // chosen side, and the chain that fired them.
  eligible(side) {
    return this.chain(this.synapses.filter((s) => s.delivered && !s.inhibitory
      && s.to.small === (side === 'small')));
  }

  // Which side each neuron's excitatory connections lead to: 'small', 'big'
  // or null if neither (or both equally).
  leanings() {
    const next = new Map();
    this.synapses.forEach((s) => {
      if (s.inhibitory) return;
      if (!next.has(s.from)) next.set(s.from, []);
      next.get(s.from).push(s.to);
    });
    const lean = new Map();
    this.neurons.forEach((neuron) => {
      const seen = new Set([neuron]);
      const queue = [neuron];
      let small = 0;
      let big = 0;
      while (queue.length) {
        (next.get(queue.pop()) ?? []).forEach((to) => {
          if (seen.has(to)) return;
          seen.add(to);
          if (to.kind === 'output') {
            if (to.small) small += 1;
            else big += 1;
          } else queue.push(to);
        });
      }
      lean.set(neuron, small > big ? 'small' : big > small ? 'big' : null);
    });
    return lean;
  }

  // Inhibition is judged by whom it suppressed this trial: suppressing a
  // neuron (or output cell) that leans toward the wrong side is helpful,
  // toward the right side harmful. Returns both sets.
  judgeInhibition() {
    const correctSide = this.digit < 5 ? 'small' : 'big';
    const lean = this.leanings();
    const helpful = [];
    const harmful = [];
    this.synapses.forEach((s) => {
      if (!s.inhibitory || !s.active) return;
      const side = s.to.kind === 'output' ? (s.to.small ? 'small' : 'big') : lean.get(s.to);
      if (side) (side === correctSide ? harmful : helpful).push(s);
    });
    return { helpful, harmful };
  }

  shareTrophic(synapses) {
    const perTarget = new Map();
    synapses.forEach((s) => perTarget.set(s.to, (perTarget.get(s.to) ?? 0) + 1));
    synapses.forEach((s) => {
      s.trophic = Math.min(this.p.trophicMax, s.trophic + this.p.trophicShare / perTarget.get(s.to));
    });
  }

  // Synaptic scaling: each neuron pulls the total of its excitatory inputs
  // toward a budget, so strengthening one input weakens the others.
  scaleInputs(neurons) {
    neurons.forEach((neuron) => {
      const inputs = this.synapses.filter((syn) => syn.to === neuron && !syn.inhibitory);
      if (!inputs.length) return;
      const total = inputs.reduce((sum, syn) => sum + syn.weight, 0);
      const budget = this.p.scalingTotal || inputs.length * this.p.initialWeight;
      const factor = 1 + this.p.scaling * (budget / total - 1);
      inputs.forEach((syn) => {
        syn.weight = Math.max(this.p.minWeight, Math.min(this.p.maxWeight, syn.weight * factor));
      });
    });
  }

  learn(side) {
    const correct = (side === 'small') === (this.digit < 5);
    this.answer = side;
    this.attempts += 1;
    this.history.push(correct);
    // Net change per synapse; applied (and reported) once all rules have run.
    const deltas = new Map();
    const change = (synapse, amount) => {
      const credit = synapse.credit > 0 ? synapse.credit : 1;
      deltas.set(synapse, (deltas.get(synapse) ?? 0) + amount * credit);
    };
    // Excitation: the chain behind the answer is strengthened if it was
    // right and weakened if it was wrong.
    const behindAnswer = this.eligible(side);
    behindAnswer.forEach((s) => change(s, correct ? this.p.reward : -this.p.punish));
    if (correct) this.shareTrophic([...behindAnswer]);
    // Inhibition: helpful inhibitory synapses, and the chain that fired their
    // neurons, are strengthened; harmful ones and their chain are weakened.
    // So an inhibitory neuron learns which digits to fire for, not just whom
    // to inhibit.
    const { helpful, harmful } = this.judgeInhibition();
    const helpfulChain = this.chain(helpful);
    helpfulChain.forEach((s) => change(s, this.p.reward));
    this.shareTrophic([...helpfulChain]);
    this.chain(harmful).forEach((s) => change(s, -this.p.punish));
    this.lastEligible = new Set([...behindAnswer, ...helpfulChain]);
    let strengthened = 0;
    let weakened = 0;
    deltas.forEach((amount, synapse) => {
      if (amount === 0) return;
      synapse.weight = Math.max(this.p.minWeight, Math.min(this.p.maxWeight, synapse.weight + amount));
      this.events.push({ type: amount > 0 ? 'strengthen' : 'weaken', synapse });
      if (amount > 0) strengthened += 1;
      else weakened += 1;
    });
    if (this.p.scaling) {
      const touched = new Set([...deltas.keys()].map((syn) => syn.to).filter((node) => node.kind === 'neuron'));
      this.scaleInputs(touched);
    }
    const before = this.synapses.length;
    this.synapses.filter((s) => s.weight < this.p.pruneBelow).forEach((s) => this.removeSynapse(s, 'weak'));
    this.lastChanges = { strengthened, weakened, pruned: before - this.synapses.length };
    if (correct) {
      this.rewards += 1;
      this.dopamine = 1;
      this.status = 'Correct! Dopamine reward';
      const next = this.randInt(9);
      this.digit = next >= this.digit ? next + 1 : next;
    } else {
      this.status = this.p.retryWrong ? 'Not yet - trying again' : 'Not quite - next digit';
      if (!this.p.retryWrong) this.digit = this.randInt(10);
    }
    this.spikes = [];
    this.pause = this.p.pause;
  }
}
