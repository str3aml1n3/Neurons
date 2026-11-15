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
  inputAxons: 1, // axons grown by each digit channel
  outputDendrites: 1, // dendrites grown by each output cell
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
  // Connector lifecycle:
  eliminateAfter: 3, // remove a connector after this many failures in a row (0 = never)
  sproutChance: 0, // per-tick chance an active neuron below its maximum grows a new connector
  sproutActivity: 1, // activity a neuron needs before it can sprout
  activityDecay: 0.999, // activity kept per tick (halves in about 700 ticks)
  startMinimal: false, // neurons are born with 1 axon and 1 dendrite
  coactivityGain: 0, // "fire together, wire together": bias toward co-active partners (0 = off)
  nmdaGain: 0, // NMDA-like boost for input arriving while already charged (0 = off)
  nmdaVoltage: 0.3, // charge above which the boost applies
  // Hebbian learning by spike timing (STDP), with no reward needed (off by default):
  hebbRate: 0, // weight gain for input that arrived just before the neuron fired
  hebbDepress: 0, // weight loss for input that arrived just after it fired
  hebbTrophic: 0, // trophic support earned per helpful arrival
  // Lateral inhibition (winner-take-all), off by default:
  lateralMode: 'off', // 'pool': each firing excitatory neuron inhibits its neighbours (as if
  //   through local interneurons); 'interneurons': each firing inhibitory neuron does
  lateralRadius: 3, // reach in cells (Chebyshev distance); 9 or more covers the cube
  lateralStrength: 0.5, // share of the way to the inhibition floor per hit
  // En passant synapses (off by default): settled axons also connect where they
  // run right next to a settled dendrite, a digit cell or an output cell.
  enPassant: false,
  enPassantEvery: 10, // ticks between looks for new contacts
  enPassantChance: 0.02, // chance per neighbouring pair per look
  maxContacts: 4, // en passant synapses per connector
  // Mushroom-body learning (off by default): dopamine changes only the synapses
  // onto the output strip; the inner network keeps the synapses it uses.
  readoutOnly: false,
  // How reward is applied (see docs/neurons.md, Learning):
  marginDopamine: true, // dopamine scales with surprise, read from the network's own vote margin
  bothSides: true, // every vote is judged by its side: right-side votes up, wrong-side votes down
  softBounds: false, // experimental: weight changes shrink near the limits
  directIO: false, // experimental: digit cells may connect straight to output cells
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
    // Excitatory neurons within lateral-inhibition reach of each neuron
    // (bodies never move, so this is computed once).
    this.neurons.forEach((neuron) => {
      neuron.neighbours = this.neurons.filter((other) => other !== neuron && !other.inhibitory
        && Math.max(Math.abs(other.soma.x - neuron.soma.x), Math.abs(other.soma.y - neuron.soma.y),
          Math.abs(other.soma.z - neuron.soma.z)) <= this.p.lateralRadius);
    });
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
      activity: 0, // recent part in correct answers; drives sprouting
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
        for (let a = 0; a < this.p.inputAxons; a += 1) node.axons.push(this.newConnector(node, 'axon'));
        this.inputs.push(node);
      });
    }
    this.outputCells.forEach((cell) => {
      // x is the cell's position along the strip (0-8), whatever the cube size.
      const node = this.addNode({ kind: 'output', soma: cell, x: cell.strip, small: cell.small });
      for (let d = 0; d < this.p.outputDendrites; d += 1) node.dendrites.push(this.newConnector(node, 'dendrite'));
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
      // Counts are drawn in this order (axons, then dendrites) so seeded runs repeat.
      const axons = this.p.startMinimal ? 1 : 1 + this.randInt(this.p.maxAxons);
      for (let a = axons; a > 0; a -= 1) {
        neuron.axons.push(this.newConnector(neuron, 'axon'));
      }
      const dendrites = this.p.startMinimal ? 1 : 1 + this.randInt(this.p.maxDendrites);
      for (let d = dendrites; d > 0; d -= 1) {
        neuron.dendrites.push(this.newConnector(neuron, 'dendrite'));
      }
    });
  }

  newConnector(owner, type) {
    const connector = {
      owner, type, cells: [], state: 'growing', synapse: null, stuck: 0, steps: 0, goal: null,
      retractLeft: 0, avoid: new Map(), // partner node -> tick until which it is avoided
      failures: 0, // prunes and give-ups in a row without earning support
      contacts: [], // en passant synapses along this connector
      eliminate: false, // being retracted for good
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
    if (towardNeuron && others.length) connector.goal = this.pickPartner(connector, others, inhibitoryAxon).soma;
    else connector.goal = connector.type === 'axon' ? this.pick(this.outputCells) : this.pick(this.segmentCells);
  }

  // "Fire together, wire together": an excitatory connector prefers partners
  // that were active alongside its owner in recent correct answers. Weight =
  // 1 + gain × activity(owner) × activity(partner); with gain 0 (or for an
  // inhibitory axon) every partner is equally likely.
  pickPartner(connector, others, inhibitoryAxon) {
    const gain = this.p.coactivityGain;
    if (!gain || inhibitoryAxon) return this.pick(others);
    const mine = connector.owner.activity;
    const weights = others.map((n) => 1 + gain * mine * n.activity);
    let r = this.random() * weights.reduce((a, w) => a + w, 0);
    for (let i = 0; i < others.length; i += 1) {
      r -= weights[i];
      if (r <= 0) return others[i];
    }
    return others.at(-1);
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

  // A connector that failed to connect pulls back completely; after enough
  // failures in a row it is removed instead of regrowing.
  giveUp(connector) {
    connector.failures += 1;
    if (this.shouldEliminate(connector)) connector.eliminate = true;
    this.startRetract(connector, Infinity);
  }

  shouldEliminate(connector) {
    const { owner } = connector;
    const siblings = connector.type === 'axon' ? owner.axons : owner.dendrites;
    return this.p.eliminateAfter > 0 && owner.kind === 'neuron'
      && connector.failures >= this.p.eliminateAfter
      && siblings.filter((c) => !c.eliminate).length > 1; // always keep one that isn't being removed
  }

  removeConnector(connector) {
    const { owner } = connector;
    if (connector.type === 'axon') owner.axons = owner.axons.filter((c) => c !== connector);
    else owner.dendrites = owner.dendrites.filter((c) => c !== connector);
    this.connectorList = this.connectorList.filter((c) => c !== connector);
    this.events.push({ type: 'eliminate', cell: owner.soma });
  }

  // An active neuron below its maximum grows a new dendrite or axon.
  sprout() {
    this.neurons.forEach((neuron) => {
      if (neuron.activity < this.p.sproutActivity || this.random() >= this.p.sproutChance) return;
      const room = [];
      if (neuron.dendrites.length < this.p.maxDendrites) room.push('dendrite');
      if (neuron.axons.length < this.p.maxAxons) room.push('axon');
      if (!room.length) return;
      const type = this.pick(room);
      const connector = this.newConnector(neuron, type);
      (type === 'axon' ? neuron.axons : neuron.dendrites).push(connector);
      this.connectorList.push(connector);
      this.events.push({ type: 'sprout', cell: neuron.soma });
    });
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
      this.giveUp(connector);
      return;
    }
    const tip = this.tip(connector);
    // Candidate steps: every neighbour inside the cube, and those that get
    // closer to the goal. Built in one pass, since this runs for every
    // growing connector.
    const moves = [];
    const closer = [];
    const here = manhattan(tip, connector.goal);
    for (let i = 0; i < NEIGHBORS.length; i += 1) {
      const move = { x: tip.x + NEIGHBORS[i][0], y: tip.y + NEIGHBORS[i][1], z: tip.z + NEIGHBORS[i][2] };
      if (!this.inside(move)) continue;
      moves.push(move);
      if (manhattan(move, connector.goal) < here) closer.push(move);
    }
    const next = this.random() < this.p.drift && closer.length ? this.pick(closer) : this.pick(moves);
    const content = this.cells.get(keyOf(next));
    if (!content) {
      this.cells.set(keyOf(next), { kind: 'connector', connector });
      connector.cells.push(next);
      connector.stuck = 0;
      this.straighten(connector);
      if (connector.cells.length > this.p.maxLength) this.giveUp(connector);
      return;
    }
    if (!this.tryConnect(connector, next, content) && ++connector.stuck > this.p.stuckLimit) {
      this.giveUp(connector);
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
    // Only routes shorter than the current one matter, so a cell is skipped
    // when even a straight run from it to the tip would be too long. This
    // keeps the search small without changing which route is found.
    const depths = [0];
    const limit = connector.cells.length;
    for (let i = 0; i < queue.length; i += 1) {
      const cell = queue[i];
      const depth = depths[i] + 1;
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
        if (depth + manhattan(next, tip) >= limit) return;
        const content = this.cells.get(key);
        if (content && !(content.kind === 'connector' && content.connector === connector)) return;
        parent.set(key, cell);
        queue.push(next);
        depths.push(depth);
      });
    }
  }

  // Whether a signal may run from `from` to `to`. Inputs must not wire
  // straight to outputs, so every path passes through at least one neuron.
  canLink(from, to) {
    return from !== to && from.kind !== 'output' && to.kind !== 'input'
      && (this.p.directIO || !(from.kind === 'input' && to.kind === 'output'));
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
    if (!synapse.contact) {
      [synapse.axon, synapse.dendrite].forEach((c) => {
        if (!c) return;
        c.state = 'connected';
        c.synapse = synapse;
      });
    }
    if (synapse.axon && synapse.dendrite && !synapse.contact) {
      this.cells.set(keyOf(synapse.cell), { kind: 'synapse', synapse });
    }
    this.events.push({ type: 'form', synapse });
    // Connected connectors don't move until the synapse is removed, so the
    // route a spike takes is computed once.
    synapse.path = this.path(synapse);
    this.synapses.push(synapse);
  }

  // reason: 'weak' (weight ran out) or 'unsupported' (trophic support ran out)
  removeSynapse(synapse, reason) {
    if (synapse.contact) {
      this.removeContact(synapse, reason);
      return;
    }
    // Connectors are about to move, so their en passant contacts go first.
    [synapse.axon, synapse.dendrite].forEach((c) => {
      if (c) [...c.contacts].forEach((contact) => this.removeContact(contact, reason));
    });
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
      c.failures += 1;
      if (this.shouldEliminate(c)) {
        c.eliminate = true;
        this.startRetract(c, Infinity);
      } else {
        this.startRetract(c, this.p.partialRetract);
      }
    });
  }

  removeContact(synapse, reason) {
    this.events.push({ type: 'prune', synapse, reason });
    this.synapses = this.synapses.filter((s) => s !== synapse);
    this.spikes = this.spikes.filter((s) => s.synapse !== synapse);
    [synapse.axon, synapse.dendrite].forEach((c) => {
      if (c) c.contacts = c.contacts.filter((s) => s !== synapse);
    });
  }

  // En passant: look for settled axon cells sitting right next to a settled
  // dendrite cell of another neuron, a digit cell or an output cell, and
  // sometimes form a synapse there. Settled connectors don't move, so the
  // contact stays valid until one of them retracts (which removes it).
  formContacts() {
    const settled = (c) => c.state === 'connected';
    const roomFor = (c) => c.contacts.length < this.p.maxContacts;
    const tryPair = (fields) => {
      if (this.random() >= this.p.enPassantChance) return;
      this.addSynapse({ ...fields, contact: true });
      const synapse = this.synapses.at(-1);
      [fields.axon, fields.dendrite].forEach((c) => { if (c) c.contacts.push(synapse); });
    };
    const near = (cell) => NEIGHBORS.map(([dx, dy, dz]) => ({ x: cell.x + dx, y: cell.y + dy, z: cell.z + dz }))
      .filter((n) => this.inside(n));
    this.connectors.forEach((axon) => {
      if (axon.type !== 'axon' || !settled(axon) || axon.owner.inhibitory) return;
      axon.cells.forEach((cell, axonIndex) => {
        near(cell).forEach((n) => {
          if (!roomFor(axon)) return;
          const content = this.cells.get(keyOf(n));
          if (!content) return;
          // Next to an output cell: feed it directly.
          if (content.kind === 'node' && content.node.kind === 'output') {
            const to = content.node;
            if (!this.canLink(axon.owner, to) || axon.contacts.some((s) => s.to === to)) return;
            tryPair({ from: axon.owner, to, axon, dendrite: null, axonIndex, cell, partnerCell: n });
            return;
          }
          // Next to a settled dendrite (or a synapse cell at a dendrite's tip).
          const dendrite = content.kind === 'connector' ? content.connector : content.synapse?.dendrite;
          if (!dendrite || dendrite.type !== 'dendrite' || !settled(dendrite) || !roomFor(dendrite)) return;
          if (!this.canLink(axon.owner, dendrite.owner) || dendrite.owner === axon.owner) return;
          if (axon.synapse?.dendrite === dendrite || axon.contacts.some((s) => s.dendrite === dendrite)) return;
          const dendriteIndex = dendrite.cells.findIndex((c) => keyOf(c) === keyOf(n));
          if (dendriteIndex < 0) return;
          tryPair({
            from: axon.owner, to: dendrite.owner, axon, dendrite, axonIndex, dendriteIndex, cell, partnerCell: n,
          });
        });
      });
    });
    // Settled dendrites next to a digit cell listen to it.
    this.connectors.forEach((dendrite) => {
      if (dendrite.type !== 'dendrite' || !settled(dendrite) || dendrite.owner.kind !== 'neuron') return;
      dendrite.cells.forEach((cell, dendriteIndex) => {
        near(cell).forEach((n) => {
          if (!roomFor(dendrite)) return;
          const content = this.cells.get(keyOf(n));
          if (content?.kind !== 'node' || content.node.kind !== 'input') return;
          const from = content.node;
          if (dendrite.synapse?.from === from || dendrite.contacts.some((s) => s.from === from)) return;
          tryPair({ from, to: dendrite.owner, axon: null, dendrite, dendriteIndex, cell: n, partnerCell: cell });
        });
      });
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
    if (connector.cells.length === 0 && connector.eliminate) {
      this.removeConnector(connector);
      return;
    }
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
    if (synapse.contact) {
      const out = synapse.axon
        ? [synapse.from.soma, ...synapse.axon.cells.slice(0, synapse.axonIndex + 1)]
        : [synapse.cell];
      const back = synapse.dendrite
        ? synapse.dendrite.cells.slice(0, synapse.dendriteIndex + 1).reverse().concat([synapse.to.soma])
        : [synapse.partnerCell];
      return out.concat(back);
    }
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
    this.nodes.forEach((node) => { node.activity *= this.p.activityDecay; });
    if (this.p.enPassant && this.tick % this.p.enPassantEvery === 0) this.formContacts();
    if (this.p.sproutChance) this.sprout();
    // Removing a connector replaces the list rather than changing it, so this
    // loop can safely walk the list as it was.
    this.connectorList.forEach((c) => {
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
        let charge = synapse.weight * (1 - synapse.to.shunt);
        // NMDA-like boost: input arriving while the neuron is already charged
        // (from another input moments ago) counts extra, so coincident inputs
        // add up to more than their sum.
        if (this.p.nmdaGain && synapse.to.potential > this.p.nmdaVoltage) charge *= this.p.nmdaGain;
        synapse.to.potential += charge;
        synapse.lastArrival = this.tick;
        // STDP, depression side: input arriving just after the neuron fired
        // did not help that firing, so it weakens a little (no reward needed).
        const sinceFired = this.tick - synapse.to.lastFired;
        if (this.p.hebbDepress && sinceFired > 0 && sinceFired <= this.p.coincidence) {
          this.hebbChange(synapse, -this.p.hebbDepress);
        }
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

  hebbChange(synapse, amount) {
    synapse.weight = Math.max(this.p.minWeight, Math.min(this.p.maxWeight, synapse.weight + amount));
  }

  // Without lateral inhibition, every neuron at threshold fires. With it,
  // neurons fire strongest first (furthest above their threshold), and each
  // firing can push its neighbours back below threshold before their turn.
  fireNeurons() {
    const ready = (neuron) => neuron.potential >= neuron.threshold && neuron.refractory <= 0;
    if (this.p.lateralMode === 'off') {
      this.neurons.forEach((neuron) => { if (ready(neuron)) this.fire(neuron); });
      return;
    }
    this.neurons.filter(ready)
      .sort((a, b) => (b.potential - b.threshold) - (a.potential - a.threshold))
      .forEach((neuron) => {
        if (!ready(neuron)) return; // inhibited by a stronger neighbour this tick
        this.fire(neuron);
        const inhibits = this.p.lateralMode === 'pool' ? !neuron.inhibitory : neuron.inhibitory;
        if (!inhibits) return;
        neuron.neighbours.forEach((other) => {
          other.potential -= this.p.lateralStrength * (other.potential - this.p.inhibitionFloor);
          other.shunt = Math.min(1, other.shunt + this.p.lateralStrength);
        });
      });
  }

  fire(neuron) {
    neuron.potential = 0;
    neuron.threshold = Math.min(this.p.maxThreshold, neuron.threshold + this.p.thresholdBoost);
    neuron.refractory = this.p.refractory;
    neuron.lastFired = this.tick;
    this.synapses.forEach((s) => {
      if (s.to === neuron && !s.inhibitory && this.tick - s.lastArrival <= this.p.coincidence) {
        neuron.contrib.add(s);
        const late = this.tick - s.lastArrival; // 0 = arrived in the firing tick
        s.credit = Math.max(s.credit ?? 0, this.p.timingCredit ? this.p.timingCredit ** late : 1);
        // STDP, potentiation side: input that helped fire the neuron
        // strengthens a little, and earns a little support for being used.
        if (this.p.hebbRate) {
          this.hebbChange(s, this.p.hebbRate);
          s.trophic = Math.min(this.p.trophicMax, s.trophic + this.p.hebbTrophic);
        }
      }
      if (s.from === neuron) this.emit(s);
    });
    // Hebbian growth paired with scaling (an Oja-like rule): after
    // strengthening the inputs that fired it, the neuron rescales its inputs
    // toward its budget, so the inputs compete.
    if (this.p.hebbRate && this.p.scaling) this.scaleInputs([neuron]);
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
      if (s.axon) s.axon.failures = 0;
      if (s.dendrite) s.dendrite.failures = 0;
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

  // The default rule: the chain behind the answer is strengthened if it was
  // right and weakened if it was wrong, and inhibition is judged by whom it
  // suppressed.
  learnEverywhere(side, correct, change) {
    let behindAnswer;
    if (this.p.bothSides) {
      // Every vote is judged by the side it was cast for, whichever side won:
      // the chain behind right-side votes is strengthened, the chain behind
      // wrong-side votes weakened.
      const rightSide = this.digit < 5 ? 'small' : 'big';
      behindAnswer = this.eligible(rightSide);
      behindAnswer.forEach((s) => change(s, this.p.reward));
      this.shareTrophic([...behindAnswer]);
      this.eligible(rightSide === 'small' ? 'big' : 'small').forEach((s) => change(s, -this.p.punish));
    } else {
      behindAnswer = this.eligible(side);
      behindAnswer.forEach((s) => change(s, correct ? this.p.reward : -this.p.punish));
      if (correct) this.shareTrophic([...behindAnswer]);
    }
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
    if (correct) {
      this.lastEligible.forEach((syn) => {
        [syn.from, syn.to].forEach((node) => { node.activity += 1; });
      });
    }
  }

  // Mushroom-body rule: only output synapses learn. Each one that carried a
  // signal this trial is strengthened if it feeds the correct side and weakened
  // if it feeds the wrong side, as separate dopamine zones would do in a fly.
  // The inner network has no reward learning; synapses that carried signals to
  // the output keep their trophic support, whatever the outcome, so used
  // wiring survives.
  learnReadout(change) {
    const correctSmall = this.digit < 5;
    const readout = this.synapses.filter((syn) => syn.delivered && !syn.inhibitory && syn.to.kind === 'output');
    readout.forEach((syn) => change(syn, syn.to.small === correctSmall ? this.p.reward : -this.p.punish));
    this.shareTrophic([...this.chain(readout)]);
    this.lastEligible = new Set(readout.filter((syn) => syn.to.small === correctSmall));
  }

  learn(side) {
    const correct = (side === 'small') === (this.digit < 5);
    this.answer = side;
    this.attempts += 1;
    this.history.push(correct);
    // Net change per synapse; applied (and reported) once all rules have run.
    const deltas = new Map();
    // Surprise from the network's own confidence: a lopsided vote that turns
    // out right teaches little, a close call more, and a confident mistake
    // most. Confidence is the vote margin, 0 (even) to 1 (unanimous).
    const { small, big } = this.votes;
    const confidence = Math.abs(small - big) / (small + big || 1);
    this.surprise = this.p.marginDopamine ? (correct ? 1 - confidence : 1 + confidence) : 1;
    const change = (synapse, amount) => {
      const credit = synapse.credit > 0 ? synapse.credit : 1;
      deltas.set(synapse, (deltas.get(synapse) ?? 0) + amount * credit * this.surprise);
    };
    if (this.p.readoutOnly) {
      this.learnReadout(change);
    } else {
      this.learnEverywhere(side, correct, change);
    }
    let strengthened = 0;
    let weakened = 0;
    deltas.forEach((amount, synapse) => {
      if (amount === 0) return;
      // Soft bounds: a change is scaled by the room left to the limit, so a
      // weight settles where rewards and punishments balance instead of
      // running into the maximum.
      const room = amount > 0 ? this.p.maxWeight - synapse.weight : synapse.weight - this.p.minWeight;
      const step = this.p.softBounds ? amount * room : amount;
      synapse.weight = Math.max(this.p.minWeight, Math.min(this.p.maxWeight, synapse.weight + step));
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
      // The visible flash follows the surprise: routine successes glow faintly.
      this.dopamine = this.p.marginDopamine ? Math.max(0.25, Math.min(1, this.surprise)) : 1;
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
