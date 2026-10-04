import {project, sheetHomography} from './calibration.js';

// Appearance-only geometry. Never write these defaults into patient/print inputs.
export function visualFitPayload(outlines, style='classic') {
  if (!['classic','bold','brow'].includes(style) || outlines?.length!==2) throw new Error('Choose two lens outlines.');
  const centered=outlines.map(points=>{
    if (!Array.isArray(points)||points.length<12||points.length>3000||!points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))) throw new Error('Lens outline unavailable. Rescan or use sample frames.');
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x=(Math.min(...xs)+Math.max(...xs))/2,y=(Math.min(...ys)+Math.max(...ys))/2;
    return points.map(p=>[p[0]-x,p[1]-y]);
  });
  const widths=centered.map(p=>Math.max(...p.map(q=>q[0]))-Math.min(...p.map(q=>q[0])));
  if (widths.some(w=>w<15||w>100)) throw new Error('Lens scale unavailable. Rescan or use sample frames.');
  const scale=Math.min(1,60/Math.max(...widths));
  const [left,right]=centered.map(p=>p.map(q=>q.map(v=>v*scale)));
  return {left,right,settings:{left_pd:Math.max(20,widths[0]*scale/2+8),right_pd:Math.max(20,widths[1]*scale/2+8),edge_thickness:2,temple_length:130,frame_style:style,retention_style:'screw',alignment_source:'illustrative'}};
}

export function captureOutlines(captures) {
  if (!Array.isArray(captures)) throw new Error('Scan both lenses first.');
  return ['left','right'].map(side=>{
    const item=captures.find(c=>c.side===side);
    if (!item || !Array.isArray(item.markers) || item.markers.length!==4 || !Array.isArray(item.contour)) throw new Error('Both calibrated lenses are needed.');
    const h=sheetHomography(item.markers);
    return item.contour.map(p=>project(p,h));
  });
}

export function nativeTryOnFile(assembly) {
  return {...assembly, purpose:'visual-try-on', alignmentSource:'illustrative', requiresFitVerification:true};
}
