import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createShortcutRenderer } from "../src/sidepanel/shortcut-renderer";
import { createDefaultShortcutSettings } from "../src/sidepanel/shortcut-model";
import type { RestoreSettings } from "../src/group-restore/settings";

function setup() {
  document.documentElement.innerHTML = readFileSync("src/sidepanel/index.html", "utf8");
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
  const dialog = document.getElementById("shortcut-dialog") as HTMLDialogElement;
  const form = document.getElementById("shortcut-form") as HTMLFormElement;
  dialog.showModal = () => dialog.setAttribute("open", "");
  dialog.close = () => { dialog.removeAttribute("open"); dialog.dispatchEvent(new Event("close")); };
  let saved: RestoreSettings = { enabled: false, collapsed: true };
  const renderer = createShortcutRenderer({
    strip: document.getElementById("shortcut-strip")!, dialog, form,
    enabled: input("shortcut-enabled"), fontSize: input("tab-title-font-size"),
    contentTreeEnabled: input("content-tree-enabled"), floatingBallEnabled: input("floating-ball-enabled"),
    restoreEnabled: input("group-restore-enabled"),
    restoreCollapsed: document.getElementById("group-restore-state") as HTMLSelectElement,
    editor: document.getElementById("shortcut-editor-list")!, error: document.getElementById("shortcut-error")!,
    add: button("shortcut-add"), reset: button("shortcut-reset"), settingsButton: button("shortcut-settings"),
  }, {
    onOpen() {}, onSave: async (settings) => settings,
    onRestoreSettingsSave: async (settings) => { saved = settings; },
  });
  renderer.openSettings(createDefaultShortcutSettings());
  return { renderer, form, dialog, input, button, saved: () => saved };
}

describe("分组恢复设置界面", () => {
  it("保存开启及展开选择，重新打开保留选择", async () => {
    const ui = setup();
    ui.input("group-restore-enabled").checked = true;
    ui.input("group-restore-state").value = "expanded";
    ui.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(ui.dialog.open).toBe(false));
    expect(ui.saved()).toEqual({ enabled: true, collapsed: false });
    ui.renderer.openSettings(createDefaultShortcutSettings());
    expect(ui.input("group-restore-enabled").checked).toBe(true);
    expect(ui.input("group-restore-state").value).toBe("expanded");
    ui.renderer.destroy();
  });

  it("取消不保存草稿", () => {
    const ui = setup();
    ui.input("group-restore-enabled").checked = true;
    ui.button("shortcut-cancel").click();
    ui.renderer.openSettings(createDefaultShortcutSettings());
    expect(ui.input("group-restore-enabled").checked).toBe(false);
    expect(ui.saved()).toEqual({ enabled: false, collapsed: true });
    ui.renderer.destroy();
  });

  it("恢复默认后保存关闭及折叠", async () => {
    const ui = setup();
    ui.renderer.setRestoreSettings({ enabled: true, collapsed: false });
    ui.renderer.openSettings(createDefaultShortcutSettings());
    ui.button("shortcut-reset").click();
    expect(ui.input("group-restore-enabled").checked).toBe(false);
    expect(ui.input("group-restore-state").value).toBe("collapsed");
    ui.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(ui.dialog.open).toBe(false));
    expect(ui.saved()).toEqual({ enabled: false, collapsed: true });
    ui.renderer.destroy();
  });
});
