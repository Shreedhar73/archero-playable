import * as THREE from "three";

/** 64px is enough for a gradient only ever seen soft. */
const SIZE = 64;

/** Soft dark disc on a transparent ground: the drop shadow under a block. */
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

/** Toon cloud: four soft white discs overlapping into one lobed shape. */
export function cloudTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d canvas context");
  const lobes: [number, number, number][] = [
    [0.5, 0.55, 0.3],
    [0.3, 0.6, 0.22],
    [0.7, 0.6, 0.22],
    [0.5, 0.36, 0.22],
  ];
  for (const [x, y, r] of lobes) {
    const fade = ctx.createRadialGradient(x * SIZE, y * SIZE, r * SIZE * 0.6, x * SIZE, y * SIZE, r * SIZE);
    fade.addColorStop(0, "rgba(255,255,255,1)");
    fade.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
