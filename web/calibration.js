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

function sheetHomography(corners) {
  if (corners.length !== 4) return null;
  validateMarkers(corners);
  const targets = [[0, 0], [100, 0], [100, 70], [0, 70]];
  const rows = [];
  corners.forEach(([x, y], index) => {
    const [u, v] = targets[index];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  });
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    if (Math.abs(rows[pivot][col]) < 1e-8) throw new Error('Sheet markers are too close or crossed. Tap them again in order.');
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const scale = rows[col][col];
    for (let k = col; k <= 8; k++) rows[col][k] /= scale;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let k = col; k <= 8; k++) rows[row][k] -= factor * rows[col][k];
    }
  }
  return rows.map(row => row[8]);
}

function project(point, h) {
  const [x, y] = point;
  const denominator = h[6] * x + h[7] * y + 1;
  if (Math.abs(denominator) < 1e-8) throw new Error('Perspective calibration is unstable. Retake the sheet photo.');
  return [(h[0] * x + h[1] * y + h[2]) / denominator,
          (h[3] * x + h[4] * y + h[5]) / denominator];
}

function unproject([u, v], h) {
  const a=h[0]-u*h[6], b=h[1]-u*h[7], c=h[3]-v*h[6], d=h[4]-v*h[7];
  const determinant=a*d-b*c;
  if (!Number.isFinite(determinant) || Math.abs(determinant)<1e-12)
    throw new Error('Perspective calibration cannot be inverted');
  const x=((u-h[2])*d-b*(v-h[5]))/determinant;
  const y=(a*(v-h[5])-(u-h[2])*c)/determinant;
  if (![x,y].every(Number.isFinite)) throw new Error('Invalid perspective coordinates');
  return [x,y];
}

function validateMarkers(p) {
 const turns=p.map((a,i)=>{const b=p[(i+1)%4],c=p[(i+2)%4];return (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);});
 const spans=p.map((a,i)=>distance(a,p[(i+1)%4]));
 if(p.some(a=>!a.every(Number.isFinite))||!turns.every(v=>v>0)||Math.min(...spans)<20||polygonArea(p)/Math.max(...spans)**2<0.1) throw new Error('Marker geometry crossed, reversed, too small or severely tilted. Retake and tap centres 1–4.');
}
function benchmark(result,reference) {
 if(!result||!['width','height'].every(k=>Number.isFinite(reference[k])&&reference[k]>0)) return {pass:false,error:null};
 const error={width:Math.abs(result.width-reference.width),height:Math.abs(result.height-reference.height)};
 return {pass:Object.values(error).every(v=>v<=0.5+1e-9),error};
}
function pixelResolution(points,h,scale,sx,sy) {
 const values=points.flatMap(p=>[0,1].map(axis=>{const q=[...p];q[axis]+=1;const mm=h?distance(project(p,h),project(q,h)):scale;return {working:mm,source:mm/[sx,sy][axis]};}));
 return {working:Math.max(...values.map(v=>v.working)),source:Math.max(...values.map(v=>v.source))};
}
function contourRepeatability(first, second) {
  if (!first || !second || first.length < 3 || second.length < 3) return {pass:false,error:null};
  if (![...first,...second].every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)))
    return {pass:false,error:null};
  // The caller has already centred each contour on its marked optical centre
  // and aligned its physical top mark. Keep that origin: recentering would hide
  // a misplaced optical-centre mark on an independent capture.
  const a=first, b=second;
  const segmentDistance=(p,u,v)=>{
    const dx=v[0]-u[0],dy=v[1]-u[1],denom=dx*dx+dy*dy;
    const t=denom ? Math.max(0,Math.min(1,((p[0]-u[0])*dx+(p[1]-u[1])*dy)/denom)) : 0;
    return distance(p,[u[0]+t*dx,u[1]+t*dy]);
  };
  const directed=(source,target)=>{
    let maximum=0;
    source.forEach((p,i)=>{
      const q=source[(i+1)%source.length], count=Math.max(1,Math.ceil(distance(p,q)/0.25));
      for(let k=0;k<count;k++) {
        const sample=[p[0]+(q[0]-p[0])*k/count,p[1]+(q[1]-p[1])*k/count];
        maximum=Math.max(maximum,Math.min(...target.map((u,j)=>segmentDistance(sample,u,target[(j+1)%target.length]))));
      }
    });
    return maximum;
  };
  const error=Math.max(directed(a,b),directed(b,a));
  return {pass:Number.isFinite(error)&&error<=0.5+1e-9,error};
}

// Coordinates are already rectified millimetres, with image Y increasing downward.
// The user's two marks establish placement without changing the measured shape.
function normalizeLensOrientation(points, opticalCentre, topMark) {
  const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
  if (!Array.isArray(points) || points.length < 3 || !points.every(validPoint) ||
      !validPoint(opticalCentre) || !validPoint(topMark)) {
    throw new Error('Lens contour, optical centre, and top mark must contain finite 2D millimetre coordinates.');
  }
  const dx = topMark[0] - opticalCentre[0];
  const dy = topMark[1] - opticalCentre[1];
  const length = Math.hypot(dx, dy);
  if (length < 5) throw new Error('Top mark must be at least 5 mm from the optical centre.');
  const topAngleRadians = Math.atan2(dx, -dy);
  const cosine = -dy / length;
  const sine = dx / length;
  const rotate = point => {
    const x = point[0] - opticalCentre[0];
    const y = point[1] - opticalCentre[1];
    return [cosine * x + sine * y, -sine * x + cosine * y];
  };
  return {
    contour: points.map(rotate),
    top: rotate(topMark),
    topAngleRadians,
    appliedRotationRadians: -topAngleRadians,
  };
}

// A4 proof for comparing the actual loose lens against its measured contour.
// SVG millimetre units preserve the geometry when printed without scaling.
function outlineProofSVG(contour, side) {
  if (!['left', 'right'].includes(side) || !Array.isArray(contour) || contour.length < 12 ||
      !contour.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)))
    throw new Error('A valid left or right contour with at least 12 points is needed.');
  const xs = contour.map(point => point[0]);
  const ys = contour.map(point => point[1]);
  if (Math.min(...xs) < -90 || Math.max(...xs) > 90 || Math.min(...ys) < -95 || Math.max(...ys) > 95)
    throw new Error('This outline exceeds the safe A4 print area.');
  const path = contour.map(([x,y],index) => `${index ? 'L' : 'M'}${x.toFixed(3)} ${y.toFixed(3)}`).join(' ') + ' Z';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">
<rect width="210" height="297" fill="white"/>
<g fill="#161a18" font-family="Arial,sans-serif"><text x="15" y="20" font-size="6">OptiFrame · ${side.toUpperCase()} lens · 1:1 outline proof</text>
<text x="15" y="29" font-size="3.5">Print at actual size / 100%, without fit-to-page scaling. Verify the 50 mm line first.</text>
<text x="15" y="36" font-size="3.5">TOP ↑ · Align the loose lens orientation and optical mark with the drawing.</text></g>
<g transform="translate(105 135)" fill="none" stroke="#111" stroke-width="0.2" stroke-linejoin="round"><path d="${path}"/>
<path d="M-2 0 H2 M0 -2 V2" stroke-width="0.15"/></g>
<g fill="#161a18" font-family="Arial,sans-serif" font-size="3.5"><text x="15" y="245">Scale check: exactly 50 mm</text><text x="15" y="278">Compare several points around the real edge. This is not a certified lens fit.</text></g>
<path d="M15 253 H65 M15 251 V255 M65 251 V255" fill="none" stroke="#111" stroke-width="0.2"/>
</svg>`;
}

export {distance,polygonArea,measure,sheetHomography,project,unproject,benchmark,pixelResolution,contourRepeatability,normalizeLensOrientation,outlineProofSVG};
