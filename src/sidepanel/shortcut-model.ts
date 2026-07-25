export type ShortcutIcon = "openai" | "google" | "github" | "letter";

export type Shortcut = {
  id: string;
  name: string;
  url: string;
  icon: ShortcutIcon;
};

export type ShortcutSettings = {
  enabled: boolean;
  items: Shortcut[];
};

export type ValidationResult =
  | { ok: true; value: ShortcutSettings }
  | { ok: false; message: string };

const defaultShortcuts: readonly Shortcut[] = [
  { id: "openai", name: "OpenAI", url: "https://chatgpt.com/", icon: "openai" },
  { id: "google", name: "Google", url: "https://www.google.com/", icon: "google" },
  { id: "github", name: "GitHub", url: "https://github.com/", icon: "github" },
];

const supportedIcons = new Set<ShortcutIcon>(["openai", "google", "github", "letter"]);
const invalidFormat: ValidationResult = { ok: false, message: "快捷网站设置格式无效" };

export function createDefaultShortcutSettings(): ShortcutSettings {
  return {
    enabled: false,
    items: defaultShortcuts.map((shortcut) => ({ ...shortcut })),
  };
}

export function normalizeShortcutUrl(raw: string): string {
  const trimmed = raw.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

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
    if (!isRecord(input) || typeof input.enabled !== "boolean" || !Array.isArray(input.items)) {
      return invalidFormat;
    }
    if (input.items.length > 12) {
      return { ok: false, message: "最多只能添加 12 个快捷网站" };
    }

    const ids = new Set<string>();
    const urls = new Set<string>();
    const items: Shortcut[] = [];

    for (const item of input.items) {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.name !== "string" ||
        typeof item.url !== "string" ||
        !isShortcutIcon(item.icon)
      ) {
        return invalidFormat;
      }

      const id = item.id.trim();
      const name = item.name.trim();
      if (!name) {
        return { ok: false, message: "网站名称不能为空" };
      }
      if (ids.has(id)) {
        return { ok: false, message: "快捷网站 ID 不能重复" };
      }

      let url: string;
      try {
        url = normalizeShortcutUrl(item.url);
      } catch {
        return { ok: false, message: "仅支持 HTTP 或 HTTPS 地址" };
      }
      if (urls.has(url)) {
        return { ok: false, message: "快捷网站地址不能重复" };
      }

      ids.add(id);
      urls.add(url);
      items.push({ id, name, url, icon: item.icon });
    }

    return { ok: true, value: { enabled: input.enabled, items } };
  } catch {
    return invalidFormat;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShortcutIcon(value: unknown): value is ShortcutIcon {
  return typeof value === "string" && supportedIcons.has(value as ShortcutIcon);
}
