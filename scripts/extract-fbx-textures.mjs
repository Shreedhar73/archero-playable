/**
 * Pulls the textures embedded in a binary FBX out as image files.
 *
 * Mixamo "With Skin" downloads embed textures as `Content` property records.
 * A binary FBX property is a one-byte type code and its payload; `R` (0x52) is
 * raw bytes with a uint32 length prefix. The `RelativeFilename` in the same
 * Video node is the only name the image has.
 *
 *   node scripts/extract-fbx-textures.mjs "assets/raw/Erika Archer With Bow Arrow.fbx" <out-dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAW = 0x52; // 'R'

/** Every `Content` record in file order. */
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
    // Zero-length records exist for textures the exporter left out.
    if (length === 0 || typeAt + 5 + length > data.length) continue;
    const bytes = data.subarray(typeAt + 5, typeAt + 5 + length);
    found.push({ name: nameBefore(data, at), bytes });
    at = typeAt + 5 + length;
  }
  return found;
}

/**
 * Nearest image filename above an offset. The filename and its Content share a
 * Video node, so a backwards scan beats parsing the tree.
 */
function nameBefore(data, offset) {
  const window = data.subarray(Math.max(0, offset - 4096), offset).toString("latin1");
  const matches = [...window.matchAll(/[\w\-. ]+\.(?:png|jpe?g|tga|dds)/gi)];
  if (matches.length === 0) return null;
  return basename(matches[matches.length - 1][0].replace(/\\/g, "/"));
}

// Standalone tool; fbx-merge.mjs gets textures through FBXLoader's blob URLs.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [input, outDir] = process.argv.slice(2);
  if (!input || !outDir) {
    console.error('usage: node scripts/extract-fbx-textures.mjs "<in.fbx>" <out-dir>');
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const textures = extractTextures(input);
  for (const [index, texture] of textures.entries()) {
    // Nameless images get the record index rather than being dropped.
    const name = texture.name ?? `texture_${index}.bin`;
    writeFileSync(join(outDir, name), texture.bytes);
    const kind = texture.bytes.subarray(0, 4).toString("hex").startsWith("89504e47")
      ? "png"
      : "jpeg";
    console.log(`  ${name.padEnd(36)} ${(texture.bytes.length / 1024).toFixed(0).padStart(5)} KB  ${kind}`);
  }
  console.log(`${textures.length} textures from ${basename(input)} -> ${outDir}`);
}
