import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { packageDist } from "../../scripts/package.mjs";

const projectRoot = process.argv[2];
if (!projectRoot) {
  throw new Error("package-release helper requires a project root");
}

const result = await packageDist(resolve(projectRoot));
const archive = await readFile(result.archivePath);
console.log(createHash("sha256").update(archive).digest("hex"));
