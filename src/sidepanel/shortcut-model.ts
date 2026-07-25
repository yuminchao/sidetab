export type ShortcutIcon = "openai" | "google" | "github" | "letter";

export type Shortcut = {
  id: string;
  name: string;
  url: string;
  icon: ShortcutIcon;
};

export type ShortcutSettings = {
  enabled: boolean;
  tabTitleFontSize: number;
  items: Shortcut[];
};

export const DEFAULT_TAB_TITLE_FONT_SIZE = 14;
export const MIN_TAB_TITLE_FONT_SIZE = 12;
export const MAX_TAB_TITLE_FONT_SIZE = 18;

export type ValidationResult =
  | { ok: true; value: ShortcutSettings }
  | { ok: false; message: string };

const defaultShortcuts: readonly Shortcut[] = [
  { id: "openai", name: "OpenAI", url: "https://chatgpt.com/", icon: "openai" },
  { id: "google", name: "Google", url: "https://www.google.com/", icon: "google" },
  { id: "github", name: "GitHub", url: "https://github.com/", icon: "github" },
];

const supportedIcons = new Set<ShortcutIcon>(["openai", "google", "github", "letter"]);

export function createDefaultShortcutSettings(): ShortcutSettings {
  return {
    enabled: false,
    tabTitleFontSize: DEFAULT_TAB_TITLE_FONT_SIZE,
    items: defaultShortcuts.map((shortcut) => ({ ...shortcut })),
  };
}

export function normalizeShortcutUrl(raw: string): string {
  const trimmed = raw.trim();
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(trimmed)?.[1];
  const candidate = scheme && !scheme.includes(".") ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname.includes(".")
    ) {
      throw new Error();
    }
    return url.href;
  } catch {
    throw new Error("仅支持 HTTP 或 HTTPS 地址");
  }
}

export function validateShortcutSettings(input: unknown): ValidationResult {
  try {
    if (!isRecord(input)) {
      return invalidFormat();
    }

    const enabled = input.enabled;
    const rawItems = input.items;
    const hasTabTitleFontSize = Object.hasOwn(input, "tabTitleFontSize");
    const rawTabTitleFontSize = hasTabTitleFontSize
      ? input.tabTitleFontSize
      : DEFAULT_TAB_TITLE_FONT_SIZE;
    if (typeof enabled !== "boolean" || !Array.isArray(rawItems)) {
      return invalidFormat();
    }

    const tabTitleFontSize = rawTabTitleFontSize;
    if (
      typeof tabTitleFontSize !== "number" ||
      !Number.isFinite(tabTitleFontSize) ||
      !Number.isInteger(tabTitleFontSize) ||
      tabTitleFontSize < MIN_TAB_TITLE_FONT_SIZE ||
      tabTitleFontSize > MAX_TAB_TITLE_FONT_SIZE
    ) {
      return invalidFormat();
    }

    const length = rawItems.length;
    if (length > 12) {
      return { ok: false, message: "最多只能添加 12 个快捷网站" };
    }

    const ids = new Set<string>();
    const urls = new Set<string>();
    const items: Shortcut[] = [];

    for (let index = 0; index < length; index += 1) {
      const item = rawItems[index];
      if (!isRecord(item)) {
        return invalidFormat();
      }

      const id = item.id;
      const rawName = item.name;
      const rawUrl = item.url;
      const icon = item.icon;
      if (
        typeof id !== "string" ||
        typeof rawName !== "string" ||
        typeof rawUrl !== "string" ||
        !isShortcutIcon(icon)
      ) {
        return invalidFormat();
      }

      const name = rawName.trim();
      if (!name) {
        return { ok: false, message: "网站名称不能为空" };
      }
      if (ids.has(id)) {
        return { ok: false, message: "快捷网站 ID 不能重复" };
      }

      let url: string;
      try {
        url = normalizeShortcutUrl(rawUrl);
      } catch {
        return { ok: false, message: "仅支持 HTTP 或 HTTPS 地址" };
      }
      if (urls.has(url)) {
        return { ok: false, message: "快捷网站地址不能重复" };
      }

      ids.add(id);
      urls.add(url);
      items.push({ id, name, url, icon });
    }

    return { ok: true, value: { enabled, tabTitleFontSize, items } };
  } catch {
    return invalidFormat();
  }
}

function invalidFormat(): ValidationResult {
  return { ok: false, message: "快捷网站设置格式无效" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShortcutIcon(value: unknown): value is ShortcutIcon {
  return typeof value === "string" && supportedIcons.has(value as ShortcutIcon);
}
