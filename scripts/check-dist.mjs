import { readFile, stat } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseJavaScript } from "acorn";
import { simple as walkJavaScript } from "acorn-walk";
import { JSDOM } from "jsdom";
import { parse as parseHtml } from "parse5";
import sharp from "sharp";
import { validateCss } from "./release-css.mjs";
import {
  EXPECTED_FILES,
  assertExactReleaseFiles,
  safeReleasePath,
} from "./release-files.mjs";

const expectedFileSet = new Set(EXPECTED_FILES);
const expectedManifestKeys = [
  "action",
  "background",
  "content_security_policy",
  "description",
  "icons",
  "manifest_version",
  "minimum_chrome_version",
  "name",
  "permissions",
  "side_panel",
  "version",
].sort();
const expectedCspDirectives = new Map([
  ["connect-src", ["'none'"]],
  ["frame-src", ["'none'"]],
  ["img-src", ["'self'", "data:", "http:", "https:"].sort()],
  ["object-src", ["'self'"]],
  ["script-src", ["'self'"]],
  ["style-src", ["'self'"]],
]);
const forbiddenJavaScriptApis = new Set([
  "eval",
  "Function",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "sendBeacon",
  "Image",
]);
const forbiddenHtmlElements = new Set(["iframe", "object", "embed"]);
const htmlUrlAttributes = new Set([
  "action",
  "data",
  "formaction",
  "href",
  "poster",
  "src",
  "xlink:href",
]);
const pngSizes = new Map([
  ["assets/icons/icon-16.png", 16],
  ["assets/icons/icon-32.png", 32],
  ["assets/icons/icon-48.png", 48],
  ["assets/icons/icon-128.png", 128],
]);
const sanitizedSvgPaths = new Map([
  ["assets/icons/network.svg", 1],
  ["assets/icons/search.svg", 1],
  ["assets/icons/settings.svg", 1],
]);
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateSanitizedSvg(svgPath, source, expectedPathCount) {
  assert(!/^\s*<\?xml\b/.test(source), `forbidden SVG XML declaration in ${svgPath}`);

  let document;
  try {
    document = new JSDOM(source, { contentType: "image/svg+xml" }).window.document;
  } catch (cause) {
    throw new Error(`invalid SVG content in ${svgPath}`, { cause });
  }

  const root = document.documentElement;
  const documentNodes = Array.from(document.childNodes);
  assert(
    documentNodes.every(
      (node) => node === root || (node.nodeType === 3 && !node.textContent?.trim()),
    ),
    `forbidden SVG document node in ${svgPath}`,
  );
  assert(root.tagName === "svg" && root.namespaceURI === SVG_NAMESPACE, `SVG namespace is missing in ${svgPath}`);
  assert(
    JSON.stringify(root.getAttributeNames().sort()) === JSON.stringify(["viewBox", "xmlns"]),
    `forbidden SVG root attribute in ${svgPath}`,
  );
  assert(root.getAttribute("xmlns") === SVG_NAMESPACE, `invalid SVG namespace in ${svgPath}`);
  assert(Boolean(root.getAttribute("viewBox")?.trim()), `SVG viewBox is missing in ${svgPath}`);

  const paths = Array.from(root.children);
  assert(
    paths.length === expectedPathCount &&
      paths.every((path) => path.tagName === "path" && path.namespaceURI === SVG_NAMESPACE),
    `forbidden SVG child in ${svgPath}`,
  );
  assert(
    Array.from(root.childNodes).every(
      (node) => paths.includes(node) || (node.nodeType === 3 && !node.textContent?.trim()),
    ),
    `forbidden SVG child node in ${svgPath}`,
  );
  for (const path of paths) {
    assert(
      JSON.stringify(path.getAttributeNames()) === JSON.stringify(["d"]) &&
        Boolean(path.getAttribute("d")?.trim()) &&
        !/https?:/i.test(path.getAttribute("d") ?? "") &&
        path.childNodes.length === 0,
      `forbidden SVG path content in ${svgPath}`,
    );
  }
}

export function validateExtensionCsp(value) {
  assert(typeof value === "string" && value.trim().length > 0, "extension CSP is missing");
  const directives = new Map();
  for (const rawDirective of value.split(";")) {
    const directive = rawDirective.trim();
    if (!directive) {
      continue;
    }
    const [rawName, ...sources] = directive.split(/\s+/);
    const name = rawName.toLowerCase();
    assert(!directives.has(name), `duplicate extension CSP directive: ${name}`);
    assert(sources.length > 0, `extension CSP directive has no sources: ${name}`);
    for (const source of sources) {
      const isAllowedRemoteImageSource =
        name === "img-src" && (source === "http:" || source === "https:");
      assert(
        !source.includes("*") &&
          (!/^https?:/i.test(source) || isAllowedRemoteImageSource) &&
          source !== "'unsafe-inline'" &&
          source !== "'unsafe-eval'",
        `forbidden extension CSP source: ${source}`,
      );
    }
    directives.set(name, [...sources].sort());
  }

  assert(
    directives.size === expectedCspDirectives.size,
    "extension CSP directives must exactly match the required policy",
  );
  for (const [name, expectedSources] of expectedCspDirectives) {
    assert(directives.has(name), `extension CSP is missing directive: ${name}`);
    assert(
      JSON.stringify(directives.get(name)) === JSON.stringify(expectedSources),
      `extension CSP sources do not match for ${name}`,
    );
  }
}

async function assertExpectedReference(distDirectory, fromFile, rawReference) {
  assert(typeof rawReference === "string" && rawReference.length > 0, `empty reference in ${fromFile}`);
  assert(!rawReference.includes("\\"), `invalid reference in ${fromFile}: ${rawReference}`);
  assert(!/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(rawReference), `remote or absolute reference in ${fromFile}: ${rawReference}`);
  const withoutSuffix = rawReference.split(/[?#]/, 1)[0];
  const stripped = withoutSuffix.startsWith("./") ? withoutSuffix.slice(2) : withoutSuffix;
  assert(stripped.length > 0, `empty reference in ${fromFile}`);
  assert(!stripped.split("/").some((segment) => segment === "" || segment === "."), `invalid reference in ${fromFile}: ${rawReference}`);
  const releasePath = posix.normalize(posix.join(posix.dirname(fromFile), stripped));
  assert(
    releasePath !== ".." &&
      !releasePath.startsWith("../") &&
      !posix.isAbsolute(releasePath),
    `reference escapes dist in ${fromFile}: ${rawReference}`,
  );
  const absolutePath = safeReleasePath(distDirectory, releasePath);
  assert(expectedFileSet.has(releasePath), `reference is not an expected release file in ${fromFile}: ${releasePath}`);
  const metadata = await stat(absolutePath);
  assert(metadata.isFile(), `reference is not a file in ${fromFile}: ${releasePath}`);
  return releasePath;
}

function getAttribute(node, name) {
  return node.attrs?.find((attribute) => attribute.name.toLowerCase() === name)?.value;
}

async function validateHtml(distDirectory, htmlPath, source) {
  const document = parseHtml(source);

  async function visit(node) {
    const tagName = node.tagName?.toLowerCase();
    if (tagName) {
      assert(!forbiddenHtmlElements.has(tagName), `forbidden HTML element <${tagName}> in ${htmlPath}`);
      for (const attribute of node.attrs ?? []) {
        const name = attribute.name.toLowerCase();
        assert(!name.startsWith("on"), `inline event attribute ${name} is forbidden in ${htmlPath}`);
        if (name === "style") {
          await validateCss(attribute.value, {
            declarationList: true,
            fromFile: `${htmlPath} style attribute`,
            resolveReference: (reference) =>
              assertExpectedReference(distDirectory, htmlPath, reference),
          });
        } else if (name === "srcset") {
          for (const candidate of attribute.value.split(",")) {
            const reference = candidate.trim().split(/\s+/, 1)[0];
            await assertExpectedReference(distDirectory, htmlPath, reference);
          }
        } else if (htmlUrlAttributes.has(name)) {
          await assertExpectedReference(distDirectory, htmlPath, attribute.value);
        }
      }

      if (tagName === "script") {
        assert(getAttribute(node, "type") === "module", `script must be a module in ${htmlPath}`);
        assert(getAttribute(node, "src"), `inline script is forbidden in ${htmlPath}`);
        const inlineContent = (node.childNodes ?? [])
          .filter((child) => child.nodeName === "#text")
          .map((child) => child.value ?? "")
          .join("");
        assert(inlineContent.trim() === "", `inline script content is forbidden in ${htmlPath}`);
      } else if (tagName === "style") {
        const styleContent = (node.childNodes ?? [])
          .filter((child) => child.nodeName === "#text")
          .map((child) => child.value ?? "")
          .join("");
        await validateCss(styleContent, {
          fromFile: `${htmlPath} style element`,
          resolveReference: (reference) =>
            assertExpectedReference(distDirectory, htmlPath, reference),
        });
      } else if (
        tagName === "meta" &&
        getAttribute(node, "http-equiv")?.trim().toLowerCase() === "refresh"
      ) {
        throw new Error(`meta refresh is forbidden in ${htmlPath}`);
      }
    }

    for (const child of node.childNodes ?? []) {
      await visit(child);
    }
    if (node.content) {
      await visit(node.content);
    }
  }

  await visit(document);
}

function getCalleeName(node) {
  if (node?.type === "Identifier") {
    return node.name;
  }
  if (node?.type === "MemberExpression") {
    if (!node.computed && node.property?.type === "Identifier") {
      return node.property.name;
    }
    if (node.computed) {
      return getStaticString(node.property);
    }
  }
  return undefined;
}

function getStaticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw;
  }
  if (node?.type === "BinaryExpression" && node.operator === "+") {
    const left = getStaticString(node.left);
    const right = getStaticString(node.right);
    return typeof left === "string" && typeof right === "string" ? left + right : undefined;
  }
  return undefined;
}

function validateJavaScript(javaScriptPath, source) {
  const ast = parseJavaScript(source, {
    allowHashBang: true,
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const rejectApi = (node) => {
    const name = getCalleeName(node.callee);
    assert(!forbiddenJavaScriptApis.has(name), `forbidden JavaScript API ${name} in ${javaScriptPath}`);
  };
  walkJavaScript(ast, {
    CallExpression: rejectApi,
    Identifier(node) {
      assert(
        !forbiddenJavaScriptApis.has(node.name),
        `forbidden JavaScript API ${node.name} in ${javaScriptPath}`,
      );
    },
    ImportExpression() {
      throw new Error(`dynamic import is forbidden in ${javaScriptPath}`);
    },
    ImportDeclaration() {
      throw new Error(`static import is forbidden in ${javaScriptPath}`);
    },
    ExportAllDeclaration() {
      throw new Error(`export source is forbidden in ${javaScriptPath}`);
    },
    ExportNamedDeclaration(node) {
      assert(!node.source, `export source is forbidden in ${javaScriptPath}`);
    },
    MemberExpression(node) {
      const name = getCalleeName(node);
      assert(
        !forbiddenJavaScriptApis.has(name),
        `forbidden JavaScript API ${name} in ${javaScriptPath}`,
      );
    },
    NewExpression: rejectApi,
  });
}

export async function checkDist(distDirectory) {
  const absoluteDist = resolve(distDirectory);
  const files = await assertExactReleaseFiles(absoluteDist);

  const manifestPath = safeReleasePath(absoluteDist, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(
    JSON.stringify(Object.keys(manifest).sort()) === JSON.stringify(expectedManifestKeys),
    "manifest top-level keys must exactly match the reviewed allowlist",
  );
  assert(manifest.manifest_version === 3, "manifest_version must be 3");
  assert(
    JSON.stringify(manifest.permissions) ===
      JSON.stringify([
        "sidePanel",
        "tabs",
        "tabGroups",
        "storage",
        "history",
        "sessions",
        "bookmarks",
      ]),
    "permissions must be exactly sidePanel, tabs, tabGroups, storage, history, sessions, bookmarks",
  );
  assert(!Object.hasOwn(manifest, "host_permissions"), "host_permissions must not be present");
  assert(!Object.hasOwn(manifest, "content_scripts"), "content_scripts must not be present");
  assert(manifest.minimum_chrome_version === "114", "minimum_chrome_version must be 114");
  validateExtensionCsp(manifest.content_security_policy?.extension_pages);

  const manifestPaths = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ];
  for (const path of manifestPaths) {
    await assertExpectedReference(absoluteDist, "manifest.json", path);
  }

  for (const path of files) {
    const absolutePath = safeReleasePath(absoluteDist, path);
    if (path.endsWith(".html")) {
      await validateHtml(absoluteDist, path, await readFile(absolutePath, "utf8"));
    } else if (path.endsWith(".css")) {
      await validateCss(await readFile(absolutePath, "utf8"), {
        fromFile: path,
        resolveReference: (reference) =>
          assertExpectedReference(absoluteDist, path, reference),
      });
    } else if (path.endsWith(".js")) {
      validateJavaScript(path, await readFile(absolutePath, "utf8"));
    } else if (sanitizedSvgPaths.has(path)) {
      validateSanitizedSvg(
        path,
        await readFile(absolutePath, "utf8"),
        sanitizedSvgPaths.get(path),
      );
    }
  }

  for (const [path, expectedSize] of pngSizes) {
    const metadata = await sharp(safeReleasePath(absoluteDist, path)).metadata();
    assert(metadata.format === "png", `${path} must be PNG`);
    assert(metadata.width === expectedSize && metadata.height === expectedSize, `${path} must be ${expectedSize}x${expectedSize}`);
  }

  let totalBytes = 0;
  for (const path of files) {
    totalBytes += (await stat(safeReleasePath(absoluteDist, path))).size;
  }
  assert(totalBytes <= 300_000, `dist exceeds 300000 bytes: ${totalBytes}`);
  return { totalBytes };
}

function isMain(moduleUrl) {
  return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === moduleUrl;
}

if (isMain(import.meta.url)) {
  const root = resolve(import.meta.dirname, "..");
  const result = await checkDist(resolve(root, "dist"));
  console.log(`dist check passed: ${result.totalBytes} bytes`);
}
