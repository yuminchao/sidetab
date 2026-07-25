import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultShortcutSettings } from "../src/sidepanel/shortcut-model";
import { startSidebar, type SidebarDependencies } from "../src/sidepanel/sidebar";
import { createFakeChrome, deferred, fakeTab } from "./helpers/fake-chrome";

function installFixture(): void {
  delete document.documentElement.dataset.ready;
  document.body.innerHTML = `
    <div id="shortcut-strip" hidden></div>
    <input id="tab-search" />
    <button id="shortcut-settings"></button>
    <p id="status-message"></p>
    <section id="tab-region">
    <p id="tab-empty" hidden></p>
    <div id="tab-list"></div>
    </section>
    <dialog id="shortcut-dialog">
      <form id="shortcut-form">
        <h2 id="shortcut-dialog-title"></h2>
        <input id="shortcut-enabled" type="checkbox" />
        <div id="shortcut-editor-list"></div>
        <p id="shortcut-error"></p>
        <button id="shortcut-add" type="button"></button>
        <button id="shortcut-reset" type="button"></button>
        <button id="shortcut-cancel" data-action="cancel" type="button"></button>
        <button id="shortcut-save" type="submit"></button>
      </form>
    </dialog>`;
  const dialog = element<HTMLDialogElement>("shortcut-dialog");
  dialog.showModal = vi.fn(() => dialog.setAttribute("open", ""));
  dialog.close = vi.fn(() => {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  });
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`missing fixture element ${id}`);
  return value as T;
}

function rowIds(): number[] {
  return Array.from(element("tab-list").children, (row) =>
    Number((row as HTMLElement).dataset.tabId),
  );
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

function input(value: string): void {
  const search = element<HTMLInputElement>("tab-search");
  search.value = value;
  search.dispatchEvent(new Event("input", { bubbles: true }));
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
    expect(element("shortcut-strip").hidden).toBe(true);
    expect(element("shortcut-strip").childElementCount).toBe(0);
    cleanup();
  });

  it("keeps tabs usable with defaults when storage loading fails", async () => {
    const fake = createFakeChrome({ tabs: [fakeTab()] });
    fake.methods.storageGet.mockRejectedValueOnce(new Error("offline"));

    const cleanup = await startSidebar(fake);

    expect(rowIds()).toEqual([1]);
    expect(element("shortcut-strip").hidden).toBe(true);
    expect(element("status-message").textContent).toBe("无法读取快捷网站设置");
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
    expect(replaceChildren).toHaveBeenCalledOnce();
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
    expect(replaceChildren).toHaveBeenCalledOnce();
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

  it("debounces search by 100ms and always reads the latest value", async () => {
    vi.useFakeTimers();
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 1, title: "Alpha" }), fakeTab({ id: 2, index: 1, title: "Beta" })],
    });
    const cleanup = await startSidebar(fake);

    input("alpha");
    await vi.advanceTimersByTimeAsync(79);
    expect(rowIds()).toEqual([1, 2]);
    element<HTMLInputElement>("tab-search").value = "beta";
    await vi.advanceTimersByTimeAsync(21);
    expect(rowIds()).toEqual([2]);
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

  it("updates the DOM for all seven current-window events and ignores other windows", async () => {
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

  it("patches an ordinary update in place and rerenders while searching", async () => {
    vi.useFakeTimers();
    const fake = createFakeChrome({ tabs: [fakeTab({ id: 1, title: "Alpha" })] });
    const cleanup = await startSidebar(fake);
    const initial = row(1);

    fake.events.onUpdated.emit(1, {}, fakeTab({ id: 1, title: "Alpha updated" }));
    expect(row(1)).toBe(initial);

    input("alpha");
    await vi.advanceTimersByTimeAsync(100);
    const filtered = row(1);
    fake.events.onUpdated.emit(1, {}, fakeTab({ id: 1, title: "Alpha again" }));
    expect(row(1)).not.toBe(filtered);
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
    const fake = createFakeChrome({
      tabs: [fakeTab({ id: 1, favIconUrl: "data:image/png;base64,broken" })],
    });
    fake.methods.get.mockReturnValueOnce(attached.promise);
    const cleanup = await startSidebar(fake);
    input("missing");
    fake.events.onAttached.emit(4, { newWindowId: 10, newPosition: 1 });
    const image = row(1).querySelector("img")!;

    cleanup();
    cleanup();
    await vi.advanceTimersByTimeAsync(100);
    attached.resolve(fakeTab({ id: 4, index: 1 }));
    await flush();
    image.dispatchEvent(new Event("error"));
    click(element("shortcut-settings"));
    click(row(1).querySelector("[data-action='close']")!);

    expect(rowIds()).toEqual([1]);
    expect(row(1).querySelector("img")).toBe(image);
    expect(element<HTMLDialogElement>("shortcut-dialog").open).toBe(false);
    expect(fake.methods.remove).not.toHaveBeenCalled();
    for (const event of Object.values(fake.events)) expect(event.listenerCount).toBe(0);
  });

  it("auto entry invalidates deferred initialization when pagehide happens before startup resolves", async () => {
    const currentWindow = deferred<chrome.windows.Window>();
    const storage = deferred<Record<string, unknown>>();
    const fake = createFakeChrome();
    fake.methods.getCurrent.mockReturnValueOnce(currentWindow.promise);
    fake.methods.storageGet.mockReturnValueOnce(storage.promise);
    vi.stubGlobal("chrome", {
      tabs: fake.tabs,
      windows: fake.windows,
      storage: { local: fake.storage },
    });
    vi.resetModules();

    const sidebarModule = await import("../src/sidepanel/sidebar");
    expect(sidebarModule).not.toHaveProperty("bootstrapSidebar");
    expect(fake.methods.getCurrent).toHaveBeenCalledOnce();
    expect(fake.methods.storageGet).toHaveBeenCalledOnce();
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
      windows: fake.windows,
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
      windows: fake.windows,
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
      windows: fake.windows,
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
    "tab-region",
    "shortcut-dialog-title",
    "shortcut-cancel",
    "shortcut-save",
  ])("rejects a missing required element with its id: %s", async (id) => {
    element(id).remove();
    const fake = createFakeChrome();

    await expect(startSidebar(fake)).rejects.toThrow(id);
  });

  it("accepts the real Chrome API dependency shapes at compile time", () => {
    type RealChromeDependencies = {
      tabs: typeof chrome.tabs;
      windows: typeof chrome.windows;
      storage: typeof chrome.storage.local;
      document: Document;
    };
    const dependencies: SidebarDependencies = null as unknown as RealChromeDependencies;
    expect(dependencies).toBeNull();
  });
});
