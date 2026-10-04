import { facePose, opticalAnchors, landmarkToView, frameRenderLayer } from './face-tryon-geometry.js?v=37';
import { createFrameGeometry, createFrameMaterial, configureFrameRenderer } from './frame-appearance.js?v=39';
import { faceScanDeadline } from './face-scan.js?v=41';

const VISION_VERSION = '0.10.32';
const VISION_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
let closeActive = null;
const dispose = action => { try { action(); } catch { /* Cleanup must continue after a lost device/context. */ } };
const stopStream = value => dispose(() => { for (const track of value?.getTracks() || []) dispose(() => track.stop()); });
const closeModel = value => dispose(() => value?.close());

// Visual fitting only. Face frames remain on the device; no camera upload endpoint.
export async function openFaceTryOn({ assembly, leftPd, rightPd }, runtime = {}) {
  closeActive?.();
  const focusBefore = document.activeElement;
  if (!document.querySelector('link[data-face-tryon]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/face-tryon.css?v=41'; link.dataset.faceTryon = '';
    document.head.appendChild(link);
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'face-tryon';
  dialog.setAttribute('aria-labelledby', 'face-tryon-title');
  dialog.innerHTML = `<div class="face-tryon-stage"><video autoplay muted playsinline aria-label="Front camera"></video></div>
    <header class="face-tryon-header"><h2 id="face-tryon-title">Visual try-on</h2><button class="face-tryon-close" type="button" aria-label="Close try-on"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
    <footer class="face-tryon-footer"><p class="face-tryon-status" role="status">Opening camera…</p><button class="face-tryon-retry" type="button" hidden>Retry</button><p class="face-tryon-disclaimer">Appearance only · Camera stays on this device</p></footer>`;
  document.body.appendChild(dialog);
  dialog.showModal();
  const video = dialog.querySelector('video'), stage = dialog.querySelector('.face-tryon-stage');
  const status = dialog.querySelector('.face-tryon-status');
  const retry = dialog.querySelector('.face-tryon-retry');
  let stopped = false, stream = null, model = null, renderer = null, scene = null, resize = null, animation = 0;
  let generation = 0, controller = null, starting = false;
  const timeouts = { camera: 20000, playback: 8000, dependencies: 15000, fileset: 10000, model: 20000, ...runtime.timeouts };
  const say = text => { if (!stopped && status.textContent !== text) status.textContent = text; };
  const release = () => {
    generation++; controller?.abort(); controller = null; starting = false;
    cancelAnimationFrame(animation); animation = 0;
    const oldStream=stream, oldModel=model, oldResize=resize, oldScene=scene, oldRenderer=renderer;
    stream=null;model=null;resize=null;scene=null;renderer=null;
    dispose(() => stopStream(oldStream));
    dispose(() => video.pause());dispose(() => {video.srcObject=null;});
    closeModel(oldModel);dispose(() => oldResize?.disconnect());
    dispose(() => oldScene?.traverse(object => {dispose(() => object.geometry?.dispose());for(const material of Array.isArray(object.material)?object.material:[object.material])dispose(() => material?.dispose());}));
    dispose(() => oldRenderer?.domElement.remove());dispose(() => oldRenderer?.dispose());dispose(() => oldRenderer?.forceContextLoss());
  };
  const close = () => {
    if (stopped) return;
    stopped = true;
    release();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', close);
    dispose(() => dialog.close());dispose(() => dialog.remove());
    if (closeActive === close) closeActive = null;
    if (focusBefore?.isConnected) dispose(() => focusBefore.focus({ preventScroll: true }));
  };
  const visibility = () => { if (document.hidden) close(); };
  closeActive = close;
  dialog.querySelector('button').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', close);
  const fail = message => { release(); say(message); if (!stopped) { retry.hidden = false; retry.disabled = false; } };

  // Start asynchronously so callers receive cleanup even while permission/model loading is pending.
  const start = async () => {
    if (stopped || starting) return;
    release(); starting = true; retry.hidden = true; retry.disabled = true;
    controller = new AbortController(); const signal = controller.signal, request = generation;
    const current = () => !stopped && request === generation && !signal.aborted;
    const bounded = (promise, step, message, dispose) => faceScanDeadline(promise, timeouts[step], signal, message, dispose);
    say('Opening camera…');
    try {
      const anchors = opticalAnchors(assembly, leftPd, rightPd);
      if (!assembly.meshes?.length) throw new Error('Build a frame preview first.');
      if (!runtime.getUserMedia && !navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable. Open this page in Safari or Chrome.');
      const cameraRequest = runtime.getUserMedia || (constraints => navigator.mediaDevices.getUserMedia(constraints));
      const opened = await bounded(cameraRequest({ audio: false, video: {
        facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 },
      } }), 'camera', 'Camera permission timed out. Tap Retry.', stopStream);
      if (!current()) { stopStream(opened); return; }
      stream = opened;
      video.srcObject = stream;
      await bounded(video.play(), 'playback', 'Camera preview timed out. Tap Retry.');
      if (!current()) return;
      say('Loading face tracking…');
      const [THREE, vision] = await bounded((runtime.loadDependencies || (() => Promise.all([import('three'), import(`${VISION_ROOT}/vision_bundle.mjs`)])))(), 'dependencies', 'Tracking download timed out. Check your connection and retry.');
      if (!current()) return;
      const files = await bounded(vision.FilesetResolver.forVisionTasks(`${VISION_ROOT}/wasm`), 'fileset', 'Tracking setup timed out. Tap Retry.');
      if (!current()) return;
      say('Starting face tracking…');
      const options = { baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: 'VIDEO',
        numFaces: 1, minFaceDetectionConfidence: .65, minFacePresenceConfidence: .65, minTrackingConfidence: .65 };
      let loaded;
      try { loaded = await bounded(vision.FaceLandmarker.createFromOptions(files, options), 'model', 'GPU tracking timed out.', closeModel); }
      catch (error) {
        if (!current()) return;
        say('Starting compatible tracking…');
        loaded = await bounded(vision.FaceLandmarker.createFromOptions(files, {...options, baseOptions:{...options.baseOptions,delegate:'CPU'}}), 'model', 'Tracking startup timed out. Tap Retry.', closeModel);
      }
      if (!current()) { closeModel(loaded); return; }
      model = loaded;
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      configureFrameRenderer(THREE, renderer);
      renderer.autoClear = false;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      stage.appendChild(renderer.domElement);
      scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10000);
      camera.position.z = 3000;
      const frame = new THREE.Group(); frame.visible = false; scene.add(frame);
      // Depth-only tracked skin lets temples pass behind cheeks during small turns.
      const faceGeometry = new THREE.BufferGeometry();
      const facePositions = new Float32Array(478 * 3);
      faceGeometry.setAttribute('position', new THREE.BufferAttribute(facePositions, 3));
      const connections = vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION || [];
      const triangles = [];
      for (let i = 0; i + 2 < connections.length; i += 3) {
        const indices = [...new Set(connections.slice(i, i + 3).flatMap(edge => [edge.start, edge.end]))];
        if (indices.length === 3) triangles.push(...indices);
      }
      faceGeometry.setIndex(triangles);
      const skin = new THREE.Mesh(faceGeometry, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
      skin.frustumCulled = false; skin.visible = false; skin.renderOrder = -1; scene.add(skin);
      const cad = new THREE.Group(); cad.scale.x = -1; frame.add(cad);
      for (const part of assembly.meshes) {
        const mesh = new THREE.Mesh(createFrameGeometry(THREE,part), createFrameMaterial(THREE,part,{tryOn:true}));
        mesh.layers.set(frameRenderLayer(part));cad.add(mesh);
      }
      // Centre on optical references, preserving asymmetric frames and fitting offsets.
      const anchor = new THREE.Vector3(...anchors.centre);
      const ambient=new THREE.HemisphereLight(0xffffff, 0xa8abb0, 1.8);ambient.layers.enableAll();scene.add(ambient);
      const light = new THREE.DirectionalLight(0xffffff, 2.4);light.layers.enableAll(); light.position.set(-200, 400, 700); scene.add(light);
      const resizeView = () => {
        if (!current() || !renderer) return;
        try {
          const width = Math.max(1,stage.clientWidth), height = Math.max(1,stage.clientHeight);
          renderer.setSize(width, height);
          camera.left = -width / 2; camera.right = width / 2; camera.top = height / 2; camera.bottom = -height / 2;
          camera.updateProjectionMatrix();
        } catch { fail('3D view paused. Tap Retry.'); }
      };
      resize = new ResizeObserver(resizeView); resize.observe(stage); resizeView();
      if (!current()) return;
      renderer.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault(); if(current()) fail('3D view paused. Tap Retry.');
      });
      const matrix = basis => new THREE.Matrix4().makeBasis(...basis.map(v => new THREE.Vector3(...v)));
      let lastTime = -1, lastDetection = -Infinity, hasPose = false;
      const targetQuaternion = new THREE.Quaternion(), targetPosition = new THREE.Vector3();
      const loop = time => {
        if (!current() || !renderer || !model) return;
        // Bound synchronous inference to 12.5 fps; camera video continues at native speed.
        if (video.readyState >= 2 && video.currentTime !== lastTime && time - lastDetection >= 80) {
          lastTime = video.currentTime; lastDetection = time;
          try {
            const result = model.detectForVideo(video, time);
            const landmarks = result.faceLandmarks?.[0];
            const dimensions = [video.videoWidth, video.videoHeight, stage.clientWidth, stage.clientHeight];
            const pose = facePose(landmarks, anchors, dimensions);
            frame.visible = !!pose;
            skin.visible = !!pose && triangles.length > 0;
            if (pose) {
              landmarks.forEach((point, index) => facePositions.set(landmarkToView(point, ...dimensions), index * 3));
              faceGeometry.attributes.position.needsUpdate = true;
              targetQuaternion.setFromRotationMatrix(matrix(pose.targetBasis).multiply(matrix(pose.sourceBasis).transpose()));
              targetPosition.set(...pose.centre).sub(anchor.clone().applyQuaternion(targetQuaternion).multiplyScalar(pose.scale));
              // Appearance offset only: leave room between rendered lenses and the eyes.
              // This is never saved as a wearer measurement or used for an STL.
              targetPosition.add(new THREE.Vector3(...pose.targetBasis[2]).multiplyScalar(18 * pose.scale));
              if (!hasPose) { frame.quaternion.copy(targetQuaternion); frame.position.copy(targetPosition); frame.scale.setScalar(pose.scale); }
              else { frame.quaternion.slerp(targetQuaternion, .6); frame.position.lerp(targetPosition, .6); frame.scale.lerp(new THREE.Vector3().setScalar(pose.scale), .6); }
              hasPose = true; say('');
            } else { hasPose = false; say('Look toward the camera'); }
          } catch {
            fail('Tracking paused. Tap Retry.'); return;
          }
        }
        if (Number.isFinite(lastDetection) && time - lastDetection > 500) {
          frame.visible = false; skin.visible = false; hasPose = false;
          say('Camera paused');
        }
        try {
          renderer.clear();
          camera.layers.set(0);renderer.render(scene, camera);
          renderer.clearDepth();
          camera.layers.set(1);renderer.render(scene, camera);
        } catch { fail('3D view paused. Tap Retry.'); return; }
        animation = requestAnimationFrame(loop);
      };
      starting = false; say('Look toward the camera'); animation = requestAnimationFrame(loop);
    } catch (error) {
      if (!current()) return;
      fail(error.name === 'NotAllowedError' ? 'Allow camera access in browser settings, then try again.'
        : error.name === 'NotFoundError' ? 'No front camera found.'
        : error.name === 'NotReadableError' ? 'Camera is busy. Close other camera apps and try again.'
        : /Frame|Build|Camera unavailable|timed out/.test(error.message || '') ? error.message : 'Try-on could not load. Check your connection and try again.');
    }
  };
  retry.addEventListener('click', () => void start());
  void start();
  return close;
}
