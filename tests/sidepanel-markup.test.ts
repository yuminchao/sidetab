import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const document = new JSDOM(
  readFileSync("src/sidepanel/index.html", "utf8"),
).window.document;

describe("side panel settings markup", () => {
  it("provides a static Chrome appearance settings entry", () => {
    const row = document.querySelector<HTMLElement>(".appearance-setting");
    const link = document.querySelector<HTMLButtonElement>(
      "#chrome-appearance-settings",
    );

    expect(row?.textContent).toContain("侧边栏位置");
    expect(row?.textContent).toContain("请在 Chrome 外观设置中修改");
    expect(link?.type).toBe("button");
    expect(link?.title).toBe("打开 Chrome 外观设置");
    expect(link?.getAttribute("aria-label")).toBe("打开 Chrome 外观设置");
  });

  it("keeps the bottom settings control as an accessible icon button", () => {
    const button = document.querySelector<HTMLButtonElement>("#shortcut-settings");

    expect(button?.tagName).toBe("BUTTON");
    expect(button?.title).toBe("设置");
    expect(button?.getAttribute("aria-label")).toBe("设置");
    expect(button?.textContent?.trim()).toBe("⚙");
  });
});
