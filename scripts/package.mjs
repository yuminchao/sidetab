import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strFromU8, unzipSync, zipSync } from "fflate";
import {
  EXPECTED_FILES,
  assertExactReleaseFiles,
  safeReleasePath,
} from "./release-files.mjs";

const fixedMtime = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));

export async function packageDist(projectRoot) {
  const root = resolve(projectRoot);
  const dist = resolve(root, "dist");
  const release = resolve(root, "release");
  const files = await assertExactReleaseFiles(dist);
  const zipEntries = {};
  const fileContents = new Map();

  for (const path of files) {
    const contents = new Uint8Array(await readFile(safeReleasePath(dist, path)));
    fileContents.set(path, contents);
    zipEntries[path] = [contents, { level: 9, mtime: fixedMtime }];
  }

  const manifest = JSON.parse(strFromU8(fileContents.get("manifest.json")));
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error("dist manifest has an invalid version");
  }

  const archive = zipSync(zipEntries, { level: 9 });
  await mkdir(release, { recursive: true });
  const archivePath = safeReleasePath(release, `sidetab-lite-${manifest.version}.zip`);
  await writeFile(archivePath, archive);

  const unpacked = unzipSync(archive);
  const unpackedFiles = Object.keys(unpacked).sort();
  if (JSON.stringify(unpackedFiles) !== JSON.stringify(EXPECTED_FILES)) {
    throw new Error("ZIP entries do not match the expected release files");
  }
  const packagedManifest = JSON.parse(strFromU8(unpacked["manifest.json"]));
  if (packagedManifest.version !== manifest.version) {
    throw new Error("ZIP manifest version does not match dist");
  }

  return { archivePath, bytes: archive.byteLength };
}

function isMain(moduleUrl) {
  return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === moduleUrl;
}

if (isMain(import.meta.url)) {
  const root = resolve(import.meta.dirname, "..");
  const result = await packageDist(root);
  console.log(`package created: ${result.archivePath} (${result.bytes} bytes)`);
}
