// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

const expectedFiles = [
  "THIRD_PARTY_NOTICES.md",
  "assets/icons/icon-128.png",
  "assets/icons/icon-16.png",
  "assets/icons/icon-32.png",
  "assets/icons/icon-48.png",
  "assets/icons/locate.svg",
  "assets/icons/network.svg",
  "assets/icons/pin.svg",
  "assets/icons/search.svg",
  "assets/icons/settings.svg",
  "background/service-worker.js",
  "manifest.json",
  "sidepanel/index.html",
  "sidepanel/sidebar.css",
  "sidepanel/sidebar.js",
];

type ReleaseFilesModule = {
  EXPECTED_FILES: readonly string[];
  assertExactReleaseFiles(root: string): Promise<string[]>;
  safeReleasePath(root: string, relativePath: string): string;
};

type CheckDistModule = {
  checkDist(distDirectory: string): Promise<{ totalBytes: number }>;
  validateExtensionCsp(value: string): void;
};

type PackageModule = {
  packageDist(projectRoot: string): Promise<{ archivePath: string; bytes: number }>;
};

type BuildModule = {
  copyRequiredIcons(projectRoot: string, distRoot: string): Promise<void>;
};

const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })),
  );
  temporaryRoots.clear();
});

async function loadReleaseFiles(): Promise<ReleaseFilesModule> {
  const modulePath = "../scripts/release-files.mjs";
  return import(/* @vite-ignore */ modulePath) as Promise<ReleaseFilesModule>;
}

async function loadCheckDist(): Promise<CheckDistModule> {
  const modulePath = "../scripts/check-dist.mjs";
  return import(/* @vite-ignore */ modulePath) as Promise<CheckDistModule>;
}

async function loadPackage(): Promise<PackageModule> {
  const modulePath = "../scripts/package.mjs";
  return import(/* @vite-ignore */ modulePath) as Promise<PackageModule>;
}

async function loadBuild(): Promise<BuildModule> {
  const modulePath = "../scripts/build.mjs";
  return import(/* @vite-ignore */ modulePath) as Promise<BuildModule>;
}

async function createReleaseFixture(): Promise<{ root: string; dist: string; release: string }> {
  const root = await mkdtemp(join(tmpdir(), "sidetab-release-"));
  temporaryRoots.add(root);
  const dist = join(root, "dist");
  const release = join(root, "release");
  const manifest = {
    manifest_version: 3,
    name: "SideTab Lite Test",
    version: "0.1.0",
    description: "Release validation fixture",
    minimum_chrome_version: "114",
    permissions: [
      "sidePanel",
      "tabs",
      "tabGroups",
      "storage",
      "history",
      "sessions",
      "bookmarks",
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src 'none'; img-src 'self' data: http: https:; style-src 'self'; frame-src 'none'",
    },
    background: {
      service_worker: "background/service-worker.js",
      type: "module",
    },
    action: {
      default_icon: {
        "16": "assets/icons/icon-16.png",
        "32": "assets/icons/icon-32.png",
      },
    },
    icons: {
      "16": "assets/icons/icon-16.png",
      "32": "assets/icons/icon-32.png",
      "48": "assets/icons/icon-48.png",
      "128": "assets/icons/icon-128.png",
    },
    side_panel: {
      default_path: "sidepanel/index.html",
    },
  };

  for (const path of expectedFiles) {
    const target = join(dist, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    if (path.endsWith(".png")) {
      await copyFile(resolve(import.meta.dirname, "..", path), target);
    } else if (path === "assets/icons/pin.svg") {
      await writeFile(target, '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" /></svg>');
    } else if (path.endsWith(".svg")) {
      await writeFile(
        target,
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0" /></svg>',
      );
    } else if (path === "THIRD_PARTY_NOTICES.md") {
      await writeFile(target, "Lucide is distributed under the ISC License.\n");
    } else if (path === "manifest.json") {
      await writeFile(target, JSON.stringify(manifest));
    } else if (path === "sidepanel/index.html") {
      await writeFile(
        target,
        '<!doctype html><link rel="stylesheet" href="./sidebar.css"><main></main><script type="module" src="./sidebar.js"></script>',
      );
    } else if (path.endsWith(".css")) {
      await writeFile(target, ".sidebar { color: #202124; }");
    } else {
      await writeFile(target, "export const ready = true;");
    }
  }
  return { root, dist, release };
}

async function overwrite(root: string, path: string, contents: string): Promise<void> {
  await writeFile(join(root, ...path.split("/")), contents);
}

describe("release file contract", () => {
  it("exports the exact sorted Chrome package files", async () => {
    const { EXPECTED_FILES } = await loadReleaseFiles();

    expect(EXPECTED_FILES).toEqual(expectedFiles);
    expect(EXPECTED_FILES).toHaveLength(15);
    expect(EXPECTED_FILES).not.toContain("assets/icons/add-tab.svg");
    expect(EXPECTED_FILES).toEqual([...EXPECTED_FILES].sort());
  });

  it("resolves only normalized POSIX paths inside the release root", async () => {
    const { safeReleasePath } = await loadReleaseFiles();
    const root = resolve("release-root");

    expect(safeReleasePath(root, "sidepanel/index.html")).toBe(
      resolve(root, "sidepanel/index.html"),
    );
    for (const unsafe of [
      "",
      ".",
      "./manifest.json",
      "sidepanel/./index.html",
      "../secret.txt",
      "sidepanel/../manifest.json",
      "/absolute.txt",
      "C:/absolute.txt",
      "https://example.com/code.js",
      "sidepanel\\index.html",
    ]) {
      expect(() => safeReleasePath(root, unsafe), unsafe).toThrow();
    }
  });

  it.runIf(process.platform !== "win32")(
    "rejects a file symbolic link with an explicit release error",
    async () => {
      const fixture = await createReleaseFixture();
      const target = join(fixture.root, "linked-sidebar.js");
      const link = join(fixture.dist, "sidepanel", "sidebar.js");
      await writeFile(target, "export const linked = true;");
      await rm(link);
      await symlink(target, link, "file");
      const { assertExactReleaseFiles } = await loadReleaseFiles();

      await expect(assertExactReleaseFiles(fixture.dist)).rejects.toThrow(/symbolic link/i);
    },
  );

  it("rejects a directory symbolic link or Windows junction with an explicit release error", async () => {
    const fixture = await createReleaseFixture();
    const target = join(fixture.root, "linked-sidepanel");
    const link = join(fixture.dist, "sidepanel");
    await mkdir(target);
    await writeFile(join(target, "index.html"), "<!doctype html><main></main>");
    await writeFile(join(target, "sidebar.css"), ".sidebar { color: #202124; }");
    await writeFile(join(target, "sidebar.js"), "export const linked = true;");
    await rm(link, { recursive: true });
    await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    const { assertExactReleaseFiles } = await loadReleaseFiles();

    await expect(assertExactReleaseFiles(fixture.dist)).rejects.toThrow(/symbolic link/i);
  });
});

describe("extension CSP validation", () => {
  it("accepts the exact policy regardless of directive and source order", async () => {
    const { validateExtensionCsp } = await loadCheckDist();

    expect(() =>
      validateExtensionCsp(
        "frame-src 'none'; style-src 'self'; img-src https: data: http: 'self'; connect-src 'none'; object-src 'self'; script-src 'self'",
      ),
    ).not.toThrow();
  });

  it.each([
    [
      "script-src 'self'; object-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; frame-src 'none'",
      "policy missing HTTP and HTTPS images",
    ],
    [
      "script-src 'self'; object-src 'self'; connect-src 'none'; img-src 'self' data: https:; style-src 'self'; frame-src 'none'",
      "policy missing HTTP images",
    ],
    [
      "script-src 'self'; object-src 'self'; connect-src 'none'; img-src 'self' data: http:; style-src 'self'; frame-src 'none'",
      "policy missing HTTPS images",
    ],
    [
      "script-src 'self'; object-src 'self'; connect-src 'none'; img-src 'self' data: http: https:; style-src 'self'",
      "missing frame-src",
    ],
    [
      "script-src 'self'; object-src 'self'; connect-src https:; img-src 'self' data: http: https:; style-src 'self'; frame-src 'none'",
      "remote connect-src",
    ],
    [
      "script-src 'self'; object-src 'self'; connect-src 'none'; img-src * data: http: https:; style-src 'self'; frame-src 'none'",
      "wildcard img-src",
    ],
    [
      "script-src 'self' 'unsafe-inline'; object-src 'self'; connect-src 'none'; img-src 'self' data: http: https:; style-src 'self'; frame-src 'none'",
      "unsafe-inline",
    ],
    [
      "script-src 'self' 'unsafe-eval'; object-src 'self'; connect-src 'none'; img-src 'self' data: http: https:; style-src 'self'; frame-src 'none'",
      "unsafe-eval",
    ],
  ])("rejects an unsafe or incomplete extension CSP: %s", async (value) => {
    const { validateExtensionCsp } = await loadCheckDist();

    expect(() => validateExtensionCsp(value)).toThrow(/csp|directive|source|forbidden/i);
  });
});

describe("dist validation", () => {
  it("rejects with ENOENT when the required icon source directory is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "sidetab-build-"));
    temporaryRoots.add(root);
    const { copyRequiredIcons } = await loadBuild();

    await expect(copyRequiredIcons(root, join(root, "dist"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("accepts a packaged CSS reference that normalizes inside dist", async () => {
    const fixture = await createReleaseFixture();
    await overwrite(
      fixture.dist,
      "sidepanel/sidebar.css",
      '.pin { mask: url("../assets/icons/pin.svg"); }',
    );
    const { checkDist } = await loadCheckDist();

    await expect(checkDist(fixture.dist)).resolves.toMatchObject({
      totalBytes: expect.any(Number),
    });
  });

  it("builds the real dist with all fourteen reviewed files and excludes shortcut PNGs", async () => {
    execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: resolve(".") });
    const { checkDist } = await loadCheckDist();
    const { assertExactReleaseFiles } = await loadReleaseFiles();

    await expect(checkDist(resolve("dist"))).resolves.toMatchObject({
      totalBytes: expect.any(Number),
    });
    await expect(assertExactReleaseFiles(resolve("dist"))).resolves.toHaveLength(15);
    await expect(readFile(resolve("dist/THIRD_PARTY_NOTICES.md"), "utf8")).resolves.toContain(
      "ISC License",
    );
    for (const shortcut of ["openai.png", "google.png", "github.png"]) {
      await expect(readFile(resolve("dist/assets/shortcuts", shortcut))).rejects.toThrow();
    }
  });

  it.each([
    [
      "missing bookmarks",
      ["sidePanel", "tabs", "tabGroups", "storage", "history", "sessions"],
    ],
    [
      "an extra permission",
      [
        "sidePanel",
        "tabs",
        "tabGroups",
        "storage",
        "history",
        "sessions",
        "bookmarks",
        "alarms",
      ],
    ],
    [
      "a different order",
      [
        "sidePanel",
        "tabs",
        "tabGroups",
        "storage",
        "history",
        "bookmarks",
        "sessions",
      ],
    ],
  ])("rejects manifest permissions with %s", async (_case, permissions) => {
    const fixture = await createReleaseFixture();
    const manifestPath = join(fixture.dist, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.permissions = permissions;
    await writeFile(manifestPath, JSON.stringify(manifest));
    const { checkDist } = await loadCheckDist();

    await expect(checkDist(fixture.dist)).rejects.toThrow(/permissions.*exactly/i);
  });

  it("rejects a manifest path that escapes dist even when the outside file exists", async () => {
    const fixture = await createReleaseFixture();
    const manifestPath = join(fixture.dist, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.background.service_worker = "../outside.js";
    await Promise.all([
      writeFile(manifestPath, JSON.stringify(manifest)),
      writeFile(join(fixture.root, "outside.js"), "export {}"),
    ]);
    const { checkDist } = await loadCheckDist();

    await expect(checkDist(fixture.dist)).rejects.toThrow(/path|expected|manifest/i);
  });

  it.each([
    ["optional_permissions", ["bookmarks"]],
    ["optional_host_permissions", ["https://example.com/*"]],
    ["externally_connectable", { matches: ["https://example.com/*"] }],
    ["web_accessible_resources", []],
  ])("rejects an unreviewed manifest top-level key: %s", async (key, value) => {
    const fixture = await createReleaseFixture();
    const manifestPath = join(fixture.dist, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest[key] = value;
    await writeFile(manifestPath, JSON.stringify(manifest));
    const { checkDist } = await loadCheckDist();

    await expect(checkDist(fixture.dist)).rejects.toThrow(/manifest|key|unexpected|exact/i);
  });

  it("rejects a manifest missing the required description key", async () => {
    const fixture = await createReleaseFixture();
    const manifestPath = join(fixture.dist, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.description;
    await writeFile(manifestPath, JSON.stringify(manifest));
    const { checkDist } = await loadCheckDist();

    await expect(checkDist(fixture.dist)).rejects.toThrow(/manifest|key|missing|exact/i);
  });

  it.each([
    ['<img src="https://example.com/tracker.png">', "remote image"],
    ['<iframe src="./sidebar.js"></iframe>', "iframe"],
    ["<script>alert(1)</script>", "inline script"],
    ['<main onclick="alert(1)"></main>', "event attribute"],
    ['<style>@import "https://example.com/theme.css";</style>', "style element import"],
    [
      '<style>.x { background: url("https://example.com/image.png"); }</style>',
      "style element remote URL",
    ],
    ['<main style="background: url(./missing.png)"></main>', "style attribute URL"],
    [
      '<meta http-equiv=" ReFrEsH " content="0; url=https://example.com/">',
      "meta refresh",
    ],
  ])("rejects unsafe HTML: %s", async (unsafeHtml) => {
    const fixture = await createReleaseFixture();
    await overwrite(
      fixture.dist,
      "sidepanel/index.html",
      `<!doctype html>${unsafeHtml}<link rel="stylesheet" href="./sidebar.css"><script type="module" src="./sidebar.js"></script>`,
    );
    const { checkDist } = await loadCheckDist();

    await expect(checkDist(fixture.dist)).rejects.toThrow(
      /html|css|script|iframe|event|reference|import|refresh/i,
    );
  });

  it.each([
    ['@import "https://example.com/theme.css";', "CSS import"],
    ['.x { background: url("https://example.com/image.png"); }', "remote CSS URL"],
    ['.x { background: url("../../outside.svg"); }', "escaping CSS URL"],
  ])("rejects unsafe CSS: %s", async (unsafeCss) => {
    const fixture = await createReleaseFixture();
    await overwrite(fixture.dist, "sidepanel/sidebar.css", unsafeCss);
    const { checkDist } = await loadCheckDist();

    await expect(checkDist(fixture.dist)).rejects.toThrow(/css|import|url|reference/i);
  });

  it.each([
    ['<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0" /></svg>', "XML declaration"],
    ['<!doctype svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0" /></svg>', "doctype"],
    ['<svg viewBox="0 0 24 24" t="1"><path d="M0 0" /></svg>', "t attribute"],
    ['<svg viewBox="0 0 24 24" p-id="1"><path d="M0 0" /></svg>', "p-id attribute"],
    ['<svg viewBox="0 0 24 24" width="24"><path d="M0 0" /></svg>', "width attribute"],
    ['<svg viewBox="0 0 24 24" width = "24"><path d="M0 0" /></svg>', "spaced width attribute"],
    ['<svg viewBox="0 0 24 24" height="24"><path d="M0 0" /></svg>', "height attribute"],
    ['<svg viewBox="0 0 24 24" height\n= "24"><path d="M0 0" /></svg>', "spaced height attribute"],
    ['<svg viewBox="0 0 24 24" xlink:href="#icon"><path d="M0 0" /></svg>', "xlink reference"],
    ['<svg viewBox="0 0 24 24"><path href="#icon" d="M0 0" /></svg>', "double-quoted href"],
    ["<svg viewBox=\"0 0 24 24\"><path href='#icon' d=\"M0 0\" /></svg>", "single-quoted href"],
    ['<svg viewBox="0 0 24 24"><path href = "#icon" d="M0 0" /></svg>', "spaced href"],
    ['<svg viewBox="0 0 24 24"><path d="https://example.com/icon.svg" /></svg>', "remote URL"],
    ['<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>', "script"],
    ['<svg viewBox="0 0 24 24" onload="alert(1)"><path d="M0 0" /></svg>', "event handler"],
    ['<svg viewBox="0 0 24 24" onload = "alert(1)"><path d="M0 0" /></svg>', "spaced event handler"],
  ])("rejects a prohibited SVG construct: %s", async (unsafeSvg) => {
    const fixture = await createReleaseFixture();
    await overwrite(fixture.dist, "assets/icons/search.svg", unsafeSvg);
    const { checkDist } = await loadCheckDist();

    await expect(checkDist(fixture.dist)).rejects.toThrow(/svg|forbidden/i);
  });

  it("rejects extra SVG attributes outside the sanitized asset schema", async () => {
    const fixture = await createReleaseFixture();
    await overwrite(
      fixture.dist,
      "assets/icons/search.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path offset="0" stroke-width="2" data-height="24" data-onload="label" d="M0 0" /></svg>',
    );
    const { checkDist } = await loadCheckDist();

    await expect(checkDist(fixture.dist)).rejects.toThrow(/svg|attribute|content/i);
  });

  it.each([
    ['<svg viewBox="0 0 24 24"><path d="M0 0" /></svg>', "missing namespace"],
    [
      '<svg XMLNS="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0" /></svg>',
      "uppercase namespace attribute",
    ],
    [
      '<svg xmlns="HTTP://WWW.W3.ORG/2000/SVG" viewBox="0 0 24 24"><path d="M0 0" /></svg>',
      "uppercase namespace URI",
    ],
    [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:foo="urn:test" viewBox="0 0 24 24"><path d="M0 0" /></svg>',
      "prefixed namespace",
    ],
    [
      `<svg data-label=' xmlns="http://www.w3.org/2000/svg"' viewBox="0 0 24 24"><path d="M0 0" /></svg>`,
      "namespace text inside another attribute",
    ],
  ])("rejects a sanitized SVG with an invalid namespace: %s", async (unsafeSvg) => {
    const fixture = await createReleaseFixture();
    await overwrite(fixture.dist, "assets/icons/search.svg", unsafeSvg);
    const { checkDist } = await loadCheckDist();

    await expect(checkDist(fixture.dist)).rejects.toThrow(/svg|namespace/i);
  });

  it.each([
    ["const url = 'https://example.com'; fetch(url);", "fetch"],
    ["const request = fetch; request(url);", "aliased fetch"],
    ["import('./chunk.js');", "dynamic import"],
    ["new WebSocket(url);", "WebSocket"],
    ["new XMLHttpRequest();", "XMLHttpRequest"],
    ["new EventSource(url);", "EventSource"],
    ["const image = new Image(); image.src = 'https://example.com/pixel.png';", "Image"],
    ["globalThis['fe' + 'tch'](url);", "computed fetch"],
    ["new globalThis[`WebSocket`](url);", "computed template WebSocket"],
    ["navigator.sendBeacon(url, data);", "sendBeacon"],
    ["const { sendBeacon } = navigator; sendBeacon(url);", "destructured sendBeacon"],
    ["const beacon = navigator.sendBeacon; beacon(url);", "aliased member sendBeacon"],
    ["eval(code);", "eval"],
    ["new Function(code);", "Function"],
    ['import "./missing.js";', "static import"],
    ['export { value } from "./missing.js";', "named re-export"],
    ['export * from "./missing.js";', "export all"],
  ])("rejects unsafe JavaScript AST usage: %s", async (unsafeJavaScript) => {
    const fixture = await createReleaseFixture();
    await overwrite(fixture.dist, "sidepanel/sidebar.js", unsafeJavaScript);
    const { checkDist } = await loadCheckDist();

    await expect(checkDist(fixture.dist)).rejects.toThrow(/javascript|forbidden|import|fetch|function/i);
  });

  it("allows ordinary website URL strings that are not network calls", async () => {
    const fixture = await createReleaseFixture();
    await overwrite(
      fixture.dist,
      "sidepanel/sidebar.js",
      'export const shortcuts = ["https://chatgpt.com/", "https://www.google.com/", "https://github.com/"];',
    );
    const { checkDist } = await loadCheckDist();

    await expect(checkDist(fixture.dist)).resolves.toMatchObject({ totalBytes: expect.any(Number) });
  });
});

describe("release packaging", () => {
  it.each(["secret.txt", "sidepanel/debug.MAP"])(
    "rejects an unexpected dist file: %s",
    async (extraPath) => {
      const fixture = await createReleaseFixture();
      const target = join(fixture.dist, ...extraPath.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, "not for release");
      const { packageDist } = await loadPackage();

      await expect(packageDist(fixture.root)).rejects.toThrow(/unexpected|exact|file/i);
    },
  );

  it("rejects a missing expected dist file", async () => {
    const fixture = await createReleaseFixture();
    await rm(join(fixture.dist, "sidepanel/sidebar.css"));
    const { packageDist } = await loadPackage();

    await expect(packageDist(fixture.root)).rejects.toThrow(/missing|expected|file/i);
  });

  it("creates the exact deterministic ZIP on consecutive runs", async () => {
    const fixture = await createReleaseFixture();
    const { packageDist } = await loadPackage();

    const firstResult = await packageDist(fixture.root);
    const first = await readFile(firstResult.archivePath);
    const secondResult = await packageDist(fixture.root);
    const second = await readFile(secondResult.archivePath);

    expect(firstResult.archivePath).toBe(secondResult.archivePath);
    expect(first).toEqual(second);
    expect(createHash("sha256").update(first).digest("hex")).toBe(
      createHash("sha256").update(second).digest("hex"),
    );
    expect(Object.keys(unzipSync(first)).sort()).toEqual(expectedFiles);
    const packaged = unzipSync(first);
    expect(strFromU8(packaged["THIRD_PARTY_NOTICES.md"]!)).toContain("ISC License");
  });

  it("creates the same ZIP in UTC, Shanghai, and Los Angeles", async () => {
    const helper = resolve(import.meta.dirname, "helpers/package-release.mjs");
    const hashes: Record<string, string> = {};

    for (const timeZone of ["UTC", "Asia/Shanghai", "America/Los_Angeles"]) {
      const fixture = await createReleaseFixture();
      hashes[timeZone] = execFileSync(process.execPath, [helper, fixture.root], {
        encoding: "utf8",
        env: { ...process.env, TZ: timeZone },
      }).trim();
    }

    expect(new Set(Object.values(hashes)).size, JSON.stringify(hashes)).toBe(1);
  });

  it("overwrites only the target ZIP and preserves other release files", async () => {
    const fixture = await createReleaseFixture();
    await mkdir(fixture.release, { recursive: true });
    const keepPath = join(fixture.release, "keep.txt");
    await writeFile(keepPath, "keep me");
    const { packageDist } = await loadPackage();

    await packageDist(fixture.root);

    await expect(readFile(keepPath, "utf8")).resolves.toBe("keep me");
  });
});

describe("Node dependency contract", () => {
  it("provides an observational tab renderer benchmark outside the release package", async () => {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));

    expect(packageJson.scripts["benchmark:tabs"]).toBe(
      "node scripts/benchmark-tab-renderer.mjs",
    );
    const source = await readFile(resolve("scripts/benchmark-tab-renderer.mjs"), "utf8");
    expect(source).not.toMatch(/process\.exit(?:Code)?\s*=|process\.exit\s*\(/);
    expect(expectedFiles).not.toContain("scripts/benchmark-tab-renderer.mjs");

    const output = execFileSync(process.execPath, ["scripts/benchmark-tab-renderer.mjs"], {
      cwd: resolve("."),
      encoding: "utf8",
    });
    const metrics = output.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(metrics.map((metric) => metric.count)).toEqual([100, 500]);
    for (const metric of metrics) {
      expect(metric).toEqual({
        count: expect.any(Number),
        medianMs: expect.any(Number),
        p95Ms: expect.any(Number),
        domNodes: expect.any(Number),
        heapUsedMb: expect.any(Number),
      });
      expect(metric.medianMs).toBeGreaterThanOrEqual(0);
      expect(metric.p95Ms).toBeGreaterThanOrEqual(metric.medianMs);
      expect(metric.domNodes).toBeGreaterThan(metric.count);
      expect(metric.heapUsedMb).toBeGreaterThan(0);
    }
  });

  it("pins Vite 6 with an engine range that includes Node 20.11", async () => {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
    const vitePackage = JSON.parse(
      await readFile(resolve("node_modules/vite/package.json"), "utf8"),
    );

    expect(packageJson.engines.node).toBe(">=20.11");
    expect(packageJson.devDependencies.vite).toBe("6.4.3");
    expect(vitePackage.version).toBe("6.4.3");
    expect(vitePackage.engines.node).toContain("^20.0.0");
  });
});
