import manifest from "../manifest.json";
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
  it("uses the required restricted MV3 permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe("114");
    expect(manifest.permissions).toEqual(["sidePanel", "tabs", "storage"]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(parseCsp(manifest.content_security_policy.extension_pages)).toEqual({
      "connect-src": ["'none'"],
      "frame-src": ["'none'"],
      "img-src": ["'self'", "data:", "https:"].sort(),
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
