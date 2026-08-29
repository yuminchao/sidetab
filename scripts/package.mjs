import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  const entryNames = readZipEntryNames(archive);
  if (entryNames.some((name, index) => entryNames.indexOf(name) !== index)) {
    throw new Error("ZIP contains duplicate entry names");
  }
  const unpacked = unzipSync(archive);
  const unpackedFiles = [...entryNames].sort();
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

/**
 * 写入归档后重新读取实际字节，并对内存与落盘内容执行发布校验。
 *
 * Args:
 *   archivePath: 要写入的精确归档路径。
 *   archive: 待写入的 ZIP 字节。
 *   distDirectory: 用于逐字节比对的 dist 目录。
 *   options: 可选的文件 I/O 函数，用于隔离测试中的持久化故障。
 * Returns:
 *   重新读取并验证通过的归档字节。
 * Raises:
 *   任一校验或文件 I/O 失败时删除精确目标并重新抛出原错误。
 */
export async function persistAndVerifyArchive(archivePath, archive, distDirectory, options = {}) {
  const write = options.write ?? writeFile;
  const read = options.read ?? readFile;
  const remove = options.remove ?? ((path) => rm(path, { force: true }));
  try {
    await verifyArchiveMatchesDist(distDirectory, archive);
    await write(archivePath, archive);
    const persisted = new Uint8Array(await read(archivePath));
    await verifyArchiveMatchesDist(distDirectory, persisted);
    return persisted;
  } catch (error) {
    try {
      await remove(archivePath);
    } catch {
      // Preserve the verification or write failure without exposing cleanup details.
    }
    throw error;
  }
}

/**
 * 解析 ZIP 中央目录并返回每个条目的名称。
 *
 * Args:
 *   archive: ZIP 文件字节。
 * Returns:
 *   按中央目录顺序排列的条目名称。
 * Raises:
 *   ZIP 结束记录或中央目录结构损坏时抛出归档错误。
 */
function readZipEntryNames(archive) {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let endOffset = -1;
  for (let index = archive.byteLength - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) throw new Error("ZIP end record is missing");
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const centralEnd = centralOffset + centralSize;
  if (centralEnd > endOffset || centralOffset < 0) throw new Error("ZIP central directory is invalid");
  const decoder = new TextDecoder();
  const names = [];
  let offset = centralOffset;
  while (offset < centralEnd) {
    if (offset + 46 > centralEnd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("ZIP central directory is invalid");
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > centralEnd) throw new Error("ZIP central directory is invalid");
    names.push(decoder.decode(archive.slice(offset + 46, offset + 46 + nameLength)));
    offset = recordEnd;
  }
  if (offset !== centralEnd || names.length !== entryCount) {
    throw new Error("ZIP central directory entry count is invalid");
  }
  return names;
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
  const persistedArchive = await persistAndVerifyArchive(archivePath, archive, dist);
  const unpacked = unzipSync(persistedArchive);
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
