import type { StorageArea } from "../sidepanel/shortcut-store";

export type RestoreSettings = { enabled: boolean; collapsed: boolean };
export const RESTORE_SETTINGS_KEY = "groupRestoreSettings";

/**
 * 创建自动恢复配置的本地存储。
 *
 * Args:
 *   area: 本地存储接口。
 * Returns:
 *   读取和保存恢复配置的接口。
 */
export function createRestoreSettingsStore(area: StorageArea) {
  return {
    async load(): Promise<RestoreSettings> {
      const raw = (await area.get(RESTORE_SETTINGS_KEY))[RESTORE_SETTINGS_KEY];
      const value = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
      return { enabled: value.enabled === true, collapsed: value.collapsed !== false };
    },
    async save(settings: RestoreSettings): Promise<void> {
      if (typeof settings.enabled !== "boolean" || typeof settings.collapsed !== "boolean") {
        throw new Error("分组恢复设置无效");
      }
      await area.set({ [RESTORE_SETTINGS_KEY]: { ...settings } });
    },
  };
}
