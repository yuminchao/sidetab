import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFloatingBallController } from "../src/floating-ball/controller";

function createSettingsStore() {
  return {
    load: vi.fn().mockResolvedValue({ enabled: false, position: { xRatio: 1, yRatio: 1 } }),
    setEnabled: vi.fn().mockResolvedValue(undefined),
    savePosition: vi.fn().mockResolvedValue(undefined),
  };
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
});
