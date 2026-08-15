import { normalizeShortcutUrl } from "./shortcut-model";

export type ShortcutTabsApi = Pick<typeof chrome.tabs, "create">;

export function createShortcutActions(api: ShortcutTabsApi) {
  return {
    async open(rawUrl: string): Promise<void> {
      const url = normalizeShortcutUrl(rawUrl);
      try {
        await api.create({ url, active: true });
      } catch {
        throw new Error("无法打开快捷网站");
      }
    },

    async openMany(urls: readonly string[]): Promise<void> {
      if (urls.length === 0) return;
      const results = await Promise.allSettled(
        urls.map((url) => api.create({ url: normalizeShortcutUrl(url), active: false })),
      );
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("无法打开全部快捷网站");
      }
    },
  };
}
