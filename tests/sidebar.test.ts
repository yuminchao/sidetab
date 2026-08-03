import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultShortcutSettings,
  type ShortcutSettings,
} from "../src/sidepanel/shortcut-model";
import { startSidebar, type SidebarDependencies } from "../src/sidepanel/sidebar";
import { TabStore } from "../src/sidepanel/tab-store";
import { createFakeChrome, deferred, fakeGroup, fakeTab } from "./helpers/fake-chrome";

function installFixture(): void {
  delete document.documentElement.dataset.ready;
  document.documentElement.style.removeProperty("--tab-title-font-size");
  document.body.innerHTML = `
    <div id="shortcut-strip" hidden></div>
    <input id="tab-search" />
    <div id="history-search-results" role="listbox" hidden></div>
    <button id="shortcut-settings"></button>
    <p id="status-message"></p>
    <section id="tab-region">
      <p id="tab-empty" hidden></p>
      <div id="tab-scroll">
        <div id="tab-list" role="list"></div>
        <button
          id="new-tab-button"
          type="button"
          title="新建标签页"
          aria-label="新建标签页"
        >+</button>
      </div>
    </section>
    <dialog id="shortcut-dialog">
      <form id="shortcut-form">
        <h2 id="shortcut-dialog-title"></h2>
        <input id="tab-title-font-size" type="number" min="12" max="18" step="1" />
        <button id="chrome-appearance-settings" type="button"></button>
        <input id="shortcut-enabled" type="checkbox" />
        <div id="shortcut-editor-list"></div>
        <p id="shortcut-error"></p>
        <button id="shortcut-add" type="button"></button>
        <button id="shortcut-reset" type="button"></button>
        <button id="shortcut-cancel" data-action="cancel" type="button"></button>
        <button id="shortcut-save" type="submit"></button>
      </form>
    </dialog>
    <dialog id="tab-group-dialog">
      <form id="tab-group-form">
        <input id="tab-group-name" />
        <input type="radio" name="tab-group-color" value="grey" checked />
        <input type="radio" name="tab-group-color" value="blue" />
        <p id="tab-group-error"></p>
        <button id="tab-group-cancel" type="button"></button>
        <button id="tab-group-create" type="submit"></button>
      </form>
    </dialog>
    <dialog id="tab-group-rename-dialog">
      <form id="tab-group-rename-form">
        <input id="tab-group-rename-name" />
        <p id="tab-group-rename-error"></p>
        <button id="tab-group-rename-cancel" type="button"></button>
        <button id="tab-group-rename-save" type="submit"></button>
      </form>
    </dialog>`;
  for (const id of ["shortcut-dialog", "tab-group-dialog", "tab-group-rename-dialog"]) {
    const dialog = element<HTMLDialogElement>(id);
    dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""));
    dialog.close = vi.fn(() => {
      dialog.removeAttribute("open");
      dialog.dispatchEvent(new Event("close"));
    });
  }
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`missing fixture element ${id}`);
  return value as T;
}

function rowIds(): number[] {
  return Array.from(element("tab-list").querySelectorAll(".tab-row"), (row) =>
    Number((row as HTMLElement).dataset.tabId),
  );
}

function groupRow(id: number): HTMLElement {
  const match = element("tab-list").querySelector<HTMLElement>(
    `.tab-group-row[data-group-id="${id}"]`,
  );
  if (!match) throw new Error(`missing group row ${id}`);
  return match;
}

function row(id: number): HTMLElement {
  const match = Array.from(element("tab-list").children).find(
    (candidate) => (candidate as HTMLElement).dataset.tabId === String(id),
  );
  if (!(match instanceof HTMLElement)) throw new Error(`missing row ${id}`);
  return match;
}

function click(target: Element): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function contextMenuItem(action: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-menu-action='${action}']`)!;
}

function openTabContextMenu(tabId: number): void {
  row(tabId).dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
}

function openGroupContextMenu(groupId: number): void {
  groupRow(groupId).dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
}

function groupContextMenuItem(action: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`[data-group-menu-action='${action}']`)!;
}

function mixedTabs(): chrome.tabs.Tab[] {
  return [
    fakeTab({ id: 1, index: 0, pinned: true, title: "Pinned one" }),
    fakeTab({ id: 2, index: 1, active: true, title: "Current" }),
    fakeTab({ id: 3, index: 2, pinned: true, title: "Pinned three" }),
    fakeTab({ id: 4, index: 3, title: "Four" }),
    fakeTab({ id: 5, index: 4, title: "Five" }),
  ];
}

function recentlyClosedTabSession(sessionId: string): chrome.sessions.Session {
  return {
    lastModified: 0,
    tab: fakeTab({ sessionId }),
  };
}

function input(value: string): void {
  const search = element<HTMLInputElement>("tab-search");
  search.value = value;
  search.dispatchEvent(new Event("input", { bubbles: true }));
}

function shortcutImage(id = "docs"): HTMLImageElement | null {
  return element("shortcut-strip").querySelector<HTMLImageElement>(
    `.shortcut-button[data-shortcut-id="${id}"] img`,
  );
}

function enabledShortcuts(
  items = [{ id: "docs", name: "Docs", url: "https://docs.example/", icon: "letter" }],
): Record<string, unknown> {
  return {
    shortcutSettings: {
      enabled: true,
      items,
      tabTitleFontSize: 14,
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("sidebar lifecycle", () => {
  beforeEach(() => {
    installFixture();
  });

  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("subscribes to tab and group events before starting both snapshot queries", async () => {
    const tabs = deferred<chrome.tabs.Tab[]>();
    const groups = deferred<chrome.tabGroups.TabGroup[]>();
    const fake = createFakeChrome();
    fake.methods.query.mockReturnValueOnce(tabs.promise);
    fake.methods.groupQuery.mockReturnValueOnce(groups.promise);

    const started = startSidebar(fake);
    await vi.waitFor(() => {
      expect(fake.methods.query).toHaveBeenCalledWith({ windowId: 10 });
      expect(fake.methods.groupQuery).toHaveBeenCalledWith({ windowId: 10 });
    });

    for (const event of Object.values(fake.events)) expect(event.listenerCount).toBe(1);
    for (const event of Object.values(fake.groupEvents)) expect(event.listenerCount).toBe(1);

    fake.groupEvents.onCreated.emit(fakeGroup({ id: 7, title: "Buffered" }));
    fake.events.onCreated.emit(fakeTab({ id: 2, index: 1, groupId: 7 }));
    fake.groupEvents.onUpdated.emit(fakeGroup({ id: 7, title: "Latest" }));
    tabs.resolve([fakeTab({ id: 1, index: 0 })]);
    await flush();
    expect(document.documentElement.dataset.ready).toBeUndefined();
    groups.resolve([]);

    const cleanup = await started;
    expect(rowIds()).toEqual([1, 2]);
    expect(groupRow(7).querySelector(".tab-group-title")?.textContent).toBe("Latest");
    cleanup();
  });

  it("replays buffered tab updates over an older snapshot in receive order", async () => {
    const tabs = deferred<chrome.tabs.Tab[]>();
    const groups = deferred<chrome.tabGroups.TabGroup[]>();
    const fake = createFakeChrome();
    fake.methods.query.mockReturnValueOnce(tabs.promise);
    fake.methods.groupQuery.mockReturnValueOnce(groups.promise);

    const started = startSidebar(fake);
    await vi.waitFor(() => expect(fake.methods.query).toHaveBeenCalledOnce());

    fake.events.onUpdated.emit(
      1,
      { title: "Buffered first" },
      fakeTab({ id: 1, title: "Buffered first" }),
    );
    fake.events.onUpdated.emit(
      1,
      { title: "Buffered latest" },
      fakeTab({ id: 1, title: "Buffered latest" }),
    );
    tabs.resolve([fakeTab({ id: 1, title: "Older snapshot" })]);
    groups.resolve([]);

    const cleanup = await started;
    expect(row(1).querySelector(".tab-title")?.textContent).toBe("Buffered latest");
    cleanup();
  });

  it("replays buffered group moves and removals into the final UI order", async () => {
    const tabs = deferred<chrome.tabs.Tab[]>();
    const groups = deferred<chrome.tabGroups.TabGroup[]>();
    const fake = createFakeChrome();
    fake.methods.query.mockReturnValueOnce(tabs.promise);
    fake.methods.groupQuery.mockReturnValueOnce(groups.promise);

    const started = startSidebar(fake);
    await vi.waitFor(() => expect(fake.methods.groupQuery).toHaveBeenCalledOnce());

    fake.groupEvents.onMoved.emit(fakeGroup({ id: 8, title: "Moved latest" }));
    fake.events.onMoved.emit(2, { windowId: 10, fromIndex: 1, toIndex: 0 });
    fake.groupEvents.onRemoved.emit(fakeGroup({ id: 7, title: "Removed" }));
    tabs.resolve([
      fakeTab({ id: 1, index: 0, groupId: 7, title: "One" }),
      fakeTab({ id: 2, index: 1, groupId: 8, title: "Two" }),
      fakeTab({ id: 3, index: 2, groupId: -1, title: "Three" }),
    ]);
    groups.resolve([
      fakeGroup({ id: 7, title: "Older seven" }),
      fakeGroup({ id: 8, title: "Older eight" }),
    ]);

    const cleanup = await started;
    const itemOrder = Array.from(element("tab-list").children, (item) => {
      const row = item as HTMLElement;
      return row.dataset.groupId === undefined
        ? `tab:${row.dataset.tabId}`
        : `group:${row.dataset.groupId}`;
    });
    expect(itemOrder).toEqual(["group:8", "tab:2", "tab:1", "tab:3"]);
    expect(groupRow(8).querySelector(".tab-group-title")?.textContent).toBe("Moved latest");
    expect(document.querySelector(".tab-group-row[data-group-id='7']")).toBeNull();
    cleanup();
  });

  it("keeps tabs usable and reports a group snapshot failure", async () => {
    const fake = createFakeChrome({ tabs: [fakeTab({ id: 8 })] });
    fake.methods.groupQuery.mockRejectedValueOnce(new Error("groups failed"));

    const cleanup = await startSidebar(fake);

    expect(rowIds()).toEqual([8]);
    expect(element("status-message").textContent).toBe("无法读取当前窗口的标签分组");
    expect(fake.events.onCreated.listenerCount).toBe(1);
    expect(fake.groupEvents.onCreated.listenerCount).toBe(1);
    cleanup();
  });

  it("loads the current window and shortcuts with exact arguments and renders initial state", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 2, index: 1, title: "Second" }),
        fakeTab({ id: 1, index: 0, title: "First" }),
      ],
    });

    const cleanup = await startSidebar(fake);

    expect(fake.methods.getCurrent).toHaveBeenCalledWith();
    expect(fake.methods.query).toHaveBeenCalledWith({ windowId: 10 });
    expect(fake.methods.storageGet).toHaveBeenCalledWith("shortcutSettings");
    expect(rowIds()).toEqual([1, 2]);
    expect(element("shortcut-strip").hidden).toBe(false);
    expect(
      Array.from(element("shortcut-strip").querySelectorAll(".shortcut-button"), (button) =>
        (button as HTMLElement).dataset.shortcutId,
      ),
    ).toEqual(["openai", "google", "github"]);
    expect(document.documentElement.style.getPropertyValue("--tab-title-font-size")).toBe("16px");
    cleanup();
  });

  it.each(["tabs-first", "shortcuts-first"] as const)(
    "uses the initial tab favicon when %s initialization wins the race",
    async (order) => {
      const query = deferred<chrome.tabs.Tab[]>();
      const storage = deferred<Record<string, unknown>>();
      const fake = createFakeChrome();
      fake.methods.query.mockReturnValueOnce(query.promise);
      fake.methods.storageGet.mockReturnValueOnce(storage.promise);
      const started = startSidebar(fake);
      await vi.waitFor(() => expect(fake.methods.query).toHaveBeenCalledOnce());

      const tabs = [
        fakeTab({
          id: 7,
          active: true,
          url: "https://docs.example/guide",
          favIconUrl: "data:image/png;base64,docs-initial",
        }),
      ];
      if (order === "tabs-first") {
        query.resolve(tabs);
        await flush();
        storage.resolve(enabledShortcuts());
      } else {
        storage.resolve(enabledShortcuts());
        await flush();
        query.resolve(tabs);
      }

      const cleanup = await started;
      expect(shortcutImage()?.getAttribute("src")).toBe(
        "data:image/png;base64,docs-initial",
      );
      cleanup();
    },
  );

  it("prefers live shortcut favicons and otherwise restores persisted cached URLs", async () => {
    const fake = createFakeChrome({
      stored: {
        ...enabledShortcuts([
          { id: "docs", name: "Docs", url: "https://docs.example/", icon: "letter" },
          { id: "wiki", name: "Wiki", url: "https://wiki.example/", icon: "letter" },
        ]),
        shortcutFaviconCacheV1: {
          "https://docs.example": "https://cache.example/docs.png",
          "https://wiki.example": "https://cache.example/wiki.png",
        },
      },
      tabs: [
        fakeTab({
          url: "https://docs.example/page",
          favIconUrl: "https://live.example/docs.png",
        }),
      ],
    });

    const cleanup = await startSidebar(fake);

    expect(shortcutImage("docs")?.getAttribute("src")).toBe(
      "https://live.example/docs.png",
    );
    expect(shortcutImage("wiki")?.getAttribute("src")).toBe(
      "https://cache.example/wiki.png",
    );
    cleanup();
  });

  it("learns loaded shortcut favicons in one coalesced cache snapshot", async () => {
    const fake = createFakeChrome({
      stored: enabledShortcuts([
        { id: "docs", name: "Docs", url: "https://docs.example/", icon: "letter" },
        { id: "wiki", name: "Wiki", url: "https://wiki.example/", icon: "letter" },
      ]),
    });
    const cleanup = await startSidebar(fake);
    shortcutImage("docs")?.dispatchEvent(new Event("load"));
    shortcutImage("wiki")?.dispatchEvent(new Event("load"));

    await vi.waitFor(() => expect(fake.methods.storageSet).toHaveBeenCalledOnce());
    expect(fake.methods.storageSet).toHaveBeenCalledWith({
      shortcutFaviconCacheV1: {
        "https://docs.example": "https://docs.example/favicon.ico",
        "https://wiki.example": "https://wiki.example/favicon.ico",
      },
    });
    cleanup();
  });

  it("evicts a failed cached shortcut favicon and continues with the root candidate", async () => {
    const fake = createFakeChrome({
      stored: {
        ...enabledShortcuts([
          { id: "docs", name: "Docs", url: "https://docs.example/", icon: "letter" },
        ]),
        shortcutFaviconCacheV1: {
          "https://docs.example": "https://cache.example/docs.png",
        },
      },
    });
    const cleanup = await startSidebar(fake);
    const image = shortcutImage("docs")!;

    image.dispatchEvent(new Event("error"));

    expect(image.getAttribute("src")).toBe("https://docs.example/favicon.ico");
    await vi.waitFor(() => expect(fake.methods.storageSet).toHaveBeenCalledOnce());
    expect(fake.methods.storageSet).toHaveBeenCalledWith({ shortcutFaviconCacheV1: {} });
    cleanup();
  });

  it("continues startup when the favicon cache cannot be read", async () => {
    const fake = createFakeChrome({ stored: enabledShortcuts() });
    fake.methods.storageGet.mockImplementation(async (key: string) => {
      if (key === "shortcutFaviconCacheV1") throw new Error("cache unavailable");
      return enabledShortcuts();
    });

    const cleanup = await startSidebar(fake);

    expect(document.documentElement.dataset.ready).toBe("true");
    expect(shortcutImage("docs")?.getAttribute("src")).toBe(
      "https://docs.example/favicon.ico",
    );
    expect(element("status-message").textContent).toContain("无法读取快捷网站图标缓存");
    cleanup();
  });

  it("resyncs shortcut favicons from the complete tab store after live mutations", async () => {
    vi.useFakeTimers();
    const fake = createFakeChrome({
      stored: enabledShortcuts(),
      tabs: [
        fakeTab({
          id: 1,
          index: 0,
          active: true,
          title: "Hidden source",
          url: "https://docs.example/one",
          favIconUrl: "data:image/png;base64,one",
        }),
        fakeTab({
          id: 2,
          index: 1,
          url: "https://docs.example/two",
          favIconUrl: "data:image/png;base64,two",
        }),
      ],
    });
    const cleanup = await startSidebar(fake);

    fake.events.onUpdated.emit(
      1,
      { favIconUrl: "data:image/png;base64,one-updated" },
      fakeTab({
        id: 1,
        index: 0,
        active: true,
        title: "Hidden source",
        url: "https://docs.example/one",
        favIconUrl: "data:image/png;base64,one-updated",
      }),
    );
    expect(shortcutImage()?.getAttribute("src")).toBe(
      "data:image/png;base64,one-updated",
    );

    fake.events.onActivated.emit({ tabId: 2, windowId: 10 });
    expect(shortcutImage()?.getAttribute("src")).toBe("data:image/png;base64,two");

    input("does-not-match");
    await vi.advanceTimersByTimeAsync(100);
    expect(rowIds()).toEqual([1, 2]);
    expect(shortcutImage()?.getAttribute("src")).toBe("data:image/png;base64,two");

    fake.events.onDetached.emit(2, { oldWindowId: 10, oldPosition: 1 });
    expect(shortcutImage()?.getAttribute("src")).toBe(
      "data:image/png;base64,one-updated",
    );
    fake.events.onRemoved.emit(1, { windowId: 10, isWindowClosing: false });
    expect(shortcutImage()?.getAttribute("src")).toBe("https://docs.example/favicon.ico");

    cleanup();
  });

  it("keeps disabled shortcuts empty and stops favicon syncing after cleanup", async () => {
    const fake = createFakeChrome({
      stored: {
        shortcutSettings: {
          enabled: false,
          items: [{ id: "docs", name: "Docs", url: "https://docs.example/", icon: "letter" }],
          tabTitleFontSize: 16,
        },
      },
      tabs: [
        fakeTab({
          url: "https://docs.example/page",
          favIconUrl: "data:image/png;base64,hidden",
        }),
      ],
    });
    const cleanup = await startSidebar(fake);
    const strip = element("shortcut-strip");
    const replaceChildren = vi.spyOn(strip, "replaceChildren");

    expect(strip.hidden).toBe(true);
    expect(strip.childElementCount).toBe(0);
    expect(shortcutImage()).toBeNull();
    cleanup();
    fake.events.onUpdated.emit(
      1,
      {},
      fakeTab({
        url: "https://docs.example/page",
        favIconUrl: "data:image/png;base64,late",
      }),
    );
    expect(replaceChildren).not.toHaveBeenCalled();
  });

  it("drains buffered created and attached tabs before one final favicon sync", async () => {
    const query = deferred<chrome.tabs.Tab[]>();
    const attached = deferred<chrome.tabs.Tab>();
    const fake = createFakeChrome({
      stored: enabledShortcuts([
        { id: "docs", name: "Docs", url: "https://docs.example/", icon: "letter" },
        { id: "wiki", name: "Wiki", url: "https://wiki.example/", icon: "letter" },
      ]),
    });
    fake.methods.query.mockReturnValueOnce(query.promise);
    fake.methods.get.mockReturnValueOnce(attached.promise);
    const started = startSidebar(fake);
    await vi.waitFor(() => expect(fake.methods.query).toHaveBeenCalledOnce());

    fake.events.onCreated.emit(
      fakeTab({
        id: 3,
        index: 1,
        url: "https://docs.example/new",
        favIconUrl: "data:image/png;base64,created",
      }),
    );
    fake.events.onAttached.emit(4, { newWindowId: 10, newPosition: 2 });
    query.resolve([]);
    await flush();
    attached.resolve(
      fakeTab({
        id: 4,
        index: 2,
        url: "https://wiki.example/attached",
        favIconUrl: "data:image/png;base64,attached",
      }),
    );

    const cleanup = await started;
    expect(rowIds()).toEqual([3, 4]);
    expect(shortcutImage("docs")?.getAttribute("src")).toBe(
      "data:image/png;base64,created",
    );
    expect(shortcutImage("wiki")?.getAttribute("src")).toBe(
      "data:image/png;base64,attached",
    );
    cleanup();
  });

  it("migrates legacy settings to 16px and previews by changing only the root CSS variable", async () => {
    const fake = createFakeChrome({
      stored: { shortcutSettings: { enabled: false, items: [] } },
    });
    const setProperty = vi.spyOn(document.documentElement.style, "setProperty");
    const cleanup = await startSidebar(fake);
    expect(document.documentElement.style.getPropertyValue("--tab-title-font-size")).toBe("16px");

    click(element("shortcut-settings"));
    setProperty.mockClear();
    const fontSize = element<HTMLInputElement>("tab-title-font-size");
    fontSize.value = "18";
    fontSize.dispatchEvent(new Event("input", { bubbles: true }));

    expect(setProperty).toHaveBeenCalledOnce();
    expect(setProperty).toHaveBeenCalledWith("--tab-title-font-size", "18px");
    expect(document.body.getAttribute("style")).toBeNull();
    cleanup();
  });

  it("persists font size 17 and applies it when loaded again", async () => {
    const fake = createFakeChrome();
    const cleanup = await startSidebar(fake);
    click(element("shortcut-settings"));
    const fontSize = element<HTMLInputElement>("tab-title-font-size");
    fontSize.value = "17";
    fontSize.dispatchEvent(new Event("input", { bubbles: true }));
    element<HTMLFormElement>("shortcut-form").dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fake.methods.storageSet).toHaveBeenCalledOnce());
    const saved = {
      shortcutSettings: { ...createDefaultShortcutSettings(), tabTitleFontSize: 17 },
    };
    expect(fake.methods.storageSet).toHaveBeenCalledWith(saved);
    cleanup();

    installFixture();
    const reloaded = createFakeChrome({ stored: saved });
    const cleanupReloaded = await startSidebar(reloaded);
    expect(document.documentElement.style.getPropertyValue("--tab-title-font-size")).toBe("17px");
    cleanupReloaded();
  });

  it("keeps tabs usable with defaults when storage loading fails", async () => {
    const fake = createFakeChrome({ tabs: [fakeTab()] });
    fake.methods.storageGet.mockRejectedValueOnce(new Error("offline"));

    const cleanup = await startSidebar(fake);

    expect(rowIds()).toEqual([1]);
    expect(element("shortcut-strip").hidden).toBe(false);
    expect(element("shortcut-strip").childElementCount).toBe(3);
    expect(element("status-message").textContent).toBe("无法读取快捷网站设置");
    cleanup();
  });

  it("keeps shortcuts hidden while persisted disabled settings are loading", async () => {
    const storage = deferred<Record<string, unknown>>();
    const fake = createFakeChrome({
      tabs: [
        fakeTab({
          url: "https://chatgpt.com/path",
          favIconUrl: "data:image/png;base64,openai-tab",
        }),
      ],
    });
    fake.methods.storageGet.mockReturnValueOnce(storage.promise);

    const started = startSidebar(fake);
    await vi.waitFor(() => expect(rowIds()).toEqual([1]));
    const strip = element("shortcut-strip");
    expect(strip.hidden).toBe(true);
    expect(strip.childElementCount).toBe(0);
    expect(strip.querySelector(".shortcut-button")).toBeNull();

    storage.resolve({
      shortcutSettings: { ...createDefaultShortcutSettings(), enabled: false },
    });
    const cleanup = await started;
    expect(strip.hidden).toBe(true);
    expect(strip.childElementCount).toBe(0);
    expect(strip.querySelector(".shortcut-button")).toBeNull();
    cleanup();
  });

  it("renders default shortcuts only after empty storage finishes loading", async () => {
    const storage = deferred<Record<string, unknown>>();
    const fake = createFakeChrome({
      tabs: [
        fakeTab({
          url: "https://chatgpt.com/path",
          favIconUrl: "data:image/png;base64,openai-default",
        }),
      ],
    });
    fake.methods.storageGet.mockReturnValueOnce(storage.promise);

    const started = startSidebar(fake);
    await vi.waitFor(() => expect(rowIds()).toEqual([1]));
    const strip = element("shortcut-strip");
    expect(strip.hidden).toBe(true);
    expect(strip.childElementCount).toBe(0);
    expect(strip.querySelector(".shortcut-button")).toBeNull();

    storage.resolve({});
    const cleanup = await started;
    expect(strip.hidden).toBe(false);
    expect(
      Array.from(strip.querySelectorAll(".shortcut-button"), (button) =>
        (button as HTMLElement).dataset.shortcutId,
      ),
    ).toEqual(["openai", "google", "github"]);
    expect(shortcutImage("openai")?.getAttribute("src")).toBe(
      "data:image/png;base64,openai-default",
    );
    cleanup();
  });

  it("disables settings until storage settles and ignores quick click and save", async () => {
    const storage = deferred<Record<string, unknown>>();
    const fake = createFakeChrome();
    fake.methods.storageGet.mockReturnValueOnce(storage.promise);

    const started = startSidebar(fake);
    await flush();
    const settingsButton = element<HTMLButtonElement>("shortcut-settings");
    expect(settingsButton.disabled).toBe(true);
    click(settingsButton);
    element<HTMLFormElement>("shortcut-form").dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    expect(element<HTMLDialogElement>("shortcut-dialog").open).toBe(false);
    expect(fake.methods.storageSet).not.toHaveBeenCalled();

    storage.resolve({
      shortcutSettings: {
        enabled: true,
        items: [{ id: "real", name: "Real setting", url: "https://real.example/", icon: "letter" }],
      },
    });
    const cleanup = await started;
    expect(settingsButton.disabled).toBe(false);
    click(settingsButton);
    expect(element<HTMLDialogElement>("shortcut-dialog").open).toBe(true);
    expect(element("shortcut-editor-list").querySelector<HTMLInputElement>(".shortcut-name")?.value).toBe(
      "Real setting",
    );
    cleanup();
  });

  it.each(["window", "query"] as const)(
    "keeps shortcut settings available after a %s failure",
    async (failure) => {
      const fake = createFakeChrome();
      if (failure === "window") {
        fake.methods.getCurrent.mockRejectedValueOnce(new Error("window gone"));
      } else {
        fake.methods.query.mockRejectedValueOnce(new Error("query failed"));
      }

      const cleanup = await startSidebar(fake);
      click(element("shortcut-settings"));

      expect(element<HTMLDialogElement>("shortcut-dialog").open).toBe(true);
      expect(element("shortcut-editor-list").children).toHaveLength(3);
      expect(element("status-message").textContent).toBe("无法读取当前窗口的标签页");
      if (failure === "window") expect(fake.methods.query).not.toHaveBeenCalled();
      expect(fake.events.onCreated.listenerCount).toBe(0);
      cleanup();
    },
  );

  it("subscribes before a deferred query and replays buffered events once over the snapshot", async () => {
    const query = deferred<chrome.tabs.Tab[]>();
    const fake = createFakeChrome();
    fake.methods.query.mockReturnValueOnce(query.promise);
    const list = element("tab-list");
    const replaceChildren = vi.spyOn(list, "replaceChildren");

    const started = startSidebar(fake);
    await vi.waitFor(() => expect(fake.methods.query).toHaveBeenCalledWith({ windowId: 10 }));
    for (const event of Object.values(fake.events)) expect(event.listenerCount).toBe(1);

    fake.events.onCreated.emit(fakeTab({ id: 3, index: 2, title: "Three" }));
    fake.events.onRemoved.emit(1, { windowId: 10, isWindowClosing: false });
    fake.events.onMoved.emit(3, { windowId: 10, fromIndex: 2, toIndex: 0 });
    fake.events.onActivated.emit({ tabId: 3, windowId: 10 });
    expect(rowIds()).toEqual([]);

    query.resolve([
      fakeTab({ id: 1, index: 0, active: true }),
      fakeTab({ id: 2, index: 1, title: "Two" }),
      fakeTab({ id: 3, index: 2, title: "Three" }),
    ]);
    const cleanup = await started;

    expect(rowIds()).toEqual([3, 2]);
    expect(row(3).dataset.active).toBe("true");
    expect(row(2).dataset.active).toBe("false");
    expect(replaceChildren).not.toHaveBeenCalled();
    cleanup();
  });

  it("preserves attached event order while its tab lookup is deferred", async () => {
    const query = deferred<chrome.tabs.Tab[]>();
    const attached = deferred<chrome.tabs.Tab>();
    const fake = createFakeChrome();
    fake.methods.query.mockReturnValueOnce(query.promise);
    fake.methods.get.mockReturnValueOnce(attached.promise);
    const replaceChildren = vi.spyOn(element("tab-list"), "replaceChildren");
    const started = startSidebar(fake);
    await vi.waitFor(() => expect(fake.methods.query).toHaveBeenCalledOnce());

    fake.events.onAttached.emit(4, { newWindowId: 10, newPosition: 2 });
    fake.events.onMoved.emit(4, { windowId: 10, fromIndex: 2, toIndex: 0 });
    fake.events.onDetached.emit(4, { oldWindowId: 10, oldPosition: 0 });
    query.resolve([
      fakeTab({ id: 1, index: 0 }),
      fakeTab({ id: 2, index: 1, title: "Two" }),
    ]);
    await flush();
    expect(replaceChildren).not.toHaveBeenCalled();

    attached.resolve(fakeTab({ id: 4, index: 2, title: "Attached" }));
    const cleanup = await started;
    expect(rowIds()).toEqual([1, 2]);
    expect(replaceChildren).not.toHaveBeenCalled();
    cleanup();
  });

  it("does not strand a nested microtask event when startup buffering closes", async () => {
    const tabs = deferred<chrome.tabs.Tab[]>();
    const groups = deferred<chrome.tabGroups.TabGroup[]>();
    const attached = deferred<chrome.tabs.Tab>();
    const fake = createFakeChrome();
    fake.methods.query.mockReturnValueOnce(tabs.promise);
    fake.methods.groupQuery.mockReturnValueOnce(groups.promise);
    fake.methods.get.mockReturnValueOnce(attached.promise);

    const started = startSidebar(fake);
    await vi.waitFor(() => expect(fake.methods.query).toHaveBeenCalledOnce());
    fake.events.onAttached.emit(3, { newWindowId: 10, newPosition: 1 });
    await vi.waitFor(() => expect(fake.methods.get).toHaveBeenCalledWith(3));
    void attached.promise.then(() => {
      queueMicrotask(() => fake.groupEvents.onRemoved.emit(fakeGroup({ id: 7 })));
    });
    tabs.resolve([fakeTab({ id: 1, index: 0, groupId: 7 })]);
    groups.resolve([fakeGroup({ id: 7 })]);
    await flush();
    attached.resolve(fakeTab({ id: 3, index: 1, groupId: -1 }));

    const cleanup = await started;
    await flush();
    expect(document.querySelector(".tab-group-row[data-group-id='7']")).toBeNull();
    expect(rowIds()).toEqual([1, 3]);
    cleanup();
  });

  it.each(["tabs-first", "shortcuts-first"] as const)(
    "aggregates initialization errors deterministically when %s rejects",
    async (order) => {
      const query = deferred<chrome.tabs.Tab[]>();
      const storage = deferred<Record<string, unknown>>();
      const fake = createFakeChrome();
      fake.methods.query.mockReturnValueOnce(query.promise);
      fake.methods.storageGet.mockReturnValueOnce(storage.promise);
      const started = startSidebar(fake);
      await vi.waitFor(() => expect(fake.methods.query).toHaveBeenCalledOnce());

      if (order === "tabs-first") {
        query.reject(new Error("tabs unavailable"));
        await flush();
        storage.reject(new Error("storage unavailable"));
      } else {
        storage.reject(new Error("storage unavailable"));
        await flush();
        query.reject(new Error("tabs unavailable"));
      }
      const cleanup = await started;

      expect(element("status-message").textContent).toBe(
        "无法读取当前窗口的标签页；无法读取快捷网站设置",
      );
      for (const event of Object.values(fake.events)) expect(event.listenerCount).toBe(0);
      cleanup();
    },
  );

  it("shows recent history and debounces all-time search without filtering tabs", async () => {
    vi.useFakeTimers();
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 1, title: "Alpha" }), fakeTab({ id: 2, index: 1, title: "Beta" })],
      bookmarkItems: [{
        id: "bookmark-1",
        title: "Bookmark",
        url: "https://bookmark.example/",
        syncing: false,
      }],
      historyItems: [{ id: "history-1", title: "History", url: "https://history.example/" }],
    });
    const cleanup = await startSidebar(fake);

    element<HTMLInputElement>("tab-search").focus();
    await flush();
    expect(fake.methods.historySearch).toHaveBeenCalledWith({
      text: "",
      startTime: 0,
      maxResults: 500,
    });
    expect(fake.methods.bookmarkSearch).not.toHaveBeenCalled();
    expect(element("history-search-results").textContent).toContain("History");
    fake.methods.historySearch.mockClear();

    input("alpha");
    await vi.advanceTimersByTimeAsync(79);
    expect(rowIds()).toEqual([1, 2]);
    element<HTMLInputElement>("tab-search").value = "beta";
    await vi.advanceTimersByTimeAsync(21);
    expect(fake.methods.historySearch).toHaveBeenCalledWith({
      text: "beta",
      startTime: 0,
      maxResults: 500,
    });
    expect(fake.methods.bookmarkSearch).toHaveBeenCalledWith("beta");
    expect(element("history-search-results").textContent).toContain("Bookmark");
    expect(rowIds()).toEqual([1, 2]);
    cleanup();
  });

  it("opens history results and closes the upward panel for settings and tab scrolling", async () => {
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 1 })],
      historyItems: [{ id: "docs", title: "Docs", url: "https://docs.example/guide" }],
    });
    const cleanup = await startSidebar(fake);
    const search = element<HTMLInputElement>("tab-search");
    const results = element("history-search-results");

    search.focus();
    await flush();
    click(results.querySelector("[role='option']")!);
    await flush();
    expect(fake.methods.create).toHaveBeenCalledWith({
      url: "https://docs.example/guide",
      active: true,
    });
    expect(results.hidden).toBe(true);

    search.click();
    await flush();
    click(element("shortcut-settings"));
    expect(results.hidden).toBe(true);
    expect(element<HTMLDialogElement>("shortcut-dialog").open).toBe(true);
    element<HTMLDialogElement>("shortcut-dialog").close();

    search.click();
    await flush();
    element("tab-scroll").dispatchEvent(new Event("scroll"));
    expect(results.hidden).toBe(true);

    fake.methods.create.mockRejectedValueOnce(new Error("browser failed"));
    search.click();
    await flush();
    click(results.querySelector("[role='option']")!);
    await vi.waitFor(() =>
      expect(element("status-message").textContent).toBe("无法打开搜索结果"),
    );
    cleanup();
  });

  it("delegates activate and close actions and reports their domain errors", async () => {
    const fake = createFakeChrome({ tabs: [fakeTab({ id: 7 })] });
    const cleanup = await startSidebar(fake);

    click(row(7).querySelector(".tab-title")!);
    await flush();
    expect(fake.methods.update).toHaveBeenCalledWith(7, { active: true });
    expect(rowIds()).toEqual([7]);

    fake.methods.remove.mockRejectedValueOnce(new Error("browser failed"));
    click(row(7).querySelector("[data-action='close']")!);
    await flush();
    expect(fake.methods.remove).toHaveBeenCalledWith(7);
    expect(element("status-message").textContent).toBe("无法关闭该标签页");
    expect(rowIds()).toEqual([7]);
    cleanup();
  });

  it("disables new-tab creation while one request is pending", async () => {
    const pendingCreate = deferred<chrome.tabs.Tab>();
    const fake = createFakeChrome();
    fake.methods.create.mockReturnValueOnce(pendingCreate.promise);
    const cleanup = await startSidebar(fake);
    const button = element<HTMLButtonElement>("new-tab-button");

    click(button);
    click(button);

    expect(fake.methods.create).toHaveBeenCalledOnce();
    expect(fake.methods.create).toHaveBeenCalledWith({ active: true });
    expect(button.disabled).toBe(true);

    pendingCreate.resolve(fakeTab({ id: 999, active: true }));
    await flush();
    expect(button.disabled).toBe(false);
    cleanup();
  });

  it("restores new-tab creation and reports a rejected request", async () => {
    const pendingCreate = deferred<chrome.tabs.Tab>();
    const fake = createFakeChrome();
    fake.methods.create.mockReturnValueOnce(pendingCreate.promise);
    const cleanup = await startSidebar(fake);
    const button = element<HTMLButtonElement>("new-tab-button");

    click(button);
    pendingCreate.reject(new Error("browser failed"));
    await flush();

    expect(button.disabled).toBe(false);
    expect(element("status-message").textContent).toBe("无法新建标签页");
    cleanup();
  });

  it("leaves pending new-tab state untouched and removes its listener after cleanup", async () => {
    const pendingCreate = deferred<chrome.tabs.Tab>();
    const fake = createFakeChrome();
    fake.methods.create.mockReturnValueOnce(pendingCreate.promise);
    const cleanup = await startSidebar(fake);
    const button = element<HTMLButtonElement>("new-tab-button");

    click(button);
    expect(button.disabled).toBe(true);
    cleanup();
    pendingCreate.resolve(fakeTab({ id: 999, active: true }));
    await flush();
    click(button);

    expect(fake.methods.create).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
  });

  it("opens Chrome appearance settings once while the request is pending", async () => {
    const pending = deferred<chrome.tabs.Tab>();
    const fake = createFakeChrome();
    fake.methods.create.mockReturnValueOnce(pending.promise);
    const cleanup = await startSidebar(fake);
    const button = element<HTMLButtonElement>("chrome-appearance-settings");

    click(button);
    click(button);

    expect(fake.methods.create).toHaveBeenCalledOnce();
    expect(fake.methods.create).toHaveBeenCalledWith({
      url: "chrome://settings/appearance",
      active: true,
    });
    expect(button.disabled).toBe(true);

    pending.resolve(fakeTab({ id: 999 }));
    await flush();
    expect(button.disabled).toBe(false);
    cleanup();
  });

  it("reports a rejected Chrome appearance settings request", async () => {
    const fake = createFakeChrome();
    fake.methods.create.mockRejectedValueOnce(new Error("browser failed"));
    const cleanup = await startSidebar(fake);
    const button = element<HTMLButtonElement>("chrome-appearance-settings");

    click(button);
    await flush();

    expect(button.disabled).toBe(false);
    expect(element("shortcut-error").textContent).toBe(
      "无法打开 Chrome 外观设置",
    );
    cleanup();
  });

  it("does not update or reopen Chrome settings after cleanup", async () => {
    const pending = deferred<chrome.tabs.Tab>();
    void pending.promise.catch(() => undefined);
    const fake = createFakeChrome();
    fake.methods.create.mockReturnValueOnce(pending.promise);
    const cleanup = await startSidebar(fake);
    const button = element<HTMLButtonElement>("chrome-appearance-settings");

    click(button);
    cleanup();
    pending.reject(new Error("late failure"));
    await flush();
    click(button);

    expect(fake.methods.create).toHaveBeenCalledOnce();
    expect(element("shortcut-error").textContent).toBe("");
  });

  it("closes transient tab UI when the shared tab region scrolls", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0 }),
        fakeTab({ id: 2, index: 1, title: "Two" }),
      ],
    });
    const cleanup = await startSidebar(fake);
    vi.spyOn(row(1), "getBoundingClientRect").mockReturnValue({
      top: 0, height: 30, bottom: 30, left: 0, right: 100, width: 100,
      x: 0, y: 0, toJSON: () => ({}),
    });

    row(1).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const menu = document.querySelector<HTMLElement>(".tab-context-menu")!;
    row(2).dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(over, "clientY", { value: 29 });
    row(1).dispatchEvent(over);
    expect(row(2).dataset.dragSource).toBe("true");
    expect(row(1).dataset.dropPlacement).toBe("after");

    element("tab-scroll").dispatchEvent(new Event("scroll"));

    expect(menu.hidden).toBe(true);
    expect(row(2).hasAttribute("data-drag-source")).toBe(false);
    expect(row(1).hasAttribute("data-drop-placement")).toBe(false);
    expect(fake.methods.move).not.toHaveBeenCalled();
    expect(fake.methods.update).not.toHaveBeenCalled();
    cleanup();
  });

  it("keeps new-tab creation and the complete tab list while history has no matches", async () => {
    vi.useFakeTimers();
    const fake = createFakeChrome({ tabs: [fakeTab({ title: "Alpha" })] });
    const cleanup = await startSidebar(fake);
    const button = element<HTMLButtonElement>("new-tab-button");

    input("does-not-match");
    await vi.advanceTimersByTimeAsync(100);

    expect(rowIds()).toEqual([1]);
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(false);
    click(button);
    await flush();
    expect(fake.methods.create).toHaveBeenCalledWith({ active: true });
    cleanup();
  });

  it("dispatches duplicate and dynamic pinned commands from the tab context menu", async () => {
    const fake = createFakeChrome({ tabs: [fakeTab({ id: 7, pinned: false })] });
    const cleanup = await startSidebar(fake);

    row(7).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    click(document.querySelector("[data-menu-action='duplicate']")!);
    await flush();
    expect(fake.methods.duplicate).toHaveBeenCalledWith(7);

    row(7).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const pinned = document.querySelector<HTMLElement>("[data-menu-action='set-pinned']")!;
    expect(pinned.textContent).toBe("固定标签");
    click(pinned);
    await flush();
    expect(fake.methods.update).toHaveBeenCalledWith(7, { pinned: true });
    cleanup();
    expect(document.querySelector(".tab-context-menu")).toBeNull();
  });

  it("disables restore-recently-closed when no tab session is available", async () => {
    const fake = createFakeChrome({ tabs: [fakeTab({ id: 7 })] });
    const cleanup = await startSidebar(fake);
    await vi.waitFor(() => expect(fake.methods.sessionsGetRecentlyClosed).toHaveBeenCalledOnce());

    openTabContextMenu(7);
    const restore = contextMenuItem("restore-recently-closed");
    expect(restore.disabled).toBe(true);
    click(restore);

    expect(fake.methods.sessionsRestore).not.toHaveBeenCalled();
    cleanup();
  });

  it("restores the bound recent tab without proactively rebuilding the tab list", async () => {
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 7 })],
      recentlyClosedSessions: [recentlyClosedTabSession("recent-session")],
    });
    const cleanup = await startSidebar(fake);
    await vi.waitFor(() => expect(fake.methods.sessionsGetRecentlyClosed).toHaveBeenCalledOnce());
    const rowBefore = row(7);
    const listBefore = Array.from(element("tab-list").children);

    openTabContextMenu(7);
    const restore = contextMenuItem("restore-recently-closed");
    expect(restore.disabled).toBe(false);
    click(restore);
    await vi.waitFor(() => expect(fake.methods.sessionsRestore).toHaveBeenCalledOnce());
    await flush();

    expect(fake.methods.sessionsRestore).toHaveBeenCalledWith("recent-session");
    expect(fake.methods.query).toHaveBeenCalledOnce();
    expect(row(7)).toBe(rowBefore);
    expect(Array.from(element("tab-list").children)).toEqual(listBefore);
    cleanup();
  });

  it("shows a stable error when restoring a recent tab fails", async () => {
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 7 })],
      recentlyClosedSessions: [recentlyClosedTabSession("recent-session")],
    });
    fake.methods.sessionsRestore.mockRejectedValueOnce(new Error("browser failure"));
    const cleanup = await startSidebar(fake);
    await vi.waitFor(() => expect(fake.methods.sessionsGetRecentlyClosed).toHaveBeenCalledOnce());

    openTabContextMenu(7);
    click(contextMenuItem("restore-recently-closed"));

    await vi.waitFor(() =>
      expect(element("status-message").textContent).toBe("无法打开最近关闭标签页"),
    );
    expect(fake.methods.sessionsGetRecentlyClosed).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("removes the sessions listener and ignores a late initial result on cleanup", async () => {
    const pending = deferred<chrome.sessions.Session[]>();
    const fake = createFakeChrome({ tabs: [fakeTab({ id: 7 })] });
    fake.methods.sessionsGetRecentlyClosed.mockReturnValueOnce(pending.promise);
    const cleanup = await startSidebar(fake);
    await vi.waitFor(() => expect(fake.sessionEvents.onChanged.listenerCount).toBe(1));

    cleanup();
    const listBefore = element("tab-list").innerHTML;
    pending.resolve([recentlyClosedTabSession("late-session")]);
    await flush();
    fake.sessionEvents.onChanged.emit();

    expect(fake.sessionEvents.onChanged.listenerCount).toBe(0);
    expect(element("tab-list").innerHTML).toBe(listBefore);
    expect(fake.methods.sessionsGetRecentlyClosed).toHaveBeenCalledOnce();
  });

  it("closes only ordinary tabs below an ordinary tab and waits for removal events", async () => {
    const fake = createFakeChrome({ tabs: mixedTabs() });
    const cleanup = await startSidebar(fake);
    expect(rowIds()).toEqual([1, 3, 2, 4, 5]);

    openTabContextMenu(2);
    const closeBelow = contextMenuItem("close-below");
    expect(closeBelow.disabled).toBe(false);
    click(closeBelow);
    await flush();

    expect(fake.methods.remove).toHaveBeenCalledOnce();
    expect(fake.methods.remove).toHaveBeenCalledWith([4, 5]);
    expect(fake.methods.query).toHaveBeenCalledOnce();
    expect(rowIds()).toEqual([1, 3, 2, 4, 5]);
    expect(row(2).dataset.active).toBe("true");

    fake.events.onRemoved.emit(4, { windowId: 10, isWindowClosing: false });
    fake.events.onRemoved.emit(5, { windowId: 10, isWindowClosing: false });
    expect(rowIds()).toEqual([1, 3, 2]);
    cleanup();
  });

  it("keeps later pinned tabs when closing below a pinned tab", async () => {
    const fake = createFakeChrome({ tabs: mixedTabs() });
    const cleanup = await startSidebar(fake);

    openTabContextMenu(1);
    click(contextMenuItem("close-below"));
    await flush();

    expect(fake.methods.remove).toHaveBeenCalledOnce();
    expect(fake.methods.remove).toHaveBeenCalledWith([2, 4, 5]);
    expect(fake.methods.query).toHaveBeenCalledOnce();
    expect(rowIds()).toEqual([1, 3, 2, 4, 5]);

    for (const tabId of [2, 4, 5]) {
      fake.events.onRemoved.emit(tabId, { windowId: 10, isWindowClosing: false });
    }
    expect(rowIds()).toEqual([1, 3]);
    cleanup();
  });

  it("disables close-below on the last ordinary tab without removing anything", async () => {
    const fake = createFakeChrome({ tabs: mixedTabs() });
    const cleanup = await startSidebar(fake);

    openTabContextMenu(5);
    const closeBelow = contextMenuItem("close-below");
    expect(closeBelow.disabled).toBe(true);
    click(closeBelow);
    await flush();

    expect(fake.methods.remove).not.toHaveBeenCalled();
    expect(fake.methods.query).toHaveBeenCalledOnce();
    cleanup();
  });

  it("recomputes close-below targets from the latest order when the command runs", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0 }),
        fakeTab({ id: 2, index: 1, title: "Two" }),
        fakeTab({ id: 3, index: 2, title: "Three" }),
      ],
    });
    const cleanup = await startSidebar(fake);

    openTabContextMenu(2);
    expect(contextMenuItem("close-below").disabled).toBe(false);
    fake.events.onMoved.emit(1, { windowId: 10, fromIndex: 0, toIndex: 2 });
    expect(rowIds()).toEqual([2, 3, 1]);
    click(contextMenuItem("close-below"));
    await flush();

    expect(fake.methods.remove).toHaveBeenCalledOnce();
    expect(fake.methods.remove).toHaveBeenCalledWith([3, 1]);
    expect(fake.methods.query).toHaveBeenCalledOnce();
    expect(rowIds()).toEqual([2, 3, 1]);
    cleanup();
  });

  it("shows the batch-close domain error when closing below fails", async () => {
    const fake = createFakeChrome({ tabs: mixedTabs() });
    fake.methods.remove.mockRejectedValueOnce(new Error("browser failed"));
    const cleanup = await startSidebar(fake);

    openTabContextMenu(2);
    click(contextMenuItem("close-below"));
    await vi.waitFor(() =>
      expect(element("status-message").textContent).toBe("无法关闭下方标签页"),
    );

    expect(fake.methods.remove).toHaveBeenCalledOnce();
    expect(fake.methods.remove).toHaveBeenCalledWith([4, 5]);
    expect(fake.methods.query).toHaveBeenCalledOnce();
    expect(rowIds()).toEqual([1, 3, 2, 4, 5]);
    cleanup();
  });

  it("ignores a late close-below rejection after cleanup", async () => {
    const pendingRemove = deferred<undefined>();
    const fake = createFakeChrome({ tabs: mixedTabs() });
    fake.methods.remove.mockReturnValueOnce(pendingRemove.promise);
    const cleanup = await startSidebar(fake);

    openTabContextMenu(2);
    click(contextMenuItem("close-below"));
    expect(fake.methods.remove).toHaveBeenCalledWith([4, 5]);
    const statusBefore = element("status-message").textContent;

    cleanup();
    pendingRemove.reject(new Error("browser failed"));
    await flush();

    expect(element("status-message").textContent).toBe(statusBefore);
    expect(fake.methods.query).toHaveBeenCalledOnce();
  });

  it("derives same-site menu availability from ordinary, grouped, pinned, and non-HTTP tabs", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, url: "https://example.com/target", groupId: -1 }),
        fakeTab({ id: 2, index: 1, url: "https://example.com/grouped", groupId: 7 }),
        fakeTab({ id: 3, index: 2, url: "https://example.com/pinned", pinned: true }),
        fakeTab({ id: 4, index: 3, url: "chrome://settings" }),
      ],
      groups: [fakeGroup({ id: 7 })],
    });
    const cleanup = await startSidebar(fake);

    for (const tabId of [1, 2, 3]) {
      openTabContextMenu(tabId);
      expect(contextMenuItem("group-same-site").disabled).toBe(true);
      expect(contextMenuItem("close-same-site").disabled).toBe(false);
      expect(contextMenuItem("duplicate").disabled).toBe(false);
    }
    openTabContextMenu(4);
    expect(contextMenuItem("group-same-site").disabled).toBe(true);
    expect(contextMenuItem("close-same-site").disabled).toBe(true);
    expect(contextMenuItem("duplicate").disabled).toBe(false);
    cleanup();
  });

  it("builds one tab snapshot when opening a tab context menu", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, url: "https://example.com/target" }),
        fakeTab({ id: 2, index: 1, url: "https://example.com/other" }),
      ],
    });
    const list = vi.spyOn(TabStore.prototype, "list");
    const cleanup = await startSidebar(fake);
    list.mockClear();

    try {
      openTabContextMenu(1);
      expect(list).toHaveBeenCalledOnce();
    } finally {
      cleanup();
      list.mockRestore();
    }
  });

  it("disables both same-site commands for a lone ordinary HTTP tab", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, url: "https://example.com/only", groupId: -1 }),
      ],
    });
    const cleanup = await startSidebar(fake);

    openTabContextMenu(1);

    expect(contextMenuItem("group-same-site").disabled).toBe(true);
    expect(contextMenuItem("close-same-site").disabled).toBe(true);
    cleanup();
  });

  it("recomputes same-site close targets from created, updated, and removed tab events", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, url: "https://example.com/target" }),
        fakeTab({ id: 2, index: 1, url: "https://example.com/old" }),
        fakeTab({ id: 4, index: 2, url: "https://example.com/removed" }),
      ],
    });
    const cleanup = await startSidebar(fake);

    openTabContextMenu(1);
    expect(contextMenuItem("close-same-site").disabled).toBe(false);
    fake.events.onCreated.emit(
      fakeTab({ id: 3, index: 3, url: "https://example.com/created" }),
    );
    fake.events.onUpdated.emit(
      2,
      { url: "https://other.example/updated" },
      fakeTab({ id: 2, index: 1, url: "https://other.example/updated" }),
    );
    fake.events.onRemoved.emit(4, { windowId: 10, isWindowClosing: false });
    click(contextMenuItem("close-same-site"));
    await flush();

    expect(fake.methods.remove).toHaveBeenCalledOnce();
    expect(fake.methods.remove).toHaveBeenCalledWith([3]);
    expect(rowIds()).toEqual([1, 2, 3]);
    cleanup();
  });

  it("closes grouped ordinary same-site tabs but excludes the target and every pinned tab", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, url: "https://example.com/target", pinned: true }),
        fakeTab({ id: 2, index: 1, url: "https://example.com/grouped", groupId: 7 }),
        fakeTab({ id: 3, index: 2, url: "https://example.com/pinned", pinned: true }),
        fakeTab({ id: 4, index: 3, url: "https://example.com/ordinary" }),
        fakeTab({ id: 5, index: 4, url: "https://other.example/page" }),
      ],
      groups: [fakeGroup({ id: 7 })],
    });
    const cleanup = await startSidebar(fake);
    const rowsBefore = rowIds();

    openTabContextMenu(1);
    click(contextMenuItem("close-same-site"));
    await flush();

    expect(fake.methods.remove).toHaveBeenCalledOnce();
    expect(fake.methods.remove).toHaveBeenCalledWith([2, 4]);
    expect(rowIds()).toEqual(rowsBefore);
    cleanup();
  });

  it("keeps same-site rows until Chrome events and reports the close action error", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, url: "https://example.com/target" }),
        fakeTab({ id: 2, index: 1, url: "https://example.com/other" }),
      ],
    });
    fake.methods.remove.mockRejectedValueOnce(new Error("browser failed"));
    const cleanup = await startSidebar(fake);

    openTabContextMenu(1);
    click(contextMenuItem("close-same-site"));

    await vi.waitFor(() =>
      expect(element("status-message").textContent).toBe(
        "无法关闭其他同类网站标签页",
      ),
    );
    expect(rowIds()).toEqual([1, 2]);
    expect(fake.methods.query).toHaveBeenCalledOnce();
    cleanup();
  });

  it("ignores a late same-site close rejection after cleanup", async () => {
    const pendingRemove = deferred<undefined>();
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, url: "https://example.com/target" }),
        fakeTab({ id: 2, index: 1, url: "https://example.com/other" }),
      ],
    });
    fake.methods.remove.mockReturnValueOnce(pendingRemove.promise);
    const cleanup = await startSidebar(fake);

    openTabContextMenu(1);
    click(contextMenuItem("close-same-site"));
    const statusBefore = element("status-message").textContent;
    cleanup();
    pendingRemove.reject(new Error("browser failed"));
    await flush();

    expect(element("status-message").textContent).toBe(statusBefore);
    expect(fake.methods.query).toHaveBeenCalledOnce();
  });

  it("persists the current tab as a shortcut without Chrome tab actions", async () => {
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 17, title: "Example", url: "https://example.com/path" })],
    });
    const cleanup = await startSidebar(fake);

    row(17).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    click(contextMenuItem("add-shortcut"));

    await vi.waitFor(() => expect(fake.methods.storageSet).toHaveBeenCalledOnce());
    const saved = fake.methods.storageSet.mock.calls.at(-1)?.[0]
      .shortcutSettings as ShortcutSettings;
    expect(saved.items.at(-1)).toMatchObject({
      name: "Example",
      url: "https://example.com/path",
      icon: "letter",
    });
    expect(saved.enabled).toBe(true);
    expect(element("shortcut-strip").hidden).toBe(false);
    expect(element("shortcut-strip").childElementCount).toBe(4);
    expect(element("status-message").textContent).toBe("已添加到快捷网站");
    expect(fake.methods.create).not.toHaveBeenCalled();
    expect(fake.methods.duplicate).not.toHaveBeenCalled();
    expect(fake.methods.move).not.toHaveBeenCalled();
    expect(fake.methods.update).not.toHaveBeenCalled();
    cleanup();
  });

  it("renders a saved context-menu shortcut immediately when shortcuts are enabled", async () => {
    const fake = createFakeChrome({
      stored: enabledShortcuts([]),
      tabs: [fakeTab({
        id: 18,
        title: "Docs",
        url: "https://docs.example/guide",
        favIconUrl: "data:image/png;base64,docs-menu",
      })],
    });
    const cleanup = await startSidebar(fake);

    row(18).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    click(contextMenuItem("add-shortcut"));
    await vi.waitFor(() => expect(fake.methods.storageSet).toHaveBeenCalledOnce());

    expect(element("shortcut-strip").hidden).toBe(false);
    expect(element("shortcut-strip").children).toHaveLength(1);
    expect(element("shortcut-strip").querySelector("img")?.getAttribute("src"))
      .toBe("data:image/png;base64,docs-menu");
    cleanup();
  });

  it("ignores a repeated pending add and reports save failure", async () => {
    const pending = deferred<void>();
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 19, url: "https://pending.example/" })],
    });
    fake.methods.storageSet.mockReturnValueOnce(pending.promise);
    const cleanup = await startSidebar(fake);

    row(19).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    click(contextMenuItem("add-shortcut"));
    row(19).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    click(contextMenuItem("add-shortcut"));
    await vi.waitFor(() => expect(fake.methods.storageSet).toHaveBeenCalledOnce());

    pending.reject(new Error("storage failed"));
    await vi.waitFor(() =>
      expect(element("status-message").textContent).toBe("无法保存快捷网站设置"),
    );
    cleanup();
  });

  it.each([
    ["chrome://settings/", "仅支持 HTTP 或 HTTPS 地址"],
    ["https://chatgpt.com/", "快捷网站地址不能重复"],
  ])("reports a rejected shortcut URL %s without persisting", async (url, message) => {
    const fake = createFakeChrome({ tabs: [fakeTab({ id: 20, url })] });
    const cleanup = await startSidebar(fake);

    row(20).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    click(contextMenuItem("add-shortcut"));
    await vi.waitFor(() => expect(element("status-message").textContent).toBe(message));

    expect(fake.methods.storageSet).not.toHaveBeenCalled();
    cleanup();
  });

  it("ignores a pending shortcut save completion after cleanup", async () => {
    const pending = deferred<void>();
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 21, url: "https://late.example/" })],
    });
    fake.methods.storageSet.mockReturnValueOnce(pending.promise);
    const cleanup = await startSidebar(fake);

    row(21).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    click(contextMenuItem("add-shortcut"));
    await vi.waitFor(() => expect(fake.methods.storageSet).toHaveBeenCalledOnce());
    const statusBefore = element("status-message").textContent;
    const shortcutsBefore = element("shortcut-strip").innerHTML;

    cleanup();
    pending.resolve();
    await flush();

    expect(element("status-message").textContent).toBe(statusBefore);
    expect(element("shortcut-strip").innerHTML).toBe(shortcutsBefore);
  });

  it("keeps an open tab menu for ordinary updates and closes it when pinned state changes", async () => {
    const fake = createFakeChrome({ tabs: [fakeTab({ id: 7, pinned: false })] });
    const cleanup = await startSidebar(fake);

    row(7).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const menu = document.querySelector<HTMLElement>(".tab-context-menu")!;
    expect(menu.hidden).toBe(false);

    fake.events.onUpdated.emit(7, { title: "Updated" }, fakeTab({ id: 7, title: "Updated", pinned: false }));
    await flush();
    expect(menu.hidden).toBe(false);

    fake.events.onUpdated.emit(7, { pinned: true }, fakeTab({ id: 7, pinned: true }));
    await flush();

    expect(menu.hidden).toBe(true);
    cleanup();
  });

  it("renders grouped tabs and patches metadata without rebuilding the list", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, groupId: 7, title: "Grouped" }),
        fakeTab({ id: 2, index: 1, groupId: -1, title: "Loose" }),
      ],
      groups: [fakeGroup({ id: 7, title: "Work", color: "blue" })],
    });
    const cleanup = await startSidebar(fake);
    const originalGroup = groupRow(7);
    const originalGroupedTab = row(1);

    fake.groupEvents.onUpdated.emit(fakeGroup({ id: 7, title: "Renamed", color: "red" }));

    expect(groupRow(7)).toBe(originalGroup);
    expect(row(1)).toBe(originalGroupedTab);
    expect(groupRow(7).querySelector(".tab-group-title")?.textContent).toBe("Renamed");
    expect(groupRow(7).dataset.groupColor).toBe("red");

    fake.groupEvents.onUpdated.emit(fakeGroup({ id: 7, title: "Renamed", collapsed: true }));
    expect(groupRow(7)).toBe(originalGroup);
    expect(rowIds()).toEqual([2]);
    cleanup();
  });

  it("recomputes quick-group candidates from the latest tab events and uses exact metadata", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, url: "https://example.com/target", groupId: -1 }),
        fakeTab({ id: 2, index: 1, url: "https://example.com/updated", groupId: -1 }),
        fakeTab({ id: 6, index: 2, url: "https://example.com/removed", groupId: -1 }),
        fakeTab({ id: 7, index: 3, url: "https://example.com/grouped", groupId: 7 }),
        fakeTab({ id: 8, index: 4, url: "https://example.com/pinned", pinned: true }),
      ],
      groups: [fakeGroup({ id: 7 })],
    });
    const cleanup = await startSidebar(fake);
    const rowsBefore = rowIds();

    openTabContextMenu(1);
    expect(contextMenuItem("group-same-site").disabled).toBe(false);
    fake.events.onCreated.emit(
      fakeTab({ id: 3, index: 5, url: "https://example.com/created", groupId: -1 }),
    );
    fake.events.onUpdated.emit(
      2,
      { pinned: true },
      fakeTab({ id: 2, index: 1, url: "https://example.com/updated", pinned: true }),
    );
    fake.events.onRemoved.emit(6, { windowId: 10, isWindowClosing: false });
    const latestRows = rowIds();
    click(contextMenuItem("group-same-site"));
    await flush();

    expect(fake.methods.group).toHaveBeenCalledOnce();
    expect(fake.methods.group).toHaveBeenCalledWith({
      tabIds: [1, 3],
      createProperties: { windowId: 10 },
    });
    expect(fake.methods.groupUpdate).toHaveBeenCalledOnce();
    expect(fake.methods.groupUpdate).toHaveBeenCalledWith(777, {
      title: "example.com",
      color: "grey",
    });
    expect(latestRows).not.toEqual(rowsBefore);
    expect(rowIds()).toEqual(latestRows);
    expect(fake.methods.query).toHaveBeenCalledOnce();
    cleanup();
  });

  it("does not start an overlapping quick group while any candidate is busy", async () => {
    const pendingGroup = deferred<number>();
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, url: "https://example.com/target", groupId: -1 }),
        fakeTab({ id: 2, index: 1, url: "https://example.com/other", groupId: -1 }),
      ],
    });
    fake.methods.group.mockReturnValueOnce(pendingGroup.promise);
    const cleanup = await startSidebar(fake);

    openTabContextMenu(1);
    click(contextMenuItem("group-same-site"));
    fake.events.onCreated.emit(
      fakeTab({ id: 3, index: 2, url: "https://example.com/third", groupId: -1 }),
    );
    openTabContextMenu(3);
    expect(contextMenuItem("group-same-site").disabled).toBe(true);
    expect(contextMenuItem("close-same-site").disabled).toBe(false);
    click(contextMenuItem("group-same-site"));

    expect(fake.methods.group).toHaveBeenCalledOnce();
    expect(fake.methods.group).toHaveBeenCalledWith({
      tabIds: [1, 2],
      createProperties: { windowId: 10 },
    });
    pendingGroup.resolve(777);
    await vi.waitFor(() => expect(fake.methods.groupUpdate).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      openTabContextMenu(3);
      expect(contextMenuItem("group-same-site").disabled).toBe(false);
    });
    cleanup();
  });

  it("silently skips quick grouping when the latest snapshot no longer has a plan", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, url: "https://example.com/target", groupId: -1 }),
        fakeTab({ id: 2, index: 1, url: "https://example.com/other", groupId: -1 }),
      ],
    });
    const cleanup = await startSidebar(fake);

    openTabContextMenu(1);
    expect(contextMenuItem("group-same-site").disabled).toBe(false);
    fake.events.onRemoved.emit(2, { windowId: 10, isWindowClosing: false });
    click(contextMenuItem("group-same-site"));
    await flush();

    expect(fake.methods.group).not.toHaveBeenCalled();
    expect(fake.methods.groupUpdate).not.toHaveBeenCalled();
    expect(element("status-message").textContent).toBe("");
    expect(fake.methods.query).toHaveBeenCalledOnce();
    cleanup();
  });

  it("reports a quick-group failure and requests exactly one tab and group resync", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, url: "https://example.com/target", groupId: -1 }),
        fakeTab({ id: 2, index: 1, url: "https://example.com/other", groupId: -1 }),
      ],
    });
    fake.methods.group.mockRejectedValueOnce(new Error("browser failed"));
    const cleanup = await startSidebar(fake);

    openTabContextMenu(1);
    click(contextMenuItem("group-same-site"));

    await vi.waitFor(() =>
      expect(element("status-message").textContent).toBe(
        "无法快速分组同类网站",
      ),
    );
    expect(fake.methods.query).toHaveBeenCalledTimes(2);
    expect(fake.methods.groupQuery).toHaveBeenCalledTimes(2);
    expect(fake.methods.groupUpdate).not.toHaveBeenCalled();

    openTabContextMenu(1);
    click(contextMenuItem("group-same-site"));
    await vi.waitFor(() => expect(fake.methods.group).toHaveBeenCalledTimes(2));
    expect(fake.methods.groupUpdate).toHaveBeenCalledOnce();
    cleanup();
  });

  it("keeps the Chrome-created group and resyncs once when quick-group metadata fails", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, url: "https://example.com/target", groupId: -1 }),
        fakeTab({ id: 2, index: 1, url: "https://example.com/other", groupId: -1 }),
      ],
    });
    fake.methods.groupUpdate.mockRejectedValueOnce(new Error("metadata failed"));
    const cleanup = await startSidebar(fake);

    openTabContextMenu(1);
    click(contextMenuItem("group-same-site"));

    await vi.waitFor(() =>
      expect(element("status-message").textContent).toBe(
        "分组已创建，但无法保存名称或颜色",
      ),
    );
    expect(fake.methods.group).toHaveBeenCalledOnce();
    expect(fake.methods.groupUpdate).toHaveBeenCalledOnce();
    expect(fake.methods.query).toHaveBeenCalledTimes(2);
    expect(fake.methods.groupQuery).toHaveBeenCalledTimes(2);
    expect(groupRow(777).querySelector(".tab-group-title")?.textContent).toBe("未命名分组");
    expect(groupRow(777).dataset.groupColor).toBe("grey");
    cleanup();
  });

  it("ignores a late quick-group rejection after cleanup", async () => {
    const pendingGroup = deferred<number>();
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, url: "https://example.com/target", groupId: -1 }),
        fakeTab({ id: 2, index: 1, url: "https://example.com/other", groupId: -1 }),
      ],
    });
    fake.methods.group.mockReturnValueOnce(pendingGroup.promise);
    const cleanup = await startSidebar(fake);

    openTabContextMenu(1);
    click(contextMenuItem("group-same-site"));
    const statusBefore = element("status-message").textContent;
    cleanup();
    pendingGroup.reject(new Error("browser failed"));
    await flush();

    expect(element("status-message").textContent).toBe(statusBefore);
    expect(fake.methods.query).toHaveBeenCalledOnce();
    expect(fake.methods.groupQuery).toHaveBeenCalledOnce();
  });

  it("opens the group dialog from the context menu and retries only partial metadata creation", async () => {
    const resyncTabs = deferred<chrome.tabs.Tab[]>();
    const resyncGroups = deferred<chrome.tabGroups.TabGroup[]>();
    const fake = createFakeChrome({ tabs: [fakeTab({ id: 4, groupId: -1 })] });
    fake.methods.groupUpdate.mockRejectedValueOnce(new Error("metadata failed"));
    const cleanup = await startSidebar(fake);
    fake.methods.query.mockReturnValueOnce(resyncTabs.promise);
    fake.methods.groupQuery.mockReturnValueOnce(resyncGroups.promise);

    openTabContextMenu(4);
    click(contextMenuItem("add-to-group"));
    click(document.querySelector(".tab-context-submenu [data-menu-action='create-group']")!);
    const dialog = element<HTMLDialogElement>("tab-group-dialog");
    const form = element<HTMLFormElement>("tab-group-form");
    element<HTMLInputElement>("tab-group-name").value = "Project";
    document.querySelector<HTMLInputElement>(
      "#tab-group-dialog input[name='tab-group-color'][value='blue']",
    )!.checked = true;

    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(element("tab-group-error").textContent).toContain("分组已创建"));
    expect(dialog.open).toBe(true);
    expect(fake.methods.group).toHaveBeenCalledOnce();
    expect(fake.methods.query).toHaveBeenCalledTimes(2);
    expect(fake.methods.groupQuery).toHaveBeenCalledTimes(2);

    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    expect(fake.methods.group).toHaveBeenCalledOnce();
    expect(fake.methods.groupUpdate).toHaveBeenCalledTimes(2);
    expect(fake.methods.groupUpdate).toHaveBeenLastCalledWith(777, {
      title: "Project",
      color: "blue",
    });
    cleanup();
  });

  it("keeps live group metadata when a partial-create retry beats an older resync", async () => {
    const resyncTabs = deferred<chrome.tabs.Tab[]>();
    const resyncGroups = deferred<chrome.tabGroups.TabGroup[]>();
    const fake = createFakeChrome({ tabs: [fakeTab({ id: 4, groupId: -1 })] });
    fake.methods.groupUpdate.mockRejectedValueOnce(new Error("metadata failed"));
    const cleanup = await startSidebar(fake);
    fake.methods.query.mockReturnValueOnce(resyncTabs.promise);
    fake.methods.groupQuery.mockReturnValueOnce(resyncGroups.promise);

    openTabContextMenu(4);
    click(contextMenuItem("add-to-group"));
    click(document.querySelector(".tab-context-submenu [data-menu-action='create-group']")!);
    const dialog = element<HTMLDialogElement>("tab-group-dialog");
    const form = element<HTMLFormElement>("tab-group-form");
    element<HTMLInputElement>("tab-group-name").value = "Project";
    document.querySelector<HTMLInputElement>(
      "#tab-group-dialog input[name='tab-group-color'][value='blue']",
    )!.checked = true;

    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(element("tab-group-error").textContent).toContain("分组已创建");
      expect(fake.methods.query).toHaveBeenCalledTimes(2);
      expect(fake.methods.groupQuery).toHaveBeenCalledTimes(2);
    });

    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    fake.groupEvents.onUpdated.emit(fakeGroup({ id: 777, title: "Project", color: "blue" }));
    resyncTabs.resolve([fakeTab({ id: 4, groupId: 777 })]);
    resyncGroups.resolve([fakeGroup({ id: 777, title: "Older metadata", color: "grey" })]);

    await vi.waitFor(() => expect(groupRow(777).querySelector(".tab-group-title")?.textContent).toBe("Project"));
    expect(groupRow(777).dataset.groupColor).toBe("blue");
    expect(fake.methods.group).toHaveBeenCalledOnce();
    expect(fake.methods.groupUpdate).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("replays tab and group events over successful resync snapshots in receive order", async () => {
    const resyncTabs = deferred<chrome.tabs.Tab[]>();
    const resyncGroups = deferred<chrome.tabGroups.TabGroup[]>();
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, groupId: -1, title: "One" }),
        fakeTab({ id: 2, index: 1, groupId: 7, title: "Two" }),
      ],
      groups: [fakeGroup({ id: 7, title: "Initial" })],
    });
    const cleanup = await startSidebar(fake);
    fake.methods.query.mockReturnValueOnce(resyncTabs.promise);
    fake.methods.groupQuery.mockReturnValueOnce(resyncGroups.promise);
    fake.methods.group.mockRejectedValueOnce(new Error("add failed"));

    openTabContextMenu(1);
    click(contextMenuItem("add-to-group"));
    click(document.querySelector(".tab-context-submenu [data-group-id='7']")!);
    await vi.waitFor(() => {
      expect(fake.methods.query).toHaveBeenCalledTimes(2);
      expect(fake.methods.groupQuery).toHaveBeenCalledTimes(2);
    });

    fake.events.onUpdated.emit(
      2,
      { title: "Live title" },
      fakeTab({ id: 2, index: 1, groupId: 7, title: "Live title" }),
    );
    fake.groupEvents.onUpdated.emit(fakeGroup({ id: 7, title: "Live first" }));
    fake.events.onMoved.emit(2, { windowId: 10, fromIndex: 1, toIndex: 0 });
    fake.groupEvents.onUpdated.emit(fakeGroup({ id: 7, title: "Live latest" }));
    resyncTabs.resolve([
      fakeTab({ id: 1, index: 0, groupId: -1, title: "One" }),
      fakeTab({ id: 2, index: 1, groupId: 7, title: "Older title" }),
    ]);
    resyncGroups.resolve([fakeGroup({ id: 7, title: "Older group" })]);

    await vi.waitFor(() => {
      expect(rowIds()).toEqual([2, 1]);
      expect(row(2).querySelector(".tab-title")?.textContent).toBe("Live title");
      expect(groupRow(7).querySelector(".tab-group-title")?.textContent).toBe("Live latest");
    });
    expect(rowIds()).toEqual([2, 1]);
    expect(row(2).querySelector(".tab-title")?.textContent).toBe("Live title");
    expect(groupRow(7).querySelector(".tab-group-title")?.textContent).toBe("Live latest");
    expect(fake.methods.query).toHaveBeenCalledTimes(2);
    expect(fake.methods.groupQuery).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it.each(["success", "failure"] as const)(
    "does not strand a nested group removal when a %s resync closes buffering",
    async (result) => {
      const resyncTabs = deferred<chrome.tabs.Tab[]>();
      const resyncGroups = deferred<chrome.tabGroups.TabGroup[]>();
      const attached = deferred<chrome.tabs.Tab>();
      const fake = createFakeChrome({
        tabs: [
          fakeTab({ id: 1, index: 0, groupId: -1 }),
          fakeTab({ id: 2, index: 1, groupId: 7 }),
        ],
        groups: [fakeGroup({ id: 7 })],
      });
      const cleanup = await startSidebar(fake);
      fake.methods.query.mockReturnValueOnce(resyncTabs.promise);
      fake.methods.groupQuery.mockReturnValueOnce(resyncGroups.promise);
      fake.methods.get.mockReturnValueOnce(attached.promise);
      fake.methods.group.mockRejectedValueOnce(new Error("add failed"));

      openTabContextMenu(1);
      click(contextMenuItem("add-to-group"));
      click(document.querySelector(".tab-context-submenu [data-group-id='7']")!);
      await vi.waitFor(() => expect(fake.methods.query).toHaveBeenCalledTimes(2));
      fake.events.onAttached.emit(3, { newWindowId: 10, newPosition: 2 });
      await vi.waitFor(() => expect(fake.methods.get).toHaveBeenCalledWith(3));
      void attached.promise.then(() => {
        queueMicrotask(() => fake.groupEvents.onRemoved.emit(fakeGroup({ id: 7 })));
      });

      if (result === "success") {
        resyncTabs.resolve([
          fakeTab({ id: 1, index: 0, groupId: -1 }),
          fakeTab({ id: 2, index: 1, groupId: 7 }),
        ]);
      } else {
        resyncTabs.reject(new Error("resync failed"));
      }
      resyncGroups.resolve([fakeGroup({ id: 7 })]);
      await flush();
      attached.resolve(fakeTab({ id: 3, index: 2, groupId: -1 }));

      await vi.waitFor(() => {
        expect(document.querySelector(".tab-group-row[data-group-id='7']")).toBeNull();
      });
      expect(rowIds()).toEqual([1, 2, 3]);
      cleanup();
    },
  );

  it("queues one follow-up resync during replay and merges requests during its query", async () => {
    const firstTabs = deferred<chrome.tabs.Tab[]>();
    const firstGroups = deferred<chrome.tabGroups.TabGroup[]>();
    const secondTabs = deferred<chrome.tabs.Tab[]>();
    const secondGroups = deferred<chrome.tabGroups.TabGroup[]>();
    const attached = deferred<chrome.tabs.Tab>();
    const snapshotRead = vi.fn();
    const firstSnapshotTab = fakeTab({ id: 1, index: 0, groupId: -1 });
    Object.defineProperty(firstSnapshotTab, "title", {
      configurable: true,
      get() {
        snapshotRead();
        return "First snapshot";
      },
    });
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, groupId: -1 }),
        fakeTab({ id: 2, index: 1, groupId: 7 }),
        fakeTab({ id: 3, index: 2, groupId: 8 }),
      ],
      groups: [fakeGroup({ id: 7 }), fakeGroup({ id: 8, title: "Other" })],
    });
    const cleanup = await startSidebar(fake);
    fake.methods.query
      .mockReturnValueOnce(firstTabs.promise)
      .mockReturnValueOnce(secondTabs.promise);
    fake.methods.groupQuery
      .mockReturnValueOnce(firstGroups.promise)
      .mockReturnValueOnce(secondGroups.promise);
    fake.methods.get.mockReturnValueOnce(attached.promise);
    fake.methods.group.mockRejectedValueOnce(new Error("first failure"));
    fake.methods.ungroup
      .mockRejectedValueOnce(new Error("queued failure"))
      .mockRejectedValueOnce(new Error("merged failure"));

    openTabContextMenu(1);
    click(contextMenuItem("add-to-group"));
    click(document.querySelector(".tab-context-submenu [data-group-id='7']")!);
    await vi.waitFor(() => expect(fake.methods.query).toHaveBeenCalledTimes(2));
    fake.events.onAttached.emit(4, { newWindowId: 10, newPosition: 3 });
    await vi.waitFor(() => expect(fake.methods.get).toHaveBeenCalledWith(4));
    firstTabs.resolve([
      firstSnapshotTab,
      fakeTab({ id: 2, index: 1, groupId: 7 }),
      fakeTab({ id: 3, index: 2, groupId: 8 }),
    ]);
    firstGroups.resolve([fakeGroup({ id: 7 }), fakeGroup({ id: 8, title: "Other" })]);
    await vi.waitFor(() => expect(snapshotRead).toHaveBeenCalled());

    openTabContextMenu(2);
    click(contextMenuItem("remove-from-group"));
    await flush();
    expect(fake.methods.query).toHaveBeenCalledTimes(2);
    attached.resolve(fakeTab({ id: 4, index: 3, groupId: -1 }));

    await vi.waitFor(() => {
      expect(fake.methods.query).toHaveBeenCalledTimes(3);
      expect(fake.methods.groupQuery).toHaveBeenCalledTimes(3);
    });
    openTabContextMenu(3);
    click(contextMenuItem("remove-from-group"));
    await flush();
    expect(fake.methods.query).toHaveBeenCalledTimes(3);
    expect(fake.methods.groupQuery).toHaveBeenCalledTimes(3);

    secondTabs.resolve([
      fakeTab({ id: 1, index: 0, groupId: -1, title: "Second snapshot" }),
      fakeTab({ id: 2, index: 1, groupId: 7 }),
      fakeTab({ id: 3, index: 2, groupId: 8 }),
      fakeTab({ id: 4, index: 3, groupId: -1 }),
    ]);
    secondGroups.resolve([fakeGroup({ id: 7 }), fakeGroup({ id: 8, title: "Other" })]);
    await vi.waitFor(() => {
      expect(row(1).querySelector(".tab-title")?.textContent).toBe("Second snapshot");
    });
    expect(fake.methods.query).toHaveBeenCalledTimes(3);
    expect(fake.methods.groupQuery).toHaveBeenCalledTimes(3);
    cleanup();
  });

  it("deduplicates pending group commands and toggles from the latest store state", async () => {
    const pendingAdd = deferred<number>();
    const pendingToggle = deferred<chrome.tabGroups.TabGroup | undefined>();
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 5, index: 0, groupId: -1 }),
        fakeTab({ id: 6, index: 1, groupId: 7 }),
      ],
      groups: [fakeGroup({ id: 7, collapsed: false })],
    });
    fake.methods.group.mockReturnValueOnce(pendingAdd.promise);
    fake.methods.groupUpdate.mockReturnValueOnce(pendingToggle.promise);
    const cleanup = await startSidebar(fake);

    const addToExisting = (): void => {
      openTabContextMenu(5);
      click(contextMenuItem("add-to-group"));
      click(document.querySelector(".tab-context-submenu [data-group-id='7']")!);
    };
    addToExisting();
    addToExisting();
    expect(fake.methods.group).toHaveBeenCalledOnce();

    click(groupRow(7).querySelector("[data-action='toggle-group']")!);
    click(groupRow(7).querySelector("[data-action='toggle-group']")!);
    expect(fake.methods.groupUpdate).toHaveBeenCalledOnce();
    expect(fake.methods.groupUpdate).toHaveBeenCalledWith(7, { collapsed: true });

    pendingAdd.resolve(7);
    pendingToggle.resolve(fakeGroup({ id: 7, collapsed: true }));
    await flush();
    cleanup();
  });

  it("uses one resync for concurrent group failures and does not retry a failed resync", async () => {
    const resyncTabs = deferred<chrome.tabs.Tab[]>();
    const resyncGroups = deferred<chrome.tabGroups.TabGroup[]>();
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, groupId: -1 }),
        fakeTab({ id: 2, index: 1, groupId: 7 }),
      ],
      groups: [fakeGroup({ id: 7 })],
    });
    const cleanup = await startSidebar(fake);
    fake.methods.query.mockReturnValueOnce(resyncTabs.promise);
    fake.methods.groupQuery.mockReturnValueOnce(resyncGroups.promise);
    fake.methods.group.mockRejectedValueOnce(new Error("add failed"));
    fake.methods.ungroup.mockRejectedValueOnce(new Error("remove failed"));

    openTabContextMenu(1);
    click(contextMenuItem("add-to-group"));
    click(document.querySelector(".tab-context-submenu [data-group-id='7']")!);
    openTabContextMenu(2);
    click(contextMenuItem("remove-from-group"));

    await vi.waitFor(() => {
      expect(fake.methods.query).toHaveBeenCalledTimes(2);
      expect(fake.methods.groupQuery).toHaveBeenCalledTimes(2);
    });
    fake.events.onUpdated.emit(
      1,
      { title: "Live after failure" },
      fakeTab({ id: 1, index: 0, groupId: -1, title: "Live after failure" }),
    );
    fake.groupEvents.onUpdated.emit(fakeGroup({ id: 7, title: "Live group after failure" }));
    resyncTabs.reject(new Error("resync failed"));
    resyncGroups.resolve([fakeGroup({ id: 7 })]);
    await flush();

    expect(fake.methods.query).toHaveBeenCalledTimes(2);
    expect(fake.methods.groupQuery).toHaveBeenCalledTimes(2);
    expect(rowIds()).toEqual([1, 2]);
    await vi.waitFor(() => {
      expect(row(1).querySelector(".tab-title")?.textContent).toBe("Live after failure");
      expect(groupRow(7).querySelector(".tab-group-title")?.textContent).toBe("Live group after failure");
    });
    cleanup();
  });

  it("keeps tab and group context menus mutually exclusive", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, groupId: -1 }),
        fakeTab({ id: 2, index: 1, groupId: 7 }),
      ],
      groups: [fakeGroup({ id: 7 })],
    });
    const cleanup = await startSidebar(fake);
    const tabMenu = document.querySelector<HTMLElement>(
      ".tab-context-menu:not(.tab-context-submenu):not(.tab-group-context-menu)",
    )!;
    const groupMenu = document.querySelector<HTMLElement>(".tab-group-context-menu")!;

    openTabContextMenu(1);
    expect(tabMenu.hidden).toBe(false);
    openGroupContextMenu(7);
    expect(tabMenu.hidden).toBe(true);
    expect(groupMenu.hidden).toBe(false);

    openTabContextMenu(2);
    expect(groupMenu.hidden).toBe(true);
    expect(tabMenu.hidden).toBe(false);
    cleanup();
  });

  it("creates an active tab after the latest group tail and adds it to that group", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, groupId: -1 }),
        fakeTab({ id: 2, index: 1, groupId: 7 }),
        fakeTab({ id: 3, index: 3, groupId: 7 }),
      ],
      groups: [fakeGroup({ id: 7 })],
    });
    const cleanup = await startSidebar(fake);

    openGroupContextMenu(7);
    click(groupContextMenuItem("new-tab"));
    await flush();

    expect(fake.methods.create).toHaveBeenCalledWith({ windowId: 10, index: 4, active: true });
    expect(fake.methods.group).toHaveBeenCalledWith({ tabIds: 999, groupId: 7 });
    cleanup();
  });

  it("opens rename from the latest group title and saves the trimmed value", async () => {
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 2, index: 0, groupId: 7 })],
      groups: [fakeGroup({ id: 7, title: "Initial" })],
    });
    const cleanup = await startSidebar(fake);
    fake.groupEvents.onUpdated.emit(fakeGroup({ id: 7, title: "Latest" }));

    openGroupContextMenu(7);
    click(groupContextMenuItem("rename"));
    const dialog = element<HTMLDialogElement>("tab-group-rename-dialog");
    const name = element<HTMLInputElement>("tab-group-rename-name");
    expect(dialog.open).toBe(true);
    expect(name.value).toBe("Latest");

    name.value = "  Renamed  ";
    element<HTMLFormElement>("tab-group-rename-form").dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await flush();
    expect(fake.methods.groupUpdate).toHaveBeenCalledWith(7, { title: "Renamed" });
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    cleanup();
  });

  it("updates a newly selected group color and dissolves all latest members in one call", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 2, index: 0, groupId: 7 }),
        fakeTab({ id: 3, index: 1, groupId: 7 }),
      ],
      groups: [fakeGroup({ id: 7, color: "blue", collapsed: true })],
    });
    const cleanup = await startSidebar(fake);

    openGroupContextMenu(7);
    click(groupContextMenuItem("set-color"));
    click(document.querySelector(".tab-group-color-submenu [data-color='red']")!);
    await flush();
    expect(fake.methods.groupUpdate).toHaveBeenCalledWith(7, { color: "red" });

    openGroupContextMenu(7);
    fake.events.onCreated.emit(fakeTab({ id: 4, index: 2, groupId: 7 }));
    click(groupContextMenuItem("dissolve"));
    await flush();
    expect(fake.methods.ungroup).toHaveBeenCalledTimes(1);
    expect(fake.methods.ungroup).toHaveBeenCalledWith([2, 3, 4]);
    expect(fake.methods.remove).not.toHaveBeenCalled();
    expect(fake.methods.move).not.toHaveBeenCalled();
    cleanup();
  });

  it("revalidates color at dispatch time and waits for Chrome events before patching the row", async () => {
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 2, index: 0, groupId: 7 })],
      groups: [fakeGroup({ id: 7, color: "blue" })],
    });
    const cleanup = await startSidebar(fake);

    openGroupContextMenu(7);
    click(groupContextMenuItem("set-color"));
    fake.groupEvents.onUpdated.emit(fakeGroup({ id: 7, color: "red" }));
    click(document.querySelector(".tab-group-color-submenu [data-color='red']")!);
    await flush();
    expect(fake.methods.groupUpdate).not.toHaveBeenCalled();
    expect(groupRow(7).dataset.groupColor).toBe("red");

    openGroupContextMenu(7);
    click(groupContextMenuItem("set-color"));
    click(document.querySelector(".tab-group-color-submenu [data-color='green']")!);
    await flush();
    expect(fake.methods.groupUpdate).toHaveBeenCalledWith(7, { color: "green" });
    expect(groupRow(7).dataset.groupColor).toBe("red");
    fake.groupEvents.onUpdated.emit(fakeGroup({ id: 7, color: "green" }));
    expect(groupRow(7).dataset.groupColor).toBe("green");
    cleanup();
  });

  it("keeps a partially created tab, reports the domain error, and resyncs once", async () => {
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 2, index: 0, groupId: 7 })],
      groups: [fakeGroup({ id: 7 })],
    });
    const cleanup = await startSidebar(fake);
    fake.methods.group.mockRejectedValueOnce(new Error("group failed"));

    openGroupContextMenu(7);
    click(groupContextMenuItem("new-tab"));

    await vi.waitFor(() => {
      expect(element("status-message").textContent).toContain(
        "标签页已创建，但无法加入分组",
      );
      expect(fake.methods.query).toHaveBeenCalledTimes(2);
      expect(fake.methods.groupQuery).toHaveBeenCalledTimes(2);
    });
    expect(fake.methods.create).toHaveBeenCalledOnce();
    expect(fake.methods.group).toHaveBeenCalledOnce();
    cleanup();
  });

  it("reports a create failure without grouping and keeps a failed rename editable", async () => {
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 2, index: 0, groupId: 7 })],
      groups: [fakeGroup({ id: 7, title: "Work" })],
    });
    const cleanup = await startSidebar(fake);
    fake.methods.create.mockRejectedValueOnce(new Error("create failed"));

    openGroupContextMenu(7);
    click(groupContextMenuItem("new-tab"));
    await vi.waitFor(() => {
      expect(element("status-message").textContent).toContain(
        "无法在分组中新建标签页",
      );
      expect(fake.methods.query).toHaveBeenCalledTimes(2);
    });
    expect(fake.methods.group).not.toHaveBeenCalled();

    fake.methods.groupUpdate.mockRejectedValueOnce(new Error("rename failed"));
    openGroupContextMenu(7);
    click(groupContextMenuItem("rename"));
    const dialog = element<HTMLDialogElement>("tab-group-rename-dialog");
    const name = element<HTMLInputElement>("tab-group-rename-name");
    name.value = "  Keep me  ";
    element<HTMLFormElement>("tab-group-rename-form").dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
      expect(element("tab-group-rename-error").textContent).toBe("无法重命名标签组");
      expect(fake.methods.query).toHaveBeenCalledTimes(3);
      expect(fake.methods.groupQuery).toHaveBeenCalledTimes(3);
    });
    expect(dialog.open).toBe(true);
    expect(name.value).toBe("  Keep me  ");
    expect(fake.methods.groupUpdate).toHaveBeenCalledWith(7, { title: "Keep me" });
    cleanup();
  });

  it("deduplicates management commands per group without blocking another group", async () => {
    const pendingCreate = deferred<chrome.tabs.Tab>();
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 2, index: 0, groupId: 7 }),
        fakeTab({ id: 3, index: 1, groupId: 8 }),
      ],
      groups: [fakeGroup({ id: 7 }), fakeGroup({ id: 8, title: "Other" })],
    });
    fake.methods.create.mockReturnValueOnce(pendingCreate.promise);
    const cleanup = await startSidebar(fake);

    openGroupContextMenu(7);
    click(groupContextMenuItem("new-tab"));
    openGroupContextMenu(7);
    expect(groupContextMenuItem("new-tab").disabled).toBe(true);
    click(groupContextMenuItem("new-tab"));
    openGroupContextMenu(8);
    click(groupContextMenuItem("new-tab"));

    expect(fake.methods.create).toHaveBeenCalledTimes(2);
    click(groupRow(7).querySelector("[data-action='toggle-group']")!);
    expect(fake.methods.groupUpdate).not.toHaveBeenCalled();
    pendingCreate.resolve(fakeTab({ id: 1001, index: 1, groupId: -1 }));
    await flush();
    cleanup();
  });

  it("keeps rename open when a same-group toggle becomes busy before save", async () => {
    const pendingToggle = deferred<chrome.tabGroups.TabGroup | undefined>();
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 2, index: 0, groupId: 7 })],
      groups: [fakeGroup({ id: 7, title: "Work" })],
    });
    const cleanup = await startSidebar(fake);

    openGroupContextMenu(7);
    click(groupContextMenuItem("rename"));
    fake.methods.groupUpdate.mockReturnValueOnce(pendingToggle.promise);
    click(groupRow(7).querySelector("[data-action='toggle-group']")!);

    const dialog = element<HTMLDialogElement>("tab-group-rename-dialog");
    element<HTMLInputElement>("tab-group-rename-name").value = "Busy rename";
    element<HTMLFormElement>("tab-group-rename-form").dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await flush();

    expect(fake.methods.groupUpdate).toHaveBeenCalledTimes(1);
    expect(fake.methods.groupUpdate).toHaveBeenCalledWith(7, { collapsed: true });
    expect(dialog.open).toBe(true);

    pendingToggle.resolve(fakeGroup({ id: 7, collapsed: true }));
    await flush();
    cleanup();
  });

  it("closes group transient UI when its group is removed", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 2, index: 0, groupId: 7 }),
        fakeTab({ id: 3, index: 1, groupId: 8 }),
      ],
      groups: [fakeGroup({ id: 7 }), fakeGroup({ id: 8, title: "Other" })],
    });
    const cleanup = await startSidebar(fake);
    const groupMenu = document.querySelector<HTMLElement>(".tab-group-context-menu")!;

    openGroupContextMenu(7);
    expect(groupMenu.hidden).toBe(false);
    fake.groupEvents.onRemoved.emit(fakeGroup({ id: 7 }));
    expect(groupMenu.hidden).toBe(true);

    openGroupContextMenu(8);
    click(groupContextMenuItem("rename"));
    expect(element<HTMLDialogElement>("tab-group-rename-dialog").open).toBe(true);
    fake.groupEvents.onRemoved.emit(fakeGroup({ id: 8 }));
    expect(element<HTMLDialogElement>("tab-group-rename-dialog").open).toBe(false);
    cleanup();
  });

  it("ignores a late group-command rejection after cleanup", async () => {
    const pendingCreate = deferred<chrome.tabs.Tab>();
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 2, index: 0, groupId: 7 })],
      groups: [fakeGroup({ id: 7 })],
    });
    fake.methods.create.mockReturnValueOnce(pendingCreate.promise);
    const cleanup = await startSidebar(fake);

    openGroupContextMenu(7);
    click(groupContextMenuItem("new-tab"));
    cleanup();
    pendingCreate.reject(new Error("late failure"));
    await flush();

    expect(element("status-message").textContent).toBe("");
    expect(fake.methods.query).toHaveBeenCalledOnce();
    expect(document.querySelector(".tab-group-context-menu")).toBeNull();
    expect(element<HTMLDialogElement>("tab-group-rename-dialog").open).toBe(false);
  });

  it("closes a tab on middle click and removes the handler during cleanup", async () => {
    const fake = createFakeChrome({ tabs: [fakeTab({ id: 12 })] });
    const cleanup = await startSidebar(fake);
    const target = row(12).querySelector(".tab-title")!;

    target.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    await flush();
    expect(fake.methods.remove).toHaveBeenCalledOnce();
    expect(fake.methods.remove).toHaveBeenCalledWith(12);

    cleanup();
    target.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(fake.methods.remove).toHaveBeenCalledOnce();
  });

  it("resyncs once when a cross-group drag fails", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, groupId: -1 }),
        fakeTab({ id: 2, index: 1, groupId: 7 }),
      ],
      groups: [fakeGroup({ id: 7 })],
    });
    const cleanup = await startSidebar(fake);
    fake.methods.group.mockRejectedValueOnce(new Error("drag group failed"));

    row(1).dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
    groupRow(7).dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    groupRow(7).dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(fake.methods.query).toHaveBeenCalledTimes(2);
      expect(fake.methods.groupQuery).toHaveBeenCalledTimes(2);
    });
    expect(fake.methods.group).toHaveBeenCalledOnce();
    expect(fake.methods.move).not.toHaveBeenCalled();
    cleanup();
  });

  it("submits one cross-group reorder and keeps dragging enabled during history search", async () => {
    const pendingMove = deferred<chrome.tabs.Tab>();
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, pinned: true }),
        fakeTab({ id: 2, index: 1 }),
        fakeTab({ id: 3, index: 2 }),
      ],
    });
    fake.methods.move.mockReturnValueOnce(pendingMove.promise);
    const cleanup = await startSidebar(fake);
    vi.spyOn(row(1), "getBoundingClientRect").mockReturnValue({
      top: 0, height: 30, bottom: 30, left: 0, right: 100, width: 100,
      x: 0, y: 0, toJSON: () => ({}),
    });

    row(3).dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(over, "clientY", { value: 29 });
    row(1).dispatchEvent(over);
    row(1).dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    await flush();
    expect(fake.methods.update).toHaveBeenCalledWith(3, { pinned: true });
    expect(fake.methods.move).toHaveBeenCalledWith(3, { index: 1 });
    expect(row(1).draggable).toBe(false);

    pendingMove.resolve(fakeTab({ id: 3, index: 1, pinned: true }));
    await flush();
    expect(row(1).draggable).toBe(true);
    input("one");
    expect(row(1).draggable).toBe(true);
    input("");
    expect(row(1).draggable).toBe(true);
    cleanup();
  });

  it.each(["older-success", "older-failure"] as const)(
    "lets only the latest tab operation update status when %s settles last",
    async (olderResult) => {
      const older = deferred<chrome.tabs.Tab>();
      const latest = deferred<chrome.tabs.Tab>();
      const fake = createFakeChrome({
        tabs: [fakeTab({ id: 1 }), fakeTab({ id: 2, index: 1, title: "Two" })],
      });
      fake.methods.update
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(latest.promise);
      const cleanup = await startSidebar(fake);

      click(row(1).querySelector("[data-action='activate']")!);
      click(row(2).querySelector("[data-action='activate']")!);
      if (olderResult === "older-success") {
        latest.reject(new Error("latest failed"));
        await flush();
        older.resolve(fakeTab({ id: 1 }));
        await flush();
        expect(element("status-message").textContent).toBe("无法切换到该标签页");
      } else {
        latest.resolve(fakeTab({ id: 2 }));
        await flush();
        older.reject(new Error("older failed"));
        await flush();
        expect(element("status-message").textContent).toBe("");
      }
      cleanup();
    },
  );

  it("opens shortcuts in an active new tab and reports rejected opens", async () => {
    const fake = createFakeChrome({
      stored: {
        shortcutSettings: {
          enabled: true,
          items: [{ id: "docs", name: "Docs", url: "https://docs.example/", icon: "letter" }],
        },
      },
    });
    const cleanup = await startSidebar(fake);

    click(element("shortcut-strip").querySelector(".shortcut-button")!);
    await flush();
    expect(fake.methods.create).toHaveBeenCalledWith({ url: "https://docs.example/", active: true });

    fake.methods.create.mockRejectedValueOnce(new Error("browser failed"));
    click(element("shortcut-strip").querySelector(".shortcut-button")!);
    await vi.waitFor(() =>
      expect(element("status-message").textContent).toBe("无法打开快捷网站"),
    );
    cleanup();
  });

  it("persists normalized shortcut settings and reflects the enabled toggle", async () => {
    const fake = createFakeChrome();
    const cleanup = await startSidebar(fake);
    click(element("shortcut-settings"));
    const enabled = element<HTMLInputElement>("shortcut-enabled");
    enabled.checked = true;
    enabled.dispatchEvent(new Event("change", { bubbles: true }));

    element<HTMLFormElement>("shortcut-form").dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fake.methods.storageSet).toHaveBeenCalledOnce());

    expect(fake.methods.storageSet).toHaveBeenCalledWith({
      shortcutSettings: { ...createDefaultShortcutSettings(), enabled: true },
    });
    await vi.waitFor(() => expect(element("shortcut-strip").hidden).toBe(false));
    expect(element("shortcut-strip").children).toHaveLength(3);
    cleanup();
  });

  it("prunes cached favicon URLs after shortcut origins change", async () => {
    const fake = createFakeChrome({
      stored: {
        ...enabledShortcuts(),
        shortcutFaviconCacheV1: {
          "https://docs.example": "https://cache.example/docs.png",
        },
      },
    });
    const cleanup = await startSidebar(fake);
    click(element("shortcut-settings"));
    const url = element("shortcut-editor-list").querySelector<HTMLInputElement>(
      ".shortcut-url",
    )!;
    url.value = "https://new.example/";
    url.dispatchEvent(new Event("input", { bubbles: true }));

    element<HTMLFormElement>("shortcut-form").dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => expect(fake.methods.storageSet).toHaveBeenCalledTimes(2));
    expect(fake.methods.storageSet).toHaveBeenCalledWith({ shortcutFaviconCacheV1: {} });
    cleanup();
  });

  it("updates the DOM for all current-window events and ignores other windows", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, active: true }),
        fakeTab({ id: 2, index: 1, title: "Two" }),
      ],
    });
    fake.methods.get.mockImplementation(async (id) =>
      fakeTab({ id, windowId: id === 4 ? 10 : 20, index: 1, title: `Attached ${id}` }),
    );
    const cleanup = await startSidebar(fake);

    fake.events.onCreated.emit(fakeTab({ id: 3, index: 2, title: "Three" }));
    expect(rowIds()).toEqual([1, 2, 3]);
    fake.events.onUpdated.emit(2, {}, fakeTab({ id: 2, index: 1, title: "Updated two" }));
    expect(row(2).querySelector(".tab-title")?.textContent).toBe("Updated two");
    fake.events.onActivated.emit({ tabId: 2, windowId: 10 });
    expect(row(2).dataset.active).toBe("true");
    fake.events.onMoved.emit(3, { windowId: 10, fromIndex: 2, toIndex: 0 });
    expect(rowIds()).toEqual([3, 1, 2]);
    fake.events.onRemoved.emit(1, { windowId: 10, isWindowClosing: false });
    expect(rowIds()).toEqual([3, 2]);
    fake.events.onDetached.emit(2, { oldWindowId: 10, oldPosition: 1 });
    expect(rowIds()).toEqual([3]);
    fake.events.onAttached.emit(4, { newWindowId: 10, newPosition: 1 });
    await flush();
    expect(rowIds()).toEqual([3, 4]);

    fake.events.onCreated.emit(fakeTab({ id: 90, windowId: 20 }));
    fake.events.onUpdated.emit(3, {}, fakeTab({ id: 3, windowId: 20, title: "Wrong" }));
    fake.events.onActivated.emit({ tabId: 90, windowId: 20 });
    fake.events.onMoved.emit(3, { windowId: 20, fromIndex: 0, toIndex: 1 });
    fake.events.onRemoved.emit(3, { windowId: 20, isWindowClosing: false });
    fake.events.onDetached.emit(3, { oldWindowId: 20, oldPosition: 0 });
    fake.events.onAttached.emit(91, { newWindowId: 20, newPosition: 0 });
    await flush();
    expect(rowIds()).toEqual([3, 4]);
    expect(row(3).querySelector(".tab-title")?.textContent).toBe("Three");
    cleanup();
  });

  it("replaces a live tab ID once while preserving unchanged keyed rows", async () => {
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 1, index: 0 }), fakeTab({ id: 2, index: 1, title: "Two" })],
    });
    const cleanup = await startSidebar(fake);
    const unchanged = row(2);
    fake.setTabs([
      fakeTab({ id: 3, index: 0, title: "Replacement" }),
      fakeTab({ id: 2, index: 1, title: "Two" }),
    ]);

    fake.events.onReplaced.emit(3, 1);
    await flush();

    expect(rowIds()).toEqual([3, 2]);
    expect(document.querySelectorAll("[data-tab-id='3']")).toHaveLength(1);
    expect(document.querySelector("[data-tab-id='1']")).toBeNull();
    expect(row(2)).toBe(unchanged);
    cleanup();
  });

  it("replays a replacement over an older startup snapshot", async () => {
    const snapshot = deferred<chrome.tabs.Tab[]>();
    const fake = createFakeChrome();
    fake.methods.query.mockReturnValueOnce(snapshot.promise);
    const started = startSidebar(fake);
    await vi.waitFor(() => expect(fake.methods.query).toHaveBeenCalledOnce());
    fake.setTabs([
      fakeTab({ id: 3, index: 0, title: "Replacement" }),
      fakeTab({ id: 2, index: 1, title: "Two" }),
    ]);

    fake.events.onReplaced.emit(3, 1);
    snapshot.resolve([
      fakeTab({ id: 1, index: 0, title: "Old" }),
      fakeTab({ id: 2, index: 1, title: "Two" }),
    ]);
    const cleanup = await started;

    expect(rowIds()).toEqual([3, 2]);
    cleanup();
  });

  it("keeps a buffered close after its deferred replacement lookup", async () => {
    const snapshot = deferred<chrome.tabs.Tab[]>();
    const replacement = deferred<chrome.tabs.Tab>();
    const fake = createFakeChrome();
    fake.methods.query.mockReturnValueOnce(snapshot.promise);
    fake.methods.get.mockReturnValueOnce(replacement.promise);
    const started = startSidebar(fake);
    await vi.waitFor(() => expect(fake.methods.query).toHaveBeenCalledOnce());

    fake.events.onReplaced.emit(3, 1);
    fake.events.onRemoved.emit(3, { windowId: 10, isWindowClosing: false });
    snapshot.resolve([
      fakeTab({ id: 1, index: 0, title: "Old" }),
      fakeTab({ id: 2, index: 1, title: "Two" }),
    ]);
    await flush();
    replacement.resolve(fakeTab({ id: 3, index: 0, title: "Replacement" }));
    const cleanup = await started;

    expect(rowIds()).toEqual([2]);
    cleanup();
  });

  it("merges concurrent replacement lookup failures into one resync", async () => {
    const resync = deferred<chrome.tabs.Tab[]>();
    const fake = createFakeChrome({ tabs: [fakeTab({ id: 1 })] });
    const cleanup = await startSidebar(fake);
    fake.methods.query.mockReturnValueOnce(resync.promise);
    fake.methods.get.mockRejectedValue(new Error("replacement gone"));

    fake.events.onReplaced.emit(3, 1);
    fake.events.onReplaced.emit(4, 1);
    await vi.waitFor(() => expect(fake.methods.query).toHaveBeenCalledTimes(2));
    expect(fake.methods.groupQuery).toHaveBeenCalledTimes(2);
    resync.resolve([fakeTab({ id: 1 })]);
    await flush();

    expect(fake.methods.query).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("patches an ordinary update in place while history search is open", async () => {
    vi.useFakeTimers();
    const fake = createFakeChrome({
      stored: enabledShortcuts(),
      tabs: [
        fakeTab({
          id: 1,
          title: "Alpha",
          url: "https://docs.example/page",
          favIconUrl: "data:image/png;base64,alpha",
        }),
      ],
      historyItems: [
        { id: "history-1", title: "Alpha history", url: "https://docs.example/history" },
      ],
    });
    const cleanup = await startSidebar(fake);
    const initial = row(1);

    input("alpha");
    await vi.advanceTimersByTimeAsync(100);
    const shortcutBefore = shortcutImage();
    const historyBefore = element("history-search-results").firstElementChild;

    fake.events.onUpdated.emit(
      1,
      { title: "Alpha updated" },
      fakeTab({
        id: 1,
        title: "Alpha updated",
        url: "https://docs.example/page",
        favIconUrl: "data:image/png;base64,alpha",
      }),
    );
    expect(row(1)).toBe(initial);
    expect(shortcutImage()).toBe(shortcutBefore);
    expect(element("history-search-results").firstElementChild).toBe(historyBefore);

    fake.events.onUpdated.emit(
      1,
      { favIconUrl: "data:image/png;base64,updated" },
      fakeTab({
        id: 1,
        title: "Alpha updated",
        url: "https://docs.example/page",
        favIconUrl: "data:image/png;base64,updated",
      }),
    );
    const shortcutAfter = shortcutImage();
    const historyAfter = element("history-search-results").firstElementChild;
    expect(shortcutAfter).not.toBe(shortcutBefore);
    expect(shortcutAfter?.getAttribute("src")).toBe("data:image/png;base64,updated");
    expect(historyAfter).not.toBe(historyBefore);
    expect(historyAfter?.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,updated",
    );

    fake.events.onUpdated.emit(
      1,
      { title: "Alpha again" },
      fakeTab({
        id: 1,
        title: "Alpha again",
        url: "https://docs.example/page",
        favIconUrl: "data:image/png;base64,updated",
      }),
    );
    expect(shortcutImage()).toBe(shortcutAfter);
    expect(element("history-search-results").firstElementChild).toBe(historyAfter);
    cleanup();
  });

  it("patches only the previous and next active rows in place", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, active: true }),
        fakeTab({ id: 2, index: 1 }),
        fakeTab({ id: 3, index: 2 }),
      ],
    });
    const cleanup = await startSidebar(fake);
    const nodes = [row(1), row(2), row(3)];

    fake.events.onActivated.emit({ tabId: 2, windowId: 10 });

    expect([row(1), row(2), row(3)]).toEqual(nodes);
    expect(row(1).dataset.active).toBe("false");
    expect(row(2).dataset.active).toBe("true");
    expect(row(3).dataset.active).toBe("false");
    cleanup();
  });

  it("cleans up idempotently, cancels debounce, destroys renderers, and ignores in-flight work", async () => {
    vi.useFakeTimers();
    const attached = deferred<chrome.tabs.Tab>();
    const replacement = deferred<chrome.tabs.Tab>();
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 1, favIconUrl: "data:image/png;base64,broken" })],
    });
    fake.methods.get
      .mockReturnValueOnce(attached.promise)
      .mockReturnValueOnce(replacement.promise);
    const cleanup = await startSidebar(fake);
    input("missing");
    fake.events.onAttached.emit(4, { newWindowId: 10, newPosition: 1 });
    fake.events.onReplaced.emit(5, 1);
    const image = row(1).querySelector("img")!;

    cleanup();
    cleanup();
    await vi.advanceTimersByTimeAsync(100);
    attached.resolve(fakeTab({ id: 4, index: 1 }));
    replacement.resolve(fakeTab({ id: 5, index: 0 }));
    await flush();
    image.dispatchEvent(new Event("error"));
    click(element("shortcut-settings"));
    click(row(1).querySelector("[data-action='close']")!);

    expect(rowIds()).toEqual([1]);
    expect(row(1).querySelector("img")).toBe(image);
    expect(element<HTMLDialogElement>("shortcut-dialog").open).toBe(false);
    expect(fake.methods.remove).not.toHaveBeenCalled();
    expect(fake.methods.historySearch).not.toHaveBeenCalled();
    for (const event of Object.values(fake.events)) expect(event.listenerCount).toBe(0);
    for (const event of Object.values(fake.groupEvents)) expect(event.listenerCount).toBe(0);
  });

  it("destroys the context menu, group dialog, and active drag state during cleanup", async () => {
    const fake = createFakeChrome({
      tabs: [
        fakeTab({ id: 1, index: 0, groupId: -1 }),
        fakeTab({ id: 2, index: 1, groupId: 7 }),
      ],
      groups: [fakeGroup({ id: 7 })],
    });
    const cleanup = await startSidebar(fake);
    const form = element<HTMLFormElement>("tab-group-form");
    const dialog = element<HTMLDialogElement>("tab-group-dialog");
    const formRemove = vi.spyOn(form, "removeEventListener");
    const dialogRemove = vi.spyOn(dialog, "removeEventListener");

    openTabContextMenu(1);
    click(contextMenuItem("add-to-group"));
    click(document.querySelector(".tab-context-submenu [data-menu-action='create-group']")!);
    expect(dialog.open).toBe(true);

    const source = row(1);
    const target = groupRow(7);
    source.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
    target.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    expect(source.dataset.dragSource).toBe("true");
    expect(target.dataset.dropTarget).toBe("true");

    cleanup();

    expect(document.querySelector(".tab-context-menu")).toBeNull();
    expect(dialog.open).toBe(false);
    expect(formRemove).toHaveBeenCalledWith("submit", expect.any(Function));
    expect(dialogRemove).toHaveBeenCalledWith("cancel", expect.any(Function));
    expect(dialogRemove).toHaveBeenCalledWith("close", expect.any(Function));
    expect(source.hasAttribute("data-drag-source")).toBe(false);
    expect(target.hasAttribute("data-drop-target")).toBe(false);

    source.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
    target.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    target.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    expect(fake.methods.group).not.toHaveBeenCalled();
  });

  it("auto entry invalidates deferred initialization when pagehide happens before startup resolves", async () => {
    const currentWindow = deferred<chrome.windows.Window>();
    const storage = deferred<Record<string, unknown>>();
    const fake = createFakeChrome();
    fake.methods.getCurrent.mockReturnValueOnce(currentWindow.promise);
    fake.methods.storageGet.mockReturnValueOnce(storage.promise);
    vi.stubGlobal("chrome", {
      tabs: fake.tabs,
      tabGroups: fake.tabGroups,
      windows: fake.windows,
      bookmarks: fake.bookmarks,
      history: fake.history,
      sessions: fake.sessions,
      storage: { local: fake.storage },
    });
    vi.resetModules();

    const sidebarModule = await import("../src/sidepanel/sidebar");
    expect(sidebarModule).not.toHaveProperty("bootstrapSidebar");
    expect(fake.methods.getCurrent).toHaveBeenCalledOnce();
    expect(fake.methods.storageGet).toHaveBeenCalledTimes(2);
    expect(fake.methods.storageGet).toHaveBeenCalledWith("shortcutSettings");
    expect(fake.methods.storageGet).toHaveBeenCalledWith("shortcutFaviconCacheV1");
    window.dispatchEvent(new Event("pagehide"));
    currentWindow.resolve({ id: 10 } as chrome.windows.Window);
    storage.resolve({});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fake.methods.query).not.toHaveBeenCalled();
    for (const event of Object.values(fake.events)) expect(event.listenerCount).toBe(0);
    expect(rowIds()).toEqual([]);
    expect(document.documentElement.dataset.ready).toBeUndefined();
  });

  it("auto entry cleans deferred query listeners after an early pagehide and ignores its late result", async () => {
    const query = deferred<chrome.tabs.Tab[]>();
    const fake = createFakeChrome();
    fake.methods.query.mockReturnValueOnce(query.promise);
    vi.stubGlobal("chrome", {
      tabs: fake.tabs,
      tabGroups: fake.tabGroups,
      windows: fake.windows,
      bookmarks: fake.bookmarks,
      history: fake.history,
      sessions: fake.sessions,
      storage: { local: fake.storage },
    });
    vi.resetModules();
    await import("../src/sidepanel/sidebar");
    await vi.waitFor(() =>
      expect(fake.methods.query).toHaveBeenCalledWith({ windowId: 10 }),
    );
    fake.events.onCreated.emit(fakeTab({ id: 4, index: 0, title: "Buffered" }));

    window.dispatchEvent(new Event("pagehide"));
    query.resolve([fakeTab()]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rowIds()).toEqual([]);
    for (const event of Object.values(fake.events)) expect(event.listenerCount).toBe(0);
    expect(document.documentElement.dataset.ready).toBeUndefined();
  });

  it("auto entry stays active until pagehide and cleans up only once", async () => {
    const fake = createFakeChrome({ tabs: [fakeTab()] });
    const abort = vi.spyOn(AbortController.prototype, "abort");
    vi.stubGlobal("chrome", {
      tabs: fake.tabs,
      tabGroups: fake.tabGroups,
      windows: fake.windows,
      bookmarks: fake.bookmarks,
      history: fake.history,
      sessions: fake.sessions,
      storage: { local: fake.storage },
    });
    vi.resetModules();
    await import("../src/sidepanel/sidebar");
    await vi.waitFor(() => expect(fake.events.onCreated.listenerCount).toBe(1));

    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));

    expect(abort).not.toHaveBeenCalled();
    for (const event of Object.values(fake.events)) {
      expect(event.listenerCount).toBe(0);
      expect(event.removed).toHaveLength(1);
    }
  });

  it("auto entry removes pagehide and handles startup rejection", async () => {
    element("tab-list").remove();
    const fake = createFakeChrome();
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    vi.stubGlobal("chrome", {
      tabs: fake.tabs,
      tabGroups: fake.tabGroups,
      windows: fake.windows,
      bookmarks: fake.bookmarks,
      history: fake.history,
      sessions: fake.sessions,
      storage: { local: fake.storage },
    });
    vi.resetModules();

    await import("../src/sidepanel/sidebar");
    await vi.waitFor(() =>
      expect(element("status-message").textContent).toContain("tab-list"),
    );

    expect(removeEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function));
  });

  it.each([
    "tab-list",
    "tab-scroll",
    "new-tab-button",
    "tab-region",
    "history-search-results",
    "shortcut-dialog-title",
    "shortcut-cancel",
    "shortcut-save",
    "tab-title-font-size",
    "tab-group-dialog",
    "tab-group-form",
    "tab-group-name",
    "tab-group-error",
    "tab-group-cancel",
    "tab-group-create",
    "tab-group-rename-dialog",
    "tab-group-rename-form",
    "tab-group-rename-name",
    "tab-group-rename-error",
    "tab-group-rename-cancel",
    "tab-group-rename-save",
  ])("rejects a missing required element with its id: %s", async (id) => {
    element(id).remove();
    const fake = createFakeChrome();

    await expect(startSidebar(fake)).rejects.toThrow(id);
  });

  it("accepts the real Chrome API dependency shapes at compile time", () => {
    type RealChromeDependencies = {
      tabs: typeof chrome.tabs;
      tabGroups: typeof chrome.tabGroups;
      windows: typeof chrome.windows;
      bookmarks: typeof chrome.bookmarks;
      history: typeof chrome.history;
      sessions: typeof chrome.sessions;
      storage: typeof chrome.storage.local;
      document: Document;
    };
    const dependencies: SidebarDependencies = null as unknown as RealChromeDependencies;
    expect(dependencies).toBeNull();
  });
});

describe("sidebar document structure", () => {
  it("keeps the tab list and new-tab control together in the scrolling region", () => {
    const html = readFileSync("src/sidepanel/index.html", "utf8");
    const page = new DOMParser().parseFromString(html, "text/html");
    const scroll = page.querySelector("#tab-scroll");
    const list = page.querySelector("#tab-list");
    const button = page.querySelector<HTMLButtonElement>("#new-tab-button");

    expect(Array.from(scroll?.children ?? [], (child) => child.id)).toEqual([
      "tab-list",
      "new-tab-button",
    ]);
    expect(list?.getAttribute("role")).toBe("list");
    expect(button?.type).toBe("button");
    expect(button?.title).toBe("新建标签页");
    expect(button?.getAttribute("aria-label")).toBe("新建标签页");
  });

  it("provides the bounded tab title font size control in the appearance section", () => {
    const html = readFileSync("src/sidepanel/index.html", "utf8");
    const page = new DOMParser().parseFromString(html, "text/html");
    const input = page.querySelector<HTMLInputElement>("#tab-title-font-size");

    expect(page.querySelector("#shortcut-dialog-title")?.textContent).toBe("设置");
    expect(input?.type).toBe("number");
    expect(input?.min).toBe("12");
    expect(input?.max).toBe("18");
    expect(input?.step).toBe("1");
    expect(input?.getAttribute("inputmode")).toBe("numeric");
    expect(input?.closest("section")?.querySelector("h3")?.textContent).toBe("外观");
    expect(input?.closest("label")?.textContent).toContain("标签标题字号");
  });

  it("scopes the configurable font size to tab titles", () => {
    const css = readFileSync("src/sidepanel/sidebar.css", "utf8");
    expect(css).toMatch(/:root\s*\{[^}]*--tab-title-font-size:\s*16px/s);
    expect(css).toMatch(/\.tab-title\s*\{[^}]*font-size:\s*var\(--tab-title-font-size\)/s);
    expect(css.match(/var\(--tab-title-font-size\)/g)).toHaveLength(1);
  });

  it("keeps shortcuts, tabs, status, and the fixed bottom toolbar in shell order", () => {
    const html = readFileSync("src/sidepanel/index.html", "utf8");
    const page = new DOMParser().parseFromString(html, "text/html");
    const shell = page.querySelector(".sidebar-shell");
    expect(Array.from(shell?.children ?? [], (child) => child.id || child.className)).toEqual([
      "shortcut-strip",
      "tab-region",
      "status-message",
      "bottom-toolbar",
    ]);
    expect(page.querySelector<HTMLElement>("#shortcut-strip")?.hidden).toBe(true);
  });

  it("places the unique search and settings controls only in the bottom toolbar", () => {
    const html = readFileSync("src/sidepanel/index.html", "utf8");
    const page = new DOMParser().parseFromString(html, "text/html");
    const footer = page.querySelector("footer.bottom-toolbar");

    expect(page.querySelectorAll("#tab-search")).toHaveLength(1);
    expect(page.querySelectorAll("#history-search-results")).toHaveLength(1);
    expect(page.querySelectorAll("#shortcut-settings")).toHaveLength(1);
    expect(page.querySelectorAll("#status-message")).toHaveLength(1);
    expect(footer?.querySelector("#tab-search")).not.toBeNull();
    expect(footer?.querySelector("#history-search-results")?.getAttribute("role"))
      .toBe("listbox");
    expect(footer?.querySelector<HTMLInputElement>("#tab-search")?.placeholder)
      .toBe("搜索收藏夹和历史记录");
    expect(footer?.querySelector("#tab-search")?.getAttribute("aria-label"))
      .toBe("搜索收藏夹和历史记录");
    expect(footer?.querySelector("#shortcut-settings")).not.toBeNull();
    expect(footer?.querySelector("#status-message")).toBeNull();
  });
});
