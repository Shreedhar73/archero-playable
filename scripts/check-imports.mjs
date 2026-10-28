// Relative imports must carry their file extension. tsc and Vite both tolerate
// an extensionless specifier; Node's ESM loader does not, and src/game/ is run
// directly by Node for the headless tests. A convention nobody can enforce by
// eye is one the build should check.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const RELATIVE = /from\s+"(\.[^"]*)"/g;
const HAS_EXTENSION = /\.[a-z0-9]+$/i;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const problems = [];
for (const file of walk(ROOT).filter((f) => f.endsWith(".ts"))) {
  const source = readFileSync(file, "utf8");
  for (const [, specifier] of source.matchAll(RELATIVE)) {
    if (!HAS_EXTENSION.test(specifier)) {
      const line = source.slice(0, source.indexOf(`"${specifier}"`)).split("\n").length;
      problems.push(`${file}(${line}): relative import needs an extension: "${specifier}"`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} import(s) missing an extension.`);
  process.exit(1);
}
