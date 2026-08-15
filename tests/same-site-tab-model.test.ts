import { describe, expect, it } from "vitest";
import {
  getHttpHostname,
  getOtherSameSiteTabIds,
} from "../src/sidepanel/same-site-tab-model";
import type { TabViewModel } from "../src/sidepanel/tab-model";

function tab(overrides: Partial<TabViewModel> = {}): TabViewModel {
  return {
    id: 1,
    windowId: 10,
    index: 0,
    title: "Example",
    url: "https://example.com/path",
    domain: "example.com",
    active: false,
    pinned: false,
    groupId: -1,
    ...overrides,
  };
}

describe("getHttpHostname", () => {
  it("re-exports the shared HTTP hostname rules for existing callers", () => {
    expect(getHttpHostname("http://EXAMPLE.com:8080/path")).toBe("example.com");
    expect(getHttpHostname("https://www.example.com:8443/path")).toBe("www.example.com");
  });

  it.each(["", "not a URL", "chrome://newtab/", "file:///tmp/report.txt"])(
    "returns undefined for an invalid or unsupported URL: %s",
    (url) => expect(getHttpHostname(url)).toBeUndefined(),
  );
});

describe("getOtherSameSiteTabIds", () => {
  it("returns unpinned same-host tabs in input order, including grouped members", () => {
    const tabs = [
      tab({ id: 1, url: "http://example.com:8080/" }),
      tab({ id: 2, url: "https://example.com/a", groupId: 7 }),
      tab({ id: 3, url: "https://example.com/b", pinned: true }),
      tab({ id: 4, url: "https://www.example.com/" }),
      tab({ id: 5, url: "https://example.com/c", windowId: 11 }),
      tab({ id: 6, url: "https://example.com/d" }),
    ];

    expect(getOtherSameSiteTabIds(tabs, 1)).toEqual([2, 6]);
  });

  it("returns an empty array when the target is missing or unsupported", () => {
    const tabs = [tab({ id: 1, url: "chrome://newtab/" }), tab({ id: 2 })];

    expect(getOtherSameSiteTabIds(tabs, 99)).toEqual([]);
    expect(getOtherSameSiteTabIds(tabs, 1)).toEqual([]);
  });
});
