import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.171.0/examples/jsm/controls/OrbitControls.js';

const SIZE = 9;
const DIGITS = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111];
const POSITIONS = [[4, 1], [7, 2], [7, 6], [4, 7], [1, 6], [1, 2], [4, 4]];

class Brain {
  constructor() {
    this.neurons = [];
    this.activePath = [];
    this.signal = null;
    this.signalIndex = 0;
    this.pause = 0;
    this.ticks = 0;
    this.rewards = 0;
    this.attempts = 0;
    this.dopamine = 0;
    this.status = 'Growing connections';
    this.digit = Math.floor(Math.random() * 10);
    this.layers = Array.from({ length: 3 }, (_, layer) => POSITIONS.map(([x, y]) => {
      const neuron = { layer, soma: { x, y, z: 1 + layer * 3 }, dendrite: [], edges: [] };
      neuron.dendrite.push(neuron.soma);
      this.neurons.push(neuron);
      return neuron;
    }));

    this.layers.forEach((layer, layerIndex) => layer.forEach((source, index) => {
      for (let branch = 0; branch < 2; branch += 1) {
        const target = layerIndex < 2 ? this.layers[layerIndex + 1][(index + branch * 3) % 7] : null;
        const destination = target ? target.soma : { x: branch === 0 ? 1 : 7, y: 4, z: SIZE - 1 };
        source.edges.push({ target, destination, axon: [source.soma], weight: 1 });
      }
    }));
  }

  step() {
    this.ticks += 1;
    this.dopamine *= 0.9;
    this.neurons.forEach((neuron) => {
      if (neuron.dendrite.length < 3 && this.ticks % 3 === 0) {
        const point = neuron.dendrite.at(-1);
        neuron.dendrite.push({ x: point.x, y: point.y, z: Math.max(0, point.z - 1) });
      }
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
    return point.x === edge.destination.x && point.y === edge.destination.y && point.z === edge.destination.z;
  }

  grow(edge) {
    const point = edge.axon.at(-1);
    const axes = [];
    if (point.x !== edge.destination.x) axes.push('x');
    if (point.y !== edge.destination.y) axes.push('y');
    if (point.z !== edge.destination.z) axes.push('z');
    const axis = axes[Math.floor(Math.random() * axes.length)];
    edge.axon.push({
      x: point.x + (axis === 'x' ? Math.sign(edge.destination.x - point.x) : 0),
      y: point.y + (axis === 'y' ? Math.sign(edge.destination.y - point.y) : 0),
      z: point.z + (axis === 'z' ? Math.sign(edge.destination.z - point.z) : 0),
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
  new THREE.EdgesGeometry(new THREE.BoxGeometry(8.7, 8.7, 8.7)),
  new THREE.LineBasicMaterial({
    color: 0x88d9ff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false,
  }),
);
frame.renderOrder = 4;
cube.add(frame);
const gridPositions = [];
for (let a = -4; a <= 4; a += 1) {
  for (let b = -4; b <= 4; b += 1) {
    gridPositions.push(-4, a, b, 4, a, b);
    gridPositions.push(a, -4, b, a, 4, b);
    gridPositions.push(a, b, -4, a, b, 4);
  }
}
const gridGeometry = new THREE.BufferGeometry();
gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));
const grid = new THREE.LineSegments(
  gridGeometry,
  new THREE.LineBasicMaterial({
    color: 0x58bce8, transparent: true, opacity: 0.52, depthTest: false, depthWrite: false,
  }),
);
grid.renderOrder = 3;
cube.add(grid);
const shell = new THREE.Mesh(
  new THREE.BoxGeometry(8.5, 8.5, 8.5),
  new THREE.MeshPhysicalMaterial({
    color: 0x245878, transparent: true, opacity: 0.025, roughness: 0.18, transmission: 0.2, depthWrite: false,
  }),
);
cube.add(shell);

const pointToVector = ({ x, y, z }) => new THREE.Vector3(x - 4, 4 - y, z - 4);
const segments = [];
const segmentGeometry = new THREE.BoxGeometry(3.2, 0.35, 0.16);
const verticalSegmentGeometry = new THREE.BoxGeometry(0.35, 2.25, 0.16);
const segmentMaterial = new THREE.MeshStandardMaterial({ color: 0xffc64b, emissive: 0xa96400, emissiveIntensity: 1.6 });
[
  [0, 3, 4.46, false], [1.75, 1.5, 4.46, true], [1.75, -1.5, 4.46, true],
  [0, -3, 4.46, false], [-1.75, -1.5, 4.46, true], [-1.75, 1.5, 4.46, true],
  [0, 0, 4.46, false],
].forEach(([x, y, z, vertical], index) => {
  const mesh = new THREE.Mesh(vertical ? verticalSegmentGeometry : segmentGeometry, segmentMaterial.clone());
  mesh.position.set(x, y, z);
  cube.add(mesh);
  segments[index] = mesh;
});

const outputCells = [];
const outputGeometry = new THREE.BoxGeometry(0.78, 0.78, 0.16);
for (let x = 0; x < SIZE; x += 1) {
  const ratio = x / (SIZE - 1);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.18 + ratio * 0.8, 0.4 - ratio * 0.25, 1 - ratio * 0.8),
    emissive: new THREE.Color().setRGB(0.04 + ratio * 0.35, 0.05, 0.28 - ratio * 0.2),
    emissiveIntensity: 1.4,
  });
  const cell = new THREE.Mesh(outputGeometry, material);
  cell.position.set(x - 4, 0, -4.46);
  cube.add(cell);
  outputCells.push(cell);
}

const neuronGroup = new THREE.Group();
cube.add(neuronGroup);
const somaGeometry = new THREE.SphereGeometry(0.16, 16, 12);
const layerStyles = [
  { soma: 0x63e9dc, emissive: 0x117d85, line: 0x4bc9dc },
  { soma: 0xaa8cff, emissive: 0x51349e, line: 0x9578e8 },
  { soma: 0xff83bf, emissive: 0x9c245d, line: 0xea619f },
];
const signalMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.27, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xfff267, emissive: 0xffcc24, emissiveIntensity: 2 }),
);
signalMesh.visible = false;
cube.add(signalMesh);

let brain = new Brain();
const visuals = new Map();

function lineFrom(points, color, opacity = 0.8) {
  const material = new THREE.LineBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false,
  });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(pointToVector)), material);
  line.renderOrder = 5;
  return line;
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
    const dendrite = lineFrom(neuron.dendrite, style.line, 0.72);
    neuronGroup.add(dendrite);
    const edges = neuron.edges.map((edge) => {
      const line = lineFrom(edge.axon, style.line);
      neuronGroup.add(line);
      return line;
    });
    visuals.set(neuron, { dendrite, edges });
  });
}

function updateLine(line, points) {
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(points.map(pointToVector));
}

function syncVisuals() {
  segments.forEach((segment, index) => {
    const lit = (DIGITS[brain.digit] & (1 << index)) !== 0;
    segment.material.emissiveIntensity = lit ? 1.6 : 0.03;
    segment.material.color.setHex(lit ? 0xffc64b : 0x473b22);
  });
  brain.neurons.forEach((neuron) => {
    const visual = visuals.get(neuron);
    updateLine(visual.dendrite, neuron.dendrite);
    neuron.edges.forEach((edge, index) => updateLine(visual.edges[index], edge.axon));
  });
  const signal = brain.signalPoint();
  signalMesh.visible = Boolean(signal);
  if (signal) signalMesh.position.copy(pointToVector(signal));
  digitElement.textContent = brain.digit;
  statusElement.textContent = brain.dopamine > 0.1 ? `${brain.status}  DOPAMINE` : brain.status;
  scoreElement.textContent = `Rewards: ${brain.rewards} / ${brain.attempts}`;
}

function resize() {
  const { clientWidth: width, clientHeight: height } = canvas;
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
  controls.update();
  renderer.render(scene, camera);
}

document.querySelector('#reset').addEventListener('click', () => {
  brain = new Brain();
  createVisuals();
  syncVisuals();
});

createVisuals();
syncVisuals();
