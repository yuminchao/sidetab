import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAB_TITLE_FONT_SIZE,
  MAX_TAB_TITLE_FONT_SIZE,
  MIN_TAB_TITLE_FONT_SIZE,
  appendTabShortcut,
  createDefaultShortcutSettings,
  getShortcutUrlsToOpen,
  normalizeShortcutUrl,
  validateShortcutSettings,
  type Shortcut,
} from "../src/sidepanel/shortcut-model";

const shortcut = (overrides: Partial<Shortcut> = {}): Shortcut => ({
  id: "example",
  name: "Example",
  url: "https://example.com",
  icon: "letter",
  ...overrides,
});

describe("shortcut model", () => {
  it("returns shortcut URLs whose domains are not already open, without duplicates", () => {
    const shortcuts = [
      shortcut({ id: "one", url: "https://Example.com/docs" }),
      shortcut({ id: "two", url: "https://two.example/" }),
      shortcut({ id: "two-copy", url: "https://two.example/other" }),
    ];

    expect(getShortcutUrlsToOpen(shortcuts, [{ url: "https://example.com/already-open" }]))
      .toEqual(["https://two.example/"]);
  });
  it("appends a normalized letter shortcut from a tab", () => {
    const settings = createDefaultShortcutSettings();
    const result = appendTabShortcut(settings, {
      id: "tab-1",
      title: "  Example page  ",
      url: "example.com/path",
    });

    expect(result.items.at(-1)).toEqual({
      id: "tab-1",
      name: "Example page",
      url: "https://example.com/path",
      icon: "letter",
    });
    expect(settings).toEqual(createDefaultShortcutSettings());
  });

  it("uses the hostname when a tab has no title", () => {
    const result = appendTabShortcut(createDefaultShortcutSettings(), {
      id: "tab-empty-title",
      title: "   ",
      url: "https://docs.example.test/guide",
    });

    expect(result.items.at(-1)?.name).toBe("docs.example.test");
  });

  it.each([
    ["chrome://settings/", "仅支持 HTTP 或 HTTPS 地址"],
    ["https://chatgpt.com/", "快捷网站地址不能重复"],
  ])("rejects %s without mutating settings", (url, message) => {
    const settings = createDefaultShortcutSettings();
    const before = structuredClone(settings);

    expect(() =>
      appendTabShortcut(settings, { id: "rejected", title: "Rejected", url }),
    ).toThrow(message);
    expect(settings).toEqual(before);
  });

  it("rejects a thirteenth item and duplicate ID", () => {
    const full = {
      enabled: true,
      tabTitleFontSize: 14,
      contentTreeEnabled: false,
      items: Array.from({ length: 12 }, (_, index) => ({
        id: `item-${index}`,
        name: `Item ${index}`,
        url: `https://item-${index}.example/`,
        icon: "letter" as const,
      })),
    };

    expect(() =>
      appendTabShortcut(full, {
        id: "item-12",
        title: "Overflow",
        url: "https://overflow.example/",
      }),
    ).toThrow("最多只能添加 12 个快捷网站");
    expect(() =>
      appendTabShortcut(createDefaultShortcutSettings(), {
        id: "openai",
        title: "Different",
        url: "https://different.example/",
      }),
    ).toThrow("快捷网站 ID 不能重复");
  });

  it("creates enabled default settings with the three prescribed shortcuts", () => {
    expect(createDefaultShortcutSettings()).toEqual({
      enabled: true,
      tabTitleFontSize: 14,
      contentTreeEnabled: false,
      items: [
        { id: "openai", name: "OpenAI", url: "https://chatgpt.com/", icon: "openai" },
        { id: "google", name: "Google", url: "https://www.google.com/", icon: "google" },
        { id: "github", name: "GitHub", url: "https://github.com/", icon: "github" },
      ],
    });
  });

  it("exports the tab title font size bounds", () => {
    expect({
      default: DEFAULT_TAB_TITLE_FONT_SIZE,
      min: MIN_TAB_TITLE_FONT_SIZE,
      max: MAX_TAB_TITLE_FONT_SIZE,
    }).toEqual({ default: 14, min: 12, max: 18 });
  });

  it.each([12, 14, 16, 18])("accepts tab title font size %s", (tabTitleFontSize) => {
    expect(validateShortcutSettings({ enabled: true, items: [], tabTitleFontSize })).toEqual({
      ok: true,
      value: { enabled: true, items: [], tabTitleFontSize, contentTreeEnabled: false },
    });
  });

  it.each([11, 19, 14.5, Number.NaN, "14", undefined])(
    "rejects invalid tab title font size %s",
    (tabTitleFontSize) => {
      expect(validateShortcutSettings({ enabled: true, items: [], tabTitleFontSize }).ok).toBe(
        false,
      );
    },
  );

  it("migrates a valid legacy object to the default tab title font size", () => {
    expect(validateShortcutSettings({ enabled: true, items: [] })).toEqual({
      ok: true,
      value: { enabled: true, items: [], tabTitleFontSize: 14, contentTreeEnabled: false },
    });
  });

  it("migrates a valid legacy object without enabled to enabled", () => {
    expect(validateShortcutSettings({ items: [shortcut()], tabTitleFontSize: 14 })).toEqual({
      ok: true,
      value: {
        enabled: true,
        items: [shortcut({ url: "https://example.com/" })],
        tabTitleFontSize: 14,
        contentTreeEnabled: false,
      },
    });
  });

  it("preserves an explicitly disabled setting", () => {
    expect(validateShortcutSettings({ enabled: false, items: [], tabTitleFontSize: 16 })).toEqual({
      ok: true,
      value: { enabled: false, items: [], tabTitleFontSize: 16, contentTreeEnabled: false },
    });
  });

  it.each([undefined, null, "true", 1])(
    "rejects an explicitly invalid enabled value %s",
    (enabled) => {
      expect(validateShortcutSettings({ enabled, items: [], tabTitleFontSize: 16 }).ok).toBe(
        false,
      );
    },
  );

  it("keeps default settings isolated between callers", () => {
    const first = createDefaultShortcutSettings();
    first.items[0]!.name = "Changed";

    expect(createDefaultShortcutSettings().items[0]!.name).toBe("OpenAI");
  });

  it("normalizes a hostname without a scheme", () => {
    expect(normalizeShortcutUrl(" example.com ")).toBe("https://example.com/");
  });

  it("normalizes a hostname with a port without a scheme", () => {
    expect(normalizeShortcutUrl("example.com:8080")).toBe("https://example.com:8080/");
  });

  it("preserves an HTTPS URL path while normalizing", () => {
    expect(normalizeShortcutUrl("https://example.com/docs/getting-started")).toBe(
      "https://example.com/docs/getting-started",
    );
  });

  it.each(["javascript:alert(1)", "data:text/plain,no", "file:///secret", "not a host"]) (
    "rejects unsafe or invalid URL %s",
    (raw) => {
      expect(() => normalizeShortcutUrl(raw)).toThrow("仅支持 HTTP 或 HTTPS 地址");
    },
  );

  it("rejects duplicate normalized URLs", () => {
    const result = validateShortcutSettings({
      enabled: true,
      items: [shortcut({ id: "one", url: "example.com" }), shortcut({ id: "two", url: "https://example.com/" })],
    });

    expect(result).toEqual({ ok: false, message: "快捷网站地址不能重复" });
  });

  it("rejects duplicate IDs", () => {
    const result = validateShortcutSettings({
      enabled: true,
      items: [shortcut(), shortcut({ url: "https://other.example" })],
    });

    expect(result).toEqual({ ok: false, message: "快捷网站 ID 不能重复" });
  });

  it("rejects more than twelve shortcuts", () => {
    const items = Array.from({ length: 13 }, (_, index) => shortcut({ id: `site-${index}`, url: `https://site-${index}.example` }));

    expect(validateShortcutSettings({ enabled: true, items })).toEqual({
      ok: false,
      message: "最多只能添加 12 个快捷网站",
    });
  });

  it("rejects a blank website name", () => {
    expect(validateShortcutSettings({ enabled: true, items: [shortcut({ name: "  " })] })).toEqual({
      ok: false,
      message: "网站名称不能为空",
    });
  });

  it("rejects an unknown icon", () => {
    expect(validateShortcutSettings({ enabled: true, items: [{ ...shortcut(), icon: "star" }] })).toEqual({
      ok: false,
      message: "快捷网站设置格式无效",
    });
  });

  it("returns a format error without throwing for malformed persisted data", () => {
    expect(() => validateShortcutSettings({ enabled: true })).not.toThrow();
    expect(validateShortcutSettings({ enabled: true })).toEqual({
      ok: false,
      message: "快捷网站设置格式无效",
    });
  });

  it("creates a fresh format error for each invalid input", () => {
    const first = validateShortcutSettings(null);
    if (!first.ok) {
      first.message = "changed";
    }

    expect(validateShortcutSettings(null)).toEqual({
      ok: false,
      message: "快捷网站设置格式无效",
    });
  });

  it("captures enabled once when its getter changes", () => {
    let reads = 0;
    const input = {
      get enabled() {
        return reads++ === 0;
      },
      items: [shortcut()],
    };

    expect(validateShortcutSettings(input)).toEqual({
      ok: true,
      value: { enabled: true, items: [shortcut({ url: "https://example.com/" })], tabTitleFontSize: 14, contentTreeEnabled: false },
    });
  });

  it("captures content tree enabled once when its getter changes", () => {
    let reads = 0;
    const input = {
      enabled: true,
      get contentTreeEnabled() {
        return reads++ === 0;
      },
      items: [],
    };

    expect(validateShortcutSettings(input)).toMatchObject({
      ok: true,
      value: { contentTreeEnabled: true },
    });
    expect(reads).toBe(1);
  });

  it("captures an icon once when its getter changes", () => {
    let reads = 0;
    const item = {
      id: "example",
      name: "Example",
      url: "https://example.com",
      get icon() {
        return reads++ === 0 ? "letter" : "star";
      },
    };

    expect(validateShortcutSettings({ enabled: true, items: [item] })).toEqual({
      ok: true,
      value: { enabled: true, items: [shortcut({ url: "https://example.com/" })], tabTitleFontSize: 14, contentTreeEnabled: false },
    });
  });

  it("uses the checked array length when a Proxy exposes a later thirteenth item", () => {
    const source = Array.from({ length: 13 }, (_, index) => shortcut({ id: `site-${index}`, url: `https://site-${index}.example` }));
    let lengthReads = 0;
    const items = new Proxy(source, {
      get(target, property, receiver) {
        if (property === "length") {
          return lengthReads++ === 0 ? 12 : 13;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const result = validateShortcutSettings({ enabled: true, items });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items).toHaveLength(12);
    }
  });

  it("returns a format error for a revoked Proxy", () => {
    const { proxy, revoke } = Proxy.revocable({ enabled: true, items: [] }, {});
    revoke();

    expect(() => validateShortcutSettings(proxy)).not.toThrow();
    expect(validateShortcutSettings(proxy)).toEqual({
      ok: false,
      message: "快捷网站设置格式无效",
    });
  });

  it("returns a normalized copy without changing its input", () => {
    const input = {
      enabled: true,
      items: [shortcut({ id: " stable-id ", name: "  Example  ", url: " example.com " })],
    };

    const result = validateShortcutSettings(input);

    expect(result).toEqual({
      ok: true,
      value: { enabled: true, items: [shortcut({ id: " stable-id ", name: "Example", url: "https://example.com/" })], tabTitleFontSize: 14, contentTreeEnabled: false },
    });
    expect(input).toEqual({
      enabled: true,
      items: [shortcut({ id: " stable-id ", name: "  Example  ", url: " example.com " })],
    });
  });

  it("treats whitespace differences in IDs as distinct", () => {
    expect(
      validateShortcutSettings({
        enabled: true,
        items: [shortcut({ id: " stable-id ", url: "https://one.example" }), shortcut({ id: "stable-id", url: "https://two.example" })],
      }),
    ).toEqual({
      ok: true,
      value: {
        enabled: true,
        tabTitleFontSize: 14,
        contentTreeEnabled: false,
        items: [shortcut({ id: " stable-id ", url: "https://one.example/" }), shortcut({ id: "stable-id", url: "https://two.example/" })],
      },
    });
  });

  it.each([
    [{ contentTreeEnabled: true, newTabBehavior: "root" }, true],
    [{ contentTreeEnabled: false, newTabBehavior: "child" }, false],
    [{ newTabBehavior: "child" }, true],
    [{ newTabBehavior: "root" }, false],
    [{}, false],
    [{ newTabBehavior: "unknown" }, false],
  ])("migrates content tree settings", (extra, expected) => {
    expect(validateShortcutSettings({
      enabled: true,
      items: [],
      tabTitleFontSize: 14,
      ...extra,
    })).toMatchObject({ ok: true, value: { contentTreeEnabled: expected } });
  });
});
