import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/sidepanel/sidebar.css", "utf8");

describe("side panel responsive CSS", () => {
  it("stacks editor fields and actions by 340px", () => {
    const mediaStart = css.indexOf("@media (max-width: 340px)");
    expect(mediaStart).toBeGreaterThan(-1);
    const narrowRules = css.slice(mediaStart);

    expect(narrowRules).toMatch(
      /\.shortcut-name,\s*\.shortcut-url\s*{[^}]*grid-column:\s*1\s*\/\s*-1/s,
    );
    expect(narrowRules).toMatch(
      /\.shortcut-editor-row\s*{[^}]*grid-template-columns:\s*repeat\(3,\s*32px\)\s+minmax\(0,\s*1fr\)/s,
    );
  });

  it("reserves stable space for the pinned indicator and only reveals it for pinned rows", () => {
    expect(css).toMatch(
      /\.pin-indicator\s*{[^}]*width:\s*24px[^}]*visibility:\s*hidden/s,
    );
    expect(css).toMatch(
      /\.tab-row\[data-pinned="true"\]\s+\.pin-indicator\s*{[^}]*visibility:\s*visible/s,
    );
  });
});
