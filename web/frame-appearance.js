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

export function createFrameGeometry(THREE,part) {
  const {positions,normals}=frameSurfaceAttributes(part);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
  return geometry;
}

export function createFrameMaterial(THREE,part,{tryOn=false}={}) {
  if(part.kind==='lens')return new THREE.MeshBasicMaterial({
    color:0xc3d5df,transparent:true,opacity:tryOn?.045:.10,
    depthWrite:false,side:THREE.FrontSide,toneMapped:false,
  });
  return new THREE.MeshStandardMaterial({
    color:0x242629,metalness:0,roughness:.52,side:THREE.FrontSide,
    flatShading:false,
  });
}

export function configureFrameRenderer(THREE,renderer) {
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1;
}
