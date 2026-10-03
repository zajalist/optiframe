import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let active = null;

export function showSTL(buffer, element) {
  const assembly = JSON.parse(new TextDecoder().decode(buffer));
  if (assembly.schemaVersion !== 1 || !assembly.meshes?.length) throw new Error('Invalid assembly preview');
  if (active) {
    cancelAnimationFrame(active.animation);
    active.controls.dispose();
    active.renderer.dispose();
    active.resize.disconnect();
    active.scene.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    element.replaceChildren();
  }
  element.classList.add('active');
  element.style.position = 'relative';
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(element.clientWidth, element.clientHeight);
  element.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.setAttribute('aria-label', 'Frame assembly. Drag to rotate; pinch to zoom.');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, element.clientWidth / element.clientHeight, 0.1, 1000);
  const group = new THREE.Group();
  scene.add(group);
  for (const part of assembly.meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.vertices.flat(), 3));
    geometry.setIndex(part.faces.flat());
    geometry.computeVertexNormals();
    const lens = part.kind === 'lens';
    group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: lens ? 0x79d7ef : part.name.includes('retainer') ? 0xf7ad70 : 0xc9eb64,
      metalness: 0.08, roughness: 0.55, side: THREE.DoubleSide,
      transparent: lens, opacity: lens ? 0.3 : 1, depthWrite: !lens,
    })));
  }
  for (const [x, y, z] of assembly.opticalCentres) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x - 2, y, z - 0.05), new THREE.Vector3(x + 2, y, z - 0.05),
      new THREE.Vector3(x, y - 2, z - 0.05), new THREE.Vector3(x, y + 2, z - 0.05),
    ]);
    group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xff7bb5 })));
  }
  const box = new THREE.Box3().setFromObject(group);
  const centre = box.getCenter(new THREE.Vector3());
  group.position.copy(centre).multiplyScalar(-1);
  const span = box.getSize(new THREE.Vector3()).length();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x24404a, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2.5);
  light.position.set(-50, 80, -90);
  scene.add(light);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = span * 0.15;
  controls.maxDistance = span * 8;
  controls.target.set(0, 0, 0);
  controls.update();
  const setView = front => {
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = span / 2 / Math.sin(Math.min(vertical, horizontal)) * 1.12;
    controls.target.set(0, 0, 0);
    camera.position.copy(new THREE.Vector3(front ? 0 : 0.65, front ? 0 : 0.4, -1).normalize().multiplyScalar(distance));
    controls.update();
  };
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'position:absolute;left:10px;right:10px;top:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center';
  const legend = document.createElement('span');
  legend.textContent = 'Orange: retainers · Blue: flat lens placeholders · Pink: optical centres';
  legend.style.cssText = 'font-size:12px;color:#e7ede8;background:#0a1a20d9;padding:6px;border-radius:6px';
  toolbar.appendChild(legend);
  for (const [label, front] of [['Assembly', false], ['Front', true]]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.minHeight = '44px';
    button.addEventListener('click', () => setView(front));
    toolbar.appendChild(button);
  }
  element.appendChild(toolbar);
  setView(false);
  const resize = new ResizeObserver(() => {
    camera.aspect = Math.max(1, element.clientWidth) / Math.max(1, element.clientHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(element.clientWidth, element.clientHeight);
  });
  resize.observe(element);
  const current = { renderer, controls, resize, scene, animation: 0 };
  active = current;
  const animate = () => {
    current.animation = requestAnimationFrame(animate);
    if (!document.hidden) { controls.update(); renderer.render(scene, camera); }
  };
  animate();
}
