import { describe, expect, it } from "vitest";
import {
  createDefaultShortcutSettings,
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
  it("creates disabled default settings with the three prescribed shortcuts", () => {
    expect(createDefaultShortcutSettings()).toEqual({
      enabled: false,
      items: [
        { id: "openai", name: "OpenAI", url: "https://chatgpt.com/", icon: "openai" },
        { id: "google", name: "Google", url: "https://www.google.com/", icon: "google" },
        { id: "github", name: "GitHub", url: "https://github.com/", icon: "github" },
      ],
    });
  });

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
      value: { enabled: true, items: [shortcut({ url: "https://example.com/" })] },
    });
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
      value: { enabled: true, items: [shortcut({ url: "https://example.com/" })] },
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
      value: { enabled: true, items: [shortcut({ id: " stable-id ", name: "Example", url: "https://example.com/" })] },
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
        items: [shortcut({ id: " stable-id ", url: "https://one.example/" }), shortcut({ id: "stable-id", url: "https://two.example/" })],
      },
    });
  });
});
