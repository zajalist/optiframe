const panels = [...document.querySelectorAll('.lens-panel')];
const accessKey = new URLSearchParams(location.hash.slice(1)).get('access');
if (accessKey) document.querySelectorAll('a[href="/android-ar.html"]').forEach(link => { link.hash = location.hash; });
const apiFetch = (url, options = {}) => fetch(url, {
  ...options,
  headers: { ...options.headers, ...(accessKey ? { 'X-OptiFrame-Key': accessKey } : {}) },
});
const responseData = response => response.headers.get('content-type')?.includes('json')
  ? response.json() : response.text().then(detail => ({ detail }));

import {distance,polygonArea,measure,sheetHomography,project,benchmark,pixelResolution,contourRepeatability,normalizeLensOrientation,outlineProofSVG} from './calibration.js';
import {createLiveSegmentSession} from './live-segment.js';
import {createPreviewScheduler} from './preview-scheduler.js';

let activeLivePanel = null;
let automaticPreview = null;
let frameStyle = 'classic', frameAssembly = null;
try { const saved = sessionStorage.getItem('optiframe-frame-style'); if (['classic','bold','brow'].includes(saved)) frameStyle = saved; } catch {}
function getFrameStyle() { return frameStyle; }
function getFrameAssembly() { return frameAssembly; }
function setFrameStyle(value) {
  if (!['classic','bold','brow'].includes(value)) throw new Error('Unknown frame style');
  if (frameStyle === value) return;
  frameStyle = value;
  try { sessionStorage.setItem('optiframe-frame-style', value); } catch {}
  invalidateFrameResult();
}

class LensPanel {
  constructor(element) {
    this.el = element;
    this.side = element.dataset.side;
    this.canvas = element.querySelector('.canvas-wrap canvas');
    this.ctx = this.canvas.getContext('2d');
    this.status = element.querySelector('.panel-status');
    this.size = element.querySelector(`#${this.side}-size`);
    this.placeholder = element.querySelector('.canvas-placeholder');
    this.select = element.querySelector('.proposal-select');
    this.reference = element.querySelector('.reference-mm');
    this.scaleStatus = element.querySelector('.scale-status');
    this.centreStatus = element.querySelector('.centre-status');
    this.markerStatus = element.querySelector('.marker-status');
    this.topStatus = element.querySelector('.top-status');
    this.videoFrames = element.querySelector('.video-frames');
    this.videoRequest = 0;
    this.photoVersion = 0;
    this.photoLoading = false;
    this.proposalRequest = 0;
    this.photo = null;
    this.empty = null;
    this.bitmap = null;
    this.points = [];
    this.scalePoints = [];
    this.markerPoints = [];
    this.homography = null;
    this.opticalCentre = null;
    this.topMark = null;
    this.mmPerPixel = null;
    this.box = null;
    this.mode = null;
    this.dragStart = null;
    this.dragVertex = null;
    this.proposals = [];
    this.history = [];
    this.live = null;
    this.bind();
  }

  bind() {
    const liveButton = this.el.querySelector('.live-start');
    const liveStage = this.el.querySelector('.live-stage');
    liveButton.addEventListener('click', async () => {
      if (this.live?.active) { this.stopLive(); return; }
      if (activeLivePanel && activeLivePanel !== this) activeLivePanel.stopLive();
      if (!this.live) this.live = createLiveSegmentSession({
        video: liveStage.querySelector('video'), overlay: liveStage.querySelector('canvas'),
        status: this.el.querySelector('.live-status'),
        captureButton: this.el.querySelector('.live-capture'), apiFetch, side: this.side,
        onCapture: async ({file,contour,width,height,latencyMs}) => {
          const loaded = await this.loadPhoto(file);
          if (!loaded) throw new Error('Captured photo could not be opened. Try again.');
          this.points = contour.map(([x,y]) => [x * this.canvas.width / width, y * this.canvas.height / height]);
          this.render();
          liveStage.hidden = true;
          liveButton.textContent = 'Start camera';
          if (activeLivePanel === this) activeLivePanel = null;
          this.message(`Live outline captured (${latencyMs} ms proposal). Review the edge, then tap the four sheet markers, optical centre and top.`);
        },
      });
      liveStage.hidden = false;
      liveButton.disabled = true;
      try {
        await this.live.start();
        activeLivePanel = this;
        liveButton.textContent = 'Stop camera';
      } catch (error) {
        liveStage.hidden = true;
        this.el.querySelector('.live-status').textContent = error.message;
      } finally { liveButton.disabled = false; }
    });
    this.el.querySelectorAll('.benchmark-input').forEach(input=>input.addEventListener('input',()=>{
      this.invalidateEvidence();
      this.updateMeasurement();
    }));
    this.el.querySelector('.save-repeat').addEventListener('click',()=>{
      if(!this.homography||!this.measurement||!this.opticalCentre||!this.topMark){this.message('Rectify a contour and mark its optical centre and top first.');return;}
      let outline;
      try { outline = this.millimetreOutline(); }
      catch (error) { this.message(error.message); return; }
      if (!outline) { this.message('Review a contour with at least 12 points first.'); return; }
      this.el.querySelector('.repeat-width').value=this.measurement.width.toFixed(3);
      this.el.querySelector('.repeat-height').value=this.measurement.height.toFixed(3);
      this.repeatOutline = outline;
      this.repeatPhotoVersion = this.loadedPhotoVersion;
      this.el.querySelector('.evidence-confirmed').checked=false;
      invalidateFrameResult();
      this.message('Dimensions and top-aligned outline saved. Load and rectify a new independent photo, then mark its optical centre and top to compare edge repeatability.');
      this.updateMeasurement();
    });
    this.el.querySelector('.download-outline').addEventListener('click',()=>{
      try {
        if (!this.homography || !this.opticalCentre || !this.topMark) throw new Error('Four sheet markers, optical centre and top mark are needed for a 1:1 outline.');
        const outline = this.millimetreOutline();
        if (!outline) throw new Error('Review a contour with at least 12 points first.');
        const svg = outlineProofSVG(outline, this.side);
        const url = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml'}));
        const link = document.createElement('a');
        link.href = url;
        link.download = `optiframe-${this.side}-1-to-1-outline.svg`;
        link.click();
        setTimeout(()=>URL.revokeObjectURL(url),60_000);
        this.message('1:1 outline downloaded. Print at 100%, verify its 50 mm line, and compare the real lens edge.');
      } catch (error) { this.message(error.message); }
    });
    this.el.querySelector('.photo-input').addEventListener('change', event => { this.stopLive(); void this.loadPhoto(event.target.files[0]); });
    this.el.querySelector('.evidence-confirmed').addEventListener('change', invalidateFrameResult);
    this.el.querySelector('.empty-input').addEventListener('change', event => {
      this.empty = event.target.files[0] || null;
      this.message(this.empty ? 'Empty-sheet photo loaded. Propose the lens edge.' : 'Empty-sheet photo removed.');
    });
    this.el.querySelector('.zip-input').addEventListener('change', event => { this.stopLive(); void this.loadArchive(event.target.files[0]); });
    this.el.querySelector('.video-input').addEventListener('change', event => { this.stopLive(); void this.loadVideo(event.target.files[0]); });
    for (const mode of ['trace', 'box', 'markers', 'scale', 'optical', 'top']) {
      this.el.querySelector(`.${mode}`).addEventListener('click', () => this.setMode(this.mode === mode ? null : mode));
    }
    this.el.querySelector('.propose').addEventListener('click', () => this.propose());
    this.el.querySelector('.undo').addEventListener('click', () => this.undo());
    this.el.querySelector('.clear').addEventListener('click', () => {
      this.saveHistory();
      this.points = [];
      this.box = null;
      this.render();
      this.message('Contour cleared. The image and scale remain available.');
    });
    this.select.addEventListener('change', () => this.useProposal(Number(this.select.value)));
    this.reference.addEventListener('input', invalidateFrameResult);
    this.reference.addEventListener('change', () => this.updateScale());
    this.canvas.addEventListener('pointerdown', event => this.pointerDown(event));
    this.canvas.addEventListener('pointermove', event => this.pointerMove(event));
    this.canvas.addEventListener('pointerup', event => this.pointerUp(event));
    this.canvas.addEventListener('pointercancel', () => { this.dragStart = null; this.dragMark = null; this.render(); });
  }

  message(text) { this.status.textContent = text; }

  stopLive() {
    this.live?.stop();
    this.el.querySelector('.live-stage').hidden = true;
    this.el.querySelector('.live-start').textContent = 'Start camera';
    if (activeLivePanel === this) activeLivePanel = null;
  }

  invalidateEvidence() {
    invalidateFrameResult();
    this.el.querySelector('.evidence-confirmed').checked = false;
    this.caliperCheck = { pass: false, error: null };
    this.repeatCheck = { pass: false, error: null };
    this.edgeRepeatCheck = { pass: false, error: null };
  }

  async loadVideo(file) {
    if (!file) return;
    const request = ++this.videoRequest;
    this.videoFrames.replaceChildren();
    this.videoFrames.hidden = true;
    if (file.size > 100_000_000) { this.message('Video exceeds 100 MB. Choose a shorter clip.'); return; }
    this.message('Extracting video photos…');
    try {
      const body = new FormData();
      body.append('video', file);
      const response = await apiFetch('/api/video-frames', { method: 'POST', body });
      const result = await responseData(response);
      if (request !== this.videoRequest) return;
      if (!response.ok) throw new Error(result.detail || 'Could not read video');
      result.frames.forEach(frame => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-pressed', 'false');
        const image = document.createElement('img');
        image.src = frame.image;
        image.alt = `Video photo at ${frame.seconds.toFixed(1)} seconds`;
        const caption = document.createElement('span');
        caption.textContent = `${frame.seconds.toFixed(1)} s · Use photo`;
        button.append(image, caption);
        button.addEventListener('click', async () => {
          if (request !== this.videoRequest) return;
          this.empty = null;
          this.el.querySelector('.empty-input').value = '';
          const loaded = await this.loadPhoto(fetch(frame.image).then(response => response.blob()));
          if (!loaded || request !== this.videoRequest) return;
          this.videoFrames.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
          this.message('Video photo selected. Set a lens box or add a matching empty sheet, then Propose edge. Calibrate scale and review the contour.');
        });
        this.videoFrames.append(button);
      });
      this.videoFrames.hidden = false;
      this.message('Choose the clearest photo below. Video alone does not set scale.');
    } catch (error) { if (request === this.videoRequest) this.message(error.message); }
  }

  async loadArchive(file) {
    if (!file) return;
    const version = ++this.photoVersion;
    this.photoLoading = true;
    this.invalidateEvidence();
    this.message('Reading iPhone capture…');
    try {
      const body = new FormData();
      body.append('capture', file);
      const response = await apiFetch('/api/import', { method: 'POST', body });
      if (version !== this.photoVersion) return;
      const result = await responseData(response);
      if (version !== this.photoVersion) return;
      if (!response.ok) throw new Error(result.detail || 'Could not import capture');
      if (result.side !== this.side) throw new Error(`This capture is labelled ${result.side}. Load it in the ${result.side} lens panel.`);
      const photo = await fetch(result.image).then(r => r.blob());
      if (version !== this.photoVersion) return;
      const empty = result.empty ? await fetch(result.empty).then(r => r.blob()) : null;
      if (version !== this.photoVersion) return;
      this.empty = empty;
      const loaded = await this.loadPhoto(photo, version);
      if (!loaded || version !== this.photoVersion) return;
      this.message(`${result.frameCount} captured frames imported. ${result.hasDepth ? 'AR depth included. ' : ''}${result.rawCloud ? 'Raw point cloud included. ' : ''}Review the edge and set scale.`);
    } catch (error) { if (version === this.photoVersion) this.message(error.message); }
    finally { if (version === this.photoVersion) this.photoLoading = false; }
  }

  async loadPhoto(file, ownedVersion = null) {
    if (!file) return;
    const version = ownedVersion ?? ++this.photoVersion;
    if (version !== this.photoVersion) return false;
    this.photoLoading = true;
    this.invalidateEvidence();
    try {
      file = await file;
      if (version !== this.photoVersion) return false;
      const bitmap = await createImageBitmap(file);
      if (version !== this.photoVersion) { bitmap.close(); return false; }
      this.photo = file;
      this.loadedPhotoVersion = version;
      this.bitmap?.close();
      this.bitmap = bitmap;
      const factor = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      this.canvas.width = Math.max(1, Math.round(bitmap.width * factor));
      this.canvas.height = Math.max(1, Math.round(bitmap.height * factor));
      this.points = [];
      this.box = null;
      this.scalePoints = [];
      this.markerPoints = [];
      this.homography = null;
      this.opticalCentre = null;
      this.topMark = null;
      this.mmPerPixel = null;
      this.el.querySelector('.evidence-confirmed').checked=false;
      this.history = [];
      this.proposals = [];
      this.select.replaceChildren();
      this.select.hidden = true;
      this.scaleStatus.textContent = 'Scale not set';
      this.markerStatus.textContent = 'Four-marker perspective calibration recommended';
      this.centreStatus.textContent = 'Optical centre not set';
      this.topStatus.textContent = 'Top of lens not marked';
      this.placeholder.hidden = true;
      this.render();
      this.message('Photo loaded. Add an empty sheet or draw a lens box, then propose the edge.');
      return true;
    } catch { if (version === this.photoVersion) this.message('This photo could not be opened. Try a JPEG or PNG.'); return false; }
    finally { if (version === this.photoVersion) this.photoLoading = false; }
  }

  setMode(mode) {
    this.mode = mode;
    for (const name of ['trace', 'box', 'markers', 'scale', 'optical', 'top']) this.el.querySelector(`.${name}`).classList.toggle('active', name === mode);
    if (mode === 'trace') this.message('Tap around the outer lens edge in order. Tap Trace edge again when done.');
    if (mode === 'box') this.message('Drag a box around the lens to guide the GPU proposal.');
    if (mode === 'scale') this.message('Tap two ends of a known printed distance, then enter its length in mm.');
    if (mode === 'markers') this.message('Tap sheet markers in order: top-left, top-right, bottom-right, bottom-left. Printed span: 100 × 70 mm.');
    if (mode === 'optical') this.message('Tap the lens optical centre marked by the eye care provider.');
    if (mode === 'top') this.message('Tap the physical top mark on this lens. Use the same marked point in every photo; the top mark sets frame orientation.');
  }

  point(event) {
    const bounds = this.canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(this.canvas.width, (event.clientX - bounds.left) * this.canvas.width / bounds.width)),
      Math.max(0, Math.min(this.canvas.height, (event.clientY - bounds.top) * this.canvas.height / bounds.height)),
    ];
  }

  pointerDown(event) {
    if (!this.bitmap || !this.mode) return;
    const point = this.point(event);
    if (this.guidedWizard && ['optical', 'top'].includes(this.mode)) {
      this.dragMark = this.mode === 'optical' ? 'opticalCentre' : 'topMark';
      this[this.dragMark] = point;
      this.canvas.setPointerCapture(event.pointerId);
      this.render();
      return;
    }
    if (this.mode === 'box') {
      this.dragStart = point;
      this.canvas.setPointerCapture(event.pointerId);
    } else if (this.mode === 'trace') {
      const hit = this.points.findIndex(vertex => distance(vertex, point) < Math.max(12, this.canvas.width / 100));
      this.saveHistory();
      if (hit >= 0) {
        this.dragVertex = hit;
        this.canvas.setPointerCapture(event.pointerId);
      } else {
        this.points.push(point);
        this.render();
      }
    } else if (this.mode === 'scale') {
      if (this.scalePoints.length >= 2) this.scalePoints = [];
      this.scalePoints.push(point);
      this.updateScale();
      this.render();
    } else if (this.mode === 'markers') {
      if (this.markerPoints.length >= 4) this.markerPoints = [];
      this.markerPoints.push(point);
      if (this.markerPoints.length === 4) {
        try {
          this.homography = sheetHomography(this.markerPoints);
          this.markerStatus.textContent = 'Perspective calibrated to 100 × 70 mm sheet';
          this.message('Four markers set. Check the outline and optical centre.');
        } catch (error) {
          this.homography = null;
          this.markerStatus.textContent = error.message;
        }
      } else {
        this.homography = null;
        this.markerStatus.textContent = `${this.markerPoints.length} of 4 markers set`;
      }
      this.render();
    } else if (this.mode === 'optical') {
      if (this.topMark && distance(point, this.topMark) < 2) { this.message('Optical centre and top mark must be separate points.'); return; }
      this.opticalCentre = point;
      this.centreStatus.textContent = 'Optical centre set — verify this mark with the lens provider';
      this.render();
      if (this.guidedCapture) this.setMode('top');
    } else if (this.mode === 'top') {
      if (this.opticalCentre && distance(point, this.opticalCentre) < 2) { this.message('Top mark and optical centre must be separate points.'); return; }
      this.topMark = point;
      this.topStatus.textContent = 'Top marked — verify the physical mark on the lens';
      this.render();
      if (this.guidedCapture) { this.setMode(null); this.message('Centre and top set. Enter the patient measurements below.'); }
    }
  }

  pointerMove(event) {
    if (this.dragMark) { this[this.dragMark] = this.point(event); this.render(); return; }
    if (this.mode === 'trace' && this.dragVertex !== null) {
      this.points[this.dragVertex] = this.point(event);
      this.render();
      return;
    }
    if (this.mode !== 'box' || !this.dragStart) return;
    this.previewBox = [this.dragStart, this.point(event)];
    this.render();
  }

  pointerUp(event) {
    if (this.dragMark) { this[this.dragMark] = this.point(event); this.dragMark = null; this.render(); return; }
    if (this.mode === 'trace' && this.dragVertex !== null) {
      this.points[this.dragVertex] = this.point(event);
      this.dragVertex = null;
      this.render();
      return;
    }
    if (this.mode !== 'box' || !this.dragStart) return;
    const end = this.point(event);
    if (distance(this.dragStart, end) > 10) {
      this.saveHistory();
      this.box = [this.dragStart, end];
      this.message('Lens box set. Select Propose edge to run the image and GPU methods.');
    }
    this.dragStart = null;
    this.previewBox = null;
    this.render();
  }

  saveHistory() {
    this.history.push({ points: this.points.map(point => [...point]), box: this.box?.map(point => [...point]) || null });
    if (this.history.length > 40) this.history.shift();
  }

  undo() {
    const old = this.history.pop();
    if (!old) return;
    this.points = old.points;
    this.box = old.box;
    this.render();
  }

  updateScale() {
    const length = Number(this.reference.value);
    const pixels = this.scalePoints.length === 2 ? distance(...this.scalePoints) : 0;
    this.mmPerPixel = pixels > 0 && length > 0 ? length / pixels : null;
    this.scaleStatus.textContent = this.mmPerPixel ? `${this.mmPerPixel.toFixed(4)} mm/pixel` : 'Scale not set';
    this.updateMeasurement();
  }

  updateMeasurement() {
    const geometry = JSON.stringify([this.photoVersion, this.points, this.homography, this.mmPerPixel, this.opticalCentre, this.topMark]);
    if (geometry !== this.evidenceGeometry) {
      this.invalidateEvidence();
      this.evidenceGeometry = geometry;
    }
    const transformed = this.homography ? this.points.map(point => project(point, this.homography)) : this.points;
    let normalized = null;
    if ((this.homography || this.mmPerPixel) && this.opticalCentre && this.topMark) {
      try {
        const centre = this.homography ? project(this.opticalCentre, this.homography) : this.opticalCentre;
        const top = this.homography ? project(this.topMark, this.homography) : this.topMark;
        if (distance(centre, top) * (this.homography ? 1 : this.mmPerPixel) < 5)
          throw new Error('Top mark must be at least 5 mm from the optical centre.');
        normalized = this.millimetreOutline();
        this.topStatus.textContent = normalized ? 'Top orientation set' : 'Top marked; review a contour with at least 12 points';
      } catch (error) {
        this.topStatus.textContent = error.message;
      }
    }
    const result = measure(normalized || transformed, normalized || this.homography ? 1 : this.mmPerPixel);
    this.measurement=result;
    const fields=prefix=>({width:Number(this.el.querySelector('.'+prefix+'-width').value),height:Number(this.el.querySelector('.'+prefix+'-height').value)});
    this.caliperCheck=benchmark(result,fields('caliper'));
    this.repeatCheck=benchmark(result,fields('repeat'));
    this.edgeRepeatCheck = this.homography && normalized && this.repeatOutline && this.loadedPhotoVersion !== this.repeatPhotoVersion
      ? contourRepeatability(this.repeatOutline, normalized) : {pass:false,error:null};
    const describe=(name,c)=>name+': '+(c.error?(c.pass?'PASS':'FAIL')+' (width Δ '+c.error.width.toFixed(3)+', height Δ '+c.error.height.toFixed(3)+' mm)':'PENDING');
    this.el.querySelector('.benchmark-status').textContent=describe('Calipers',this.caliperCheck)+'. '+describe('Independent repeat',this.repeatCheck)+'. Target: each Δ ≤ 0.5 mm.';
    this.el.querySelector('.benchmark-status').textContent += ' Edge repeatability: ' + (this.edgeRepeatCheck.error === null ? 'PENDING (save outline, then take another photo and mark its top)' : (this.edgeRepeatCheck.pass ? 'PASS' : 'FAIL') + ' (symmetric max sampled edge distance '+this.edgeRepeatCheck.error.toFixed(3)+' mm; target ≤ 0.5 mm). Outlines align by their marked optical centres and tops. This is repeatability, not edge accuracy.');
    const status=this.el.querySelector('.resolution-status');
    if(this.bitmap&&(this.homography||this.mmPerPixel)){
      const r=pixelResolution(this.points.length?this.points:[[this.canvas.width/2,this.canvas.height/2]],this.homography,this.mmPerPixel,this.bitmap.width/this.canvas.width,this.bitmap.height/this.canvas.height);
      status.textContent='Worst sampled resolution: '+r.working.toFixed(4)+' mm/working pixel; '+r.source.toFixed(4)+' mm/source pixel. Image '+this.bitmap.width+'×'+this.bitmap.height+' → '+this.canvas.width+'×'+this.canvas.height+'. Sampling is not accuracy.';
    }else status.textContent='Pixel resolution awaits calibration.';
    this.size.textContent = result ? `${result.width.toFixed(1)} × ${result.height.toFixed(1)} mm` : 'Awaiting reviewed contour + scale';
    if (result) this.size.title = `Perimeter ${result.perimeter.toFixed(1)} mm; area ${result.area.toFixed(1)} mm². Flat photo measurement only.`;
    this.renderOutlineReview(result, normalized, transformed);
  }

  renderOutlineReview(result, normalized, transformed) {
    const review = this.el.querySelector('.outline-review');
    if (!review?.querySelector) return;
    if (!result || this.points.length < 12 || (!this.homography && !this.mmPerPixel)) { review.hidden = true; return; }
    const scale = this.homography ? 1 : this.mmPerPixel;
    const outline = normalized || transformed.map(([x,y]) => [x * scale, y * scale]);
    const xs = outline.map(point => point[0]), ys = outline.map(point => point[1]);
    const left = Math.min(...xs), top = Math.min(...ys);
    const width = Math.max(...xs) - left, height = Math.max(...ys) - top;
    if (!(width > 0 && height > 0)) { review.hidden = true; return; }
    const fit = Math.min(250 / width, 145 / height);
    const tx = 150 - width * fit / 2, ty = 95 - height * fit / 2;
    const place = ([x,y]) => [tx + (x - left) * fit, ty + (y - top) * fit];
    const path = outline.map((point,index) => {
      const [x,y] = place(point);
      return `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ') + ' Z';
    review.querySelector('.outline-review-path').setAttribute('d',path);
    const centre = normalized ? [0,0] : this.opticalCentre
      ? (this.homography ? project(this.opticalCentre,this.homography) : this.opticalCentre.map(value => value * scale))
      : null;
    let cross = '';
    if (centre) {
      const [x,y] = place(centre);
      cross = `M${(x-5).toFixed(2)} ${y.toFixed(2)} H${(x+5).toFixed(2)} M${x.toFixed(2)} ${(y-5).toFixed(2)} V${(y+5).toFixed(2)}`;
    }
    review.querySelector('.outline-review-cross').setAttribute('d',cross);
    review.querySelector('.outline-review-note').textContent = `${this.homography ? 'Perspective corrected' : 'Scale only'} · ${normalized ? 'top aligned' : 'orientation pending'}`;
    review.querySelector('.outline-review-size').textContent = `${result.width.toFixed(2)} × ${result.height.toFixed(2)} mm`;
    review.hidden = false;
  }

  async propose() {
    if (this.photoLoading) { this.message('Wait for the selected photo to load.'); return; }
    if (!this.photo) { this.message('Add a lens photo first.'); return; }
    if (!this.empty && !this.box) { this.message('Add an empty-sheet photo or drag a box around the lens first.'); return; }
    this.message('Analyzing lens edge…');
    const version = this.photoVersion;
    const request = ++this.proposalRequest;
    try {
      const data = new FormData();
      data.append('image', this.photo, 'lens.jpg');
      if (this.empty) data.append('empty', this.empty, 'empty.jpg');
      if (this.box) {
        const [a, b] = this.box;
        const sx = this.bitmap.width / this.canvas.width;
        const sy = this.bitmap.height / this.canvas.height;
        data.append('box', JSON.stringify([
          Math.floor(Math.min(a[0], b[0]) * sx), Math.floor(Math.min(a[1], b[1]) * sy),
          Math.ceil(Math.max(a[0], b[0]) * sx), Math.ceil(Math.max(a[1], b[1]) * sy),
        ]));
      }
      const response = await apiFetch('/api/segment', { method: 'POST', body: data });
      const result = await responseData(response);
      if (version !== this.photoVersion || request !== this.proposalRequest) return;
      if (!response.ok) throw new Error(result.detail || 'Segmentation failed');
      const sx = this.canvas.width / result.width;
      const sy = this.canvas.height / result.height;
      this.proposals = result.candidates.filter(candidate => candidate.contour?.length >= 3)
        .map(candidate => ({ method: candidate.method, points: candidate.contour.map(([x, y]) => [x * sx, y * sy]) }));
      this.select.replaceChildren();
      this.proposals.forEach((proposal, index) => this.select.add(new Option(proposal.method, String(index))));
      this.select.hidden = this.proposals.length < 2;
      if (this.proposals.length) this.useProposal(0);
      const glare = result.clippedFraction > 0.02 ? ' Strong clipped highlights: recapture with softer light.' : '';
      this.message(`${this.proposals.length} edge proposal(s). Inspect and edit the contour; this is not a certified fit.${glare}`);
    } catch (error) { if (version === this.photoVersion && request === this.proposalRequest) this.message(error.message); }
  }

  useProposal(index) {
    const proposal = this.proposals[index];
    if (!proposal) return;
    this.saveHistory();
    this.points = proposal.points.map(point => [...point]);
    this.render();
  }

  render() {
    if (!this.bitmap) return;
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.bitmap, 0, 0, canvas.width, canvas.height);
    const width = Math.max(2, canvas.width / 400);
    const drawPath = (points, color, close = false) => {
      if (!points?.length) return;
      ctx.beginPath();
      ctx.moveTo(...points[0]);
      points.slice(1).forEach(point => ctx.lineTo(...point));
      if (close && points.length > 2) ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    drawPath(this.points, this.guidedWizard ? '#b8ddff' : '#c9eb64', true);
    if (this.points.length < 100) {
      ctx.fillStyle = this.guidedWizard ? '#b8ddff' : '#c9eb64';
      this.points.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, width * 1.5, 0, Math.PI * 2); ctx.fill(); });
    }
    const box = this.previewBox || this.box;
    if (box) {
      ctx.strokeStyle = '#79d7ef'; ctx.lineWidth = width; ctx.setLineDash([width * 4, width * 3]);
      ctx.strokeRect(box[0][0], box[0][1], box[1][0] - box[0][0], box[1][1] - box[0][1]);
      ctx.setLineDash([]);
    }
    drawPath(this.scalePoints, '#ffae70');
    this.scalePoints.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, width * 2, 0, Math.PI * 2); ctx.fillStyle = '#ffae70'; ctx.fill(); });
    drawPath(this.markerPoints, '#79d7ef', this.markerPoints.length === 4);
    this.markerPoints.forEach(([x, y], index) => {
      ctx.beginPath(); ctx.arc(x, y, width * 2.5, 0, Math.PI * 2); ctx.fillStyle = '#79d7ef'; ctx.fill();
      ctx.fillText(String(index + 1), x + width * 3, y - width * 3);
    });
    if (this.opticalCentre) {
      const [x, y] = this.opticalCentre;
      ctx.strokeStyle = '#ff7bb5'; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(x - width * 6, y); ctx.lineTo(x + width * 6, y);
      ctx.moveTo(x, y - width * 6); ctx.lineTo(x, y + width * 6); ctx.stroke();
    }
    if (this.topMark) {
      const [x, y] = this.topMark;
      ctx.strokeStyle = '#ffe77d'; ctx.lineWidth = width * 1.4;
      ctx.beginPath(); ctx.moveTo(x, y - width * 7); ctx.lineTo(x - width * 5, y + width * 3);
      ctx.lineTo(x + width * 5, y + width * 3); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = '#ffe77d'; ctx.font = `${Math.max(12, width * 6)}px sans-serif`;
      ctx.fillText('TOP', x + width * 7, y + width * 2);
    }
    this.updateMeasurement();
  }

  millimetreOutline() {
    if (this.points.length < 12 || (!this.mmPerPixel && !this.homography) || !this.opticalCentre) return null;
    const origin = this.homography ? project(this.opticalCentre, this.homography) : this.opticalCentre;
    const scale = this.homography ? 1 : this.mmPerPixel;
    const contour = this.points.map(point => {
      const position = this.homography ? project(point, this.homography) : point;
      return [position[0] * scale, position[1] * scale];
    });
    if (this.topMark) {
      const top = this.homography ? project(this.topMark, this.homography) : this.topMark;
      return normalizeLensOrientation(contour, origin.map(value => value * scale), top.map(value => value * scale))
        .contour.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))]);
    }
    return contour.map(([x, y]) => [Number((x - origin[0] * scale).toFixed(3)), Number((y - origin[1] * scale).toFixed(3))]);
  }
}

const [leftPanel, rightPanel] = panels.map(panel => new LensPanel(panel));
async function importSimpleCaptures() {
  if (typeof sessionStorage === 'undefined') return;
  let raw;
  try { raw = sessionStorage.getItem('optiframe-captures'); }
  catch { return; }
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    for (const item of saved) {
      const panel = item.side === 'left' ? leftPanel : item.side === 'right' ? rightPanel : null;
      if (!panel || !Array.isArray(item.contour) || !Array.isArray(item.markers)) throw new Error('Invalid capture transfer');
      const photo = await fetch(item.image).then(response => response.blob());
      if (!await panel.loadPhoto(photo)) throw new Error('Transferred photo could not be opened');
      const sx = panel.canvas.width / item.width, sy = panel.canvas.height / item.height;
      panel.points = item.contour.map(([x,y]) => [x * sx, y * sy]);
      panel.captureRefinement = item.refinement || null;
      panel.markerPoints = item.markers.map(([x,y]) => [x * sx, y * sy]);
      panel.homography = sheetHomography(panel.markerPoints);
      if (Array.isArray(item.opticalCentre) && item.opticalCentre.length === 2 && item.opticalCentre.every(Number.isFinite)) panel.opticalCentre = [item.opticalCentre[0] * sx, item.opticalCentre[1] * sy];
      if (Array.isArray(item.topMark) && item.topMark.length === 2 && item.topMark.every(Number.isFinite)) panel.topMark = [item.topMark[0] * sx, item.topMark[1] * sy];
      panel.markerStatus.textContent = 'Perspective calibrated from camera capture';
      panel.render();
      panel.guidedCapture = true;
      panel.setMode('optical');
    }
    document.body.classList.add('guided-fit');
    document.getElementById('page-title').textContent = 'Fit frame';
    sessionStorage.removeItem('optiframe-captures');
  } catch (error) { document.querySelector('#design-status').textContent = `Capture transfer failed: ${error.message}`; }
}
const capturesReady = importSimpleCaptures();
try {
  const savedFit = JSON.parse(sessionStorage.getItem('optiframe-fit-inputs') || 'null');
  sessionStorage.removeItem('optiframe-fit-inputs');
  if (savedFit && typeof savedFit === 'object') for (const [id, value] of Object.entries(savedFit)) {
    const input = document.getElementById(id);
    if (input?.matches('.design-inputs input') && typeof value === 'string') input.value = value;
  }
} catch { /* Missing or blocked session storage leaves manual fields available. */ }
const designStatus = document.querySelector('#design-status');
const number = id => {
  const input = document.getElementById(id);
  if (!input.value.trim() || !input.validity.valid) throw new Error(`Enter a valid value for ${input.closest('label')?.textContent.trim() || id}.`);
  const value = Number(input.value);
  if (!Number.isFinite(value)) throw new Error(`Enter a finite value for ${id}.`);
  return value;
};

function invalidateFrameResult() {
  frameAssembly = null;
  makeFrame.sequence = (makeFrame.sequence || 0) + 1;
  const viewer = document.getElementById?.('viewer');
  const showingPreview = viewer?.classList?.contains?.('active');
  if (showingPreview && viewer.dataset.stale !== 'true') {
    viewer.dataset.stale = 'true';
    viewer.setAttribute('aria-label', 'Stale 3D preview. Rebuild after input changes.');
    const badge = document.createElement('div');
    badge.className = 'preview-stale-badge';
    badge.textContent = 'Updating…';
    badge.style.cssText = 'position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:2;padding:9px 18px;background:#ffffffde;color:#293340;font-size:13px;border-radius:24px;text-align:center;backdrop-filter:blur(16px)';
    viewer.appendChild(badge);
  }
  if (showingPreview || makeFrame.pending)
    designStatus.textContent = 'Design inputs changed. Rebuild the 3D assembly preview or generate a new STL.';
  makeFrame.pending = false;
  automaticPreview?.schedule();
}

function frameSnapshot(payload) {
  const panelState = [leftPanel, rightPanel].map(panel => ({
    photoVersion: panel.photoVersion,
    photoLoading: panel.photoLoading,
    evidenceGeometry: panel.evidenceGeometry,
    evidenceConfirmed: panel.el.querySelector('.evidence-confirmed').checked,
    caliper: ['width', 'height'].map(axis => panel.el.querySelector('.caliper-' + axis).value),
    repeat: ['width', 'height'].map(axis => panel.el.querySelector('.repeat-' + axis).value),
    repeatPhotoVersion: panel.repeatPhotoVersion,
  }));
  return JSON.stringify([payload, panelState]);
}

function isCurrentFrameRequest(request, snapshot) {
  if (request !== makeFrame.sequence) return false;
  try {
    if (frameSnapshot(framePayload()) === snapshot) return true;
  } catch { /* An incomplete replacement input also makes the result stale. */ }
  invalidateFrameResult();
  return false;
}

document.querySelectorAll('.design-inputs input').forEach(input => {
  input.addEventListener('input', invalidateFrameResult);
  input.addEventListener('change', invalidateFrameResult);
});

function framePayload() {
  if ([leftPanel, rightPanel].some(panel => panel.photoLoading))
    throw new Error('Wait for both selected photos to finish loading before previewing or exporting.');
  const left = leftPanel.millimetreOutline();
  const right = rightPanel.millimetreOutline();
  if (!left || !right) throw new Error('Each lens needs at least 12 contour points, a sheet calibration or two-point scale, and an optical centre.');
  if ([leftPanel, rightPanel].some(panel => !panel.topMark))
    throw new Error('Mark the physical top of both lenses to set their orientation.');
  const leftThickness = number('left-edge-thickness');
  const rightThickness = number('right-edge-thickness');
  return { left, right, settings: {
    frame_style: frameStyle,
    left_pd: number('left-pd'), right_pd: number('right-pd'),
    edge_thickness: leftThickness, left_edge_thickness: leftThickness, right_edge_thickness: rightThickness,
    left_vertical_offset: number('left-vertical-offset'), right_vertical_offset: number('right-vertical-offset'),
    temple_length: number('temple-length'),
    bed_width: number('bed-width'), bed_depth: number('bed-depth'),
  } };
}

async function makeFrame(preview, experimental = false) {
  automaticPreview?.cancel();
  const request = makeFrame.sequence = (makeFrame.sequence || 0) + 1;
  try {
    if ([leftPanel, rightPanel].some(panel => panel.photoLoading))
      throw new Error('Wait for both selected photos to finish loading before previewing or exporting.');
    if(!preview&&!experimental&&[leftPanel,rightPanel].some(p=>!p.homography||!p.opticalCentre||!p.topMark||!p.caliperCheck?.pass||!p.repeatCheck?.pass||!p.edgeRepeatCheck?.pass||!p.el.querySelector('.evidence-confirmed').checked))
      throw new Error('Checked export requires four markers, marked optical centre and top, caliper/repeat width-height checks and edge repeatability ≤ 0.5 mm for each lens, plus confirmed physical evidence. Use UNVERIFIED experimental export for a test.');
    const payload = framePayload();
    const snapshot = frameSnapshot(payload);
    makeFrame.pending = true;
    designStatus.textContent = preview ? 'Building 3D preview…' : 'Generating and checking closed STL meshes…';
    const response = await apiFetch(preview ? '/api/frame-preview' : '/api/frame', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!isCurrentFrameRequest(request, snapshot)) return;
    if (!response.ok) {
      const error = await responseData(response);
      if (!isCurrentFrameRequest(request, snapshot)) return;
      throw new Error(error.detail || 'Frame generation failed');
    }
    const blob = await response.blob();
    if (!isCurrentFrameRequest(request, snapshot)) return;
    if (preview) {
      const { showSTL } = await import('./viewer.js?v=18');
      if (!isCurrentFrameRequest(request, snapshot)) return;
      const buffer = await blob.arrayBuffer();
      if (!isCurrentFrameRequest(request, snapshot)) return;
      const viewer = document.getElementById('viewer');
      showSTL(buffer, viewer);
      frameAssembly = JSON.parse(new TextDecoder().decode(buffer));
      viewer.dataset.stale = 'false';
      viewer.setAttribute('aria-label', 'Rotatable 3D preview of current frame assembly');
      designStatus.textContent = 'Frame preview. Lens curvature is not measured.';
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = experimental ? 'optiframe-UNVERIFIED-experimental-kit.zip' : 'optiframe-measurement-checked-kit.zip';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      designStatus.textContent = (experimental ? 'UNVERIFIED experimental kit. ' : 'Measurement checks passed; physical fit unverified. ') + 'STL kit downloaded. Slice at 100% in millimetres, print a fit test and inspect lens retention before use.';
    }
  } catch (error) { if (request === makeFrame.sequence) designStatus.textContent = error.message; }
  finally { if (request === makeFrame.sequence) makeFrame.pending = false; }
}

document.getElementById('preview-frame').addEventListener('click', () => makeFrame(true));
document.getElementById('download-frame').addEventListener('click', () => makeFrame(false));
document.getElementById('download-experimental').addEventListener('click', () => makeFrame(false, true));
automaticPreview = createPreviewScheduler({
  snapshot: () => JSON.stringify(framePayload()),
  shouldRender: () => !document.body.classList.contains('fit-flow') || document.getElementById('viewer').offsetParent !== null,
  render: () => makeFrame(true),
});
export { distance, polygonArea, measure, sheetHomography, project, leftPanel, rightPanel, capturesReady, framePayload, makeFrame, getFrameStyle, setFrameStyle, getFrameAssembly };
