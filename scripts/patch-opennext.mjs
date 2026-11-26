// Runs before a local OpenNext build.
// @opennextjs/cloudflare finds Turbopack's server chunks by looking for ".next/server/chunks/"
// in file paths. On Windows those paths use backslashes, so it finds none: the build reports
// success, but the Worker answers every request with a 500 (ChunkLoadError). This makes the
// plugin use forward slashes. It changes nothing on Linux (including Cloudflare's builds).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "node_modules/@opennextjs/cloudflare/dist/cli/build/patches/plugins/turbopack.js");
const anchor = "patchCode: async ({ code, tracedFiles, filePath }) => {";
const marker = "/* windows-paths-patch */";
const fix = `${anchor}\n                ${marker} tracedFiles = tracedFiles.map((f) => f.replaceAll("\\\\", "/")); filePath = filePath.replaceAll("\\\\", "/");`;

const source = readFileSync(file, "utf8");
if (source.includes(marker)) {
  console.log("patch-opennext: already applied.");
} else if (source.split(anchor).length === 2) {
  writeFileSync(file, source.replace(anchor, () => fix));
  console.log("patch-opennext: applied the Windows path fix.");
} else {
  console.error("patch-opennext: the adapter's code has changed. Check whether the fix is still needed.");
  process.exit(1);
}
