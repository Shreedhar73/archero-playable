/**
 * Pulls the textures embedded in a binary FBX back out as image files.
 *
 * Mixamo's "With Skin" downloads carry their textures inside the FBX as
 * `Content` property records, and three's FBXLoader does not unpack them: every
 * material comes back with `map.image === null`, which GLTFExporter then
 * refuses with "No valid image data found". The bytes are right there, so they
 * are read directly instead.
 *
 * A binary FBX property is a one-byte type code followed by its payload; `R`
 * (0x52) is raw bytes, length-prefixed with a uint32. Each `Content` record is
 * preceded, in the same Video node, by the `RelativeFilename` the artist used,
 * which is the only name these images have.
 *
 *   node scripts/extract-fbx-textures.mjs "assets/raw/Erika Archer With Bow Arrow.fbx" <out-dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAW = 0x52; // 'R'

/** Every `Content` record in the file, in the order they appear. */
export function extractTextures(fbxPath) {
  const data = readFileSync(fbxPath);
  const found = [];
  let at = 0;
  for (;;) {
    at = data.indexOf("Content", at);
    if (at === -1) break;
    const typeAt = at + "Content".length;
    at = typeAt;
    if (data[typeAt] !== RAW) continue;
    const length = data.readUInt32LE(typeAt + 1);
    // Zero-length Content records exist for textures the exporter left out.
    if (length === 0 || typeAt + 5 + length > data.length) continue;
    const bytes = data.subarray(typeAt + 5, typeAt + 5 + length);
    found.push({ name: nameBefore(data, at), bytes });
    at = typeAt + 5 + length;
  }
  return found;
}

/**
 * The image filename nearest above an offset. Scanning backwards rather than
 * parsing the node tree: the filename and its Content live in the same Video
 * node, so the nearest one above is always the right one, and a full FBX
 * parser is a lot of code for one string.
 */
function nameBefore(data, offset) {
  const window = data.subarray(Math.max(0, offset - 4096), offset).toString("latin1");
  const matches = [...window.matchAll(/[\w\-. ]+\.(?:png|jpe?g|tga|dds)/gi)];
  if (matches.length === 0) return null;
  return basename(matches[matches.length - 1][0].replace(/\\/g, "/"));
}

// Standalone since the merge moved into headless Chromium: fbx-merge.mjs gets
// the textures through FBXLoader's blob URLs and no longer needs extracting.
// Kept because it is the only way to see what a Mixamo FBX actually carries.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [input, outDir] = process.argv.slice(2);
  if (!input || !outDir) {
    console.error('usage: node scripts/extract-fbx-textures.mjs "<in.fbx>" <out-dir>');
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const textures = extractTextures(input);
  for (const [index, texture] of textures.entries()) {
    // Fall back to the record's index when no filename sits above it, so a
    // nameless image is still written rather than silently dropped.
    const name = texture.name ?? `texture_${index}.bin`;
    writeFileSync(join(outDir, name), texture.bytes);
    const kind = texture.bytes.subarray(0, 4).toString("hex").startsWith("89504e47")
      ? "png"
      : "jpeg";
    console.log(`  ${name.padEnd(36)} ${(texture.bytes.length / 1024).toFixed(0).padStart(5)} KB  ${kind}`);
  }
  console.log(`${textures.length} textures from ${basename(input)} -> ${outDir}`);
}
