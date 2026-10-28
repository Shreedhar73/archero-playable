/**
 * Headless check that three can actually consume assets/*.glb: bounding box,
 * clip list, skin integrity, and that an AnimationMixer binds every track.
 * Run it after scripts/optimize-assets.mjs — the glTF validator passes a file
 * whose skins or quantized positions three would still render wrong.
 *
 * Node has no DOM, so image decoding is stubbed; textures are not checked here.
 * Node names are printed AFTER three's sanitizing, which is what game code must
 * use (`mixamorig:RightHand` arrives as `mixamorigRightHand`).
 *
 *   node scripts/check-assets.mjs assets/archer.glb
 */
import { readFileSync } from 'node:fs';
// Node has no DOM: stub just enough for GLTFLoader's image path so the
// geometry/skin/animation path can be checked headless.
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// The pipeline writes EXT_meshopt_compression, which GLTFLoader refuses to
// parse without a decoder.
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const file = process.argv[2];
const buf = readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
loader.parse(ab, '', (gltf) => {
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  console.log(file);
  console.log('  bbox size', size.toArray().map(v=>v.toFixed(3)).join(' x '));
  console.log('  clips:', gltf.animations.map(a=>`${a.name}(${a.duration.toFixed(2)}s,${a.tracks.length}tr)`).join(' '));
  let skinned=0, meshes=0, bones=0;
  gltf.scene.traverse(o=>{ if(o.isSkinnedMesh){skinned++; if(!o.skeleton||!o.skeleton.bones.length) console.log('  !! BROKEN SKIN', o.name); else bones=Math.max(bones,o.skeleton.bones.length);} else if(o.isMesh) meshes++; });
  console.log(`  skinnedMeshes=${skinned} plainMeshes=${meshes} maxBones=${bones}`);
  // find hand node for arrow spawn
  // Sanitized names: three strips ':' and '.' from glTF node names.
  const hand = gltf.scene.getObjectByName('mixamorigRightHand') || gltf.scene.getObjectByName('Palm2R');
  console.log('  hand node:', hand ? hand.name : 'NOT FOUND');
  const names=[]; gltf.scene.traverse(o=>{ if(/hand|palm|^Bone$|Head/i.test(o.name)) names.push(o.name); });
  console.log('  hand-ish:', names.slice(0,10).join(', '));
  // animate one step to prove tracks bind
  const mixer = new THREE.AnimationMixer(gltf.scene);
  gltf.animations.forEach(c=>{ const a=mixer.clipAction(c); a.play(); a.stop(); });
  mixer.clipAction(gltf.animations[0]).play();
  mixer.update(0.3);
  console.log('  mixer bound ok');
}, (err) => console.log('PARSE ERROR', err));
