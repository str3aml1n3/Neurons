import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.171.0/examples/jsm/controls/OrbitControls.js';
import { Brain, SEGMENT_CELLS, SIZE } from './brain.js';

const STEP_MS = 100;
// Every color stands for a role; styles.css uses the same values for the legend.
const COLORS = {
  neuron: 0xeef6ff,
  dendrite: 0x4fd8e8,
  axon: 0xff8a5c,
  synapse: 0xb7ff6a,
  spike: 0xfff6c2,
  spikeGlow: 0xffc23a,
  small: 0x3f7dff,
  big: 0xff4d5e,
  neutral: 0x4a5266,
  gold: 0xffc64b,
  frame: 0x88d9ff,
};

const canvas = document.querySelector('#scene');
const digitElement = document.querySelector('#digit');
const statusElement = document.querySelector('#status');
const scoreElement = document.querySelector('#score');
const recentElement = document.querySelector('#recent');
const synapseElement = document.querySelector('#synapses');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setAnimationLoop(animate);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
camera.position.set(10, 8, -15);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.target.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0x8db7e8, 1.6));
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
  color: 0x58bce8, transparent: true, opacity: 0.07, depthWrite: false,
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

// Input and output cells are whole cubes inside the grid's front and back layers.
const ioGeometry = new THREE.BoxGeometry(0.78, 0.78, 0.78);
const digitCells = SEGMENT_CELLS.map((cell) => {
  const mesh = new THREE.Mesh(ioGeometry, new THREE.MeshStandardMaterial({
    color: COLORS.gold, emissive: 0xa96400, transparent: true, opacity: 0.92,
  }));
  mesh.position.copy(cellToVector(cell));
  cube.add(mesh);
  return { cell, mesh };
});
const outputCells = Array.from({ length: SIZE }, (_, x) => {
  const color = x < 4 ? COLORS.small : x > 4 ? COLORS.big : COLORS.neutral;
  const mesh = new THREE.Mesh(ioGeometry, new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.35, transparent: true, opacity: 0.92,
  }));
  mesh.position.copy(cellToVector({ x, y: 4, z: SIZE - 1 }));
  cube.add(mesh);
  return { x, mesh };
});

// Faint tinted cube on every cell a connector occupies.
const occupancy = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.94, 0.94, 0.94),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.06, depthWrite: false }),
  SIZE ** 3,
);
occupancy.setColorAt(0, new THREE.Color(COLORS.dendrite)); // create the color buffer up front
occupancy.count = 0;
cube.add(occupancy);

const neuronGroup = new THREE.Group();
const connectorGroup = new THREE.Group();
const synapseGroup = new THREE.Group();
cube.add(connectorGroup, synapseGroup, neuronGroup);

const somaGeometry = new THREE.SphereGeometry(0.34, 20, 14);
const synapseGeometry = new THREE.BoxGeometry(0.36, 0.36, 0.36);

// Signals: glowing points drawn over everything, with a short fading trail.
const MAX_SPIKES = 600;
const TRAIL = [0, 0.35, 0.7];
const glowPositions = new Float32Array(MAX_SPIKES * TRAIL.length * 3);
const glowColors = new Float32Array(MAX_SPIKES * TRAIL.length * 3);
const corePositions = new Float32Array(MAX_SPIKES * 3);
const glowGeometry = new THREE.BufferGeometry();
glowGeometry.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
glowGeometry.setAttribute('color', new THREE.BufferAttribute(glowColors, 3));
const coreGeometry = new THREE.BufferGeometry();
coreGeometry.setAttribute('position', new THREE.BufferAttribute(corePositions, 3));
const pointMaterial = (color, size, vertexColors) => new THREE.PointsMaterial({
  color, size, map: glow, vertexColors, transparent: true, depthTest: false, depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const spikeGlow = new THREE.Points(glowGeometry, pointMaterial(COLORS.spikeGlow, 1.3, true));
const spikeCore = new THREE.Points(coreGeometry, pointMaterial(COLORS.spike, 0.5, false));
spikeGlow.renderOrder = 10;
spikeCore.renderOrder = 11;
spikeGlow.frustumCulled = false;
spikeCore.frustumCulled = false;
cube.add(spikeGlow, spikeCore);

let brain = new Brain();
let somas = new Map(); // neuron -> { body, halo }
let tubes = new Map(); // connector -> mesh
let synapseMeshes = new Map(); // synapse -> mesh

// A connector is drawn as straight tube segments through cell centers.
function connectorGeometry(connector, radius) {
  const points = [connector.owner.soma, ...connector.cells].map(cellToVector);
  if (points.length < 2) return new THREE.BufferGeometry();
  const path = new THREE.CurvePath();
  for (let i = 1; i < points.length; i += 1) path.add(new THREE.LineCurve3(points[i - 1], points[i]));
  return new THREE.TubeGeometry(path, (points.length - 1) * 4, radius, 6, false);
}

function connectorRadius(connector) {
  const base = connector.type === 'axon' ? 0.05 : 0.038;
  if (!connector.synapse) return base;
  return base * 0.7 + 0.06 * (connector.synapse.weight / brain.p.maxWeight);
}

// Rebuilding a TubeGeometry uploads new GPU buffers, so only do it when the
// connector's cells or thickness changed.
function updateTube(connector) {
  const mesh = tubes.get(connector);
  const radius = connectorRadius(connector);
  const last = connector.cells.at(-1);
  const data = mesh.userData;
  if (data.length !== connector.cells.length || data.last !== last || data.radius !== radius) {
    data.length = connector.cells.length;
    data.last = last;
    data.radius = radius;
    mesh.geometry.dispose();
    mesh.geometry = connectorGeometry(connector, radius);
  }
  const opacity = { growing: 0.6, connected: 0.95, retracting: 0.25 }[connector.state];
  mesh.material.opacity = opacity;
}

function createScene() {
  [neuronGroup, connectorGroup, synapseGroup].forEach((group) => {
    group.children.forEach((child) => {
      if (child.geometry !== somaGeometry && child.geometry !== synapseGeometry) child.geometry?.dispose();
      child.material?.dispose();
    });
    group.clear();
  });
  somas = new Map();
  tubes = new Map();
  synapseMeshes = new Map();
  brain.neurons.forEach((neuron) => {
    const body = new THREE.Mesh(somaGeometry, new THREE.MeshStandardMaterial({
      color: COLORS.neuron, emissive: COLORS.neuron, emissiveIntensity: 0.25, roughness: 0.35,
    }));
    body.position.copy(cellToVector(neuron.soma));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: COLORS.dendrite, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.position.copy(body.position);
    neuronGroup.add(body, halo);
    somas.set(neuron, { body, halo });
  });
  brain.connectors.forEach((connector) => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({
      color: COLORS[connector.type],
      emissive: COLORS[connector.type],
      emissiveIntensity: 0.45,
      transparent: true,
      depthWrite: false,
    }));
    mesh.userData = { length: -1, last: null, radius: 0 };
    connectorGroup.add(mesh);
    tubes.set(connector, mesh);
  });
}

const matrix = new THREE.Matrix4();
const tint = new THREE.Color();
function updateOccupancy() {
  let count = 0;
  brain.connectors.forEach((connector) => {
    tint.setHex(COLORS[connector.type]);
    connector.cells.forEach((cell) => {
      const { x, y, z } = cellToVector(cell);
      occupancy.setMatrixAt(count, matrix.makeTranslation(x, y, z));
      occupancy.setColorAt(count, tint);
      count += 1;
    });
  });
  occupancy.count = count;
  occupancy.instanceMatrix.needsUpdate = true;
  if (occupancy.instanceColor) occupancy.instanceColor.needsUpdate = true;
}

function updateSynapses() {
  const alive = new Set(brain.synapses);
  synapseMeshes.forEach((mesh, synapse) => {
    if (alive.has(synapse)) return;
    synapseGroup.remove(mesh);
    mesh.material.dispose();
    synapseMeshes.delete(synapse);
  });
  brain.synapses.forEach((synapse) => {
    if (synapseMeshes.has(synapse)) return;
    const mesh = new THREE.Mesh(synapseGeometry, new THREE.MeshStandardMaterial({
      color: COLORS.synapse, emissive: COLORS.synapse, emissiveIntensity: 0.6,
    }));
    mesh.position.copy(cellToVector(synapse.cell));
    synapseGroup.add(mesh);
    synapseMeshes.set(synapse, mesh);
  });
}

function updateHud() {
  digitElement.textContent = brain.digit;
  const rewarded = brain.dopamine > 0.1;
  statusElement.textContent = rewarded ? `${brain.status} · dopamine` : brain.status;
  statusElement.classList.toggle('reward', rewarded);
  scoreElement.textContent = `Correct ${brain.rewards} / ${brain.attempts}`;
  const recent = brain.history.slice(-50);
  recentElement.textContent = recent.length
    ? `Last ${recent.length}: ${Math.round((100 * recent.filter(Boolean).length) / recent.length)}%`
    : 'Last 50: –';
  synapseElement.textContent = `Synapses ${brain.synapses.length}`;
}

function syncScene() {
  brain.connectors.forEach(updateTube);
  updateOccupancy();
  updateSynapses();
  updateHud();
}

function pointOnPath(path, t, target) {
  const clamped = Math.max(0, Math.min(path.length - 1, t));
  const i = Math.min(path.length - 2, Math.floor(clamped));
  const a = path[i];
  const b = path[i + 1];
  const f = clamped - i;
  target.set(4 - (a.x + (b.x - a.x) * f), 4 - (a.y + (b.y - a.y) * f), (a.z + (b.z - a.z) * f) - 4);
  return target;
}

const spot = new THREE.Vector3();
function updateSpikes(frac) {
  const spikes = brain.spikes.slice(0, MAX_SPIKES);
  spikes.forEach((spike, s) => {
    const head = spike.index + frac;
    TRAIL.forEach((back, k) => {
      const p = pointOnPath(spike.path, head - back, spot);
      const i = (s * TRAIL.length + k) * 3;
      glowPositions.set([p.x, p.y, p.z], i);
      const fade = 1 - k / TRAIL.length;
      glowColors.set([fade, fade, fade], i);
      if (k === 0) corePositions.set([p.x, p.y, p.z], s * 3);
    });
  });
  glowGeometry.setDrawRange(0, spikes.length * TRAIL.length);
  coreGeometry.setDrawRange(0, spikes.length);
  glowGeometry.attributes.position.needsUpdate = true;
  glowGeometry.attributes.color.needsUpdate = true;
  coreGeometry.attributes.position.needsUpdate = true;
}

// Per-frame glow effects: firing, charge, input and output activity, dopamine.
function updateGlow(time) {
  const since = (node) => brain.tick - node.lastFired;
  somas.forEach(({ body, halo }, neuron) => {
    const charge = Math.max(0, Math.min(1, neuron.potential / neuron.threshold));
    const flash = Math.max(0, 1 - since(neuron) / 4);
    halo.material.color.setHex(flash > 0 ? COLORS.spikeGlow : COLORS.dendrite);
    halo.material.opacity = 0.35 + charge * 0.4 + flash * 0.6;
    halo.scale.setScalar(1.1 + charge * 0.5 + flash * 1.4);
    body.material.emissiveIntensity = 0.25 + charge * 0.5 + flash * 1.5;
  });
  digitCells.forEach(({ cell, mesh }) => {
    const input = brain.inputs[cell.segment];
    const lit = brain.lit(cell.segment);
    const flash = Math.max(0, 1 - since(input) / 3);
    mesh.material.color.setHex(lit ? COLORS.gold : 0x6b5a30);
    mesh.material.opacity = lit ? 0.92 : 0.12; // unlit cells stay faint so they don't hide the network
    mesh.material.emissiveIntensity = lit ? 0.9 + flash * 1.6 : 0.03;
  });
  outputCells.forEach(({ x, mesh }) => {
    const node = brain.outputs.find((o) => o.x === x);
    const flash = node ? Math.max(0, 1 - since(node) / 5) : 0;
    const chosen = brain.pause > 0 && brain.answer && x !== 4 && (x < 4) === (brain.answer === 'small');
    mesh.material.emissiveIntensity = 0.35 + flash * 2.5 + (chosen ? 0.9 : 0);
  });
  const rewardGlow = brain.dopamine > 0.05;
  synapseMeshes.forEach((mesh, synapse) => {
    const strength = synapse.weight / brain.p.maxWeight;
    const credited = rewardGlow && brain.lastEligible?.has(synapse);
    mesh.scale.setScalar(0.6 + strength * 0.9 + (credited ? brain.dopamine * 0.8 : 0));
    mesh.material.emissiveIntensity = 0.4 + strength * 0.8 + (credited ? brain.dopamine * 3 : 0);
  });
  frameMaterial.color.setHex(COLORS.frame).lerp(tint.setHex(COLORS.gold), brain.dopamine);
  frameMaterial.opacity = 0.85 + 0.15 * Math.sin(time * 0.01) * brain.dopamine;
}

// Keep the whole cube in view at any aspect ratio, including tall phones.
const CUBE_RADIUS = 6.8;
let fittedAspect = 0;
function fitCamera(aspect) {
  const vertical = THREE.MathUtils.degToRad(camera.fov);
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const distance = CUBE_RADIUS / Math.sin(Math.min(vertical, horizontal) / 2);
  camera.position.sub(controls.target).setLength(distance).add(controls.target);
  controls.minDistance = distance * 0.5;
  controls.maxDistance = distance * 1.6;
}

let lastWidth = 0;
let lastHeight = 0;
function resize() {
  const { clientWidth: width, clientHeight: height } = canvas;
  // setSize reallocates the drawing buffer, so only call it when the size changes.
  if (width === lastWidth && height === lastHeight) return;
  lastWidth = width;
  lastHeight = height;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (Math.abs(camera.aspect - fittedAspect) > 0.15) {
    fitCamera(camera.aspect);
    fittedAspect = camera.aspect;
  }
}

let lastStep = 0;
function animate(time) {
  resize();
  if (time - lastStep >= STEP_MS) {
    brain.step();
    lastStep = time;
    syncScene();
  }
  updateSpikes(Math.min(1, (time - lastStep) / STEP_MS));
  updateGlow(time);
  controls.update();
  renderer.render(scene, camera);
}

document.querySelector('#reset').addEventListener('click', () => {
  brain = new Brain();
  createScene();
  syncScene();
});

createScene();
syncScene();
