import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const assets = await readdir("dist/assets");
let source = await readFile("public/sw.js", "utf8");
source = source
  .replace(
    /["']palate-shell-v1["']/,
    `'palate-shell-${createHash("sha256").update(assets.join()).digest("hex").slice(0, 12)}'`,
  )
  .replace(
    "const SHELL = [",
    `const SHELL = [${assets.map((a) => JSON.stringify("./assets/" + a)).join(",")},`,
  );
await writeFile("dist/sw.js", source);
