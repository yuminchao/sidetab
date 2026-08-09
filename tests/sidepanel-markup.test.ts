import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const document = new DOMParser().parseFromString(
  readFileSync("src/sidepanel/index.html", "utf8"),
  "text/html",
);

describe("side panel settings markup", () => {
  it("renders the accessible new-tab control with a centered text glyph", () => {
    const button = document.querySelector<HTMLButtonElement>("#new-tab-button");
    const glyph = button?.querySelector<HTMLElement>(".new-tab-glyph");

    expect(button?.type).toBe("button");
    expect(button?.title).toBe("新建标签页");
    expect(button?.getAttribute("aria-label")).toBe("新建标签页");
    expect(button?.textContent?.trim()).toBe("+");
    expect(button?.childNodes).toHaveLength(1);
    expect(button?.firstElementChild).toBe(glyph);
    expect(glyph?.textContent).toBe("+");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(button?.querySelector("svg, img")).toBeNull();
  });

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
    const shell = document.querySelector<HTMLElement>(".search-shell");
    const results = document.querySelector<HTMLElement>("#history-search-results");
    const input = document.querySelector<HTMLInputElement>("#tab-search");
    const button = document.querySelector<HTMLButtonElement>("#shortcut-settings");

    expect(shell?.parentElement?.classList.contains("bottom-toolbar")).toBe(true);
    expect(results?.getAttribute("aria-label")).toBe("收藏夹和历史记录搜索结果");
    expect(Array.from(shell?.children ?? [])).toEqual([input, button]);
    expect(input?.placeholder).toBe("搜索收藏夹和历史记录");
    expect(input?.getAttribute("aria-label")).toBe("搜索收藏夹和历史记录");
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.title).toBe("设置");
    expect(button?.getAttribute("aria-label")).toBe("设置");
    expect(button?.textContent?.trim()).toBe("");
  });

  it("provides an independent tab group dialog with name and actions", () => {
    const dialog = document.querySelector<HTMLDialogElement>("#tab-group-dialog");
    const form = dialog?.querySelector<HTMLFormElement>("#tab-group-form");
    const name = form?.querySelector<HTMLInputElement>("#tab-group-name");
    const error = form?.querySelector<HTMLElement>("#tab-group-error");
    const cancel = form?.querySelector<HTMLButtonElement>("#tab-group-cancel");
    const create = form?.querySelector<HTMLButtonElement>("#tab-group-create");

    expect(dialog).not.toBeNull();
    expect(dialog).not.toBe(document.querySelector("#shortcut-dialog"));
    expect(dialog?.getAttribute("aria-labelledby")).toBe("tab-group-dialog-title");
    expect(form?.getAttribute("method")).toBe("dialog");
    expect(name?.type).toBe("text");
    expect(name?.required).toBe(false);
    expect(error?.getAttribute("role")).toBe("alert");
    expect(cancel).toMatchObject({ type: "button", textContent: "取消" });
    expect(create).toMatchObject({ type: "submit", textContent: "创建" });
  });

  it("provides all nine Chrome colors as labelled radio inputs with grey selected", () => {
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>(
      "#tab-group-dialog input[type='radio'][name='tab-group-color']",
    ));

    expect(radios.map((radio) => radio.value)).toEqual([
      "grey",
      "blue",
      "red",
      "yellow",
      "green",
      "pink",
      "purple",
      "cyan",
      "orange",
    ]);
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(["grey"]);
    for (const radio of radios) {
      expect(radio.getAttribute("aria-label")).not.toBe("");
    }
  });

  it("provides an independent name-only tab group rename dialog", () => {
    const dialog = document.querySelector<HTMLDialogElement>("#tab-group-rename-dialog");
    const form = dialog?.querySelector<HTMLFormElement>("#tab-group-rename-form");
    const title = dialog?.querySelector<HTMLElement>("#tab-group-rename-title");
    const name = form?.querySelector<HTMLInputElement>("#tab-group-rename-name");
    const label = form?.querySelector<HTMLLabelElement>("label[for='tab-group-rename-name']");
    const error = form?.querySelector<HTMLElement>("#tab-group-rename-error");
    const cancel = form?.querySelector<HTMLButtonElement>("#tab-group-rename-cancel");
    const save = form?.querySelector<HTMLButtonElement>("#tab-group-rename-save");

    expect(dialog).not.toBeNull();
    expect(dialog).not.toBe(document.querySelector("#tab-group-dialog"));
    expect(dialog?.getAttribute("aria-labelledby")).toBe("tab-group-rename-title");
    expect(title?.textContent).toBe("重命名分组");
    expect(form?.getAttribute("method")).toBe("dialog");
    expect(form?.hasAttribute("novalidate")).toBe(true);
    expect(label?.textContent).toContain("名称");
    expect(name).toMatchObject({ type: "text", autocomplete: "off", required: false });
    expect(error?.getAttribute("role")).toBe("alert");
    expect(cancel).toMatchObject({ type: "button", textContent: "取消" });
    expect(save).toMatchObject({ type: "submit", textContent: "保存" });
    expect(dialog?.querySelector("fieldset, input[type='radio'], .settings-card")).toBeNull();
  });
});
