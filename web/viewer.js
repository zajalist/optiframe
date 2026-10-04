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
    active.intersection?.disconnect();
    document.removeEventListener('visibilitychange', active.invalidate);
    active.scene.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
  }
  element.replaceChildren();
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
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: lens ? 0xc9deed : part.name.includes('retainer') ? 0x535e6e : 0x252c38,
      metalness: 0.18, roughness: 0.34, side: THREE.DoubleSide,
      transparent: lens, opacity: lens ? 0.22 : 1, depthWrite: !lens,
    }));
    mesh.userData.partName = part.name;
    mesh.userData.kind = part.kind;
    group.add(mesh);
  }

  const box = new THREE.Box3().setFromObject(group);
  const centre = box.getCenter(new THREE.Vector3());
  group.position.copy(centre).multiplyScalar(-1);
  const span = box.getSize(new THREE.Vector3()).length();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a5, 2.6));
  const light = new THREE.DirectionalLight(0xffffff, 3.4);
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
    invalidate();
  };
  const toolbar = document.createElement('div');
  toolbar.className = 'frame-views';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Frame view');
  for (const [label, front] of [['3D', false], ['Front', true]]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.minHeight = '44px';
    button.addEventListener('click', () => setView(front));
    toolbar.appendChild(button);
  }
  let exploded = false;
  const parts = document.createElement('button');
  parts.type = 'button';
  parts.textContent = 'Parts';
  parts.setAttribute('aria-pressed', 'false');
  parts.addEventListener('click', () => {
    exploded = !exploded;
    parts.setAttribute('aria-pressed', String(exploded));
    group.children.forEach(mesh => {
      const name = mesh.userData.partName;
      mesh.position.set(0, 0, 0);
      if (exploded && name.includes('retainer')) mesh.position.z = 18;
      if (exploded && name.includes('snap-pin')) mesh.position.z = 30;
      if (exploded && mesh.userData.kind === 'lens') mesh.position.z = 9;
      if (exploded && name.includes('temple')) mesh.position.x = name.startsWith('left') ? -15 : 15;
    });
    invalidate();
  });
  toolbar.appendChild(parts);
  element.appendChild(toolbar);
  const resize = new ResizeObserver(() => {
    camera.aspect = Math.max(1, element.clientWidth) / Math.max(1, element.clientHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(element.clientWidth, element.clientHeight);
    invalidate();
  });
  resize.observe(element);
  let visible = true;
  const current = { renderer, controls, resize, scene, animation: 0, invalidate };
  active = current;
  function invalidate() {
    if (current.animation || !visible || document.hidden || active !== current) return;
    current.animation = requestAnimationFrame(() => {
      current.animation = 0;
      if (!visible || document.hidden || active !== current) return;
      controls.update();
      renderer.render(scene, camera);
    });
  }
  controls.addEventListener('change', invalidate);
  document.addEventListener('visibilitychange', invalidate);
  current.intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) invalidate();
  }) : null;
  current.intersection?.observe(element);
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    const notice = document.createElement('p');
    notice.className = 'frame-error';
    notice.textContent = '3D paused. Update the preview to retry.';
    element.appendChild(notice);
  });
  setView(false);
  invalidate();
}
