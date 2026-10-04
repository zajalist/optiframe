import { facePose, opticalAnchors, landmarkToView } from './face-tryon-geometry.js?v=36';

const VISION_VERSION = '0.10.32';
const VISION_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
let closeActive = null;

// Visual fitting only. Face frames remain on the device; no camera upload endpoint.
export async function openFaceTryOn({ assembly, leftPd, rightPd }) {
  closeActive?.();
  const focusBefore = document.activeElement;
  if (!document.querySelector('link[data-face-tryon]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/face-tryon.css?v=1'; link.dataset.faceTryon = '';
    document.head.appendChild(link);
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'face-tryon';
  dialog.setAttribute('aria-labelledby', 'face-tryon-title');
  dialog.innerHTML = `<div class="face-tryon-stage"><video autoplay muted playsinline aria-label="Front camera"></video></div>
    <header class="face-tryon-header"><h2 id="face-tryon-title">Visual try-on</h2><button class="face-tryon-close" type="button" aria-label="Close try-on"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
    <footer class="face-tryon-footer"><p class="face-tryon-status" role="status">Opening camera…</p><p class="face-tryon-disclaimer">Appearance only · Camera stays on this device</p></footer>`;
  document.body.appendChild(dialog);
  dialog.showModal();
  const video = dialog.querySelector('video'), stage = dialog.querySelector('.face-tryon-stage');
  const status = dialog.querySelector('.face-tryon-status');
  let stopped = false, stream = null, model = null, renderer = null, scene = null, resize = null, animation = 0;
  const say = text => { if (!stopped && status.textContent !== text) status.textContent = text; };
  const release = () => {
    cancelAnimationFrame(animation); animation = 0;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    video.pause(); video.srcObject = null;
    model?.close(); model = null;
    resize?.disconnect(); resize = null;
    scene?.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); }); scene = null;
    renderer?.dispose(); renderer?.forceContextLoss(); renderer = null;
  };
  const close = () => {
    if (stopped) return;
    stopped = true;
    release();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', close);
    dialog.close(); dialog.remove();
    if (closeActive === close) closeActive = null;
    if (focusBefore?.isConnected) focusBefore.focus({ preventScroll: true });
  };
  const visibility = () => { if (document.hidden) close(); };
  closeActive = close;
  dialog.querySelector('button').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', close);

  // Start asynchronously so callers receive cleanup even while permission/model loading is pending.
  void (async () => {
    try {
      const anchors = opticalAnchors(assembly, leftPd, rightPd);
      if (!assembly.meshes?.length) throw new Error('Build a frame preview first.');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable. Open this page in Safari or Chrome.');
      const opened = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 },
      } });
      if (stopped) { opened.getTracks().forEach(track => track.stop()); return; }
      stream = opened;
      video.srcObject = stream;
      await video.play();
      if (stopped) return;
      say('Loading try-on…');
      const [THREE, vision] = await Promise.all([import('three'), import(`${VISION_ROOT}/vision_bundle.mjs`)]);
      if (stopped) return;
      const files = await vision.FilesetResolver.forVisionTasks(`${VISION_ROOT}/wasm`);
      if (stopped) return;
      const options = { baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: 'VIDEO',
        numFaces: 1, minFaceDetectionConfidence: .65, minFacePresenceConfidence: .65, minTrackingConfidence: .65 };
      let loaded;
      try { loaded = await vision.FaceLandmarker.createFromOptions(files, options); }
      catch (error) {
        if (stopped) return;
        options.baseOptions.delegate = 'CPU';
        loaded = await vision.FaceLandmarker.createFromOptions(files, options);
      }
      if (stopped) { loaded.close(); return; }
      model = loaded;
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
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
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.vertices.flat(), 3));
        geometry.setIndex(part.faces.flat()); geometry.computeVertexNormals();
        const lens = part.kind === 'lens';
        cad.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
          color: lens ? 0xd4e1e9 : 0x26272a, roughness: .32, metalness: .12,
          transparent: lens, opacity: lens ? .08 : 1, depthWrite: !lens, side: THREE.DoubleSide,
        })));
      }
      // Centre on optical references, preserving asymmetric frames and fitting offsets.
      const anchor = new THREE.Vector3(...anchors.centre);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x5d6170, 3));
      const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(-200, 400, 700); scene.add(light);
      const resizeView = () => {
        const width = stage.clientWidth, height = stage.clientHeight;
        renderer.setSize(width, height);
        camera.left = -width / 2; camera.right = width / 2; camera.top = height / 2; camera.bottom = -height / 2;
        camera.updateProjectionMatrix();
      };
      resize = new ResizeObserver(resizeView); resize.observe(stage); resizeView();
      renderer.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault(); release(); say('Try-on paused. Close and try again.');
      });
      const matrix = basis => new THREE.Matrix4().makeBasis(...basis.map(v => new THREE.Vector3(...v)));
      let lastTime = -1, lastDetection = -Infinity, hasPose = false;
      const targetQuaternion = new THREE.Quaternion(), targetPosition = new THREE.Vector3();
      const loop = time => {
        if (stopped || !renderer || !model) return;
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
              targetPosition.add(new THREE.Vector3(...pose.targetBasis[2]).multiplyScalar(10 * pose.scale));
              if (!hasPose) { frame.quaternion.copy(targetQuaternion); frame.position.copy(targetPosition); frame.scale.setScalar(pose.scale); }
              else { frame.quaternion.slerp(targetQuaternion, .6); frame.position.lerp(targetPosition, .6); frame.scale.lerp(new THREE.Vector3().setScalar(pose.scale), .6); }
              hasPose = true; say('');
            } else { hasPose = false; say('Look toward the camera'); }
          } catch {
            release(); say('Try-on paused. Close and try again.'); return;
          }
        }
        if (Number.isFinite(lastDetection) && time - lastDetection > 500) {
          frame.visible = false; skin.visible = false; hasPose = false;
          say('Camera paused');
        }
        renderer.render(scene, camera);
        animation = requestAnimationFrame(loop);
      };
      say('Look toward the camera'); animation = requestAnimationFrame(loop);
    } catch (error) {
      if (stopped) return;
      release();
      say(error.name === 'NotAllowedError' ? 'Allow camera access in browser settings, then try again.'
        : error.name === 'NotFoundError' ? 'No front camera found.'
        : error.name === 'NotReadableError' ? 'Camera is busy. Close other camera apps and try again.'
        : /Frame|Build|Camera unavailable/.test(error.message || '') ? error.message : 'Try-on could not load. Check your connection and try again.');
    }
  })();
  return close;
}
