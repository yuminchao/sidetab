import { describe, expect, it, vi } from "vitest";
import {
  createRecentlyClosedTabController,
  type SessionsApi,
} from "../src/sidepanel/recently-closed-tab";

function deferred<T>() {
  let resolve!: (value: T) => void;
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
  await Promise.resolve();
}

function tabSession(sessionId: string | undefined): chrome.sessions.Session {
  return { lastModified: 0, tab: { sessionId } as chrome.tabs.Tab };
}

function windowSession(): chrome.sessions.Session {
  return {
    lastModified: 0,
    window: { sessionId: "window-session" } as chrome.windows.Window,
  };
}

function createSessionsApi(
  getRecentlyClosed: SessionsApi["getRecentlyClosed"],
  restore: SessionsApi["restore"] = vi.fn(async () => ({ lastModified: 0 })),
) {
  const listeners = new Set<() => void>();
  const onChanged = {
    addListener: vi.fn((listener: () => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: () => void) => listeners.delete(listener)),
  } as unknown as SessionsApi["onChanged"];
  return {
    api: { getRecentlyClosed, restore, onChanged } satisfies SessionsApi,
    emitChanged() {
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

describe("recently closed tab controller", () => {
  it("loads only the first valid tab session and skips windows", async () => {
    const getRecentlyClosed = vi.fn(async () => [
      windowSession(),
      tabSession(undefined),
      tabSession("recent-tab"),
      tabSession("older-tab"),
    ]);
    const fake = createSessionsApi(getRecentlyClosed);
    const controller = createRecentlyClosedTabController(fake.api);

    await vi.waitFor(() => expect(getRecentlyClosed).toHaveBeenCalledOnce());
    await flush();

    expect(getRecentlyClosed).toHaveBeenCalledWith({ maxResults: 25 });
    expect(controller.getSessionId()).toBe("recent-tab");
    expect(fake.listenerCount()).toBe(1);
    controller.destroy();
  });

  it("keeps startup usable when querying sessions fails", async () => {
    const getRecentlyClosed = vi.fn(async (): Promise<chrome.sessions.Session[]> => {
      throw new Error("browser failure");
    });
    const fake = createSessionsApi(getRecentlyClosed);
    const controller = createRecentlyClosedTabController(fake.api);

    await vi.waitFor(() => expect(getRecentlyClosed).toHaveBeenCalledOnce());
    await flush();

    expect(controller.getSessionId()).toBeUndefined();
    controller.destroy();
  });

  it("serializes burst refreshes and performs one follow-up query", async () => {
    const current = deferred<chrome.sessions.Session[]>();
    const followUp = deferred<chrome.sessions.Session[]>();
    const getRecentlyClosed = vi
      .fn<SessionsApi["getRecentlyClosed"]>()
      .mockResolvedValueOnce([tabSession("initial")])
      .mockReturnValueOnce(current.promise)
      .mockReturnValueOnce(followUp.promise);
    const fake = createSessionsApi(getRecentlyClosed);
    const controller = createRecentlyClosedTabController(fake.api);
    await vi.waitFor(() => expect(controller.getSessionId()).toBe("initial"));

    fake.emitChanged();
    fake.emitChanged();
    fake.emitChanged();
    expect(getRecentlyClosed).toHaveBeenCalledTimes(2);

    current.resolve([tabSession("intermediate")]);
    await flush();
    expect(getRecentlyClosed).toHaveBeenCalledTimes(3);
    expect(controller.getSessionId()).toBe("intermediate");

    followUp.resolve([tabSession("latest")]);
    await flush();
    expect(controller.getSessionId()).toBe("latest");
    expect(getRecentlyClosed).toHaveBeenCalledTimes(3);
    controller.destroy();
  });

  it("restores the requested session and refreshes after success", async () => {
    const getRecentlyClosed = vi
      .fn<SessionsApi["getRecentlyClosed"]>()
      .mockResolvedValueOnce([tabSession("initial")])
      .mockResolvedValueOnce([tabSession("next")]);
    const restore = vi.fn(async () => ({ tab: { id: 7 } } as chrome.sessions.Session));
    const fake = createSessionsApi(getRecentlyClosed, restore);
    const controller = createRecentlyClosedTabController(fake.api);
    await vi.waitFor(() => expect(controller.getSessionId()).toBe("initial"));

    await controller.restore("initial");

    expect(restore).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledWith("initial");
    expect(getRecentlyClosed).toHaveBeenCalledTimes(2);
    expect(controller.getSessionId()).toBe("next");
    controller.destroy();
  });

  it("maps restore failures to a stable message and still refreshes", async () => {
    const getRecentlyClosed = vi
      .fn<SessionsApi["getRecentlyClosed"]>()
      .mockResolvedValueOnce([tabSession("initial")])
      .mockResolvedValueOnce([]);
    const restore = vi.fn(async (): Promise<chrome.sessions.Session> => {
      throw new Error("browser failure");
    });
    const fake = createSessionsApi(getRecentlyClosed, restore);
    const controller = createRecentlyClosedTabController(fake.api);
    await vi.waitFor(() => expect(controller.getSessionId()).toBe("initial"));

    await expect(controller.restore("initial")).rejects.toThrow(
      "无法打开最近关闭标签页",
    );

    expect(getRecentlyClosed).toHaveBeenCalledTimes(2);
    expect(controller.getSessionId()).toBeUndefined();
    controller.destroy();
  });

  it("removes its listener and ignores a late query after destroy", async () => {
    const pending = deferred<chrome.sessions.Session[]>();
    const getRecentlyClosed = vi.fn(() => pending.promise);
    const fake = createSessionsApi(getRecentlyClosed);
    const controller = createRecentlyClosedTabController(fake.api);
    await vi.waitFor(() => expect(getRecentlyClosed).toHaveBeenCalledOnce());

    controller.destroy();
    pending.resolve([tabSession("late")]);
    await flush();
    fake.emitChanged();

    expect(fake.listenerCount()).toBe(0);
    expect(controller.getSessionId()).toBeUndefined();
    expect(getRecentlyClosed).toHaveBeenCalledOnce();
  });
});
