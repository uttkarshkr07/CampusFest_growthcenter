// Runs after the OpenNext build. A build can report success and still produce a Worker whose
// server cannot load any page code. Fail here instead of finding out on the live site.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const handler = readFileSync(path.join(root, ".open-next/server-functions/default/handler.mjs"), "utf8");
const cases = (handler.match(/case ?"server\/chunks\//g) ?? []).length;
if (!cases) {
  console.error("check-chunks: STOP, the server bundle includes no page chunks. Every request would fail.");
  process.exit(1);
}
console.log(`check-chunks: ${cases} server chunk entries in the bundle.`);
