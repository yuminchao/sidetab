import { describe, expect, it } from "vitest";
import {
  createSameSiteGroupPlan,
  getHttpHostname,
  getOtherSameSiteTabIds,
  getSameSiteMenuAvailability,
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
  it("returns the hostname for HTTP and HTTPS URLs without considering their ports", () => {
    expect(getHttpHostname("http://example.com:8080/path")).toBe("example.com");
    expect(getHttpHostname("https://example.com:8443/path")).toBe("example.com");
  });

  it.each(["", "not a URL", "chrome://newtab/", "file:///tmp/report.txt", "chrome-extension://abc/page.html"])(
    "returns undefined for an invalid or unsupported URL: %s",
    (url) => {
      expect(getHttpHostname(url)).toBeUndefined();
    },
  );
});

describe("getOtherSameSiteTabIds", () => {
  it("returns unpinned same-host tabs in input order, including tabs already in groups", () => {
    const tabs = [
      tab({ id: 4, url: "https://www.example.com/" }),
      tab({ id: 1, url: "http://example.com:8080/" }),
      tab({ id: 2, url: "https://example.com:8443/a", groupId: 7 }),
      tab({ id: 3, url: "https://example.com/b", pinned: true }),
      tab({ id: 5, url: "https://sub.example.com/" }),
      tab({ id: 6, url: "https://example.com/c", windowId: 11 }),
      tab({ id: 7, url: "chrome://newtab/" }),
      tab({ id: 8, url: "https://example.com/d" }),
    ];

    expect(getOtherSameSiteTabIds(tabs, 1)).toEqual([2, 8]);
  });

  it("returns an empty array when the target is missing or has no HTTP hostname", () => {
    const tabs = [tab({ id: 1, url: "chrome://newtab/" }), tab({ id: 2 })];

    expect(getOtherSameSiteTabIds(tabs, 99)).toEqual([]);
    expect(getOtherSameSiteTabIds(tabs, 1)).toEqual([]);
  });
});

describe("getSameSiteMenuAvailability", () => {
  it("matches the existing close and group rules for every target state", () => {
    const tabs = [
      tab({ id: 1, url: "https://example.com/target" }),
      tab({ id: 2, url: "https://example.com/grouped", groupId: 7 }),
      tab({ id: 3, url: "https://example.com/pinned", pinned: true }),
      tab({ id: 4, url: "chrome://newtab/" }),
      tab({ id: 5, url: "https://example.com/other-window", windowId: 11 }),
      tab({ id: 6, url: "https://example.com/ordinary" }),
    ];

    for (const tabId of [1, 2, 3, 4, 5, 99]) {
      expect(getSameSiteMenuAvailability(tabs, tabId)).toEqual({
        canCloseOtherSameSite: getOtherSameSiteTabIds(tabs, tabId).length > 0,
        canGroupSameSite: createSameSiteGroupPlan(tabs, tabId) !== undefined,
      });
    }
  });

  it("keeps close available but disables grouping when another candidate is busy", () => {
    const tabs = [
      tab({ id: 1, url: "https://example.com/target" }),
      tab({ id: 2, url: "https://example.com/busy" }),
      tab({ id: 3, url: "https://example.com/grouped", groupId: 7 }),
    ];

    expect(getSameSiteMenuAvailability(tabs, 1, (tabId) => tabId === 2)).toEqual({
      canCloseOtherSameSite: true,
      canGroupSameSite: false,
    });
  });

  it("reads each item once while calculating both states for a 500-tab snapshot", () => {
    const source = Array.from({ length: 500 }, (_, id) => tab({
      id: id + 1,
      index: id,
      url: id % 2 === 0 ? `https://example.com/${id}` : `https://other.example/${id}`,
    }));
    let itemReads = 0;
    const tabs = new Proxy(source, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) itemReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    expect(getSameSiteMenuAvailability(tabs, 1)).toEqual({
      canCloseOtherSameSite: true,
      canGroupSameSite: true,
    });
    expect(itemReads).toBe(500);
  });
});

describe("createSameSiteGroupPlan", () => {
  it("creates an ungrouped same-host plan in input order and ignores pinned, grouped, and other-window tabs", () => {
    const tabs = [
      tab({ id: 4, url: "https://www.example.com/" }),
      tab({ id: 1, url: "http://example.com:8080/" }),
      tab({ id: 2, url: "https://example.com:8443/a" }),
      tab({ id: 3, url: "https://example.com/b", pinned: true }),
      tab({ id: 5, url: "https://example.com/c", groupId: 7 }),
      tab({ id: 6, url: "https://example.com/d", windowId: 11 }),
      tab({ id: 7, url: "https://sub.example.com/" }),
      tab({ id: 8, url: "https://example.com/e" }),
    ];

    expect(createSameSiteGroupPlan(tabs, 1)).toEqual({
      hostname: "example.com",
      windowId: 10,
      tabIds: [1, 2, 8],
    });
  });

  it.each([
    ["the target is missing", [] as TabViewModel[], 99],
    ["the target uses a non-HTTP URL", [tab({ url: "file:///tmp/a" }), tab({ id: 2 })], 1],
    ["the target is pinned", [tab({ pinned: true }), tab({ id: 2 })], 1],
    ["the target is already grouped", [tab({ groupId: 3 }), tab({ id: 2 })], 1],
    ["only one eligible tab exists", [tab(), tab({ id: 2, pinned: true })], 1],
  ])("returns undefined when %s", (_reason, tabs, tabId) => {
    expect(createSameSiteGroupPlan(tabs, tabId)).toBeUndefined();
  });

  it("does not mutate the supplied tabs while calculating close and group results", () => {
    const tabs = [
      tab({ id: 1 }),
      tab({ id: 2, url: "https://example.com:8443/", groupId: 7 }),
      tab({ id: 3, url: "https://example.com/second" }),
    ];
    const original = structuredClone(tabs);

    getOtherSameSiteTabIds(tabs, 1);
    createSameSiteGroupPlan(tabs, 1);

    expect(tabs).toEqual(original);
  });

  it("processes a large snapshot with stable linear-order results", () => {
    const tabs = Array.from({ length: 500 }, (_, id) => tab({
      id: id + 1,
      index: id,
      url: id % 2 === 0 ? `https://example.com/${id}` : `https://other.example/${id}`,
    }));

    const closeIds = getOtherSameSiteTabIds(tabs, 1);
    const groupPlan = createSameSiteGroupPlan(tabs, 1);

    expect(closeIds).toHaveLength(249);
    expect(closeIds[0]).toBe(3);
    expect(closeIds.at(-1)).toBe(499);
    expect(groupPlan?.tabIds).toHaveLength(250);
    expect(groupPlan?.tabIds[0]).toBe(1);
    expect(groupPlan?.tabIds.at(-1)).toBe(499);
  });
});
