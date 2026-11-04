import * as THREE from "three";

/** Canvas size. 64px is plenty for a gradient that is only ever seen soft. */
const SIZE = 64;

/**
 * A soft dark disc on a transparent ground: the drop shadow under a block.
 * Drawn rather than loaded — a 64px canvas costs nothing in a bundle where
 * every asset byte is base64. Radial alpha so the edge is a falloff, not a
 * rim, which is what "soft" means from this camera.
 */
export function softShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d canvas context");
  const half = SIZE / 2;
  const fade = ctx.createRadialGradient(half, half, half * 0.35, half, half, half);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
