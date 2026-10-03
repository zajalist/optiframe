import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let active = null;

export function showSTL(buffer, element) {
  if (active) {
    cancelAnimationFrame(active.animation);
    active.controls.dispose();
    active.renderer.dispose();
    active.resize.disconnect();
    element.replaceChildren();
  }
  element.classList.add('active');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(element.clientWidth, element.clientHeight);
  element.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, element.clientWidth / element.clientHeight, 0.1, 1000);
  const geometry = new STLLoader().parse(buffer);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const centre = box.getCenter(new THREE.Vector3());
  geometry.translate(-centre.x, -centre.y, -centre.z);
  const span = box.getSize(new THREE.Vector3()).length();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xc9eb64, metalness: 0.08, roughness: 0.55, side: THREE.DoubleSide,
  }));
  scene.add(mesh);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x24404a, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(50, 80, 90);
  scene.add(light);
  camera.position.set(0, 0, span * 1.15);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
  controls.update();
  const resize = new ResizeObserver(() => {
    camera.aspect = element.clientWidth / element.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(element.clientWidth, element.clientHeight);
  });
  resize.observe(element);
  const current = { renderer, controls, resize, animation: 0 };
  active = current;
  const animate = () => {
    current.animation = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();
}
