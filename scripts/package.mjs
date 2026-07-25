import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strFromU8, unzipSync, zipSync } from "fflate";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const release = resolve(root, "release");
const requiredFiles = [
  "manifest.json",
  "background/service-worker.js",
  "sidepanel/index.html",
  "sidepanel/sidebar.css",
  "sidepanel/sidebar.js",
  "assets/icons/icon-16.png",
  "assets/icons/icon-32.png",
  "assets/icons/icon-48.png",
  "assets/icons/icon-128.png",
  "assets/shortcuts/openai.png",
  "assets/shortcuts/google.png",
  "assets/shortcuts/github.png",
];

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(resolve(directory, entry.name), relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

const files = await listFiles(dist);
const zipEntries = {};
for (const path of files) {
  zipEntries[path] = new Uint8Array(await readFile(resolve(dist, path)));
}

const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error("dist manifest has an invalid version");
}

const archive = zipSync(zipEntries, { level: 9 });
await rm(release, { recursive: true, force: true });
await mkdir(release, { recursive: true });
const archivePath = resolve(release, `sidetab-lite-${manifest.version}.zip`);
await writeFile(archivePath, archive);

const unpacked = unzipSync(archive);
if (!Object.hasOwn(unpacked, "manifest.json")) {
  throw new Error("manifest.json must be at the ZIP root");
}
for (const path of requiredFiles) {
  if (!Object.hasOwn(unpacked, path)) {
    throw new Error(`ZIP is missing ${path}`);
  }
}
for (const path of Object.keys(unpacked)) {
  if (/^(?:dist|node_modules|src|tests|docs)\//.test(path) || path.endsWith(".map")) {
    throw new Error(`ZIP contains forbidden entry: ${path}`);
  }
}
const packagedManifest = JSON.parse(strFromU8(unpacked["manifest.json"]));
if (packagedManifest.version !== manifest.version) {
  throw new Error("ZIP manifest version does not match dist");
}

console.log(`package created: ${archivePath} (${archive.byteLength} bytes)`);
