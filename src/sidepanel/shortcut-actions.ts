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
  };
}
