import * as THREE from "three";

/** Canvas size for the checker. One square per 32px; 64 is the smallest that
 *  tiles seamlessly with two squares per axis. */
const SIZE = 64;

/**
 * A two-tone checker drawn into a canvas and tiled across a surface.
 * Procedural on purpose: the bundle is base64 under a 5 MB cap, and a drawn
 * texture costs nothing but the code that draws it.
 */
export function checkerTexture(
  light: string,
  dark: string,
  repeatX: number,
  repeatY: number,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;

  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d canvas context");

  const half = SIZE / 2;
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, half, half);
  ctx.fillRect(half, half, half, half);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  // Crisp squares, not a blurred gradient: this is a pattern, not a photo.
  texture.magFilter = THREE.NearestFilter;
  // Colours picked by eye are sRGB. Without this they render washed out,
  // because three works in linear space and converts only at the end.
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Wooden planks with a dark border, for crates. Drawn rather than loaded: a
 * 64px canvas costs nothing in a bundle where every asset byte is base64.
 */
export function plankTexture(
  base: string,
  line: string,
  edge: string,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;

  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d canvas context");

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Three planks, drawn as the gaps between them.
  ctx.fillStyle = line;
  for (let i = 1; i < 3; i++) {
    ctx.fillRect(0, (SIZE / 3) * i - 1, SIZE, 2);
  }

  // Dark border reads as the box's edge from any distance, which is what
  // gives these the toon look the references have.
  ctx.strokeStyle = edge;
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, SIZE, SIZE);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
