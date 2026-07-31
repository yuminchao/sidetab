import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const document = new DOMParser().parseFromString(
  readFileSync("src/sidepanel/index.html", "utf8"),
  "text/html",
);

describe("side panel settings markup", () => {
  it("keeps the new-tab control accessible without a visible text glyph", () => {
    const button = document.querySelector<HTMLButtonElement>("#new-tab-button");

    expect(button?.type).toBe("button");
    expect(button?.title).toBe("新建标签页");
    expect(button?.getAttribute("aria-label")).toBe("新建标签页");
    expect(button?.textContent?.trim()).toBe("");
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
    const input = document.querySelector<HTMLInputElement>("#tab-search");
    const button = document.querySelector<HTMLButtonElement>("#shortcut-settings");

    expect(shell?.parentElement?.classList.contains("bottom-toolbar")).toBe(true);
    expect(Array.from(shell?.children ?? [])).toEqual([input, button]);
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
});
