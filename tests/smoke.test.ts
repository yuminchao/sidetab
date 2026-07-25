import manifest from "../manifest.json";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  it("uses the required restricted MV3 permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["sidePanel", "tabs", "storage"]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
    expect(manifest.background.service_worker).toBe("background/service-worker.js");
    expect(manifest.background.type).toBe("module");
    expect(manifest.side_panel.default_path).toBe("sidepanel/index.html");
  });
});
