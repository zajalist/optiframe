const subtract=(a,b)=>a.map((value,index)=>value-b[index]);
const dot=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=vector=>{const length=Math.hypot(...vector);return length>1e-12?vector.map(value=>value/length):[0,0,0];};

// Smooth only genuinely connected shallow facets. Global vertex normals blend
// flat front caps into side walls and turn CAD triangulation into glossy patches.
// Explicitly split/coincident vertices remain split; no positional welding or
// mesh smoothing changes the printable shape, retaining slots or engraved marks.
export function frameSurfaceAttributes(part,creaseAngle=Math.PI/4) {
  const {vertices,faces}=part;
  if(!Array.isArray(vertices)||!Array.isArray(faces)||!vertices.length||!faces.length||
     vertices.some(v=>!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))||
     faces.some(f=>!Array.isArray(f)||f.length!==3||f.some(i=>!Number.isInteger(i)||i<0||i>=vertices.length))||
     !Number.isFinite(creaseAngle)||creaseAngle<0||creaseAngle>Math.PI)
    throw new Error('Invalid frame preview geometry');
  const faceNormals=[],adjacent=Array.from({length:vertices.length},()=>[]);
  faces.forEach((face,index)=>{
    const [a,b,c]=face.map(i=>vertices[i]);
    const normal=unit(cross(subtract(b,a),subtract(c,a)));faceNormals.push(normal);
    face.forEach((vertex,corner)=>{
      const origin=vertices[vertex],first=unit(subtract(vertices[face[(corner+1)%3]],origin));
      const second=unit(subtract(vertices[face[(corner+2)%3]],origin));
      const angle=Math.acos(Math.max(-1,Math.min(1,dot(first,second))));
      adjacent[vertex].push({index,angle});
    });
  });
  const positions=new Float32Array(faces.length*9),normals=new Float32Array(positions.length);
  const threshold=Math.cos(creaseAngle);
  faces.forEach((face,index)=>face.forEach((vertex,corner)=>{
    const base=faceNormals[index],sum=[0,0,0];
    for(const neighbor of adjacent[vertex]) {
      const normal=faceNormals[neighbor.index];
      if(dot(base,normal)>=threshold-1e-8)
        for(let axis=0;axis<3;axis++)sum[axis]+=normal[axis]*neighbor.angle;
    }
    const offset=index*9+corner*3;
    positions.set(vertices[vertex],offset);normals.set(unit(sum),offset);
  }));
  return {positions,normals};
}

function brandedFaces(part) {
  const indices=part.branding?.faceIndices;
  if(part.kind==='lens'||part.branding?.finish!=='silver-infill-preview'||!Array.isArray(indices)||!indices.length||
     indices.some(index=>!Number.isInteger(index)||index<0||index>=part.faces?.length))return new Set();
  return new Set(indices);
}

export function createFrameGeometry(THREE,part) {
  let {positions,normals}=frameSurfaceAttributes(part);
  const engraving=brandedFaces(part);
  const geometry=new THREE.BufferGeometry();
  if(engraving.size) {
    // Keep the exact CAD triangles and normals. Ordering gives the engraved
    // floors their own finish in two draw calls, without a floating logo decal.
    const order=part.faces.map((_,index)=>index).filter(index=>!engraving.has(index)).concat([...engraving]);
    const reorderedPositions=new Float32Array(positions.length),reorderedNormals=new Float32Array(normals.length);
    order.forEach((face,index)=>{
      reorderedPositions.set(positions.subarray(face*9,face*9+9),index*9);
      reorderedNormals.set(normals.subarray(face*9,face*9+9),index*9);
    });
    positions=reorderedPositions;normals=reorderedNormals;
    const bodyVertices=(part.faces.length-engraving.size)*3;
    if(bodyVertices)geometry.addGroup(0,bodyVertices,0);
    geometry.addGroup(bodyVertices,engraving.size*3,1);
  }
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
  return geometry;
}

export function createFrameMaterial(THREE,part,{tryOn=false}={}) {
  if(part.kind==='lens')return new THREE.MeshBasicMaterial({
    color:0xc3d5df,transparent:true,opacity:tryOn?.045:.10,
    depthWrite:false,side:THREE.FrontSide,toneMapped:false,
  });
  const body=new THREE.MeshStandardMaterial({
    color:0x242629,metalness:0,roughness:.52,side:THREE.FrontSide,
    flatShading:false,
  });
  if(!brandedFaces(part).size)return body;
  // A silver paint infill visualization. STL retains the debossed geometry;
  // color is a finishing choice, never implied to be encoded in STL.
  const signature=new THREE.MeshStandardMaterial({
    color:0xd4d7dc,metalness:.28,roughness:.34,side:THREE.FrontSide,
    flatShading:false,
  });
  return [body,signature];
}

export function configureFrameRenderer(THREE,renderer) {
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1;
}
