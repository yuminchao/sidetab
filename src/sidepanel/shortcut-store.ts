import {
  createDefaultShortcutSettings,
  validateShortcutSettings,
  type ShortcutSettings,
} from "./shortcut-model";

export type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

const shortcutSettingsKey = "shortcutSettings";

export function createShortcutStore(area: StorageArea) {
  return {
    async load(): Promise<ShortcutSettings> {
      let stored: Record<string, unknown>;
      try {
        stored = await area.get(shortcutSettingsKey);
        if (!Object.hasOwn(stored, shortcutSettingsKey)) {
          return createDefaultShortcutSettings();
        }
      } catch {
        throw new Error("无法读取快捷网站设置");
      }

      const validation = validateShortcutSettings(stored[shortcutSettingsKey]);
      return validation.ok ? copySettings(validation.value) : createDefaultShortcutSettings();
    },

    async save(settings: ShortcutSettings): Promise<ShortcutSettings> {
      const validation = validateShortcutSettings(settings);
      if (!validation.ok) {
        throw new Error(validation.message);
      }

      const written = copySettings(validation.value);
      try {
        await area.set({ [shortcutSettingsKey]: written });
      } catch {
        throw new Error("无法保存快捷网站设置");
      }
      return copySettings(written);
    },

    async reset(): Promise<ShortcutSettings> {
      const defaults = createDefaultShortcutSettings();
      try {
        await area.set({ [shortcutSettingsKey]: copySettings(defaults) });
      } catch {
        throw new Error("无法恢复默认设置");
      }
      return defaults;
    },
  };
}

function copySettings(settings: ShortcutSettings): ShortcutSettings {
  return {
    enabled: settings.enabled,
    items: settings.items.map((item) => ({ ...item })),
  };
}
