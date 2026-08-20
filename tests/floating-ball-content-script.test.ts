import { beforeEach, describe, expect, it, vi } from "vitest";
import { FLOATING_BALL_ENABLED_KEY } from "../src/floating-ball/settings";
import { startFloatingBallContentScript } from "../src/floating-ball/content-script";

function createDependencies(enabled = false) {
  const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void>();
  const settingsStore = {
    load: vi.fn().mockResolvedValue({ enabled, position: { xRatio: 1, yRatio: 1 } }),
    setEnabled: vi.fn(),
    savePosition: vi.fn(),
  };
  return {
    document,
    window,
    settingsStore,
    runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, value: [] }) },
    storage: {
      onChanged: {
        addListener: vi.fn((listener) => listeners.add(listener)),
        removeListener: vi.fn((listener) => listeners.delete(listener)),
      },
    },
    emit(changes: Record<string, chrome.storage.StorageChange>) {
      for (const listener of listeners) listener(changes, "local");
    },
  };
}

describe("floating ball content script", () => {
  beforeEach(() => document.body.replaceChildren());

  it("is idempotent and responds only to floating ball storage changes", async () => {
    const deps = createDependencies(true);
    await startFloatingBallContentScript(deps);
    await startFloatingBallContentScript(deps);
    expect(document.querySelectorAll("[data-sidetab-floating-ball-host]")).toHaveLength(1);

    deps.emit({ unrelated: { oldValue: false, newValue: true } });
    await Promise.resolve();
    expect(deps.settingsStore.load).toHaveBeenCalledTimes(2);

    deps.emit({ [FLOATING_BALL_ENABLED_KEY]: { oldValue: false, newValue: true } });
    await Promise.resolve();
    expect(deps.settingsStore.load).toHaveBeenCalledTimes(3);
  });
});
