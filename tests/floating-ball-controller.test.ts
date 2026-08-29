import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFloatingBallController } from "../src/floating-ball/controller";

function createSettingsStore() {
  return {
    load: vi.fn().mockResolvedValue({ enabled: false, position: { xRatio: 1, yRatio: 1 } }),
    setEnabled: vi.fn().mockResolvedValue(undefined),
    savePosition: vi.fn().mockResolvedValue(undefined),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function mountController(
  sendMessage: ReturnType<typeof vi.fn>,
) {
  const controller = createFloatingBallController({
    document,
    window,
    settings: createSettingsStore(),
    runtime: { sendMessage },
  });
  await controller.applySettings({ enabled: true, position: { xRatio: 1, yRatio: 1 } });
  const host = document.querySelector<HTMLElement>("[data-sidetab-floating-ball-host]")!;
  const shadow = host.shadowRoot!;
  const ball = shadow.querySelector<HTMLButtonElement>("[data-action='toggle-search']")!;
  const input = shadow.querySelector<HTMLInputElement>("input")!;
  const search = shadow.querySelector<HTMLElement>(".search")!;
  const results = shadow.querySelector<HTMLElement>(".results")!;
  ball.click();
  await flush();
  return { controller, host, shadow, ball, input, search, results };
}

function enter(input: HTMLInputElement, key = "Enter"): void {
  input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function changeInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("floating ball controller", () => {
  beforeEach(() => {
    document.querySelectorAll("[data-sidetab-floating-ball-host]").forEach((host) => host.remove());
    document.body.replaceChildren();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  });

  it("mounts on enable and focuses the search input after a normal click", async () => {
    const settings = createSettingsStore();
    const runtime = { sendMessage: vi.fn().mockResolvedValue({ ok: true, value: [] }) };
    const controller = createFloatingBallController({ document, window, settings, runtime });

    await controller.applySettings({ enabled: true, position: { xRatio: 1, yRatio: 1 } });
    const host = document.querySelector("[data-sidetab-floating-ball-host]") as HTMLElement;
    const ball = host.shadowRoot!.querySelector<HTMLButtonElement>("[data-action='toggle-search']")!;
    ball.click();

    expect(host.shadowRoot!.activeElement).toBe(host.shadowRoot!.querySelector("input"));
    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: "floating-ball/search", query: "" });
  });

  it("keeps the ball anchored while the search panel expands to its left", async () => {
    const controller = createFloatingBallController({
      document,
      window,
      settings: createSettingsStore(),
      runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, value: [] }) },
    });
    await controller.applySettings({ enabled: true, position: { xRatio: 1, yRatio: 1 } });
    const host = document.querySelector<HTMLElement>("[data-sidetab-floating-ball-host]")!;
    const style = host.shadowRoot!.querySelector("style")!.textContent;

    expect(host.style.width).toBe("44px");
    expect(host.style.height).toBe("44px");
    expect(style).toContain(".widget{position:absolute;right:0;bottom:0");
    expect(style).toContain(".search{position:absolute;right:52px;bottom:0");
  });

  it("removes the host when disabled and hides it during fullscreen", async () => {
    const settings = createSettingsStore();
    const controller = createFloatingBallController({
      document,
      window,
      settings,
      runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, value: [] }) },
    });
    await controller.applySettings({ enabled: true, position: { xRatio: 1, yRatio: 1 } });
    const host = document.querySelector("[data-sidetab-floating-ball-host]") as HTMLElement;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.documentElement });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(host.hidden).toBe(true);

    await controller.applySettings({ enabled: false, position: { xRatio: 1, yRatio: 1 } });
    expect(document.querySelector("[data-sidetab-floating-ball-host]")).toBeNull();
  });

  it("debounces the latest query and lets Escape close the search surface", async () => {
    vi.useFakeTimers();
    const settings = createSettingsStore();
    const runtime = { sendMessage: vi.fn().mockResolvedValue({ ok: true, value: [] }) };
    const controller = createFloatingBallController({ document, window, settings, runtime });
    await controller.applySettings({ enabled: true, position: { xRatio: 1, yRatio: 1 } });
    const host = document.querySelector("[data-sidetab-floating-ball-host]") as HTMLElement;
    const shadow = host.shadowRoot!;
    shadow.querySelector<HTMLButtonElement>("[data-action='toggle-search']")!.click();
    const input = shadow.querySelector<HTMLInputElement>("input")!;
    input.value = "old";
    input.dispatchEvent(new Event("input"));
    input.value = "latest";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(100);
    expect(runtime.sendMessage).toHaveBeenLastCalledWith({ type: "floating-ball/search", query: "latest" });

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(shadow.querySelector<HTMLElement>(".search")!.hidden).toBe(true);
    vi.useRealTimers();
  });

  it("keeps the context menu open and shows a controlled failure", async () => {
    const settings = createSettingsStore();
    const controller = createFloatingBallController({
      document,
      window,
      settings,
      runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: false, error: "operation-failed", message: "操作失败" }) },
    });
    await controller.applySettings({ enabled: true, position: { xRatio: 1, yRatio: 1 } });
    const host = document.querySelector("[data-sidetab-floating-ball-host]") as HTMLElement;
    const shadow = host.shadowRoot!;
    const ball = shadow.querySelector<HTMLButtonElement>("[data-action='toggle-search']")!;
    ball.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    shadow.querySelector<HTMLButtonElement>("[data-action='floating-ball/close-tab']")!.click();
    await Promise.resolve();

    expect(shadow.querySelector<HTMLElement>(".menu")!.hidden).toBe(false);
    expect(shadow.querySelector<HTMLElement>(".notice")!.hidden).toBe(false);
  });

  it("uses browser search only after the exact nonempty local query settles empty", async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn().mockImplementation(async (message) => {
      if (message.type === "floating-ball/search-web") return { ok: true };
      return { ok: true, value: [] };
    });
    const { controller, input, search } = await mountController(sendMessage);

    changeInput(input, "  no local result  ");
    enter(input);
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "floating-ball/search-web" }));
    await vi.advanceTimersByTimeAsync(100);
    enter(input);
    await flush();

    expect(sendMessage).toHaveBeenCalledWith({
      type: "floating-ball/search-web",
      query: "no local result",
    });
    expect(input.value).toBe("");
    expect(search.hidden).toBe(true);
    controller.destroy();
    vi.useRealTimers();
  });

  it("does not search the web for empty, pending, stale or failed local queries", async () => {
    vi.useFakeTimers();
    const pending = deferred<{ ok: true; value: never[] }>();
    const sendMessage = vi.fn().mockImplementation((message) => {
      if (message.type === "floating-ball/search-web") return Promise.resolve({ ok: true });
      if (message.query === "pending") return pending.promise;
      if (message.query === "failed") {
        return Promise.resolve({ ok: false, error: "operation-failed", message: "无法读取搜索记录" });
      }
      return Promise.resolve({ ok: true, value: [] });
    });
    const { controller, input } = await mountController(sendMessage);

    changeInput(input, "   ");
    await vi.advanceTimersByTimeAsync(100);
    enter(input);
    changeInput(input, "pending");
    await vi.advanceTimersByTimeAsync(100);
    enter(input);
    pending.resolve({ ok: true, value: [] });
    await flush();
    input.value = "stale";
    enter(input);
    changeInput(input, "failed");
    await vi.advanceTimersByTimeAsync(100);
    enter(input);
    await flush();

    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "floating-ball/search-web" }));
    controller.destroy();
    vi.useRealTimers();
  });

  it("opens an explicitly selected local result instead of browser search", async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn().mockImplementation(async (message) => {
      if (message.type === "floating-ball/search" && message.query === "local") {
        return { ok: true, value: [{
          id: "local",
          title: "Local",
          url: "https://local.example/",
          source: "history",
        }] };
      }
      return { ok: true, value: [] };
    });
    const { controller, input } = await mountController(sendMessage);

    changeInput(input, "local");
    await vi.advanceTimersByTimeAsync(100);
    enter(input, "ArrowDown");
    enter(input);
    await flush();

    expect(sendMessage).toHaveBeenCalledWith({
      type: "floating-ball/open-search-result",
      url: "https://local.example/",
    });
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "floating-ball/search-web" }));
    controller.destroy();
    vi.useRealTimers();
  });

  it("suppresses duplicate Enter while browser search is in flight", async () => {
    vi.useFakeTimers();
    const pendingWeb = deferred<{ ok: true }>();
    const sendMessage = vi.fn().mockImplementation((message) => message.type === "floating-ball/search-web"
      ? pendingWeb.promise
      : Promise.resolve({ ok: true, value: [] }));
    const { controller, input } = await mountController(sendMessage);

    changeInput(input, "duplicate");
    await vi.advanceTimersByTimeAsync(100);
    enter(input);
    enter(input);
    await flush();

    expect(sendMessage.mock.calls.filter(([message]) => message.type === "floating-ball/search-web")).toHaveLength(1);
    pendingWeb.resolve({ ok: true });
    await flush();
    controller.destroy();
    vi.useRealTimers();
  });

  it.each(["controlled", "rejected"] as const)(
    "keeps the panel open and renders a stable error when browser search is %s",
    async (outcome) => {
      vi.useFakeTimers();
      const sendMessage = vi.fn().mockImplementation((message) => {
        if (message.type !== "floating-ball/search-web") return Promise.resolve({ ok: true, value: [] });
        return outcome === "controlled"
          ? Promise.resolve({ ok: false, error: "operation-failed", message: "悬浮球操作失败" })
          : Promise.reject(new Error("runtime unavailable"));
      });
      const { controller, input, search, results } = await mountController(sendMessage);

      changeInput(input, "missing");
      await vi.advanceTimersByTimeAsync(100);
      enter(input);
      await flush();

      expect(input.value).toBe("missing");
      expect(search.hidden).toBe(false);
      expect(results.textContent).toBe("无法打开浏览器搜索");
      controller.destroy();
      vi.useRealTimers();
    },
  );

  it.each([
    ["input", "success"],
    ["input", "failure"],
    ["escape", "success"],
    ["escape", "failure"],
    ["outside", "success"],
    ["outside", "failure"],
    ["toggle", "success"],
    ["toggle", "failure"],
    ["disable", "success"],
    ["disable", "failure"],
    ["destroy", "success"],
    ["destroy", "failure"],
  ] as const)("invalidates late browser-search after %s with a %s outcome", async (invalidation, outcome) => {
    vi.useFakeTimers();
    const pendingWeb = deferred<{ ok: boolean; error?: string; message?: string }>();
    const sendMessage = vi.fn().mockImplementation((message) => message.type === "floating-ball/search-web"
      ? pendingWeb.promise
      : Promise.resolve({ ok: true, value: [] }));
    const view = await mountController(sendMessage);
    changeInput(view.input, "old");
    await vi.advanceTimersByTimeAsync(100);
    enter(view.input);
    await flush();

    if (invalidation === "input") changeInput(view.input, "new");
    if (invalidation === "escape") enter(view.input, "Escape");
    if (invalidation === "outside") document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    if (invalidation === "toggle") view.ball.click();
    if (invalidation === "disable") {
      await view.controller.applySettings({ enabled: false, position: { xRatio: 1, yRatio: 1 } });
    }
    if (invalidation === "destroy") view.controller.destroy();
    const before = {
      connected: view.host.isConnected,
      input: view.input.value,
      searchHidden: view.search.hidden,
      results: view.results.innerHTML,
    };

    pendingWeb.resolve(outcome === "success"
      ? { ok: true }
      : { ok: false, error: "operation-failed", message: "悬浮球操作失败" });
    await flush();

    expect({
      connected: view.host.isConnected,
      input: view.input.value,
      searchHidden: view.search.hidden,
      results: view.results.innerHTML,
    }).toEqual(before);
    view.controller.destroy();
    vi.useRealTimers();
  });

  it("renders structured bookmark and history options with stable result typography", async () => {
    const longTitle = "A very long result title ".repeat(20);
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        { id: "b", title: longTitle, url: "https://bookmark.example/", source: "bookmark" },
        { id: "h", title: "Visited", url: "https://history.example/", source: "history" },
      ],
    });
    const { controller, shadow, results } = await mountController(sendMessage);
    const options = Array.from(results.querySelectorAll<HTMLButtonElement>("button[role='option']"));

    expect(options).toHaveLength(2);
    expect(options[0]!.querySelector(".result-title")?.textContent).toBe(longTitle);
    expect(options[0]!.querySelector<HTMLElement>(".result-source")?.dataset.source).toBe("bookmark");
    expect(options[0]!.querySelector(".result-source")?.textContent).toBe("收藏夹");
    expect(options[1]!.querySelector<HTMLElement>(".result-source")?.dataset.source).toBe("history");
    expect(options[1]!.querySelector(".result-source")?.textContent).toBe("历史记录");

    const style = shadow.querySelector("style")!.textContent;
    expect(style).toContain("font-family:\"Segoe UI\",\"Microsoft YaHei\",system-ui,sans-serif");
    expect(style).toContain("font-size:13px");
    expect(style).toContain("letter-spacing:0");
    expect(style).toContain("grid-template-columns:minmax(0,1fr) auto");
    expect(style).toContain(".result-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}");
    expect(style).toContain(".result-source{height:18px;line-height:18px;padding:0 6px;border-radius:9px;font-size:11px");
    expect(style).toContain(".result-source[data-source=bookmark]");
    expect(style).toContain(".result-source[data-source=history]");
    controller.destroy();
  });
});
