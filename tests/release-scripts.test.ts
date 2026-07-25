import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

const expectedFiles = [
  "assets/icons/icon-128.png",
  "assets/icons/icon-16.png",
  "assets/icons/icon-32.png",
  "assets/icons/icon-48.png",
  "assets/shortcuts/github.png",
  "assets/shortcuts/google.png",
  "assets/shortcuts/openai.png",
  "background/service-worker.js",
  "manifest.json",
  "sidepanel/index.html",
  "sidepanel/sidebar.css",
  "sidepanel/sidebar.js",
];

type ReleaseFilesModule = {
  EXPECTED_FILES: readonly string[];
  safeReleasePath(root: string, relativePath: string): string;
};

type CheckDistModule = {
  checkDist(distDirectory: string): Promise<{ totalBytes: number }>;
  validateExtensionCsp(value: string): void;
};

type PackageModule = {
  packageDist(projectRoot: string): Promise<{ archivePath: string; bytes: number }>;
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
    permissions: ["sidePanel", "tabs", "storage"],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; frame-src 'none'",
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
});

describe("extension CSP validation", () => {
  it("accepts the exact policy regardless of directive and source order", async () => {
    const { validateExtensionCsp } = await loadCheckDist();

    expect(() =>
      validateExtensionCsp(
        "frame-src 'none'; style-src 'self'; img-src data: 'self'; connect-src 'none'; object-src 'self'; script-src 'self'",
      ),
    ).not.toThrow();
  });

  it.each([
    [
      "script-src 'self'; object-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'",
      "missing frame-src",
    ],
    [
      "script-src 'self'; object-src 'self'; connect-src https:; img-src 'self' data:; style-src 'self'; frame-src 'none'",
      "remote connect-src",
    ],
    [
      "script-src 'self'; object-src 'self'; connect-src 'none'; img-src * data:; style-src 'self'; frame-src 'none'",
      "wildcard img-src",
    ],
    [
      "script-src 'self' 'unsafe-inline'; object-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; frame-src 'none'",
      "unsafe-inline",
    ],
    [
      "script-src 'self' 'unsafe-eval'; object-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; frame-src 'none'",
      "unsafe-eval",
    ],
  ])("rejects an unsafe or incomplete extension CSP: %s", async (value) => {
    const { validateExtensionCsp } = await loadCheckDist();

    expect(() => validateExtensionCsp(value)).toThrow(/csp|directive|source|forbidden/i);
  });
});

describe("dist validation", () => {
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
  ])("rejects unsafe CSS: %s", async (unsafeCss) => {
    const fixture = await createReleaseFixture();
    await overwrite(fixture.dist, "sidepanel/sidebar.css", unsafeCss);
    const { checkDist } = await loadCheckDist();

    await expect(checkDist(fixture.dist)).rejects.toThrow(/css|import|url|reference/i);
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
