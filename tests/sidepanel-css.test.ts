import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/sidepanel/sidebar.css", "utf8");

function relativeLuminance(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/gi)?.map((channel) => parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error(`Invalid hex color: ${hex}`);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

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

  it("joins expanded group headers and members without changing tab row height", () => {
    expect(css).toMatch(/\.tab-group-main\s*{[^}]*border-radius:\s*8px/s);
    expect(css).toMatch(
      /\.tab-group-row\[data-collapsed=["']false["']\]\s+\.tab-group-main\s*{[^}]*border-radius:\s*8px\s+8px\s+0\s+0/s,
    );
    expect(css).toMatch(
      /\.tab-row\[data-group-id\]\s*{[^}]*height:\s*var\(--tab-row-height\)[^}]*box-sizing:\s*border-box[^}]*border-inline:\s*2px\s+solid\s+var\(--member-group-color\)/s,
    );
    expect(css).toMatch(
      /\.tab-row\[data-group-position=["'](?:last|single)["']\][^}]*{[^}]*border-bottom:\s*2px\s+solid\s+var\(--member-group-color\)[^}]*border-radius:\s*0\s+0\s+8px\s+8px/s,
    );
    expect(css).not.toMatch(/\.tab-row\[data-group-id\]\s*{[^}]*border-(?:top|block):/s);
  });

  it("adds one external boundary between group blocks without using list gap", () => {
    const root = postcss.parse(css);
    const boundaryRule = root.nodes.find((node) => (
      node.type === "rule"
      && node.selector.includes(".tab-group-row:not(:first-child)")
      && node.selector.includes('.tab-group-row[data-collapsed="true"] + .tab-row:not([data-group-id])')
      && node.selector.includes('[data-group-position="last"]')
      && node.selector.includes('[data-group-position="single"]')
    ));
    expect(boundaryRule?.type).toBe("rule");
    if (!boundaryRule || boundaryRule.type !== "rule") return;

    const selectors = boundaryRule.selectors;
    expect(selectors).toContain(".tab-list > .tab-group-row:not(:first-child)");
    expect(selectors).toContain(
      '.tab-list > .tab-group-row[data-collapsed="true"] + .tab-row:not([data-group-id])',
    );
    expect(selectors.at(-1)).toContain('+ .tab-row:not([data-group-id])');
    expect(boundaryRule.nodes).toHaveLength(1);
    expect(boundaryRule.nodes[0]).toMatchObject({
      type: "decl",
      prop: "margin-block-start",
      value: "4px",
    });
    expect(selectors.some((selector) => selector.includes(".tab-group-row:first-child"))).toBe(false);
    expect(selectors.some((selector) => selector.includes(".new-tab-button"))).toBe(false);
    expect(css).not.toMatch(/\.tab-list\s*\{[^}]*gap\s*:/s);
  });

  it("maps every Chrome group color to the member border color", () => {
    for (const color of [
      "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange",
    ]) {
      expect(css).toMatch(
        new RegExp(`\\.tab-row\\[data-group-color=["']${color}["']\\]\\s*\\{[^}]*--member-group-color:`, "s"),
      );
    }
  });

  it("keeps member group borders visible in forced colors", () => {
    const forcedColors = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(forcedColors).toMatch(
      /\.tab-row\[data-group-id\]\s*{[^}]*--member-group-color:\s*(?:CanvasText|Highlight)/s,
    );
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
    expect(Object.keys(declarations)).not.toContain("position");
    expect(Object.keys(declarations)).not.toContain("top");
    expect(Object.keys(declarations)).not.toContain("transform");
    expect(css).not.toMatch(/\.new-tab-button::(?:before|after)/);
    expect(rule.toString()).not.toMatch(/(?:mask|url\s*\()/);
    expect(css).not.toContain("add-tab.svg");
    expect(css).toMatch(
      /\.new-tab-glyph\s*{[^}]*display:\s*grid[^}]*place-items:\s*center[^}]*width:\s*100%[^}]*height:\s*100%[^}]*transform:\s*translateY\(-1px\)/s,
    );
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
      /\.history-search-option\s*{[^}]*grid-template-columns:\s*16px\s+minmax\(0,\s*1fr\)\s+auto[^}]*height:\s*30px/s,
    );
    expect(css).toMatch(
      /\.history-search-title\s*{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
    );
    expect(css).toMatch(
      /\.history-search-source\s*{[^}]*display:\s*inline-grid[^}]*place-items:\s*center[^}]*height:\s*18px[^}]*padding:\s*0\s+6px[^}]*border-radius:\s*9px[^}]*font-size:\s*11px[^}]*line-height:\s*18px[^}]*white-space:\s*nowrap[^}]*flex-shrink:\s*0/s,
    );
    expect(css).toMatch(
      /\.history-search-source\[data-source="bookmark"\]\s*{[^}]*background:\s*color-mix\(in srgb,\s*#1a73e8 14%,\s*Canvas\)[^}]*color:\s*#1558b0\s*;/s,
    );
    expect(css).toMatch(
      /\.history-search-source\[data-source="history"\]\s*{[^}]*background:\s*[^;}]+;[^}]*color:\s*GrayText\s*;/s,
    );
    expect(css).not.toMatch(/\.history-search-option\s+\.history-search-url/s);
  });

  it("uses a high-contrast fixed blue bookmark source in dark mode", () => {
    const darkBackground = "#174ea6";
    const darkColor = "#d2e3fc";

    expect(css).toMatch(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*{[\s\S]*?\.history-search-source\[data-source="bookmark"\]\s*{[^}]*background:\s*#174ea6\s*;[^}]*color:\s*#d2e3fc\s*;/s,
    );
    expect(contrastRatio(darkBackground, darkColor)).toBeGreaterThanOrEqual(4.5);
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
      /\.shortcut-button,\s*\.locate-active-tab-button\s*{[^}]*width:\s*32px[^}]*height:\s*32px[^}]*border-color:\s*transparent[^}]*background:\s*transparent/s,
    );
    expect(css).not.toMatch(/\.shortcut-button\s*{[^}]*display:\s*none/s);
    expect(css).toMatch(
      /\.locate-active-tab-button::before\s*{[^}]*width:\s*20px[^}]*height:\s*20px[^}]*mask:\s*url\("\.\.\/assets\/icons\/locate\.svg"\)/s,
    );
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

  it("uses a fixed 14px Microsoft YaHei menu font through the shared context-menu class", () => {
    expect(css).toMatch(
      /\.tab-context-menu\s*{[^}]*font-family:\s*"Microsoft YaHei",\s*"微软雅黑",\s*"Segoe UI",\s*system-ui,\s*sans-serif[^}]*font-size:\s*14px/s,
    );
    expect(css).not.toMatch(/\.tab-context-menu\s*{[^}]*var\(--tab-title-font-size\)/s);
  });

  it("styles compact group rows, controls, and titles", () => {
    expect(css).toMatch(
      /\.tab-group-row\s*{[^}]*height:\s*20px[^}]*min-width:\s*0/s,
    );
    expect(css).toMatch(
      /\.tab-group-main\s*{[^}]*grid-template-columns:\s*12px\s+minmax\(0,\s*1fr\)\s+auto[^}]*width:\s*100%[^}]*height:\s*20px[^}]*padding:\s*0\s+6px[^}]*border:\s*0/s,
    );
    expect(css).toMatch(/\.tab-group-chevron\s*{[^}]*width:\s*12px[^}]*height:\s*12px/s);
    expect(css).not.toMatch(/\.tab-group-color\s*{/);
    expect(css).toMatch(
      /\.tab-group-title\s*{[^}]*min-width:\s*0[^}]*font-family:\s*"Microsoft YaHei",\s*"微软雅黑",\s*"Segoe UI",\s*system-ui,\s*sans-serif[^}]*font-size:\s*14px[^}]*line-height:\s*20px[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
    );
    expect(css).not.toMatch(/\.tab-group-title\s*{[^}]*var\(--tab-title-font-size\)/s);
    expect(css).toMatch(
      /\.tab-group-count\s*{[^}]*width:\s*3ch[^}]*font-size:\s*12px[^}]*line-height:\s*20px[^}]*text-align:\s*right[^}]*font-variant-numeric:\s*tabular-nums[^}]*white-space:\s*nowrap/s,
    );
  });

  it("maps every Chrome group color with dark-theme overrides", () => {
    const darkMedia = css.match(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/s,
    )?.[1] ?? "";
    expect(darkMedia).not.toBe("");
    const lightColors = {
      grey: ["#80868b", "white"],
      blue: ["#1a73e8", "white"],
      red: ["#d93025", "white"],
      yellow: ["#f9ab00", "#202124"],
      green: ["#188038", "white"],
      pink: ["#d01884", "white"],
      purple: ["#a142f4", "#202124"],
      cyan: ["#007b83", "white"],
      orange: ["#fa7b17", "#202124"],
    } as const;
    const darkColors = {
      grey: "#bdc1c6",
      blue: "#8ab4f8",
      red: "#f28b82",
      yellow: "#fdd663",
      green: "#81c995",
      pink: "#ff8bcb",
      purple: "#c58af9",
      cyan: "#78d9ec",
      orange: "#fcad70",
    } as const;
    for (const [color, [background, foreground]] of Object.entries(lightColors)) {
      const selector = new RegExp(
        `\\.tab-group-row\\[data-group-color=["']${color}["']\\]\\s*{[^}]*background:\\s*${background}[^}]*color:\\s*${foreground}`,
        "s",
      );
      const darkSelector = new RegExp(
        `\\.tab-group-row\\[data-group-color=["']${color}["']\\]\\s*{[^}]*background:\\s*${darkColors[color as keyof typeof darkColors]}[^}]*color:\\s*#202124`,
        "s",
      );
      expect(css).toMatch(selector);
      expect(darkMedia).toMatch(darkSelector);
      expect(darkMedia).toMatch(
        new RegExp(`\\.group-menu-color\\[data-color=["']${color}["']\\]\\s*{[^}]*background:`, "s"),
      );
      expect(darkMedia).toMatch(
        new RegExp(`#tab-group-dialog\\s+input\\[type=["']radio["']\\]\\[name=["']tab-group-color["']\\]\\[value=["']${color}["']\\]\\s*{[^}]*background:`, "s"),
      );
    }
    expect(css).toMatch(
      /\.tab-group-main:hover:not\(:disabled\)\s*{[^}]*background:\s*color-mix\([^}]*transparent\)/s,
    );
    expect(css).toMatch(
      /\.tab-group-main:active:not\(:disabled\)\s*{[^}]*background:\s*color-mix\([^}]*transparent\)/s,
    );
  });

  it("shares bounded menu foundations while keeping submenu rules differential", () => {
    const menuRule = css.match(/\.tab-context-menu\s*{[^}]*}/s)?.[0] ?? "";
    expect(menuRule).toMatch(/position:\s*fixed/);
    expect(menuRule).toMatch(/max-height:\s*calc\(100vh\s*-\s*8px\)/);
    expect(menuRule).toMatch(/overflow-y:\s*auto/);
    expect(menuRule).toMatch(
      /font-family:\s*"Microsoft YaHei",\s*"微软雅黑",\s*"Segoe UI",\s*system-ui,\s*sans-serif/,
    );
    expect(menuRule).toMatch(/font-size:\s*14px/);
    expect(menuRule).not.toMatch(/var\(--tab-title-font-size\)/);

    const submenuRule = css.match(/\.tab-context-submenu\s*{[^}]*}/s)?.[0] ?? "";
    expect(submenuRule).toMatch(/z-index:\s*21/);
    expect(submenuRule).toMatch(/min-width:\s*min\(152px,\s*100vw\)/);
    expect(submenuRule).not.toMatch(
      /(?:position|display|padding|border|background|box-shadow|font-family|font-size|max-height|overflow-y):/,
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
    expect(forcedColors).toMatch(
      /\.tab-row\[data-context-selected="true"\]\s*{[^}]*outline:\s*1px\s+solid\s+Highlight[^}]*outline-offset:\s*-1px/s,
    );
    expect(forcedColors).toMatch(
      /\.tab-context-separator\s*{[^}]*background:\s*CanvasText/s,
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

  it("styles the name-only group rename dialog compactly at narrow widths", () => {
    expect(css).toMatch(
      /#tab-group-rename-dialog\s*{[^}]*width:\s*min\(300px,\s*calc\(100vw\s*-\s*8px\)\)[^}]*max-width:\s*300px[^}]*overflow-x:\s*hidden[^}]*font-family:\s*"Microsoft YaHei",\s*"微软雅黑",\s*"Segoe UI",\s*system-ui,\s*sans-serif/s,
    );
    expect(css).toMatch(
      /#tab-group-rename-form\s*{[^}]*display:\s*grid[^}]*gap:\s*10px[^}]*min-width:\s*0[^}]*padding:\s*12px/s,
    );
    expect(css).toMatch(
      /#tab-group-rename-name\s*{[^}]*width:\s*100%[^}]*height:\s*32px[^}]*padding:\s*0\s+7px/s,
    );
    expect(css).toMatch(
      /#tab-group-rename-error\s*{[^}]*margin:\s*0[^}]*color:\s*MarkText[^}]*background:\s*Mark[^}]*overflow-wrap:\s*anywhere/s,
    );
    expect(css).toMatch(/#tab-group-rename-error:empty\s*{[^}]*display:\s*none/s);
    expect(css).toMatch(/#tab-group-rename-dialog\s+\.dialog-actions\s*{[^}]*justify-content:\s*flex-end/s);

    const narrow180 = css.slice(
      css.indexOf("@media (max-width: 180px)"),
      css.indexOf("@media (pointer: coarse)"),
    );
    expect(narrow180).toMatch(
      /#tab-group-rename-dialog\s*{[^}]*width:\s*calc\(100vw\s*-\s*8px\)[^}]*max-width:\s*calc\(100vw\s*-\s*8px\)/s,
    );
    expect(narrow180).toMatch(/#tab-group-rename-form\s*{[^}]*padding:\s*8px/s);
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

  it("styles group drag sources and block boundaries without layout shifts", () => {
    expect(css).toMatch(
      /\.tab-group-row\[data-drag-group-source="true"\],\s*\.tab-row\[data-drag-group-source="true"\]\s*\{[^}]*opacity:\s*0\.55/s,
    );
    expect(css).toMatch(/\.tab-group-row\[data-drop-placement="before"\]::before/s);
    expect(css).toMatch(/\.tab-group-row\[data-drop-placement="after"\]::after/s);
    const indicatorRule = css.match(
      /\.tab-row\[data-drop-placement="before"\]::before,[\s\S]*?\{[^}]*}/s,
    )?.[0] ?? "";
    expect(indicatorRule).toMatch(/position:\s*absolute/);
    expect(indicatorRule).toMatch(/height:\s*2px/);
    expect(indicatorRule).toMatch(/background:\s*AccentColor/);
    expect(indicatorRule).not.toMatch(/(?:margin|padding|width):/);
  });

  it("uses logical indentation for tree leaves and depth-aware drop lines", () => {
    expect(css).toMatch(
      /\.tab-tree-leaf\s*\{[^}]*inset-inline-start:\s*calc\(10px \+ var\(--tab-tree-indent, 0px\)\)[^}]*width:\s*4px[^}]*height:\s*4px[^}]*background:\s*GrayText/s,
    );
    expect(css).toMatch(
      /\.tab-row\[data-active-descendant="true"\][^{]*\{[^}]*color:\s*AccentColor/s,
    );
    expect(css).toMatch(/\.tab-list\[data-drop-placement="after"\]::after/s);
    expect(css).toMatch(/inset-inline-start:\s*var\(--drop-depth-indent, 4px\)/s);
    expect(css).toMatch(/inset-inline-end:\s*4px/s);
    expect(css).not.toMatch(/--drop-depth-indent[^;]*transition/);
  });

  it("uses adaptive menu surfaces and inert context separators", () => {
    expect(css).toMatch(
      /\.tab-context-menu\s*\{[^}]*background:\s*color-mix\(in\s+srgb,\s*CanvasText\s+4%,\s*Canvas\)/s,
    );
    expect(css).toMatch(
      /\.tab-context-separator\s*\{[^}]*height:\s*1px[^}]*margin:\s*4px\s+6px[^}]*background:\s*color-mix\(in\s+srgb,\s*CanvasText\s+18%,\s*transparent\)[^}]*pointer-events:\s*none/s,
    );
  });

  it("keeps the active marker for ungrouped tabs while outlining context-selected tabs", () => {
    expect(css).toMatch(
      /\.tab-row\[data-active="true"\]\s*\{[^}]*background:\s*#fff3bf[^}]*box-shadow:\s*inset\s+2px\s+0\s+AccentColor/s,
    );
    expect(css).toMatch(/\.tab-row:hover:not\(\[data-active="true"\]\)\s*\{[^}]*background:\s*ButtonFace/s);
    expect(css).toMatch(
      /\.tab-row\[data-context-selected="true"\]\s*\{[^}]*box-shadow:\s*inset\s+0\s+0\s+0\s+1px\s+#1a73e8/s,
    );
    expect(css).toMatch(
      /\.tab-row\[data-active="true"\]\[data-context-selected="true"\]\s*\{[^}]*box-shadow:\s*inset\s+2px\s+0\s+AccentColor\s*,\s*inset\s+0\s+0\s+0\s+1px\s+#1a73e8/s,
    );

    const contextRule = css.match(/\.tab-row\[data-context-selected="true"\]\s*\{[^}]*}/s)?.[0] ?? "";
    expect(contextRule).not.toMatch(/(?:background|border|width|height|padding|margin):/);
    expect(contextRule).not.toMatch(/inset\s+2px\s+0/);

    const darkMedia = css.match(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/s,
    )?.[1] ?? "";
    expect(darkMedia).toMatch(
      /\.tab-row\[data-active="true"\]\s*\{[^}]*background:\s*#4a3f18/s,
    );
    expect(darkMedia).toMatch(
      /\.tab-row\[data-context-selected="true"\]\s*\{[^}]*box-shadow:\s*inset\s+0\s+0\s+0\s+1px\s+#8ab4f8/s,
    );
    expect(darkMedia).toMatch(
      /\.tab-row\[data-active="true"\]\[data-context-selected="true"\]\s*\{[^}]*box-shadow:\s*inset\s+2px\s+0\s+AccentColor\s*,\s*inset\s+0\s+0\s+0\s+1px\s+#8ab4f8/s,
    );
  });

  it("removes the active rail for grouped tabs while retaining the context outline", () => {
    expect(css).toMatch(
      /\.tab-row\[data-group-id\]\[data-active="true"\]\s*\{[^}]*box-shadow:\s*none/s,
    );
    expect(css).toMatch(
      /\.tab-row\[data-group-id\]\[data-active="true"\]\[data-context-selected="true"\]\s*\{[^}]*box-shadow:\s*inset\s+0\s+0\s+0\s+1px\s+#1a73e8/s,
    );
    const groupedContextRule = css.match(
      /\.tab-row\[data-group-id\]\[data-active="true"\]\[data-context-selected="true"\]\s*\{[^}]*}/s,
    )?.[0] ?? "";
    expect(groupedContextRule).not.toMatch(/AccentColor/);

    const darkMedia = css.match(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/s,
    )?.[1] ?? "";
    expect(darkMedia).toMatch(
      /\.tab-row\[data-group-id\]\[data-active="true"\]\[data-context-selected="true"\]\s*\{[^}]*box-shadow:\s*inset\s+0\s+0\s+0\s+1px\s+#8ab4f8/s,
    );
    const darkGroupedContextRule = darkMedia.match(
      /\.tab-row\[data-group-id\]\[data-active="true"\]\[data-context-selected="true"\]\s*\{[^}]*}/s,
    )?.[0] ?? "";
    expect(darkGroupedContextRule).not.toMatch(/AccentColor/);

    const forcedColors = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(forcedColors).toMatch(
      /\.tab-row\[data-active="true"\]\s*\{[^}]*background:\s*ButtonFace/s,
    );
    expect(forcedColors).toMatch(
      /\.tab-row\[data-group-id\]\s*\{[^}]*--member-group-color:\s*CanvasText/s,
    );
    expect(forcedColors).toMatch(
      /\.tab-row\[data-context-selected="true"\]\s*\{[^}]*outline:\s*1px\s+solid\s+Highlight[^}]*outline-offset:\s*-1px/s,
    );
  });

  it("styles the group context target and fixed color submenu without changing row size", () => {
    expect(css).toMatch(
      /\.tab-group-color-submenu\s*>\s*button\s*{[^}]*display:\s*grid[^}]*grid-template-columns:\s*8px\s+minmax\(0,\s*1fr\)[^}]*gap:\s*6px/s,
    );
    expect(css).toMatch(
      /\.tab-group-row\[data-context-selected="true"\]\s*{[^}]*box-shadow:\s*inset\s+0\s+0\s+0\s+1px\s+#1a73e8/s,
    );
    expect(css).toMatch(
      /\.tab-group-row\[data-context-selected="true"\]\[data-group-color="blue"\]\s*{[^}]*box-shadow:\s*inset\s+0\s+0\s+0\s+1px\s+#1a73e8\s*,\s*inset\s+0\s+0\s+0\s+2px\s+Canvas/s,
    );
    const groupContextRule = css.match(
      /\.tab-group-row\[data-context-selected="true"\]\s*{[^}]*}/s,
    )?.[0] ?? "";
    expect(groupContextRule).not.toMatch(/(?:background|border|width|height|padding|margin):/);

    const darkMedia = css.match(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/s,
    )?.[1] ?? "";
    expect(darkMedia).toMatch(
      /\.tab-group-row\[data-context-selected="true"\]\s*{[^}]*box-shadow:\s*inset\s+0\s+0\s+0\s+1px\s+#8ab4f8/s,
    );
    expect(darkMedia).toMatch(
      /\.tab-group-row\[data-context-selected="true"\]\[data-group-color="blue"\]\s*{[^}]*#8ab4f8[^}]*Canvas/s,
    );

    const forcedColors = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(forcedColors).toMatch(
      /\.tab-group-row\[data-context-selected="true"\]\s*{[^}]*outline:\s*1px\s+solid\s+Highlight[^}]*outline-offset:\s*-1px/s,
    );
  });

});
