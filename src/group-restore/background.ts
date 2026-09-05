import { createGroupRestore } from "./controller";

/**
 * 注册后台分组快照事件与侧边栏恢复消息。
 *
 * Args:
 *   api: Chrome 扩展 API。
 * Returns:
 *   无。
 */
export function registerGroupRestore(api: typeof chrome): void {
  const controller = createGroupRestore({
    tabs: api.tabs, tabGroups: api.tabGroups, windows: api.windows,
    local: api.storage.local, session: api.storage.session,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleCapture = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    // 合并分组操作的连续事件，给窗口关闭事件机会保护最后一份快照。
    timer = setTimeout(() => {
      timer = undefined;
      void controller.capture().catch(() => console.warn("无法保存分组恢复记录"));
    }, 200);
  };
  api.tabs.onCreated.addListener(scheduleCapture);
  api.tabs.onUpdated.addListener(scheduleCapture);
  api.tabs.onMoved.addListener(scheduleCapture);
  api.tabs.onAttached.addListener(scheduleCapture);
  api.tabs.onDetached.addListener(scheduleCapture);
  api.tabs.onReplaced.addListener(scheduleCapture);
  api.tabs.onRemoved.addListener((_id, info) => {
    if (info.isWindowClosing) controller.windowClosing(info.windowId);
    scheduleCapture();
  });
  api.tabGroups.onCreated.addListener(scheduleCapture);
  api.tabGroups.onUpdated.addListener(scheduleCapture);
  api.tabGroups.onMoved.addListener(scheduleCapture);
  api.tabGroups.onRemoved.addListener(scheduleCapture);
  api.windows.onRemoved.addListener((id) => { controller.windowClosing(id); scheduleCapture(); });
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== api.runtime.id || sender.url !== api.runtime.getURL("sidepanel/index.html")) return undefined;
    if (!message || !Number.isInteger(message.windowId)) return undefined;
    if (message.type !== "group-restore/open" && message.type !== "group-restore/settings-saved") return undefined;
    const task = message.type === "group-restore/open"
      ? controller.open(message.windowId)
      : controller.settingsSaved(message.windowId);
    void task.then(() => sendResponse({ ok: true }), () => sendResponse({ error: "无法恢复或保存分组，请重新打开侧边栏重试" }));
    return true;
  });
}
