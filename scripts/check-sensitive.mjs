import { readdir, readFile, stat } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const requiredFiles = [
  "manifest.json",
  "package.json",
  "package-lock.json",
  "README.md",
  "update.log",
  "docs/privacy-policy.md",
  "docs/chrome-web-store-checklist.md",
];
const requiredDirectories = ["src", "scripts"];
const excludedPaths = new Set(["scripts/check-sensitive.mjs"]);
const placeholderValues = /^(?:|placeholder|example|sample|dummy|fake|test|changeme|redacted|none|null|undefined|<[^>]+>)$/i;
const credentialAssignment = /\b(password|passwd|secret|api[_-]?key|client[_-]?secret|access[_-]?token|private[_-]?key|token)\b\s*[:=]\s*(["'`])([^"'`\r\n]+)\2/giu;
const signalPatterns = [
  {
    category: "github-token",
    expression: /\b(?:github_pat_[A-Za-z0-9_]{8,}|ghp_[A-Za-z0-9]{8,})\b/g,
  },
  {
    category: "private-key",
    expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    category: "email",
    expression: /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi,
    allow: (match) => /^(?:example\.(?:com|org|net)|example\.invalid)$/i.test(match[1]),
  },
  {
    category: "mainland-phone",
    expression: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
  },
  {
    category: "mainland-id",
    expression: /(?<!\d)[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g,
  },
  {
    category: "internal-endpoint",
    expression: /\bhttps?:\/\/(?:(?:(?:[a-z\d-]+\.)*(?:internal|corp|lan|local))(?=[:/?#]|$)|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?(?:[/?#][^\s"'`]*)?/gi,
    allow: (match) => /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(match[0]),
  },
  {
    category: "company-identifier",
    expression: /[\p{L}\p{N}（）()·&.\-]{2,}(?:有限公司|股份有限公司)/gu,
  },
];

/**
 * 扫描发布源文件和用户可见发布文档中的敏感信息。
 *
 * Args:
 *   projectRoot: 项目根目录。
 * Returns:
 *   仅包含类别与文件位置的发现项，不包含命中的敏感值。
 * Raises:
 *   必需扫描目标缺失或文件无法读取时抛出原始错误。
 */
export async function scanSensitiveInformation(projectRoot) {
  const root = resolve(projectRoot);
  const files = [...requiredFiles];
  for (const directory of requiredDirectories) {
    files.push(...(await listFiles(root, directory)));
  }
  const findings = [];
  for (const path of [...new Set(files)].sort()) {
    if (excludedPaths.has(path)) continue;
    const source = await readFile(resolve(root, ...path.split("/")), "utf8");
    for (const match of source.matchAll(credentialAssignment)) {
      if (placeholderValues.test(match[3].trim())) continue;
      const location = getLocation(source, match.index);
      findings.push({ category: "credential-assignment", path, ...location });
    }
    for (const pattern of signalPatterns) {
      for (const match of source.matchAll(pattern.expression)) {
        if (pattern.allow?.(match)) continue;
        findings.push({ category: pattern.category, path, ...getLocation(source, match.index) });
      }
    }
  }
  return findings.sort(
    (left, right) => left.path.localeCompare(right.path)
      || left.line - right.line
      || left.column - right.column
      || left.category.localeCompare(right.category),
  );
}

async function listFiles(root, prefix) {
  const directory = resolve(root, ...prefix.split("/"));
  const metadata = await stat(directory);
  if (!metadata.isDirectory()) throw new Error(`sensitive scan target is not a directory: ${prefix}`);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function getLocation(source, index) {
  const before = source.slice(0, index);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function isMain(moduleUrl) {
  return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === moduleUrl;
}

if (isMain(import.meta.url)) {
  const projectRoot = resolve(process.argv[2] ?? import.meta.dirname, process.argv[2] ? "" : "..");
  const findings = await scanSensitiveInformation(projectRoot);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.path}:${finding.line}:${finding.column} [${finding.category}]`);
    }
    console.error(`sensitive information check failed: ${findings.length} finding(s)`);
    process.exitCode = 1;
  } else {
    console.log("sensitive information check passed: 0 findings");
  }
}
