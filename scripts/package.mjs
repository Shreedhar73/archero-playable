/**
 * Turns dist/<network>/ into the file the network accepts, and fails if it is
 * over that network's cap. Runs after `vite build --mode <network>`.
 *
 *   generic   dist/generic.html  single HTML, 5 MB (no network; plain hosting)
 *   meta      dist/meta.html     single HTML, 2 MB
 *   google    dist/google.zip    index.html at the zip root, 5 MB
 *   applovin  dist/applovin.html single HTML (MRAID 2.0), 5 MB
 *
 * Caps are decimal megabytes: the specs say "MB" without saying which, and
 * the smaller reading costs nothing. Passing this gate is not a validated
 * creative — upload to the network's own validator.
 *
 *   node scripts/package.mjs meta
 */
import {
  copyFileSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const network = process.argv[2];

const MB = 1_000_000;

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function gate(path, cap) {
  const size = statSync(path).size;
  const line = `${relative(dist, path)}: ${(size / MB).toFixed(2)} MB of ${cap / MB} MB`;
  if (size > cap) {
    console.error(`FAIL ${line}`);
    process.exit(1);
  }
  console.log(`ok   ${line}`);
}

const out = join(dist, network);

function singleHtml(cap) {
  const files = filesUnder(out);
  if (files.length !== 1) {
    console.error(
      `FAIL ${network} must be ONE html file; build produced: ${files.map((f) => relative(out, f)).join(", ")}`,
    );
    process.exit(1);
  }
  const target = join(dist, `${network}.html`);
  copyFileSync(join(out, "index.html"), target);
  gate(target, cap);
}

if (network === "generic") {
  singleHtml(5 * MB);
} else if (network === "meta") {
  singleHtml(2 * MB);
} else if (network === "google") {
  // Lazy: fflate is only a dependency of projects that include google.
  const { zipSync } = await import("fflate");
  const entries = Object.fromEntries(
    filesUnder(out).map((f) => [relative(out, f), readFileSync(f)]),
  );
  const target = join(dist, "google.zip");
  writeFileSync(target, zipSync(entries, { level: 9 }));
  gate(target, 5 * MB);
} else if (network === "applovin") {
  singleHtml(5 * MB);
} else {
  console.error("usage: node scripts/package.mjs <generic|meta|google|applovin>");
  process.exit(1);
}
