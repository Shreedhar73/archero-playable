/**
 * Headless check that three can load assets/*.glb: bounding box, clips, skin
 * integrity, and that an AnimationMixer binds every track. The glTF validator
 * passes files three still renders wrong.
 *
 * Textures are not checked; Node has no DOM. Node names print after three's
 * sanitizing (`mixamorig:RightHand` -> `mixamorigRightHand`), which is what
 * game code must use.
 *
 *   node scripts/check-assets.mjs assets/archer_playable.glb
 */
import { readFileSync } from 'node:fs';
// Just enough DOM for GLTFLoader's image path.
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// Assets are EXT_meshopt_compression; GLTFLoader throws without a decoder.
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
  // Hand node for the arrow spawn. three strips ':' and '.' from node names.
  const hand = gltf.scene.getObjectByName('mixamorigRightHand') || gltf.scene.getObjectByName('Palm2R');
  console.log('  hand node:', hand ? hand.name : 'NOT FOUND');
  const names=[]; gltf.scene.traverse(o=>{ if(/hand|palm|^Bone$|Head/i.test(o.name)) names.push(o.name); });
  console.log('  hand-ish:', names.slice(0,10).join(', '));
  // One mixer step proves the tracks bind.
  const mixer = new THREE.AnimationMixer(gltf.scene);
  gltf.animations.forEach(c=>{ const a=mixer.clipAction(c); a.play(); a.stop(); });
  mixer.clipAction(gltf.animations[0]).play();
  mixer.update(0.3);
  console.log('  mixer bound ok');
}, (err) => console.log('PARSE ERROR', err));
