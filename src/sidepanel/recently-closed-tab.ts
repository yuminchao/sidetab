export type SessionsApi = {
  getRecentlyClosed(filter: chrome.sessions.Filter): Promise<chrome.sessions.Session[]>;
  restore(sessionId: string): Promise<chrome.sessions.Session>;
  onChanged: Pick<typeof chrome.sessions.onChanged, "addListener" | "removeListener">;
};

export type RecentlyClosedTabController = {
  getSessionId(): string | undefined;
  refresh(): Promise<void>;
  restore(sessionId: string): Promise<void>;
  destroy(): void;
};

function findRecentTabSessionId(
  sessions: readonly chrome.sessions.Session[],
): string | undefined {
  for (const session of sessions) {
    const sessionId = session.tab?.sessionId;
    if (typeof sessionId === "string" && sessionId.length > 0) return sessionId;
  }
  return undefined;
}

export function createRecentlyClosedTabController(
  api: SessionsApi,
): RecentlyClosedTabController {
  let active = true;
  let sessionId: string | undefined;
  let refreshPromise: Promise<void> | undefined;
  let followUpRequested = false;

  const queryOnce = async (): Promise<void> => {
    let nextSessionId: string | undefined;
    try {
      const sessions = await api.getRecentlyClosed({ maxResults: 25 });
      nextSessionId = findRecentTabSessionId(sessions);
    } catch {
      nextSessionId = undefined;
    }
    if (active) sessionId = nextSessionId;
  };

  const refresh = (): Promise<void> => {
    if (!active) return Promise.resolve();
    if (refreshPromise) {
      followUpRequested = true;
      return refreshPromise;
    }

    const operation = (async (): Promise<void> => {
      try {
        do {
          followUpRequested = false;
          await queryOnce();
        } while (active && followUpRequested);
      } finally {
        refreshPromise = undefined;
      }
    })();
    refreshPromise = operation;
    return operation;
  };

  const onChanged = (): void => {
    void refresh();
  };

  api.onChanged.addListener(onChanged);
  void refresh();

  return {
    getSessionId: () => sessionId,
    refresh,
    async restore(targetSessionId) {
      let restoreFailed = false;
      try {
        await api.restore(targetSessionId);
      } catch {
        restoreFailed = true;
      } finally {
        await refresh();
      }
      if (restoreFailed) throw new Error("无法打开最近关闭标签页");
    },
    destroy() {
      if (!active) return;
      active = false;
      sessionId = undefined;
      followUpRequested = false;
      api.onChanged.removeListener(onChanged);
    },
  };
}
