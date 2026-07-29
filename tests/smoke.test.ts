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
  it("keeps the npm and extension release versions aligned at 0.7.0", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(manifest.version).toBe("0.7.0");
    expect(packageJson.version).toBe("0.7.0");
    expect(packageLock.version).toBe("0.7.0");
    expect(packageLock.packages[""].version).toBe("0.7.0");
  });

  it("documents the current release archive, permissions, and file count", () => {
    const readme = readFileSync("README.md", "utf8");
    const checklist = readFileSync("docs/chrome-web-store-checklist.md", "utf8");
    expect(readme).toContain(`release/sidetab-lite-${manifest.version}.zip`);
    for (const permission of ["sidePanel", "tabs", "tabGroups", "storage", "history"]) {
      expect(readme).toContain(`\`${permission}\``);
      expect(checklist).toContain(`\`${permission}\``);
    }
    expect(checklist).toContain("13 个审核文件");
  });

  it("documents the 0.7.0 tab-group and middle-click workflows", () => {
    const readme = readFileSync("README.md", "utf8");
    const checklist = readFileSync("docs/chrome-web-store-checklist.md", "utf8");
    for (const document of [readme, checklist]) {
      expect(document).toContain("添加到分组");
      expect(document).toContain("新建分组");
      expect(document).toContain("从分组中移除");
      expect(document).toContain("折叠");
      expect(document).toContain("中键");
    }
    expect(checklist).not.toContain("右键菜单包含四项");
    expect(checklist).not.toContain("包含四项的菜单");
  });

  it("uses the required restricted MV3 permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe("114");
    expect(manifest.permissions).toEqual([
      "sidePanel",
      "tabs",
      "tabGroups",
      "storage",
      "history",
    ]);
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
