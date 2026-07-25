export type TabsActionApi = {
  update(tabId: number, updateProperties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab>;
  remove(tabId: number): Promise<void>;
};

export function createTabActions(api: TabsActionApi) {
  return {
    async activate(tabId: number): Promise<void> {
      try {
        await api.update(tabId, { active: true });
      } catch {
        throw new Error("无法切换到该标签页");
      }
    },

    async close(tabId: number): Promise<void> {
      try {
        await api.remove(tabId);
      } catch {
        throw new Error("无法关闭该标签页");
      }
    },
  };
}
