import manifest from "../manifest.json";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function parseCsp(value: string): Record<string, string[]> {
  return Object.fromEntries(
    value
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name, sources.sort()];
      }),
  );
}

describe("extension manifest", () => {
  it("keeps the npm and extension release versions aligned at 0.6.1", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(manifest.version).toBe("0.6.1");
    expect(packageJson.version).toBe("0.6.1");
    expect(packageLock.version).toBe("0.6.1");
    expect(packageLock.packages[""].version).toBe("0.6.1");
  });

  it("documents the current release archive", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain(`release/sidetab-lite-${manifest.version}.zip`);
  });

  it("uses the required restricted MV3 permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe("114");
    expect(manifest.permissions).toEqual(["sidePanel", "tabs", "storage", "history"]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(parseCsp(manifest.content_security_policy.extension_pages)).toEqual({
      "connect-src": ["'none'"],
      "frame-src": ["'none'"],
      "img-src": ["'self'", "data:", "http:", "https:"].sort(),
      "object-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'"],
    });
    expect(manifest.background.service_worker).toBe("background/service-worker.js");
    expect(manifest.background.type).toBe("module");
    expect(manifest.side_panel.default_path).toBe("sidepanel/index.html");
    expect(manifest.icons).toEqual({
      "16": "assets/icons/icon-16.png",
      "32": "assets/icons/icon-32.png",
      "48": "assets/icons/icon-48.png",
      "128": "assets/icons/icon-128.png",
    });
    expect(manifest.action.default_icon).toEqual({
      "16": "assets/icons/icon-16.png",
      "32": "assets/icons/icon-32.png",
    });
  });
});
