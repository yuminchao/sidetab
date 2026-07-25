import { describe, expect, it, vi } from "vitest";
import { createDefaultShortcutSettings, validateShortcutSettings } from "../src/sidepanel/shortcut-model";
import { createShortcutStore, type StorageArea } from "../src/sidepanel/shortcut-store";

const storedKey = "shortcutSettings";

function createArea(overrides: Partial<StorageArea> = {}): StorageArea {
  return {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("shortcut store", () => {
  it("loads disabled defaults with all three shortcuts from empty storage", async () => {
    const area = createArea();

    await expect(createShortcutStore(area).load()).resolves.toEqual(createDefaultShortcutSettings());
    expect(area.get).toHaveBeenCalledWith(storedKey);
  });

  it("returns normalized valid persisted settings", async () => {
    const area = createArea({
      get: vi.fn().mockResolvedValue({
        [storedKey]: {
          enabled: true,
          items: [{ id: "example", name: "  Example  ", url: " example.com ", icon: "letter" }],
        },
      }),
    });

    await expect(createShortcutStore(area).load()).resolves.toEqual({
      enabled: true,
      tabTitleFontSize: 14,
      items: [{ id: "example", name: "Example", url: "https://example.com/", icon: "letter" }],
    });
  });

  it("falls back to defaults without writing corrupt persisted settings", async () => {
    const area = createArea({ get: vi.fn().mockResolvedValue({ [storedKey]: { enabled: "yes" } }) });

    await expect(createShortcutStore(area).load()).resolves.toEqual(createDefaultShortcutSettings());
    expect(area.set).not.toHaveBeenCalled();
  });

  it("maps storage read failures to the domain error", async () => {
    const area = createArea({ get: vi.fn().mockRejectedValue(new Error("storage unavailable")) });

    await expect(createShortcutStore(area).load()).rejects.toThrow("无法读取快捷网站设置");
  });

  it("maps persisted setting getter failures to the domain error", async () => {
    const stored = Object.defineProperty({}, storedKey, {
      get() {
        throw new Error("getter exploded");
      },
    });
    const area = createArea({ get: vi.fn().mockResolvedValue(stored) });

    await expect(createShortcutStore(area).load()).rejects.toThrow("无法读取快捷网站设置");
  });

  it("writes exactly the normalized settings and returns them", async () => {
    const area = createArea();
    const settings = {
      enabled: true,
      tabTitleFontSize: 18,
      items: [{ id: "example", name: "  Example  ", url: " example.com ", icon: "letter" as const }],
    };

    await expect(createShortcutStore(area).save(settings)).resolves.toEqual({
      enabled: true,
      tabTitleFontSize: 18,
      items: [{ id: "example", name: "Example", url: "https://example.com/", icon: "letter" }],
    });
    expect(area.set).toHaveBeenCalledWith({
      [storedKey]: {
        enabled: true,
        tabTitleFontSize: 18,
        items: [{ id: "example", name: "Example", url: "https://example.com/", icon: "letter" }],
      },
    });
  });

  it("rejects invalid saves with the validator message without writing", async () => {
    const area = createArea();
    const invalid = { enabled: true, tabTitleFontSize: 14, items: [{ id: "example", name: "", url: "https://example.com", icon: "letter" as const }] };
    const validation = validateShortcutSettings(invalid);
    if (validation.ok) throw new Error("test setup expected invalid settings");

    await expect(createShortcutStore(area).save(invalid)).rejects.toThrow(validation.message);
    expect(area.set).not.toHaveBeenCalled();
  });

  it("maps storage save failures to the domain error", async () => {
    const area = createArea({ set: vi.fn().mockRejectedValue(new Error("storage unavailable")) });

    await expect(createShortcutStore(area).save(createDefaultShortcutSettings())).rejects.toThrow("无法保存快捷网站设置");
  });

  it("returns a private normalized snapshot when storage mutates the save payload", async () => {
    const settings = {
      enabled: true,
      tabTitleFontSize: 17,
      items: [{ id: "example", name: "  Example  ", url: " example.com ", icon: "letter" as const }],
    };
    const area = createArea({
      set: vi.fn().mockImplementation(async (items) => {
        const payload = items[storedKey] as typeof settings;
        payload.items[0]!.name = "Mutated by storage";
      }),
    });

    await expect(createShortcutStore(area).save(settings)).resolves.toEqual({
      enabled: true,
      tabTitleFontSize: 17,
      items: [{ id: "example", name: "Example", url: "https://example.com/", icon: "letter" }],
    });
    expect(settings).toEqual({
      enabled: true,
      tabTitleFontSize: 17,
      items: [{ id: "example", name: "  Example  ", url: " example.com ", icon: "letter" }],
    });
  });

  it("writes and returns fresh default settings when reset", async () => {
    const area = createArea();
    const result = await createShortcutStore(area).reset();

    expect(result).toEqual(createDefaultShortcutSettings());
    expect(area.set).toHaveBeenCalledWith({ [storedKey]: result });
  });

  it("maps storage reset failures to the domain error", async () => {
    const area = createArea({ set: vi.fn().mockRejectedValue(new Error("storage unavailable")) });

    await expect(createShortcutStore(area).reset()).rejects.toThrow("无法恢复默认设置");
  });

  it("does not expose defaults to later storage mutations", async () => {
    const written: Record<string, unknown>[] = [];
    const area = createArea({ set: vi.fn().mockImplementation(async (items) => written.push(items)) });
    const store = createShortcutStore(area);
    const resetResult = await store.reset();
    const resetItems = written[0]![storedKey] as ReturnType<typeof createDefaultShortcutSettings>;
    resetItems.items[0]!.name = "Mutated by storage";

    expect(resetResult.items[0]!.name).toBe("OpenAI");
    expect(createDefaultShortcutSettings().items[0]!.name).toBe("OpenAI");
  });
});
