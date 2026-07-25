import { access, readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { JSDOM } from "jsdom";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

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

function resolveLocalReference(fromFile, reference) {
  assert(reference && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference), `remote reference in ${fromFile}: ${reference}`);
  const cleanReference = reference.split(/[?#]/, 1)[0];
  const target = resolve(dist, dirname(fromFile), cleanReference);
  const targetRelative = relative(dist, target);
  assert(!isAbsolute(targetRelative) && targetRelative !== ".." && !targetRelative.startsWith(`..${sep}`), `reference escapes dist in ${fromFile}: ${reference}`);
  return targetRelative.split(sep).join("/");
}

const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(JSON.stringify(manifest.permissions) === JSON.stringify(["sidePanel", "tabs", "storage"]), "permissions must be exactly sidePanel, tabs, storage");
assert(!Object.hasOwn(manifest, "host_permissions"), "host_permissions must not be present");
assert(!Object.hasOwn(manifest, "content_scripts"), "content_scripts must not be present");
assert(manifest.minimum_chrome_version === "114", "minimum_chrome_version must be 114");
assert(manifest.content_security_policy?.extension_pages === "script-src 'self'; object-src 'self'", "extension page CSP must allow self only");

for (const path of requiredFiles) {
  await access(resolve(dist, path));
}

const manifestPaths = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
];
for (const path of manifestPaths) {
  assert(typeof path === "string" && path.length > 0, "manifest contains an invalid file reference");
  await access(resolve(dist, path));
}

const files = await listFiles(dist);
for (const htmlPath of files.filter((path) => path.endsWith(".html"))) {
  const html = await readFile(resolve(dist, htmlPath), "utf8");
  const document = new JSDOM(html).window.document;
  for (const script of document.querySelectorAll("script")) {
    assert(script.type === "module", `script must be a module in ${htmlPath}`);
    assert(script.src.length > 0, `inline script is forbidden in ${htmlPath}`);
    assert(script.textContent?.trim() === "", `inline script content is forbidden in ${htmlPath}`);
    await access(resolve(dist, resolveLocalReference(htmlPath, script.getAttribute("src"))));
  }
  for (const link of document.querySelectorAll("link[href]")) {
    await access(resolve(dist, resolveLocalReference(htmlPath, link.getAttribute("href"))));
  }
}

const forbiddenJavaScript = [
  [/\beval\s*\(/, "eval"],
  [/\bnew\s+Function\s*\(/, "new Function"],
  [/\bfetch\s*\(\s*["'`]\s*https?:/i, "remote fetch"],
  [/\bimport\s*\(\s*["'`]\s*https?:/i, "remote dynamic import"],
  [/\bnew\s+WebSocket\s*\(\s*["'`]\s*(?:wss?|https?):/i, "remote WebSocket"],
];
for (const javascriptPath of files.filter((path) => path.endsWith(".js"))) {
  const source = await readFile(resolve(dist, javascriptPath), "utf8");
  for (const [pattern, description] of forbiddenJavaScript) {
    assert(!pattern.test(source), `${description} is forbidden in ${javascriptPath}`);
  }
}

const pngSizes = new Map([
  ["assets/icons/icon-16.png", 16],
  ["assets/icons/icon-32.png", 32],
  ["assets/icons/icon-48.png", 48],
  ["assets/icons/icon-128.png", 128],
  ["assets/shortcuts/openai.png", 32],
  ["assets/shortcuts/google.png", 32],
  ["assets/shortcuts/github.png", 32],
]);
for (const [path, expectedSize] of pngSizes) {
  const metadata = await sharp(resolve(dist, path)).metadata();
  assert(metadata.format === "png", `${path} must be PNG`);
  assert(metadata.width === expectedSize && metadata.height === expectedSize, `${path} must be ${expectedSize}x${expectedSize}`);
}

let totalBytes = 0;
for (const path of files) {
  totalBytes += (await stat(resolve(dist, path))).size;
}
assert(totalBytes <= 300_000, `dist exceeds 300000 bytes: ${totalBytes}`);
console.log(`dist check passed: ${totalBytes} bytes`);
