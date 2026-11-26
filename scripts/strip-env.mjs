// Runs between the OpenNext build and the deploy.
// OpenNext copies every value from the local .env files into the Worker bundle
// (.open-next/cloudflare/next-env.mjs). Only NEXT_PUBLIC_ values may go there. Server secrets
// (service role key, model key) must never ship: the Worker reads them from Cloudflare secrets.
// This removes them, then fails the deploy if any secret value is still anywhere in the build.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, ".open-next");
const target = path.join(buildDir, "cloudflare", "next-env.mjs");
const isPublic = (name) => name.startsWith("NEXT_PUBLIC_");

if (!existsSync(target)) {
  console.error("strip-env: .open-next/cloudflare/next-env.mjs not found. Build first.");
  process.exit(1);
}

// 1. rewrite the generated file with public values only
const generated = await import(`data:text/javascript,${encodeURIComponent(readFileSync(target, "utf8"))}`);
const removed = new Set();
const cleaned = Object.entries(generated)
  .map(([mode, values]) => {
    const kept = Object.entries(values).filter(([name]) => isPublic(name) || !removed.add(name));
    return `export const ${mode} = ${JSON.stringify(Object.fromEntries(kept))};\n`;
  })
  .join("");
writeFileSync(target, cleaned);

// 2. check the whole build for the value of any non-public variable in a local env file
const secrets = new Map();
for (const file of readdirSync(root).filter((f) => f === ".dev.vars" || f === ".env" || (f.startsWith(".env.") && f !== ".env.example"))) {
  for (const line of readFileSync(path.join(root, file), "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || isPublic(match[1])) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    // short values (model names are longer and not secret) cannot be told apart from ordinary text
    if (/KEY|SECRET|TOKEN|PASSWORD/.test(match[1]) && value.length >= 8) secrets.set(match[1], Buffer.from(value));
  }
}
const leaks = [];
for (const entry of readdirSync(buildDir, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const file = path.join(entry.parentPath, entry.name);
  const content = readFileSync(file);
  for (const [name, value] of secrets) if (content.includes(value)) leaks.push(`${name} in ${path.relative(root, file)}`);
}

console.log(`strip-env: removed from the bundle: ${[...removed].join(", ") || "nothing"}`);
if (leaks.length) {
  console.error(`strip-env: STOP, secret values are still in the build:\n  ${leaks.join("\n  ")}`);
  process.exit(1);
}
console.log(`strip-env: checked ${secrets.size} secret value(s); none are in the build.`);
