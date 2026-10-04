import test from 'node:test';
import assert from 'node:assert/strict';
import {frameSurfaceAttributes,createFrameGeometry,createFrameMaterial,configureFrameRenderer} from './frame-appearance.js';

const corner=(data,face,index=0)=>Array.from(data.normals.slice(face*9+index*3,face*9+index*3+3));
const near=(a,b)=>a.every((value,index)=>Math.abs(value-b[index])<1e-6);
test('a hard rim corner retains separate front and side normals without changing vertices',()=>{
  const part={vertices:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],faces:[[0,1,2],[0,3,1]]};
  const snapshot=JSON.stringify(part),data=frameSurfaceAttributes(part);
  assert.deepEqual(corner(data,0),[0,0,1]);assert.deepEqual(corner(data,1),[0,1,0]);
  assert.deepEqual(Array.from(data.positions),part.faces.flatMap(face=>face.flatMap(index=>part.vertices[index])));
  assert.equal(JSON.stringify(part),snapshot);
});
test('shallow connected facets have matching smooth normals at shared vertices',()=>{
  const part={vertices:[[0,0,0],[1,0,0],[0,1,0],[0,-1,.2]],faces:[[0,1,2],[1,0,3]]};
  const data=frameSurfaceAttributes(part);
  assert.ok(near(corner(data,0,0),corner(data,1,1)));
  assert.ok(corner(data,0)[1]>0);assert.ok(corner(data,0)[2]>.98);
});
test('coincident but disconnected vertices are never welded or averaged',()=>{
  const part={vertices:[[0,0,0],[1,0,0],[0,1,0],[1,0,0],[0,0,0],[0,-1,.2]],faces:[[0,1,2],[3,4,5]]};
  const data=frameSurfaceAttributes(part);
  assert.deepEqual(corner(data,0),[0,0,1]);assert.ok(corner(data,1)[1]>.19);
});
test('coplanar triangulation stays uniformly flat even beside narrow side triangles',()=>{
  const part={vertices:[[0,0,0],[5,0,0],[5,2,0],[0,2,0],[5,0,.01]],faces:[[0,1,2],[0,2,3],[1,4,2]]};
  const data=frameSurfaceAttributes(part);
  for(let face=0;face<2;face++)for(let i=0;i<3;i++)assert.deepEqual(corner(data,face,i),[0,0,1]);
});
test('invalid geometry fails clearly and degenerate faces do not create NaNs',()=>{
  assert.throws(()=>frameSurfaceAttributes({vertices:[[0,0,0]],faces:[[0,1,2]]}),/Invalid/);
  const data=frameSurfaceAttributes({vertices:[[0,0,0],[1,0,0]],faces:[[0,0,1]]});
  assert.ok(Array.from(data.normals).every(Number.isFinite));
});
const THREE={FrontSide:0,SRGBColorSpace:'srgb',ACESFilmicToneMapping:4,
  MeshBasicMaterial:class {constructor(options){this.options=options;this.kind='basic';}},
  MeshStandardMaterial:class {constructor(options){this.options=options;this.kind='standard';}},
  BufferAttribute:class {constructor(array,size){this.array=array;this.itemSize=size;}},
  BufferGeometry:class {constructor(){this.attributes={};}setAttribute(name,value){this.attributes[name]=value;}}};
test('frames use satin dielectric material, lenses stay faint without depth writes or double faces',()=>{
  const frame=createFrameMaterial(THREE,{kind:'frame'});
  assert.equal(frame.kind,'standard');assert.equal(frame.options.metalness,0);assert.equal(frame.options.roughness,.52);
  const preview=createFrameMaterial(THREE,{kind:'lens'}),tryon=createFrameMaterial(THREE,{kind:'lens'},{tryOn:true});
  assert.equal(tryon.kind,'basic');assert.equal(tryon.options.depthWrite,false);assert.equal(tryon.options.side,THREE.FrontSide);
  assert.ok(tryon.options.opacity<preview.options.opacity);assert.ok(tryon.options.opacity<.05);
  assert.equal(tryon.options.toneMapped,false);
});
test('geometry factory supplies crease normals directly and renderer uses consistent color mapping',()=>{
  const geometry=createFrameGeometry(THREE,{vertices:[[0,0,0],[1,0,0],[0,1,0]],faces:[[0,1,2]]});
  assert.equal(geometry.attributes.normal.array.length,9);assert.equal(geometry.attributes.position.itemSize,3);
  const renderer={};configureFrameRenderer(THREE,renderer);
  assert.equal(renderer.outputColorSpace,THREE.SRGBColorSpace);assert.equal(renderer.toneMapping,THREE.ACESFilmicToneMapping);
});
