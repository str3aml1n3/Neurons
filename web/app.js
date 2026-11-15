import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.171.0/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'https://unpkg.com/three@0.171.0/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Brain, SEGMENT_CELLS, SIZE, keyOf } from './brain.js';

const STEP_MS = 100;
// Every color stands for a role; styles.css uses the same values for the legend.
// A calm palette after fluorescence images of real neurons: ivory bodies, teal
// dendrites, amber axons. A synapse is drawn as the two meeting (an amber
// bouton against a teal spine head), so it needs no colour of its own.
const COLORS = {
  neuron: 0xf3ede2, // ivory cell bodies
  dendrite: 0x4fc9b0, // teal: signals in
  axon: 0xf0a24e, // amber: signals out
  spike: 0xfffbe8,
  spikeGlow: 0xffd27a,
  dark: 0xa59bff, // lavender: dark-channel signals, on their first hop
  inhibitory: 0xe8679f, // rose: inhibitory neurons, their axons, synapses and signals
  darkCell: 0x26213f,
  small: 0x5a8dff,
  big: 0xff6464,
  neutral: 0x4a5266,
  gold: 0xffcf6b, // lit digit segments and dopamine
  frame: 0x7fb6d9,
  strengthen: 0xffd27a, // synapse strengthened (dopamine gold)
  weaken: 0x7aa7ff, // synapse weakened (cool blue)
  prune: 0x8e97a8, // synapse removed
  form: 0xffffff, // new synapse
};

const canvas = document.querySelector('#scene');
const digitElement = document.querySelector('#digit');
const statusElement = document.querySelector('#status');
const scoreElement = document.querySelector('#score');
const recentElement = document.querySelector('#recent');
const synapseElement = document.querySelector('#synapses');
const changesElement = document.querySelector('#changes');

// On high-density screens the pixels are already fine enough, and multisample
// antialiasing there is the costliest thing a phone's graphics chip does.
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setAnimationLoop(animate);

const scene = new THREE.Scene();
// Depth fading: parts further from the camera sink toward the background, so
// near and far wiring separate. The range follows the camera (see animate).
scene.fog = new THREE.Fog(0x060b17, 10, 40);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
camera.position.set(10, 8, -15);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.target.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0xd6dbe4, 1.5)); // near-neutral, so ivory stays ivory
const keyLight = new THREE.PointLight(0x9fe6ff, 30, 40);
keyLight.position.set(-7, 9, -10);
scene.add(keyLight);
const warmLight = new THREE.PointLight(0xffb27a, 16, 30);
warmLight.position.set(8, -3, 9);
scene.add(warmLight);

const cube = new THREE.Group();
scene.add(cube);

// Cube outline; it flashes gold while dopamine is released.
const frameMaterial = new THREE.LineBasicMaterial({ color: COLORS.frame, transparent: true, opacity: 0.85 });
cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(SIZE, SIZE, SIZE)), frameMaterial));

// Faint lines on every cell boundary, so the voxel grid is visible.
const gridPositions = [];
for (let a = 0; a <= SIZE; a += 1) {
  for (let b = 0; b <= SIZE; b += 1) {
    const u = -SIZE / 2 + a;
    const v = -SIZE / 2 + b;
    const h = SIZE / 2;
    gridPositions.push(-h, u, v, h, u, v, u, -h, v, u, h, v, u, v, -h, u, v, h);
  }
}
const gridGeometry = new THREE.BufferGeometry();
gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
cube.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({
  color: 0x5b93b8, transparent: true, opacity: 0.1, depthWrite: false,
})));

// Grid x is mirrored so the digit reads left-to-right from the default front view.
const cellToVector = ({ x, y, z }) => new THREE.Vector3(4 - x, 4 - y, z - 4);

function glowTexture() {
  const size = 64;
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = size;
  glowCanvas.height = size;
  const context = glowCanvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(glowCanvas);
}
const glow = glowTexture();

// Every kind of object is drawn as one instanced mesh (one draw call), so the
// scene costs about a dozen draw calls however much the network grows.
const dummy = new THREE.Object3D();
const tint = new THREE.Color();
const white = new THREE.Color(0xffffff);
const AXIS_ROTATION = {
  x: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
  y: new THREE.Quaternion(),
  z: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
};

function instanced(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.setColorAt(0, white); // create the color buffer up front
  mesh.count = 0;
  mesh.frustumCulled = false;
  cube.add(mesh);
  return mesh;
}

function place(mesh, index, position, scale, rotation = AXIS_ROTATION.y) {
  dummy.position.copy(position);
  dummy.quaternion.copy(rotation);
  if (typeof scale === 'number') dummy.scale.setScalar(scale);
  else dummy.scale.copy(scale);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

function finish(mesh, count) {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
}

// Input and output cells are whole cubes inside the grid's front and back
// layers. Digit cells are split by how visible they should be right now.
// Rounded cells: each still fills one grid cell, but reads as a soft sensor, not a block.
const ioGeometry = new RoundedBoxGeometry(0.78, 0.78, 0.78, 1, 0.06);
const digitCells = SEGMENT_CELLS.map((cell) => ({ cell, position: cellToVector(cell) }));
const digitLit = instanced(ioGeometry, new THREE.MeshLambertMaterial({
  emissive: 0xa96400, emissiveIntensity: 0.6, transparent: true, opacity: 0.92,
}), digitCells.length);
const digitDark = instanced(ioGeometry, new THREE.MeshLambertMaterial({
  color: COLORS.darkCell, emissive: COLORS.dark, emissiveIntensity: 0.5, transparent: true, opacity: 0.5,
  depthWrite: false,
}), digitCells.length);
// Inactive cells stay faintly visible, so axons never seem to start in empty space.
const digitFaint = instanced(ioGeometry, new THREE.MeshBasicMaterial({
  transparent: true, opacity: 0.28, depthWrite: false,
}), digitCells.length);
const outputCells = Array.from({ length: SIZE }, (_, x) => ({
  x,
  position: cellToVector({ x, y: 4, z: SIZE - 1 }),
  color: new THREE.Color(x < 4 ? COLORS.small : x > 4 ? COLORS.big : COLORS.neutral),
}));
const outputMesh = instanced(ioGeometry, new THREE.MeshLambertMaterial({
  transparent: true, opacity: 0.92,
}), SIZE);
outputCells.forEach(({ position }, i) => place(outputMesh, i, position, 1));
finish(outputMesh, SIZE);

// Faint tinted cube on every cell a connector occupies.
const occupancy = instanced(new THREE.BoxGeometry(0.94, 0.94, 0.94), new THREE.MeshBasicMaterial({
  transparent: true, opacity: 0.035, depthWrite: false,
}), SIZE ** 3);

// Connectors grow cell by cell, but are drawn as smooth curves that cut the
// grid's corners. Each curve is a chain of short cylinders (one instanced
// mesh) with a sphere at every joint; dendrites taper away from the body, and
// axons start with a cone-shaped hillock and end in a bouton at a synapse.
const MAX_SEGMENTS = 6000;
// Unlit: the tubes are thin enough that shading adds nothing, and flat color
// keeps axons and dendrites their true legend colors.
const connectorMaterial = new THREE.MeshBasicMaterial();
const segmentMesh = instanced(new THREE.CylinderGeometry(1, 1, 1, 7, 1, true), connectorMaterial, MAX_SEGMENTS);
const jointMesh = instanced(new THREE.SphereGeometry(1, 6, 4), connectorMaterial, MAX_SEGMENTS);
const STATE_BRIGHTNESS = { growing: 0.6, connected: 1, retracting: 0.3 };

// Neuron bodies, and their halos as one layer of glowing points with a size
// and color per neuron.
// A lumpy cell body rather than a perfect sphere; each neuron gets its own
// rotation and stretch so no two look the same.
function somaGeometry() {
  const geometry = new THREE.SphereGeometry(0.38, 20, 14);
  const position = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    v.fromBufferAttribute(position, i).normalize();
    const bump = 1 + 0.1 * Math.sin(v.x * 3 + 1) * Math.sin(v.y * 2.5 + 2) * Math.sin(v.z * 3.5)
      + 0.05 * Math.sin(v.x * 4 + v.z * 3);
    v.multiplyScalar(0.38 * bump);
    position.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}
const somaMesh = instanced(somaGeometry(), new THREE.MeshStandardMaterial({
  color: COLORS.neuron, emissive: COLORS.neuron, emissiveIntensity: 0.42, roughness: 0.35,
}), 64);
const haloGeometry = new THREE.BufferGeometry();
const haloMaterial = new THREE.ShaderMaterial({
  uniforms: { map: { value: glow }, scale: { value: 400 } },
  vertexShader: `
    attribute float size;
    attribute vec3 haloColor;
    uniform float scale;
    varying vec3 vColor;
    void main() {
      vColor = haloColor;
      vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * scale / -viewPosition.z;
      gl_Position = projectionMatrix * viewPosition;
    }`,
  fragmentShader: `
    uniform sampler2D map;
    varying vec3 vColor;
    void main() {
      gl_FragColor = vec4(vColor * texture2D(map, gl_PointCoord).a, 1.0);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const halos = new THREE.Points(haloGeometry, haloMaterial);
halos.frustumCulled = false;
cube.add(halos);
const HALO_SIZE = 1 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2); // world units -> point size

// Inhibitory synapses sit on the target's body and are drawn as flat bars,
// the "⊣" symbol neuroscience diagrams use for inhibition.
const inhibitoryBarMesh = instanced(new THREE.CylinderGeometry(0.24, 0.24, 0.07, 18), new THREE.MeshLambertMaterial({
  emissive: COLORS.inhibitory, emissiveIntensity: 0.35,
}), 200);
// An excitatory synapse is the axon's round bouton pressed against a spine
// head on the dendrite. Size shows weight; brightness shows trophic support.
const synapsePartGeometry = new THREE.SphereGeometry(1, 10, 8);
const synapseMaterial = () => new THREE.MeshStandardMaterial({
  roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.06,
});
const boutonMesh = instanced(synapsePartGeometry, synapseMaterial(), 400);
const spineMesh = instanced(synapsePartGeometry, synapseMaterial(), 400);

// Synapse events (strengthened, weakened, pruned, formed) show as short-lived
// rings that face the camera: one instanced mesh for all of them.
const MAX_RINGS = 400;
const ringMesh = instanced(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  fog: false,
}), MAX_RINGS);
ringMesh.renderOrder = 9;
const RING_STYLE = {
  strengthen: { color: new THREE.Color(COLORS.strengthen), from: 0.2, to: 0.75, ms: 1100 }, // expands
  weaken: { color: new THREE.Color(COLORS.weaken), from: 0.75, to: 0.15, ms: 1100 }, // contracts
  prune: { color: new THREE.Color(COLORS.prune), from: 0.3, to: 1.3, ms: 900 }, // bursts
  form: { color: new THREE.Color(COLORS.form), from: 0.05, to: 0.45, ms: 600 },
  sprout: { color: new THREE.Color(COLORS.form), from: 0.2, to: 0.7, ms: 700 }, // new dendrite or axon
  eliminate: { color: new THREE.Color(COLORS.prune), from: 0.4, to: 1.5, ms: 1000 }, // connector removed
};
let rings = []; // { position, style, start }

// Signals: glowing points drawn over everything, with a short fading trail.
const MAX_SPIKES = 600;
const TRAIL = [0, 0.35, 0.7];
const glowPositions = new Float32Array(MAX_SPIKES * TRAIL.length * 3);
const glowColors = new Float32Array(MAX_SPIKES * TRAIL.length * 3);
const corePositions = new Float32Array(MAX_SPIKES * 3);
const coreColors = new Float32Array(MAX_SPIKES * 3);
const glowGeometry = new THREE.BufferGeometry();
glowGeometry.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
glowGeometry.setAttribute('color', new THREE.BufferAttribute(glowColors, 3));
const coreGeometry = new THREE.BufferGeometry();
coreGeometry.setAttribute('position', new THREE.BufferAttribute(corePositions, 3));
coreGeometry.setAttribute('color', new THREE.BufferAttribute(coreColors, 3));
const pointMaterial = (size) => new THREE.PointsMaterial({
  size, map: glow, vertexColors: true, transparent: true, depthTest: false, depthWrite: false, fog: false,
  blending: THREE.AdditiveBlending,
});
const spikeGlow = new THREE.Points(glowGeometry, pointMaterial(1.3));
const spikeCore = new THREE.Points(coreGeometry, pointMaterial(0.5));
const glowTint = {
  lit: new THREE.Color(COLORS.spikeGlow), dark: new THREE.Color(COLORS.dark), inhibitory: new THREE.Color(COLORS.inhibitory),
};
const coreTint = {
  lit: new THREE.Color(COLORS.spike),
  dark: new THREE.Color(COLORS.dark).lerp(white, 0.5),
  inhibitory: new THREE.Color(COLORS.inhibitory).lerp(white, 0.5),
};
spikeGlow.renderOrder = 10;
spikeCore.renderOrder = 11;
spikeGlow.frustumCulled = false;
spikeCore.frustumCulled = false;
cube.add(spikeGlow, spikeCore);

let brain = new Brain();
let haloSizes = new Float32Array(0);
let haloColors = new Float32Array(0);

function createScene() {
  const count = brain.neurons.length;
  const turn = new THREE.Euler();
  const rotation = new THREE.Quaternion();
  const stretch = new THREE.Vector3();
  brain.neurons.forEach((neuron, i) => {
    rotation.setFromEuler(turn.set(i * 2.1, i * 1.3, i * 0.7));
    stretch.set(1 + 0.15 * Math.sin(i * 1.7), 1 + 0.15 * Math.cos(i * 2.3), 1 + 0.12 * Math.sin(i * 3.1));
    place(somaMesh, i, cellToVector(neuron.soma), stretch, rotation);
  });
  finish(somaMesh, count);
  const positions = new Float32Array(count * 3);
  brain.neurons.forEach((neuron, i) => cellToVector(neuron.soma).toArray(positions, i * 3));
  haloSizes = new Float32Array(count);
  haloColors = new Float32Array(count * 3);
  haloGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  haloGeometry.setAttribute('size', new THREE.BufferAttribute(haloSizes, 1));
  haloGeometry.setAttribute('haloColor', new THREE.BufferAttribute(haloColors, 3));
}

function connectorRadius(connector) {
  const base = connector.type === 'axon' ? 0.05 : 0.038;
  if (!connector.synapse) return base;
  return base * 0.7 + 0.06 * (connector.synapse.weight / brain.p.maxWeight);
}

// The drawn curve of a connector: its cell path with each step split in two,
// then smoothed a few times with both ends fixed. Straight runs stay straight,
// corners are cut and staircases become diagonals. Cached until the
// connector's cells change.
const SUBSTEPS = 2;
const curves = new WeakMap(); // connector -> { length, last, points }
function smoothCurve(cells) {
  const raw = cells.map(cellToVector);
  let points = [raw[0]];
  for (let i = 1; i < raw.length; i += 1) {
    points.push(raw[i - 1].clone().lerp(raw[i], 0.5), raw[i]);
  }
  for (let pass = 0; pass < 4; pass += 1) {
    points = points.map((p, j) => (j === 0 || j === points.length - 1
      ? p
      : p.clone().multiplyScalar(0.5).addScaledVector(points[j - 1], 0.25).addScaledVector(points[j + 1], 0.25)));
  }
  return points;
}
function connectorCurve(connector) {
  const cached = curves.get(connector);
  const last = connector.cells.at(-1);
  if (cached && cached.length === connector.cells.length && cached.last === last) return cached.points;
  const points = smoothCurve([connector.owner.soma, ...connector.cells]);
  curves.set(connector, { length: connector.cells.length, last, points });
  return points;
}

// Radius along a connector. s runs from 0 at the body to 1 at the tip, and
// cells is the distance from the body in cells.
function taper(connector, base, s, cells) {
  if (connector.type === 'dendrite') return base * (1.9 - 1.1 * s); // thick at the body
  return base * (1 + 1.2 * Math.max(0, 1 - cells / 0.9)); // axon hillock: a cone about one cell long
}

const up = new THREE.Vector3(0, 1, 0);
const direction = new THREE.Vector3();
const middle = new THREE.Vector3();
const segmentScale = new THREE.Vector3();
const segmentRotation = new THREE.Quaternion();
const connectorColor = (connector) => (connector.type === 'axon' && connector.owner.inhibitory
  ? COLORS.inhibitory : COLORS[connector.type]);

function updateConnectors() {
  let segments = 0;
  let joints = 0;
  brain.connectors.forEach((connector) => {
    if (!connector.cells.length) return;
    const base = connectorRadius(connector);
    tint.setHex(connectorColor(connector)).multiplyScalar(STATE_BRIGHTNESS[connector.state]);
    const points = connectorCurve(connector);
    const last = points.length - 1;
    for (let j = 1; j <= last && segments < MAX_SEGMENTS; j += 1) {
      const a = points[j - 1];
      const b = points[j];
      direction.subVectors(b, a);
      const length = direction.length();
      if (length < 1e-4) continue;
      const radius = taper(connector, base, (j - 0.5) / last, (j - 0.5) / SUBSTEPS);
      segmentRotation.setFromUnitVectors(up, direction.divideScalar(length));
      place(segmentMesh, segments, middle.addVectors(a, b).multiplyScalar(0.5), segmentScale.set(radius, length, radius), segmentRotation);
      segmentMesh.setColorAt(segments, tint);
      segments += 1;
      // A joint rounds each bend; a connected axon ends in a bouton.
      place(jointMesh, joints, b, taper(connector, base, j / last, j / SUBSTEPS));
      jointMesh.setColorAt(joints, tint);
      joints += 1;
    }
  });
  finish(segmentMesh, segments);
  finish(jointMesh, joints);
}

function updateOccupancy() {
  let count = 0;
  brain.connectors.forEach((connector) => {
    tint.setHex(connectorColor(connector));
    connector.cells.forEach((cell) => {
      place(occupancy, count, cellToVector(cell), 1);
      occupancy.setColorAt(count, tint);
      count += 1;
    });
  });
  finish(occupancy, count);
}

function collectEvents(time) {
  brain.events.forEach(({ type, synapse, cell }) => {
    if (rings.length >= MAX_RINGS) rings.shift();
    rings.push({ position: cellToVector(cell ?? synapse.cell), style: RING_STYLE[type], start: time });
  });
}

function updateRings(time) {
  rings = rings.filter((ring) => time - ring.start < ring.style.ms);
  rings.forEach((ring, i) => {
    const t = (time - ring.start) / ring.style.ms;
    const eased = 1 - (1 - t) ** 2;
    const { from, to, color } = ring.style;
    place(ringMesh, i, ring.position, from + (to - from) * eased, camera.quaternion);
    ringMesh.setColorAt(i, tint.copy(color).multiplyScalar(1 - t));
  });
  finish(ringMesh, rings.length);
}

function updateHud() {
  digitElement.textContent = brain.digit;
  const rewarded = brain.dopamine > 0.1;
  // The status already names the reward; the gold colour marks dopamine.
  statusElement.textContent = brain.status;
  statusElement.classList.toggle('reward', rewarded);
  scoreElement.textContent = `Correct ${brain.rewards} / ${brain.attempts}`;
  const recent = brain.history.slice(-50);
  recentElement.textContent = recent.length
    ? `Last ${recent.length}: ${Math.round((100 * recent.filter(Boolean).length) / recent.length)}%`
    : 'Last 50: –';
  synapseElement.textContent = `Synapses ${brain.synapses.length}`;
  const changes = brain.lastChanges;
  changesElement.textContent = changes
    ? `Last answer: ${changes.strengthened} stronger · ${changes.weakened} weaker · ${changes.pruned} pruned`
    : '';
}

// Runs once per simulation step.
function syncScene() {
  updateConnectors();
  updateOccupancy();
  updateHud();
}

// The drawn route of a synapse's spikes: the axon's curve to the synapse,
// then the dendrite's curve back to its body. Each cell step is SUBSTEPS
// points, so a spike at cell index t sits at curve index t * SUBSTEPS.
const routes = new WeakMap(); // synapse -> points
// Where an en passant synapse touches: the axon's point (or the digit cell)
// and the dendrite's point (or the output cell), on the drawn curves.
function contactEnds(synapse) {
  const a = synapse.axon
    ? connectorCurve(synapse.axon)[(synapse.axonIndex + 1) * SUBSTEPS]
    : cellToVector(synapse.cell);
  const d = synapse.dendrite
    ? connectorCurve(synapse.dendrite)[(synapse.dendriteIndex + 1) * SUBSTEPS]
    : cellToVector(synapse.partnerCell);
  return { a, d };
}

function spikeRoute(synapse) {
  let route = routes.get(synapse);
  if (route) return route;
  if (synapse.contact) {
    // Along the axon to the contact, across it (two half steps, so a cell
    // step stays SUBSTEPS points), then along the dendrite to its body.
    const { a, d } = contactEnds(synapse);
    const out = synapse.axon ? connectorCurve(synapse.axon).slice(0, (synapse.axonIndex + 1) * SUBSTEPS + 1) : [a];
    const back = synapse.dendrite
      ? connectorCurve(synapse.dendrite).slice(0, (synapse.dendriteIndex + 1) * SUBSTEPS + 1).reverse()
      : [d];
    route = [...out, a.clone().lerp(d, 0.5), ...back];
    routes.set(synapse, route);
    return route;
  }
  const out = synapse.axon ? connectorCurve(synapse.axon) : [cellToVector(synapse.cell)];
  const back = synapse.dendrite ? [...connectorCurve(synapse.dendrite)].reverse().slice(1) : [];
  route = out.concat(back);
  routes.set(synapse, route);
  return route;
}

function pointOnPath(points, t, target) {
  const clamped = Math.max(0, Math.min(points.length - 1, t));
  const i = Math.min(points.length - 2, Math.floor(clamped));
  return target.lerpVectors(points[i], points[i + 1], clamped - i);
}

const spot = new THREE.Vector3();
function updateSpikes(frac) {
  const count = Math.min(brain.spikes.length, MAX_SPIKES);
  for (let s = 0; s < count; s += 1) {
    const spike = brain.spikes[s];
    const head = spike.index + frac;
    // Dark-channel signals are violet until they reach the first neuron;
    // whatever a neuron fires is its own (gold) signal.
    // A neuron's own signals are gold, or magenta if it is inhibitory.
    const { from } = spike.synapse;
    const kind = from.inhibitory ? 'inhibitory' : from.channel === 'dark' ? 'dark' : 'lit';
    const g = glowTint[kind];
    const route = spikeRoute(spike.synapse);
    for (let k = 0; k < TRAIL.length; k += 1) {
      const p = pointOnPath(route, (head - TRAIL[k]) * SUBSTEPS, spot);
      const i = (s * TRAIL.length + k) * 3;
      const fade = 1 - k / TRAIL.length;
      glowPositions[i] = p.x;
      glowPositions[i + 1] = p.y;
      glowPositions[i + 2] = p.z;
      glowColors[i] = g.r * fade;
      glowColors[i + 1] = g.g * fade;
      glowColors[i + 2] = g.b * fade;
      if (k === 0) {
        corePositions[s * 3] = p.x;
        corePositions[s * 3 + 1] = p.y;
        corePositions[s * 3 + 2] = p.z;
        coreTint[kind].toArray(coreColors, s * 3);
      }
    }
  }
  glowGeometry.setDrawRange(0, count * TRAIL.length);
  coreGeometry.setDrawRange(0, count);
  glowGeometry.attributes.position.needsUpdate = true;
  glowGeometry.attributes.color.needsUpdate = true;
  coreGeometry.attributes.position.needsUpdate = true;
  coreGeometry.attributes.color.needsUpdate = true;
}

const haloRest = new THREE.Color(COLORS.dendrite);
const haloInhibitory = new THREE.Color(COLORS.inhibitory);
const somaInhibitory = new THREE.Color(1, 0.72, 0.82);
const haloFire = new THREE.Color(COLORS.spikeGlow);
const gold = new THREE.Color(COLORS.gold);
const dimGold = new THREE.Color(0x8a7440); // muted lit-channel gold
const darkFaint = new THREE.Color(0x5e4c8c); // muted dark-channel violet
const axonColor = new THREE.Color(COLORS.axon);
const dendriteColor = new THREE.Color(COLORS.dendrite);
const toNeighbour = new THREE.Vector3();
const partSpot = new THREE.Vector3();
const partScale = new THREE.Vector3();
const partMid = new THREE.Vector3();
const partRotation = new THREE.Quaternion();
const barDirection = new THREE.Vector3();
const barSpot = new THREE.Vector3();
const barScale = new THREE.Vector3();
const barRotation = new THREE.Quaternion();

// Per-frame glow effects: firing, charge, input and output activity, dopamine.
function updateGlow(time) {
  const since = (node) => brain.tick - node.lastFired;

  brain.neurons.forEach((neuron, i) => {
    const charge = Math.max(0, Math.min(1, neuron.potential / neuron.threshold));
    const flash = Math.max(0, 1 - since(neuron) / 4);
    const glowLevel = 0.85 + charge * 0.3 + flash * 0.6;
    somaMesh.setColorAt(i, neuron.inhibitory ? tint.copy(somaInhibitory).multiplyScalar(glowLevel) : tint.setScalar(glowLevel));
    haloSizes[i] = (1.1 + charge * 0.5 + flash * 1.4) * HALO_SIZE;
    const rest = neuron.inhibitory ? haloInhibitory : haloRest;
    tint.copy(flash > 0 && !neuron.inhibitory ? haloFire : rest).multiplyScalar(0.35 + charge * 0.4 + flash * 0.6);
    tint.toArray(haloColors, i * 3);
  });
  somaMesh.instanceColor.needsUpdate = true;
  if (haloGeometry.attributes.size) {
    haloGeometry.attributes.size.needsUpdate = true;
    haloGeometry.attributes.haloColor.needsUpdate = true;
  }

  // Each digit cell belongs to one channel. It glows while its channel is
  // active (gold for lit cells of a lit segment, violet for dark cells of an
  // unlit one) and stays faint otherwise, so it doesn't hide the network.
  let lit = 0;
  let dark = 0;
  let faint = 0;
  digitCells.forEach(({ cell, position }) => {
    const input = brain.cells.get(keyOf(cell)).node;
    const active = brain.active(input);
    const flash = active ? Math.max(0, 1 - since(input) / 3) : 0;
    if (active && cell.channel === 'lit') {
      place(digitLit, lit, position, 1);
      digitLit.setColorAt(lit, tint.copy(gold).multiplyScalar(1 + flash * 0.8));
      lit += 1;
    } else if (active) {
      place(digitDark, dark, position, 1);
      digitDark.setColorAt(dark, tint.setScalar(1 + flash * 2));
      dark += 1;
    } else {
      place(digitFaint, faint, position, 1);
      digitFaint.setColorAt(faint, cell.channel === 'dark' ? darkFaint : dimGold);
      faint += 1;
    }
  });
  finish(digitLit, lit);
  finish(digitDark, dark);
  finish(digitFaint, faint);

  outputCells.forEach(({ x, color }, i) => {
    const node = brain.outputs.find((o) => o.x === x);
    const flash = node ? Math.max(0, 1 - since(node) / 5) : 0;
    const chosen = brain.pause > 0 && brain.answer && x !== 4 && (x < 4) === (brain.answer === 'small');
    outputMesh.setColorAt(i, tint.copy(color).multiplyScalar(0.8 + flash * 1.5 + (chosen ? 0.6 : 0)));
  });
  outputMesh.instanceColor.needsUpdate = true;

  // Size shows weight; brightness shows trophic support, which fades before a
  // prune. Synapses credited for a rewarded answer flash on dopamine.
  const rewardGlow = brain.dopamine > 0.05;
  let boutons = 0;
  let spines = 0;
  let bars = 0;
  brain.synapses.forEach((synapse) => {
    const strength = synapse.weight / brain.p.maxWeight;
    const credited = rewardGlow && brain.lastEligible?.has(synapse);
    const support = Math.min(1, synapse.trophic);
    const boost = credited ? brain.dopamine * 0.8 : 0;
    if (synapse.inhibitory) {
      if (bars >= 200) return;
      // A bar on the body's surface, facing the incoming axon.
      const route = connectorCurve(synapse.axon);
      const body = route.at(-1);
      barDirection.subVectors(route.at(-2) ?? body, body).normalize();
      barScale.set(0.7 + strength * 0.6 + boost, 1, 0.7 + strength * 0.6 + boost);
      place(inhibitoryBarMesh, bars, barSpot.copy(body).addScaledVector(barDirection, 0.42), barScale,
        barRotation.setFromUnitVectors(up, barDirection));
      tint.setHex(COLORS.inhibitory).multiplyScalar(0.35 + support * 0.8);
      if (credited) tint.lerp(white, brain.dopamine * 0.8);
      inhibitoryBarMesh.setColorAt(bars, tint);
      bars += 1;
      return;
    }
    // The two parts overlap into one rounded junction, each pulled slightly
    // toward its own connector and stretched along it (a bouton is egg-shaped).
    const radius = 0.11 + strength * 0.09 + boost * 0.1;
    const brightness = 0.9 + support * 0.7; // above 1 brightens the part's own colour
    const addPart = (mesh, index, connector, color, size, stretch) => {
      let point;
      if (synapse.contact) {
        // En passant: the junction sits between the two touching cells.
        const ends = contactEnds(synapse);
        point = partMid.lerpVectors(ends.a, ends.d, 0.5);
        toNeighbour.subVectors(connector === synapse.axon ? ends.a : ends.d, point).normalize();
      } else {
        const route = connectorCurve(connector);
        point = route.at(-1);
        toNeighbour.subVectors(route.at(-2) ?? point, point).normalize();
      }
      partScale.set(size, size * stretch, size);
      place(mesh, index, partSpot.copy(point).addScaledVector(toNeighbour, size * 0.4), partScale,
        partRotation.setFromUnitVectors(up, toNeighbour));
      tint.copy(color).multiplyScalar(brightness);
      if (credited) tint.lerp(white, brain.dopamine * 0.8);
      mesh.setColorAt(index, tint);
    };
    if (synapse.axon && boutons < 400) {
      addPart(boutonMesh, boutons, synapse.axon, axonColor, radius * 1.1, 1.35);
      boutons += 1;
    }
    if (synapse.dendrite && spines < 400) {
      addPart(spineMesh, spines, synapse.dendrite, dendriteColor, radius, 1.1);
      spines += 1;
    }
  });
  finish(boutonMesh, boutons);
  finish(spineMesh, spines);
  finish(inhibitoryBarMesh, bars);

  frameMaterial.color.setHex(COLORS.frame).lerp(tint.setHex(COLORS.gold), brain.dopamine);
  frameMaterial.opacity = 0.85 + 0.15 * Math.sin(time * 0.01) * brain.dopamine;
}

// Keep the whole cube in view at any aspect ratio, including tall phones.
const CUBE_RADIUS = 6.8;
let fittedAspect = 0;
// The HUD bars cover the top and bottom of the canvas. Their solid parts are
// measured so the cube is framed and centred in the space between them.
const topBar = document.querySelector('.hud.top');
const bottomBar = document.querySelector('.hud.bottom');
const FADE_PX = 32; // each bar ends in a see-through gradient this tall
function hudInsets() {
  // On a wide, tall window the bars' text sits in the corners, clear of the
  // cube, so only half of their height needs to be kept free.
  const roomy = canvas.clientWidth > 900 && canvas.clientHeight > 600;
  const share = roomy ? 0.5 : 1;
  return {
    top: Math.max(0, topBar.offsetHeight - FADE_PX) * share,
    bottom: Math.max(0, bottomBar.offsetHeight - FADE_PX) * share,
  };
}

function fitCamera(aspect, freeShare) {
  const half = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const vertical = 2 * Math.atan(half * freeShare);
  const horizontal = 2 * Math.atan(half * aspect);
  const distance = CUBE_RADIUS / Math.sin(Math.min(vertical, horizontal) / 2);
  camera.position.sub(controls.target).setLength(distance).add(controls.target);
  controls.minDistance = distance * 0.5;
  controls.maxDistance = distance * 1.6;
}

const bufferSize = new THREE.Vector2();
let fittedFree = 0;
let lastWidth = 0;
let lastHeight = 0;
// When the bottom bar changes height (legend opened or closed, text wrapping),
// lay the view out again.
new ResizeObserver(() => { lastWidth = 0; }).observe(bottomBar);
function resize() {
  const { clientWidth: width, clientHeight: height } = canvas;
  // setSize reallocates the drawing buffer, so only call it when the size changes.
  if (width === lastWidth && height === lastHeight) return;
  lastWidth = width;
  lastHeight = height;
  renderer.setSize(width, height, false);
  haloMaterial.uniforms.scale.value = renderer.getDrawingBufferSize(bufferSize).y / 2;
  camera.aspect = width / height;
  const { top, bottom } = hudInsets();
  const free = Math.max(height * 0.3, height - top - bottom);
  // Shift the view so the cube's centre sits in the middle of the free space.
  camera.setViewOffset(width, height, 0, (bottom - top) / 2, width, height);
  camera.updateProjectionMatrix();
  if (Math.abs(camera.aspect - fittedAspect) > 0.15 || Math.abs(free - fittedFree) > 24) {
    fitCamera(camera.aspect, free / height);
    fittedAspect = camera.aspect;
    fittedFree = free;
  }
}

// Lower the render resolution on devices that can't keep up, and raise it
// again when there's headroom. Checked every 90 frames.
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 2);
let pixelRatio = MAX_PIXEL_RATIO;
let frameCount = 0;
let frameTime = 0;
let lastFrame = 0;
function adaptResolution(time) {
  const delta = time - lastFrame;
  lastFrame = time;
  if (delta <= 0 || delta > 250) return; // first frame, or the tab was hidden
  frameCount += 1;
  frameTime += delta;
  if (frameCount < 90) return;
  const average = frameTime / frameCount;
  frameCount = 0;
  frameTime = 0;
  let next = pixelRatio;
  if (average > 24) next = Math.max(1, pixelRatio - 0.25); // under ~40 FPS
  else if (average < 14) next = Math.min(MAX_PIXEL_RATIO, pixelRatio + 0.25);
  if (next === pixelRatio) return;
  pixelRatio = next;
  renderer.setPixelRatio(pixelRatio);
  lastWidth = 0; // force resize() to apply the new resolution
}

// Speed: 1 = 10 steps a second. Faster speeds run several steps per frame and
// redraw once; "max" runs as many as fit in about 10 ms of each frame.
let speed = 1;
try {
  const saved = localStorage.getItem('neuron-sim-speed');
  if (saved) speed = saved === 'max' ? Infinity : Number(saved) || 1;
} catch {
  // storage unavailable: keep 1×
}
const FRAME_BUDGET_MS = 10;

function setSpeed(value) {
  speed = value === 'max' ? Infinity : Number(value);
  // The legend starts open where there is room and closed on phones; the
// viewer's own choice is remembered.
const legendBox = document.querySelector('#legend-box');
let legendOpen = window.matchMedia('(min-width: 601px) and (min-height: 501px)').matches;
try {
  const saved = localStorage.getItem('neuron-sim-legend');
  if (saved) legendOpen = saved === 'open';
} catch {
  // storage unavailable: use the default for this screen
}
legendBox.open = legendOpen;
legendBox.addEventListener('toggle', () => {
  try {
    localStorage.setItem('neuron-sim-legend', legendBox.open ? 'open' : 'closed');
  } catch {
    // storage unavailable: the choice lasts until reload
  }
});

document.querySelectorAll('.speed button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.speed === String(value)));
  });
  try {
    localStorage.setItem('neuron-sim-speed', String(value));
  } catch {
    // storage unavailable: the choice lasts until reload
  }
}
document.querySelectorAll('.speed button').forEach((button) => {
  button.addEventListener('click', () => setSpeed(button.dataset.speed));
});
setSpeed(speed === Infinity ? 'max' : speed);

let lastStep = 0;
let lastRings = 0;
function animate(time) {
  adaptResolution(time);
  resize();
  const interval = STEP_MS / speed; // 0 at max speed
  if (time - lastStep >= interval) {
    const due = interval > 0 ? Math.floor((time - lastStep) / interval) : Infinity;
    const stop = performance.now() + FRAME_BUDGET_MS;
    let steps = 0;
    // Up to 10x every step's synapse events get a ring. Faster, only the latest
    // step's, at most every 100 ms (as at 1x), so the rings stay readable.
    const everyStep = speed <= 10;
    do {
      brain.step();
      if (everyStep) collectEvents(time);
      steps += 1;
    } while (steps < due && performance.now() < stop);
    if (!everyStep && time - lastRings >= STEP_MS) {
      collectEvents(time);
      lastRings = time;
    }
    // If this device couldn't keep up, drop the backlog instead of piling it up.
    lastStep = steps < due ? time : lastStep + steps * interval;
    syncScene();
  }
  updateSpikes(interval > 0 ? Math.min(1, (time - lastStep) / interval) : 0);
  updateGlow(time);
  updateRings(time);
  controls.update();
  const cameraDistance = camera.position.distanceTo(controls.target);
  scene.fog.near = cameraDistance - 4;
  scene.fog.far = cameraDistance + 26;
  renderer.render(scene, camera);
}

document.querySelector('#reset').addEventListener('click', () => {
  brain = new Brain();
  rings = [];
  createScene();
  syncScene();
});

createScene();
syncScene();
