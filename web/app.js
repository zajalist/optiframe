const panels = [...document.querySelectorAll('.lens-panel')];

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function polygonArea(points) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
}

function measure(points, mmPerPixel) {
  if (points.length < 3 || !Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return null;
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const perimeter = points.reduce((sum, point, index) => sum + distance(point, points[(index + 1) % points.length]), 0);
  return {
    width: (Math.max(...xs) - Math.min(...xs)) * mmPerPixel,
    height: (Math.max(...ys) - Math.min(...ys)) * mmPerPixel,
    perimeter: perimeter * mmPerPixel,
    area: polygonArea(points) * mmPerPixel ** 2,
  };
}

class LensPanel {
  constructor(element) {
    this.el = element;
    this.side = element.dataset.side;
    this.canvas = element.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.status = element.querySelector('.panel-status');
    this.size = element.querySelector(`#${this.side}-size`);
    this.placeholder = element.querySelector('.canvas-placeholder');
    this.select = element.querySelector('.proposal-select');
    this.reference = element.querySelector('.reference-mm');
    this.scaleStatus = element.querySelector('.scale-status');
    this.centreStatus = element.querySelector('.centre-status');
    this.photo = null;
    this.empty = null;
    this.bitmap = null;
    this.points = [];
    this.scalePoints = [];
    this.opticalCentre = null;
    this.mmPerPixel = null;
    this.box = null;
    this.mode = null;
    this.dragStart = null;
    this.dragVertex = null;
    this.proposals = [];
    this.history = [];
    this.bind();
  }

  bind() {
    this.el.querySelector('.photo-input').addEventListener('change', event => this.loadPhoto(event.target.files[0]));
    this.el.querySelector('.empty-input').addEventListener('change', event => {
      this.empty = event.target.files[0] || null;
      this.message(this.empty ? 'Empty-sheet photo loaded. Propose the lens edge.' : 'Empty-sheet photo removed.');
    });
    this.el.querySelector('.zip-input').addEventListener('change', event => this.loadArchive(event.target.files[0]));
    for (const mode of ['trace', 'box', 'scale', 'optical']) {
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
    this.reference.addEventListener('change', () => this.updateScale());
    this.canvas.addEventListener('pointerdown', event => this.pointerDown(event));
    this.canvas.addEventListener('pointermove', event => this.pointerMove(event));
    this.canvas.addEventListener('pointerup', event => this.pointerUp(event));
    this.canvas.addEventListener('pointercancel', () => { this.dragStart = null; this.render(); });
  }

  message(text) { this.status.textContent = text; }

  async loadArchive(file) {
    if (!file) return;
    this.message('Reading iPhone capture…');
    try {
      const body = new FormData();
      body.append('capture', file);
      const response = await fetch('/api/import', { method: 'POST', body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Could not import capture');
      if (result.side !== this.side) this.message(`This capture says ${result.side}; check the selected side.`);
      const photo = await fetch(result.image).then(r => r.blob());
      const empty = result.empty ? await fetch(result.empty).then(r => r.blob()) : null;
      this.empty = empty;
      await this.loadPhoto(photo);
      this.message(`${result.frameCount} captured frames imported. ${result.hasDepth ? 'AR depth included. ' : ''}${result.rawCloud ? 'Raw point cloud included. ' : ''}Review the edge and set scale.`);
    } catch (error) { this.message(error.message); }
  }

  async loadPhoto(file) {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      this.photo = file;
      this.bitmap?.close();
      this.bitmap = bitmap;
      const factor = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      this.canvas.width = Math.max(1, Math.round(bitmap.width * factor));
      this.canvas.height = Math.max(1, Math.round(bitmap.height * factor));
      this.points = [];
      this.box = null;
      this.scalePoints = [];
      this.opticalCentre = null;
      this.mmPerPixel = null;
      this.history = [];
      this.placeholder.hidden = true;
      this.render();
      this.message('Photo loaded. Add an empty sheet or draw a lens box, then propose the edge.');
    } catch { this.message('This photo could not be opened. Try a JPEG or PNG.'); }
  }

  setMode(mode) {
    this.mode = mode;
    for (const name of ['trace', 'box', 'scale', 'optical']) this.el.querySelector(`.${name}`).classList.toggle('active', name === mode);
    if (mode === 'trace') this.message('Tap around the outer lens edge in order. Tap Trace edge again when done.');
    if (mode === 'box') this.message('Drag a box around the lens to guide the GPU proposal.');
    if (mode === 'scale') this.message('Tap two ends of a known printed distance, then enter its length in mm.');
    if (mode === 'optical') this.message('Tap the lens optical centre marked by the eye care provider.');
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
    } else if (this.mode === 'optical') {
      this.opticalCentre = point;
      this.centreStatus.textContent = 'Optical centre set — verify this mark with the lens provider';
      this.render();
    }
  }

  pointerMove(event) {
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
    const result = measure(this.points, this.mmPerPixel);
    this.size.textContent = result ? `${result.width.toFixed(1)} × ${result.height.toFixed(1)} mm` : 'Awaiting reviewed contour + scale';
    if (result) this.size.title = `Perimeter ${result.perimeter.toFixed(1)} mm; area ${result.area.toFixed(1)} mm². Flat photo measurement only.`;
  }

  async propose() {
    if (!this.photo) { this.message('Add a lens photo first.'); return; }
    if (!this.empty && !this.box) { this.message('Add an empty-sheet photo or drag a box around the lens first.'); return; }
    this.message('Analyzing lens edge…');
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
      const response = await fetch('/api/segment', { method: 'POST', body: data });
      const result = await response.json();
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
    } catch (error) { this.message(error.message); }
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
    drawPath(this.points, '#c9eb64', true);
    if (this.points.length < 100) {
      ctx.fillStyle = '#c9eb64';
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
    if (this.opticalCentre) {
      const [x, y] = this.opticalCentre;
      ctx.strokeStyle = '#ff7bb5'; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(x - width * 6, y); ctx.lineTo(x + width * 6, y);
      ctx.moveTo(x, y - width * 6); ctx.lineTo(x, y + width * 6); ctx.stroke();
    }
    this.updateMeasurement();
  }

  millimetreOutline() {
    if (this.points.length < 12 || !this.mmPerPixel || !this.opticalCentre) return null;
    return this.points.map(([x, y]) => [
      Number(((x - this.opticalCentre[0]) * this.mmPerPixel).toFixed(3)),
      Number(((y - this.opticalCentre[1]) * this.mmPerPixel).toFixed(3)),
    ]);
  }
}

const [leftPanel, rightPanel] = panels.map(panel => new LensPanel(panel));
const designStatus = document.querySelector('#design-status');
const number = id => Number(document.getElementById(id).value);

function framePayload() {
  const left = leftPanel.millimetreOutline();
  const right = rightPanel.millimetreOutline();
  if (!left || !right) throw new Error('Each lens needs at least 12 contour points, a confirmed scale and an optical centre.');
  return { left, right, settings: {
    left_pd: number('left-pd'), right_pd: number('right-pd'),
    edge_thickness: number('edge-thickness'), temple_length: number('temple-length'),
    bed_width: number('bed-width'), bed_depth: number('bed-depth'),
  } };
}

async function makeFrame(preview) {
  try {
    const payload = framePayload();
    designStatus.textContent = preview ? 'Building 3D preview…' : 'Generating and checking closed STL meshes…';
    const response = await fetch(preview ? '/api/frame-preview' : '/api/frame', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Frame generation failed');
    }
    const blob = await response.blob();
    if (preview) {
      const { showSTL } = await import('./viewer.js');
      showSTL(await blob.arrayBuffer(), document.getElementById('viewer'));
      designStatus.textContent = '3D front preview. Rotate to inspect; export includes the front, two retainers and two hinged temples.';
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'optiframe-experimental-kit.zip';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      designStatus.textContent = 'STL kit downloaded. Slice at 100% in millimetres, print a fit test and inspect lens retention before use.';
    }
  } catch (error) { designStatus.textContent = error.message; }
}

document.getElementById('preview-frame').addEventListener('click', () => makeFrame(true));
document.getElementById('download-frame').addEventListener('click', () => makeFrame(false));
export { distance, polygonArea, measure };
