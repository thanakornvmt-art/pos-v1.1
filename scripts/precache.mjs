import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const files = [];
function walk(path) {
  for (const e of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, e.name);
    if (e.isDirectory()) walk(p);
    else
      files.push("/" + p.replaceAll("\\", "/").replace(/^\.next\//, "_next/"));
  }
}
walk(".next/static");
const version = readFileSync(".next/BUILD_ID", "utf8").trim();
writeFileSync(
  "public/sw-assets.js",
  `self.POS_ASSETS=${JSON.stringify({ version, files })};\n`,
);
console.log(`Offline precache prepared: ${files.length} assets`);
