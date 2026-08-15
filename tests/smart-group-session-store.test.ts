import { describe, expect, it, vi } from "vitest";
import {
  createSmartGroupSessionStore,
} from "../src/sidepanel/smart-group-session-store";
import type { StorageArea } from "../src/sidepanel/shortcut-store";

function createMemoryStorage(
  initial: Record<string, unknown> = {},
): StorageArea & { values: Record<string, unknown> } {
  const values = { ...initial };
  return {
    values,
    async get(key) {
      return Object.hasOwn(values, key) ? { [key]: values[key] } : {};
    },
    async set(items) {
      Object.assign(values, items);
    },
  };
}

describe("smart group session store", () => {
  it("saves and loads the Other group independently for each window", async () => {
    const area = createMemoryStorage();
    const store = createSmartGroupSessionStore(area);

    await store.saveOtherGroup(10, 101);
    await store.saveOtherGroup(20, 202);

    await expect(store.load(10)).resolves.toEqual({ otherGroupId: 101 });
    await expect(store.load(20)).resolves.toEqual({ otherGroupId: 202 });
    expect(area.values).toEqual({
      "smartGroupSession:10": { otherGroupId: 101 },
      "smartGroupSession:20": { otherGroupId: 202 },
    });
  });

  it.each([
    ["missing", {}],
    ["non-record", { "smartGroupSession:10": "invalid" }],
    ["invalid group ID", { "smartGroupSession:10": { otherGroupId: -1 } }],
    ["unsafe group ID", { "smartGroupSession:10": { otherGroupId: Number.MAX_SAFE_INTEGER + 1 } }],
  ])("returns empty state for %s session data", async (_case, initial) => {
    const store = createSmartGroupSessionStore(createMemoryStorage(initial));

    await expect(store.load(10)).resolves.toEqual({});
  });

  it("returns empty state when reading session storage fails", async () => {
    const store = createSmartGroupSessionStore({
      get: vi.fn().mockRejectedValue(new Error("unavailable")),
      set: vi.fn(),
    });

    await expect(store.load(10)).resolves.toEqual({});
  });

  it("ignores a session key inherited from the storage result prototype", async () => {
    const stored = Object.create({
      "smartGroupSession:10": { otherGroupId: 101 },
    }) as Record<string, unknown>;
    const store = createSmartGroupSessionStore({
      get: vi.fn().mockResolvedValue(stored),
      set: vi.fn(),
    });

    await expect(store.load(10)).resolves.toEqual({});
  });

  it("ignores an Other group ID inherited from the stored value prototype", async () => {
    const value = Object.create({ otherGroupId: 101 }) as Record<string, unknown>;
    const store = createSmartGroupSessionStore({
      get: vi.fn().mockResolvedValue({ "smartGroupSession:10": value }),
      set: vi.fn(),
    });

    await expect(store.load(10)).resolves.toEqual({});
  });

  it("loads own properties from null-prototype records and ignores extra fields", async () => {
    const value = Object.assign(Object.create(null) as Record<string, unknown>, {
      otherGroupId: 101,
      extra: "ignored",
    });
    const stored = Object.assign(Object.create(null) as Record<string, unknown>, {
      "smartGroupSession:10": value,
    });
    const store = createSmartGroupSessionStore({
      get: vi.fn().mockResolvedValue(stored),
      set: vi.fn(),
    });

    await expect(store.load(10)).resolves.toEqual({ otherGroupId: 101 });
  });

  it.each([
    ["negative window ID", -1, 10],
    ["fractional window ID", 1.5, 10],
    ["unsafe window ID", Number.MAX_SAFE_INTEGER + 1, 10],
    ["negative group ID", 1, -1],
    ["fractional group ID", 1, 2.5],
    ["unsafe group ID", 1, Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s without writing", async (_case, windowId, groupId) => {
    const set = vi.fn();
    const store = createSmartGroupSessionStore({ get: vi.fn(), set });

    await expect(store.saveOtherGroup(windowId, groupId)).rejects.toThrow();
    expect(set).not.toHaveBeenCalled();
  });

  it("returns empty state for an invalid window ID without reading", async () => {
    const get = vi.fn();
    const store = createSmartGroupSessionStore({ get, set: vi.fn() });

    await expect(store.load(-1)).resolves.toEqual({});
    expect(get).not.toHaveBeenCalled();
  });

  it("serializes consecutive saves so the older write finishes first", async () => {
    let finishFirst!: () => void;
    const set = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishFirst = resolve;
      }))
      .mockResolvedValue(undefined);
    const store = createSmartGroupSessionStore({ get: vi.fn(), set });

    const first = store.saveOtherGroup(10, 101);
    const second = store.saveOtherGroup(10, 202);
    await Promise.resolve();
    await Promise.resolve();
    expect(set).toHaveBeenCalledTimes(1);

    finishFirst();
    await Promise.all([first, second]);
    expect(set).toHaveBeenNthCalledWith(2, {
      "smartGroupSession:10": { otherGroupId: 202 },
    });
  });

  it("serializes save before clear", async () => {
    let finishSave!: () => void;
    const set = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishSave = resolve;
      }))
      .mockResolvedValue(undefined);
    const store = createSmartGroupSessionStore({ get: vi.fn(), set });

    const save = store.saveOtherGroup(10, 101);
    const clear = store.clearOtherGroup(10);
    await Promise.resolve();
    await Promise.resolve();
    expect(set).toHaveBeenCalledTimes(1);

    finishSave();
    await Promise.all([save, clear]);
    expect(set).toHaveBeenNthCalledWith(2, {
      "smartGroupSession:10": {},
    });
  });

  it("continues the write queue after an earlier save fails", async () => {
    const writeOrder: number[] = [];
    const set = vi.fn()
      .mockImplementationOnce(async () => {
        writeOrder.push(101);
        throw new Error("first write failed");
      })
      .mockImplementationOnce(async () => {
        writeOrder.push(202);
      });
    const store = createSmartGroupSessionStore({ get: vi.fn(), set });

    const first = store.saveOtherGroup(10, 101);
    const second = store.saveOtherGroup(10, 202);

    await expect(first).rejects.toThrow("first write failed");
    await expect(second).resolves.toBeUndefined();
    expect(writeOrder).toEqual([101, 202]);
    expect(set).toHaveBeenNthCalledWith(2, {
      "smartGroupSession:10": { otherGroupId: 202 },
    });
  });

  it("clears only the selected window", async () => {
    const area = createMemoryStorage({
      "smartGroupSession:10": { otherGroupId: 101 },
      "smartGroupSession:20": { otherGroupId: 202 },
    });
    const store = createSmartGroupSessionStore(area);

    await store.clearOtherGroup(10);

    await expect(store.load(10)).resolves.toEqual({});
    await expect(store.load(20)).resolves.toEqual({ otherGroupId: 202 });
  });

  it("rejects clearing an invalid window ID without writing", async () => {
    const set = vi.fn();
    const store = createSmartGroupSessionStore({ get: vi.fn(), set });

    await expect(store.clearOtherGroup(-1)).rejects.toThrow();
    expect(set).not.toHaveBeenCalled();
  });
});
