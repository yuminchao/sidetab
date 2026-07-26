import { readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const EXPECTED_FILES = Object.freeze(
  [
    "THIRD_PARTY_NOTICES.md",
    "manifest.json",
    "background/service-worker.js",
    "sidepanel/index.html",
    "sidepanel/sidebar.css",
    "sidepanel/sidebar.js",
    "assets/icons/icon-16.png",
    "assets/icons/icon-32.png",
    "assets/icons/icon-48.png",
    "assets/icons/icon-128.png",
    "assets/icons/pin.svg",
  ].sort(),
);

export function safeReleasePath(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    isAbsolute(relativePath) ||
    /^[a-z][a-z\d+.-]*:/i.test(relativePath)
  ) {
    throw new Error(`invalid release path: ${relativePath}`);
  }

  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`invalid release path: ${relativePath}`);
  }

  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, relativePath);
  const targetRelative = relative(absoluteRoot, target);
  if (
    targetRelative === "" ||
    isAbsolute(targetRelative) ||
    targetRelative === ".." ||
    targetRelative.startsWith(`..${sep}`)
  ) {
    throw new Error(`release path escapes root: ${relativePath}`);
  }
  return target;
}

export async function listReleaseFiles(root, prefix = "") {
  const absoluteRoot = resolve(root);
  const directory = prefix ? safeReleasePath(absoluteRoot, prefix) : absoluteRoot;
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listReleaseFiles(absoluteRoot, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`unsupported release entry: ${relativePath}`);
    }
  }
  return files.sort();
}

export async function assertExactReleaseFiles(root) {
  const files = await listReleaseFiles(root);
  const expectedSet = new Set(EXPECTED_FILES);
  const missing = EXPECTED_FILES.filter((path) => !files.includes(path));
  const extra = files.filter((path) => !expectedSet.has(path));
  if (missing.length > 0) {
    throw new Error(`release is missing expected files: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    throw new Error(`release contains unexpected files: ${extra.join(", ")}`);
  }
  return files;
}
