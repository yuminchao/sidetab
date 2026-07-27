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

  it("uses a fixed compact row without separators and keeps the favicon at 16px", () => {
    expect(css).toMatch(/--tab-row-height:\s*30px/);
    expect(css).toMatch(/\.tab-row\s*{[^}]*height:\s*var\(--tab-row-height\)/s);
    expect(css).not.toMatch(/\.tab-row\s*{[^}]*border-bottom/s);
    expect(css).toMatch(/\.tab-favicon\s*{[^}]*width:\s*16px[^}]*height:\s*16px/s);
    expect(css).not.toMatch(/\.tab-domain\s*{/);
    expect(css.match(/url\("\.\.\/assets\/icons\/pin\.svg"\)/g)).toHaveLength(2);
    expect(css).not.toContain('url("/assets/icons/pin.svg")');
  });

  it("reserves the pin column for every tab and hides ordinary pins without removing them", () => {
    expect(css).toMatch(
      /\.tab-main\s*{[^}]*grid-template-columns:\s*12px\s+16px\s+minmax\(0,\s*1fr\)/s,
    );
    expect(css).toMatch(
      /\.pin-indicator\[data-visible=["']false["']\]\s*{[^}]*visibility:\s*hidden/s,
    );
    expect(css).not.toMatch(
      /\.tab-row\[data-has-pin=["']true["']\]\s+\.tab-main\s*{[^}]*grid-template-columns/s,
    );
    expect(css).not.toMatch(
      /\.pin-indicator\[data-visible=["']false["']\]\s*{[^}]*display:\s*none/s,
    );
  });

  it("gives only the tab scroll container vertical scrolling", () => {
    expect(css).toMatch(/\.sidebar-shell\s*{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto/s);
    expect(css).toMatch(/\.shortcut-region\s*{[^}]*grid-row:\s*1/s);
    expect(css).toMatch(/\.tab-region\s*{[^}]*grid-row:\s*2/s);
    expect(css).toMatch(/\.status-message\s*{[^}]*grid-row:\s*3/s);
    expect(css).toMatch(/\.bottom-toolbar\s*{[^}]*grid-row:\s*4/s);
    expect(css).toMatch(/\.tab-region\s*{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(
      /\.tab-scroll\s*{[^}]*height:\s*100%[^}]*overflow-y:\s*auto[^}]*overflow-x:\s*hidden[^}]*scrollbar-width:\s*thin/s,
    );
    expect(css).not.toMatch(/\.tab-list\s*{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.status-message:empty\s*{[^}]*display:\s*none/s);
  });

  it("keeps the new-tab control compact and the empty state non-interactive", () => {
    expect(css).toMatch(
      /\.new-tab-button\s*{[^}]*width:\s*100%[^}]*height:\s*30px[^}]*border:\s*0/s,
    );
    expect(css).toMatch(
      /\.empty-message\s*{[^}]*position:\s*absolute[^}]*z-index:\s*1[^}]*inset:\s*30px\s+0\s+0[^}]*pointer-events:\s*none/s,
    );
  });

  it("uses a compact bottom toolbar and reveals close controls accessibly", () => {
    expect(css).toMatch(/\.bottom-toolbar\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+32px[^}]*padding:\s*6px/s);
    expect(css).toMatch(/\.tab-close\s*{[^}]*width:\s*26px[^}]*height:\s*26px[^}]*opacity:\s*0/s);
    expect(css).toMatch(/\.tab-row:(?:hover|focus-within)[^}]*\.tab-close[^}]*opacity:\s*1/s);
    expect(css).toMatch(
      /@media\s*\(pointer:\s*coarse\)\s*,\s*\(any-pointer:\s*coarse\)\s*{[\s\S]*?\.tab-close\s*{[^}]*opacity:\s*1/s,
    );
  });

  it("renders shortcut buttons as transparent borderless 32px icon controls", () => {
    expect(css).toMatch(
      /\.shortcut-button\s*{[^}]*width:\s*32px[^}]*height:\s*32px[^}]*border-color:\s*transparent[^}]*background:\s*transparent/s,
    );
    expect(css).not.toMatch(/\.shortcut-button\s*{[^}]*display:\s*none/s);
    expect(css).toMatch(/button:focus-visible[^}]*outline:/s);
  });

  it("uses Microsoft YaHei first for tab titles while retaining the size variable", () => {
    expect(css).toMatch(
      /\.tab-title\s*{[^}]*font-family:\s*"Microsoft YaHei",\s*"微软雅黑",\s*"Segoe UI",\s*system-ui,\s*sans-serif[^}]*font-size:\s*var\(--tab-title-font-size\)/s,
    );
  });

  it("supports 180px and 240px panels without positive minimum widths", () => {
    expect(css).toContain("@media (max-width: 240px)");
    expect(css).toContain("@media (max-width: 180px)");
    expect(css).not.toMatch(/min-width:\s*(?!0(?:px|rem|em|%)?\s*[;}])(?:[1-9]|0?\.[0-9]*[1-9])/);
    expect(css).toMatch(/#shortcut-dialog\s*{[^}]*max-width:\s*calc\(100vw\s*-\s*8px\)[^}]*overflow-y:\s*auto/s);
  });

  it("styles the shortcut divider, context menu, and zero-shift drag indicators", () => {
    expect(css).toMatch(
      /\.shortcut-strip\s*\{[^}]*border-bottom:\s*1px solid color-mix\(in srgb, CanvasText 18%, transparent\)/s,
    );
    expect(css).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none !important/s);
    expect(css).toMatch(/\.tab-context-menu\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*20/s);
    expect(css).toMatch(/\.tab-row\[data-drop-placement="before"\]::before/s);
    expect(css).toMatch(/\.tab-row\[data-drop-placement="after"\]::after/s);
    expect(css).toMatch(/\.tab-row\[data-drag-source="true"\]\s*\{[^}]*opacity:/s);
  });
});
