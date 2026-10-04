import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFrameGeometry, createFrameMaterial, configureFrameRenderer } from './frame-appearance.js?v=42';

let active = null;
let selectedView = ['side','logo'].includes(new URLSearchParams(location.search).get('view')) ? new URLSearchParams(location.search).get('view') : '3d';

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
    active.scene.traverse(object => { object.geometry?.dispose(); for(const material of Array.isArray(object.material)?object.material:[object.material])material?.dispose(); });
  }
  element.replaceChildren();
  element.classList.add('active');
  element.style.position = 'relative';
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  configureFrameRenderer(THREE, renderer);
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
    const mesh = new THREE.Mesh(createFrameGeometry(THREE, part), createFrameMaterial(THREE, part));
    mesh.userData.partName = part.name;
    mesh.userData.kind = part.kind;
    mesh.userData.branding = part.branding;
    group.add(mesh);
  }

  const box = new THREE.Box3().setFromObject(group);
  const centre = box.getCenter(new THREE.Vector3());
  group.position.copy(centre).multiplyScalar(-1);
  const span = box.getSize(new THREE.Vector3()).length();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xa8abb0, 1.8));
  const light = new THREE.DirectionalLight(0xffffff, 2.4);
  light.position.set(-50, 80, -90);
  scene.add(light);
  // Raking fill reveals the real side bevels and shallow wordmark when rotated.
  const sideLight = new THREE.DirectionalLight(0xe8edf5, 2.0);
  sideLight.position.set(200, 45, 30);
  scene.add(sideLight);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = span * 0.15;
  controls.maxDistance = span * 8;
  controls.target.set(0, 0, 0);
  controls.update();
  const viewButtons = new Map();
  const brandedTemple=group.children.find(mesh=>mesh.userData.branding?.bounds);
  const setView = view => {
    if(view==='logo'&&!brandedTemple)view='side';
    selectedView = view;
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const logoDirection=brandedTemple?.userData.partName==='left-temple'?[-1,.12,.12]:[1,.12,-.12];
    const direction = new THREE.Vector3(...(view==='front' ? [0,0,-1] : view==='logo' ? logoDirection : view==='side' ? [1,.12,-.12] : [.85,.32,-1])).normalize();
    const focusBox=view==='logo' ? new THREE.Box3(new THREE.Vector3(...brandedTemple.userData.branding.bounds[0]),new THREE.Vector3(...brandedTemple.userData.branding.bounds[1])).expandByScalar(4) : box;
    const focusCentre=focusBox.getCenter(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction,right).normalize();
    let distance = 0;
    for(const x of [focusBox.min.x,focusBox.max.x])for(const y of [focusBox.min.y,focusBox.max.y])for(const z of [focusBox.min.z,focusBox.max.z]) {
      const corner = new THREE.Vector3(x,y,z).sub(focusCentre);
      distance = Math.max(distance, Math.abs(corner.dot(right))/Math.tan(horizontal)+corner.dot(direction), Math.abs(corner.dot(up))/Math.tan(vertical)+corner.dot(direction));
    }
    controls.target.copy(focusCentre.sub(centre));
    if(view==='logo')controls.target.add(brandedTemple.position);
    controls.minDistance=view==='logo'?8:span*.15;
    camera.position.copy(controls.target).add(direction.multiplyScalar(distance*1.14));
    for(const [name,button] of viewButtons)button.setAttribute('aria-pressed',String(name===view));
    controls.update();
    invalidate();
  };
  const toolbar = document.createElement('div');
  toolbar.className = 'frame-views';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Frame view');
  for (const [label, view] of [['3D', '3d'], ['Front', 'front'], ['Side', 'side'], ...(brandedTemple?[['Logo','logo']]:[])]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.minHeight = '44px';
    button.setAttribute('aria-pressed',String(selectedView===view));
    button.addEventListener('click', () => setView(view));
    viewButtons.set(view,button);
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
    setView(selectedView);
  });
  toolbar.appendChild(parts);
  element.appendChild(toolbar);
  const resize = new ResizeObserver(() => {
    camera.aspect = Math.max(1, element.clientWidth) / Math.max(1, element.clientHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(element.clientWidth, element.clientHeight);
    setView(selectedView);
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
  setView(selectedView);
  invalidate();
}
