import { describe, expect, it } from "vitest";
import { toTabViewModel } from "../src/sidepanel/tab-model";

function tab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 7,
    windowId: 2,
    index: 3,
    title: "  Example page  ",
    url: "https://example.com/docs",
    active: false,
    pinned: false,
    ...overrides,
  } as chrome.tabs.Tab;
}

describe("tab model", () => {
  it("maps a tab with its URL hostname and trimmed title", () => {
    expect(toTabViewModel(tab())).toEqual({
      id: 7,
      windowId: 2,
      index: 3,
      title: "Example page",
      url: "https://example.com/docs",
      domain: "example.com",
      active: false,
      pinned: false,
    });
  });

  it("uses the protocol for parsable URLs without a hostname", () => {
    expect(toTabViewModel(tab({ url: "chrome://newtab/" })).domain).toBe("chrome");
  });

  it("falls back to pendingUrl and preserves an unparsable URL as the domain", () => {
    expect(toTabViewModel(tab({ url: undefined, pendingUrl: "not a valid URL" }))).toMatchObject({
      url: "not a valid URL",
      domain: "not a valid URL",
    });
  });

  it("uses an empty URL when neither committed nor pending URL exists", () => {
    expect(toTabViewModel(tab({ url: undefined, pendingUrl: undefined }))).toMatchObject({
      url: "",
      domain: "",
    });
  });

  it("uses the new-tab title fallback and only preserves a non-empty favicon", () => {
    expect(toTabViewModel(tab({ title: "  ", favIconUrl: "" }))).toMatchObject({
      title: "新标签页",
    });
    expect(toTabViewModel(tab({ title: "", favIconUrl: "https://example.com/icon.ico" }))).toMatchObject({
      favIconUrl: "https://example.com/icon.ico",
    });
    expect(toTabViewModel(tab({ favIconUrl: "" }))).not.toHaveProperty("favIconUrl");
  });

  it("rejects a tab without an ID and does not mutate its input", () => {
    const input = tab({ id: undefined });
    expect(() => toTabViewModel(input)).toThrow("标签页缺少 ID");
    expect(input).toEqual(tab({ id: undefined }));
  });
});
