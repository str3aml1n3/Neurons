import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.171.0/examples/jsm/controls/OrbitControls.js';

const SIZE = 9;
const DIGITS = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];
class Brain {
  constructor() {
    this.neurons = [];
    this.activePath = [];
    this.signal = null;
    this.signalIndex = 0;
    this.pause = 0;
    this.ticks = 0;
    this.edgeSequence = 0;
    this.rewards = 0;
    this.attempts = 0;
    this.dopamine = 0;
    this.outputPulse = null;
    this.status = 'Growing connections';
    this.digit = Math.floor(Math.random() * 10);
    this.layers = [];
    for (let layer = 0; layer < 3; layer += 1) {
      const neurons = [];
      for (let index = 0; index < 7; index += 1) {
        const neuron = {
          layer,
          soma: this.randomSoma(layer, neurons),
          dendrite: [],
          dendriteTarget: null,
          edges: [],
        };
        neuron.dendrite.push(neuron.soma);
        neurons.push(neuron);
        this.neurons.push(neuron);
      }
      this.layers.push(neurons);
    }

    this.layers.forEach((layer, layerIndex) => layer.forEach((source, index) => {
      for (let branch = 0; branch < 2; branch += 1) {
        const target = layerIndex < 2 ? this.layers[layerIndex + 1][(index + branch * 3) % 7] : null;
        const destination = target ? target.soma : { x: branch === 0 ? 1 : 7, y: 4, z: SIZE - 1 };
        source.edges.push({
          source, target, destination, axon: [source.soma], weight: 1, curveSeed: this.edgeSequence++,
        });
      }
    }));
    this.neurons.forEach((neuron) => { neuron.dendriteTarget = this.randomDendriteTarget(neuron.soma); });
  }

  randomSoma(layer, siblings) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const candidate = {
        x: 0.8 + Math.random() * 7.4,
        y: 0.8 + Math.random() * 7.4,
        z: 1 + layer * 3 + (Math.random() - 0.5) * 0.8,
      };
      if (siblings.every((neuron) => Math.hypot(
        neuron.soma.x - candidate.x,
        neuron.soma.y - candidate.y,
        neuron.soma.z - candidate.z,
      ) > 1.25)) return candidate;
    }
    return { x: 1 + siblings.length, y: 1 + (siblings.length % 3) * 3, z: 1 + layer * 3 };
  }

  randomDendriteTarget(soma) {
    return {
      x: Math.max(0.3, Math.min(8.7, soma.x + (Math.random() - 0.5) * 2.2)),
      y: Math.max(0.3, Math.min(8.7, soma.y + (Math.random() - 0.5) * 2.2)),
      z: Math.max(0.3, Math.min(8.7, soma.z + (Math.random() - 0.5) * 2.2)),
    };
  }

  step() {
    this.ticks += 1;
    this.dopamine *= 0.9;
    if (this.outputPulse) {
      this.outputPulse.intensity *= 0.9;
      if (this.outputPulse.intensity < 0.05) this.outputPulse = null;
    }
    this.neurons.forEach((neuron) => {
      if (this.ticks % 3 === 0) this.growDendrite(neuron);
      neuron.edges.forEach((edge) => {
        if (!this.isComplete(edge) && this.ticks % 2 === 0) this.grow(edge);
      });
    });

    if (this.pause > 0) {
      this.pause -= 1;
      return;
    }
    if (!this.signal) {
      const inputs = this.layers[0].filter((_, index) => (DIGITS[this.digit] & (1 << index)) !== 0);
      this.startEdge(inputs[Math.floor(Math.random() * inputs.length)]);
      return;
    }
    if (++this.signalIndex < this.signal.axon.length) return;
    if (!this.isComplete(this.signal)) {
      this.signalIndex = this.signal.axon.length - 1;
      return;
    }
    if (this.signal.target) {
      this.startEdge(this.signal.target);
      return;
    }

    this.attempts += 1;
    const smallOutput = this.signal.destination.x < SIZE / 2;
    this.outputPulse = { x: this.signal.destination.x, intensity: 1 };
    if (smallOutput === (this.digit < 5)) {
      this.rewards += 1;
      this.dopamine = 1;
      this.activePath.forEach((edge) => { edge.weight = Math.min(5, edge.weight + 0.45); });
      this.status = 'Correct! Dopamine reward';
      const next = Math.floor(Math.random() * 9);
      this.digit = next >= this.digit ? next + 1 : next;
    } else {
      this.activePath.forEach((edge) => { edge.weight = Math.max(0.2, edge.weight - 0.08); });
      this.status = 'Not yet - trying again';
    }
    this.activePath = [];
    this.signal = null;
    this.pause = 12;
  }

  startEdge(neuron) {
    const [a, b] = neuron.edges;
    this.signal = Math.random() * (a.weight + b.weight) < a.weight ? a : b;
    this.activePath.push(this.signal);
    this.signalIndex = 0;
    this.status = 'Signal traveling';
  }

  signalPoint() {
    return this.signal ? this.signal.axon[this.signalIndex] : null;
  }

  isComplete(edge) {
    const point = edge.axon.at(-1);
    return Math.hypot(
      point.x - edge.destination.x,
      point.y - edge.destination.y,
      point.z - edge.destination.z,
    ) < 0.02;
  }

  grow(edge) {
    const point = edge.axon.at(-1);
    const dx = edge.destination.x - point.x;
    const dy = edge.destination.y - point.y;
    const dz = edge.destination.z - point.z;
    const distance = Math.hypot(dx, dy, dz);
    const step = Math.min(0.35, distance);
    const jitter = 0.16;
    const length = Math.hypot(
      dx + (Math.random() - 0.5) * jitter,
      dy + (Math.random() - 0.5) * jitter,
      dz + (Math.random() - 0.5) * jitter,
    );
    edge.axon.push(distance <= 0.35
      ? edge.destination
      : {
        x: point.x + (step * (dx + (Math.random() - 0.5) * jitter)) / length,
        y: point.y + (step * (dy + (Math.random() - 0.5) * jitter)) / length,
        z: point.z + (step * (dz + (Math.random() - 0.5) * jitter)) / length,
      });
  }

  growDendrite(neuron) {
    const point = neuron.dendrite.at(-1);
    const target = neuron.dendriteTarget;
    const dx = target.x - point.x;
    const dy = target.y - point.y;
    const dz = target.z - point.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 0.12 || neuron.dendrite.length > 8) {
      neuron.dendrite = [neuron.soma];
      neuron.dendriteTarget = this.randomDendriteTarget(neuron.soma);
      return;
    }
    const step = 0.18;
    neuron.dendrite.push({
      x: point.x + (dx * step) / distance,
      y: point.y + (dy * step) / distance,
      z: point.z + (dz * step) / distance,
    });
  }
}

const canvas = document.querySelector('#scene');
const digitElement = document.querySelector('#digit');
const statusElement = document.querySelector('#status');
const scoreElement = document.querySelector('#score');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setAnimationLoop(animate);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x080e1c, 16, 34);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(10, 8, -15);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 11;
controls.maxDistance = 25;
controls.target.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0x8db7e8, 1.8));
const keyLight = new THREE.PointLight(0x76d7f0, 34, 30);
keyLight.position.set(-7, 8, -10);
scene.add(keyLight);
const warmLight = new THREE.PointLight(0xffaf68, 20, 25);
warmLight.position.set(8, -2, 8);
scene.add(warmLight);

const cube = new THREE.Group();
scene.add(cube);
const frame = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(9, 9, 9)),
  new THREE.LineBasicMaterial({
    color: 0x88d9ff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false,
  }),
);
frame.renderOrder = 4;
cube.add(frame);
const gridPositions = [];
for (let a = 0; a <= 9; a += 1) {
  for (let b = 0; b <= 9; b += 1) {
    const axisA = -4.5 + a;
    const axisB = -4.5 + b;
    gridPositions.push(-4.5, axisA, axisB, 4.5, axisA, axisB);
    gridPositions.push(axisA, -4.5, axisB, axisA, 4.5, axisB);
    gridPositions.push(axisA, axisB, -4.5, axisA, axisB, 4.5);
  }
}
const gridGeometry = new THREE.BufferGeometry();
gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
const grid = new THREE.LineSegments(
  gridGeometry,
  new THREE.LineBasicMaterial({
    color: 0x58bce8, transparent: true, opacity: 0.26, depthWrite: false,
  }),
);
cube.add(grid);
const shell = new THREE.Mesh(
  new THREE.BoxGeometry(8.98, 8.98, 8.98),
  // No transmission: it makes three.js render the whole scene a second time
  // every frame, which is far too costly for a shell at 2.5% opacity.
  new THREE.MeshStandardMaterial({
    color: 0x245878, transparent: true, opacity: 0.025, roughness: 0.18, depthWrite: false,
  }),
);
cube.add(shell);

const pointToVector = ({ x, y, z }) => new THREE.Vector3(x - 4, 4 - y, z - 4);
const digitCells = [];
const digitCellGeometry = new THREE.BoxGeometry(0.9, 0.9, 0.16);
const segmentMaterial = new THREE.MeshStandardMaterial({ color: 0xffc64b, emissive: 0xa96400, emissiveIntensity: 1.6 });

function segmentAt(x, y) {
  if (y === 1 && x >= 2 && x <= 6) return 0;
  if (x === 7 && y >= 2 && y <= 3) return 1;
  if (x === 7 && y >= 5 && y <= 6) return 2;
  if (y === 7 && x >= 2 && x <= 6) return 3;
  if (x === 1 && y >= 5 && y <= 6) return 4;
  if (x === 1 && y >= 2 && y <= 3) return 5;
  if (y === 4 && x >= 2 && x <= 6) return 6;
  return null;
}

for (let x = 0; x < SIZE; x += 1) {
  for (let y = 0; y < SIZE; y += 1) {
    const segment = segmentAt(x, y);
    if (segment === null) continue;
    const cell = new THREE.Mesh(digitCellGeometry, segmentMaterial.clone());
    cell.position.set(x - 4, 4 - y, -4.51);
    cube.add(cell);
    digitCells.push({ cell, segment });
  }
}

const outputCells = [];
const outputGeometry = new THREE.BoxGeometry(0.9, 0.9, 0.16);
for (let x = 0; x < SIZE; x += 1) {
  const ratio = x / (SIZE - 1);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.18 + ratio * 0.8, 0.4 - ratio * 0.25, 1 - ratio * 0.8),
    emissive: new THREE.Color().setRGB(0.04 + ratio * 0.35, 0.05, 0.28 - ratio * 0.2),
    emissiveIntensity: 1.4,
  });
  const cell = new THREE.Mesh(outputGeometry, material);
  cell.position.set(x - 4, 0, 4.51);
  cube.add(cell);
  outputCells.push({ cell, x });
}
const outputPulseMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.42, 18, 12),
  new THREE.MeshBasicMaterial({ color: 0xfff0a3, transparent: true, opacity: 0.75, depthWrite: false }),
);
outputPulseMesh.visible = false;
cube.add(outputPulseMesh);

const neuronGroup = new THREE.Group();
cube.add(neuronGroup);
const sensoryGroup = new THREE.Group();
cube.add(sensoryGroup);
const somaGeometry = new THREE.SphereGeometry(0.16, 16, 12);
const layerStyles = [
  { soma: 0x63e9dc, emissive: 0x117d85, line: 0x4bc9dc },
  { soma: 0xaa8cff, emissive: 0x51349e, line: 0x9578e8 },
  { soma: 0xff83bf, emissive: 0x9c245d, line: 0xea619f },
];
const signalGroup = new THREE.Group();
const signalAura = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
  color: 0xffa229, transparent: true, opacity: 0.22, depthWrite: false,
}));
const signalCore = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
  color: 0xfff4a8, transparent: true, opacity: 0.95, depthWrite: false,
}));
signalGroup.add(signalAura, signalCore);
signalGroup.visible = false;
cube.add(signalGroup);

let brain = new Brain();
const visuals = new Map();
let sensoryLinks = [];
let lastSignalDraw = 0;

function curveFromVectors(anchors, seed) {
  if (anchors.length < 2) return anchors;
  const offset = (index) => new THREE.Vector3(
    Math.sin(seed * 4.17 + index * 1.71),
    Math.cos(seed * 2.39 + index * 2.27),
    Math.sin(seed * 3.11 + index * 1.13),
  ).multiplyScalar(0.035);
  const controls = anchors.map((point, index) => (
    index === 0 || index === anchors.length - 1 ? point : point.clone().add(offset(index))
  ));
  return new THREE.CatmullRomCurve3(controls, false, 'centripetal');
}

function edgeDisplayPoints(edge) {
  return edge.axon.map(pointToVector);
}

function edgeRadius(edge) {
  const strength = (edge.weight - 0.2) / 4.8;
  return 0.015 + Math.max(0, Math.min(1, strength)) * 0.205;
}

function tubeFromVectors(points, color, radius, opacity, seed) {
  const curve = curveFromVectors(points, seed);
  const geometry = Array.isArray(curve)
    ? new THREE.BufferGeometry()
    : new THREE.TubeGeometry(curve, Math.max(8, points.length * 5), radius, 6, false);
  const material = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
  });
  const tube = new THREE.Mesh(geometry, material);
  tube.userData = { seed, radius };
  return tube;
}

function tubeFromGridPoints(points, color, radius, opacity, seed) {
  return tubeFromVectors(points.map(pointToVector), color, radius, opacity, seed);
}

// Rebuilding a TubeGeometry allocates and uploads new GPU buffers, so skip it
// unless the path or thickness changed. Axons and dendrites only change by
// appending a point or resetting, so point count, last point and radius
// identify the shape.
function updateTube(tube, points, areVectors = false, radius = tube.userData.radius) {
  const last = points.at(-1);
  if (tube.userData.length === points.length && tube.userData.last === last
    && tube.userData.radius === radius) return;
  tube.userData.length = points.length;
  tube.userData.last = last;
  tube.geometry.dispose();
  tube.userData.radius = radius;
  const curve = curveFromVectors(areVectors ? points : points.map(pointToVector), tube.userData.seed);
  tube.geometry = Array.isArray(curve)
    ? new THREE.BufferGeometry()
    : new THREE.TubeGeometry(curve, Math.max(8, points.length * 5), tube.userData.radius, 6, false);
}

function createVisuals() {
  neuronGroup.clear();
  visuals.clear();
  brain.neurons.forEach((neuron) => {
    const style = layerStyles[neuron.layer];
    const soma = new THREE.Mesh(somaGeometry, new THREE.MeshStandardMaterial({
      color: style.soma, emissive: style.emissive, emissiveIntensity: 1.2,
    }));
    soma.position.copy(pointToVector(neuron.soma));
    neuronGroup.add(soma);
    const dendrite = tubeFromGridPoints(neuron.dendrite, style.line, 0.018, 0.42, 100 + neuron.layer);
    neuronGroup.add(dendrite);
    const edges = neuron.edges.map((edge) => {
      const tube = tubeFromVectors(
        edgeDisplayPoints(edge), style.line, edgeRadius(edge), 0.95, edge.curveSeed,
      );
      neuronGroup.add(tube);
      return tube;
    });
    visuals.set(neuron, { dendrite, edges });
  });
}

function createSensoryLinks() {
  sensoryGroup.clear();
  sensoryLinks = digitCells.map(({ cell, segment }, index) => {
    const source = brain.layers[0][segment];
    const tube = tubeFromVectors(
      [cell.position.clone(), pointToVector(source.soma)],
      0xffdb72,
      0.045,
      0.45,
      200 + index,
    );
    sensoryGroup.add(tube);
    return { cell, segment, source, tube };
  });
}

function syncVisuals() {
  brain.neurons.forEach((neuron) => {
    const visual = visuals.get(neuron);
    updateTube(visual.dendrite, neuron.dendrite);
    neuron.edges.forEach((edge, index) => updateTube(visual.edges[index], edge.axon, false, edgeRadius(edge)));
  });
  digitElement.textContent = brain.digit;
  statusElement.textContent = brain.dopamine > 0.1 ? `${brain.status}  DOPAMINE` : brain.status;
  scoreElement.textContent = `Rewards: ${brain.rewards} / ${brain.attempts}`;
}

function updateSensoryActivation(time) {
  const phase = time * 0.008;
  digitCells.forEach(({ cell, segment }) => {
    const lit = (DIGITS[brain.digit] & (1 << segment)) !== 0;
    const pulse = 0.5 + 0.5 * Math.sin(phase + segment * 0.8);
    cell.material.emissiveIntensity = lit ? 1.3 + pulse * 1.2 : 0.03;
    cell.material.color.setHex(lit ? 0xffc64b : 0x473b22);
  });
  sensoryLinks.forEach((link, index) => {
    const lit = (DIGITS[brain.digit] & (1 << link.segment)) !== 0;
    const selected = brain.signal && brain.signal.source === link.source;
    link.tube.visible = lit;
    link.tube.material.opacity = selected ? 0.95 : 0.22 + 0.35 * (0.5 + 0.5 * Math.sin(phase + index));
  });
}

function updateOutputActivation(time) {
  const pulse = brain.outputPulse;
  outputCells.forEach(({ cell, x }) => {
    const active = pulse && x === pulse.x;
    cell.material.emissiveIntensity = active ? 1.4 + pulse.intensity * 4 : 1.4;
  });
  if (!pulse) {
    outputPulseMesh.visible = false;
    return;
  }
  const target = outputCells.find(({ x }) => x === pulse.x).cell;
  outputPulseMesh.visible = true;
  outputPulseMesh.position.copy(target.position);
  outputPulseMesh.position.z += 0.18;
  const scale = 0.7 + pulse.intensity * 1.1 + 0.12 * Math.sin(time * 0.02);
  outputPulseMesh.scale.setScalar(scale);
  outputPulseMesh.material.opacity = 0.25 + pulse.intensity * 0.65;
}

function updateSignalFlow(time) {
  if (!brain.signal || brain.signal.axon.length < 2) {
    signalGroup.visible = false;
    return;
  }
  if (time - lastSignalDraw < 40) {
    return;
  }
  lastSignalDraw = time;
  const curve = curveFromVectors(brain.signal.axon.map(pointToVector), brain.signal.curveSeed);
  if (Array.isArray(curve)) return;
  const stepProgress = Math.min(1, (time - lastStep) / 100);
  const progress = Math.min(1, (brain.signalIndex + stepProgress) / (brain.signal.axon.length - 1));
  const start = Math.max(0, progress - 0.35);
  const points = Array.from({ length: 14 }, (_, index) => (
    curve.getPointAt(start + ((progress - start) * index) / 13)
  ));
  [signalAura, signalCore].forEach((mesh, index) => {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points, false, 'centripetal'),
      24,
      index === 0 ? 0.14 : 0.065,
      6,
      false,
    );
  });
  signalGroup.visible = true;
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
}

let lastStep = 0;
function animate(time) {
  resize();
  if (time - lastStep >= 100) {
    brain.step();
    syncVisuals();
    lastStep = time;
  }
  updateSensoryActivation(time);
  updateOutputActivation(time);
  updateSignalFlow(time);
  controls.update();
  renderer.render(scene, camera);
}

document.querySelector('#reset').addEventListener('click', () => {
  brain = new Brain();
  createVisuals();
  createSensoryLinks();
  syncVisuals();
});

createVisuals();
createSensoryLinks();
syncVisuals();
