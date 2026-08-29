import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strFromU8, unzipSync, zipSync } from "fflate";
import {
  EXPECTED_FILES,
  assertExactReleaseFiles,
  safeReleasePath,
} from "./release-files.mjs";

const fixedMtime = new Date(2000, 0, 1, 0, 0, 0);

/**
 * 确认 ZIP 中每个审核文件与 dist 的源文件逐字节一致。
 *
 * Args:
 *   distDirectory: 已通过发布检查的 dist 目录。
 *   archive: 待验证的 ZIP 字节。
 * Returns:
 *   全部条目与字节一致时解决的 Promise。
 * Raises:
 *   条目集合或任一文件字节不一致时抛出发布错误。
 */
export async function verifyArchiveMatchesDist(distDirectory, archive) {
  const dist = resolve(distDirectory);
  const files = await assertExactReleaseFiles(dist);
  const unpacked = unzipSync(archive);
  const unpackedFiles = Object.keys(unpacked).sort();
  if (JSON.stringify(unpackedFiles) !== JSON.stringify(EXPECTED_FILES)) {
    throw new Error("ZIP entries do not match the expected release files");
  }
  for (const path of files) {
    const expected = new Uint8Array(await readFile(safeReleasePath(dist, path)));
    const actual = unpacked[path];
    if (
      actual.byteLength !== expected.byteLength
      || actual.some((byte, index) => byte !== expected[index])
    ) {
      throw new Error(`ZIP entry bytes do not match dist: ${path}`);
    }
  }
}

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

  await verifyArchiveMatchesDist(dist, archive);
  const unpacked = unzipSync(archive);
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
