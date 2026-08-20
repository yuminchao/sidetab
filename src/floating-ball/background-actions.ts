import { searchBookmarksAndHistory } from "./search";
import {
  isFloatingBallRequest,
  type FloatingBallRequest,
  type FloatingBallResponse,
} from "./messages";
import { createOneClickGroupPlan, classifySmartGroupTab } from "../sidepanel/smart-group-model";
import { executeSmartGroupPlan } from "../sidepanel/smart-group-actions";
import { createSmartGroupSessionStore } from "../sidepanel/smart-group-session-store";
import { toTabViewModel } from "../sidepanel/tab-model";
import type { StorageArea } from "../sidepanel/shortcut-store";

export type FloatingBallChromeDependencies = {
  tabs: Pick<typeof chrome.tabs, "query" | "create" | "duplicate" | "get" | "update" | "remove" | "group">;
  tabGroups: Pick<typeof chrome.tabGroups, "query" | "get" | "update">;
  bookmarks: Pick<typeof chrome.bookmarks, "search">;
  history: Pick<typeof chrome.history, "search">;
  sidePanel: Pick<typeof chrome.sidePanel, "open">;
  scripting: Pick<typeof chrome.scripting, "executeScript">;
  storage: StorageArea;
};

export type FloatingBallBackground = {
  /**
   * 校验并执行来自内容脚本的悬浮球请求。
   *
   * @param message 未信任的运行时消息。
   * @param sender Chrome 提供的消息发送方信息。
   * @returns 稳定的成功或错误响应。
   */
  handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<FloatingBallResponse<unknown>>;
};

/**
 * 创建悬浮球后台动作处理器。
 *
 * @param deps Chrome API 与本地存储适配器。
 * @returns 可注册到 Service Worker 的请求处理器。
 */
export function createFloatingBallBackground(
  deps: FloatingBallChromeDependencies,
): FloatingBallBackground {
  const smartGroupBusyWindows = new Set<number>();
  const smartGroupSessions = createSmartGroupSessionStore(deps.storage);

  return {
    async handle(message, sender) {
      if (!isFloatingBallRequest(message)) {
        return failure("invalid-message", "悬浮球请求无效");
      }
      if (message.type === "floating-ball/ensure-injected") {
        try {
          await ensureInjected(deps);
          return success();
        } catch {
          return failure("operation-failed", "悬浮球操作失败");
        }
      }
      const tab = sender.tab;
      if (!tab?.id || tab.windowId === undefined || !isWebUrl(tab.url)) {
        return failure("invalid-sender", "当前页面不可用");
      }

      try {
        switch (message.type) {
          case "floating-ball/search":
            return success(await searchBookmarksAndHistory(
              { bookmarks: deps.bookmarks, history: deps.history },
              message.query,
            ));
          case "floating-ball/open-search-result":
            await deps.tabs.create({ url: message.url, active: true });
            return success();
          case "floating-ball/duplicate-tab":
            await deps.tabs.duplicate(tab.id);
            return success();
          case "floating-ball/get-tab-state": {
            const current = await deps.tabs.get(tab.id);
            return success({ pinned: Boolean(current.pinned) });
          }
          case "floating-ball/toggle-pin": {
            const current = await deps.tabs.get(tab.id);
            await deps.tabs.update(tab.id, { pinned: !current.pinned });
            return success();
          }
          case "floating-ball/close-tab":
            await deps.tabs.remove(tab.id);
            return success();
          case "floating-ball/open-side-panel":
            await deps.sidePanel.open({ windowId: tab.windowId });
            return success();
          case "floating-ball/smart-group-window":
            await runSmartGrouping(tab.windowId);
            return success();
        }
      } catch {
        return failure("operation-failed", "悬浮球操作失败");
      }
    },
  };

  async function runSmartGrouping(windowId: number): Promise<void> {
    if (smartGroupBusyWindows.has(windowId)) throw new Error("智能分组正在执行");
    smartGroupBusyWindows.add(windowId);
    try {
      const [chromeTabs, groups] = await Promise.all([
        deps.tabs.query({ windowId }),
        deps.tabGroups.query({ windowId }),
      ]);
      const tabs = chromeTabs.filter((candidate) => candidate.id !== undefined).map(toTabViewModel);
      const session = await smartGroupSessions.load(windowId);
      const plan = createOneClickGroupPlan(tabs, groups, session.otherGroupId);
      if (!plan) return;
      const expected = new Map(tabs.map((candidate) => [candidate.id, classifySmartGroupTab(candidate)?.key]));
      await executeSmartGroupPlan(plan, {
        tabs: deps.tabs,
        tabGroups: deps.tabGroups,
        validate(operation) {
          return operation.tabIds.every((id) => {
            const candidate = tabs.find((item) => item.id === id);
            return candidate !== undefined && classifySmartGroupTab(candidate)?.key === expected.get(id);
          });
        },
        onOtherGroupCreated: (groupId) => smartGroupSessions.saveOtherGroup(windowId, groupId),
      });
    } finally {
      smartGroupBusyWindows.delete(windowId);
    }
  }
}

async function ensureInjected(
  deps: FloatingBallChromeDependencies,
): Promise<void> {
  const tabs = await deps.tabs.query({});
  await Promise.allSettled(tabs.flatMap((tab) => {
    if (tab.id === undefined || !isWebUrl(tab.url)) return [];
    return [deps.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/floating-ball.js"] })];
  }));
}

function isWebUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function success<T>(value?: T): FloatingBallResponse<T> {
  return value === undefined ? { ok: true } : { ok: true, value };
}

function failure(error: string, message: string): FloatingBallResponse<never> {
  return { ok: false, error, message };
}
