import { readFileSync } from "node:fs";
import postcss from "postcss";
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
    const root = postcss.parse(css);
    const rule = root.nodes.find(
      (node) => node.type === "rule" && node.selector === ".new-tab-button",
    );
    expect(rule?.type).toBe("rule");
    if (!rule || rule.type !== "rule") return;

    const declarations: Record<string, string> = {};
    rule.walkDecls((declaration) => {
      declarations[declaration.prop] = declaration.value;
    });
    expect(rule.nodes).toHaveLength(14);
    expect(rule.nodes.every((node) => node.type === "decl")).toBe(true);
    expect(declarations).toEqual({
        display: "grid",
        "place-items": "center",
        width: "44px",
        height: "24px",
        margin: "3px auto",
        padding: "0",
        border: "1px solid ButtonBorder",
        "border-radius": "5px",
        background: "transparent",
        color: "CanvasText",
        font: "inherit",
        "font-size": "20px",
        "line-height": "1",
        cursor: "pointer",
      });
    expect(css).not.toMatch(/\.new-tab-button::(?:before|after)/);
    expect(rule.toString()).not.toMatch(/(?:mask|url\s*\()/);
    expect(css).not.toContain("add-tab.svg");
    expect(css).toMatch(
      /\.empty-message\s*{[^}]*position:\s*absolute[^}]*z-index:\s*1[^}]*inset:\s*30px\s+0\s+0[^}]*pointer-events:\s*none/s,
    );
  });

  it("styles context-menu states and the rounded search field", () => {
    expect(css).toMatch(
      /\.tab-context-menu\s*>\s*button:hover:not\(:disabled\)\s*{[^}]*background:\s*color-mix\(in\s+srgb,\s*CanvasText\s+8%,\s*transparent\)/s,
    );
    expect(css).toMatch(
      /\.tab-context-menu\s*>\s*button:active:not\(:disabled\)\s*{[^}]*background:\s*color-mix\(in\s+srgb,\s*CanvasText\s+13%,\s*transparent\)/s,
    );
    expect(css).toMatch(
      /\.tab-context-menu\s*>\s*button:focus-visible\s*{[^}]*background:\s*color-mix\(in\s+srgb,\s*CanvasText\s+8%,\s*transparent\)/s,
    );
    expect(css).not.toMatch(/\.bottom-toolbar\s*{[^}]*border-top/s);
    expect(css).toMatch(
      /#tab-search\s*{[^}]*width:\s*100%[^}]*height:\s*32px[^}]*padding-inline:\s*32px\s+38px[^}]*border-radius:\s*16px/s,
    );
    expect(css).toMatch(
      /#tab-search::-webkit-search-cancel-button\s*{[^}]*-webkit-appearance:\s*none[^}]*display:\s*none/s,
    );
  });

  it("positions compact history results above the fixed bottom toolbar", () => {
    expect(css).toMatch(/\.bottom-toolbar\s*{[^}]*position:\s*relative/s);
    expect(css).toMatch(
      /#history-search-results\s*{[^}]*position:\s*absolute[^}]*right:\s*6px[^}]*bottom:\s*100%[^}]*left:\s*6px[^}]*max-height:\s*360px[^}]*overflow-y:\s*auto/s,
    );
    expect(css).toMatch(
      /\.history-search-option\s*{[^}]*grid-template-columns:\s*16px\s+minmax\(0,\s*1fr\)[^}]*height:\s*30px/s,
    );
    expect(css).toMatch(
      /\.history-search-title\s*{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
    );
    expect(css).not.toMatch(/\.history-search-option\s+\.history-search-url/s);
  });

  it("uses a compact bottom toolbar and reveals close controls accessibly", () => {
    expect(css).toMatch(/\.bottom-toolbar\s*{[^}]*min-width:\s*0[^}]*padding:\s*6px/s);
    expect(css).toMatch(/\.search-shell\s*{[^}]*position:\s*relative[^}]*width:\s*100%[^}]*min-width:\s*0/s);
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

  it("uses the local network mask for every final favicon fallback", () => {
    expect(css).toMatch(
      /\.site-favicon-fallback\s*{[^}]*mask-image:\s*url\("\.\.\/assets\/icons\/network\.svg"\)[^}]*background-color:\s*currentColor/s,
    );
    expect(css).toMatch(/\.tab-favicon-fallback\s*{[^}]*width:\s*16px[^}]*height:\s*16px/s);
    expect(css).toMatch(/\.history-favicon-fallback\s*{[^}]*width:\s*16px[^}]*height:\s*16px/s);
    expect(css).toMatch(/\.shortcut-favicon-fallback\s*{[^}]*width:\s*20px[^}]*height:\s*20px/s);
  });

  it("styles the appearance entry and settings gear without button chrome", () => {
    expect(css).toMatch(
      /\.appearance-setting\s*{[^}]*display:\s*grid[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+32px[^}]*min-width:\s*0/s,
    );
    expect(css).toMatch(
      /\.appearance-setting-hint\s*{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/s,
    );
    expect(css).toMatch(
      /#shortcut-settings\s*{[^}]*position:\s*absolute[^}]*right:\s*0[^}]*width:\s*32px[^}]*height:\s*32px[^}]*border-color:\s*transparent[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s,
    );
    expect(css).toMatch(
      /#shortcut-settings::before\s*{[^}]*width:\s*18px[^}]*height:\s*18px[^}]*mask:\s*url\("\.\.\/assets\/icons\/settings\.svg"\)[^}]*no-repeat/s,
    );
    expect(css).toMatch(
      /\.search-shell::before\s*{[^}]*width:\s*16px[^}]*height:\s*16px[^}]*mask:\s*url\("\.\.\/assets\/icons\/search\.svg"\)[^}]*no-repeat/s,
    );
    expect(css).toMatch(
      /#shortcut-settings:hover:not\(:disabled\)\s*{[^}]*background:\s*transparent/s,
    );
  });

  it("uses Microsoft YaHei for the context menu", () => {
    expect(css).toMatch(
      /\.tab-context-menu\s*{[^}]*font-family:\s*"Microsoft YaHei",\s*"微软雅黑",\s*"Segoe UI",\s*system-ui,\s*sans-serif/s,
    );
  });

  it("styles compact group rows, controls, and titles", () => {
    expect(css).toMatch(
      /\.tab-group-row\s*{[^}]*height:\s*28px[^}]*min-width:\s*0/s,
    );
    expect(css).toMatch(
      /\.tab-group-main\s*{[^}]*grid-template-columns:\s*12px\s+8px\s+minmax\(0,\s*1fr\)[^}]*width:\s*100%[^}]*height:\s*28px[^}]*border:\s*0/s,
    );
    expect(css).toMatch(/\.tab-group-chevron\s*{[^}]*width:\s*12px[^}]*height:\s*12px/s);
    expect(css).toMatch(/\.tab-group-color\s*{[^}]*width:\s*8px[^}]*height:\s*8px/s);
    expect(css).toMatch(
      /\.tab-group-title\s*{[^}]*min-width:\s*0[^}]*font-family:\s*"Microsoft YaHei",\s*"微软雅黑",\s*"Segoe UI",\s*system-ui,\s*sans-serif[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
    );
    expect(css).not.toMatch(/\.tab-group-count\s*{/);
  });

  it("maps every Chrome group color with dark-theme overrides", () => {
    const darkMedia = css.match(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/s,
    )?.[1] ?? "";
    expect(darkMedia).not.toBe("");
    for (const color of [
      "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange",
    ]) {
      const selector = new RegExp(`\\.tab-group-color\\[data-color=["']${color}["']\\]\\s*{[^}]*background:`, "s");
      expect(css).toMatch(selector);
      expect(darkMedia).toMatch(selector);
      expect(darkMedia).toMatch(
        new RegExp(`\\.group-menu-color\\[data-color=["']${color}["']\\]\\s*{[^}]*background:`, "s"),
      );
      expect(darkMedia).toMatch(
        new RegExp(`#tab-group-dialog\\s+input\\[type=["']radio["']\\]\\[name=["']tab-group-color["']\\]\\[value=["']${color}["']\\]\\s*{[^}]*background:`, "s"),
      );
    }
  });

  it("shares bounded menu foundations while keeping submenu rules differential", () => {
    const menuRule = css.match(/\.tab-context-menu\s*{[^}]*}/s)?.[0] ?? "";
    expect(menuRule).toMatch(/position:\s*fixed/);
    expect(menuRule).toMatch(/max-height:\s*calc\(100vh\s*-\s*8px\)/);
    expect(menuRule).toMatch(/overflow-y:\s*auto/);
    expect(menuRule).toMatch(
      /font-family:\s*"Microsoft YaHei",\s*"微软雅黑",\s*"Segoe UI",\s*system-ui,\s*sans-serif/,
    );

    const submenuRule = css.match(/\.tab-context-submenu\s*{[^}]*}/s)?.[0] ?? "";
    expect(submenuRule).toMatch(/z-index:\s*21/);
    expect(submenuRule).toMatch(/min-width:\s*min\(152px,\s*100vw\)/);
    expect(submenuRule).not.toMatch(
      /(?:position|display|padding|border|background|box-shadow|font-family|max-height|overflow-y):/,
    );

    const submenuButtonRule = css.match(/\.tab-context-submenu\s*>\s*button\s*{[^}]*}/s)?.[0] ?? "";
    expect(submenuButtonRule).toMatch(/display:\s*flex/);
    expect(submenuButtonRule).toMatch(/gap:\s*6px/);
    expect(submenuButtonRule).toMatch(/align-items:\s*center/);
    expect(submenuButtonRule).not.toMatch(
      /(?:min-height|padding|border|background|text-align|white-space):/,
    );
    expect(css).not.toMatch(/\.tab-context-submenu\s*>\s*button:(?:hover|focus-visible|active|disabled)/);
  });

  it("styles submenu group colors, checked markers, and the expansion arrow", () => {
    expect(css).toMatch(
      /\.group-menu-color\s*{[^}]*flex:\s*0\s+0\s+8px[^}]*width:\s*8px[^}]*height:\s*8px[^}]*border-radius:\s*50%/s,
    );
    for (const color of [
      "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange",
    ]) {
      expect(css).toMatch(
        new RegExp(`\\.group-menu-color\\[data-color=["']${color}["']\\]\\s*{[^}]*background:`, "s"),
      );
    }
    expect(css).toMatch(
      /\.tab-context-menu\s*>\s*button\[aria-haspopup=["']menu["']\]::after\s*{[^}]*content:\s*["']›["'][^}]*margin-inline-start:\s*auto/s,
    );
    expect(css).toMatch(
      /\.tab-context-submenu\s*>\s*button\[aria-checked=["']true["']\]::after\s*{[^}]*content:\s*["']✓["'][^}]*margin-inline-start:\s*auto/s,
    );
    expect(css).toMatch(
      /\.group-menu-title\s*{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
    );
  });

  it("styles a compact standalone tab-group dialog without nested card sections", () => {
    expect(css).toMatch(
      /#tab-group-dialog\s*{[^}]*width:\s*min\(300px,\s*calc\(100vw\s*-\s*8px\)\)[^}]*max-width:\s*300px[^}]*padding:\s*0[^}]*overflow-[xy]:\s*(?:auto|hidden)[^}]*font-family:\s*"Microsoft YaHei",\s*"微软雅黑",\s*"Segoe UI",\s*system-ui,\s*sans-serif/s,
    );
    expect(css).toMatch(
      /#tab-group-dialog\s+form\s*{[^}]*display:\s*grid[^}]*gap:\s*10px[^}]*min-width:\s*0[^}]*padding:\s*12px/s,
    );
    expect(css).toMatch(
      /#tab-group-dialog\s+fieldset\s*{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap[^}]*gap:\s*6px[^}]*min-width:\s*0[^}]*margin:\s*0[^}]*padding:\s*0[^}]*border:\s*0[^}]*background:\s*transparent/s,
    );
    expect(css).toMatch(
      /#tab-group-name\s*{[^}]*width:\s*100%[^}]*height:\s*32px[^}]*padding:\s*0\s+7px/s,
    );
    expect(css).toMatch(
      /#tab-group-error\s*{[^}]*margin:\s*0[^}]*color:\s*MarkText[^}]*background:\s*Mark[^}]*overflow-wrap:\s*anywhere/s,
    );
    expect(css).toMatch(/#tab-group-error:empty\s*{[^}]*display:\s*none/s);
  });

  it("renders all nine color choices as visible native radio controls", () => {
    expect(css).toMatch(
      /#tab-group-dialog\s+input\[type=["']radio["']\]\[name=["']tab-group-color["']\]\s*{[^}]*-webkit-appearance:\s*none[^}]*appearance:\s*none[^}]*width:\s*20px[^}]*height:\s*20px[^}]*margin:\s*0[^}]*border-radius:\s*50%[^}]*cursor:\s*pointer/s,
    );
    expect(css).toMatch(
      /#tab-group-dialog\s+input\[type=["']radio["']\]\[name=["']tab-group-color["']\]:checked\s*{[^}]*box-shadow:/s,
    );
    expect(css).toMatch(
      /#tab-group-dialog\s+input\[type=["']radio["']\]\[name=["']tab-group-color["']\]:focus-visible\s*{[^}]*outline:\s*2px\s+solid\s+AccentColor/s,
    );
    expect(css).toMatch(
      /#tab-group-dialog\s+input\[type=["']radio["']\]\[name=["']tab-group-color["']\]:disabled\s*{[^}]*cursor:\s*default/s,
    );
    for (const color of [
      "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange",
    ]) {
      expect(css).toMatch(
        new RegExp(`#tab-group-dialog\\s+input\\[type=["']radio["']\\]\\[name=["']tab-group-color["']\\]\\[value=["']${color}["']\\]\\s*{[^}]*background:`, "s"),
      );
    }
  });

  it("restores native radio state and distinguishes group dots in forced colors", () => {
    const forcedStart = css.indexOf("@media (forced-colors: active)");
    expect(forcedStart).toBeGreaterThan(-1);
    const forcedColors = css.slice(forcedStart);
    expect(forcedColors).toMatch(
      /#tab-group-dialog\s+input\[type=["']radio["']\]\[name=["']tab-group-color["']\]\s*{[^}]*-webkit-appearance:\s*auto[^}]*appearance:\s*auto[^}]*forced-color-adjust:\s*auto/s,
    );
    expect(forcedColors).toMatch(
      /#tab-group-dialog\s+input\[type=["']radio["']\]\[name=["']tab-group-color["']\]:checked\s*{[^}]*outline:\s*2px\s+solid\s+Highlight/s,
    );
    expect(forcedColors).toMatch(
      /\.group-menu-color\s*{[^}]*border:\s*2px\s+solid\s+ButtonText[^}]*forced-color-adjust:\s*auto/s,
    );
  });

  it("fits the tab-group dialog within a 180px panel", () => {
    const narrow180 = css.slice(
      css.indexOf("@media (max-width: 180px)"),
      css.indexOf("@media (pointer: coarse)"),
    );
    expect(narrow180).toMatch(
      /#tab-group-dialog\s*{[^}]*width:\s*calc\(100vw\s*-\s*8px\)[^}]*max-width:\s*calc\(100vw\s*-\s*8px\)/s,
    );
    expect(narrow180).toMatch(/#tab-group-dialog\s+form\s*{[^}]*padding:\s*8px/s);
  });

  it("supports 180px and 240px panels without positive minimum widths", () => {
    expect(css).toContain("@media (max-width: 240px)");
    expect(css).toContain("@media (max-width: 180px)");
    expect(css).not.toMatch(/min-width:\s*(?!0(?:px|rem|em|%)?\s*[;}])(?:[1-9]|0?\.[0-9]*[1-9])/);
    expect(css).toMatch(/#shortcut-dialog\s*{[^}]*max-width:\s*calc\(100vw\s*-\s*8px\)[^}]*overflow-y:\s*auto/s);
  });

  it("locks the full-width search shell to shrinkable narrow-panel constraints", () => {
    expect(css).toMatch(/\*\s*{[^}]*box-sizing:\s*border-box/s);
    expect(css).toMatch(/button,\s*input\s*{[^}]*min-width:\s*0/s);
    expect(css).toMatch(
      /\.search-shell\s*{[^}]*width:\s*100%[^}]*min-width:\s*0/s,
    );

    const searchRule = css.match(/#tab-search\s*{[^}]*}/s)?.[0] ?? "";
    expect(searchRule).toMatch(/width:\s*100%/);
    expect(searchRule).not.toMatch(/min-width:\s*(?!0(?:px|rem|em|%)?\s*[;}])(?:[1-9]|0?\.[0-9]*[1-9])/);
    expect(css).toMatch(
      /#shortcut-settings\s*{[^}]*position:\s*absolute[^}]*right:\s*0[^}]*width:\s*32px[^}]*height:\s*32px/s,
    );
    expect(css).toMatch(
      /#history-search-results\s*{[^}]*right:\s*6px[^}]*left:\s*6px/s,
    );

    const narrow240 = css.slice(
      css.indexOf("@media (max-width: 240px)"),
      css.indexOf("@media (max-width: 180px)"),
    );
    const narrow180 = css.slice(
      css.indexOf("@media (max-width: 180px)"),
      css.indexOf("@media (pointer: coarse)"),
    );
    for (const narrowRules of [narrow240, narrow180]) {
      expect(narrowRules).not.toMatch(/(?:^|[;{])\s*(?:min-)?width:\s*(?:[1-9]|0?\.[0-9]*[1-9])/m);
    }
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
