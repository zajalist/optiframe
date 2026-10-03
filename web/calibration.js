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
  const centre = points => {
    let area=0, x=0, y=0;
    points.forEach((p,i)=>{const q=points[(i+1)%points.length], cross=p[0]*q[1]-q[0]*p[1];area+=cross;x+=(p[0]+q[0])*cross;y+=(p[1]+q[1])*cross;});
    return Math.abs(area)>1e-8 ? [x/(3*area),y/(3*area)] : null;
  };
  const aCentre=centre(first),bCentre=centre(second);
  if (!aCentre || !bCentre) return {pass:false,error:null};
  const align=(points,c)=>points.map(p=>[p[0]-c[0],p[1]-c[1]]);
  const a=align(first,aCentre), b=align(second,bCentre);
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
export {distance,polygonArea,measure,sheetHomography,project,benchmark,pixelResolution,contourRepeatability};
